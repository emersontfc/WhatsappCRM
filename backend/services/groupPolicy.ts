export const defaultGroupPolicy = {
  allowed_link_hosts: [] as string[], blocked_words: [] as string[], warning_limit: 0,
};

export type GroupPolicy = typeof defaultGroupPolicy;
export type GroupHours = { enabled: boolean; timezone: string; days: number[]; opens_at: string; closes_at: string };
export const contentRules = ["image", "video", "audio", "voice", "document", "sticker", "gif", "poll", "contact", "location", "reaction", "invite", "event"] as const;
export const moderationRules = ["link", "word", "spam", "flood", ...contentRules] as const;
export type ContentRule = typeof contentRules[number];
export type ModerationRule = typeof moderationRules[number];
export const moderationActions = ["allow", "warn", "delete", "review"] as const;
export type ModerationAction = typeof moderationActions[number];
export type ModerationPolicy = {
  moderation_actions: Partial<Record<ModerationRule, ModerationAction>>;
  moderation_warning: string | null;
  catalog_sales_enabled: boolean;
};
export const defaultModerationPolicy: ModerationPolicy = {
  moderation_actions: {}, moderation_warning: null, catalog_sales_enabled: false
};

const hostName = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const clockTime = /^([01]\d|2[0-3]):[0-5]\d$/;
const links = /(?:https?:\/\/|\bwww\.|\b(?:chat\.)?whatsapp\.com\/)(?:(?!https?:\/\/)[^\s<>"'\[\]{}()])*/gi;

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function readModerationPolicy(input: unknown): ModerationPolicy | null {
  const body = record(input);
  const actions = record(body?.moderation_actions);
  if (!body || !actions || typeof body.catalog_sales_enabled !== "boolean" ||
      (body.moderation_warning !== null && (typeof body.moderation_warning !== "string" ||
        body.moderation_warning.length > 600 ||
        /[\u0000-\u0008\u000B-\u001F\u007F]/.test(body.moderation_warning)))) return null;
  for (const [rule, action] of Object.entries(actions)) {
    if (!moderationRules.includes(rule as ModerationRule) || !moderationActions.includes(action as ModerationAction)) return null;
  }
  return {
    moderation_actions: actions as ModerationPolicy["moderation_actions"],
    moderation_warning: typeof body.moderation_warning === "string" ? body.moderation_warning.trim() || null : null,
    catalog_sales_enabled: body.catalog_sales_enabled
  };
}

export function normalizeGroupPolicyText(text: string) {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function hasDisallowedGroupLink(text: string, allowed: string[]) {
  return (text.match(links) ?? []).some((value) => {
    try {
      const address = value.replace(/[.,!;:]+$/, "");
      const url = new URL(/^https?:\/\//i.test(address) ? address : `https://${address}`);
      const host = url.hostname.toLowerCase().replace(/\.$/, "");
      return Boolean(url.username || url.password) || !allowed.some((domain) => host === domain || host.endsWith(`.${domain}`));
    } catch {
      return true;
    }
  });
}

export function readGroupPolicy(input: unknown): { rules: GroupPolicy; schedule: GroupHours | null } | null {
  const body = record(input);
  const rules = record(body?.rules);
  if (!rules || !Array.isArray(rules.allowed_link_hosts) || rules.allowed_link_hosts.length > 20 ||
    !Array.isArray(rules.blocked_words) || rules.blocked_words.length > 20 ||
    typeof rules.warning_limit !== "number" || !Number.isInteger(rules.warning_limit) || rules.warning_limit < 0 || rules.warning_limit > 10) return null;

  const hosts: string[] = [];
  for (const value of rules.allowed_link_hosts) {
    if (typeof value !== "string") return null;
    const host = value.trim().toLowerCase().replace(/\.$/, "");
    if (!hostName.test(host)) return null;
    hosts.push(host);
  }
  const words: string[] = [];
  for (const value of rules.blocked_words) {
    if (typeof value !== "string" || value.trim().length > 64) return null;
    const phrase = normalizeGroupPolicyText(value);
    if (!phrase || phrase.length > 64) return null;
    words.push(phrase);
  }
  const policy = { allowed_link_hosts: [...new Set(hosts)], blocked_words: [...new Set(words)], warning_limit: rules.warning_limit };

  if (body?.schedule === null) return { rules: policy, schedule: null };
  const hours = record(body?.schedule);
  if (!hours || typeof hours.enabled !== "boolean" || typeof hours.timezone !== "string" || hours.timezone.length > 64 ||
    !Array.isArray(hours.days) || hours.days.length < 1 || hours.days.length > 7 ||
    hours.days.some((day) => !Number.isInteger(day) || day < 1 || day > 7) ||
    typeof hours.opens_at !== "string" || !clockTime.test(hours.opens_at) ||
    typeof hours.closes_at !== "string" || !clockTime.test(hours.closes_at) || hours.opens_at === hours.closes_at) return null;

  let timezone: string;
  try {
    timezone = new Intl.DateTimeFormat("pt-MZ", { timeZone: hours.timezone.trim() }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
  return { rules: policy, schedule: {
    enabled: hours.enabled, timezone, days: [...new Set<number>(hours.days)].sort((a, b) => a - b),
    opens_at: hours.opens_at, closes_at: hours.closes_at,
  } };
}
