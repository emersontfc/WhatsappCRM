import type { GroupMetadata, WAMessageKey, WASocket, proto } from "@whiskeysockets/baileys";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { hasDisallowedGroupLink, normalizeGroupPolicyText, type GroupPolicy, type ContentRule,
  type ModerationAction, type ModerationPolicy, type ModerationRule } from "./groupPolicy.ts";

export type GroupRules = {
  active: boolean;
  anti_link: boolean;
  anti_spam: boolean;
  anti_flood: boolean;
  welcome_msg: string;
} & Partial<GroupPolicy & ModerationPolicy>;
type Outcome = "accepted" | "no_permission" | "unverified_sender" | "failed" | "uncertain";
const violationReason: Record<ModerationRule, string> = {
  link: "links que não estão na lista permitida", word: "certas palavras ou expressões", spam: "mensagens repetidas",
  flood: "várias mensagens seguidas em pouco tempo", image: "imagens", video: "vídeos", audio: "ficheiros de áudio",
  voice: "notas de voz", document: "documentos", sticker: "figurinhas", gif: "GIFs", poll: "sondagens",
  contact: "contactos", location: "localizações", reaction: "reações", invite: "convites de outros grupos", event: "eventos",
};

export function groupContentRule(content?: proto.IMessage | null): ContentRule | undefined {
  if (!content) return undefined;
  if (content.imageMessage) return "image";
  if (content.videoMessage?.gifPlayback) return "gif";
  if (content.videoMessage || content.ptvMessage) return "video";
  if (content.audioMessage) return content.audioMessage.ptt ? "voice" : "audio";
  if (content.documentMessage || content.documentWithCaptionMessage) return "document";
  if (content.stickerMessage || content.stickerPackMessage) return "sticker";
  if (content.pollCreationMessage || content.pollCreationMessageV2 || content.pollCreationMessageV3 ||
      content.pollCreationMessageV4 || content.pollCreationMessageV5) return "poll";
  if (content.contactMessage || content.contactsArrayMessage) return "contact";
  if (content.locationMessage || content.liveLocationMessage) return "location";
  if (content.reactionMessage || content.encReactionMessage) return "reaction";
  if (content.groupInviteMessage) return "invite";
  if (content.eventMessage) return "event";
  return undefined;
}

export const isGroupJid = (jid: string) => /^\d+(?:-\d+)?@g\.us$/.test(jid);

export function readGroupRulePatch(input: unknown): Partial<GroupRules> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  const rules: Partial<GroupRules> = {};
  for (const key of ["active", "anti_link", "anti_spam", "anti_flood"] as const) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "boolean") return null;
    rules[key] = body[key];
  }
  if (body.welcome_msg !== undefined) {
    if (typeof body.welcome_msg !== "string" || body.welcome_msg.length > 800) return null;
    rules.welcome_msg = body.welcome_msg.trim();
  }
  return Object.keys(rules).length ? rules : null;
}

const ruleCache = new Map<string, { value: GroupRules | null; until: number }>();
const activity = new Map<string, Array<{ at: number; text: string }>>();
const recentGroupMessages = new Map<string, number>();
const welcomes = new Map<string, number>();

export function invalidateGroupRules(userId: string, jid: string) {
  ruleCache.delete(`${userId}:${jid}`);
}

async function rulesFor(userId: string, jid: string): Promise<GroupRules | null> {
  const key = `${userId}:${jid}`;
  const now = Date.now();
  const existing = ruleCache.get(key);
  if (existing && existing.until > now) return existing.value;
  const fields = "active,anti_link,anti_spam,anti_flood,welcome_msg";
  const read = (columns: string) => supabaseAdmin.from("group_rules").select(columns)
    .eq("user_id", userId).eq("group_jid", jid).abortSignal(AbortSignal.timeout(8_000)).maybeSingle<GroupRules>();
  const result = await read(fields + ",allowed_link_hosts,blocked_words,warning_limit,moderation_actions");
  if (result.error) throw result.error;
  const data = result.data;
  if (ruleCache.size >= 1000) ruleCache.delete(ruleCache.keys().next().value!);
  ruleCache.set(key, { value: data, until: now + 30000 });
  return data;
}

function moderationAction(rules: GroupRules, rule: ModerationRule): ModerationAction {
  return rules.moderation_actions?.[rule] ?? (rule === "link" || rule === "word" || rule === "spam" || rule === "flood"
    ? (rules.warning_limit ?? 0) > 0 ? "warn" : "delete" : "allow");
}

