import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";
import { commerceService, normalizeCatalogText } from "../../services/commerceService.ts";
import { isSellerMethod, sellerMethods } from "../../../shared/seller.ts";
import { normalizeContactPhone } from "../../../shared/contactPhone.ts";
import { salesToolFailure } from "../../services/salesToolFailure.ts";

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
        description: "Método escolhido pelo cliente. Omite este campo se o cliente ainda não escolheu.",
        enum: ["mpesa", "emola", "bank_transfer", "reference"]
      }
    },
    required: ["productName"]
  },
  execute: async (args: { productName: string; quantity?: number; paymentMethod?: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      const quantity = args.quantity ?? 1;
      const paymentMethod = isSellerMethod(args.paymentMethod) || args.paymentMethod === "reference" ? args.paymentMethod : undefined;
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

      const phone = normalizeContactPhone(ctx.phone);
      if (!phone) {
        return { success: false, message: "O contacto ainda não tem um número de telefone associado ao WhatsApp." };
      }

      const result = await commerceService.createOrder({
        userId: ctx.userId,
        customerPhone: phone,
        customerName: ctx.contactName || "Cliente",
        contactId: ctx.contactId,
        sourceMessageId: ctx.messageId,
        paymentMethod,
        productId: product.id,
        quantity
      });

      const order = result.order;
      const orderMethod = order.payment_method;
      const totalFormatted = `${order.total_amount} ${order.currency}`;
      if (order.status !== "created" && order.status !== "awaiting_payment") {
        const instructions = order.status === "verification_pending" ? "O comprovativo aguarda revisão. Aguarde o resultado."
          : order.status === "paid" || order.status === "fulfilled" ? "O pagamento já foi confirmado."
          : "Consulte o estado do pedido com a equipa antes de pagar.";
        return { success: true, message: `Pedido ${order.order_number} · ${totalFormatted}. ${instructions}` };
      }

      // 4. Instructions based on payment method
      let instructions = "Pede à equipa os dados de pagamento antes de transferires qualquer valor.";
      const destination = order.seller_payment;
      if (destination && isSellerMethod(destination.method)) {
        instructions = `Pague ${totalFormatted} por ${sellerMethods[destination.method]} para ${destination.recipient} (titular: ${destination.name}). Envie o texto do comprovativo nesta conversa com o número ${order.order_number}.`;
        if (isSellerMethod(paymentMethod) && paymentMethod !== destination.method) {
          instructions = `O pedido está registado para ${sellerMethods[destination.method]}. Se precisares de pagar por ${sellerMethods[paymentMethod]}, confirma primeiro com a equipa. ${instructions}`;
        }
      }

      return {
        success: true,
        message: `Pedido ${order.order_number} · ${totalFormatted}. ${instructions}`,
        data: {
          orderNumber: order.order_number,
          orderId: order.id,
          total: totalFormatted,
          paymentMethod: orderMethod,
          instructions
        }
      };
    } catch (error) {
      const detail = (error as { message?: string } | null)?.message;
      const fallback = detail === "Produto digital sem ficheiro ou conteúdo para entrega"
        ? "O ficheiro deste produto digital ainda não está pronto. Confirma a disponibilidade com a equipa."
        : detail === "Produto indisponível ou sem stock suficiente"
          ? "O produto está indisponível na quantidade pedida."
          : "Não foi possível criar o pedido. Tenta novamente ou fala com a equipa.";
      return salesToolFailure("createOrder", error, fallback);
    }
  }
};

