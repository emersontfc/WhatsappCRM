import { isGroupJid, moderateGroupMessage, welcomeGroupParticipants } from "./services/groupModeration.ts";
import { GROUP_PROOF_LIMIT, groupProofOrderNumber, processGroupPaymentProof } from "./services/groupPaymentProofs.ts";
import { alertOperator, handleOperatorCommand, isOperatorSelfChat, parseOperatorCommand } from "./services/whatsappOperator.ts";
import makeWASocket, {
  Contact as BaileysContact,
  downloadMediaMessage,
  extractMessageContent,
  type BaileysEventMap,
  type WASocket,
  type WAMessage,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import { supabaseAdmin } from "./supabaseAdmin.ts";
import { handleIncomingMessage } from "./automationManager.ts";
import { handleAgentMessage } from "./agentManager.ts";
import { useSupabaseAuthState, clearSupabaseAuthCache } from "./lib/supabaseAuthState.ts";
import fs from "fs";
import path from "path";
import { prepareWhatsAppVoice } from "./utils/whatsappVoice.ts";
import { WHATSAPP_VOICE_MIME, ownedVoiceFilename } from "../shared/voiceAudio.ts";
import type { IWhatsAppTransport, StoredWhatsAppQuote } from "./lib/whatsappTransport.ts";
import { normalizeContactPhone } from "../shared/contactPhone.ts";
import { saveContactIdentity } from "./services/contactIdentity.ts";
import { claimWhatsAppAction } from "./services/whatsappActionClaims.ts";
import { captureCatalogCampaignInterest, readCatalogCampaignCode } from "./services/catalogCampaignAttribution.ts";
import { whatsappDisconnectAction, whatsappWebVersion } from "./services/whatsappConnectionPolicy.ts";

const logger = pino({ level: "silent" });
const lidFrom = (jid?: string | null) => /^(\d{5,20})(?::\d+)?@lid$/i.exec(jid ?? "")?.[1] ?? null;
const phoneFromJid = (jid?: string | null) => /@(?:s\.whatsapp\.net|c\.us)$/i.test(jid ?? "") ? normalizeContactPhone(jid) : null;

async function loadGroupProofMedia(msg: WAMessage, length: number) {
  if (length > GROUP_PROOF_LIMIT) throw new Error("Group proof exceeds file limit");
  const stream = await downloadMediaMessage(msg, "stream", { options: { signal: AbortSignal.timeout(12_000) } });
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > GROUP_PROOF_LIMIT) throw new Error("Group proof exceeds file limit");
      chunks.push(bytes);
    }
    return Buffer.concat(chunks, size);
  } finally {
    stream.destroy();
  }
}

export class WhatsAppManager implements IWhatsAppTransport {
  private sessions: Map<string, { socket: any; status: string; qr?: string; pairingCode?: string; createdAt?: number }> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private restartRequiredAttempts: Map<string, number> = new Map();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private manualReconnect = new Set<string>();
  private startingConnections = new Map<string, Promise<WASocket | undefined>>();
  private maxReconnectAttempts = 5;

  private cancelReconnect(userId: string) {
    const timer = this.reconnectTimers.get(userId);
    if (timer) clearTimeout(timer);
    this.reconnectTimers.delete(userId);
  }

