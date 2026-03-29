import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || "").trim();

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("[Supabase Auth] Missing SUPABASE_URL or SUPABASE_ANON_KEY");
}

export const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey);
