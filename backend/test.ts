import { createClient } from "@supabase/supabase-js";
const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();

async function test() {
  console.log("Testing createClient with empty key for auth.getUser...");
  const supabaseAuth = createClient(supabaseUrl, "");
  try {
    // This should fail with an invalid token, but it should at least call the API
    const { data, error } = await supabaseAuth.auth.getUser("invalid-token");
    console.log("Result:", { data, error });
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
