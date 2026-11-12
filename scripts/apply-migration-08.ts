import "../backend/loadEnv.ts";
import { supabaseAdmin } from "../backend/supabaseAdmin.ts";
import fs from "fs";
import path from "path";

async function applyMigration() {
  console.log("Applying Migration 08: Kazix AgentX 2.0 Commerce & Operations...");
  const sqlPath = path.join(process.cwd(), "supabase", "migrations", "08_agentx_2_0_commerce_operations.sql");
  const sql = fs.readFileSync(sqlPath, "utf-8");

  const { data, error } = await supabaseAdmin.rpc("exec_sql" as any, { sql_query: sql });
  if (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }

  console.log("Migration executed successfully. Verifying tables...");
  
  const tables = ["products", "orders", "order_items", "payment_verifications", "agent_operations"];
  for (const t of tables) {
    const { error: tErr } = await supabaseAdmin.from(t).select("id").limit(1);
    if (tErr) {
      console.log(`❌ [${t}]: Error: ${tErr.message}`);
    } else {
      console.log(`✅ [${t}]: Table exists and is queryable!`);
    }
  }

  // Check agent columns
  const { data: agentCol, error: aErr } = await supabaseAdmin.from("agents").select("specialization, autonomy_level, enabled_tools").limit(1);
  if (aErr) {
    console.log(`❌ [agents columns]: Error: ${aErr.message}`);
  } else {
    console.log(`✅ [agents columns]: specialization, autonomy_level, enabled_tools are available!`);
  }
}

applyMigration().catch(console.error);
