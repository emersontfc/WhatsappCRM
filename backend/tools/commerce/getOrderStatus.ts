import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";
import { supabaseAdmin } from "../../supabaseAdmin.ts";

export const getOrderStatusTool: ToolDefinition = {
  name: "getOrderStatus",
  description: "Consulta o status atual e detalhes de um pedido pelo número do pedido ou telefone do cliente.",
  category: "commerce",
  allowedRoles: ["admin", "lead"],
  riskLevel: "low",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      orderNumber: {
        type: "string",
        description: "Número do pedido (ex: 'AGX-1024')"
      }
    }
  },
  execute: async (args: { orderNumber?: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      let query = supabaseAdmin
        .from("orders")
        .select("*, order_items(*)")
        .eq("user_id", ctx.userId);

      if (args.orderNumber) {
        query = query.eq("order_number", args.orderNumber.trim().toUpperCase());
      } else {
        query = query.eq("customer_phone", ctx.phone).order("created_at", { ascending: false }).limit(1);
      }

      const { data: orders, error } = await query;
      if (error) throw error;

      const order = orders?.[0];
      if (!order) {
        return {
          success: false,
          message: "Nenhum pedido encontrado com os dados informados."
        };
      }

      const statusMap: Record<string, string> = {
        created: "Aguardando pagamento",
        awaiting_payment: "Aguardando pagamento",
        verification_pending: "Comprovativo em verificação pela administração",
        paid: "Pagamento confirmado! Em processo de entrega",
        fulfilled: "Entregue e concluído com sucesso",
        rejected: `Rejeitado (${order.rejected_reason || "comprovativo inválido"})`,
        cancelled: "Cancelado"
      };

      const statusLabel = statusMap[order.status] || order.status;

      return {
        success: true,
        message: `Pedido ${order.order_number}: Status atual é "${statusLabel}". Total: ${order.total_amount} ${order.currency}.`,
        data: {
          orderNumber: order.order_number,
          status: order.status,
          statusLabel,
          total: `${order.total_amount} ${order.currency}`,
          items: order.order_items || []
        }
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Erro ao consultar pedido: ${err.message}`,
        error: err.message
      };
    }
  }
};

