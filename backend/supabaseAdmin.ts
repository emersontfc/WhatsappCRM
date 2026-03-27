import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

let supabaseUrl = (process.env.VITE_SUPABASE_URL || "").trim();
const supabaseServiceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

// Handle case where user only provides the project ref
if (supabaseUrl && !supabaseUrl.startsWith("http")) {
  supabaseUrl = `https://${supabaseUrl}.supabase.co`;
}

// Admin client with service role key (bypasses RLS)
// Initialize only if keys are present to avoid crash
const isValidServiceRoleKey = supabaseServiceRoleKey && supabaseServiceRoleKey.split('.').length === 3;

export const supabaseAdmin = (supabaseUrl && isValidServiceRoleKey)
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : new Proxy({}, {
      get: () => {
        throw new Error("Supabase Admin client not initialized. Please configure VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Settings.");
      }
    }) as any;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.warn("Supabase URL or Service Role Key is missing. Please configure them in Settings.");
} else if (!isValidServiceRoleKey) {
  console.error("Supabase Service Role Key is invalid. It should be a JWT token with 3 parts separated by dots.");
}
