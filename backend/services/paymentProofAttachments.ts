import { createHash, randomUUID } from "node:crypto";
import { supabaseAdmin } from "../supabaseAdmin.ts";

export const PAYMENT_PROOF_LIMIT = 5 * 1024 * 1024;
export type PaymentProofAttachment = { filename?: string; load: () => Promise<Buffer> };

export function proofAttachmentMime(content: Buffer) {
  if (content.subarray(0, 5).equals(Buffer.from("%PDF-"))) return "application/pdf";
  if (content.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (content.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) return "image/jpeg";
  if (content.toString("ascii", 0, 4) === "RIFF" && content.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export async function storePaymentProofAttachment(bucket: string, userId: string, attachment: PaymentProofAttachment) {
  const content = await attachment.load();
  const mime = proofAttachmentMime(content);
  if (!mime || content.length > PAYMENT_PROOF_LIMIT) return null;
  const ext = mime === "application/pdf" ? "pdf" : mime.split("/")[1];
  const proposed = attachment.filename?.split(/[/\\]/).pop()?.replace(/[\p{Cc}\p{Cf}]/gu, "").trim();
  const stem = proposed?.replace(/\.[a-z0-9]+$/i, "").slice(0, 120) || "comprovativo";
  const path = `${userId}/${randomUUID()}`;
  const { error } = await supabaseAdmin.storage.from(bucket).upload(path, content, { contentType: mime, cacheControl: "0", upsert: false });
  if (error) throw error;
  return { path, name: `${stem}.${ext}`, mime, size: content.length, sha256: createHash("sha256").update(content).digest("hex") };
}