export function groupViolation(rules: GroupRules, history: Array<{ at: number; text: string }>, now: number,
  messageText?: string, contentRule?: ContentRule): ModerationRule | null {
  if (!rules.active || !history.length) return null;
  const latest = history.at(-1)!.text;
  const content = messageText ?? latest;
  const found: ModerationRule[] = [];
  if (rules.anti_link && moderationAction(rules, "link") !== "allow" && hasDisallowedGroupLink(content, rules.allowed_link_hosts ?? [])) found.push("link");
  if (rules.blocked_words?.length && moderationAction(rules, "word") !== "allow") {
    const words = ` ${normalizeGroupPolicyText(content)} `;
    if (rules.blocked_words.some((word) => words.includes(` ${word} `))) found.push("word");
  }
  if (rules.anti_spam && moderationAction(rules, "spam") !== "allow" && latest &&
      history.filter((entry) => entry.at >= now - 30000 && entry.text === latest).length >= 3) found.push("spam");
  if (rules.anti_flood && moderationAction(rules, "flood") !== "allow" &&
      history.filter((entry) => entry.at >= now - 10000).length > 5) found.push("flood");
  if (contentRule && moderationAction(rules, contentRule) !== "allow") found.push(contentRule);
  for (const action of ["delete", "review", "warn"] as const) {
    const match = found.find((rule) => moderationAction(rules, rule) === action);
    if (match) return match;
  }
  return null;
}

export function normalizedGroupIdentity(jid?: string | null) {
  return jid?.toLowerCase().replace(/:\d+@/, "@").replace(/@c\.us$/, "@s.whatsapp.net");
}

export function groupParticipant(group: GroupMetadata, ...ids: Array<string | null | undefined>) {
  const candidates = new Set(ids.map(normalizedGroupIdentity).filter(Boolean));
  return group.participants.find((person) => [person.id, person.lid, person.phoneNumber].map(normalizedGroupIdentity)
    .some((id) => id && candidates.has(id)));
}

export function isGroupAdmin(person?: GroupMetadata["participants"][number]) {
  return person?.admin === "admin" || person?.admin === "superadmin" ||
    person?.isAdmin === true || person?.isSuperAdmin === true;
}

export function groupRemovalDecision(group: GroupMetadata, senderIds: Array<string | null | undefined>, linkedIds: Array<string | null | undefined>) {
  const sender = groupParticipant(group, ...senderIds);
  if (!sender) return "unverified_sender";
  if (isGroupAdmin(sender)) return "exempt";
  return isGroupAdmin(groupParticipant(group, ...linkedIds)) ? "remove" : "no_permission";
}

export function canPostInGroup(group: GroupMetadata, identity?: { id?: string; lid?: string; phoneNumber?: string }) {
  const linked = groupParticipant(group, identity?.id, identity?.lid, identity?.phoneNumber);
  return Boolean(linked && (!group.announce || isGroupAdmin(linked)));
}

async function logEvent(userId: string, jid: string, outcome: Outcome) {
  const { error } = await supabaseAdmin.from("agentx_group_events").insert({ user_id: userId, group_jid: jid, rule: "welcome", outcome });
  if (error) throw error;
}

type ModerationClaim = { id: number; action: "warn" | "delete" | "review"; warningId?: string;
  warningNumber?: number; warningLimit?: number; template?: string | null };

export function groupWarningText(rule: ModerationRule, member: string, subject: string, claim: ModerationClaim) {
  const mention = "@" + member.split("@")[0];
  const base = claim.template || "Olá {membro}! Para manter a conversa organizada, pedimos que evites {motivo} neste grupo. Obrigado pela compreensão.";
  const warning = base.replace(/\{(membro|motivo|grupo)\}/g, (_, name: "membro" | "motivo" | "grupo") => ({
    membro: mention, motivo: violationReason[rule], grupo: subject.replace(/\s+/g, " ").trim().slice(0, 100) || "este grupo"
  })[name]);
  return claim.warningNumber != null && claim.warningNumber === claim.warningLimit
    ? warning + " A equipa do grupo vai rever esta situação."
    : warning;
}

async function applyModeration(socket: WASocket, userId: string, jid: string, key: WAMessageKey,
  rule: ModerationRule, member: string, subject: string) {
  const { data, error } = await supabaseAdmin.rpc("agentx_claim_group_moderation", {
    p_user: userId, p_group: jid, p_member: member, p_message: key.id, p_rule: rule,
  }).abortSignal(AbortSignal.timeout(8_000));
  if (error) throw error;
  const claim = data as ModerationClaim | null;
  if (!claim || claim.action === "review") return;
  let outcome: Outcome = "uncertain";
  let deadline: NodeJS.Timeout | undefined;
  try {
    const send = claim.action === "delete" ? socket.sendMessage(jid, { delete: key }) : socket.sendMessage(jid, {
      text: groupWarningText(rule, member, subject, claim), mentions: [member],
    });
    const result = await Promise.race([send, new Promise<never>((_, reject) => {
      deadline = setTimeout(() => reject(new Error("Group action acknowledgement timed out")), 8_000);
      deadline.unref();
    })]);
    if (result?.key?.id) outcome = "accepted";
  } catch { /* The gateway may have accepted the action before the response was lost. */ }
  finally { clearTimeout(deadline); }

  const event = supabaseAdmin.from("agentx_group_events").update({ outcome })
    .eq("id", claim.id).eq("user_id", userId).eq("group_jid", jid).eq("outcome", "pending")
    .abortSignal(AbortSignal.timeout(8_000));
  const warning = claim.warningId ? supabaseAdmin.from("agentx_group_warnings")
    .update({ status: outcome === "accepted" ? "sent" : "failed" })
    .eq("id", claim.warningId).eq("user_id", userId).eq("group_jid", jid).eq("status", "pending")
    .abortSignal(AbortSignal.timeout(8_000)) : null;
  const results = await Promise.all([event, warning]);
  if (results.some((result) => result?.error)) console.warn("[Groups] Could not record the moderation acknowledgement");
}

