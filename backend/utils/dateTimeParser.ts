/**
 * Robust date & relative time parser for Natural Language in Portuguese
 * Default Timezone: Africa/Maputo (UTC+2 / CAT - Central Africa Time)
 */

export interface ParsedDateTimeResult {
  date: Date;
  iso: string;
  formattedLocal: string;
  isRelative: boolean;
  confidence: number;
}

// Maputo / Mozambique is UTC+2 (no daylight saving time)
export const DEFAULT_TIMEZONE = "Africa/Maputo";
export const MAPUTO_UTC_OFFSET_HOURS = 2;

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  "segunda-feira": 1,
  terca: 2,
  "terça": 2,
  "terça-feira": 2,
  "terca-feira": 2,
  quarta: 3,
  "quarta-feira": 3,
  quinta: 4,
  "quinta-feira": 4,
  sexta: 5,
  "sexta-feira": 5,
  sabado: 6,
  "sábado": 6
};

/**
 * Parses relative & absolute date expressions commonly passed by users or LLM agents.
 * e.g.
 * - "amanhã às 9 horas", "amanhã às 09:00", "amanhã 15h"
 * - "hoje às 18:00", "hoje às 14h30"
 * - "sexta-feira às 15 horas", "quarta às 10h"
 * - "daqui a 2 horas", "daqui a 30 minutos", "em 1 hora"
 * - "2026-11-20T10:00:00Z", "2026-11-20 10:00", "20/11/2026 10:00"
 */
