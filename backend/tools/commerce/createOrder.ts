import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";
import { commerceService } from "../../services/commerceService.ts";
import { supabaseAdmin } from "../../supabaseAdmin.ts";

export const createOrderTool: ToolDefinition = {
  name: "createOrder",
  description: "Cria um pedido formal de compra para o cliente, calcula o valor total e gera as instruções de pagamento.",
  category: "commerce",
  allowedRoles: ["admin", "lead"],
  riskLevel: "medium",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      productName: {
        type: "string",
        description: "Nome ou identificador do produto ou serviço a ser adquirido"
      },
      quantity: {
        type: "number",
        description: "Quantidade de itens (padrão: 1)"
      },
      paymentMethod: {
        type: "string",
        description: "Método de pagamento preferido: 'mpesa', 'emola', 'bank_transfer' ou 'reference'",
        enum: ["mpesa", "emola", "bank_transfer", "reference"]
      }
    },
    required: ["productName"]
  },
  execute: async (args: { productName: string; quantity?: number; paymentMethod?: any }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      const quantity = Math.max(1, Math.floor(args.quantity || 1));
      const paymentMethod = args.paymentMethod || "mpesa";

      // 1. Find product in catalog
      const { data: products } = await supabaseAdmin
        .from("products")
        .select("*")
        .eq("user_id", ctx.userId)
        .eq("is_active", true)
        .ilike("name", `%${args.productName.trim()}%`)
        .limit(1);

      const matchedProduct = products?.[0];
      const unitPrice = matchedProduct ? Number(matchedProduct.price) : 0;
      const finalProductName = matchedProduct ? matchedProduct.name : args.productName;

      // 2. Fetch contact info
      const { data: contact } = await supabaseAdmin
        .from("contacts")
        .select("id, name")
        .eq("user_id", ctx.userId)
        .eq("phone", ctx.phone)
        .maybeSingle();

      // 3. Create the order
      const result = await commerceService.createOrder({
        userId: ctx.userId,
        customerPhone: ctx.phone,
        customerName: contact?.name || "Cliente",
        contactId: contact?.id,
        paymentMethod,
        items: [
          {
            productId: matchedProduct?.id,
            productName: finalProductName,
            quantity,
            unitPrice
          }
        ]
      });

      const order = result.order;
      const totalFormatted = `${order.total_amount} MT`;

      // 4. Instructions based on payment method
      let instructions = "";
      if (paymentMethod === "mpesa") {
        instructions = `Envie ${totalFormatted} via M-Pesa para o número oficial da empresa e envie o comprovativo (SMS ou print) nesta conversa.`;
      } else if (paymentMethod === "emola") {
        instructions = `Envie ${totalFormatted} via e-Mola para o número oficial da empresa e envie o comprovativo nesta conversa.`;
      } else {
        instructions = `Efetue a transferência de ${totalFormatted} e envie o comprovativo bancário aqui.`;
      }

      return {
        success: true,
        message: `Pedido ${order.order_number} criado com sucesso no valor de ${totalFormatted}! ${instructions}`,
        data: {
          orderNumber: order.order_number,
          orderId: order.id,
          total: totalFormatted,
          paymentMethod,
          instructions
        }
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Erro ao criar pedido: ${err.message}`,
        error: err.message
      };
    }
  }
};
