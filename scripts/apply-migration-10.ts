import "../backend/loadEnv.ts";
import { supabaseAdmin } from "../backend/supabaseAdmin.ts";
import fs from "fs";
import path from "path";

async function applyMigration() {
  console.log("Applying Migration 10: WhatsApp Baileys 7 LID & Messaging Architecture Fix...");
  const sqlPath = path.join(process.cwd(), "supabase", "migrations", "10_contacts_lid_support.sql");
  const sql = fs.readFileSync(sqlPath, "utf-8");

  const { error } = await supabaseAdmin.rpc("exec_sql" as any, { sql_query: sql });
  if (error) {
    console.error("Migration 10 failed:", error);
    return;
  }

  console.log("Migration 10 executed successfully!");

  // Verify columns
  const { data: contacts, error: cErr } = await supabaseAdmin
    .from("contacts")
    .select("id, user_id, name, phone, lid")
    .limit(1);

  if (cErr) {
    console.error("Verification failed for contacts:", cErr.message);
  } else {
    console.log("Verification passed: contacts table now supports 'lid'!");
  }
}

applyMigration().catch(console.error);
