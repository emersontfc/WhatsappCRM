import { supabaseAdmin } from "../backend/supabaseAdmin.ts";

async function main() {
  const { data: agents } = await supabaseAdmin
    .from("agents")
    .select("*");
  console.log("All agents in DB:", JSON.stringify(agents, null, 2));
}

main().catch(console.error);
