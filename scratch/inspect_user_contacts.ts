import { supabaseAdmin } from "../backend/supabaseAdmin.ts";

async function main() {
  const userId = "9744c780-39bd-48df-9a84-acaf4dec34a9";

  const { count, error } = await supabaseAdmin
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  console.log("Total contacts for user:", count);

  const { data: sample } = await supabaseAdmin
    .from("contacts")
    .select("id, name, phone, tags, last_message_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  console.log("Sample 20 contacts:", JSON.stringify(sample, null, 2));

  // Count how many have names vs don't have names
  const { count: withName } = await supabaseAdmin
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .not("name", "is", null)
    .neq("name", "");

  console.log("Contacts with non-empty name:", withName);
}

main().catch(console.error);
