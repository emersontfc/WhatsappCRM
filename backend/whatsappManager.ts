import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  Contact as BaileysContact,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import { supabaseAdmin } from "./supabaseAdmin.ts";
import { handleIncomingMessage } from "./automationManager.ts";
import { handleAgentMessage } from "./agentManager.ts";
import { useSupabaseAuthState } from "./lib/supabaseAuthState.ts";

const logger = pino({ level: "warn" });

export class WhatsAppManager {
  private sessions: Map<string, { socket: any; status: string; qr?: string }> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private maxReconnectAttempts = 5;

  private async log(userId: string, type: "info" | "success" | "error" | "warn", message: string, metadata?: any) {
    try {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(userId)) return;

      await supabaseAdmin.from("logs").insert({
        user_id: userId,
        type,
        message,
        metadata: metadata || {},
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Error logging to Supabase:", err);
    }
  }

  public getActiveSessionsCount(userId: string): number {
    const session = this.sessions.get(userId);
    return session && session.status === "connected" ? 1 : 0;
  }

  async createSession(userId: string, onUpdate?: (status: string, data?: string) => void) {
    try {
      const existingSession = this.sessions.get(userId);
      if (existingSession) {
        if (existingSession.status === "connected" || existingSession.status === "connecting" || existingSession.status === "qr") {
          console.log(`[WhatsApp] Session already exists for ${userId} with status: ${existingSession.status}`);
          return existingSession.socket;
        }
        // If it's in a weird state, end it
        try { existingSession.socket.end(undefined); } catch (e) {}
        this.sessions.delete(userId);
      }

      const attempts = this.reconnectAttempts.get(userId) || 0;
      if (attempts >= this.maxReconnectAttempts) {
        console.warn(`[WhatsApp] Max reconnection attempts reached for ${userId}. Resetting...`);
        this.reconnectAttempts.delete(userId);
        await this.log(userId, "error", "Máximo de tentativas de reconexão atingido. Por favor, tente novamente.");
        onUpdate?.("disconnected");
        return;
      }

      console.log(`[WhatsApp] Creating new session for ${userId} (Attempt ${attempts + 1})`);
      await this.log(userId, "info", `Iniciando conexão WhatsApp (Tentativa ${attempts + 1})...`);
      
      const { state, saveCreds } = await useSupabaseAuthState(userId);
      console.log(`[WhatsApp] Auth state loaded for ${userId}`);
      
      let version;
      try {
        console.log(`[WhatsApp] Fetching latest Baileys version...`);
        const v = await fetchLatestBaileysVersion();
        version = v.version;
        console.log(`[WhatsApp] Using Baileys version: ${version.join('.')}`);
      } catch (err) {
        console.warn(`[WhatsApp] Failed to fetch Baileys version, using fallback:`, err);
        version = [2, 3000, 1017531287];
      }

      const socket = makeWASocket({
        version,
        printQRInTerminal: false,
        browser: Browsers.macOS("Desktop"),
        auth: state,
        logger,
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 15000,
        retryRequestDelayMs: 5000,
        shouldSyncHistoryMessage: () => false,
      });

      this.sessions.set(userId, { socket, status: "connecting" });

      socket.ev.on("creds.update", saveCreds);

      socket.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;
        const session = this.sessions.get(userId);
        if (!session) return;

        if (qr) {
          console.log(`[WhatsApp] QR Code received for ${userId}`);
          session.qr = qr;
          session.status = "qr";
          onUpdate?.("qr", qr);
          await this.log(userId, "info", "QR Code gerado. Aguardando leitura...");
        }

        if (connection === "open") {
          session.status = "connected";
          session.qr = undefined;
          this.reconnectAttempts.delete(userId);
          await this.log(userId, "success", "WhatsApp conectado com sucesso!");
          onUpdate?.("connected");
        }

        if (connection === "close") {
          const boomErr = lastDisconnect?.error as Boom | undefined;
          const statusCode = boomErr?.output?.statusCode;
          const reason = boomErr?.message || "Unknown reason";
          
          console.log(`[WhatsApp] Connection closed for ${userId}. Status: ${statusCode}, Reason: ${reason}`);
          
          // Reconnect if not logged out
          const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;
          const shouldReconnect = !isLoggedOut && attempts < this.maxReconnectAttempts;
          
          if (shouldReconnect) {
            this.reconnectAttempts.set(userId, attempts + 1);
            const delayTime = Math.min(5000 * (attempts + 1), 30000);
            console.log(`[WhatsApp] Reconnecting session for ${userId} in ${delayTime/1000}s...`);
            setTimeout(() => this.createSession(userId, onUpdate), delayTime);
          } else {
            if (isLoggedOut) {
              console.log(`[WhatsApp] Logged out for ${userId}. Clearing session.`);
              await supabaseAdmin.from("whatsapp_sessions").delete().eq("user_id", userId);
              await this.log(userId, "warn", "Sessão encerrada ou expirada.");
            } else {
              console.log(`[WhatsApp] Max attempts reached or fatal error for ${userId}.`);
              await this.log(userId, "error", "Falha na conexão. Por favor, tente reconectar manualmente.");
            }
            this.sessions.delete(userId);
            onUpdate?.("disconnected");
          }
        }
      });

      // Sync Logic
      socket.ev.on("contacts.upsert", async (contacts) => {
        for (const contact of contacts) {
          if (contact.id && !contact.id.includes("@g.us") && (contact.name || contact.notify)) {
            await this.syncContact(userId, contact);
          }
        }
      });

      socket.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify" && type !== "append") return;
        for (const msg of messages) {
          try {
            let text = "";
            if (msg.message?.conversation) text = msg.message.conversation;
            else if (msg.message?.extendedTextMessage?.text) text = msg.message.extendedTextMessage.text;
            else if (msg.message?.imageMessage?.caption) text = msg.message.imageMessage.caption;
            else if (msg.message?.videoMessage?.caption) text = msg.message.videoMessage.caption;
            else if (msg.message?.buttonsResponseMessage?.selectedButtonId) text = msg.message.buttonsResponseMessage.selectedButtonId;
            else if (msg.message?.templateButtonReplyMessage?.selectedId) text = msg.message.templateButtonReplyMessage.selectedId;
            else if (msg.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
              try {
                const params = JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
                text = params.id || params.selectedId || "";
              } catch (e) {}
            } else if (msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId) text = msg.message.listResponseMessage.singleSelectReply.selectedRowId;

            const jid = msg.key.remoteJid!;
            const isMe = msg.key.fromMe;

            await this.syncMessage(userId, msg);

            if (!isMe && text) {
              await handleIncomingMessage(this, userId, jid, text, !!(msg.message?.buttonsResponseMessage || msg.message?.templateButtonReplyMessage || msg.message?.interactiveResponseMessage));
              await handleAgentMessage(this, userId, jid, text);
            }
          } catch (err) {
            console.error("Error processing message:", err);
          }
        }
      });

      return socket;
    } catch (err) {
      console.error(`Error creating session for ${userId}:`, err);
      throw err;
    }
  }

  private async syncMessage(userId: string, msg: any) {
    try {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(userId)) return;

      if (!msg.message) return;
      
      const jid = msg.key.remoteJid;
      if (!jid) return;

      if (jid === "status@broadcast") return;

      let text = msg.message.conversation || 
                   msg.message.extendedTextMessage?.text || 
                   msg.message.imageMessage?.caption || 
                   msg.message.videoMessage?.caption ||
                   "";

      if (!text) {
        if (msg.message.imageMessage) text = "📷 Foto";
        else if (msg.message.videoMessage) text = "🎥 Vídeo";
        else if (msg.message.audioMessage) text = "🎵 Áudio";
        else if (msg.message.documentMessage) text = "📄 Documento";
        else if (msg.message.stickerMessage) text = "🎨 Sticker";
      }

      if (!text) return;

      const pushName = msg.pushName || "";
      const contactId = await this.getOrCreateContact(userId, jid, pushName);
      
      const { data: existingMsg } = await supabaseAdmin
        .from("messages")
        .select("id")
        .eq("user_id", userId)
        .eq("msg_id", msg.key.id)
        .maybeSingle();

      if (!existingMsg) {
        await supabaseAdmin.from("messages").insert({
          user_id: userId,
          contact_id: contactId,
          text: text,
          type: msg.key.fromMe ? "outbound" : "inbound",
          timestamp: new Date((msg.messageTimestamp as number) * 1000).toISOString(),
          msg_id: msg.key.id,
        });
      }

      const msgDate = new Date((msg.messageTimestamp as number) * 1000);
      const now = new Date();
      if (now.getTime() - msgDate.getTime() < 7 * 24 * 60 * 60 * 1000) {
        await supabaseAdmin
          .from("contacts")
          .update({
            last_message_at: msgDate.toISOString(),
            last_message_text: text.substring(0, 100)
          })
          .eq("id", contactId);
      }
    } catch (err) {
      console.error("Sync message error:", err);
    }
  }

  private async syncContact(userId: string, contact: BaileysContact) {
    try {
      const jid = contact.id;
      if (!jid || jid.includes("@g.us")) return;

      const phone = jid.split("@")[0];
      const name = contact.notify || contact.name || phone;

      const { data: existingContact } = await supabaseAdmin
        .from("contacts")
        .select("id, tags")
        .eq("user_id", userId)
        .eq("phone", phone)
        .maybeSingle();

      if (!existingContact) {
        await supabaseAdmin.from("contacts").insert({
          user_id: userId,
          name,
          phone,
          tags: ["WhatsApp"],
          created_at: new Date().toISOString(),
        });
      } else {
        const currentTags = Array.isArray(existingContact.tags) ? existingContact.tags : [];
        const updatedTags = Array.from(new Set([...currentTags, "WhatsApp"]));
        
        await supabaseAdmin
          .from("contacts")
          .update({ 
            name: name !== phone ? name : undefined,
            tags: updatedTags
          })
          .eq("id", existingContact.id);
      }
    } catch (err) {
      console.error("Sync contact error:", err);
    }
  }

  private async getOrCreateContact(userId: string, jid: string, pushName?: string): Promise<string> {
    try {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(userId)) return "unknown";

      const phone = jid.split("@")[0];
      const { data: existingContact } = await supabaseAdmin
        .from("contacts")
        .select("id, name")
        .eq("user_id", userId)
        .eq("phone", phone)
        .maybeSingle();

      if (existingContact) {
        if (pushName && (existingContact.name === phone || !existingContact.name)) {
          await supabaseAdmin
            .from("contacts")
            .update({ name: pushName })
            .eq("id", existingContact.id);
        }
        return existingContact.id;
      }

      const { data: newContact, error } = await supabaseAdmin
        .from("contacts")
        .insert({
          user_id: userId,
          name: pushName || phone,
          phone,
          tags: ["WhatsApp"],
          created_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (error) throw error;
      return newContact.id;
    } catch (err) {
      console.error("Get or create contact error:", err);
      return "unknown";
    }
  }

  getSession(userId: string) {
    return this.sessions.get(userId);
  }

  getMe(userId: string) {
    const session = this.sessions.get(userId);
    return session?.socket?.user;
  }

  async ensureConnection(userId: string) {
    let session = this.sessions.get(userId);
    if (!session || session.status !== "connected") {
      await this.createSession(userId);
      let attempts = 0;
      while (attempts < 20) {
        session = this.sessions.get(userId);
        if (session?.status === "connected") break;
        await new Promise(resolve => setTimeout(resolve, 500));
        attempts++;
      }
    }
    return this.sessions.get(userId);
  }

  async sendMessage(userId: string, jid: string, text: string, mediaUrl?: string, mediaType?: string, duration?: number) {
    const session = await this.ensureConnection(userId);
    if (!session || session.status !== "connected") {
      throw new Error("WhatsApp session not connected.");
    }

    if (mediaUrl && mediaType) {
      if (mediaType === 'image') {
        return await session.socket.sendMessage(jid, { image: { url: mediaUrl }, caption: text });
      } else if (mediaType === 'video') {
        return await session.socket.sendMessage(jid, { video: { url: mediaUrl }, caption: text });
      } else if (mediaType === 'audio') {
        return await session.socket.sendMessage(jid, { audio: { url: mediaUrl }, mimetype: 'audio/mp4', ptt: true, seconds: duration });
      } else if (mediaType === 'document') {
        return await session.socket.sendMessage(jid, { document: { url: mediaUrl }, mimetype: 'application/pdf', fileName: 'documento.pdf', caption: text });
      }
    }

    return await session.socket.sendMessage(jid, { text });
  }

  async getGroups(userId: string) {
    const session = await this.ensureConnection(userId);
    if (!session || session.status !== "connected") throw new Error("WhatsApp não conectado");
    return await session.socket.groupFetchAllParticipating();
  }

  async getGroupMetadata(userId: string, jid: string) {
    const session = await this.ensureConnection(userId);
    if (!session || session.status !== "connected") throw new Error("WhatsApp não conectado");
    return await session.socket.groupMetadata(jid);
  }

  async updateGroupParticipants(userId: string, jid: string, participants: string[], action: "add" | "remove" | "promote" | "demote") {
    const session = await this.ensureConnection(userId);
    if (!session || session.status !== "connected") throw new Error("WhatsApp não conectado");
    return await session.socket.groupParticipantsUpdate(jid, participants, action);
  }

  async updateGroupSubject(userId: string, jid: string, subject: string) {
    const session = await this.ensureConnection(userId);
    if (!session || session.status !== "connected") throw new Error("WhatsApp não conectado");
    return await session.socket.groupUpdateSubject(jid, subject);
  }

  async leaveGroup(userId: string, jid: string) {
    const session = await this.ensureConnection(userId);
    if (!session || session.status !== "connected") throw new Error("WhatsApp não conectado");
    return await session.socket.groupLeave(jid);
  }

  async pauseSession(userId: string) {
    const session = this.sessions.get(userId);
    if (session) {
      try {
        session.socket.end(undefined);
      } catch (e) {}
      this.sessions.delete(userId);
    }
    return { success: true };
  }

  async reconnectAllSessions() {
    console.log("[WhatsApp] Reconnecting all sessions from database...");
    const { data: sessions } = await supabaseAdmin
      .from("whatsapp_sessions")
      .select("user_id");

    if (sessions) {
      for (const s of sessions) {
        console.log(`[WhatsApp] Auto-reconnecting session for user ${s.user_id}`);
        this.createSession(s.user_id).catch(err => {
          console.error(`Failed to reconnect session for ${s.user_id}:`, err);
        });
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2s delay between sessions
      }
    }
  }

  async sendMenu(userId: string, jid: string, menu: any) {
    const session = await this.ensureConnection(userId);
    if (!session || session.status !== "connected") throw new Error("WhatsApp não conectado");

    const { name, description, items } = menu;
    let text = `*${name}*\n\n${description}\n\n`;
    
    if (items && Array.isArray(items)) {
      items.forEach((item: any, index: number) => {
        text += `${index + 1}. ${item.label}\n`;
      });
    }

    text += `\nDigite o número da opção desejada.`;
    return await session.socket.sendMessage(jid, { text });
  }

  async deleteSession(userId: string) {
    const session = this.sessions.get(userId);
    if (session) {
      try {
        session.socket.end(undefined);
      } catch (e) {}
      this.sessions.delete(userId);
    }
    await supabaseAdmin.from("whatsapp_sessions").delete().eq("user_id", userId);
  }

  getSessionStatus(userId: string) {
    const session = this.sessions.get(userId);
    return session?.status || "disconnected";
  }
}

export const whatsappManager = new WhatsAppManager();
