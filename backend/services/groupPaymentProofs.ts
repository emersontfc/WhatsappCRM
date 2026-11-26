import type { GroupMetadata, WAMessageKey } from "@whiskeysockets/baileys";
import { normalizeContactPhone } from "../../shared/contactPhone.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { groupParticipant, isGroupAdmin, isGroupJid } from "./groupModeration.ts";
import { extractProofWithAI } from "./paymentProofExtractor.ts";
import { compareProofRecipient, parseMozambicanReceiptSMS, proofRecipient, type ExtractedPaymentData } from "./paymentProofSms.ts";
import { PAYMENT_PROOF_LIMIT, storePaymentProofAttachment, type PaymentProofAttachment } from "./paymentProofAttachments.ts";

export const GROUP_PROOF_BUCKET = "agentx-group-proofs";
export const GROUP_PROOF_LIMIT = PAYMENT_PROOF_LIMIT;
type Identity = { id?: string; lid?: string; phoneNumber?: string };

export function groupProofOrderNumber(text: string, hasAttachment: boolean) {
  if (text.length > 4000) return null;
  const numbers = [...new Set(text.match(/\bAGX-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/gi)?.map((number) => number.toUpperCase()))];
  if (numbers.length !== 1 || numbers[0].length > 50) return null;
  const receipt = hasAttachment ? null : parseMozambicanReceiptSMS(text);
  return hasAttachment || receipt?.amount || receipt?.transactionReference ? numbers[0] : null;
}

function phoneJid(value?: string | null) {
  return /@(?:s\.whatsapp\.net|c\.us)$/i.test(value ?? "") ? normalizeContactPhone(value) : null;
}

export function groupBuyerPhone(group: GroupMetadata, key: WAMessageKey, linked?: Identity) {
  if (!key.participant || key.fromMe || !isGroupAdmin(groupParticipant(group, linked?.id, linked?.lid, linked?.phoneNumber))) return null;
  const primary = groupParticipant(group, key.participant);
  const alternate = groupParticipant(group, key.participantAlt);
  if (primary && alternate && primary !== alternate) return null;
  const member = primary ?? alternate;
  if (!member) return null;
  const numbers = new Set([phoneJid(key.participant), phoneJid(key.participantAlt), phoneJid(member.id),
    normalizeContactPhone(member.phoneNumber)].filter(Boolean));
  return numbers.size === 1 ? numbers.values().next().value ?? null : null;
}

export async function readGroupProofIntake(userId: string, jid: string) {
  const { data, error } = await supabaseAdmin.from("group_rules").select("proof_intake_enabled")
    .eq("user_id", userId).eq("group_jid", jid).abortSignal(AbortSignal.timeout(4_000)).maybeSingle();
  if (error) throw error;
  return data?.proof_intake_enabled === true;
}

export async function processGroupPaymentProof(input: {
  userId: string; jid: string; key: WAMessageKey; text: string; attachment?: PaymentProofAttachment;
  linked?: Identity; loadGroup: () => Promise<GroupMetadata>;
}) {
  const { userId, jid, key, text, attachment, linked, loadGroup } = input;
  if (key.fromMe || !key.id || !key.participant || key.remoteJid !== jid || !isGroupJid(jid)) return;
  const orderNumber = groupProofOrderNumber(text, Boolean(attachment));
  const sourceId = `group:${jid}:${key.id}`;
  if (!orderNumber || sourceId.length > 160 || !(await readGroupProofIntake(userId, jid))) return;

  const group = await loadGroup();
  if (group.id !== jid) return;
  const phone = groupBuyerPhone(group, key, linked);
  if (!phone) return;
  const phones = /^2588[2-7]\d{7}$/.test(phone) ? [phone, phone.slice(3)] : [phone];
  const { data: orders, error } = await supabaseAdmin.from("orders").select("id,order_number,customer_phone,seller_payment")
    .eq("user_id", userId).eq("order_number", orderNumber).in("customer_phone", phones)
    .in("status", ["created", "awaiting_payment", "verification_pending", "rejected"])
    .abortSignal(AbortSignal.timeout(4_000)).limit(2);
  if (error) throw error;
  if (orders?.length !== 1) return;
  const order = orders[0];

  // Avoid loading the same attachment again after a reconnect.
  const { data: existing, error: existingError } = await supabaseAdmin.from("payment_verifications").select("id")
    .eq("user_id", userId).eq("source_message_id", sourceId).abortSignal(AbortSignal.timeout(4_000)).maybeSingle();
  if (existingError) throw existingError;
  if (existing) return;

  const proof: ExtractedPaymentData = attachment
    ? parseMozambicanReceiptSMS(text) ?? { provider: "other", transactionReference: "", amount: 0,
      currency: "", confidenceScore: 0, rawText: text, ...proofRecipient(text) }
    : await extractProofWithAI(userId, text);
  const evidence = compareProofRecipient(proof, order.seller_payment);
  const file = attachment ? await storePaymentProofAttachment(GROUP_PROOF_BUCKET, userId, attachment) : null;
  if (attachment && !file) throw new Error("Invalid group proof file");
  const { data: saved, error: saveError } = await supabaseAdmin.rpc("agentx_submit_group_payment_proof_with_notice", {
    p_user: userId, p_group: jid, p_order: order.id, p_phone: order.customer_phone, p_source_message: sourceId,
    p_proof: {
      provider: proof.provider, transaction_reference: proof.transactionReference, amount: proof.amount,
      sender_phone: proof.senderPhone ?? "", sender_name: proof.senderName ?? "",
      proof_raw_text: proof.rawText, confidence_score: proof.confidenceScore, extracted_data: { ...proof, ...evidence }
    },
    p_attachment: file
  });

  // An uncertain timeout may have committed the reference. Only remove on a confirmed duplicate or
  // SQL rejection, never after an ambiguous transport failure.
  if (file && (saved?.created === false || (saveError?.code && /^[0-9A-Z]{5}$/.test(saveError.code)))) {
    const { error: cleanupError } = await supabaseAdmin.storage.from(GROUP_PROOF_BUCKET).remove([file.path]);
    if (cleanupError) console.warn("[GroupProofs] Could not remove an unreferenced upload");
  }
  if (saveError) throw saveError;
}
