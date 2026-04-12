import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  Contact as BaileysContact,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import { supabaseAdmin } from "./supabaseAdmin.ts";
import { handleIncomingMessage } from "./automationManager.ts";
import { handleAgentMessage } from "./agentManager.ts";
import { useSupabaseAuthState, clearSupabaseAuthCache } from "./lib/supabaseAuthState.ts";
import axios from "axios";
import fs from "fs";
import path from "path";
import os from "os";
import { convertToOpus } from "./utils/audioConverter.ts";

const logger = pino({ level: "silent" });

export class WhatsAppManager {
  private sessions: Map<string, { socket: any; status: string; qr?: string; createdAt?: number }> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private restartRequiredAttempts: Map<string, number> = new Map();
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
      console.log(`[WhatsApp] createSession called for ${userId}`);
      const existingSession = this.sessions.get(userId);
      if (existingSession) {
        // If it's already connected, just return
        if (existingSession.status === "connected") {
          console.log(`[WhatsApp] Session already connected for ${userId}`);
          return existingSession.socket;
        }
        
        // If it's stuck in connecting/qr for more than 2 minutes, force a new one
        const sessionAge = Date.now() - ((existingSession as any).createdAt || 0);
        if (sessionAge > 120000) {
          console.log(`[WhatsApp] Forcing new session for ${userId} (stuck for ${Math.round(sessionAge/1000)}s)`);
          try { existingSession.socket.end(undefined); } catch (e) {}
          this.sessions.delete(userId);
        } else {
          console.log(`[WhatsApp] Session already exists for ${userId} with status: ${existingSession.status}`);
          return existingSession.socket;
        }
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
        const versionPromise = fetchLatestBaileysVersion();
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout fetching version")), 5000));
        const v = await Promise.race([versionPromise, timeoutPromise]) as any;
        version = v.version;
        console.log(`[WhatsApp] Using Baileys version: ${version.join('.')}`);
      } catch (err) {
        console.warn(`[WhatsApp] Failed to fetch Baileys version, using fallback:`, err);
        version = [2, 3000, 1017531287];
      }

