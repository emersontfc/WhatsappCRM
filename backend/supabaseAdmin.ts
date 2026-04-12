import "./loadEnv.ts";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const supabaseServiceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

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
