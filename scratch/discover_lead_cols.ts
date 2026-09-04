import { supabaseAdmin } from "../backend/supabaseAdmin.ts";

async function main() {
  // Test insert with minimal columns
  const testPayload = {
    user_id: "9744c780-39bd-48df-9a84-acaf4dec34a9",
    name: "Test Lead",
    phone: "258849999999",
    status: "new"
  };

  const { data, error } = await supabaseAdmin.from("leads").insert(testPayload).select();
  console.log("Insert result:", data, error);

  if (data && data.length > 0) {
    console.log("Existing columns on returned row:", Object.keys(data[0]));
    // Clean up
    await supabaseAdmin.from("leads").delete().eq("id", data[0].id);
  }
}

main().catch(console.error);
