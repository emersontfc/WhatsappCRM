import type { proto } from "@whiskeysockets/baileys";
import { isSellerMethod, type OrderPayment } from "../../shared/seller.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { storePaymentProofAttachment, type PaymentProofAttachment } from "./paymentProofAttachments.ts";
import { compareProofRecipient, parseMozambicanReceiptSMS, proofRecipient, type ExtractedPaymentData } from "./paymentProofSms.ts";

export const DIRECT_PROOF_BUCKET = "agentx-direct-proofs";

export type DirectProofCandidate = {
  caption: string;
  explicit: boolean;
  orderNumbers: string[];
  filename?: string;
  length: number;
  invalidCaption: boolean;
};

type SelectionFailure = "ordinary" | "ambiguous" | "missing" | "expired" | "invalid";
type DirectProofSelection = { status: SelectionFailure } |
  { status: "matched"; phone: string; orderId: string; orderNumber: string; payment: OrderPayment | null };

const explicitProof = /\b(?:comprovativ[oa]s?|comprovantes?|paguei|transferi|recibo de pagamento|pagamento (?:efetuado|efectuado|realizado|enviado)|transferencia (?:efetuada|efectuada|realizada|enviada))\b/;
const shortCaption = /^(?:segue|ok|feito|ja fiz|esta aqui|aqui vai|aqui esta|obrigad[oa])(?:\.|!)?$/;
const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Identifies material that may contain a payment proof before the usual inbox media download. */
export function directProofCandidate(message?: proto.IMessage | null): DirectProofCandidate | null {
  const image = message?.imageMessage;
  const document = message?.documentMessage;
  const media = image ?? document;
  if (!media) return null;
  const caption = media.caption?.trim() ?? "";
  const scan = caption.slice(0,4001);
  const orderNumbers = [...new Set(scan.match(/\bAGX-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/gi)?.map((number) => number.toUpperCase()))];
  const normalized = normalize(scan);
  const receipt = parseMozambicanReceiptSMS(scan);
  const explicit = orderNumbers.length > 0 || explicitProof.test(normalized) || Boolean(receipt?.amount || receipt?.transactionReference);
  const filename = document?.fileName ?? undefined;
  const possible = image || (document && (document.mimetype?.toLowerCase() === "application/pdf" || /\.pdf$/i.test(filename ?? "")));
  if (!explicit && (!possible || (caption && !shortCaption.test(normalized)))) return null;
  return { caption: scan, explicit, orderNumbers, filename, length: Number(media.fileLength ?? 0),
    invalidCaption: caption.length > 4000 || orderNumbers.some((number) => number.length > 50) };
}

export async function selectDirectPaymentProof(userId: string, contactId: string | null, candidate: DirectProofCandidate): Promise<DirectProofSelection> {
  if (!contactId || candidate.invalidCaption) return { status: "invalid" };
  if (candidate.orderNumbers.length > 1) return { status: "ambiguous" };
  const { data: phone, error: phoneError } = await supabaseAdmin.rpc("agentx_direct_proof_phone", {
    p_user: userId, p_contact: contactId, p_source_message: null
  }).abortSignal(AbortSignal.timeout(4_000));
  if (phoneError) throw phoneError;
  if (typeof phone !== "string") return { status: "invalid" };
  const { data, error } = await supabaseAdmin.rpc("agentx_resolve_direct_payment_proof_order", {
    p_user: userId, p_phone: phone, p_order_number: candidate.orderNumbers[0] ?? null
  }).abortSignal(AbortSignal.timeout(4_000));
  if (error) throw error;
  if (data?.status === "matched" && typeof data.orderId === "string" && typeof data.orderNumber === "string") {
    const payment = data.payment;
    const destination = isSellerMethod(payment?.method) && typeof payment.recipient === "string" && typeof payment.name === "string"
      ? { method: payment.method, recipient: payment.recipient, name: payment.name } : null;
    return { status: "matched", phone, orderId: data.orderId, orderNumber: data.orderNumber, payment: destination };
  }
  switch (data?.status) {
    case "missing": return { status: candidate.explicit ? "missing" : "ordinary" };
    case "ambiguous": return { status: "ambiguous" };
    case "expired": return { status: "expired" };
    default: return { status: "invalid" };
  }
}

type Intake = { userId: string; contactId: string; sourceMessageId: string; candidate: DirectProofCandidate };

