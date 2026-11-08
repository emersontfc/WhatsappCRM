// ================================================================
// AgentX / WhatsCRM SaaS - Ferramenta de Diagnóstico de Banco de Dados
// Execute com: npx tsx scripts/check-db.ts
// ================================================================

import "../backend/loadEnv.ts";
import { supabaseAdmin } from "../backend/supabaseAdmin.ts";

const REQUIRED_TABLES = [
  "plans",
  "users",
  "subscriptions",
  "contacts",
  "messages",
  "automations",
  "scheduled_messages",
  "group_rules",
  "smart_menus",
  "whatsapp_sessions",
  "leads",
  "agent_logs",
  "reminders",
  "agents",
  "scheduled_status",
  "services",
  "professionals",
  "appointments"
];

async function runCheck() {
  console.log("==================================================");
  console.log("🔍 Diagnóstico de Banco de Dados Supabase (AgentX)");
  console.log("==================================================");

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const hasServiceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);

  console.log(`URL do Supabase: ${supabaseUrl || "❌ NÃO DEFINIDA"}`);
  console.log(`Service Role Key: ${hasServiceKey ? "✅ Presente" : "❌ AUSENTE"}`);

  if (!supabaseAdmin) {
    console.error("❌ Não foi possível inicializar o cliente Supabase Admin. Verifique seu arquivo .env");
    process.exit(1);
  }

  console.log("\nVerificando tabelas obrigatórias...");
  let missingCount = 0;

  for (const table of REQUIRED_TABLES) {
    try {
      const { error } = await supabaseAdmin.from(table).select("id").limit(1);
      if (error) {
        if (error.code === "42P01" || error.code === "PGRST205" || error.message?.includes("does not exist")) {
          console.log(`  ❌ [${table}]: Tabela NÃO EXISTE no banco de dados!`);
          missingCount++;
        } else {
          console.log(`  ⚠️  [${table}]: Aviso (${error.message})`);
        }
      } else {
        console.log(`  ✅ [${table}]: Conectada e acessível.`);
      }
    } catch (err: any) {
      console.log(`  ❌ [${table}]: Erro na consulta: ${err.message}`);
      missingCount++;
    }
  }

  // Verificar planos padrão
  console.log("\nVerificando planos do SaaS...");
  try {
    const { data: plans, error: plansErr } = await supabaseAdmin.from("plans").select("name, price, max_messages_per_day");
    if (plansErr || !plans || plans.length === 0) {
      console.log("  ⚠️ Nenhum plano cadastrado na tabela 'plans'.");
    } else {
      console.log(`  ✅ ${plans.length} planos encontrados:`, plans.map(p => `${p.name} (${p.price} MT/mês)`).join(", "));
    }
  } catch (e) {}

  console.log("\n==================================================");
  if (missingCount > 0) {
    console.log(`❌ ATENÇÃO: ${missingCount} tabelas estão ausentes!`);
    console.log("Execute o arquivo 'supabase_appointments_migration.sql' e 'supabase_migration.sql'");
    console.log("no SQL Editor do seu Supabase Dashboard para criar as tabelas.");
  } else {
    console.log("🎉 PARABÉNS! Todas as tabelas e conexões estão 100% íntegras.");
  }
  console.log("==================================================");
}

runCheck().catch(err => {
  console.error("Erro fatal durante o diagnóstico:", err);
  process.exit(1);
});

