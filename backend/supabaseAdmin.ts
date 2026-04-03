import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
const supabaseServiceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.warn("[Supabase] WARNING: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in environment variables.");
}

// Admin client for backend operations (service role key)
export const supabaseAdmin = (supabaseUrl && supabaseServiceRoleKey)
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null as any;

// Alias for convenience if needed, but we use supabaseAdmin throughout the app
export const supabase = supabaseAdmin;

if (supabaseAdmin) {
  console.log(`[Supabase Admin] Initialized successfully.`);
} else {
  console.error("[Supabase Admin] FAILED to initialize. Backend will not function correctly.");
}
