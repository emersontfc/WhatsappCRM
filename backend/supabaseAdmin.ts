import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

let supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const supabaseServiceRoleKey = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

// Handle case where user only provides the project ref
if (supabaseUrl && !supabaseUrl.startsWith("http")) {
  supabaseUrl = `https://${supabaseUrl}.supabase.co`;
}

// Admin client with service role key (bypasses RLS)
// Initialize only if keys are present to avoid crash
const isValidServiceRoleKey = supabaseServiceRoleKey && supabaseServiceRoleKey.split('.').length === 3;

if (!supabaseUrl) {
  console.warn("[Supabase Admin] SUPABASE_URL is missing. Please configure it in Settings.");
}
if (!supabaseServiceRoleKey) {
  console.warn("[Supabase Admin] SUPABASE_SERVICE_ROLE_KEY is missing. Please configure it in Settings.");
} else if (!isValidServiceRoleKey) {
  console.error("[Supabase Admin] SUPABASE_SERVICE_ROLE_KEY is invalid. It should be a JWT token with 3 parts separated by dots.");
}

export const supabaseAdmin = (supabaseUrl && isValidServiceRoleKey)
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : new Proxy({}, {
      get: (target, prop) => {
        if (prop === "auth" || prop === "from") {
          return () => {
            const missing = [];
            if (!supabaseUrl) missing.push("SUPABASE_URL");
            if (!supabaseServiceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
            const msg = `Supabase Admin client not initialized. Missing: ${missing.join(", ")}. Please configure these in Settings.`;
            console.error(`[Supabase Admin Error] ${msg}`);
            throw new Error(msg);
          };
        }
        return undefined;
      }
    }) as any;

if (supabaseUrl && isValidServiceRoleKey) {
  console.log(`[Supabase Admin] Initialized for URL: ${supabaseUrl.substring(0, 15)}...`);
}
