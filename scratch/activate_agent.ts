import { supabaseAdmin } from "../backend/supabaseAdmin.ts";

async function main() {
  const { data, error } = await supabaseAdmin
    .from("agents")
    .update({ is_active: true })
    .eq("id", "bb4376f4-1281-47e5-a85d-2c037fc9f87c")
    .select();
  console.log("Updated agent:", data, error);
}

main().catch(console.error);