      const socket = makeWASocket({
        version,
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "120.0.6099.129"],
        auth: state,
        logger,
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 15000,
        retryRequestDelayMs: 5000,
        shouldSyncHistoryMessage: () => false,
      });

      this.sessions.set(userId, {
        socket,
        status: "connecting",
        createdAt: Date.now(),
      } as any);

      const watchdog = setTimeout(async () => {
        const session = this.sessions.get(userId);
        if (session && session.status === "connecting") {
          console.warn(`[WhatsApp] Session for ${userId} stuck in connecting for 45s. Resetting...`);
          await this.log(userId, "warn", "A conexão está demorando mais que o esperado. Reiniciando...");
          try { socket.end(undefined); } catch (e) {}
          this.sessions.delete(userId);
          onUpdate?.("disconnected");
        }
      }, 45000);

      socket.ev.on("creds.update", async () => {
        console.log(`[WhatsApp] Creds updated for ${userId}`);
        await saveCreds();
      });

      socket.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;
        const session = this.sessions.get(userId);
        if (!session) return;

        console.log(`[WhatsApp] Connection update for ${userId}: ${connection || "no-connection-change"}, status=${session.status}, hasQR: ${!!qr}`);

        if (qr) {
          clearTimeout(watchdog);
          session.qr = qr;
          session.status = "qr";
          onUpdate?.("qr", qr);
          await this.log(userId, "info", "Novo QR Code gerado.");
        }

        if (connection === "open") {
          clearTimeout(watchdog);
          session.status = "connected";
          session.qr = undefined;
          this.reconnectAttempts.delete(userId);
          this.restartRequiredAttempts.delete(userId);
          console.log(`[WhatsApp] Session ${userId} is now OPEN`);
          await this.log(userId, "success", "WhatsApp conectado com sucesso!");
          onUpdate?.("connected");
        }

        if (connection === "close") {
          const boomErr = lastDisconnect?.error as Boom | undefined;
          const statusCode = boomErr?.output?.statusCode;
          const reason = boomErr?.message || "Unknown reason";
          
          console.log(`[WhatsApp] Connection closed for ${userId}. Status: ${statusCode}, Reason: ${reason}`);
          
          // Clean up current socket
          try { socket.end(undefined); } catch (e) {}
          this.sessions.delete(userId);
          
          // Reconnect if not logged out
          const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;
          const isRestartRequired = statusCode === DisconnectReason.restartRequired || statusCode === 515;
          
          if (isRestartRequired) {
            const restartAttempts = (this.restartRequiredAttempts.get(userId) || 0) + 1;
            this.restartRequiredAttempts.set(userId, restartAttempts);
            
            console.log(`[WhatsApp] Restart required for ${userId} (Attempt ${restartAttempts}). Reconnecting in 3s...`);
            
            if (restartAttempts > 5) {
                console.log(`[WhatsApp] Too many 515 errors for ${userId}. Clearing session.`);
                await supabaseAdmin.from("whatsapp_sessions").delete().eq("user_id", userId);
                clearSupabaseAuthCache(userId);
                this.restartRequiredAttempts.delete(userId);
                await this.log(userId, "error", "Sessão corrompida. Por favor, leia o QR Code novamente.");
                onUpdate?.("disconnected");
            } else {
                setTimeout(() => this.createSession(userId, onUpdate), 3000);
            }
          } else if (!isLoggedOut && attempts < this.maxReconnectAttempts) {
            this.reconnectAttempts.set(userId, attempts + 1);
            const delayTime = Math.min(5000 * (attempts + 1), 30000);
            console.log(`[WhatsApp] Reconnecting session for ${userId} in ${delayTime/1000}s...`);
            setTimeout(() => this.createSession(userId, onUpdate), delayTime);
          } else {
            if (isLoggedOut) {
              console.log(`[WhatsApp] Logged out for ${userId}. Clearing session.`);
              await supabaseAdmin.from("whatsapp_sessions").delete().eq("user_id", userId);
              clearSupabaseAuthCache(userId);
              await this.log(userId, "warn", "Sessão encerrada ou expirada.");
            } else {
              console.log(`[WhatsApp] Max attempts reached or fatal error for ${userId}.`);
              await this.log(userId, "error", "Falha na conexão. Por favor, tente reconectar manualmente.");
            }
            onUpdate?.("disconnected");
          }
        }
      });

      // Sync Logic
      socket.ev.on("messaging-history.set", async ({ contacts, chats, messages, isLatest }) => {
        console.log(`[WhatsApp] messaging-history.set for ${userId}: contacts=${contacts?.length}, chats=${chats?.length}, messages=${messages?.length}`);
        
        if (contacts) {
          for (const contact of contacts) {
            if (contact.id && !contact.id.includes("@g.us")) {
              await this.syncContact(userId, contact);
            }
          }
        }

        if (chats) {
          for (const chat of chats) {
            if (chat.id && !chat.id.includes("@g.us")) {
              // Create contact if not exists for the chat
              await this.getOrCreateContact(userId, chat.id, chat.name || undefined);
            }
          }
        }

        if (messages) {
          for (const msg of messages) {
            await this.syncMessage(userId, msg);
          }
        }
      });

      socket.ev.on("contacts.upsert", async (contacts) => {
        console.log(`[WhatsApp] contacts.upsert for ${userId}: count=${contacts.length}`);
        for (const contact of contacts) {
          if (contact.id && !contact.id.includes("@g.us")) {
            await this.syncContact(userId, contact);
          }
        }
      });

      socket.ev.on("contacts.update", async (updates) => {
        for (const update of updates) {
          if (update.id && !update.id.includes("@g.us")) {
            await this.syncContact(userId, update as BaileysContact);
          }
        }
      });

      socket.ev.on("messages.upsert", async ({ messages, type }) => {
        console.log(`[WhatsApp] messages.upsert triggered for ${userId}, type: ${type}, count: ${messages.length}`);
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
            
            // Ignora status de outras pessoas para não poluir o log nem ativar a automação/IA
            if (jid === "status@broadcast" && !isMe) {
              continue;
            }

            console.log(`[WhatsApp] Message from ${jid} (isMe: ${isMe}): "${text}"`);

            await this.syncMessage(userId, msg);

            if (!isMe && text) {
              console.log(`[WhatsApp] Passing message to handlers for ${userId}`);
              const handledByAutomation = await handleIncomingMessage(this, userId, jid, text, !!(msg.message?.buttonsResponseMessage || msg.message?.templateButtonReplyMessage || msg.message?.interactiveResponseMessage));
              if (!handledByAutomation) {
                await handleAgentMessage(this, userId, jid, text);
              }
            }
          } catch (err) {
            console.error("Error processing message:", err);
          }
        }
      });

      return socket;
    } catch (err: any) {
      console.error(`[WhatsApp] Failed to create session for ${userId}:`, err);
      await this.log(userId, "error", `Erro ao iniciar sessão: ${err.message}`);
      onUpdate?.("disconnected");
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
        let mediaUrl = "";
        let mediaType = "";
        let mediaMimetype = "";
        let mediaFilename = "";

        if (msg.message.imageMessage) {
          mediaType = "image";
          mediaMimetype = msg.message.imageMessage.mimetype || "image/jpeg";
          mediaFilename = "image.jpg";
        } else if (msg.message.videoMessage) {
          mediaType = "video";
          mediaMimetype = msg.message.videoMessage.mimetype || "video/mp4";
          mediaFilename = "video.mp4";
        } else if (msg.message.audioMessage) {
          mediaType = "audio";
          mediaMimetype = msg.message.audioMessage.mimetype || "audio/ogg";
          mediaFilename = "audio.ogg";
        } else if (msg.message.documentMessage) {
          mediaType = "document";
          mediaMimetype = msg.message.documentMessage.mimetype || "application/pdf";
          mediaFilename = msg.message.documentMessage.fileName || "document";
        }

        await supabaseAdmin.from("messages").insert({
          user_id: userId,
          contact_id: contactId,
          text: text,
          type: msg.key.fromMe ? "outbound" : "inbound",
          timestamp: new Date((msg.messageTimestamp as number) * 1000).toISOString(),
          msg_id: msg.key.id,
          media_url: mediaUrl,
          media_type: mediaType,
          media_mimetype: mediaMimetype,
          media_filename: mediaFilename
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
      const name = contact.notify || contact.name || contact.verifiedName || phone;
      console.log(`[WhatsApp] Syncing contact for user ${userId}: ${phone} (${name})`);

      const { data: existingContact } = await supabaseAdmin
        .from("contacts")
        .select("id, tags, name")
        .eq("user_id", userId)
        .eq("phone", phone)
        .maybeSingle();

      if (!existingContact) {
        console.log(`[WhatsApp] Creating new contact for user ${userId}: ${phone}`);
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
        
        // Update name only if it's better than what we have (not just the phone number)
        const shouldUpdateName = name && name !== phone && (!existingContact.name || existingContact.name === phone);
        
        if (shouldUpdateName) {
          console.log(`[WhatsApp] Updating name for user ${userId}, contact ${phone}: ${name}`);
        }

        await supabaseAdmin
          .from("contacts")
          .update({ 
            name: shouldUpdateName ? name : existingContact.name,
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

  async sendMessage(userId: string, jid: string, text: string, mediaUrl?: string, mediaType?: string, duration?: number, mimetype?: string, fileName?: string) {
    const session = await this.ensureConnection(userId);
    if (!session || session.status !== "connected") {
      throw new Error("WhatsApp session not connected.");
    }

    const isStatus = jid === "status@broadcast";
    let result;
    const options: any = {};

    if (isStatus) {
      options.backgroundColor = "#333333";
      options.font = 1;
      
      // Fetch contacts to define who can see the status
      const { data: contacts } = await supabaseAdmin
        .from("contacts")
        .select("phone")
        .eq("user_id", userId)
        .not("phone", "is", null);
        
      const jidList = (contacts || []).map((c: any) => `${c.phone}@s.whatsapp.net`);
      const myJid = session.socket.user?.id ? session.socket.user.id.split(':')[0] + '@s.whatsapp.net' : '';
      if (myJid && !jidList.includes(myJid)) {
          jidList.push(myJid); // É importante enviar para o seu próprio número para aparecer no aparelho
      }
      options.statusJidList = jidList;
    }

    if (mediaUrl && mediaType) {
      if (mediaType === 'image') {
        result = await session.socket.sendMessage(jid, { 
          image: { url: mediaUrl }, 
          caption: text,
        }, options);
      } else if (mediaType === 'video') {
        result = await session.socket.sendMessage(jid, { 
          video: { url: mediaUrl }, 
          caption: text,
        }, options);
      } else if (mediaType === 'audio') {
        let audioPath = mediaUrl;
        let tempInputPath = "";
        let tempOutputPath = "";

        // If it's a URL or local path, convert to OGG/Opus for PTT
        if (mediaUrl) {
          try {
            if (mediaUrl.startsWith("http")) {
              tempInputPath = path.join(os.tmpdir(), `input_${Date.now()}`);
              const response = await axios({
                method: 'get',
                url: mediaUrl,
                responseType: 'stream'
              });
              const writer = fs.createWriteStream(tempInputPath);
              response.data.pipe(writer);
              await new Promise<void>((resolve, reject) => {
                writer.on('finish', () => resolve());
                writer.on('error', (err) => reject(err));
              });
              tempOutputPath = await convertToOpus(tempInputPath);
            } else if (fs.existsSync(mediaUrl)) {
              // It's a local path
              tempOutputPath = await convertToOpus(mediaUrl);
            }

            if (tempOutputPath) {
              audioPath = tempOutputPath;
              console.log(`[WhatsAppManager] Audio converted for PTT: ${audioPath}`);
            }
          } catch (err) {
            console.error("[WhatsAppManager] Error converting audio, sending original:", err);
            // Fallback to original if conversion fails
            audioPath = mediaUrl;
          }
        }

        result = await session.socket.sendMessage(jid, { 
          audio: audioPath.startsWith("http") ? { url: audioPath } : fs.readFileSync(audioPath), 
          mimetype: 'audio/ogg; codecs=opus', 
          ptt: true, 
          seconds: duration 
        }, options);

        // Cleanup temp files
        if (tempInputPath && fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
        if (tempOutputPath && fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
      } else if (mediaType === 'document') {
        result = await session.socket.sendMessage(jid, { document: { url: mediaUrl }, mimetype: mimetype || 'application/pdf', fileName: fileName || 'documento', caption: text }, options);
      }
    } else {
      result = await session.socket.sendMessage(jid, { text }, options);
    }

    // Sync the sent message back to DB if it's not a status
    if (result && !isStatus) {
      await this.syncMessage(userId, {
        key: {
          remoteJid: jid,
          fromMe: true,
          id: result.key.id
        },
        message: {
          conversation: text
        },
        messageTimestamp: Math.floor(Date.now() / 1000),
        pushName: session.socket.user?.name || "Me"
      });
    }

    return result;
  }

  async sendPresenceUpdate(userId: string, jid: string, presence: "composing" | "recording" | "paused") {
    const session = this.sessions.get(userId);
    if (!session || session.status !== "connected") return;
    try {
      await session.socket.sendPresenceUpdate(presence, jid);
    } catch (e) {
      console.error(`Failed to send presence update to ${jid}:`, e);
    }
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

    const { name, description, message, options, items } = menu;
    const menuText = message || description || "Escolha uma opção:";
    const menuOptions = options || items || [];
    
    let text = `*${name}*\n\n${menuText}\n\n`;

    if (Array.isArray(menuOptions)) {
      menuOptions.forEach((item: any, index: number) => {
        text += `${item.key || (index + 1)}. ${item.label}\n`;
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
    clearSupabaseAuthCache(userId);
  }

  getSessionStatus(userId: string) {
    const session = this.sessions.get(userId);
    return session?.status || "disconnected";
  }
}

export const whatsappManager = new WhatsAppManager();
