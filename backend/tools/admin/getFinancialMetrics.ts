import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";
import { supabaseAdmin } from "../../supabaseAdmin.ts";

export const getFinancialMetricsTool: ToolDefinition = {
  name: "getFinancialMetrics",
  description: "Consulta o faturamento real, total de vendas aprovadas e quantidade de pagamentos pendentes de verificação.",
  category: "admin",
  allowedRoles: ["admin"],
  riskLevel: "low",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      period: {
        type: "string",
        description: "Período desejado: 'today' (hoje), 'week' (esta semana), 'month' (este mês) ou 'all' (todo histórico)",
        enum: ["today", "week", "month", "all"]
      }
    }
  },
  execute: async (args: { period?: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      const period = args.period || "month";
      const now = new Date();
      let startDate = new Date(0).toISOString();

      if (period === "today") {
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
      } else if (period === "week") {
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      } else if (period === "month") {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0).toISOString();
      }

      // 1. Fetch paid and fulfilled orders
      const { data: paidOrders, error: orderErr } = await supabaseAdmin
        .from("orders")
        .select("total_amount, status")
        .eq("user_id", ctx.userId)
        .in("status", ["paid", "fulfilled"])
        .gte("created_at", startDate);

      if (orderErr) throw orderErr;

      const totalRevenue = (paidOrders || []).reduce((acc: number, o: any) => acc + (Number(o.total_amount) || 0), 0);
      const paidOrdersCount = paidOrders?.length || 0;

      // 2. Fetch pending verifications
      const { count: pendingVerificationsCount } = await supabaseAdmin
        .from("payment_verifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", ctx.userId)
        .eq("status", "pending");

      // 3. Fetch awaiting payment orders
      const { count: awaitingPaymentCount } = await supabaseAdmin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("user_id", ctx.userId)
        .in("status", ["awaiting_payment", "verification_pending"]);

      const periodLabels: Record<string, string> = {
        today: "hoje",
        week: "nos últimos 7 dias",
        month: "neste mês",
        all: "em todo o histórico"
      };

      const periodStr = periodLabels[period] || period;

      return {
        success: true,
        message: `Métricas Financeiras (${periodStr}): Faturamento de ${totalRevenue.toLocaleString("pt-MZ")} MT (${paidOrdersCount} pedidos pagos). Há ${pendingVerificationsCount || 0} comprovativos pendentes de validação e ${awaitingPaymentCount || 0} pedidos aguardando pagamento.`,
        data: {
          period: periodStr,
          totalRevenue,
          currency: "MT",
          paidOrdersCount,
          pendingVerificationsCount: pendingVerificationsCount || 0,
          awaitingPaymentCount: awaitingPaymentCount || 0
        }
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Erro ao consultar métricas financeiras: ${err.message}`,
        error: err.message
      };
    }
  }
};

