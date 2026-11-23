import { Router, type Response } from "express";
import type { AuthRequest } from "../middleware/auth.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { whatsappManager } from "../whatsappManager.ts";
import { groupParticipant, isGroupAdmin, isGroupJid } from "../services/groupModeration.ts";
import { GROUP_PROOF_BUCKET, GROUP_PROOF_LIMIT, readGroupProofIntake } from "../services/groupPaymentProofs.ts";

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

export async function downloadGroupProofAttachment(req: AuthRequest, res: Response) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Inicia sessão para abrir o comprovativo." });
  const { id } = req.params;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).json({ error: "Comprovativo inválido." });
  }
  try {
    const { data: file, error } = await supabaseAdmin.from("agentx_group_payment_attachments")
      .select("storage_path,file_name,mime_type,size_bytes").eq("user_id", userId).eq("verification_id", id).maybeSingle();
    if (error) throw error;
    if (!file?.storage_path.startsWith(`${userId}/`)) {
      return res.status(404).json({ error: "Anexo do comprovativo não encontrado." });
    }
    const { data: blob, error: downloadError } = await supabaseAdmin.storage.from(GROUP_PROOF_BUCKET)
      .download(file.storage_path, {}, { signal: AbortSignal.timeout(8_000) });
    if (downloadError || !blob || blob.size !== file.size_bytes || blob.size > GROUP_PROOF_LIMIT) {
      return res.status(503).json({ error: "O anexo do comprovativo está indisponível." });
    }
    return res.set("Cache-Control", "no-store").json({ success: true, name: file.file_name, mime: file.mime_type,
      base64: Buffer.from(await blob.arrayBuffer()).toString("base64") });
  } catch {
    return res.status(503).json({ error: "Não foi possível abrir o comprovativo." });
  }
}
export default router;
