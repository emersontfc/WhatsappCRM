import { supabaseAdmin } from "../supabaseAdmin.ts";
import { GoogleGenAI } from "@google/genai";
import { decrypt } from "../agentManager.ts";

export interface ExtractedPaymentData {
  provider: "mpesa" | "emola" | "bank_transfer" | "reference" | "other";
  transactionReference: string;
  amount: number;
  currency: string;
  senderPhone?: string;
  senderName?: string;
  date?: string;
  time?: string;
  confidenceScore: number;
  rawText: string;
}

/**
 * Deterministic regex parser for Mozambican mobile money SMS receipts (M-Pesa & e-Mola)
 */
export function parseMozambicanReceiptSMS(text: string): ExtractedPaymentData | null {
  if (!text || text.trim().length < 10) return null;
  const clean = text.trim();

  // 1. M-Pesa Standard Receipt Detection:
  // e.g. "Confirmado. Recebeu 500.00 MT de 841234567 Emerson Torres em 2026-11-12 14:30. Transaccao: 2K3J4H5G."
  // or "Confirma-se que recebeu 1,500.00 MT de 258849999999... Transaccao: 9K8J7H."
  const mpesaMatch = clean.match(/recebeu\s+([0-9.,]+)\s*(?:MT|MZN)/i) || 
                     clean.match(/([0-9.,]+)\s*(?:MT|MZN)\s+de/i);
                     
  const isEmola = /e-mola|emola|movitel/i.test(clean) || 
                  /\bEM[0-9A-Z]{6,12}\b/i.test(clean) || 
                  /(?:de|from)\s+(?:\+?258\s*)?8[67]\d{7}\b/i.test(clean);
  const isMpesa = !isEmola && (/m-pesa|mpesa|vodacom/i.test(clean) || 
                  /(?:de|from)\s+(?:\+?258\s*)?8[45]\d{7}\b/i.test(clean) ||
                  (/recebeu/i.test(clean) && /transaccao|transacao|txnid/i.test(clean)));

  if (isMpesa || isEmola || mpesaMatch) {
    let rawAmount = mpesaMatch ? mpesaMatch[1].replace(/,/g, "") : "0";
    const amount = parseFloat(rawAmount) || 0;

    // Transaction Reference: e.g. "Transaccao: 2K3J4H5G" or "Transacao: EM123456"
    const refMatch = clean.match(/(?:transaccao|transacao|txnid|ref|referencia)[\s:]+([A-Z0-9]{6,16})/i) ||
                     clean.match(/\b([A-Z0-9]{8,12})\b/);
    const transactionReference = refMatch ? refMatch[1].toUpperCase() : "";

    // Sender Phone: 84..., 85..., 86..., 87..., 258...
    const phoneMatch = clean.match(/(?:de|from)\s+(\+?258\s*)?(8[2-7]\d{7})/i) ||
                       clean.match(/\b(8[2-7]\d{7})\b/);
    const senderPhone = phoneMatch ? (phoneMatch[2] || phoneMatch[1]) : "";

    // Sender Name: text following phone number or preceding it
    const nameMatch = clean.match(/(?:de|from)\s+(?:(?:\+?258)?\d{9}\s+)?([A-Za-zÀ-ÖØ-öø-ÿ\s]{3,30})(?:\s+em|\s+no|\s+transaccao|$)/i);
    const senderName = nameMatch ? nameMatch[1].trim() : "";

    const provider = isEmola ? "emola" : "mpesa";
    const confidenceScore = (amount > 0 && transactionReference.length >= 6) ? 0.95 : 0.70;

    return {
      provider,
      transactionReference,
      amount,
      currency: "MT",
      senderPhone,
      senderName,
      confidenceScore,
      rawText: clean
    };
  }

  // 2. Generic Bank Transfer / Reference Format
  const bankMatch = clean.match(/(?:transferencia|banco|bim|bci|standard|moza)\s+.*?(?:valor|quantia)[\s:]*([0-9.,]+)/i);
  if (bankMatch) {
    const amount = parseFloat(bankMatch[1].replace(/,/g, "")) || 0;
    const refMatch = clean.match(/(?:ref|referencia|id)[\s:]*([A-Z0-9-]+)/i);
    return {
      provider: "bank_transfer",
      transactionReference: refMatch ? refMatch[1].toUpperCase() : "",
      amount,
      currency: "MT",
      confidenceScore: 0.80,
      rawText: clean
    };
  }

  return null;
}

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
