import { voiceUploadOwner } from "../../shared/voiceAudio.ts";
import { isGroupJid, canPostInGroup } from "./groupModeration.ts";
import { whatsappManager } from "../whatsappManager.ts";

export type ScheduleTable = "scheduled_messages" | "scheduled_status";
export type ScheduleTarget = "contact" | "group" | "status";
export const scheduleUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function scheduleTableFor(target: unknown, source?: unknown): ScheduleTable | null {
  if (target === "status") return source === "scheduled_messages" ? source : "scheduled_status";
  return target === "contact" || target === "group" ? "scheduled_messages" : null;
}

export function scheduleAttachment(value: string, userId: string, type: string | null | undefined, allowOldVoice = false) {
  try {
    const url = new URL(value, "https://agentx.invalid");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || url.search) return null;
    const voice = /^\/uploads\/([a-z0-9-]+\.ogg)$/i.exec(url.pathname)?.[1];
    if (type === "audio" && voice) {
      if (voiceUploadOwner(voice) === userId || (allowOldVoice && /^voice-\d+-\d+\.ogg$/.test(voice))) {
        // Convert to local path syntax so the transport never fetches the submitted host.
        return "/uploads/" + voice;
      }
      return null;
    }
    const base = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    if (!base || !scheduleUuid.test(userId) || url.origin !== new URL(base).origin) return null;
    const prefix = `/storage/v1/object/public/media/${userId}/`;
    const name = url.pathname.slice(prefix.length);
    return url.pathname.startsWith(prefix) && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) ? url.href : null;
  } catch {
    return null;
  }
}

export function disconnectedSchedule(error: unknown) {
  return error instanceof Error && ["WhatsApp não conectado", "WhatsApp session not connected."].includes(error.message);
}

export async function scheduleDeadline<T>(promise: Promise<T>, timeout: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Tempo de resposta excedido.")), timeout);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function writableScheduleGroup(userId: string, jid: string) {
  if (!isGroupJid(jid)) return null;
  const group = await scheduleDeadline(whatsappManager.getGroupMetadata(userId, jid), 8_000);
  if (group.id && group.id !== jid) return null;
  return canPostInGroup(group, whatsappManager.getMe(userId)) ? group : null;
}