export async function moderateGroupMessage(socket: WASocket, userId: string, jid: string, key: WAMessageKey,
  text: string, contentRule?: ContentRule): Promise<boolean> {
  if (!isGroupJid(jid) || !key.id || key.fromMe || !key.participant) return false;
  const now = Date.now();
  const eventKey = userId + ":" + jid + ":" + key.id;
  if ((recentGroupMessages.get(eventKey) ?? -Infinity) >= now - 30000) return true;
  if (recentGroupMessages.size >= 10000) recentGroupMessages.delete(recentGroupMessages.keys().next().value!);
  recentGroupMessages.set(eventKey, now);

  const rules = await rulesFor(userId, jid);
  if (!rules?.active) return false;
  const senderKey = userId + ":" + jid + ":" + normalizedGroupIdentity(key.participantAlt || key.participant);
  const entries = (activity.get(senderKey) ?? []).filter((entry) => entry.at >= now - 30000).slice(-19);
  entries.push({ at: now, text: text.toLowerCase().trim().replace(/\s+/g, " ").slice(0, 500) });
  if (activity.size >= 3000 && !activity.has(senderKey)) activity.delete(activity.keys().next().value!);
  activity.set(senderKey, entries);
  const rule = groupViolation(rules, entries, now, text.slice(0, 16000), contentRule);
  if (!rule) return false;

  let group: GroupMetadata;
  try {
    group = await socket.groupMetadata(jid);
    if (group.id !== jid) throw new Error("Group identity could not be verified");
  } catch {
    await recordDeniedModeration(userId, jid, key.id, rule, moderationAction(rules, rule), "failed");
    return true;
  }
  const decision = groupRemovalDecision(group, [key.participant, key.participantAlt], [socket.user?.id, socket.user?.lid, socket.user?.phoneNumber]);
  if (decision === "exempt") return false;
  const participant = groupParticipant(group, key.participant, key.participantAlt);
  const member = [participant?.phoneNumber, participant?.id, participant?.lid].map(normalizedGroupIdentity)
    .find((identity): identity is string => Boolean(identity && /^\d{5,20}@(s\.whatsapp\.net|lid)$/.test(identity)));
  if (decision === "remove" && member) {
    await applyModeration(socket, userId, jid, key, rule, member, group.subject ?? "");
  } else {
    await recordDeniedModeration(userId, jid, key.id, rule, moderationAction(rules, rule),
      decision === "remove" ? "unverified_sender" : decision);
  }
  return true;
}

async function recordDeniedModeration(userId: string, jid: string, sourceMessageId: string,
  rule: ModerationRule, action: ModerationAction, outcome: Outcome) {
  const { error } = await supabaseAdmin.from("agentx_group_events").upsert({
    user_id: userId, group_jid: jid, source_message_id: sourceMessageId, rule, action, outcome,
  }, { onConflict: "user_id,group_jid,source_message_id", ignoreDuplicates: true }).abortSignal(AbortSignal.timeout(8_000));
  if (error) throw error;
}

export async function welcomeGroupParticipants(socket: WASocket, userId: string, jid: string, participants: string[]) {
  if (!isGroupJid(jid)) return;
  const rules = await rulesFor(userId, jid);
  if (!rules?.active || !rules.welcome_msg) return;
  const now = Date.now();
  const self = [normalizedGroupIdentity(socket.user?.id), normalizedGroupIdentity(socket.user?.lid)];
  const members = [...new Set(participants.map(normalizedGroupIdentity))].filter((member): member is string =>
    Boolean(member && /^\d+@(s\.whatsapp\.net|lid)$/.test(member) && !self.includes(member) &&
      (welcomes.get(`${userId}:${jid}:${member}`) ?? 0) < now - 60000)).slice(0, 20);
  if (!members.length) return;
  for (const member of members) {
    if (welcomes.size >= 3000) welcomes.delete(welcomes.keys().next().value!);
    welcomes.set(`${userId}:${jid}:${member}`, now);
  }
  let outcome: Outcome;
  try {
    const group = await socket.groupMetadata(jid);
    if (!canPostInGroup(group, socket.user)) outcome = "no_permission";
    else {
      const names = members.map((member) => "@" + member.split("@")[0]).join(", ");
      const response = await socket.sendMessage(jid, { text: rules.welcome_msg.replaceAll("{user}", names), mentions: members });
      outcome = response?.key?.id ? "accepted" : "failed";
    }
  } catch {
    outcome = "failed";
  }
  await logEvent(userId, jid, outcome);
}
