import { supabaseAdmin } from "../supabaseAdmin.ts";
import { GoogleGenAI } from "@google/genai";
import { decrypt } from "../agentManager.ts";

import { parseMozambicanReceiptSMS, type ExtractedPaymentData } from "./paymentProofSms.ts";
export { parseMozambicanReceiptSMS, type ExtractedPaymentData } from "./paymentProofSms.ts";

/**
 * Multimodal extraction using Gemini for receipt images or unstructured proofs
 */
export async function extractProofWithAI(
  userId: string,
  rawText: string,
  mediaUrl?: string
): Promise<ExtractedPaymentData> {
  // 1. Try deterministic regex first
  const deterministic = parseMozambicanReceiptSMS(rawText);
  if (deterministic && deterministic.confidenceScore >= 0.90) {
    return deterministic;
  }

  // 2. Multimodal AI fallback using Gemini if available
  const { data: agent } = await supabaseAdmin
    .from("agents")
    .select("api_key, model")
    .eq("user_id", userId)
    .maybeSingle();

  const apiKey = agent?.api_key ? decrypt(agent.api_key) : process.env.GEMINI_API_KEY;

  if (apiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Analise este comprovativo de pagamento ou mensagem de transação e extraia os dados estritamente em formato JSON:
Texto do comprovativo: "${rawText}"

Responda APENAS com um objeto JSON com o formato:
{
  "provider": "mpesa" | "emola" | "bank_transfer" | "reference" | "other",
  "transactionReference": "código único da transação",
  "amount": 0.00,
  "currency": "MT",
  "senderPhone": "número do remetente ou vazio",
  "senderName": "nome do remetente ou vazio",
  "date": "AAAA-MM-DD ou vazio",
  "time": "HH:MM ou vazio",
  "confidenceScore": 0.0 a 1.0
}`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt
      });

      const text = response.text || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          provider: parsed.provider || "mpesa",
          transactionReference: parsed.transactionReference || "",
          amount: Number(parsed.amount) || 0,
          currency: parsed.currency || "MT",
          senderPhone: parsed.senderPhone || "",
          senderName: parsed.senderName || "",
          date: parsed.date,
          time: parsed.time,
          confidenceScore: Number(parsed.confidenceScore) || 0.85,
          rawText
        };
      }
    } catch (err: any) {
      console.warn("[PaymentProofExtractor] Gemini extraction fallback failed:", err.message);
    }
  }

  // 3. Fallback heuristic
  return deterministic || {
    provider: "other",
    transactionReference: `MAN-${Date.now().toString().slice(-6)}`,
    amount: 0,
    currency: "MT",
    confidenceScore: 0.40,
    rawText
  };
}
