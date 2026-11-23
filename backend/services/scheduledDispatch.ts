import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { whatsappManager } from "../whatsappManager.ts";
import { normalizeContactPhone } from "../../shared/contactPhone.ts";
import { disconnectedSchedule, scheduleAttachment, scheduleDeadline, writableScheduleGroup, type ScheduleTable } from "./schedulePolicy.ts";

export function scheduledContactJid(contact: { phone?: string | null; lid?: string | null } | null): string | null {
  const phone = normalizeContactPhone(contact?.phone);
  const rawLid = contact?.lid || (/@lid$/i.test(contact?.phone ?? "") ? contact?.phone : "");
  const lid = /^(\d{5,20})(?::\d+)?(?:@lid)?$/i.exec(rawLid ?? "")?.[1];
  if (lid && (!phone || phone === lid)) return `${lid}@lid`;
  return phone ? `${phone}@s.whatsapp.net` : null;
}

type DispatchStatus = "pending" | "sent" | "failed";
const unavailableClaim = { success: false as const, status: null, error: "O agendamento já saiu da fila ou não existe." };

export async function dispatchScheduled(table: ScheduleTable, id: string, userId: string, dueBefore?: string) {
  const token = randomUUID();
  let claim = supabaseAdmin.from(table).update({ status: "processing", dispatch_token: token, dispatch_started_at: new Date().toISOString() })
    .eq("id", id).eq("user_id", userId).eq("status", "pending");
  if (dueBefore) claim = claim.lte("scheduled_at", dueBefore).or(`retry_at.is.null,retry_at.lte.${dueBefore}`);
  const { data: item, error } = await claim.select("*").abortSignal(AbortSignal.timeout(8_000)).maybeSingle();
  if (error) throw error;
  if (!item) return unavailableClaim;

  async function finish(status: DispatchStatus, message: string | null, fields: Record<string, unknown> = {}) {
    const { data, error: updateError } = await supabaseAdmin.from(table)
      .update({ status, error: message, retry_at: null, dispatch_token: null, ...fields })
      .eq("id", id).eq("user_id", userId).eq("status", "processing").eq("dispatch_token", token)
      .select("id").abortSignal(AbortSignal.timeout(8_000)).maybeSingle();
    if (updateError) throw updateError;
    if (!data) return unavailableClaim;
    return { success: status === "sent", status, error: message };
  }

  const attempts = Number(item.attempts ?? 0) + 1;
  const retry = (message: string) => attempts < 3
    ? finish("pending", message + " Nova tentativa agendada.", {
      attempts, dispatch_started_at: null, retry_at: new Date(Date.now() + attempts * 120_000).toISOString()
    })
    : finish("failed", message + " O limite de tentativas foi atingido.", { attempts });

  const statusPost = table === "scheduled_status" || item.target_type === "status";
  const message = item.caption || item.message || "";
  const mediaType = item.media_type;
  const media = item.media_url ? scheduleAttachment(item.media_url, userId, mediaType, true) : (item.media_url ?? undefined);
  if ((!message.trim() && !media) || (item.media_url && (!media || !["image", "video", "audio", "document"].includes(mediaType))) ||
    (statusPost && media && !["image", "video"].includes(mediaType)) || (mediaType === "audio" && message.trim())) {
    return finish("failed", "O conteúdo do agendamento não é válido. Verifica o anexo ou volta a guardar o texto.", { attempts });
  }

  let jid: string | null = statusPost ? "status@broadcast" : null;
  let contactId: string | undefined;
  if (item.target_type === "group" && !statusPost) {
    if (media && mediaType === "audio") return finish("failed", "A nota de voz pode ser agendada para um contacto direto.", { attempts });
    let group;
    try {
      group = await writableScheduleGroup(userId, item.group_jid ?? "");
    } catch (failure) {
      return retry(disconnectedSchedule(failure) ? "WhatsApp desligado." : "Não foi possível consultar o grupo.");
    }
    if (!group) return finish("failed", "A conta ligada deixou de poder publicar no grupo.", { attempts });
    jid = item.group_jid;
  } else if (!statusPost && item.contact_id) {
    const { data: contact, error: contactError } = await supabaseAdmin.from("contacts").select("phone,lid")
      .eq("id", item.contact_id).eq("user_id", userId).abortSignal(AbortSignal.timeout(8_000)).maybeSingle();
    if (contactError) return retry("Consulta do contacto indisponível.");
    jid = scheduledContactJid(contact);
    contactId = item.contact_id;
  } else if (!statusPost && typeof item.phone === "string" && /^\+?[\d\s()-]+$/.test(item.phone)) {
    // Older jobs stored just a phone. Never fall back after a failed owner-scoped contact lookup.
    jid = scheduledContactJid({ phone: item.phone });
  }
  if (!jid) return finish("failed", "Contacto inválido para a conta.", { attempts });

  let receipt: string;
  try {
    const result = await scheduleDeadline(whatsappManager.sendMessage(userId, jid, message,
      media ?? undefined, mediaType ?? undefined, undefined, item.media_mimetype, item.media_filename, contactId), 45_000);
    if (!result?.key?.id) throw new Error("O WhatsApp não devolveu um identificador.");
    receipt = result.key.id;
  } catch (failure) {
    if (disconnectedSchedule(failure)) return retry("WhatsApp desligado.");
    return finish("failed", "Envio por confirmar. Consulta a conversa ou o Status antes de criar outro agendamento.", { attempts });
  }
  // A gateway response alone is insufficient. Record the acknowledgement and
  // create a recurring successor (where configured) in the same DB update.
  return finish("sent", null, { attempts, dispatch_receipt_id: receipt });
}
