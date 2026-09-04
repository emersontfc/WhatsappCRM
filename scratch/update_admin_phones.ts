import { supabaseAdmin } from "../backend/supabaseAdmin.ts";

async function main() {
  const currentAdminPhones = "258848858288, 848858288, 183889075142705, 135046774190187";
  const { data, error } = await supabaseAdmin
    .from("users")
    .update({ 
      admin_phones: currentAdminPhones,
      phone: "+258848858288"
    })
    .eq("id", "9744c780-39bd-48df-9a84-acaf4dec34a9")
    .select();

  console.log("Updated user:", data, error);
}

main().catch(console.error);
