import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  Contact as BaileysContact,
  downloadMediaMessage,
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
  private sessions: Map<string, { socket: any; status: string; qr?: string; pairingCode?: string; createdAt?: number }> = new Map();
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
        contactsMap: new Map(),
        chatsMap: new Map(),
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

          // Clean up orphan contacts from older sessions asynchronously
          this.cleanOrphanContactsFromPreviousSessions(userId).catch(e => {
            console.error("[WhatsApp] Post-connection cleanup error:", e);
          });
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
          const isConflict = String(reason).toLowerCase().includes("conflict") || statusCode === 440;
          const isLoggedOut = (statusCode === DisconnectReason.loggedOut || (statusCode === 401 && !isConflict && String(reason).toLowerCase().includes("logged out")));
          const isRestartRequired = statusCode === DisconnectReason.restartRequired || statusCode === 515 || isConflict;
          
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

      // Sync Logic - Selective Ingestion (Gravados na Agenda + Conversas Ativas Disponíveis)
      socket.ev.on("messaging-history.set", async ({ contacts, chats, messages, isLatest }) => {
        console.log(`[WhatsApp] messaging-history.set for ${userId}: contacts=${contacts?.length}, chats=${chats?.length}, messages=${messages?.length}`);
        const session = this.sessions.get(userId);
        
        const activeChatPhones = new Set<string>();
        if (chats) {
          for (const chat of chats) {
            if (chat.id && !chat.id.includes("@g.us") && !chat.id.includes("@broadcast") && !chat.id.startsWith("120363")) {
              const cp = chat.id.split("@")[0].replace(/\D/g, "");
              if (cp) activeChatPhones.add(cp);
              if (session) (session as any).chatsMap?.set(chat.id, chat);
              // Create contact if not exists for the chat (disponível)
              await this.getOrCreateContact(userId, chat.id, chat.name || undefined);
            }
          }
        }

        if (contacts) {
          for (const contact of contacts) {
            if (contact.id && !contact.id.includes("@g.us") && !contact.id.includes("@broadcast") && !contact.id.startsWith("120363")) {
              if (session) (session as any).contactsMap?.set(contact.id, contact);
              const cp = contact.id.split("@")[0].replace(/\D/g, "");
              const isSaved = this.isSavedContact(contact);
              const hasActiveChat = Boolean(cp && activeChatPhones.has(cp));

              // ONLY sync if saved in phonebook ("gravados") OR has active conversation ("disponível")
              if (isSaved || hasActiveChat) {
                await this.syncContact(userId, contact, isSaved);
              }
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
        const session = this.sessions.get(userId);
        for (const contact of contacts) {
          if (contact.id && !contact.id.includes("@g.us") && !contact.id.includes("@broadcast") && !contact.id.startsWith("120363")) {
            if (session) (session as any).contactsMap?.set(contact.id, contact);
            const isSaved = this.isSavedContact(contact);
            // Only sync if saved with a real name in the phonebook
            if (isSaved) {
              await this.syncContact(userId, contact, true);
            }
          }
        }
      });

      socket.ev.on("contacts.update", async (updates) => {
        for (const update of updates) {
          if (update.id && !update.id.includes("@g.us") && !update.id.includes("@broadcast") && !update.id.startsWith("120363")) {
            const isSaved = this.isSavedContact(update as BaileysContact);
            if (isSaved) {
              await this.syncContact(userId, update as BaileysContact, true);
            }
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

            // If it's a message sent to self ("chat with yourself" / notes), allow automations and agent to process
            const myInfo = this.getMe(userId);
            const myPhone = myInfo?.id ? myInfo.id.split(":")[0].replace(/\D/g, "") : "";
            const myLid = myInfo?.lid ? myInfo.lid.split(":")[0].replace(/\D/g, "") : "";
            const senderPhone = jid.split("@")[0].replace(/\D/g, "");
            const isSelfMessage = isMe && (
              (Boolean(myPhone) && senderPhone === myPhone) || 
              (Boolean(myLid) && senderPhone === myLid) ||
              (Boolean(myInfo?.id) && jid.includes(myInfo.id.split(":")[0])) ||
              (Boolean(myInfo?.lid) && jid.includes(myInfo.lid.split(":")[0]))
            );
            const isGroupOrBroadcast = jid.includes("@g.us") || 
                                       jid.includes("@broadcast") || 
                                       jid.includes("@newsletter") || 
                                       jid.startsWith("120363");

            if ((!isMe || isSelfMessage) && text && !isGroupOrBroadcast) {
              console.log(`[WhatsApp] Processing message for ${userId} (from: ${jid}, text: "${text}", isSelf: ${isSelfMessage})`);
              const handledByAutomation = await handleIncomingMessage(this, userId, jid, text, !!(msg.message?.buttonsResponseMessage || msg.message?.templateButtonReplyMessage || msg.message?.interactiveResponseMessage));
              if (!handledByAutomation) {
                await handleAgentMessage(this, userId, jid, text, isSelfMessage);
              }
            } else if (isGroupOrBroadcast) {
              console.log(`[WhatsApp] Skipping group/broadcast message for ${userId} (jid: ${jid})`);
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

  private async syncMessage(
    userId: string, 
    msg: any, 
    explicitMediaUrl?: string, 
    explicitMediaType?: string, 
    explicitMimetype?: string, 
    explicitFilename?: string
  ) {
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

      if (!text && !explicitMediaUrl) return;

      const isGroupOrBroadcast = jid.includes("@g.us") || 
                                 jid.includes("@broadcast") || 
                                 jid.includes("@newsletter") || 
                                 jid.startsWith("120363");

      const pushName = msg.pushName || "";
      let contactId: string | null = null;
      if (!isGroupOrBroadcast) {
        const cId = await this.getOrCreateContact(userId, jid, pushName);
        if (cId && cId !== "unknown") {
          contactId = cId;
        }
      }
      
      const { data: existingMsg } = await supabaseAdmin
        .from("messages")
        .select("id")
        .eq("user_id", userId)
        .eq("msg_id", msg.key.id)
        .maybeSingle();

      if (!existingMsg) {
        let mediaUrl = explicitMediaUrl || "";
        let mediaType = explicitMediaType || "";
        let mediaMimetype = explicitMimetype || "";
        let mediaFilename = explicitFilename || "";

        if (!mediaType) {
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
        }

        // 📥 Download incoming media from WhatsApp if not already provided
        if (!msg.key.fromMe && !mediaUrl && (msg.message.audioMessage || msg.message.imageMessage || msg.message.videoMessage || msg.message.documentMessage)) {
          try {
            const session = this.sessions.get(userId);
            if (session?.socket) {
              const buffer = await downloadMediaMessage(
                msg,
                'buffer',
                {},
                {
                  logger: pino({ level: 'silent' }),
                  reuploadRequest: (m: any) => session.socket.updateMediaMessage(m)
                }
              );
              if (buffer && buffer.length > 0) {
                const ext = mediaType === "audio" ? "ogg" : mediaType === "image" ? "jpg" : mediaType === "video" ? "mp4" : "pdf";
                const filename = `received-${Date.now()}-${Math.round(Math.random() * 1e4)}.${ext}`;
                const uploadsPath = path.join(process.cwd(), "uploads", filename);
                fs.writeFileSync(uploadsPath, buffer);
                mediaUrl = `/uploads/${filename}`;
                console.log(`[WhatsApp] Downloaded and saved incoming media to: ${mediaUrl}`);
              }
            }
          } catch (dlErr: any) {
            console.error("[WhatsApp] Error downloading incoming media:", dlErr.message);
          }
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
        // 1. Always update last_message_at and last_message_text (these columns always exist)
        try {
          await supabaseAdmin
            .from("contacts")
            .update({
              last_message_at: msgDate.toISOString(),
              last_message_text: text.substring(0, 100)
            })
            .eq("id", contactId);
        } catch (updateErr: any) {
          console.warn("[WhatsApp] Could not update contact last_message:", updateErr.message);
        }

        // 2. Try incrementing unread_count safely for incoming messages
        if (!msg.key.fromMe) {
          try {
            const { data: currentContact } = await supabaseAdmin
              .from("contacts")
              .select("unread_count")
              .eq("id", contactId)
              .maybeSingle();
            
            if (currentContact && currentContact.unread_count !== undefined) {
              await supabaseAdmin
                .from("contacts")
                .update({ unread_count: (currentContact.unread_count || 0) + 1 })
                .eq("id", contactId);
            }
          } catch (unreadErr) {
            // unread_count column might not exist yet; safe to ignore
          }
        }
      }
    } catch (err) {
      console.error("Sync message error:", err);
    }
  }

  public isSavedContact(contact: BaileysContact): boolean {
    const rawName = (contact.name || "").trim();
    if (!rawName) return false;
    const cleanPhone = (contact.id || "").split("@")[0].replace(/\D/g, "");
    const nameDigits = rawName.replace(/\D/g, "");
    if (nameDigits.length > 5 && nameDigits === cleanPhone) return false;
    if (/^[\d\s+()\-#]+$/.test(rawName)) return false;
    if (rawName === "</>" || rawName === "Sem Nome") return false;
    return true;
  }

  private async syncContact(userId: string, contact: BaileysContact, isSaved = false) {
    try {
      const jid = contact.id;
      if (!jid || 
          jid.includes("@g.us") || 
          jid.includes("@lid") || 
          jid.includes("@broadcast") || 
          jid.includes("@newsletter") || 
          jid.startsWith("120363")) return;

      const phone = jid.split("@")[0].replace(/\D/g, "");
      if (!phone || phone.length < 8 || phone.length > 15 || phone.startsWith("120363")) return;

      const phoneNo258 = phone.startsWith("258") ? phone.slice(3) : phone;
      const phoneWith258 = phone.startsWith("258") ? phone : `258${phone}`;

      const { data: existingContact } = await supabaseAdmin
        .from("contacts")
        .select("id, tags, name")
        .eq("user_id", userId)
        .or(`phone.eq.${phone},phone.eq.${phoneNo258},phone.eq.${phoneWith258}`)
        .maybeSingle();

      const savedName = this.isSavedContact(contact) ? (contact.name || "").trim() : "";
      const name = savedName || contact.notify || contact.verifiedName || "";

      if (!existingContact) {
        // Seletividade: Não criar novo contacto a menos que esteja gravado na agenda ou tenha conversa ativa
        if (!savedName && !isSaved) {
          return;
        }

        console.log(`[WhatsApp] Creating new selective contact for user ${userId}: ${name || phone}`);
        await supabaseAdmin.from("contacts").insert({
          user_id: userId,
          name: name || phone,
          phone,
          tags: ["WhatsApp"],
          created_at: new Date().toISOString(),
        });
      } else {
        const currentTags = Array.isArray(existingContact.tags) ? existingContact.tags : [];
        const updatedTags = Array.from(new Set([...currentTags, "WhatsApp"]));
        
        // Update name only if it's better than what we have (not just the phone number)
        const shouldUpdateName = savedName && savedName !== phone && (!existingContact.name || existingContact.name === phone);
        
        if (shouldUpdateName) {
          console.log(`[WhatsApp] Updating name for user ${userId}, contact ${phone}: ${savedName}`);
        }

        await supabaseAdmin
          .from("contacts")
          .update({ 
            name: shouldUpdateName ? savedName : existingContact.name,
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

      // Do NOT create contacts for groups or broadcasts
      if (jid.includes("@g.us") || jid.includes("@broadcast") || jid.includes("@newsletter") || jid.startsWith("120363")) {
        return "unknown";
      }

      const phone = jid.split("@")[0].replace(/\D/g, "");
      if (!phone || phone.startsWith("120363") || phone.length < 7) {
        return "unknown";
      }

      // Do not create contact for the user's own account (self-messages)
      const myInfo = this.getMe(userId);
      const myPhone = myInfo?.id ? myInfo.id.split(":")[0].replace(/\D/g, "") : "";
      const myLid = myInfo?.lid ? myInfo.lid.split(":")[0].replace(/\D/g, "") : "";
      if ((Boolean(myPhone) && phone === myPhone) || (Boolean(myLid) && phone === myLid)) {
        return "unknown";
      }

      const phoneNo258 = phone.startsWith("258") ? phone.slice(3) : phone;
      const phoneWith258 = phone.startsWith("258") ? phone : `258${phone}`;

      const { data: existingContact } = await supabaseAdmin
        .from("contacts")
        .select("id, name")
        .eq("user_id", userId)
        .or(`phone.eq.${phone},phone.eq.${phoneNo258},phone.eq.${phoneWith258}`)
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

  async requestPairingCode(userId: string, phoneNumber: string): Promise<string> {
    const cleanPhone = phoneNumber.replace(/\D/g, "");
    if (!cleanPhone || cleanPhone.length < 8) {
      throw new Error("Número de telefone inválido. Informe o código do país e número (ex: 258841234567).");
    }

    console.log(`[WhatsApp Pairing Code] Requesting pairing code for user: ${userId}, phone: ${cleanPhone}`);
    await this.log(userId, "info", `Solicitando código de pareamento para +${cleanPhone}...`);

    let session = this.sessions.get(userId);

    // If the session is already registered or was previously connected, Baileys disallows requestPairingCode.
    // Cleanly delete and recreate session to allow pairing a new device.
    if (session?.socket?.authState?.creds?.registered) {
      console.log(`[WhatsApp Pairing Code] Session already has registered credentials for user ${userId}. Resetting for new pairing code...`);
      await this.deleteSession(userId);
      session = undefined;
    }

    // If no session exists or disconnected, create one
    if (!session || !session.socket || session.status === "disconnected") {
      await this.createSession(userId);
      session = this.sessions.get(userId);
    }

    if (!session || !session.socket) {
      throw new Error("Falha ao inicializar conexão para gerar o código.");
    }

    // Wait for the socket WebSocket to reach OPEN state (readyState === 1)
    let waitAttempts = 0;
    while ((!session.socket.ws || session.socket.ws.readyState !== 1) && waitAttempts < 25) {
      await new Promise(resolve => setTimeout(resolve, 300));
      waitAttempts++;
    }

    if (!session.socket.ws || session.socket.ws.readyState !== 1) {
      throw new Error("O servidor WhatsApp demorou a responder. Por favor, tente novamente em instantes.");
    }

    try {
      const code = await session.socket.requestPairingCode(cleanPhone);
      const formattedCode = (code && code.length === 8) ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
      session.pairingCode = formattedCode;
      session.status = "pairing_code";
      await this.log(userId, "success", `Código de pareamento gerado: ${formattedCode}`);
      return formattedCode;
    } catch (err: any) {
      console.error(`[WhatsApp Pairing Code] Error generating code:`, err);
      await this.log(userId, "error", `Erro ao gerar código de pareamento: ${err.message}`);
      throw new Error(err.message || "Erro ao gerar código de pareamento no WhatsApp.");
    }
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

        if (mediaUrl) {
          try {
            // Check if mediaUrl points directly to a local file in uploads/
            let localPath = "";
            if (mediaUrl.includes("/uploads/")) {
              const filename = mediaUrl.split("/uploads/").pop()?.split("?")[0];
              if (filename) {
                const candidate = path.join(process.cwd(), "uploads", filename);
                if (fs.existsSync(candidate)) localPath = candidate;
              }
            } else if (fs.existsSync(mediaUrl)) {
              localPath = mediaUrl;
            }

            if (localPath) {
              if (localPath.toLowerCase().endsWith(".ogg")) {
                // Already in OGG/Opus format from upload! Send directly with 0 conversion overhead!
                audioPath = localPath;
                console.log(`[WhatsAppManager] Fast direct audio dispatch from disk: ${audioPath}`);
              } else {
                tempOutputPath = await convertToOpus(localPath);
                audioPath = tempOutputPath;
              }
            } else if (mediaUrl.startsWith("http")) {
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
              if (tempOutputPath) audioPath = tempOutputPath;
            }
          } catch (err) {
            console.error("[WhatsAppManager] Error preparing audio, falling back to original:", err);
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
      await this.syncMessage(
        userId, 
        {
          key: {
            remoteJid: jid,
            fromMe: true,
            id: result.key.id
          },
          message: {
            conversation: text,
            audioMessage: mediaType === 'audio' ? { mimetype: 'audio/ogg' } : undefined,
            imageMessage: mediaType === 'image' ? { caption: text } : undefined,
            videoMessage: mediaType === 'video' ? { caption: text } : undefined,
            documentMessage: mediaType === 'document' ? { fileName: fileName } : undefined,
          },
          messageTimestamp: Math.floor(Date.now() / 1000),
          pushName: session.socket.user?.name || "Me"
        },
        mediaUrl,
        mediaType,
        mimetype,
        fileName
      );
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
    console.log("[WhatsApp] Reconnecting all sessions from database and local disk...");
    const userIds = new Set<string>();

    // 1. Scan local sessions directory
    try {
      const sessionsDir = path.join(process.cwd(), "whatsapp_sessions_data");
      if (fs.existsSync(sessionsDir)) {
        const files = fs.readdirSync(sessionsDir);
        for (const f of files) {
          if (f.endsWith(".json")) {
            const uid = f.replace(".json", "");
            if (uid && uid.length > 5) userIds.add(uid);
          }
        }
      }
    } catch (e) {
      console.warn("[WhatsApp] Error scanning local sessions directory:", e);
    }

    // 2. Scan Supabase if table exists
    try {
      const { data: sessions } = await supabaseAdmin
        .from("whatsapp_sessions")
        .select("user_id");

      if (sessions) {
        for (const s of sessions) {
          if (s.user_id) userIds.add(s.user_id);
        }
      }
    } catch (e) {}

    for (const uid of userIds) {
      console.log(`[WhatsApp] Auto-reconnecting session for user ${uid}`);
      this.createSession(uid).catch(err => {
        console.error(`Failed to reconnect session for ${uid}:`, err);
      });
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2s delay between sessions
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

  async cleanOrphanContactsFromPreviousSessions(userId: string): Promise<number> {
    try {
      console.log(`[WhatsApp] Cleaning orphan contacts from previous sessions for user ${userId}...`);
      
      const { data: contacts, error: cErr } = await supabaseAdmin
        .from("contacts")
        .select("id, name, phone, tags, last_message_at, created_at")
        .eq("user_id", userId);
        
      if (cErr || !contacts || contacts.length === 0) return 0;

      const { data: leads } = await supabaseAdmin
        .from("leads")
        .select("contact_id, phone")
        .eq("user_id", userId);

      const leadContactIds = new Set(leads?.map(l => l.contact_id).filter(Boolean));
      const leadPhones = new Set(leads?.map(l => (l.phone || "").replace(/\D/g, "")).filter(Boolean));

      const { data: messages } = await supabaseAdmin
        .from("messages")
        .select("contact_id")
        .eq("user_id", userId);

      const messageContactIds = new Set(messages?.map(m => m.contact_id).filter(Boolean));

      // Get current session contacts in memory if available
      const session = this.sessions.get(userId);
      const currentPhones = new Set<string>();
      if (session && (session as any).contactsMap) {
        for (const [jid] of (session as any).contactsMap.entries()) {
          const p = jid.split("@")[0].replace(/\D/g, "");
          if (p) currentPhones.add(p);
        }
      }

      const idsToDelete: string[] = [];

      for (const c of contacts) {
        const cleanP = (c.phone || "").replace(/\D/g, "");
        const tags = Array.isArray(c.tags) ? c.tags : [];
        const isManual = tags.includes("Manual") || tags.includes("Importado");
        const hasLead = leadContactIds.has(c.id) || leadPhones.has(cleanP);
        const hasMessages = messageContactIds.has(c.id) || Boolean(c.last_message_at);
        const isInCurrentSession = currentPhones.size > 0 ? currentPhones.has(cleanP) : false;

        // Keep contacts created in the current active session (today)
        const isToday = c.created_at && c.created_at.startsWith(new Date().toISOString().slice(0, 10));

        if (isManual || hasLead || hasMessages || isInCurrentSession || isToday) {
          continue;
        }

        idsToDelete.push(c.id);
      }

      if (idsToDelete.length > 0) {
        console.log(`[WhatsApp] Deleting ${idsToDelete.length} orphan contacts from previous sessions for user ${userId}...`);
        for (let i = 0; i < idsToDelete.length; i += 100) {
          const chunk = idsToDelete.slice(i, i + 100);
          await supabaseAdmin.from("contacts").delete().in("id", chunk);
        }
      }

      console.log(`[WhatsApp] Cleanup finished: ${idsToDelete.length} orphan contacts removed.`);
      return idsToDelete.length;
    } catch (err: any) {
      console.error("[WhatsApp] Error cleaning orphan contacts:", err.message);
      return 0;
    }
  }

  async syncCurrentSessionContacts(userId: string) {
    const session = this.sessions.get(userId);
    if (!session || session.status !== "connected") {
      throw new Error("WhatsApp não está conectado. Conecte primeiro no painel.");
    }

    // 1. Clean orphan contacts from previous connections
    const cleanedCount = await this.cleanOrphanContactsFromPreviousSessions(userId);

    // 2. Sync any in-memory cached contacts from current session
    if (session && (session as any).contactsMap) {
      for (const contact of (session as any).contactsMap.values()) {
        if (this.isSavedContact(contact)) {
          await this.syncContact(userId, contact, true);
        }
      }
    }

    // 3. Count saved contacts and active chats from current session in database
    const { data: contacts } = await supabaseAdmin
      .from("contacts")
      .select("id, name, phone, last_message_at, tags")
      .eq("user_id", userId);

    const savedCount = (contacts || []).filter(c => {
      const raw = (c.name || "").trim();
      const phone = (c.phone || "").replace(/\D/g, "");
      return raw && raw !== phone && !/^[\d\s+()\-#]+$/.test(raw) && raw !== "</>" && raw !== "Sem Nome";
    }).length;

    const activeChatsCount = (contacts || []).filter(c => Boolean(c.last_message_at)).length;

    return {
      success: true,
      total: contacts?.length || 0,
      savedCount,
      activeChatsCount,
      cleanedCount,
    };
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
