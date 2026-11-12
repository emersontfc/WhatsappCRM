import "./loadEnv.ts";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const supabaseServiceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

if (!supabaseUrl || !supabaseServiceRoleKey) {
  const missing = [];
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!supabaseServiceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  console.error(`[Supabase Admin] CRITICAL CONFIGURATION ERROR: Mandatory environment variable(s) missing: ${missing.join(", ")}`);
  console.error("[Supabase Admin] Please provide these credentials in your .env or environment configuration.");
}

// Admin client for backend operations (service role key exclusively from environment)
export const supabaseAdmin = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseServiceRoleKey || "placeholder",
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    }
  }
);

// Alias for convenience
export const supabase = supabaseAdmin;

if (supabaseUrl && supabaseServiceRoleKey) {
  console.log(`[Supabase Admin] Initialized successfully with target: ${supabaseUrl.split("@")[0].slice(0, 20)}...`);
}
