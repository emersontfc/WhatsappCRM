import type { GroupMetadata, WAMessageKey, WASocket } from "@whiskeysockets/baileys";
import { supabaseAdmin } from "../supabaseAdmin.ts";

export type GroupRules = {
  active: boolean;
  anti_link: boolean;
  anti_spam: boolean;
  anti_flood: boolean;
  welcome_msg: string;
};
type Violation = "link" | "spam" | "flood";
type Outcome = "accepted" | "no_permission" | "unverified_sender" | "failed";

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
const welcomes = new Map<string, number>();

export function invalidateGroupRules(userId: string, jid: string) {
  ruleCache.delete(`${userId}:${jid}`);
}

async function rulesFor(userId: string, jid: string): Promise<GroupRules | null> {
  const key = `${userId}:${jid}`;
  const now = Date.now();
  const existing = ruleCache.get(key);
  if (existing && existing.until > now) return existing.value;
  const { data, error } = await supabaseAdmin.from("group_rules")
    .select("active,anti_link,anti_spam,anti_flood,welcome_msg")
    .eq("user_id", userId).eq("group_jid", jid).maybeSingle();
  if (error) throw error;
  if (ruleCache.size >= 1000) ruleCache.delete(ruleCache.keys().next().value!);
  ruleCache.set(key, { value: data, until: now + 30000 });
  return data;
}

export function groupViolation(rules: GroupRules, history: Array<{ at: number; text: string }>, now: number): Violation | null {
  if (!rules.active || !history.length) return null;
  const latest = history.at(-1)!.text;
  if (rules.anti_link && /(?:https?:\/\/|www\.|(?:chat\.)?whatsapp\.com\/)/i.test(latest)) return "link";
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
  return Boolean(person?.admin || person?.isAdmin || person?.isSuperAdmin);
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

export async function moderateGroupMessage(socket: WASocket, userId: string, jid: string, key: WAMessageKey, text: string) {
  if (!isGroupJid(jid) || !key.id || key.fromMe || !key.participant) return;
  const rules = await rulesFor(userId, jid);
  if (!rules?.active || !(rules.anti_link || rules.anti_flood || rules.anti_spam)) return;
  const now = Date.now();
  const senderKey = `${userId}:${jid}:${normalizedGroupIdentity(key.participantAlt || key.participant)}`;
  const entries = (activity.get(senderKey) ?? []).filter((entry) => entry.at >= now - 30000).slice(-19);
  entries.push({ at: now, text: text.toLowerCase().trim().replace(/\s+/g, " ").slice(0, 500) });
  if (activity.size >= 3000 && !activity.has(senderKey)) activity.delete(activity.keys().next().value!);
  activity.set(senderKey, entries);
  const violation = groupViolation(rules, entries, now);
  if (!violation) return;

  let outcome: Outcome;
  try {
    const group = await socket.groupMetadata(jid);
    const decision = groupRemovalDecision(group, [key.participant, key.participantAlt], [socket.user?.id, socket.user?.lid]);
    if (decision === "exempt") return;
    if (decision === "remove") {
      const response = await socket.sendMessage(jid, { delete: key });
      outcome = response?.key?.id ? "accepted" : "failed";
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
