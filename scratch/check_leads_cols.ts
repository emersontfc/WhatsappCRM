import { supabaseAdmin } from "../backend/supabaseAdmin.ts";

async function main() {
  const { data: cols } = await supabaseAdmin.rpc("execute_sql", {
    query_text: "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'leads';"
  });
  console.log("Leads columns via execute_sql:", cols);

  // If execute_sql RPC doesn't exist, let's check by trying select on specific candidates
  if (!cols) {
    const candidateColumns = ["id", "user_id", "contact_id", "name", "phone", "status", "stage", "intent", "value", "created_at", "updated_at"];
    for (const c of candidateColumns) {
      const { error } = await supabaseAdmin.from("leads").select(c).limit(1);
      console.log(`Column ${c}: ${error ? 'NO: ' + error.message : 'YES'}`);
    }
  }
}

main().catch(console.error);
