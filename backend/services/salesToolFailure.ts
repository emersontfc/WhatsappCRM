import type { ToolResult } from "../tools/types.ts";

export function salesToolFailure(operation: string, error: unknown, fallback: string): ToolResult {
  const code = (error as { code?: string } | null)?.code;
  console.warn("[Sales] Tool failed", { operation, code: code ?? "unknown" });
  if (["42703", "42P01", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(code ?? "")) {
    return { success: false, code: "SALES_SCHEMA_REQUIRED",
      message: "O sistema de vendas está temporariamente indisponível. Fala com a equipa antes de efetuar qualquer pagamento." };
  }
  return { success: false, message: fallback };
}
