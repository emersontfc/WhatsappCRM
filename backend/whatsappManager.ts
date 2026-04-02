import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState, 
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WASocket,
  Contact as BaileysContact,
  Browsers,
  generateWAMessageFromContent,
  prepareWAMessageMedia
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import path from "path";
import fs from "fs";
import { supabaseAdmin } from "./supabaseAdmin";
import { handleIncomingMessage } from "./automationManager";
import { handleAgentMessage } from "./agentManager";

const logger = pino({ level: "info" }); // Set to info to see Baileys logs for debugging crashes

interface Session {
  socket: WASocket;
  qr?: string;
  pairingCode?: string;
  status: "connecting" | "qr" | "pairing" | "connected" | "disconnected";
}

class WhatsAppManager {
  private sessions: Map<string, Session> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private activeTasks: number = 0;
  private maxConcurrentTasks: number = 10;

  async reconnectAllSessions() {
    const sessionsDir = path.join(process.cwd(), "sessions");
    if (!fs.existsSync(sessionsDir)) return;

    try {
      const userDirs = await fs.promises.readdir(sessionsDir);
      console.log(`Found ${userDirs.length} potential sessions to reconnect.`);

      for (const userId of userDirs) {
        const userSessionDir = path.join(sessionsDir, userId);
        const stats = await fs.promises.stat(userSessionDir);
        
        if (stats.isDirectory()) {
          const isPaused = fs.existsSync(path.join(userSessionDir, "paused.txt"));
          if (isPaused) {
            console.log(`Skipping paused session for user: ${userId}`);
            continue;
          }
          
          // Add a small delay between reconnections to prevent overwhelming the server
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          console.log(`Attempting to reconnect session for user: ${userId}`);
          // Don't await each session creation to avoid long sequential startup
          this.createSession(userId).catch(err => {
            console.error(`Failed to reconnect session for user ${userId}:`, err);
          });
        }
      }
    } catch (err) {
      console.error("Error during reconnectAllSessions:", err);
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
      version = [2, 3000, 1017531287]; // Updated fallback version
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
      // Performance and stability options
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      markOnlineOnConnect: true,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 0,
      keepAliveIntervalMs: 30000,
      retryRequestDelayMs: 5000,
      shouldSyncHistoryMessage: () => false,
    });

    this.sessions.set(userId, { socket, status: "connecting" });

    console.log(`[WhatsApp] createSession for ${userId}. PhoneNumber: ${phoneNumber}. Registered: ${state.creds.registered}`);
    if (phoneNumber && !state.creds.registered) {
      // Small delay to ensure socket is ready before requesting pairing code
      setTimeout(async () => {
        try {
          console.log(`[WhatsApp] Requesting pairing code for ${userId} with phone ${phoneNumber}`);
          const code = await socket.requestPairingCode(phoneNumber);
          console.log(`Pairing code for ${userId}: ${code}`);
          const session = this.sessions.get(userId);
          if (session) {
            session.pairingCode = code;
            session.status = "pairing";
            onUpdate?.("pairing", code);
          }
        } catch (err: any) {
          console.error(`Failed to request pairing code for ${userId}:`, err);
          
          // If it's a 401 or connection closed, clear the session to allow retry
          if (err.message?.includes("Connection Closed") || err.message?.includes("401")) {
            const sessionDir = path.join(process.cwd(), "sessions", userId);
            if (fs.existsSync(sessionDir)) {
              fs.rmSync(sessionDir, { recursive: true, force: true });
            }
          }
          
          this.sessions.delete(userId);
          onUpdate?.("disconnected");
        }
      }, 3000);
    }

    socket.ev.on("creds.update", saveCreds);

