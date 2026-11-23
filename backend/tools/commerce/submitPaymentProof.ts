import type { ToolDefinition, ToolContext, ToolResult } from "../types.ts";
import { commerceService } from "../../services/commerceService.ts";
import { compareProofRecipient } from "../../services/paymentProofSms.ts";
import { extractProofWithAI } from "../../services/paymentProofExtractor.ts";
import { supabaseAdmin } from "../../supabaseAdmin.ts";
import { normalizeContactPhone } from "../../../shared/contactPhone.ts";

export const submitPaymentProofTool: ToolDefinition = {
  name: "submitPaymentProof",
  description: "Regista o comprovativo em texto enviado nesta conversa para revisão. Se o cliente tiver vários pedidos, pede o número do pedido antes de registar.",
  category: "payments",
  allowedRoles: ["admin", "lead"],
  riskLevel: "medium",
  parameters: {
    type: "object",
    properties: {
      orderNumber: { type: "string", description: "Número do pedido que o cliente indicou nesta conversa" },
      proofText: { type: "string", description: "Texto original do comprovativo enviado pelo cliente" }
    }
  },
  execute: async (args: { proofText?: string; orderNumber?: string }, ctx: ToolContext): Promise<ToolResult> => {
    const phone = normalizeContactPhone(ctx.phone);
    const text = (ctx.incomingText ?? args.proofText ?? "").trim();
    if (!phone || text.length < 6 || text.length > 4000) {
      return { success: false, message: "Envia o texto do comprovativo ou a referência do pagamento nesta conversa." };
    }
    const number = (ctx.incomingText?.match(/\bAGX-[A-Z0-9]+\b/i)?.[0] ?? (!ctx.incomingText ? args.orderNumber : undefined))
      ?.trim().toUpperCase();
    try {
      const phones = /^2588[2-7]\d{7}$/.test(phone) ? [phone, phone.slice(3)] : [phone];
      let lookup = supabaseAdmin.from("orders").select("id,order_number,customer_phone,seller_payment").eq("user_id", ctx.userId)
        .in("customer_phone", phones).in("status", ["created", "awaiting_payment", "verification_pending", "rejected"]);
      if (number) lookup = lookup.eq("order_number", number);
      const { data: orders, error } = await lookup.limit(2);
      if (error) throw error;
      if (!orders?.length) return { success: false, message: "Não encontrei um pedido pendente para este contacto." };
      if (orders.length > 1) return { success: false, message: "Há mais de um pedido pendente. Reenvia o comprovativo com o número do pedido." };

      const extracted = await extractProofWithAI(ctx.userId, text);
      const evidence = compareProofRecipient(extracted, orders[0].seller_payment);
      const proof = { ...extracted, ...evidence };
      const result = await commerceService.submitPaymentProof(ctx.userId, orders[0], ctx.messageId, proof);
      return {
        success: true,
        message: evidence.recipientMatch === "mismatch"
          ? `O destinatário deste comprovativo difere dos dados de pagamento do pedido ${orders[0].order_number}. Envia o comprovativo correto ou fala com a equipa.`
          : `O comprovativo do pedido ${orders[0].order_number} está registado. O pedido aguarda a confirmação do pagamento.`,
        data: { verificationId: result.id, orderNumber: orders[0].order_number }
      };
    } catch {
      return { success: false, message: "Não foi possível registar o comprovativo. Tenta novamente ou fala com a equipa." };
    }
  }
};
