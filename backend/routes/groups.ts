import express, { type Response } from "express";
import type { GroupMetadata, GroupParticipant } from "@whiskeysockets/baileys";
import type { AuthRequest } from "../middleware/auth.ts";
import { groupParticipant, invalidateGroupRules, isGroupAdmin, isGroupJid, normalizedGroupIdentity } from "../services/groupModeration.ts";
import { defaultGroupPolicy, defaultModerationPolicy, readGroupPolicy, readModerationPolicy } from "../services/groupPolicy.ts";
import { readSellerAvailableStock } from "../services/sellerStock.ts";
import { readContactPhone } from "../../shared/contactPhone.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { whatsappManager } from "../whatsappManager.ts";

type GroupContext = { userId: string; jid: string; group: GroupMetadata; self: GroupParticipant };

const groups = express.Router();
const memberJid = /^\d{5,20}@(s\.whatsapp\.net|lid)$/;
const productUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function forGroup(adminOnly: boolean, handle: (req: AuthRequest, res: Response, context: GroupContext) => Promise<unknown>) {
  return async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;
    const { jid } = req.params;
    if (!userId) return res.status(401).json({ error: "Inicia sessão para gerir grupos." });
    if (!isGroupJid(jid)) return res.status(400).json({ error: "Grupo inválido." });
    res.set("Cache-Control", "no-store");
    try {
      const group = await whatsappManager.getGroupMetadata(userId, jid);
      if (group.id !== jid) return res.status(502).json({ error: "O WhatsApp não confirmou a identidade do grupo." });
      const identity = whatsappManager.getMe(userId);
      const self = groupParticipant(group, identity?.id, identity?.lid, identity?.phoneNumber);
      if (!self || (adminOnly && !isGroupAdmin(self))) {
        return res.status(403).json({ error: adminOnly
          ? "A conta ligada precisa de ser administradora do grupo."
          : "A conta ligada não é membro do grupo." });
      }
      return await handle(req, res, { userId, jid, group, self });
    } catch (error) {
      if (error instanceof Error && ["WhatsApp não conectado", "WhatsApp session not connected."].includes(error.message)) {
        return res.status(409).json({ error: "Liga o WhatsApp para continuar." });
      }
      return res.status(502).json({ error: "O WhatsApp não confirmou a operação. Atualiza o grupo antes de repetir." });
    }
  };
}

groups.get("/:jid", forGroup(false, async (_req, res, { group, self }) => {
  const { id, subject, desc, announce, restrict, joinApprovalMode, participants } = group;
  return res.json({ success: true, metadata: { id, subject, desc, announce, restrict, joinApprovalMode, participants },
    permissions: { manage: isGroupAdmin(self), post: !announce || isGroupAdmin(self), selfId: self.id } });
}));

async function showGroupPolicy(res: Response, userId: string, jid: string, announce: boolean | undefined) {
  const signal = AbortSignal.timeout(8_000);
  const [rules, schedule, warnings] = await Promise.all([
    supabaseAdmin.from("group_rules").select("allowed_link_hosts,blocked_words,warning_limit")
      .eq("user_id", userId).eq("group_jid", jid).abortSignal(signal).maybeSingle(),
    supabaseAdmin.from("agentx_group_hours").select("enabled,timezone,days,opens_at,closes_at,next_run_at,last_run_at,last_outcome")
      .eq("user_id", userId).eq("group_jid", jid).abortSignal(signal).maybeSingle(),
    supabaseAdmin.from("agentx_group_warnings").select("id,participant_jid,rule,warning_number,warning_limit,status,created_at")
      .eq("user_id", userId).eq("group_jid", jid).order("created_at", { ascending: false }).order("id", { ascending: false })
      .limit(30).abortSignal(signal),
  ]);
  const error = rules.error || schedule.error || warnings.error;
  if (error) {
    const missing = ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(error.code);
    return res.status(503).json({ error: missing ? "Aplica a migração 28 para usar estas regras e horários." : "As regras e os horários estão indisponíveis." });
  }
  return res.json({ success: true, rules: rules.data ?? defaultGroupPolicy, schedule: schedule.data,
    warnings: warnings.data ?? [], announce: announce ?? null });
}

groups.get("/:jid/policy", forGroup(false, async (_req, res, { userId, jid, group }) => showGroupPolicy(res, userId, jid, group.announce)));

