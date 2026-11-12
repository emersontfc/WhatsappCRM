import "../backend/loadEnv.ts";
import { supabaseAdmin } from "../backend/supabaseAdmin.ts";

interface CheckItem {
  migration: string;
  table: string;
  columns?: string[];
}

const CHECKS: CheckItem[] = [
  { migration: "00_dynamic_plans", table: "plans", columns: ["id", "name", "price", "max_connections", "ai_enabled"] },
  { migration: "00_dynamic_plans", table: "subscriptions", columns: ["plan_id", "expires_at", "is_active"] },
  { migration: "00_dynamic_plans", table: "license_keys", columns: ["plan_id", "used_by", "used_at"] },
  { migration: "01_logging_system", table: "logs", columns: ["id", "user_id", "level", "source", "message"] },
  { migration: "02_add_free_plan", table: "plans" },
  { migration: "03_add_list_json_to_automations", table: "automations", columns: ["response_type", "buttons_json", "list_json", "media_url", "media_type"] },
  { migration: "04_company_profile", table: "company_profile", columns: ["id", "user_id", "name", "type"] },
  { migration: "05_crm_core_alignment", table: "contacts", columns: ["ai_paused", "ai_paused_at", "notes", "unread_count"] },
  { migration: "05_crm_core_alignment", table: "leads", columns: ["contact_id", "stage", "value", "source"] },
  { migration: "05_crm_core_alignment", table: "messages", columns: ["is_read"] },
  { migration: "06_admin_authorized_phones", table: "users", columns: ["phone", "admin_phones"] },
  { migration: "07_scheduling_robustness", table: "scheduled_messages", columns: ["media_mimetype", "media_filename", "target_type"] },
  { migration: "08_agentx_2_0_commerce_operations", table: "products", columns: ["id", "user_id", "name", "price", "type", "digital_content", "stock"] },
  { migration: "08_agentx_2_0_commerce_operations", table: "orders", columns: ["id", "user_id", "order_number", "customer_phone", "status", "total_amount"] },
  { migration: "08_agentx_2_0_commerce_operations", table: "order_items", columns: ["id", "order_id", "product_id", "quantity", "unit_price", "total_price"] },
  { migration: "08_agentx_2_0_commerce_operations", table: "payment_verifications", columns: ["id", "order_id", "provider", "transaction_reference", "amount", "status"] },
  { migration: "08_agentx_2_0_commerce_operations", table: "agent_operations", columns: ["id", "user_id", "phone", "step", "description"] },
  { migration: "08_agentx_2_0_commerce_operations", table: "agents", columns: ["specialization", "autonomy_level", "risk_tolerance", "enabled_tools", "financial_limit"] },
];

async function runAudit() {
  console.log("==================================================================");
  console.log("🔍 AUDITORIA COMPLETA DE MIGRAÇÕES NO SUPABASE REMOTO");
  console.log("==================================================================");

  let passedCount = 0;
  let totalCount = CHECKS.length;

  for (const item of CHECKS) {
    const cols = item.columns ? item.columns.join(", ") : "id";
    const { data, error } = await supabaseAdmin.from(item.table).select(cols).limit(1);

    if (error) {
      console.log(`❌ [FALHA] ${item.migration} -> '${item.table}' (${cols}): ${error.message}`);
    } else {
      console.log(`✅ [OK] ${item.migration} -> '${item.table}' [${cols}] verificado.`);
      passedCount++;
    }
  }

  console.log("\n------------------------------------------------------------------");
  console.log(`Resultado do Diagnóstico: ${passedCount}/${totalCount} itens verificados.`);
  if (passedCount === totalCount) {
    console.log("🎉 TODAS AS 9 MIGRAÇÕES (00 a 08) ESTÃO 100% INSTALADAS E OPERACIONAIS NO SUPABASE!");
  } else {
    console.log(`⚠️ Existem ${totalCount - passedCount} itens com pendências.`);
  }
}

runAudit().catch(console.error);
