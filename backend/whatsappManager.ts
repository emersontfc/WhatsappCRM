import { isGroupJid, moderateGroupMessage, welcomeGroupParticipants } from "./services/groupModeration.ts";
import { alertOperator, handleOperatorCommand, isOperatorSelfChat, parseOperatorCommand } from "./services/whatsappOperator.ts";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  Contact as BaileysContact,
  downloadMediaMessage,
  type WASocket,
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
import { IWhatsAppTransport } from "./lib/whatsappTransport.ts";
import { normalizeContactPhone } from "../shared/contactPhone.ts";
import { saveContactIdentity } from "./services/contactIdentity.ts";

const logger = pino({ level: "silent" });
const lidFrom = (jid?: string | null) => /^(\d{5,20})(?::\d+)?@lid$/i.exec(jid ?? "")?.[1] ?? null;
const phoneFromJid = (jid?: string | null) => /@(?:s\.whatsapp\.net|c\.us)$/i.test(jid ?? "") ? normalizeContactPhone(jid) : null;

export class WhatsAppManager implements IWhatsAppTransport {
  private sessions: Map<string, { socket: any; status: string; qr?: string; pairingCode?: string; createdAt?: number }> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private restartRequiredAttempts: Map<string, number> = new Map();
  private maxReconnectAttempts = 5;
  private recentMessageIds: Map<string, number> = new Map();

  private isDuplicateMessage(msgId: string): boolean {
    if (!msgId) return false;
    const now = Date.now();
    const seenAt = this.recentMessageIds.get(msgId);
    if (seenAt && (now - seenAt) < 600000) { // 10 minutes dedup window
      return true;
    }
    this.recentMessageIds.set(msgId, now);
    if (this.recentMessageIds.size > 5000) {
      for (const [k, v] of this.recentMessageIds.entries()) {
        if (now - v > 600000) this.recentMessageIds.delete(k);
      }
    }
    return false;
  }

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

      socket.ev.on("group-participants.update", ({ id, action, participants }) => {
        if (action !== "add") return;
        void welcomeGroupParticipants(socket, userId, id, participants.map((member) => member.id))
          .catch(() => console.warn("[WhatsApp] Group welcome could not be processed"));
      });

