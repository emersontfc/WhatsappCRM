import { supabaseAdmin } from "../backend/supabaseAdmin.ts";
import { runAI, robustParseAgentJSON, formatToolOutputForWhatsApp } from "../backend/agentManager.ts";
import { executeToolByName } from "../backend/tools/index.ts";

async function main() {
  const userId = "9744c780-39bd-48df-9a84-acaf4dec34a9";

  const { data: agent } = await supabaseAdmin
    .from("agents")
    .select("*")
    .eq("user_id", userId)
    .single();

  const userQuery = "Mandar diretamente para mim as métricas do funil de vendas e o status do lead 848858288 para o meu WhatsApp.";
  console.log("User query:", userQuery);

  const responseText = await runAI(agent, userQuery, [], "admin");
  console.log("\nRaw LLM response:\n", responseText);

  const parsed = robustParseAgentJSON(responseText);
  console.log("\nParsed LLM response:\n", parsed);

  if (parsed?.tool) {
    const toolResult = await executeToolByName(parsed.tool, parsed.args || {}, {
      userId,
      phone: "258848858288",
      jid: "258848858288@s.whatsapp.net",
      role: "admin",
      whatsappManager: {
        sendMessage: async (uId: string, jid: string, text: string) => {
          console.log(`[WhatsApp Success Dispatch] JID: ${jid} | Message:\n${text}`);
          return { key: { id: "test-success-123" } };
        },
        getMe: () => ({ id: "258848858288:1@s.whatsapp.net" })
      },
      userPhone: "258848858288"
    });
    console.log("\nTool execution result:\n", toolResult);
    const formatted = formatToolOutputForWhatsApp(parsed.tool, toolResult);
    console.log("\nFinal user presentation:\n", (parsed.reply ? `${parsed.reply}\n\n` : "") + formatted);
  }
}

main().catch(console.error);
