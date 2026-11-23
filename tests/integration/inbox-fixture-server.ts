import { whatsappManager } from "../../backend/whatsappManager.ts";

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
sessions.set(owner, { status: "connected", contactsMap, socket: {
  user: { id: "258860000001:1@s.whatsapp.net", name: "Loja de teste" },
  end() {},
  async sendMessage(jid: string, content: unknown) {
    process.send?.({ event: "outbound", jid, content });
    return confirmSend ? { key: { id: `fixture-outbound-${++sequence}` } } : undefined;
  }
} });

process.on("message", async (message: { event: string; requestId: string }) => {
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
  process.send?.({ event: "complete", requestId: message.requestId, ok });
});

await import("../../server.ts");