  private queueReconnect(userId: string, onUpdate: ((status: string, data?: string) => void) | undefined, delay: number) {
    this.cancelReconnect(userId);
    this.reconnectTimers.set(userId, setTimeout(() => {
      this.reconnectTimers.delete(userId);
      void this.createSession(userId, onUpdate);
    }, delay));
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
      }).abortSignal(AbortSignal.timeout(4_000));
    } catch (err) {
      console.error("Error logging to Supabase:", err);
    }
  }

  public getActiveSessionsCount(userId: string): number {
    const session = this.sessions.get(userId);
    return session && session.status === "connected" ? 1 : 0;
  }

  createSession(userId: string, onUpdate?: (status: string, data?: string) => void) {
    const active = this.startingConnections.get(userId);
    if (active) return active;
    if (this.reconnectTimers.has(userId)) return Promise.resolve(undefined);
    const connecting = this.openSession(userId, onUpdate).finally(() => this.startingConnections.delete(userId));
    this.startingConnections.set(userId, connecting);
    return connecting;
  }

  private async openSession(userId: string, onUpdate?: (status: string, data?: string) => void): Promise<WASocket | undefined> {
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
          this.sessions.delete(userId);
          try { existingSession.socket.end(undefined); } catch (e) {}
        } else {
          console.log(`[WhatsApp] Session already exists for ${userId} with status: ${existingSession.status}`);
          return existingSession.socket;
        }
      }

      this.cancelReconnect(userId);
      if (this.manualReconnect.delete(userId)) {
        this.reconnectAttempts.delete(userId);
        this.restartRequiredAttempts.delete(userId);
      }
      const attempts = this.reconnectAttempts.get(userId) || 0;

      console.log(`[WhatsApp] Creating new session for ${userId} (Attempt ${attempts + 1})`);
      await this.log(userId, "info", `Iniciando conexão WhatsApp (Tentativa ${attempts + 1})...`);
      
      const { state, saveCreds } = await useSupabaseAuthState(userId);
      console.log(`[WhatsApp] Auth state loaded for ${userId}`);
      
      const version = await whatsappWebVersion();

      const socket = makeWASocket({
        ...(version && { version }),
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
        if (session?.socket === socket && session.status === "connecting") {
          this.sessions.delete(userId);
          try { socket.end(undefined); } catch (e) {}
          await this.log(userId, "warn", "O WhatsApp demorou a estabelecer a conexão. Tenta novamente.");
          onUpdate?.("disconnected");
        }
      }, 65000);

      socket.ev.on("creds.update", async () => {
        if (this.sessions.get(userId)?.socket !== socket) return;
        console.log(`[WhatsApp] Creds updated for ${userId}`);
        await saveCreds();
      });

      socket.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;
        const session = this.sessions.get(userId);
        if (session?.socket !== socket) return;

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
          clearTimeout(watchdog);
          if (this.sessions.get(userId)?.socket !== socket) return;
          const boomErr = lastDisconnect?.error as Boom | undefined;
          const statusCode = boomErr?.output?.statusCode;
          const reason = boomErr?.message || "Unknown reason";
          this.sessions.delete(userId);
          try { socket.end(undefined); } catch (e) {}

          const action = whatsappDisconnectAction(statusCode, reason);
          if (action === "restart") {
            const restartAttempts = (this.restartRequiredAttempts.get(userId) || 0) + 1;
            this.restartRequiredAttempts.set(userId, restartAttempts);
            if (restartAttempts <= this.maxReconnectAttempts) {
              this.queueReconnect(userId, onUpdate, Math.min(3_000 * 2 ** (restartAttempts - 1), 30_000));
              return;
            }
          } else if (action === "retry") {
            const previousFailures = this.reconnectAttempts.get(userId) ?? 0;
            if (previousFailures < this.maxReconnectAttempts) {
              this.reconnectAttempts.set(userId, previousFailures + 1);
              this.queueReconnect(userId, onUpdate, Math.min(5_000 * 2 ** previousFailures, 30_000));
              return;
            }
          }

          this.manualReconnect.add(userId);
          if (action === "logged_out") {
            await supabaseAdmin.from("whatsapp_sessions").delete().eq("user_id", userId);
            clearSupabaseAuthCache(userId);
            await this.log(userId, "warn", "Sessão encerrada ou expirada. Volta a ligar o WhatsApp.");
          } else {
            const message = action === "replaced" ? "O WhatsApp informou que a sessão foi substituída. Verifica os dispositivos ligados."
              : "As tentativas automáticas de ligação terminaram. Verifica a ligação ao WhatsApp.";
            await this.log(userId, "warn", message, { code: statusCode ?? null });
          }
          onUpdate?.("disconnected");
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

      socket.ev.on("messages.upsert", (update) => {
        if (this.sessions.get(userId)?.socket === socket) void this.handleMessageUpsert(userId, socket, update);
      });

      return socket;
    } catch (err: any) {
      console.error(`[WhatsApp] Failed to create session for ${userId}:`, err);
      await this.log(userId, "error", `Erro ao iniciar sessão: ${err.message}`);
      onUpdate?.("disconnected");
    }
  }

  async handleMessageUpsert(userId: string, socket: WASocket, { messages, type }: BaileysEventMap["messages.upsert"]) {
    console.log(`[WhatsApp] messages.upsert triggered for ${userId}, type: ${type}, count: ${messages.length}`);
    if (type !== "notify" && type !== "append") return;
    for (const msg of messages) {
      try {
        const msgKeyId = msg.key?.id;
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
        if (isGroupJid(jid)) {
          const content = extractMessageContent(msg.message);
          const media = content?.imageMessage ?? content?.documentMessage;
          const proofText = content?.conversation || content?.extendedTextMessage?.text ||
            content?.imageMessage?.caption || content?.documentMessage?.caption || "";
          if (!isMe && groupProofOrderNumber(proofText, Boolean(media))) {
            if (type === "notify") {
              void processGroupPaymentProof({ userId, jid, key: msg.key, text: proofText, linked: socket.user,
                loadGroup: () => socket.groupMetadata(jid), attachment: media ? {
                  filename: content?.documentMessage?.fileName ?? undefined,
                  load: () => loadGroupProofMedia(msg, Number(media.fileLength ?? 0))
                } : undefined }).catch(() => console.warn("[GroupProofs] Could not process a group proof"));
            }
          } else {
            await this.syncMessage(userId, msg);
          }
          if (type === "notify") await moderateGroupMessage(socket, userId, jid, msg.key, proofText || text);
          continue;
        }

        // Ignora status de outras pessoas para não poluir o log nem ativar a automação/IA
        if (jid === "status@broadcast" && !isMe) {
          continue;
        }

        const altJid = msg.key?.remoteJidAlt || (msg as any).remoteJidAlt || msg.key?.participantAlt || (msg as any).participantAlt;
        const saved = await this.syncMessage(userId, msg, altJid, undefined, undefined, undefined, undefined, undefined,
          { liveIngress: true });
        if (type !== "notify" || saved?.agentx_live_ingress !== true || !msgKeyId) continue;

        // If it's a message sent to self ("chat with yourself" / notes), allow automations and agent to process
        const isSelfMessage = isOperatorSelfChat(jid, Boolean(isMe), this.getMe(userId));
        const isBroadcast = jid.includes("@broadcast") || jid.includes("@newsletter") || jid.startsWith("120363");

        if (isBroadcast || (isMe && !isSelfMessage)) continue;
        const age = Date.now() - Date.parse(saved.timestamp);
        const alert = !isMe && saved.contact_id && age < 5 * 60_000;
        const command = Boolean(text && parseOperatorCommand(text));
        const runCommand = command && isSelfMessage && age < 2 * 60_000;
        const runAssistant = !command && Boolean(text) && (!isMe || !text.startsWith("AgentX:"));
        if (!alert && !runCommand && !runAssistant) continue;

        // The independent, idempotent CRM write may be recovered by a replay even
        // when delivery of an automated response is already reserved.
        const campaignCode = runAssistant && !isMe && saved.contact_id && /@(?:s\.whatsapp\.net|c\.us|lid)$/.test(jid)
          ? readCatalogCampaignCode(text) : null;
        if (campaignCode) {
          await captureCatalogCampaignInterest(userId, saved.contact_id, text, msgKeyId).catch((error) => {
            console.warn("[CatalogCampaigns] Could not capture incoming interest", error?.code);
          });
          text = text.replace(new RegExp(`\\b${campaignCode}\\b`, "gi"), "").trim() || "Tenho interesse na campanha.";
        }

        if (!await claimWhatsAppAction(userId, msgKeyId)) continue;

        if (alert) {
          void alertOperator(this, userId, saved.contact_id)
            .catch((error) => console.warn("[WhatsApp] Could not send contact alert:", error?.code || "delivery_failed"));
        }
        if (runCommand) {
          await handleOperatorCommand(this, userId, jid, true, text, msgKeyId);
          continue;
        }
        if (runAssistant) {
          const isButton = Boolean(msg.message?.buttonsResponseMessage || msg.message?.templateButtonReplyMessage || msg.message?.interactiveResponseMessage);
          const handledByAutomation = await handleIncomingMessage(this, userId, jid, text, isButton,
            isMe ? null : saved?.contact_id);
          if (!handledByAutomation) {
            await handleAgentMessage(this, userId, jid, text, isSelfMessage, msgKeyId ?? undefined, saved?.contact_id);
          }
        }
      } catch (err) {
        console.error("Error processing message:", err);
      }
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
    verifiedContactId?: string,
    options: { liveIngress?: boolean; replyToMessageId?: string } = {}
  ): Promise<any> {
    try {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(userId)) return null;

      if (!msg.message) return null;
      
      const jid = msg.key.remoteJid;
      if (!jid) return null;

      if (jid === "status@broadcast") return null;
      const groupMessage = isGroupJid(jid);
      if (groupMessage && !msg.key.fromMe) {
        const content = extractMessageContent(msg.message);
        const caption = content?.conversation || content?.extendedTextMessage?.text ||
          content?.imageMessage?.caption || content?.documentMessage?.caption || "";
        if (groupProofOrderNumber(caption, Boolean(content?.imageMessage || content?.documentMessage))) return null;
      }

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
      
      const msgId = msg.key?.id;
      const findExisting = async () => {
        const { data: existingMsg } = await supabaseAdmin
          .from("messages")
          .select("*")
          .eq("user_id", userId)
          .eq("msg_id", msgId)
          .maybeSingle();

        // A WhatsApp echo can arrive before the direct sender saves the quoted reply.
        if (!existingMsg || !options.replyToMessageId || !msg.key.fromMe || !contactId ||
            existingMsg.contact_id !== contactId || existingMsg.reply_to_message_id) return existingMsg;
        const { data: updated, error } = await supabaseAdmin.from("messages")
          .update({ reply_to_message_id: options.replyToMessageId })
          .eq("id", existingMsg.id).eq("user_id", userId).eq("contact_id", contactId)
          .is("reply_to_message_id", null).select().maybeSingle();
        if (error) console.warn("[WhatsApp] Could not record quoted reply", error.code);
        return updated ?? existingMsg;
      };
      if (msgId) {
        const existingMsg = await findExisting();
        if (existingMsg) return existingMsg;
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
      if (!groupMessage && !msg.key.fromMe && !mediaUrl && (msg.message.audioMessage || msg.message.imageMessage || msg.message.videoMessage || msg.message.documentMessage || msg.message.stickerMessage)) {
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
          ...(options.liveIngress && { agentx_live_ingress: true }),
          ...(options.replyToMessageId && { reply_to_message_id: options.replyToMessageId }),
          is_read: msg.key.fromMe ? true : false
        }).select().maybeSingle();

        if (insertError) {
          if (insertError.code === "23505" && msgId) {
            const existing = await findExisting();
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
      if (this.manualReconnect.has(userId) || this.reconnectTimers.has(userId)) return session;
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

  async sendMessage(userId: string, jid: string, text: string, media?: string | Buffer, mediaType?: string, duration?: number, mimetype?: string, fileName?: string, verifiedContactId?: string, quote?: StoredWhatsAppQuote) {
    const session = await this.ensureConnection(userId);
    if (!session || session.status !== "connected") {
      throw new Error("WhatsApp session not connected.");
    }

    const isStatus = jid === "status@broadcast";
    const mediaUrl = typeof media === "string" ? media : undefined;
    let result;
    const options: any = {};
    if (quote) options.quoted = quote.message;

    if (isStatus) {
      options.backgroundColor = options.backgroundColor || "#075E54";
      options.font = options.font || 2;
      
      // Keep the audience scoped to this account and use canonical WhatsApp addresses.
      const { data: contacts } = await supabaseAdmin
        .from("contacts")
        .select("phone,lid")
        .eq("user_id", userId)
        .not("phone", "is", null);

      const audience = new Set<string>();
      for (const contact of contacts ?? []) {
        const phone = normalizeContactPhone(contact.phone);
        const lid = lidFrom(contact.lid) ?? contact.lid;
        if (phone && phone !== lid) audience.add(`${phone}@s.whatsapp.net`);
      }
      const me = session.socket.user;
      const ownPhone = phoneFromJid(me?.id) ?? phoneFromJid(me?.phoneNumber);
      const ownLid = lidFrom(me?.id) ?? lidFrom(me?.lid);
      if (ownPhone) audience.add(`${ownPhone}@s.whatsapp.net`);
      else if (ownLid) audience.add(`${ownLid}@lid`);

      if (!audience.size) {
        const { data: u } = await supabaseAdmin.from("users").select("phone").eq("id", userId).maybeSingle();
        const phone = normalizeContactPhone(u?.phone);
        if (phone) audience.add(`${phone}@s.whatsapp.net`);
      }
      options.statusJidList = [...audience];
    }

    if (media && mediaType) {
      if (mediaType === "document") {
        result = await session.socket.sendMessage(jid, {
          document: typeof media === "string" ? { url: media } : media,
          mimetype: mimetype || "application/pdf", fileName: fileName || "documento", caption: text
        }, options);
      } else if (mediaType === 'image') {
        result = await session.socket.sendMessage(jid, { 
          image: typeof media === "string" ? { url: media } : media,
          mimetype,
          caption: text,
        }, options);
      } else if (!mediaUrl) {
        throw new Error("Conteúdo de multimédia inválido.");
      } else if (mediaType === 'video') {
        result = await session.socket.sendMessage(jid, { 
          video: { url: mediaUrl }, 
          caption: text,
        }, options);
      } else if (mediaType === 'audio') {
        const voice = await prepareWhatsAppVoice(userId, mediaUrl, duration);
        result = await session.socket.sendMessage(jid, voice, options);
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
            audioMessage: mediaType === 'audio' ? { mimetype: WHATSAPP_VOICE_MIME } : undefined,
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
        mediaType === "audio" && ownedVoiceFilename(mediaUrl ?? "") ? WHATSAPP_VOICE_MIME : mimetype,
        fileName,
        verifiedContactId,
        { replyToMessageId: quote?.messageId }
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
    await this.startingConnections.get(userId);
    this.cancelReconnect(userId);
    this.manualReconnect.add(userId);
    const session = this.sessions.get(userId);
    if (session) {
      this.sessions.delete(userId);
      try {
        session.socket.end(undefined);
      } catch (e) {}
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
    await this.startingConnections.get(userId);
    this.cancelReconnect(userId);
    this.manualReconnect.delete(userId);
    this.reconnectAttempts.delete(userId);
    this.restartRequiredAttempts.delete(userId);
    const session = this.sessions.get(userId);
    if (session) {
      this.sessions.delete(userId);
      try {
        session.socket.end(undefined);
      } catch (e) {}
    }
    await supabaseAdmin.from("whatsapp_sessions").delete().eq("user_id", userId);
    clearSupabaseAuthCache(userId);
  }

  getSessionStatus(userId: string) {
    const session = this.sessions.get(userId);
    if (session) return session.status;
    return this.startingConnections.has(userId) || this.reconnectTimers.has(userId) ? "connecting" : "disconnected";
  }

  closeAllSessions() {
    console.log(`[WhatsApp] Gracefully closing all active sessions (${this.sessions.size} sessions)...`);
    for (const userId of this.reconnectTimers.keys()) this.cancelReconnect(userId);
    const active = [...this.sessions];
    this.sessions.clear();
    for (const [userId, session] of active) {
      try {
        if (session.socket) {
          session.socket.end(undefined);
        }
      } catch (e) {
        console.warn(`[WhatsApp] Error closing session for user ${userId}:`, e);
      }
    }
  }
}

export const whatsappManager = new WhatsAppManager();
