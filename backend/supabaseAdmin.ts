import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const supabaseServiceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

// Handle case where user only provides the project ref
let finalSupabaseUrl = supabaseUrl;
if (finalSupabaseUrl && !finalSupabaseUrl.startsWith("http")) {
  finalSupabaseUrl = `https://${finalSupabaseUrl}.supabase.co`;
}

if (!finalSupabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Missing Supabase Admin environment variables");
}

export const supabaseAdmin = createClient(finalSupabaseUrl, supabaseServiceRoleKey);

console.log(`[Supabase Admin] Initialized for URL: ${finalSupabaseUrl.substring(0, 15)}...`);