groups.put("/:jid/policy", forGroup(true, async (req, res, { userId, jid, group }) => {
  const policy = readGroupPolicy(req.body);
  if (!policy) return res.status(400).json({ error: "Verifica os domínios, palavras, avisos e horários do grupo." });
  const { error } = await supabaseAdmin.rpc("agentx_set_group_policy", {
    p_user: userId, p_group: jid, p_rules: policy.rules, p_schedule: policy.schedule,
  }).abortSignal(AbortSignal.timeout(8_000));
  if (error?.code === "55P03") return res.status(409).json({ error: "O WhatsApp está a aplicar o horário atual. Tenta novamente daqui a pouco." });
  if (error?.code === "22023") return res.status(400).json({ error: "As regras ou o horário do grupo não são válidos." });
  if (error) return res.status(503).json({ error: "A base não confirmou a gravação destas regras e horários." });
  invalidateGroupRules(userId, jid);
  return showGroupPolicy(res, userId, jid, group.announce);
}));

const moderationFields = "moderation_actions,moderation_warning,catalog_sales_enabled";

async function showModeration(res: Response, userId: string, jid: string, includeReviews: boolean) {
  const signal = AbortSignal.timeout(8_000);
  const [policy, reviews] = await Promise.all([
    supabaseAdmin.from("group_rules").select(moderationFields).eq("user_id", userId).eq("group_jid", jid)
      .abortSignal(signal).maybeSingle(),
    includeReviews ? supabaseAdmin.from("agentx_group_events")
      .select("id,rule,action,outcome,participant_jid,review_status,created_at")
      .eq("user_id", userId).eq("group_jid", jid).eq("review_status", "pending")
      .order("id", { ascending: false }).limit(30).abortSignal(signal)
      : { data: [], error: null },
  ]);
  if (policy.error || reviews.error) return res.status(503).json({ error: "A configuração de moderação está indisponível." });
  return res.json({ success: true, policy: policy.data ?? defaultModerationPolicy, reviews: reviews.data ?? [] });
}

groups.get("/:jid/moderation", forGroup(false, async (_req, res, { userId, jid, self }) =>
  showModeration(res, userId, jid, isGroupAdmin(self))));

groups.put("/:jid/moderation", forGroup(true, async (req, res, { userId, jid }) => {
  const policy = readModerationPolicy(req.body);
  if (!policy) return res.status(400).json({ error: "Verifica as ações de moderação e o texto do aviso." });
  const { error } = await supabaseAdmin.from("group_rules").upsert({
    ...policy, user_id: userId, group_jid: jid, updated_at: new Date().toISOString()
  }, { onConflict: "user_id,group_jid" }).abortSignal(AbortSignal.timeout(8_000));
  if (error) return res.status(503).json({ error: "A base não confirmou a gravação da moderação." });
  invalidateGroupRules(userId, jid);
  return showModeration(res, userId, jid, true);
}));

groups.patch("/:jid/moderation/reviews/:id", forGroup(true, async (req, res, { userId, jid }) => {
  const { id } = req.params;
  const { decision } = req.body ?? {};
  if (!/^[1-9]\d{0,17}$/.test(id) || (decision !== "reviewed" && decision !== "dismissed")) {
    return res.status(400).json({ error: "Decisão de revisão inválida." });
  }
  const { data, error } = await supabaseAdmin.from("agentx_group_events")
    .update({ review_status: decision, reviewed_at: new Date().toISOString() })
    .eq("id", id).eq("user_id", userId).eq("group_jid", jid).eq("review_status", "pending")
    .select("id").abortSignal(AbortSignal.timeout(8_000)).maybeSingle();
  if (error) return res.status(503).json({ error: "A base não confirmou a conclusão da revisão." });
  if (!data) return res.status(404).json({ error: "Esta ocorrência já saiu da fila ou não pertence ao grupo." });
  return res.json({ success: true });
}));

groups.post("/:jid/subject", forGroup(true, async (req, res, { userId, jid }) => {
  const subject = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
  if (!subject || subject.length > 100) return res.status(400).json({ error: "Escreve um nome entre 1 e 100 caracteres." });
  await whatsappManager.updateGroupSubject(userId, jid, subject);
  return res.json({ success: true });
}));

