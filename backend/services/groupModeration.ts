import type { GroupMetadata, WAMessageKey, WASocket } from "@whiskeysockets/baileys";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { hasDisallowedGroupLink, normalizeGroupPolicyText, type GroupPolicy } from "./groupPolicy.ts";

export type GroupRules = {
  active: boolean;
  anti_link: boolean;
  anti_spam: boolean;
  anti_flood: boolean;
  welcome_msg: string;
} & Partial<GroupPolicy>;
type Violation = "link" | "word" | "spam" | "flood";
type Outcome = "accepted" | "no_permission" | "unverified_sender" | "failed";
const violationReason: Record<Violation, string> = { link: "link que não consta das exceções", word: "palavra bloqueada", spam: "mensagens repetidas", flood: "mensagens muito frequentes" };

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
  let result = await read(fields + ",allowed_link_hosts,blocked_words,warning_limit");
  if (["42703", "PGRST204"].includes(result.error?.code ?? "")) result = await read(fields);
  if (result.error) throw result.error;
  const data = result.data;
  if (ruleCache.size >= 1000) ruleCache.delete(ruleCache.keys().next().value!);
  ruleCache.set(key, { value: data, until: now + 30000 });
  return data;
}

export function groupViolation(rules: GroupRules, history: Array<{ at: number; text: string }>, now: number, messageText?: string): Violation | null {
  if (!rules.active || !history.length) return null;
  const latest = history.at(-1)!.text;
  const content = messageText ?? latest;
  if (rules.anti_link && hasDisallowedGroupLink(content, rules.allowed_link_hosts ?? [])) return "link";
  if (rules.blocked_words?.length) {
    const words = ` ${normalizeGroupPolicyText(content)} `;
    if (rules.blocked_words.some((word) => words.includes(` ${word} `))) return "word";
  }
  if (rules.anti_spam && latest && history.filter((entry) => entry.at >= now - 30000 && entry.text === latest).length >= 3) return "spam";
  if (rules.anti_flood && history.filter((entry) => entry.at >= now - 10000).length > 5) return "flood";
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

async function logEvent(userId: string, jid: string, rule: Violation | "welcome", outcome: Outcome) {
  const { error } = await supabaseAdmin.from("agentx_group_events").insert({ user_id: userId, group_jid: jid, rule, outcome });
  if (error) throw error;
}

async function deleteModeratedMessage(socket: WASocket, userId: string, jid: string, key: WAMessageKey, rule: Violation) {
  const { data: claim, error } = await supabaseAdmin.from("agentx_group_events").upsert({
    user_id: userId, group_jid: jid, source_message_id: key.id, rule, outcome: "pending",
  }, { onConflict: "user_id,group_jid,source_message_id", ignoreDuplicates: true })
    .select("id").abortSignal(AbortSignal.timeout(8_000)).maybeSingle();
  if (error) throw error;
  if (!claim) return;

  let outcome: Outcome = "failed";
  try {
    const response = await socket.sendMessage(jid, { delete: key });
    if (response?.key?.id) outcome = "accepted";
  } catch { /* The remote action may already have happened. Never send it again for this claim. */ }
  const { error: saveError } = await supabaseAdmin.from("agentx_group_events").update({ outcome })
    .eq("id", claim.id).eq("user_id", userId).eq("group_jid", jid).eq("outcome", "pending")
    .abortSignal(AbortSignal.timeout(8_000));
  if (saveError) throw saveError;
}

async function warnGroupMember(socket: WASocket, userId: string, jid: string, member: string, messageId: string, rule: Violation) {
  const { data: warning, error } = await supabaseAdmin.rpc("agentx_claim_group_warning", {
    p_user: userId, p_group: jid, p_member: member, p_message: messageId, p_rule: rule,
  }).abortSignal(AbortSignal.timeout(8_000));
  if (error) throw error;
  if (!warning || warning.status !== "pending") return;

  let status = "failed";
  try {
    const review = warning.warning_number >= warning.warning_limit ? " Limite de avisos atingido." : "";
    const response = await socket.sendMessage(jid, {
      text: `Aviso ${warning.warning_number}/${warning.warning_limit} para @${member.split("@")[0]}: ${violationReason[rule]}.${review}`,
      mentions: [member],
    });
    if (response?.key?.id) status = "sent";
  } catch { /* Keep the pending claim from sending twice on an uncertain failure. */ }

  const { error: updateError } = await supabaseAdmin.from("agentx_group_warnings").update({ status })
    .eq("id", warning.id).eq("user_id", userId).eq("group_jid", jid).eq("status", "pending")
    .abortSignal(AbortSignal.timeout(8_000));
  if (updateError) throw updateError;
}

export async function moderateGroupMessage(socket: WASocket, userId: string, jid: string, key: WAMessageKey, text: string) {
  if (!isGroupJid(jid) || !key.id || key.fromMe || !key.participant) return;
  const now = Date.now();
  const eventKey = `${userId}:${jid}:${key.id}`;
  if ((recentGroupMessages.get(eventKey) ?? -Infinity) >= now - 30000) return;
  if (recentGroupMessages.size >= 10000) recentGroupMessages.delete(recentGroupMessages.keys().next().value!);
  recentGroupMessages.set(eventKey, now);

  const rules = await rulesFor(userId, jid);
  if (!rules?.active || !(rules.anti_link || rules.anti_flood || rules.anti_spam || rules.blocked_words?.length)) return;
  const senderKey = `${userId}:${jid}:${normalizedGroupIdentity(key.participantAlt || key.participant)}`;
  const entries = (activity.get(senderKey) ?? []).filter((entry) => entry.at >= now - 30000).slice(-19);
  entries.push({ at: now, text: text.toLowerCase().trim().replace(/\s+/g, " ").slice(0, 500) });
  if (activity.size >= 3000 && !activity.has(senderKey)) activity.delete(activity.keys().next().value!);
  activity.set(senderKey, entries);
  const violation = groupViolation(rules, entries, now, text.slice(0, 16000));
  if (!violation) return;

  let outcome: Outcome;
  try {
    const group = await socket.groupMetadata(jid);
    if (group.id !== jid) throw new Error("Group identity could not be verified");
    const decision = groupRemovalDecision(group, [key.participant, key.participantAlt], [socket.user?.id, socket.user?.lid, socket.user?.phoneNumber]);
    if (decision === "exempt") return;
    if (decision === "remove") {
      if ((rules.warning_limit ?? 0) > 0) {
        const participant = groupParticipant(group, key.participant, key.participantAlt);
        const member = [participant?.phoneNumber, participant?.id, participant?.lid].map(normalizedGroupIdentity)
          .find((identity): identity is string => Boolean(identity && /^\d{5,20}@(s\.whatsapp\.net|lid)$/.test(identity)));
        if (member) return await warnGroupMember(socket, userId, jid, member, key.id, violation);
        outcome = "unverified_sender";
      } else {
        return await deleteModeratedMessage(socket, userId, jid, key, violation);
      }
    } else {
      outcome = decision;
    }
  } catch {
    outcome = "failed";
  }
  await logEvent(userId, jid, violation, outcome);
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
  await logEvent(userId, jid, "welcome", outcome);
}
