import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState, 
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WASocket,
  Contact as BaileysContact,
  Browsers
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import path from "path";
import fs from "fs";
import QRCode from "qrcode";
import { supabaseAdmin } from "./supabaseAdmin";
import { handleIncomingMessage } from "./automationManager";
import { handleAgentMessage } from "./agentManager";

const logger = pino({ level: "silent" });

interface Session {
  socket: WASocket;
  qr?: string;
  pairingCode?: string;
  status: "connecting" | "qr" | "pairing" | "connected" | "disconnected";
}

class WhatsAppManager {
  private sessions: Map<string, Session> = new Map();

  async reconnectAllSessions() {
    const sessionsDir = path.join(process.cwd(), "sessions");
    if (!fs.existsSync(sessionsDir)) return;

    const userDirs = fs.readdirSync(sessionsDir);
    console.log(`Found ${userDirs.length} potential sessions to reconnect.`);

    for (const userId of userDirs) {
      const userSessionDir = path.join(sessionsDir, userId);
      if (fs.statSync(userSessionDir).isDirectory()) {
        const isPaused = fs.existsSync(path.join(userSessionDir, "paused.txt"));
        if (isPaused) {
          console.log(`Skipping paused session for user: ${userId}`);
          continue;
        }
        console.log(`Attempting to reconnect session for user: ${userId}`);
        try {
          await this.createSession(userId);
        } catch (err) {
          console.error(`Failed to reconnect session for user ${userId}:`, err);
        }
      }
    }
  }

