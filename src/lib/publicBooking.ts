import { formatInTimeZone } from "date-fns-tz";

export const dayInZone = (timeZone: string) => formatInTimeZone(Date.now(), timeZone, "yyyy-MM-dd");

export function readBookingZone(timeZone: unknown, fallback: string) {
  if (typeof timeZone !== "string" || !timeZone) return fallback;
  try { dayInZone(timeZone); return timeZone; } catch { return fallback; }
}

export function readBookingManageToken(fragment: string) {
  const tokens = new URLSearchParams(fragment.slice(1)).getAll("manage");
  if (!tokens.length) return null;
  return tokens.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(tokens[0]) ? tokens[0] : "";
}

export function readBookingManagePath(value: unknown, userId: string | undefined) {
  if (typeof value !== "string" || !userId) return null;
  const path = `/book/${encodeURIComponent(userId)}`;
  const fragment = value.slice(path.length);
  return value.startsWith(path) && fragment.startsWith("#") && readBookingManageToken(fragment) ? value : null;
}
