import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "").trim();
const supabaseServiceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

// Handle case where user only provides the project ref
let finalSupabaseUrl = supabaseUrl;
if (finalSupabaseUrl && !finalSupabaseUrl.startsWith("http")) {
  finalSupabaseUrl = `https://${finalSupabaseUrl}.supabase.co`;
}

console.log("[Supabase] Initializing clients...");
console.log("[Supabase] URL present:", !!finalSupabaseUrl);
console.log("[Supabase] ANON_KEY present:", !!supabaseAnonKey);
console.log("[Supabase] SERVICE_ROLE_KEY present:", !!supabaseServiceRoleKey);

if (!finalSupabaseUrl) {
  console.warn("[Supabase] CRITICAL: SUPABASE_URL is missing. Backend functionality will be limited.");
}

// Client for public/auth operations (anon key)
export const supabaseClient = finalSupabaseUrl && supabaseAnonKey 
  ? createClient(finalSupabaseUrl, supabaseAnonKey)
  : null;

// Admin client for backend operations (service role key)
export const supabaseAdmin = finalSupabaseUrl && supabaseServiceRoleKey
  ? createClient(finalSupabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null as any;

if (supabaseAdmin) {
  console.log(`[Supabase Admin] Initialized for URL: ${finalSupabaseUrl.substring(0, 15)}...`);
} else {
  console.warn("[Supabase Admin] FAILED to initialize. SERVICE_ROLE_KEY may be missing.");
}