  public async log(userId: string, level: string, message: string, details?: any) {
    try {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [LOG] [${level.toUpperCase()}] [${userId}] ${message}`, details || "");
      
      if (!supabaseAdmin) {
        console.warn("Supabase Admin not initialized, skipping database log.");
        return;
      }

      // Skip logging to Supabase if userId is not a valid UUID (e.g., 'guest-user')
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(userId)) {
        return;
      }

      // Attempt to log to Supabase, but don't fail if table doesn't exist yet
      const { error } = await supabaseAdmin.from("logs").insert({
        user_id: userId,
        level,
        message,
        details: details ? JSON.stringify(details) : null,
        created_at: timestamp
      });
      
      if (error) {
        console.error("Error inserting log into Supabase:", error.message);
      }
    } catch (err) {
      // Silently fail if table doesn't exist or other error
      console.error("Log function error:", err);
    }
  }

  public getActiveSessionsCount(userId: string): number {
    // Currently, the system only supports 1 session per user ID.
    // If we expand to multiple sessions, this would count them.
    const session = this.sessions.get(userId);
    return session && session.status === "connected" ? 1 : 0;
  }

  async createSession(userId: string, phoneNumber?: string, onUpdate?: (status: string, data?: string) => void) {
    try {
      const existingSession = this.sessions.get(userId);
      if (existingSession) {
        if (existingSession.status === "connected" || existingSession.status === "connecting" || existingSession.status === "qr" || existingSession.status === "pairing") {
          console.log(`Session already exists for ${userId} with status: ${existingSession.status}`);
          return existingSession.socket;
        }
      }

    console.log(`Creating new WhatsApp session for ${userId}`);
    await this.log(userId, "info", "Iniciando nova sessão WhatsApp...");
    const sessionDir = path.join(process.cwd(), "sessions", userId);
    try {
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }
      fs.accessSync(sessionDir, fs.constants.W_OK);
      console.log(`Session directory is writable: ${sessionDir}`);
      
      // Remove paused state if user is manually connecting
      const pausedFile = path.join(sessionDir, "paused.txt");
      if (fs.existsSync(pausedFile)) {
        fs.unlinkSync(pausedFile);
      }
    } catch (err) {
      console.error(`Session directory error for ${userId}:`, err);
      throw new Error(`Cannot write to session directory: ${sessionDir}`);
    }

    let state, saveCreds;
    try {
      const authState = await useMultiFileAuthState(sessionDir);
      state = authState.state;
      saveCreds = authState.saveCreds;
    } catch (err) {
      console.error(`Corrupted session directory for ${userId}, clearing it:`, err);
      fs.rmSync(sessionDir, { recursive: true, force: true });
      const authState = await useMultiFileAuthState(sessionDir);
      state = authState.state;
      saveCreds = authState.saveCreds;
    }
    
    let version;
    try {
      const v = await fetchLatestBaileysVersion();
      version = v.version;
      console.log(`Using Baileys version: ${version.join(".")}`);
    } catch (err) {
      console.warn("Failed to fetch Baileys version, using default:", err);
      version = [2, 3000, 1015901307]; // Fallback version
    }

    const socket = makeWASocket({
      version,
      printQRInTerminal: false,
      browser: Browsers.ubuntu("Chrome"),
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
    });

    this.sessions.set(userId, { socket, status: "connecting" });

    if (phoneNumber && !state.creds.registered) {
      setTimeout(async () => {
        try {
          const code = await socket.requestPairingCode(phoneNumber);
          console.log(`Pairing code for ${userId}: ${code}`);
          const session = this.sessions.get(userId);
          if (session) {
            session.pairingCode = code;
            session.status = "pairing";
            onUpdate?.("pairing", code);
          }
        } catch (err) {
          console.error(`Failed to request pairing code for ${userId}:`, err);
          this.sessions.delete(userId);
          onUpdate?.("disconnected");
        }
      }, 3000);
    }

    socket.ev.on("creds.update", saveCreds);

    socket.ev.on("connection.update", async (update) => {
      try {
        const { connection, lastDisconnect, qr } = update;
        const session = this.sessions.get(userId);
        if (!session) return;

        if (qr) {
          try {
            const qrDataUrl = await QRCode.toDataURL(qr);
            session.qr = qrDataUrl;
            session.status = "qr";
            onUpdate?.("qr", qrDataUrl);
            await this.log(userId, "info", "QR Code gerado.");
          } catch (err) {
            console.error(`Failed to generate QR Data URL for ${userId}:`, err);
          }
        }

        if (connection === "open") {
          session.status = "connected";
          session.qr = undefined;
          await this.log(userId, "success", "WhatsApp conectado!");
          onUpdate?.("connected");
        }

        if (connection === "close") {
          const boomErr = lastDisconnect?.error as Boom;
          const statusCode = boomErr?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          
          console.log(`[WhatsApp] Connection closed for ${userId}. Reconnecting: ${shouldReconnect}`);
          session.status = "disconnected";
          onUpdate?.("disconnected");

          // Reset session safely
          this.sessions.delete(userId);

          if (shouldReconnect) {
            setTimeout(() => {
              console.log(`[WhatsApp] Auto-reconnecting for ${userId}...`);
              this.createSession(userId, phoneNumber, onUpdate);
            }, 3000);
          }
        }
      } catch (err) {
        console.error(`Error in connection.update for ${userId}:`, err);
      }
    });

    // Sync Contacts - DISABLED to prevent database pollution
    /*
    socket.ev.on("contacts.upsert", async (contacts) => {
      console.log(`Received ${contacts.length} contacts for ${userId}`);
      for (const contact of contacts) {
        await this.syncContact(userId, contact);
      }
    });
    */

    socket.ev.on("messaging-history.set", async ({ contacts, messages }) => {
      console.log(`Received history for ${userId}: ${contacts?.length || 0} contacts, ${messages?.length || 0} messages`);
      /*
      if (contacts) {
        for (const contact of contacts) {
          await this.syncContact(userId, contact);
        }
      }
      */
      if (messages) {
        for (const msg of messages) {
          await this.syncMessage(userId, msg);
        }
      }
    });

      // Sync Messages
      socket.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify" && type !== "append") return;

        for (const msg of messages) {
          const text = msg.message?.conversation || 
                       msg.message?.extendedTextMessage?.text || 
                       msg.message?.imageMessage?.caption ||
                       msg.message?.videoMessage?.caption ||
                       msg.message?.buttonsResponseMessage?.selectedButtonId ||
                       "";
          
          if (!msg.key.fromMe && text) {
            console.log(`Processing incoming message from ${msg.key.remoteJid} for automation: "${text}"`);
            const isButton = !!msg.message?.buttonsResponseMessage?.selectedButtonId;
            const triggered = await handleIncomingMessage(this, userId, msg.key.remoteJid!, text, isButton);
            
            if (!triggered) {
              await handleAgentMessage(this, userId, msg.key.remoteJid!, text);
            }
          }
          
          await this.syncMessage(userId, msg);
        }
      });

      return socket;
    } catch (error: any) {
      console.error(`Failed to create session for ${userId}:`, error);
      onUpdate?.("disconnected");
      throw error;
    }
  }

  private async syncMessage(userId: string, msg: any) {
    try {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(userId)) return;

      if (!msg.message) return;
      
      const jid = msg.key.remoteJid;
      if (!jid) return;

      // Skip status updates
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

      const contactId = await this.getOrCreateContact(userId, jid);
      
      // Check if message already exists
      const { data: existingMsg } = await supabaseAdmin
        .from("messages")
        .select("id")
        .eq("user_id", userId)
        .eq("msg_id", msg.key.id)
        .maybeSingle();

      if (!existingMsg) {
        console.log(`Syncing new message ${msg.key.id} for user ${userId} from ${jid}`);
        await supabaseAdmin.from("messages").insert({
          user_id: userId,
          contact_id: contactId,
          text: text || (msg.message.imageMessage ? "[Imagem]" : "[Vídeo]"),
          type: msg.key.fromMe ? "outbound" : "inbound",
          timestamp: new Date((msg.messageTimestamp as number) * 1000).toISOString(),
          msg_id: msg.key.id,
        });
      }
    } catch (err) {
      console.error("Sync message error:", err);
    }
  }

  private async syncContact(userId: string, contact: BaileysContact) {
    try {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(userId)) return;

      const jid = contact.id;
      if (!jid || jid.includes("@g.us")) return; // Skip groups for now

      const phone = jid.split("@")[0];
      const name = contact.notify || contact.name || phone;

      const { data: existingContact } = await supabaseAdmin
        .from("contacts")
        .select("id, tags")
        .eq("user_id", userId)
        .eq("phone", phone)
        .maybeSingle();

      if (!existingContact) {
        // Enforce max_contacts limit
        const { data: sub } = await supabaseAdmin
          .from("subscriptions")
          .select("plan_id")
          .eq("user_id", userId)
          .single();

        if (sub?.plan_id) {
          const { data: planData } = await supabaseAdmin
            .from("plans")
            .select("max_contacts")
            .eq("id", sub.plan_id)
            .single();

          if (planData) {
            const { count } = await supabaseAdmin
              .from("contacts")
              .select("*", { count: 'exact', head: true })
              .eq("user_id", userId);

            if (count !== null && count >= planData.max_contacts) {
              console.log(`[WhatsApp] User ${userId} reached max contacts limit (${count}/${planData.max_contacts}). Skipping contact sync.`);
              return;
            }
          }
        }

        await supabaseAdmin.from("contacts").insert({
          user_id: userId,
          name,
          phone,
          tags: ["WhatsApp"],
          created_at: new Date().toISOString(),
        });
      } else {
        // Ensure "WhatsApp" tag is present even on update
        const currentTags = Array.isArray(existingContact.tags) ? existingContact.tags : [];
        const updatedTags = Array.from(new Set([...currentTags, "WhatsApp"]));
        
        await supabaseAdmin
          .from("contacts")
          .update({ 
            name,
            tags: updatedTags
          })
          .eq("id", existingContact.id);
      }
    } catch (err) {
      console.error("Sync contact error:", err);
    }
  }

  private async getOrCreateContact(userId: string, jid: string): Promise<string> {
    try {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(userId)) return "unknown";

      const phone = jid.split("@")[0];
      const { data: existingContact } = await supabaseAdmin
        .from("contacts")
        .select("id")
        .eq("user_id", userId)
        .eq("phone", phone)
        .maybeSingle();

      if (existingContact) {
        return existingContact.id;
      }

      const { data: newContact, error } = await supabaseAdmin
        .from("contacts")
        .insert({
          user_id: userId,
          name: phone,
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

  async sendMessage(userId: string, jid: string, text: string, mediaUrl?: string, mediaType?: string) {
    let session = this.sessions.get(userId);
    
    // Attempt auto-reconnect if session files exist but session is not in memory or not connected
    if (!session || session.status !== "connected") {
      const sessionDir = path.join(process.cwd(), "sessions", userId);
      if (fs.existsSync(sessionDir)) {
        const isPaused = fs.existsSync(path.join(sessionDir, "paused.txt"));
        if (!isPaused) {
          console.log(`Auto-reconnecting session for user ${userId} before sending message.`);
          await this.createSession(userId);
          
          // Wait up to 10 seconds for connection
          let attempts = 0;
          while (attempts < 20) {
            session = this.sessions.get(userId);
            if (session?.status === "connected") break;
            await new Promise(resolve => setTimeout(resolve, 500));
            attempts++;
          }
        }
      }
    }

    if (!session || session.status !== "connected") {
      await this.log(userId, "error", "Falha ao enviar mensagem: Sessão não conectada.");
      throw new Error("WhatsApp session not connected. Please go to the WhatsApp tab and reconnect.");
    }
    
    if (mediaUrl && mediaType) {
      await this.log(userId, "info", `Enviando mídia (${mediaType}) para ${jid}`);
      try {
        if (mediaType === 'image') {
          return await session.socket.sendMessage(jid, { image: { url: mediaUrl }, caption: text });
        } else if (mediaType === 'audio') {
          return await session.socket.sendMessage(jid, { audio: { url: mediaUrl }, mimetype: 'audio/ogg', ptt: true });
        } else if (mediaType === 'document') {
          // Extract filename from URL or use a default
          const fileName = mediaUrl.split('/').pop() || 'documento';
          return await session.socket.sendMessage(jid, { document: { url: mediaUrl }, mimetype: 'application/pdf', fileName, caption: text });
        }
      } catch (err) {
        console.error("Error sending media message:", err);
        await this.log(userId, "error", `Falha ao enviar mídia para ${jid}`);
        // Fallback to text if media fails
        return await session.socket.sendMessage(jid, { text });
      }
    }

    await this.log(userId, "info", `Enviando mensagem para ${jid}: "${text.substring(0, 50)}..."`);
    return await session.socket.sendMessage(jid, { text });
  }

  async sendButtonsMessage(userId: string, jid: string, text: string, buttons: { id: string, label: string }[]) {
    let session = this.sessions.get(userId);
    
    // Attempt auto-reconnect if session files exist but session is not in memory or not connected
    if (!session || session.status !== "connected") {
      const sessionDir = path.join(process.cwd(), "sessions", userId);
      if (fs.existsSync(sessionDir)) {
        const isPaused = fs.existsSync(path.join(sessionDir, "paused.txt"));
        if (!isPaused) {
          console.log(`Auto-reconnecting session for user ${userId} before sending buttons.`);
          await this.createSession(userId);
          
          // Wait up to 10 seconds for connection
          let attempts = 0;
          while (attempts < 20) {
            session = this.sessions.get(userId);
            if (session?.status === "connected") break;
            await new Promise(resolve => setTimeout(resolve, 500));
            attempts++;
          }
        }
      }
    }

    if (!session || session.status !== "connected") {
      await this.log(userId, "error", "Falha ao enviar botões: Sessão não conectada.");
      throw new Error("WhatsApp session not connected. Please go to the WhatsApp tab and reconnect.");
    }

    try {
      // Modern Baileys Buttons (Interactive Message - Native Flow)
      // This is the most compatible way for modern WhatsApp versions
      const buttonMessage: any = {
        viewOnceMessage: {
          message: {
            interactiveMessage: {
              header: { title: "", hasMediaAttachment: false },
              body: { text: text },
              footer: { text: "Selecione uma opção" },
              nativeFlowMessage: {
                buttons: buttons.map(b => ({
                  name: "quick_reply",
                  buttonParamsJson: JSON.stringify({
                    display_text: b.label,
                    id: b.id
                  })
                }))
              }
            }
          }
        }
      };

      await this.log(userId, "info", `Enviando botões interativos para ${jid}`);
      return await session.socket.sendMessage(jid, buttonMessage);
    } catch (err) {
      console.error("Error sending interactive buttons, falling back to list/text:", err);
      
      try {
        // Fallback 1: List Message
        const listMessage: any = {
          text: text,
          footer: "Selecione uma opção",
          title: "Menu",
          buttonText: "Ver Opções",
          sections: [
            {
              title: "Opções Disponíveis",
              rows: buttons.map(b => ({ title: b.label, rowId: b.id }))
            }
          ]
        };
        await this.log(userId, "warn", `Botões falharam, tentando List Message para ${jid}`);
        return await session.socket.sendMessage(jid, listMessage);
      } catch (listErr) {
        console.error("List message also failed, falling back to plain text:", listErr);
        
        // Fallback 2: Plain Text with numbered options
        let fallbackText = `*${text}*\n\n`;
        buttons.forEach((b, i) => {
          fallbackText += `${i + 1}. ${b.label}\n`;
        });
        fallbackText += "\n_Responda com o número ou o texto da opção._";
        
        await this.log(userId, "warn", `List Message falhou, enviando fallback de texto para ${jid}`);
        return await session.socket.sendMessage(jid, { text: fallbackText });
      }
    }
  }

  async sendPresenceUpdate(userId: string, jid: string, presence: "composing" | "recording" | "paused") {
    const session = this.sessions.get(userId);
    if (!session || session.status !== "connected") return;
    return await session.socket.sendPresenceUpdate(presence, jid);
  }

  async deleteSession(userId: string) {
    const session = this.sessions.get(userId);
    if (session) {
      try {
        session.socket.end(undefined);
      } catch (e) {}
      this.sessions.delete(userId);
    }
    
    // Clear session files if needed
    const sessionDir = path.join(process.cwd(), "sessions", userId);
    if (fs.existsSync(sessionDir)) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      } catch (e) {
        console.error(`Failed to delete session directory for ${userId}:`, e);
      }
    }
  }

  getSessionStatus(userId: string) {
    const session = this.sessions.get(userId);
    return session?.status || "disconnected";
  }

  async pauseSession(userId: string) {
    console.log(`[PAUSE] Pausing session for user ${userId}`);
    await this.log(userId, "info", "Conexão pausada pelo usuário.");
    const sessionDir = path.join(process.cwd(), "sessions", userId);
    try {
      if (!fs.existsSync(sessionDir)) {
        console.log(`[PAUSE] Creating session directory for user ${userId}`);
        fs.mkdirSync(sessionDir, { recursive: true });
      }
      const pausedFile = path.join(sessionDir, "paused.txt");
      fs.writeFileSync(pausedFile, "true");
      console.log(`[PAUSE] Wrote paused.txt to ${pausedFile}`);
    } catch (err) {
      console.error(`[PAUSE] Error writing paused.txt for user ${userId}:`, err);
    }

    const session = this.sessions.get(userId);
    if (session) {
      console.log(`[PAUSE] Ending socket for user ${userId}`);
      try {
        session.socket.end(undefined);
        if ((session.socket as any).ws) {
          (session.socket as any).ws.close();
        }
      } catch (e) {
        console.error(`[PAUSE] Error ending socket for user ${userId}:`, e);
      }
      this.sessions.delete(userId);
      console.log(`[PAUSE] Deleted session from map for user ${userId}`);
    } else {
      console.log(`[PAUSE] No active session found in map for user ${userId}`);
    }
    return { success: true };
  }
}

export const whatsappManager = new WhatsAppManager();
