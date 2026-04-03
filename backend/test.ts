import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "./supabaseAdmin.ts";
import dotenv from "dotenv";
dotenv.config();

const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "").trim();

let finalSupabaseUrl = supabaseUrl;
if (finalSupabaseUrl && !finalSupabaseUrl.startsWith("http")) {
  finalSupabaseUrl = `https://${finalSupabaseUrl}.supabase.co`;
}

const supabaseAuth = createClient(finalSupabaseUrl, supabaseAnonKey);

async function testAuth() {
  console.log("Testing Auth...");
  let userId = null;
  try {
    // 1. Create a test user
    const email = `testuser${Date.now()}@gmail.com`;
    const password = "Password123!";
    
    console.log(`Creating user ${email}...`);
    const { data: adminData, error: adminError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });
    
    if (adminError) {
      console.error("Admin create user error:", adminError);
      return;
    }
    
    userId = adminData.user.id;
    
    // 2. Sign in
    console.log("Signing in...");
    const { data: signInData, error: signInError } = await supabaseAuth.auth.signInWithPassword({
      email,
      password,
    });
    
    if (signInError) {
      console.error("Sign in error:", signInError);
      return;
    }
    
    const token = signInData.session?.access_token;
    if (!token) {
      console.error("No token returned from sign in");
      return;
    }
    
    console.log("Got token:", token.substring(0, 20) + "...");
    
    // 3. Test getUser with supabaseAuth
    console.log("Testing supabaseAuth.auth.getUser...");
    const { data: authData, error: authError } = await supabaseAuth.auth.getUser(token);
    console.log("supabaseAuth result:", authError ? authError.message : "Success");
    
    // 4. Test getUser with supabaseAdmin
    console.log("Testing supabaseAdmin.auth.getUser...");
    const { data: adminAuthData, error: adminAuthError } = await supabaseAdmin.auth.getUser(token);
    console.log("supabaseAdmin result:", adminAuthError ? adminAuthError.message : "Success");
    
  } catch (err) {
    console.error("Error:", err);
  } finally {
    // 5. Cleanup
    if (userId) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      console.log("Test user deleted.");
    }
  }
}

testAuth();





