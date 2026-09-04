import { supabaseAdmin } from "../backend/supabaseAdmin.ts";
import { runAI, robustParseAgentJSON, formatToolOutputForWhatsApp } from "../backend/agentManager.ts";
import { executeToolByName } from "../backend/tools/index.ts";

async function main() {
  const userId = "9744c780-39bd-48df-9a84-acaf4dec34a9";

  const { data: agents } = await supabaseAdmin
    .from("agents")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .single();

  const agent = agents;

  console.log("\n--- TEST 1: Admin asking for pending conversations ---");
  const t1Prompt = "Quais conversas estão pendentes de resposta no WhatsApp?";
  const r1 = await runAI(agent, t1Prompt, [], "admin");
  const p1 = robustParseAgentJSON(r1);
  console.log("AI Parsed:", p1);
  if (p1?.tool) {
    const res1 = await executeToolByName(p1.tool, p1.args || {}, {
      userId,
      phone: "258848858288",
      jid: "258848858288@s.whatsapp.net",
      role: "admin",
      whatsappManager: {},
      userPhone: "258848858288"
    });
    console.log("Tool result:", res1);
    console.log("Formatted output:\n" + formatToolOutputForWhatsApp(p1.tool, res1));
  }

  console.log("\n--- TEST 2: Customer/Lead asking for prices (Role: lead) ---");
  const t2Prompt = "Olá, quanto custa o kit de internet?";
  const r2 = await runAI(agent, t2Prompt, [], "lead");
  const p2 = robustParseAgentJSON(r2);
  console.log("AI Parsed for lead:", p2);
  console.log("Lead receives reply:\n" + (p2?.reply || r2));
}

main().catch(console.error);
