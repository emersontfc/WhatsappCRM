import express, { type Response } from "express";
import type { GroupMetadata, GroupParticipant } from "@whiskeysockets/baileys";
import type { AuthRequest } from "../middleware/auth.ts";
import { groupParticipant, isGroupAdmin, isGroupJid, normalizedGroupIdentity } from "../services/groupModeration.ts";
import { scheduledContactJid } from "../services/scheduledDispatch.ts";
import { whatsappManager } from "../whatsappManager.ts";

type GroupContext = { userId: string; jid: string; group: GroupMetadata; self: GroupParticipant };

const groups = express.Router();
const memberJid = /^\d{5,20}@(s\.whatsapp\.net|lid)$/;

function forGroup(adminOnly: boolean, handle: (req: AuthRequest, res: Response, context: GroupContext) => Promise<unknown>) {
  return async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;
    const { jid } = req.params;
    if (!userId) return res.status(401).json({ error: "Inicia sessão para gerir grupos." });
    if (!isGroupJid(jid)) return res.status(400).json({ error: "Grupo inválido." });
    res.set("Cache-Control", "no-store");
    try {
      const group = await whatsappManager.getGroupMetadata(userId, jid);
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

groups.post("/:jid/subject", forGroup(true, async (req, res, { userId, jid }) => {
  const subject = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
  if (!subject || subject.length > 100) return res.status(400).json({ error: "Escreve um nome entre 1 e 100 caracteres." });
  await whatsappManager.updateGroupSubject(userId, jid, subject);
  return res.json({ success: true });
}));

groups.patch("/:jid/settings", forGroup(true, async (req, res, { userId, jid }) => {
  const { field, value } = req.body ?? {};
  if (field === "description" && typeof value === "string" && value.length <= 2048) {
    await whatsappManager.updateGroupDescription(userId, jid, value.trim());
  } else if ((field === "announce" || field === "restrict" || field === "joinApprovalMode") && typeof value === "boolean") {
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
      const phone = id && /^\+?[\d\s()-]+$/.test(id) ? scheduledContactJid({ phone: id }) : id;
      if (!phone || !/^\d{8,15}@s\.whatsapp\.net$/.test(phone)) {
        return res.status(400).json({ error: "Introduz um número de telefone com indicativo." });
      }
      targets.add(phone);
      continue;
    }
    const member = id && memberJid.test(id) ? groupParticipant(group, id) : undefined;
    const owner = groupParticipant(group, group.owner, group.ownerPn);
    if (!member || member.id === self.id || member.id === owner?.id || member.admin === "superadmin" || member.isSuperAdmin) {
      return res.status(400).json({ error: "Seleciona outro membro do grupo. O criador e a conta ligada estão protegidos." });
    }
    targets.add(member.id);
  }
  const result = await whatsappManager.updateGroupParticipants(userId, jid, [...targets], action);
  // The gateway may return an IQ success while rejecting individual participants.
  if (result.length !== targets.size || result.some((item) => item.status !== "200")) {
    const privacy = action === "add" && result.some((item) => item.status === "403");
    return res.status(409).json({ error: privacy
      ? "O WhatsApp exige convite para este número. Partilha o link do grupo com a pessoa."
      : "O WhatsApp não confirmou todos os membros. Atualiza a lista antes de repetir." });
  }
  return res.json({ success: true });
}));

groups.post("/:jid/announce", forGroup(false, async (req, res, { userId, jid, group, self }) => {
  if (group.announce && !isGroupAdmin(self)) {
    return res.status(403).json({ error: "Só administradores podem escrever neste grupo." });
  }
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text || text.length > 4096) return res.status(400).json({ error: "Escreve um anúncio entre 1 e 4096 caracteres." });
  const result = await whatsappManager.sendMessage(userId, jid, text);
  if (!result?.key?.id) return res.status(502).json({ error: "Envio por confirmar. Consulta o grupo antes de repetir." });
  return res.json({ success: true, status: "sent" });
}));

groups.post("/:jid/leave", forGroup(false, async (_req, res, { userId, jid }) => {
  await whatsappManager.leaveGroup(userId, jid);
  return res.json({ success: true });
}));

export default groups;
