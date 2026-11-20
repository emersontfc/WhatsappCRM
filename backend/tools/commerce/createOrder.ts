import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";
import { commerceService, normalizeCatalogText } from "../../services/commerceService.ts";
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
      const quantity = args.quantity ?? 1;
      const paymentMethod = args.paymentMethod ?? "mpesa";
      const term = typeof args.productName === "string" ? normalizeCatalogText(args.productName) : "";
      if (!term || !Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
        return { success: false, message: "Indique o produto e uma quantidade entre 1 e 999." };
      }
      const catalog = await commerceService.listAgentProducts(ctx.userId);
      const exact = catalog.filter((product) => product.id === term || normalizeCatalogText(product.name) === term);
      const matches = exact.length ? exact : catalog.filter((product) => normalizeCatalogText(product.name).includes(term));
      if (matches.length !== 1) {
        return { success: false, message: matches.length
          ? "Há vários produtos com esse nome. Indique o nome completo ou o código do produto."
          : "Produto não encontrado no catálogo ativo." };
      }
      const product = matches[0];

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
        productId: product.id,
        quantity
      });

      const order = result.order;
      const totalFormatted = `${order.total_amount} ${order.currency}`;

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

