import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";
import { commerceService } from "../../services/commerceService.ts";
import { extractProofWithAI } from "../../services/paymentProofExtractor.ts";
import { supabaseAdmin } from "../../supabaseAdmin.ts";

export const submitPaymentProofTool: ToolDefinition = {
  name: "submitPaymentProof",
  description: "Registra e extrai os dados de um comprovativo de pagamento (M-Pesa, e-Mola, banco) para verificação pela administração.",
  category: "payments",
  allowedRoles: ["admin", "lead"],
  riskLevel: "medium",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      proofText: {
        type: "string",
        description: "Texto da mensagem SMS de confirmação ou dados do comprovativo enviados pelo cliente"
      },
      orderNumber: {
        type: "string",
        description: "Número do pedido correspondente se conhecido (ex: 'AGX-1024')"
      },
      mediaUrl: {
        type: "string",
        description: "URL da imagem ou PDF do comprovativo se aplicável"
      }
    },
    required: ["proofText"]
  },
  execute: async (args: { proofText: string; orderNumber?: string; mediaUrl?: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      // 1. Find open order for customer
      let targetOrderId: string | undefined;
      let targetOrderNumber: string | undefined;

      if (args.orderNumber) {
        const { data: o } = await supabaseAdmin
          .from("orders")
          .select("id, order_number")
          .eq("user_id", ctx.userId)
          .eq("order_number", args.orderNumber.trim().toUpperCase())
          .maybeSingle();

        targetOrderId = o?.id;
        targetOrderNumber = o?.order_number;
      }

      if (!targetOrderId) {
        // Fallback: look for the latest awaiting_payment order from this phone
        const { data: latestOrder } = await supabaseAdmin
          .from("orders")
          .select("id, order_number")
          .eq("user_id", ctx.userId)
          .eq("customer_phone", ctx.phone)
          .in("status", ["awaiting_payment", "created"])
          .order("created_at", { ascending: false })
          .limit(1);

        targetOrderId = latestOrder?.[0]?.id;
        targetOrderNumber = latestOrder?.[0]?.order_number;
      }

      // 2. Extract payment proof data
      const extracted = await extractProofWithAI(ctx.userId, args.proofText, args.mediaUrl);

      // 3. Register verification in database
      const result = await commerceService.submitPaymentProof({
        userId: ctx.userId,
        orderId: targetOrderId,
        customerPhone: ctx.phone,
        provider: extracted.provider,
        transactionReference: extracted.transactionReference,
        amount: extracted.amount,
        senderPhone: extracted.senderPhone,
        senderName: extracted.senderName,
        proofType: args.mediaUrl ? "image" : "sms",
        proofRawText: args.proofText,
        proofMediaUrl: args.mediaUrl,
        confidenceScore: extracted.confidenceScore,
        extractedData: extracted
      });

      const orderRefNotice = targetOrderNumber ? ` para o pedido ${targetOrderNumber}` : "";
      const amountNotice = extracted.amount > 0 ? ` no valor de ${extracted.amount} MT` : "";

      return {
        success: true,
        message: `Comprovativo ${extracted.transactionReference}${amountNotice}${orderRefNotice} registrado com sucesso! O pagamento está sob verificação pela nossa equipe e você receberá a confirmação assim que validado.`,
        data: {
          verificationId: result.verification.id,
          orderId: targetOrderId,
          orderNumber: targetOrderNumber,
          reference: extracted.transactionReference,
          amount: extracted.amount,
          provider: extracted.provider,
          confidence: extracted.confidenceScore
        }
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Erro ao processar comprovativo: ${err.message}`,
        error: err.message
      };
    }
  }
};