export function parseScheduledDateTime(
  input: string,
  referenceDate: Date = new Date(),
  timezone: string = DEFAULT_TIMEZONE
): ParsedDateTimeResult {
  if (!input || typeof input !== "string" || !input.trim()) {
    // Default fallback: tomorrow at 09:00
    const fallback = new Date(referenceDate.getTime() + 24 * 60 * 60 * 1000);
    fallback.setHours(9, 0, 0, 0);
    return {
      date: fallback,
      iso: fallback.toISOString(),
      formattedLocal: formatInTimezone(fallback, timezone),
      isRelative: true,
      confidence: 0.5
    };
  }

  const clean = input.trim().toLowerCase();

  // 1. Direct ISO or standard date formats
  // Check if standard Date.parse works directly (e.g. 2026-11-20T09:00:00Z)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(clean)) {
    const d = new Date(clean);
    if (!isNaN(d.getTime())) {
      return {
        date: d,
        iso: d.toISOString(),
        formattedLocal: formatInTimezone(d, timezone),
        isRelative: false,
        confidence: 1.0
      };
    }
  }

  // 2. "YYYY-MM-DD HH:mm" or "YYYY-MM-DD HH:mm:ss"
  const ymdMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})(?:[\sT](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (ymdMatch) {
    const [_, y, m, day, h, min, sec] = ymdMatch;
    const hours = h ? parseInt(h, 10) : 9;
    const minutes = min ? parseInt(min, 10) : 0;
    const seconds = sec ? parseInt(sec, 10) : 0;
    // Maputo is UTC+2, so UTC hour = Maputo hour - 2
    const utcHours = hours - MAPUTO_UTC_OFFSET_HOURS;
    const d = new Date(Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(day, 10), utcHours, minutes, seconds));
    return {
      date: d,
      iso: d.toISOString(),
      formattedLocal: formatInTimezone(d, timezone),
      isRelative: false,
      confidence: 0.95
    };
  }

  // 3. "DD/MM/YYYY HH:mm"
  const dmyMatch = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\sT](\d{1,2}):(\d{2}))?$/);
  if (dmyMatch) {
    const [_, day, m, y, h, min] = dmyMatch;
    const hours = h ? parseInt(h, 10) : 9;
    const minutes = min ? parseInt(min, 10) : 0;
    const utcHours = hours - MAPUTO_UTC_OFFSET_HOURS;
    const d = new Date(Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(day, 10), utcHours, minutes, 0));
    return {
      date: d,
      iso: d.toISOString(),
      formattedLocal: formatInTimezone(d, timezone),
      isRelative: false,
      confidence: 0.95
    };
  }

  // Helper to extract time of day: "às 9h", "às 15:30", "às 9 horas", "14h"
  function extractTime(str: string): { hours: number; minutes: number } {
    const timeMatch = str.match(/(?:às|as|\b)\s*(\d{1,2})(?:[:h](\d{2})?|h|\s*horas?)/i) ||
                      str.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      const h = parseInt(timeMatch[1], 10);
      const m = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      return { hours: Math.min(Math.max(h, 0), 23), minutes: Math.min(Math.max(m, 0), 59) };
    }
    return { hours: 9, minutes: 0 }; // Default 9:00 AM
  }

  // 4. "daqui a X horas" / "em X minutos"
  const durationMatch = clean.match(/(?:daqui\s+a|em)\s+(\d+)\s*(minutos?|mins?|horas?|hrs?|dias?)/i);
  if (durationMatch) {
    const amount = parseInt(durationMatch[1], 10);
    const unit = durationMatch[2].toLowerCase();
    let millis = 0;
    if (unit.startsWith("min")) millis = amount * 60 * 1000;
    else if (unit.startsWith("h")) millis = amount * 60 * 60 * 1000;
    else if (unit.startsWith("dia")) millis = amount * 24 * 60 * 60 * 1000;

    const d = new Date(referenceDate.getTime() + millis);
    return {
      date: d,
      iso: d.toISOString(),
      formattedLocal: formatInTimezone(d, timezone),
      isRelative: true,
      confidence: 0.95
    };
  }

  // 5. "amanhã"
  if (clean.includes("amanhã") || clean.includes("amanha")) {
    const { hours, minutes } = extractTime(clean);
    // Tomorrow relative to referenceDate in UTC
    const target = new Date(referenceDate.getTime() + 24 * 60 * 60 * 1000);
    const utcHours = hours - MAPUTO_UTC_OFFSET_HOURS;
    const d = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(), utcHours, minutes, 0));
    return {
      date: d,
      iso: d.toISOString(),
      formattedLocal: formatInTimezone(d, timezone),
      isRelative: true,
      confidence: 0.95
    };
  }

  // 6. "hoje"
  if (clean.includes("hoje")) {
    const { hours, minutes } = extractTime(clean);
    const utcHours = hours - MAPUTO_UTC_OFFSET_HOURS;
    let d = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate(), utcHours, minutes, 0));
    // If the time already passed today, advance to tomorrow
    if (d.getTime() <= referenceDate.getTime()) {
      d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    }
    return {
      date: d,
      iso: d.toISOString(),
      formattedLocal: formatInTimezone(d, timezone),
      isRelative: true,
      confidence: 0.9
    };
  }

  // 7. Days of week: "sexta-feira às 15 horas", "quarta às 10h"
  for (const [dayName, dayIndex] of Object.entries(WEEKDAYS)) {
    if (clean.includes(dayName)) {
      const { hours, minutes } = extractTime(clean);
      const currentDay = referenceDate.getUTCDay();
      let diff = dayIndex - currentDay;
      if (diff <= 0) diff += 7; // Next occurrence of that weekday

      const target = new Date(referenceDate.getTime() + diff * 24 * 60 * 60 * 1000);
      const utcHours = hours - MAPUTO_UTC_OFFSET_HOURS;
      const d = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(), utcHours, minutes, 0));
      return {
        date: d,
        iso: d.toISOString(),
        formattedLocal: formatInTimezone(d, timezone),
        isRelative: true,
        confidence: 0.95
      };
    }
  }

  // 8. General fallback: try Date constructor, otherwise tomorrow at 09:00 Maputo
  const directDate = new Date(clean);
  if (!isNaN(directDate.getTime()) && directDate > referenceDate) {
    return {
      date: directDate,
      iso: directDate.toISOString(),
      formattedLocal: formatInTimezone(directDate, timezone),
      isRelative: false,
      confidence: 0.8
    };
  }

  const fallback = new Date(referenceDate.getTime() + 24 * 60 * 60 * 1000);
  const utcHours = 9 - MAPUTO_UTC_OFFSET_HOURS;
  const d = new Date(Date.UTC(fallback.getUTCFullYear(), fallback.getUTCMonth(), fallback.getUTCDate(), utcHours, 0, 0));
  return {
    date: d,
    iso: d.toISOString(),
    formattedLocal: formatInTimezone(d, timezone),
    isRelative: true,
    confidence: 0.6
  };
}

export function formatInTimezone(date: Date, timezone: string = DEFAULT_TIMEZONE): string {
  try {
    return new Intl.DateTimeFormat("pt-PT", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  } catch {
    return date.toLocaleString("pt-PT");
  }
}
