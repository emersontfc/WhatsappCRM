const phoneJid = /^(\d{8,15})(?::\d+)?@(?:s\.whatsapp\.net|c\.us)$/i;

export function normalizeContactPhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  const match = phoneJid.exec(raw);
  if (!match && !/^\+?[\d\s().-]+$/.test(raw)) return null;
  let phone = match?.[1] ?? raw.replace(/\D/g, "");
  if (!match && phone.startsWith("00")) phone = phone.slice(2);
  if (/^0?8[2-7]\d{7}$/.test(phone)) phone = "258" + phone.replace(/^0/, "");
  if (/^25808[2-7]\d{7}$/.test(phone)) phone = "258" + phone.slice(4);
  return /^[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

export function readContactPhone(input: unknown, dialCode?: string): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!/^\+|^00|@/.test(raw)) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 15) return null; // An unqualified LID is not a phone number.
    if (dialCode && dialCode !== "258" && /^[1-9]\d{0,2}$/.test(dialCode) &&
        /^[\d\s().-]+$/.test(raw) && digits.length <= 10 && !digits.startsWith(dialCode)) {
      return normalizeContactPhone("+" + dialCode + digits.replace(/^0/, ""));
    }
  }
  return normalizeContactPhone(raw);
}