groups.patch("/:jid/settings", forGroup(true, async (req, res, { userId, jid, group }) => {
  const { field, value } = req.body ?? {};
  if (field === "description" && typeof value === "string" && value.length <= 2048) {
    await whatsappManager.updateGroupDescription(userId, jid, value.trim());
  } else if ((field === "announce" || field === "restrict" || field === "joinApprovalMode") && typeof value === "boolean") {
    if (field === "announce") {
      if (group.announce === value) return res.json({ success: true, announce: value });
      await whatsappManager.updateGroupAccess(userId, jid, field, value);
      const confirmed = await whatsappManager.getGroupMetadata(userId, jid);
      if (confirmed.id !== jid || confirmed.announce !== value) {
        return res.status(409).json({ error: "O WhatsApp ainda não confirmou quem pode escrever. Atualiza o grupo antes de repetir." });
      }
      return res.json({ success: true, announce: confirmed.announce });
    }
    await whatsappManager.updateGroupAccess(userId, jid, field, value);
  } else {
    return res.status(400).json({ error: "Definição do grupo inválida." });
  }
  return res.json({ success: true });
}));

function invite(reset: boolean) {
  return forGroup(true, async (_req, res, { userId, jid }) => {
    const code = await whatsappManager.getGroupInvite(userId, jid, reset);
    if (!code || !/^[A-Za-z0-9_-]{8,128}$/.test(code)) {
      return res.status(502).json({ error: "O WhatsApp não confirmou o link de convite." });
    }
    return res.json({ success: true, url: `https://chat.whatsapp.com/${code}` });
  });
}

groups.get("/:jid/invite", invite(false));
groups.post("/:jid/invite/reset", invite(true));

groups.get("/:jid/requests", forGroup(true, async (_req, res, { userId, jid }) => {
  const items = await whatsappManager.getGroupJoinRequests(userId, jid);
  const participants = [...new Set(items.map((item) => normalizedGroupIdentity(item.jid)))]
    .filter((id): id is string => Boolean(id && memberJid.test(id)));
  return res.json({ success: true, participants });
}));

groups.post("/:jid/requests", forGroup(true, async (req, res, { userId, jid }) => {
  const { participant, action } = req.body ?? {};
  if (typeof participant !== "string" || !memberJid.test(participant) || (action !== "approve" && action !== "reject")) {
    return res.status(400).json({ error: "Pedido de entrada inválido." });
  }
  const result = await whatsappManager.reviewGroupJoinRequest(userId, jid, participant, action);
  if (!result.some((item) => normalizedGroupIdentity(item.jid) === participant && item.status === "200")) {
    return res.status(409).json({ error: "O WhatsApp não confirmou a decisão. Atualiza os pedidos pendentes." });
  }
  return res.json({ success: true });
}));

groups.post("/:jid/participants", forGroup(true, async (req, res, { userId, jid, group, self }) => {
  const { participants, action } = req.body ?? {};
  if (!Array.isArray(participants) || participants.length === 0 || participants.length > 20 ||
    (action !== "add" && action !== "remove" && action !== "promote" && action !== "demote")) {
    return res.status(400).json({ error: "Ação sobre membros inválida." });
  }
  const targets = new Set<string>();
  for (const value of participants) {
    const id = typeof value === "string" ? normalizedGroupIdentity(value.trim()) : undefined;
    if (action === "add") {
      const phone = readContactPhone(id);
      if (!phone) {
        return res.status(400).json({ error: "Introduz um número de telefone com indicativo." });
      }
      const phoneJid = `${phone}@s.whatsapp.net`;
      if (!groupParticipant(group, phoneJid)) targets.add(phoneJid);
      continue;
    }
    const member = id && memberJid.test(id) ? groupParticipant(group, id) : undefined;
    const owner = groupParticipant(group, group.owner, group.ownerPn);
    if (!member || member.id === self.id || member.id === owner?.id || member.admin === "superadmin" || member.isSuperAdmin) {
      return res.status(400).json({ error: "Seleciona outro membro do grupo. O criador e a conta ligada estão protegidos." });
    }
    if ((action === "promote" && isGroupAdmin(member)) || (action === "demote" && !isGroupAdmin(member))) continue;
    targets.add(member.id);
  }
  if (!targets.size) return res.json({ success: true, status: "unchanged" });
  const result = await whatsappManager.updateGroupParticipants(userId, jid, [...targets], action);
  // The gateway may return an IQ success while rejecting individual participants.
  if (result.length !== targets.size || result.some((item) => item.status !== "200")) {
    const privacy = action === "add" && result.some((item) => item.status === "403");
    return res.status(409).json({ error: privacy
      ? "O WhatsApp exige convite para este número. Partilha o link do grupo com a pessoa."
      : "O WhatsApp não confirmou todos os membros. Atualiza a lista antes de repetir." });
  }
  const confirmed = await whatsappManager.getGroupMetadata(userId, jid);
  const identities = (group: GroupMetadata, id: string) => {
    const person = groupParticipant(group, id);
    return [person?.id, person?.lid, person?.phoneNumber].map(normalizedGroupIdentity).filter(Boolean);
  };
  const verified = confirmed.id === jid && [...targets].every((target) => {
    const equivalent = [normalizedGroupIdentity(target), ...identities(group, target), ...identities(confirmed, target)];
    if (!result.some((item) => equivalent.includes(normalizedGroupIdentity(item.jid)))) return false;
    const participant = groupParticipant(confirmed, ...equivalent);
    return action === "remove" ? !participant :
      Boolean(participant && (action === "add" || isGroupAdmin(participant) === (action === "promote")));
  });
  if (!verified) return res.status(409).json({ error: "A lista do WhatsApp ainda não confirma a alteração. Atualiza os membros antes de repetir." });
  return res.json({ success: true, status: "confirmed" });
}));

