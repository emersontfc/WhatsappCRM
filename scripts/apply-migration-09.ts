import "../backend/loadEnv.ts";
import { supabaseAdmin } from "../backend/supabaseAdmin.ts";
import fs from "fs";
import path from "path";

async function applyMigration() {
  console.log("Applying Migration 09: Canonical Business Profiles & Settings...");
  const sqlPath = path.join(process.cwd(), "supabase", "migrations", "09_business_profile_canonical.sql");
  const sql = fs.readFileSync(sqlPath, "utf-8");

  const { error } = await supabaseAdmin.rpc("exec_sql" as any, { sql_query: sql });
  if (error) {
    console.error("Migration 09 failed:", error);
    process.exit(1);
  }

  console.log("Migration 09 executed successfully!");

  // Verify
  const { data, error: vErr } = await supabaseAdmin
    .from("company_profile")
    .select("id, user_id, name, type, timezone, settings")
    .limit(1);

  if (vErr) {
    console.error("Verification failed:", vErr.message);
  } else {
    console.log("Verification passed: company_profile is ready with canonical fields!");
  }
}

applyMigration().catch(console.error);

