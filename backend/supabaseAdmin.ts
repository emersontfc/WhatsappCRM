import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
const supabaseServiceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Missing Supabase Admin environment variables");
}

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

console.log(`[Supabase Admin] Initialized for URL: ${supabaseUrl.substring(0, 15)}...`);
