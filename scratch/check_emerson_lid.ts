import { supabaseAdmin } from "../backend/supabaseAdmin.ts";

async function main() {
  const { data: contacts } = await supabaseAdmin
    .from("contacts")
    .select("*")
    .eq("user_id", "9744c780-39bd-48df-9a84-acaf4dec34a9")
    .order("created_at", { ascending: false })
    .limit(10);
  console.log("Recent contacts:", JSON.stringify(contacts?.map(c => ({ id: c.id, name: c.name, phone: c.phone })), null, 2));

  const { data: msgs } = await supabaseAdmin
    .from("messages")
    .select("*")
    .eq("user_id", "9744c780-39bd-48df-9a84-acaf4dec34a9")
    .order("created_at", { ascending: false })
    .limit(10);
  console.log("Recent messages:", JSON.stringify(msgs?.map(m => ({ text: m.text, type: m.type, contact_id: m.contact_id })), null, 2));
}

main().catch(console.error);
