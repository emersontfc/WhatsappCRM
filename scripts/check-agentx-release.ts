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

  const { supabaseAdminConfigured } = await import("../backend/supabaseAdmin.ts");
  if (!supabaseAdminConfigured) return "Configura SUPABASE_SERVICE_ROLE_KEY com a chave privada do backend.";
  const { makePlatformChecks } = await import("../backend/services/platformChecks.ts");
  const crm = await makePlatformChecks(true).check("crm");
  if (crm === "migration_required") return "O Supabase respondeu, mas o esquema principal do CRM precisa de atualização.";
  if (crm !== "ready") return "O contentor não conseguiu consultar o CRM. Verifica a chave privada e a ligação ao Supabase.";
  return null;
}

// Driver errors can contain connection details. Keep command output limited to safe diagnostics.
const message = await check().catch(() => "Não foi possível validar a configuração Supabase do contentor.");
if (message) {
  console.error(`Pré-verificação falhou. ${message}`);
  process.exitCode = 1;
} else {
  console.log("Pré-verificação concluída. Configuração pública, compilação e leitura do CRM verificadas.");
}
