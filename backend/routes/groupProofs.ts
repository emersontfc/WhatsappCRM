import { Router, type Response } from "express";
import type { AuthRequest } from "../middleware/auth.ts";
import type { CommerceRequest } from "../middleware/commerceScope.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { whatsappManager } from "../whatsappManager.ts";
import { groupParticipant, isGroupAdmin, isGroupJid } from "../services/groupModeration.ts";
import { GROUP_PROOF_BUCKET, readGroupProofIntake } from "../services/groupPaymentProofs.ts";
import { DIRECT_PROOF_BUCKET } from "../services/directPaymentProofs.ts";
import { PAYMENT_PROOF_LIMIT } from "../services/paymentProofAttachments.ts";

const router = Router({ mergeParams: true });
async function withGroupAdmin(req: AuthRequest, res: Response, run: (userId: string, jid: string) => Promise<unknown>) {
  const userId = req.user?.id;
  const { jid } = req.params;
  if (!userId) return res.status(401).json({ error: "Inicia sessão para configurar comprovativos." });
  if (!jid || !isGroupJid(jid)) return res.status(400).json({ error: "Grupo inválido." });
  try {
    const group = await whatsappManager.getGroupMetadata(userId, jid);
    const linked = whatsappManager.getMe(userId);
    if (group.id !== jid || !isGroupAdmin(groupParticipant(group, linked?.id, linked?.lid, linked?.phoneNumber))) {
      return res.status(403).json({ error: "A conta ligada precisa de administrar o grupo." });
    }
    return await run(userId, jid);
  } catch (error) {
    const code = (error as { code?: string })?.code;
    return res.status(503).json({
      error: code === "42703" || code === "PGRST204"
        ? "O processamento de comprovativos precisa da migração 25."
        : "Não foi possível consultar o WhatsApp ou guardar a configuração do grupo."
    });
  }
}

router.get("/", (req: AuthRequest, res) => withGroupAdmin(req, res, async (userId, jid) =>
  res.set("Cache-Control", "no-store").json({ success: true, enabled: await readGroupProofIntake(userId, jid) })));

router.put("/", (req: AuthRequest, res) => withGroupAdmin(req, res, async (userId, jid) => {
  if (typeof req.body?.enabled !== "boolean") return res.status(400).json({ error: "Escolhe se o grupo recebe comprovativos." });
  const { data, error } = await supabaseAdmin.from("group_rules").upsert([{
    user_id: userId, group_jid: jid, proof_intake_enabled: req.body.enabled, updated_at: new Date().toISOString()
  }], { onConflict: "user_id,group_jid", defaultToNull: false }).select("proof_intake_enabled").single();
  if (error) throw error;
  return res.json({ success: true, enabled: data.proof_intake_enabled });
}));

export async function downloadPaymentProofAttachment(req: CommerceRequest, res: Response) {
  const { accountId: userId } = req.commerce!;
  const { id } = req.params;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).json({ error: "Comprovativo inválido." });
  }
  try {
    const signal = AbortSignal.timeout(8_000);
    const lookup = (table: string) => supabaseAdmin.from(table)
      .select("storage_path,file_name,mime_type,size_bytes").eq("user_id", userId).eq("verification_id", id).abortSignal(signal).maybeSingle();
    const groupFile = await lookup("agentx_group_payment_attachments");
    if (groupFile.error) throw groupFile.error;
    const fileResult = groupFile.data ? groupFile : await lookup("agentx_direct_payment_attachments");
    if (fileResult.error) throw fileResult.error;
    const file = fileResult.data;
    const path = file?.storage_path;
    const segments = typeof path === "string" ? path.split("/") : [];
    if (segments[0] !== userId || segments.length < 2 || segments.some((segment) =>
      !/^[a-z0-9_.-]+$/i.test(segment) || segment === "." || segment === "..")) {
      return res.status(404).json({ error: "Anexo do comprovativo não encontrado." });
    }
    const { data: blob, error: downloadError } = await supabaseAdmin.storage.from(groupFile.data ? GROUP_PROOF_BUCKET : DIRECT_PROOF_BUCKET)
      .download(path, {}, { signal });
    if (downloadError || !blob || blob.size !== file.size_bytes || blob.size > PAYMENT_PROOF_LIMIT) {
      return res.status(503).json({ error: "O anexo do comprovativo está indisponível." });
    }
    return res.set("Cache-Control", "no-store").json({ success: true, name: file.file_name, mime: file.mime_type,
      base64: Buffer.from(await blob.arrayBuffer()).toString("base64") });
  } catch {
    return res.status(503).json({ error: "Não foi possível abrir o comprovativo." });
  }
}
export default router;
