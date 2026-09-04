import "./loadEnv.ts";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  "https://xhnxhfhmplstqiavswgo.supabase.co"
).trim();
const supabaseServiceRoleKey = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhobnhoZmhtcGxzdHFpYXZzd2dvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDI5NjI5OCwiZXhwIjoyMDg5ODcyMjk4fQ.VGyJSSjU_8TF0Vc5ZFCMR0ZMPqprgB472P6zn6Q31rE"
).trim();

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.warn("[Supabase] WARNING: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in environment variables.");
}

// Admin client for backend operations (service role key)
export const supabaseAdmin = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseServiceRoleKey || "placeholder"
);

// Alias for convenience
export const supabase = supabaseAdmin;

if (supabaseUrl && supabaseServiceRoleKey) {
  console.log(`[Supabase Admin] Initialized successfully.`);
}