    // Welcome Message Logic
    socket.ev.on("group-participants.update", async (update) => {
      const { id, participants, action } = update;
      if (action === "add") {
        try {
          const { data: rule } = await supabaseAdmin
            .from("group_rules")
            .select("welcome_msg")
            .eq("user_id", userId)
            .eq("group_jid", id)
            .eq("active", true)
            .maybeSingle();

          if (rule?.welcome_msg) {
            for (const participant of participants) {
              const jid = typeof participant === 'string' ? participant : (participant as any).id;
              const msg = rule.welcome_msg.replace("{user}", `@${jid.split("@")[0]}`);
              await socket.sendMessage(id, { text: msg, mentions: [jid] });
            }
          }
        } catch (err) {
          console.error("[WhatsApp] Error in welcome message logic:", err);
        }
      }
    });

    socket.ev.on("connection.update", async (update) => {
      console.log(`[WhatsApp] Connection update for ${userId}:`, JSON.stringify(update, (key, value) => key === 'qr' ? '***' : value));
      try {
        const { connection, lastDisconnect, qr } = update;
        const session = this.sessions.get(userId);
        if (!session) {
          console.warn(`[WhatsApp] Connection update for ${userId} but no session found in map.`);
          return;
        }

        if (qr) {
          session.qr = qr;
          session.status = "qr";
          onUpdate?.("qr", qr);
          await this.log(userId, "info", `QR Code gerado com sucesso. Status: ${session.status}`);
          console.log(`[WhatsApp] QR Code generated for ${userId}. Length: ${qr.length}`);
        }

        if (connection === "open") {
          session.status = "connected";
          session.qr = undefined;
          session.pairingCode = undefined;
          this.reconnectAttempts.delete(userId);
          await this.log(userId, "success", "WhatsApp conectado com sucesso!");
          console.log(`[WhatsApp] Session ${userId} is now OPEN and READY.`);
          onUpdate?.("connected");
        }

        if (connection === "close") {
          const boomErr = lastDisconnect?.error as Boom | undefined;
          const statusCode = boomErr?.output?.statusCode;
          const reason = boomErr?.message || "Graceful close or unknown reason";
          
          console.error(`[WhatsApp] Connection closed for ${userId}. Status: ${statusCode || 'Unknown'}. Reason: ${reason}`);
          
          if (reason === "QR refs attempts ended") {
            console.log(`[WhatsApp] QR refs attempts ended for ${userId}. Clearing session directory.`);
            const sessionDir = path.join(process.cwd(), "sessions", userId);
            if (fs.existsSync(sessionDir)) {
              fs.rmSync(sessionDir, { recursive: true, force: true });
            }
          }

          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          
          console.log(`[WhatsApp] Connection closed for ${userId}. Should reconnect: ${shouldReconnect}`);

          // Auto-clear session on 401 or sync failure to force a fresh start
          if (statusCode === 401 || reason.includes("failed to sync state")) {
            console.log(`[WhatsApp] Critical error ${statusCode} (${reason}) for ${userId}. Clearing session directory.`);
            const sessionDir = path.join(process.cwd(), "sessions", userId);
            if (fs.existsSync(sessionDir)) {
              fs.rmSync(sessionDir, { recursive: true, force: true });
            }
          }

          if (statusCode === 515) {
            const attempts = this.reconnectAttempts.get(userId) || 0;
            console.log(`[WhatsApp] Stream Error 515 for ${userId} (Attempt ${attempts + 1}).`);
            
            // If it fails too many times with 515, the session might be corrupted
            if (attempts >= 3) {
              console.log(`[WhatsApp] Stream Error 515 persisted for ${userId}. Clearing session directory to force fresh start.`);
              const sessionDir = path.join(process.cwd(), "sessions", userId);
              if (fs.existsSync(sessionDir)) {
                fs.rmSync(sessionDir, { recursive: true, force: true });
              }
              this.reconnectAttempts.delete(userId); // Reset attempts for the fresh start
            }
          }

          session.status = "disconnected";
          onUpdate?.("disconnected");

          // Reset session safely
          this.sessions.delete(userId);

          if (shouldReconnect) {
            const attempts = this.reconnectAttempts.get(userId) || 0;
            const maxAttempts = statusCode === 515 ? 10 : 3; // More attempts for stream errors
            
            if (attempts < maxAttempts) {
              this.reconnectAttempts.set(userId, attempts + 1);
              const delay = statusCode === 515 ? 5000 : 10000; // Faster reconnect for stream errors
              console.log(`[WhatsApp] Auto-reconnecting for ${userId} (Attempt ${attempts + 1}/${maxAttempts}) in ${delay}ms...`);
              setTimeout(() => {
                // Double check if session was already recreated by another event
                if (!this.sessions.has(userId)) {
                  console.log(`[WhatsApp] Executing auto-reconnect for ${userId}`);
                  this.createSession(userId, phoneNumber, onUpdate).catch(err => {
                    console.error(`[WhatsApp] Auto-reconnect failed for ${userId}:`, err);
                  });
                } else {
                  console.log(`[WhatsApp] Skipping auto-reconnect for ${userId} as session already exists.`);
                }
              }, delay);
            } else {
              console.log(`[WhatsApp] Max reconnection attempts (${maxAttempts}) reached for ${userId}. Stopping.`);
              this.reconnectAttempts.delete(userId);
            }
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
      try {
        console.log(`Received history for ${userId}: ${contacts?.length || 0} contacts, ${messages?.length || 0} messages`);
        if (messages) {
          for (const msg of messages) {
            await this.syncMessage(userId, msg);
          }
        }
      } catch (err) {
        console.error(`[WhatsApp] Error in messaging-history.set for user ${userId}:`, err);
      }
    });

      // Sync Messages
      socket.ev.on("messages.upsert", async ({ messages, type }) => {
        try {
          if (type !== "notify" && type !== "append") return;

          for (const msg of messages) {
            try {
              let text = "";
              
              if (msg.message?.conversation) {
                text = msg.message.conversation;
              } else if (msg.message?.extendedTextMessage?.text) {
                text = msg.message.extendedTextMessage.text;
              } else if (msg.message?.imageMessage?.caption) {
                text = msg.message.imageMessage.caption;
              } else if (msg.message?.videoMessage?.caption) {
                text = msg.message.videoMessage.caption;
              } else if (msg.message?.buttonsResponseMessage?.selectedButtonId) {
                text = msg.message.buttonsResponseMessage.selectedButtonId;
              } else if (msg.message?.templateButtonReplyMessage?.selectedId) {
                text = msg.message.templateButtonReplyMessage.selectedId;
              } else if (msg.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
                try {
                  const params = JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
                  text = params.id || params.selectedId || "";
                } catch (e) {
                  console.error("[WhatsApp] Error parsing nativeFlowResponseMessage paramsJson:", e);
                }
              } else if (msg.message?.interactiveResponseMessage?.body?.text) {
                text = msg.message.interactiveResponseMessage.body.text;
              } else if (msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId) {
                text = msg.message.listResponseMessage.singleSelectReply.selectedRowId;
              }
              
              if (!msg.key.fromMe && text) {
                const remoteJid = msg.key.remoteJid;
                if (!remoteJid) {
                  console.warn(`[WhatsApp] Incoming message for user ${userId} has no remoteJid. Skipping.`);
                  continue;
                }

                const isGroup = remoteJid.includes("@g.us");
                
                console.log(`[WhatsApp] Incoming message from ${remoteJid} for user ${userId}: "${text}"`);
                const isButton = !!(msg.message?.buttonsResponseMessage || 
                                   msg.message?.templateButtonReplyMessage || 
                                   msg.message?.interactiveResponseMessage);
                
                // Run automation/agent in background to not block the message loop
                (async () => {
                  if (this.activeTasks >= this.maxConcurrentTasks) {
                    console.warn(`[WhatsApp] Max concurrent tasks reached (${this.activeTasks}). Skipping background processing for this message.`);
                    return;
                  }

                  this.activeTasks++;
                  try {
                    // Check Group Rules if it's a group message
                    if (isGroup) {
                      const shouldDelete = await this.checkGroupRules(userId, socket, remoteJid, msg, text);
                      if (shouldDelete) {
                        console.log(`[WhatsApp] Message deleted by group rules for user ${userId}`);
                        return;
                      }
                    }

                    console.log(`[WhatsApp] Processing message for user ${userId}: "${text}" (isButton: ${isButton}) (isGroup: ${isGroup}) (Active Tasks: ${this.activeTasks})`);
                    const triggered = await handleIncomingMessage(this, userId, remoteJid, text, isButton);
                    if (!triggered) {
                      console.log(`[WhatsApp] No automation triggered for user ${userId}, calling AI agent.`);
                      await handleAgentMessage(this, userId, remoteJid, text);
                    } else {
                      console.log(`[WhatsApp] Automation triggered for user ${userId}.`);
                    }
                  } catch (err) {
                    console.error(`[WhatsApp] Error in message processing for user ${userId}:`, err);
                  } finally {
                    this.activeTasks--;
                  }
                })();
              } else if (!msg.key.fromMe && !text) {
                console.log(`[WhatsApp] Incoming message from ${msg.key.remoteJid} for user ${userId} has no text content. Raw:`, JSON.stringify(msg.message, null, 2));
              }
              
              await this.syncMessage(userId, msg);
            } catch (innerErr) {
              console.error(`[WhatsApp] Error processing individual message for user ${userId}:`, innerErr);
            }
          }
        } catch (outerErr) {
          console.error(`[WhatsApp] Critical error in messages.upsert for user ${userId}:`, outerErr);
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

      const pushName = msg.pushName || "";
      const contactId = await this.getOrCreateContact(userId, jid, pushName);
      
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

        // Update contact's last message info
        await supabaseAdmin
          .from("contacts")
          .update({
            last_message_at: new Date((msg.messageTimestamp as number) * 1000).toISOString(),
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
        // Update name if it was just the phone number and we now have a pushName
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
    
    // Attempt auto-reconnect if session files exist but session is not in memory or not connected
    if (!session || session.status !== "connected") {
      const sessionDir = path.join(process.cwd(), "sessions", userId);
      if (fs.existsSync(sessionDir)) {
        const isPaused = fs.existsSync(path.join(sessionDir, "paused.txt"));
        if (!isPaused) {
          console.log(`Auto-reconnecting session for user ${userId}...`);
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
    
    return this.sessions.get(userId);
  }

  async sendMessage(userId: string, jid: string, text: string, mediaUrl?: string, mediaType?: string) {
    let session = await this.ensureConnection(userId);

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
    let session = await this.ensureConnection(userId);

    if (!session || session.status !== "connected") {
      await this.log(userId, "error", "Falha ao enviar botões: Sessão não conectada.");
      throw new Error("WhatsApp session not connected. Please go to the WhatsApp tab and reconnect.");
    }

    try {
      // Modern Baileys Buttons (Interactive Message - Native Flow)
      const message = {
        interactiveMessage: {
          header: { title: "Menu", hasMediaAttachment: false },
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
      };

      await this.log(userId, "info", `Enviando botões interativos para ${jid}`);
      
      const genMsg = await generateWAMessageFromContent(jid, { 
        viewOnceMessage: { 
          message 
        } 
      }, { userJid: session.socket.user?.id });

      return await session.socket.relayMessage(jid, genMsg.message!, { messageId: genMsg.key.id! });
    } catch (err) {
      console.error("Error sending interactive buttons, falling back to legacy buttons:", err);
      
      try {
        // Fallback 1: Legacy Buttons (Still works on some clients)
        const legacyButtons = buttons.map(b => ({
          buttonId: b.id,
          buttonText: { displayText: b.label },
          type: 1
        }));

        const buttonMessage = {
          text: text,
          buttons: legacyButtons,
          headerType: 1
        };
        await this.log(userId, "warn", `Botões interativos falharam, tentando Legacy Buttons para ${jid}`);
        return await session.socket.sendMessage(jid, buttonMessage);
      } catch (legacyErr) {
        console.error("Legacy buttons also failed, falling back to plain text:", legacyErr);
        
        // Fallback 2: Plain Text with numbered options
        let fallbackText = `*${text}*\n\n`;
        buttons.forEach((b, i) => {
          fallbackText += `${i + 1}. ${b.label}\n`;
        });
        fallbackText += "\n_Responda com o número ou o texto da opção._";
        
        await this.log(userId, "warn", `Legacy Buttons falharam, enviando texto simples para ${jid}`);
        return await session.socket.sendMessage(jid, { text: fallbackText });
      }
    }
  }

  async sendListMessage(userId: string, jid: string, listData: any) {
    let session = await this.ensureConnection(userId);

    if (!session || session.status !== "connected") {
      await this.log(userId, "error", "Falha ao enviar lista: Sessão não conectada.");
      throw new Error("WhatsApp session not connected. Please go to the WhatsApp tab and reconnect.");
    }

    try {
      // Modern Baileys List (Interactive Message - Native Flow - single_select)
      const sections = listData.sections.map((section: any) => ({
        title: section.title,
        rows: section.rows.map((row: any) => ({
          header: "",
          title: row.title,
          description: row.description || "",
          id: row.id || row.title
        }))
      }));

      const message = {
        interactiveMessage: {
          body: { text: listData.description || "Selecione uma opção" },
          footer: { text: listData.footer || "" },
          header: { title: listData.title || "Menu", hasMediaAttachment: false },
          nativeFlowMessage: {
            buttons: [
              {
                name: "single_select",
                buttonParamsJson: JSON.stringify({
                  title: listData.buttonText || "Ver Opções",
                  sections: sections
                })
              }
            ]
          }
        }
      };

      await this.log(userId, "info", `Enviando lista interativa (moderna) para ${jid}`);
      
      const genMsg = await generateWAMessageFromContent(jid, { 
        viewOnceMessage: { 
          message 
        } 
      }, { userJid: session.socket.user?.id });

      return await session.socket.relayMessage(jid, genMsg.message!, { messageId: genMsg.key.id! });
    } catch (err) {
      console.error("Error sending modern list message, falling back to legacy list:", err);
      
      try {
        // Fallback 1: Legacy List Message
        const legacyListMessage: any = {
          text: listData.description || "Selecione uma opção",
          footer: listData.footer || "",
          title: listData.title || "Menu",
          buttonText: listData.buttonText || "Ver Opções",
          sections: listData.sections.map((section: any) => ({
            title: section.title,
            rows: section.rows.map((row: any) => ({
              title: row.title,
              description: row.description || "",
              rowId: row.id || row.title
            }))
          }))
        };
        await this.log(userId, "warn", `Lista moderna falhou, tentando Legacy List para ${jid}`);
        return await session.socket.sendMessage(jid, legacyListMessage);
      } catch (legacyListErr) {
        console.error("Legacy list message also failed, falling back to text:", legacyListErr);
        
        // Fallback 2: Plain Text
        let fallbackText = `${listData.title || "Menu"}\n${listData.description || ""}\n\n`;
        let optionNum = 1;
        
        listData.sections.forEach((section: any) => {
          if (section.title) fallbackText += `*${section.title}*\n`;
          section.rows.forEach((row: any) => {
            fallbackText += `${optionNum}. ${row.title}\n`;
            if (row.description) fallbackText += `   ${row.description}\n`;
            optionNum++;
          });
          fallbackText += '\n';
        });
        
        fallbackText += `Responda com o número da opção desejada.`;
        
        await this.log(userId, "warn", `Lista legada falhou, enviando texto puro para ${jid}`);
        return await session.socket.sendMessage(jid, { text: fallbackText });
      }
    }
  }

  async sendPresenceUpdate(userId: string, jid: string, presence: "composing" | "recording" | "paused") {
    const session = await this.ensureConnection(userId);
    if (!session || session.status !== "connected") return;
    return await session.socket.sendPresenceUpdate(presence, jid);
  }

  async getGroups(userId: string) {
    const session = await this.ensureConnection(userId);
    if (!session || session.status !== "connected") throw new Error("WhatsApp não conectado");
    
    try {
      const groups = await session.socket.groupFetchAllParticipating();
      return Object.values(groups);
    } catch (err) {
      console.error("Error fetching groups:", err);
      throw err;
    }
  }

  async getGroupMetadata(userId: string, jid: string) {
    const session = await this.ensureConnection(userId);
    if (!session || session.status !== "connected") throw new Error("WhatsApp não conectado");
    
    try {
      return await session.socket.groupMetadata(jid);
    } catch (err) {
      console.error("Error fetching group metadata:", err);
      throw err;
    }
  }

  async updateGroupParticipants(userId: string, jid: string, participants: string[], action: "add" | "remove" | "promote" | "demote") {
    const session = await this.ensureConnection(userId);
    if (!session || session.status !== "connected") throw new Error("WhatsApp não conectado");
    
    try {
      return await session.socket.groupParticipantsUpdate(jid, participants, action);
    } catch (err) {
      console.error(`Error updating group participants (${action}):`, err);
      throw err;
    }
  }

  async updateGroupSubject(userId: string, jid: string, subject: string) {
    const session = await this.ensureConnection(userId);
    if (!session || session.status !== "connected") throw new Error("WhatsApp não conectado");
    
    try {
      return await session.socket.groupUpdateSubject(jid, subject);
    } catch (err) {
      console.error("Error updating group subject:", err);
      throw err;
    }
  }

  async leaveGroup(userId: string, jid: string) {
    const session = await this.ensureConnection(userId);
    if (!session || session.status !== "connected") throw new Error("WhatsApp não conectado");
    
    try {
      return await session.socket.groupLeave(jid);
    } catch (err) {
      console.error("Error leaving group:", err);
      throw err;
    }
  }

  private messageHistory: Map<string, { text: string, timestamp: number }[]> = new Map();

  private async checkGroupRules(userId: string, socket: WASocket, jid: string, msg: any, text: string): Promise<boolean> {
    try {
      const { data: rule } = await supabaseAdmin
        .from("group_rules")
        .select("*")
        .eq("user_id", userId)
        .eq("group_jid", jid)
        .eq("active", true)
        .maybeSingle();

      if (!rule) return false;

      // Check if sender is admin (admins are immune to rules)
      const metadata = await socket.groupMetadata(jid);
      const sender = msg.key.participant || msg.key.remoteJid;
      const isAdmin = metadata.participants.find(p => p.id === sender)?.admin;
      
      if (isAdmin) return false;

      let shouldDelete = false;
      const now = Date.now();
      const historyKey = `${userId}:${jid}:${sender}`;
      
      // Get or initialize history for this sender in this group
      let history = this.messageHistory.get(historyKey) || [];
      
      // Clean up old history (older than 1 minute)
      history = history.filter(h => now - h.timestamp < 60000);

      // 1. Anti-Link
      if (rule.anti_link) {
        const linkRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)/gi;
        if (linkRegex.test(text)) {
          shouldDelete = true;
          await this.log(userId, "warn", `Anti-Link: Mensagem deletada de ${sender} no grupo ${jid}`);
        }
      }

      // 2. Anti-Spam (Repeated messages)
      if (!shouldDelete && rule.anti_spam) {
        const isRepeated = history.some(h => h.text === text && now - h.timestamp < 30000);
        if (isRepeated) {
          shouldDelete = true;
          await this.log(userId, "warn", `Anti-Spam: Mensagem repetida deletada de ${sender} no grupo ${jid}`);
        }
      }

      // 3. Anti-Flood (Too many messages)
      if (!shouldDelete && rule.anti_flood) {
        const recentMessages = history.filter(h => now - h.timestamp < 10000);
        if (recentMessages.length >= 5) { // 5 messages in 10 seconds
          shouldDelete = true;
          await this.log(userId, "warn", `Anti-Flood: Flood detectado de ${sender} no grupo ${jid}`);
        }
      }

      // Update history
      history.push({ text, timestamp: now });
      // Keep only last 10 messages in history
      if (history.length > 10) history.shift();
      this.messageHistory.set(historyKey, history);

      if (shouldDelete) {
        await socket.sendMessage(jid, { delete: msg.key });
        return true;
      }

      return false;
    } catch (err) {
      console.error("[WhatsApp] Error checking group rules:", err);
      return false;
    }
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