async function unmatchedReply(input: Intake, reason: "ambiguous" | "missing" | "expired" | "invalid") {
  if (input.candidate.explicit) {
    const { error } = await supabaseAdmin.rpc("agentx_record_direct_proof_intake_event", {
      p_user: input.userId, p_contact: input.contactId, p_source_message: input.sourceMessageId,
      p_reason: reason === "ambiguous" ? "ambiguous_order" : "order_unavailable"
    }).abortSignal(AbortSignal.timeout(4_000));
    if (error) throw error;
  }
  if (reason === "expired") return "A reserva deste pedido expirou. Se já pagaste, fala com a equipa e indica o número AGX antes de fazer outro pagamento.";
  if (reason === "invalid" && !input.candidate.explicit) return null;
  return reason === "ambiguous"
    ? "Preciso do número exato do pedido. Reenvia o comprovativo com um único código AGX na legenda."
    : "Não consegui associar este comprovativo a um pedido disponível. Confirma o número AGX e reenvia-o ou fala com a equipa.";
}

export async function processDirectPaymentProof(input: Intake, selection: DirectProofSelection, attachment: PaymentProofAttachment) {
  if (selection.status === "ordinary") return null;
  if (selection.status !== "matched") return unmatchedReply(input, selection.status);

  const { userId, contactId, sourceMessageId, candidate } = input;
  const { data: existing, error: existingError } = await supabaseAdmin.from("payment_verifications").select("id,order_id")
    .eq("user_id",userId).eq("source_message_id",`direct:${sourceMessageId}`).abortSignal(AbortSignal.timeout(4_000)).maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing.order_id === selection.orderId ? "Este comprovativo já foi registado para revisão." : null;

  const file = await storePaymentProofAttachment(DIRECT_PROOF_BUCKET, userId, attachment);
  if (!file) return "Não consegui abrir o comprovativo. Envia uma foto JPEG, PNG ou WebP, ou um PDF de até 5 MB, com o número AGX do pedido.";
  const proof: ExtractedPaymentData = parseMozambicanReceiptSMS(candidate.caption) ?? {
    provider: "other", transactionReference: "", amount: 0, currency: "", confidenceScore: 0,
    rawText: candidate.caption, ...proofRecipient(candidate.caption)
  };
  const evidence = compareProofRecipient(proof, selection.payment);
  const { data, error } = await supabaseAdmin.rpc("agentx_submit_direct_payment_proof", {
    p_user: userId, p_contact: contactId, p_phone: selection.phone, p_source_message: sourceMessageId,
    p_order_number: candidate.orderNumbers[0] ?? null, p_expected_order: selection.orderId,
    p_proof: {
      provider: proof.provider, transaction_reference: proof.transactionReference, amount: proof.amount,
      sender_phone: proof.senderPhone ?? "", sender_name: proof.senderName ?? "", confidence_score: proof.confidenceScore,
      extracted_data: { ...proof, ...evidence }
    }, p_attachment: file
  }).abortSignal(AbortSignal.timeout(8_000));

  // A lost RPC response may have committed this file reference. Remove only known unused objects.
  if (["duplicate", "ambiguous", "missing", "expired", "invalid"].includes(data?.status) ||
      (error?.code && /^[0-9A-Z]{5}$/.test(error.code))) {
    const { error: cleanupError } = await supabaseAdmin.storage.from(DIRECT_PROOF_BUCKET).remove([file.path]);
    if (cleanupError) console.warn("[DirectProofs] Could not remove an unreferenced upload");
  }
  if (error?.message === "Stock reservation expired") return unmatchedReply(input, "expired");
  if (error) throw error;
  if (["saved", "duplicate"].includes(data?.status) &&
    (typeof data.id !== "string" || data.orderId !== selection.orderId || data.orderNumber !== selection.orderNumber)) {
    throw new Error("Direct proof registration was not acknowledged");
  }
  switch (data?.status) {
    case "saved": return evidence.recipientMatch === "mismatch"
      ? `O comprovativo do pedido ${selection.orderNumber} ficou registado para revisão. O destinatário indicado diverge dos dados do pedido.`
      : `Recebi o comprovativo do pedido ${selection.orderNumber}. Aguarda a confirmação do pagamento pela equipa.`;
    case "duplicate": return "Este comprovativo já foi registado para revisão.";
    case "ambiguous": case "missing": case "expired": case "invalid": return unmatchedReply(input, data.status);
    default: throw new Error("Direct proof registration was not acknowledged");
  }
}