      socket.ev.on("messages.upsert", async ({ messages, type }) => {
        console.log(`[WhatsApp] messages.upsert triggered for ${userId}, type: ${type}, count: ${messages.length}`);
        if (type !== "notify" && type !== "append") return;
        for (const msg of messages) {
          try {
            const msgKeyId = msg.key?.id;
            if (msgKeyId && this.isDuplicateMessage(`${userId}:${msgKeyId}`)) {
              console.log(`[WhatsApp] Duplicate message ignored (in-memory dedup): ${msgKeyId}`);
              continue;
            }

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

            const jid = msg.key.remoteJid;
            if (!jid) continue;
            const isMe = msg.key.fromMe;
            
            // Ignora status de outras pessoas para não poluir o log nem ativar a automação/IA
            if (jid === "status@broadcast" && !isMe) {
              continue;
            }

            console.log(`[WhatsApp] Message from ${jid} (isMe: ${isMe}): "${text}"`);

            const altJid = msg.key?.remoteJidAlt || (msg as any).remoteJidAlt || msg.key?.participantAlt || (msg as any).participantAlt;
            const saved = await this.syncMessage(userId, msg, altJid);
            if (isGroupJid(jid)) {
              if (type === "notify") await moderateGroupMessage(socket, userId, jid, msg.key, text);
              continue;
            }

            // If it's a message sent to self ("chat with yourself" / notes), allow automations and agent to process
            const isSelfMessage = isOperatorSelfChat(jid, Boolean(isMe), this.getMe(userId));
            const isGroupOrBroadcast = jid.includes("@g.us") || 
                                       jid.includes("@broadcast") || 
                                       jid.includes("@newsletter") || 
                                       jid.startsWith("120363");

            if (type === "notify" && !isGroupOrBroadcast) {
              if (!isMe && saved?.contact_id && Date.now() - Date.parse(saved.timestamp) < 5 * 60_000) {
                void alertOperator(this, userId, saved.contact_id)
                  .catch((error) => console.warn("[WhatsApp] Could not send contact alert:", error?.code || "delivery_failed"));
              }
            }
            if (text && parseOperatorCommand(text)) {
              if (isSelfMessage && msgKeyId && saved &&
                  Date.now() - Date.parse(saved.timestamp) < 2 * 60_000) {
                await handleOperatorCommand(this, userId, jid, true, text, msgKeyId);
              }
              continue;
            }
            if ((!isMe || (isSelfMessage && !text.startsWith("AgentX:"))) && text && !isGroupOrBroadcast) {
              console.log(`[WhatsApp] Processing message for ${userId} (from: ${jid}, text: "${text}", isSelf: ${isSelfMessage})`);
              const handledByAutomation = await handleIncomingMessage(this, userId, jid, text, !!(msg.message?.buttonsResponseMessage || msg.message?.templateButtonReplyMessage || msg.message?.interactiveResponseMessage));
              if (!handledByAutomation) {
                await handleAgentMessage(this, userId, jid, text, isSelfMessage, msgKeyId ?? undefined);
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

  public async syncMessage(
    userId: string, 
    msg: any, 
    altJid?: string,
    explicitMediaUrl?: string, 
    explicitMediaType?: string, 
    explicitMimetype?: string, 
    explicitFilename?: string,
    verifiedContactId?: string
  ): Promise<any> {
    try {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(userId)) return null;

      if (!msg.message) return null;
      
      const jid = msg.key.remoteJid;
      if (!jid) return null;

      if (jid === "status@broadcast") return null;

      let text = msg.message.conversation || 
                   msg.message.extendedTextMessage?.text || 
                   msg.message.imageMessage?.caption || 
                   msg.message.videoMessage?.caption ||
                   msg.message.documentMessage?.caption ||
                   "";

      if (!text) {
        if (msg.message.imageMessage) text = "📷 Foto";
        else if (msg.message.videoMessage) text = "🎥 Vídeo";
        else if (msg.message.audioMessage) text = "🎵 Áudio";
        else if (msg.message.documentMessage) text = "📄 Documento";
        else if (msg.message.stickerMessage) text = "🎨 Sticker";
        else if (msg.message.buttonsResponseMessage?.selectedButtonId) text = msg.message.buttonsResponseMessage.selectedButtonId;
        else if (msg.message.templateButtonReplyMessage?.selectedId) text = msg.message.templateButtonReplyMessage.selectedId;
        else if (msg.message.listResponseMessage?.singleSelectReply?.selectedRowId) text = msg.message.listResponseMessage.singleSelectReply.selectedRowId;
        else if (msg.message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
          try {
            const p = JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
            text = p.id || p.selectedId || "";
          } catch (e) {}
        }
      }

      if (!text && !explicitMediaUrl) return null;

      const isGroupOrBroadcast = jid.includes("@g.us") || 
                                 jid.includes("@broadcast") || 
                                 jid.includes("@newsletter") || 
                                 jid.startsWith("120363");

      const pushName = msg.pushName || "";
      const effectiveAltJid = altJid || msg.key?.remoteJidAlt || (msg as any).remoteJidAlt || msg.key?.participantAlt || (msg as any).participantAlt;

      let contactId = isGroupOrBroadcast ? null : verifiedContactId ?? null;
      if (!isGroupOrBroadcast && !contactId) {
        const cId = await this.getOrCreateContact(userId, jid, pushName, effectiveAltJid);
        if (cId && cId !== "unknown") {
          contactId = cId;
        }
      }
      
      // Strict deduplication: check if message with (user_id, msg_id) already exists
      const msgId = msg.key?.id;
      if (msgId) {
        const { data: existingMsg } = await supabaseAdmin
          .from("messages")
          .select("*")
          .eq("user_id", userId)
          .eq("msg_id", msgId)
          .maybeSingle();

        if (existingMsg) {
          return existingMsg;
        }
      }

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
        } else if (msg.message.stickerMessage) {
          mediaType = "sticker";
          mediaMimetype = msg.message.stickerMessage.mimetype || "image/webp";
          mediaFilename = "sticker.webp";
        }
      }

      // Download incoming media from WhatsApp if not already provided
      if (!msg.key.fromMe && !mediaUrl && (msg.message.audioMessage || msg.message.imageMessage || msg.message.videoMessage || msg.message.documentMessage || msg.message.stickerMessage)) {
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
              const ext = mediaType === "audio" ? "ogg" : mediaType === "image" ? "jpg" : mediaType === "video" ? "mp4" : mediaType === "sticker" ? "webp" : "pdf";
              const filename = `received-${Date.now()}-${Math.round(Math.random() * 1e4)}.${ext}`;
              const uploadsDir = path.join(process.cwd(), "uploads");
              if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
              const uploadsPath = path.join(uploadsDir, filename);
              fs.writeFileSync(uploadsPath, buffer);
              mediaUrl = `/uploads/${filename}`;
              console.log(`[WhatsApp] Downloaded incoming media (${mediaType}) to: ${mediaUrl}`);
            }
          }
        } catch (dlErr: any) {
          console.error("[WhatsApp] Error downloading incoming media:", dlErr.message);
        }
      }

      let tsSeconds = 0;
      if (typeof msg.messageTimestamp === "number") {
        tsSeconds = msg.messageTimestamp;
      } else if (msg.messageTimestamp && typeof msg.messageTimestamp === "object") {
        tsSeconds = (msg.messageTimestamp as any).low || (msg.messageTimestamp as any).seconds || 0;
      } else if (msg.messageTimestamp) {
        tsSeconds = parseInt(String(msg.messageTimestamp), 10) || 0;
      }
      if (!tsSeconds || isNaN(tsSeconds)) {
        tsSeconds = Math.floor(Date.now() / 1000);
      }
      const msgDate = new Date(tsSeconds * 1000);
      const validTimestamp = isNaN(msgDate.getTime()) ? new Date().toISOString() : msgDate.toISOString();

      let savedMsg = null;
      try {
        const { data: inserted, error: insertError } = await supabaseAdmin.from("messages").insert({
          user_id: userId,
          contact_id: contactId,
          text: text,
          type: msg.key.fromMe ? "outbound" : "inbound",
          timestamp: validTimestamp,
          msg_id: msgId || `gen-${Date.now()}-${Math.random().toString(36).substring(7)}`,
          media_url: mediaUrl || null,
          media_type: mediaType || null,
          media_mimetype: mediaMimetype || null,
          media_filename: mediaFilename || null,
          is_read: msg.key.fromMe ? true : false
        }).select().maybeSingle();

        if (insertError) {
          if (insertError.code === "23505" && msgId) {
            const { data: existing } = await supabaseAdmin.from("messages").select("*")
              .eq("user_id", userId).eq("msg_id", msgId).maybeSingle();
            if (existing) return existing;
          }
          console.error(`[WhatsApp] Error persisting message for user ${userId}, msg_id ${msgId}:`, insertError.message);
        } else {
          savedMsg = inserted;
        }
      } catch (err: any) {
        console.error(`[WhatsApp] Database insert exception for msg ${msgId}:`, err.message);
      }

      if (!savedMsg) return null;

      // Update contact metadata after persisting the message.
      if (contactId) {
        try {
          await supabaseAdmin
            .from("contacts")
            .update({
              last_message_at: validTimestamp,
              last_message_text: text.substring(0, 100)
            })
            .eq("id", contactId).eq("user_id", userId);
        } catch (updateErr: any) {
          console.warn("[WhatsApp] Could not update contact last_message:", updateErr.message);
        }

        // Increment unread_count safely for incoming messages
        if (!msg.key.fromMe) {
          try {
            const { data: currentContact } = await supabaseAdmin
              .from("contacts")
              .select("unread_count")
              .eq("id", contactId).eq("user_id", userId)
              .maybeSingle();
            
            await supabaseAdmin
              .from("contacts")
              .update({ unread_count: (currentContact?.unread_count || 0) + 1 })
              .eq("id", contactId).eq("user_id", userId);
          } catch (unreadErr: any) {
            console.warn("[WhatsApp] Could not increment unread_count:", unreadErr.message);
          }
        }
      }

      return savedMsg;
    } catch (err: any) {
      console.error("[WhatsApp] Sync message fatal error:", err.message);
      return null;
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

  private async syncContact(userId: string, contact: BaileysContact, isSaved = false): Promise<string | null | undefined> {
    const lid = lidFrom(contact.lid) ?? lidFrom(contact.id);
    const savedName = this.isSavedContact(contact) ? contact.name?.trim() : undefined;
    try {
      let phone = phoneFromJid(contact.id) ?? normalizeContactPhone(contact.phoneNumber);
      if (!phone && lid) {
        const mapping = this.sessions.get(userId)?.socket?.signalRepository?.lidMapping;
        phone = phoneFromJid(await mapping?.getPNForLID(`${lid}@lid`));
      }
      if (!phone) return null;
      const saved = await saveContactIdentity(userId, {
        phone, lid,
        name: savedName || contact.notify || contact.verifiedName,
        tags: ["WhatsApp"], existingOnly: !savedName && !isSaved
      });
      return saved?.id;
    } catch (error) {
      console.error("[WhatsApp] Contact import failed:", (error as { code?: string })?.code ?? "unavailable");
    }
  }

  public async getOrCreateContact(userId: string, jid: string, pushName?: string, altJid?: string): Promise<string> {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(userId)) return "unknown";
    const incomingPhone = phoneFromJid(jid);
    const incomingLid = lidFrom(jid);
    if (!incomingPhone && !incomingLid) return "unknown";

    const me = this.getMe(userId);
    const ownPhone = phoneFromJid(me?.id);
    const ownLid = lidFrom(me?.lid) ?? lidFrom(me?.id);
    if ((incomingPhone && incomingPhone === ownPhone) || (incomingLid && incomingLid === ownLid)) return "unknown";

    let phone = incomingPhone ?? phoneFromJid(altJid);
    let lid = incomingLid ?? lidFrom(altJid);
    const mapping = this.sessions.get(userId)?.socket?.signalRepository?.lidMapping;
    if (mapping) {
      try {
        if (incomingLid && !phone) phone = phoneFromJid(await mapping.getPNForLID(jid));
        if (incomingPhone && !lid) lid = lidFrom(await mapping.getLIDForPN(jid));
      } catch {
        // A real phone can be linked later when WhatsApp provides the mapping.
      }
    }
    if ((phone && phone === ownPhone) || (lid && lid === ownLid)) return "unknown";

    try {
      const name = pushName?.trim() || null;
      const saved = await saveContactIdentity(userId, { phone, lid, name, tags: ["WhatsApp"] });
      return saved?.id ?? "unknown";
    } catch (error) {
      console.error("[WhatsApp] Failed to resolve the contact:", (error as { code?: string })?.code ?? "unavailable");
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

  async sendMessage(userId: string, jid: string, text: string, mediaUrl?: string, mediaType?: string, duration?: number, mimetype?: string, fileName?: string, verifiedContactId?: string) {
    const session = await this.ensureConnection(userId);
    if (!session || session.status !== "connected") {
      throw new Error("WhatsApp session not connected.");
    }

    const isStatus = jid === "status@broadcast";
    let result;
    const options: any = {};

    if (isStatus) {
      options.backgroundColor = options.backgroundColor || "#075E54";
      options.font = options.font || 2;
      
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
      
      // Fallback: if no contacts yet, fetch user's own registered phone
      if (jidList.length === 0) {
        const { data: u } = await supabaseAdmin.from("users").select("phone").eq("id", userId).maybeSingle();
        if (u?.phone) {
          const clean = u.phone.replace(/\D/g, "");
          if (clean) jidList.push(`${clean}@s.whatsapp.net`);
        }
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
        let inputDirectory: string | undefined;
        let converted: string | undefined;
        try {
          const filename = mediaUrl.split("/uploads/").at(-1)?.split("?")[0] ?? "";
          let localPath = "";
          if (mediaUrl.includes("/uploads/") && /^[a-zA-Z0-9_.-]+$/.test(filename) && filename !== "." && filename !== "..") {
            const file = path.join(process.cwd(), "uploads", filename);
            if (fs.existsSync(file)) localPath = file;
          }
          if (!localPath) {
            const url = new URL(mediaUrl);
            const storage = new URL(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://invalid.local");
            if (url.protocol !== "https:" || url.origin !== storage.origin ||
                !url.pathname.startsWith("/storage/v1/object/")) throw new Error("Origem do áudio inválida.");
            const response = await axios.get(url.href, {
              responseType: "arraybuffer", timeout: 20000, maxContentLength: 20 * 1024 * 1024, maxRedirects: 0
            });
            inputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "agentx-audio-"));
            localPath = path.join(inputDirectory, "source");
            fs.writeFileSync(localPath, response.data);
          }
          // The voice upload endpoint already encodes these files in Opus.
          const ready = /^voice-\d+-\d+\.ogg$/.test(path.basename(localPath));
          const audioPath = ready ? localPath : (converted = await convertToOpus(localPath));
          result = await session.socket.sendMessage(jid, {
            audio: fs.readFileSync(audioPath), mimetype: "audio/ogg; codecs=opus", ptt: true, seconds: duration
          }, options);
        } finally {
          if (converted) fs.rmSync(converted, { force: true });
          if (inputDirectory) fs.rmSync(inputDirectory, { recursive: true, force: true });
        }
      } else if (mediaType === 'document') {
        result = await session.socket.sendMessage(jid, { document: { url: mediaUrl }, mimetype: mimetype || 'application/pdf', fileName: fileName || 'documento', caption: text }, options);
      }
    } else {
      result = await session.socket.sendMessage(jid, { text }, options);
    }

    // Sync the sent message back to DB if it's not a status
    let savedMsg: any = null;
    if (result?.key?.id && !isStatus) {
      savedMsg = await this.syncMessage(
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
        undefined,
        mediaUrl,
        mediaType,
        mimetype,
        fileName,
        verifiedContactId
      );
    }

    return { ...result, savedMessage: savedMsg };
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

  private async groupSocket(userId: string): Promise<WASocket> {
    const session = await this.ensureConnection(userId);
    if (!session || session.status !== "connected") throw new Error("WhatsApp não conectado");
    return session.socket;
  }

  async getGroups(userId: string) {
    return (await this.groupSocket(userId)).groupFetchAllParticipating();
  }

  async getGroupMetadata(userId: string, jid: string) {
    return (await this.groupSocket(userId)).groupMetadata(jid);
  }

  async updateGroupParticipants(userId: string, jid: string, participants: string[], action: "add" | "remove" | "promote" | "demote") {
    return (await this.groupSocket(userId)).groupParticipantsUpdate(jid, participants, action);
  }

  async updateGroupSubject(userId: string, jid: string, subject: string) {
    return (await this.groupSocket(userId)).groupUpdateSubject(jid, subject);
  }

  async updateGroupDescription(userId: string, jid: string, description: string) {
    return (await this.groupSocket(userId)).groupUpdateDescription(jid, description);
  }

  async updateGroupAccess(userId: string, jid: string, field: "announce" | "restrict" | "joinApprovalMode", enabled: boolean) {
    const socket = await this.groupSocket(userId);
    if (field === "joinApprovalMode") return socket.groupJoinApprovalMode(jid, enabled ? "on" : "off");
    if (field === "announce") return socket.groupSettingUpdate(jid, enabled ? "announcement" : "not_announcement");
    return socket.groupSettingUpdate(jid, enabled ? "locked" : "unlocked");
  }

  async getGroupInvite(userId: string, jid: string, reset = false) {
    const socket = await this.groupSocket(userId);
    return reset ? socket.groupRevokeInvite(jid) : socket.groupInviteCode(jid);
  }

  async getGroupJoinRequests(userId: string, jid: string) {
    return (await this.groupSocket(userId)).groupRequestParticipantsList(jid);
  }

  async reviewGroupJoinRequest(userId: string, jid: string, participant: string, action: "approve" | "reject") {
    return (await this.groupSocket(userId)).groupRequestParticipantsUpdate(jid, [participant], action);
  }

  async leaveGroup(userId: string, jid: string) {
    return (await this.groupSocket(userId)).groupLeave(jid);
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

  async syncCurrentSessionContacts(userId: string) {
    const session = this.sessions.get(userId);
    if (!session || session.status !== "connected") {
      throw new Error("WhatsApp não está conectado. Conecte primeiro no painel.");
    }

    const synced = new Set<string>();
    let withoutPhone = 0;
    let failed = 0;
    const cached: Map<string, BaileysContact> | undefined = (session as { contactsMap?: Map<string, BaileysContact> }).contactsMap;
    for (const contact of cached?.values() ?? []) {
      if (!this.isSavedContact(contact)) continue;
      const id = await this.syncContact(userId, contact, true);
      if (id) synced.add(id);
      else if (id === null) withoutPhone++;
      else failed++;
    }

    const { data: contacts, error } = await supabaseAdmin
      .from("contacts")
      .select("id, last_message_at")
      .eq("user_id", userId);
    if (error) throw new Error("Não foi possível consultar os contactos sincronizados.");

    return {
      success: true,
      total: contacts.length,
      savedCount: synced.size,
      activeChatsCount: contacts.filter(c => Boolean(c.last_message_at)).length,
      cleanedCount: 0,
      withoutPhone,
      failed,
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

  closeAllSessions() {
    console.log(`[WhatsApp] Gracefully closing all active sessions (${this.sessions.size} sessions)...`);
    for (const [userId, session] of this.sessions.entries()) {
      try {
        if (session.socket) {
          session.socket.end(undefined);
        }
      } catch (e) {
        console.warn(`[WhatsApp] Error closing session for user ${userId}:`, e);
      }
    }
    this.sessions.clear();
  }
}

export const whatsappManager = new WhatsAppManager();
