import { randomUUID } from "node:crypto";
import { whatsappManager } from "../../backend/whatsappManager.ts";
import { handleAgentMessage } from "../../backend/agentManager.ts";
import { handleIncomingMessage } from "../../backend/automationManager.ts";
import { processHumanHandoffs } from "../../backend/services/humanHandoff.ts";
import type { WASocket } from "@whiskeysockets/baileys";

// Only the WhatsApp transport is simulated. The app and its database client are unchanged.
const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const sessions = (whatsappManager as unknown as { sessions: Map<string, unknown> }).sessions;
let confirmSend = true;
const contactsMap = new Map([
  ["258849998888:8@s.whatsapp.net", { id: "258849998888:8@s.whatsapp.net", name: "Contacto legado" }],
  ["849998888@s.whatsapp.net", { id: "849998888@s.whatsapp.net", name: "Outra variante" }],
  ["109876543211122@lid", { id: "109876543211122@lid", name: "Número desconhecido" }],
  ["109876543211123@lid", { id: "109876543211123@lid", phoneNumber: "258831234567@s.whatsapp.net", name: "Número resolvido" }],
]);
function connectedSession(userId: string, phone: string, contacts = new Map()) {
  const groupId = "120363000000001@g.us";
  const group = phone === "258860000001" ? {
    id: groupId, subject: "Grupo de teste de campanhas", announce: true,
    participants: [{ id: `${phone}@s.whatsapp.net`, admin: "admin" }]
  } : null;
  return { status: "connected", contactsMap: contacts, socket: {
    user: { id: `${phone}:1@s.whatsapp.net`, name: "Loja de teste" },
    end() {},
    async sendPresenceUpdate() {},
    async groupFetchAllParticipating() { return group ? { [groupId]: group } : {}; },
    async groupMetadata(jid: string) { return jid === groupId && group ? group : { id: jid, participants: [] }; },
    async sendMessage(jid: string, content: unknown, options?: { statusJidList?: string[] }) {
      process.send?.({ event: "outbound", userId, jid, content, statusJidList: options?.statusJidList });
      return confirmSend ? { key: { id: `fixture-outbound-${randomUUID()}` } } : undefined;
    }
  } };
}
const ownerSession = connectedSession(owner, "258860000001", contactsMap);
const otherSession = connectedSession(other, "258860000002");
sessions.set(owner, ownerSession);
sessions.set(other, otherSession);

process.on("message", async (message: {
  event: string; requestId: string; text?: string; messageId?: string; jid?: string; altJid?: string;
  upsertType?: "notify" | "append" | "history"; account?: "owner" | "other";
  participant?: string; fromMe?: boolean; timestamp?: number;
}) => {
  if (message.event === "unconfirmed") confirmSend = false;
  if (message.event === "confirmed") confirmSend = true;
  let ok = true;
  if (message.event === "handoffs") await processHumanHandoffs(whatsappManager);
  if (message.event === "ingress" && message.text && message.messageId && message.jid) {
    const userId = message.account === "other" ? other : owner;
    const session = message.account === "other" ? otherSession : ownerSession;
    const incoming = {
      key: { id: message.messageId, remoteJid: message.jid, remoteJidAlt: message.altJid,
        participant: message.participant, fromMe: message.fromMe ?? false },
      message: { conversation: message.text },
      messageTimestamp: message.timestamp ?? Math.floor(Date.now() / 1000),
      pushName: "Cliente do teste de receção"
    };
    if (message.upsertType === "history") {
      ok = Boolean(await whatsappManager.syncMessage(userId, incoming, message.altJid));
    } else {
      await whatsappManager.handleMessageUpsert(userId, session.socket as unknown as WASocket,
        { messages: [incoming], type: message.upsertType ?? "notify" });
    }
  }
  if (message.event === "incoming") {
    const saved = await whatsappManager.syncMessage(owner, {
      key: { id: "fixture-inbound-1", remoteJid: "258840000001@s.whatsapp.net", fromMe: false },
      message: { conversation: "Olá, gostaria de saber o preço." },
      messageTimestamp: Math.floor(Date.now() / 1000),
      pushName: "Cliente de teste"
    });
    ok = Boolean(saved?.contact_id);
  }
  if ((message.event === "sales" || message.event === "inbound") && message.text && message.messageId) {
    const jid = message.jid || "258840000002@s.whatsapp.net";
    const saved = await whatsappManager.syncMessage(owner, {
      key: { id: message.messageId, remoteJid: jid, fromMe: false },
      message: { conversation: message.text }, pushName: "Cliente vendedor",
      messageTimestamp: Math.floor(Date.now() / 1000)
    }, message.altJid);
    if (saved?.contact_id) {
      const handled = await handleIncomingMessage(whatsappManager, owner, jid, message.text, false, saved.contact_id);
      if (!handled && message.event === "sales") {
        await handleAgentMessage(whatsappManager, owner, jid, message.text, false, message.messageId, saved.contact_id);
      }
    } else {
      ok = false;
    }
  }
  process.send?.({ event: "complete", requestId: message.requestId, ok });
});

await import("../../server.ts");
