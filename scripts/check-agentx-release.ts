import "../backend/loadEnv.ts";
import path from "node:path";
import { frontendProblem } from "../backend/services/releaseReadiness.ts";

const messages = {
  public_key_required: "VITE_SUPABASE_ANON_KEY deve conter a chave pública publishable ou anon do Supabase.",
  project_url_required: "Configura o endereço do projeto Supabase na VPS.",
  project_mismatch: "O painel e a API estão configurados para projetos Supabase diferentes.",
  frontend_missing: "A compilação do painel está em falta na imagem."
} as const;

async function check() {
  const problem = frontendProblem(process.env, path.join(process.cwd(), "dist", "index.html"));
  if (problem) return messages[problem];

  const { supabaseAdmin, supabaseAdminConfigured } = await import("../backend/supabaseAdmin.ts");
  if (!supabaseAdminConfigured) return "Configura SUPABASE_SERVICE_ROLE_KEY com a chave privada do backend.";
  const { makePlatformChecks } = await import("../backend/services/platformChecks.ts");
  const checks = makePlatformChecks(true);
  const [crm, sales, agenda, bookings, groups, sellerDelivery] = await Promise.all([
    checks.check("crm"), checks.check("sales"), checks.check("agenda"), checks.check("bookings"), checks.check("groups"),
    supabaseAdmin.rpc("agentx_seller_delivery_recovery_ready", {}, { get: true }).abortSignal(AbortSignal.timeout(5_000))
  ]);
  if (crm === "migration_required") return "O Supabase respondeu, mas o esquema principal do CRM precisa de atualização.";
  if (crm !== "ready") return "O contentor não conseguiu consultar o CRM. Verifica a chave privada e a ligação ao Supabase.";
  if (sales === "migration_required") return "O esquema das vendas precisa de atualização. Confirma as migrações 20 a 22.";
  if (sales !== "ready") return "O contentor não conseguiu consultar o esquema das vendas.";
  if (agenda === "migration_required") return "A Agenda precisa das migrações 18 e 23.";
  if (bookings === "migration_required") return "As Marcações e os lembretes precisam da migração 24.";
  if (groups === "migration_required") return "Os Grupos precisam das migrações 15 e 25.";
  if (agenda !== "ready" || bookings !== "ready" || groups !== "ready") {
    return "O contentor não conseguiu consultar a Agenda, as Marcações ou os Grupos.";
  }
  if (sellerDelivery.data === false || ["PGRST202", "42883", "42501"].includes(sellerDelivery.error?.code ?? "")) {
    return "A recuperação de entregas e as permissões de vendas precisam da migração 26. Aplica supabase/migrations/26_seller_delivery_recovery.sql no projeto Supabase usado pela VPS.";
  }
  if (sellerDelivery.error || sellerDelivery.data !== true) {
    return "Não foi possível validar a migração 26 para a recuperação de entregas. Verifica a ligação e a chave privada do Supabase.";
  }
  return null;
}

// Driver errors can contain connection details. Keep command output limited to safe diagnostics.
const message = await check().catch(() => "Não foi possível validar a configuração Supabase do contentor.");
if (message) {
  console.error(`Pré-verificação falhou. ${message}`);
  process.exitCode = 1;
} else {
  console.log("Pré-verificação concluída. CRM, vendas, recuperação de entregas, agenda, marcações e grupos verificados.");
}
