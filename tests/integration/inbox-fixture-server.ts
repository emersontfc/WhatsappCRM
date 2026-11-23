import { whatsappManager } from "../../backend/whatsappManager.ts";
import { handleAgentMessage } from "../../backend/agentManager.ts";
import { handleIncomingMessage } from "../../backend/automationManager.ts";

// Only the WhatsApp transport is simulated. The app and its database client are unchanged.
const owner = "00000000-0000-4000-8000-000000000001";
const sessions = (whatsappManager as unknown as { sessions: Map<string, unknown> }).sessions;
let confirmSend = true;
let sequence = 0;
const contactsMap = new Map([
  ["258849998888:8@s.whatsapp.net", { id: "258849998888:8@s.whatsapp.net", name: "Contacto legado" }],
  ["849998888@s.whatsapp.net", { id: "849998888@s.whatsapp.net", name: "Outra variante" }],
  ["109876543211122@lid", { id: "109876543211122@lid", name: "Número desconhecido" }],
  ["109876543211123@lid", { id: "109876543211123@lid", phoneNumber: "258831234567@s.whatsapp.net", name: "Número resolvido" }],
]);
function connectedSession(phone: string, contacts = new Map()) {
  return { status: "connected", contactsMap: contacts, socket: {
    user: { id: `${phone}:1@s.whatsapp.net`, name: "Loja de teste" },
    end() {},
    async sendPresenceUpdate() {},
    async sendMessage(jid: string, content: unknown) {
      process.send?.({ event: "outbound", jid, content });
      return confirmSend ? { key: { id: `fixture-outbound-${++sequence}` } } : undefined;
    }
  } };
}
sessions.set(owner, connectedSession("258860000001", contactsMap));
sessions.set("00000000-0000-4000-8000-000000000002", connectedSession("258860000002"));

process.on("message", async (message: {
  event: string; requestId: string; text?: string; messageId?: string; jid?: string; altJid?: string;
}) => {
  if (message.event === "unconfirmed") confirmSend = false;
  let ok = true;
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