function forGroupPost(handle: (req: AuthRequest, res: Response, context: GroupContext) => Promise<unknown>) {
  return forGroup(false, async (req, res, context) => {
    if (context.group.announce && !isGroupAdmin(context.self)) {
      return res.status(403).json({ error: "Só administradores podem escrever neste grupo." });
    }
    return handle(req, res, context);
  });
}

async function sendGroupText(res: Response, userId: string, jid: string, text: string) {
  const result = await whatsappManager.sendMessage(userId, jid, text);
  if (!result?.key?.id) return res.status(502).json({ error: "Envio por confirmar. Consulta o grupo antes de repetir." });
  return res.json({ success: true, status: "sent" });
}

groups.post("/:jid/announce", forGroupPost(async (req, res, { userId, jid }) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text || text.length > 4096) return res.status(400).json({ error: "Escreve um anúncio entre 1 e 4096 caracteres." });
  return sendGroupText(res, userId, jid, text);
}));

function promotionProducts(userId: string) {
  return supabaseAdmin.from("products").select("id,name,price,currency")
    .eq("user_id", userId).eq("is_active", true).gt("stock", 0).gt("price", 0);
}

groups.get("/:jid/promotion-products", forGroupPost(async (_req, res, { userId }) => {
  try {
    const [{ data, error }, available] = await Promise.all([
      promotionProducts(userId).order("name").limit(100),
      readSellerAvailableStock(userId)
    ]);
    if (error) throw error;
    return res.json({ success: true, products: (data ?? []).filter((product) => (available.get(product.id) ?? 0) > 0) });
  } catch {
    return res.status(503).json({ error: "Não foi possível consultar o catálogo." });
  }
}));

groups.post("/:jid/promotions", forGroupPost(async (req, res, { userId, jid }) => {
  const { text, productId } = req.body ?? {};
  const caption = typeof text === "string" ? text.trim() : "";
  if ((text !== undefined && typeof text !== "string") ||
      (productId != null && (typeof productId !== "string" || !productUuid.test(productId)))) {
    return res.status(400).json({ error: "Seleciona um produto ou escreve o texto da promoção." });
  }

  let productLine = "";
  if (productId) {
    const { data: product, error } = await promotionProducts(userId).eq("id", productId).maybeSingle();
    if (error) return res.status(503).json({ error: "Não foi possível consultar o produto." });
    const price = Number(product?.price);
    if (!product || typeof product.name !== "string" || !product.name.trim() || !Number.isFinite(price) || price <= 0) {
      return res.status(409).json({ error: "Este produto já não está disponível no catálogo." });
    }
    try {
      const available = await readSellerAvailableStock(userId);
      if ((available.get(product.id) ?? 0) <= 0) {
        return res.status(409).json({ error: "Este produto ficou sem stock disponível para promover." });
      }
    } catch {
      return res.status(503).json({ error: "Não foi possível confirmar o stock do produto." });
    }
    const name = product.name.trim().replace(/\s+/g, " ").slice(0, 180);
    const currency = product.currency?.trim().slice(0, 12) || "MT";
    const amount = price.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    productLine = `*${name}*\nPreço: ${amount} ${currency}`;
  }
  const content = [caption, productLine].filter(Boolean).join("\n\n");
  const message = `*Promoção*\n\n${content}`;
  if (!content || message.length > 4096) return res.status(400).json({ error: "A promoção deve ter entre 1 e 4096 caracteres." });
  return sendGroupText(res, userId, jid, message);
}));

groups.post("/:jid/leave", forGroup(false, async (_req, res, { userId, jid }) => {
  await whatsappManager.leaveGroup(userId, jid);
  return res.json({ success: true });
}));

export default groups;
