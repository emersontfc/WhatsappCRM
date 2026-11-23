import { existsSync } from "node:fs";
import { publicConfig } from "../../shared/publicConfig.ts";

export type FrontendProblem = "public_key_required" | "project_url_required" | "project_mismatch" | "frontend_missing";

export function frontendProblem(env: NodeJS.ProcessEnv, indexHtml: string): FrontendProblem | null {
  const config = publicConfig(env);
  if (!config.VITE_SUPABASE_ANON_KEY) return "public_key_required";
  if (!config.VITE_SUPABASE_URL) return "project_url_required";
  const browserUrl = config.VITE_SUPABASE_URL.replace(/\/+$/, "");
  const backendUrl = (env.SUPABASE_URL || browserUrl).trim().replace(/\/+$/, "");
  if (browserUrl !== backendUrl) return "project_mismatch";
  if (!existsSync(indexHtml)) return "frontend_missing";
  return null;
}
