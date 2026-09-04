import { supabaseAdmin } from "../backend/supabaseAdmin.ts";
import { executeToolByName } from "../backend/tools/index.ts";

async function main() {
  const userId = "9744c780-39bd-48df-9a84-acaf4dec34a9";

  const fakeWhatsappManager = {
    sendMessage: async (uId: string, jid: string, text: string) => {
      console.log(`[MOCK Baileys sendMessage] Sending to "${jid}": "${text.substring(0, 100)}..."`);
      return { key: { id: "mock-msg-123" } };
    },
    getMe: () => ({ id: "258848858288:1@s.whatsapp.net" })
  };

  const ctx = {
    userId,
    phone: "258848858288",
    jid: "258848858288@s.whatsapp.net",
    role: "admin" as const,
    whatsappManager: fakeWhatsappManager,
    userPhone: "258848858288"
  };

  console.log("=== CASE 1: args is empty object {} ===");
  const res1 = await executeToolByName("send_direct_message", {}, ctx);
  console.log("Result 1:", res1);

  console.log("\n=== CASE 2: recipient is 9-digit '848858288' ===");
  const res2 = await executeToolByName("send_direct_message", { recipient: "848858288", message: "Olá, métricas prontas!" }, ctx);
  console.log("Result 2:", res2);

  console.log("\n=== CASE 3: recipient is 'mim' (self) ===");
  const res3 = await executeToolByName("send_direct_message", { recipient: "mim", message: "Aqui estão seus dados" }, ctx);
  console.log("Result 3:", res3);
}

main().catch(console.error);
