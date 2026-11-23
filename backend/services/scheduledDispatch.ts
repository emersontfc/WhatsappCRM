import { canPostInGroup, isGroupJid } from "./groupModeration.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { whatsappManager } from "../whatsappManager.ts";

type ScheduleTable = "scheduled_messages" | "scheduled_status";

export function scheduledContactJid(contact: { phone?: string | null; lid?: string | null } | null): string | null {
  const phone = contact?.phone?.replace(/\D/g, "");
  const lid = contact?.lid?.split("@")[0].replace(/\D/g, "");
  if (lid && (!phone || phone === lid)) return `${lid}@lid`;
  if (!phone || phone.length < 8 || phone.length > 15) return null;
  return `${phone.length === 9 && /^8[2-7]/.test(phone) ? "258" + phone : phone}@s.whatsapp.net`;
}

export async function dispatchScheduled(table: ScheduleTable, id: string, userId: string, dueBefore?: string) {
  let claim = supabaseAdmin.from(table).update({ status: "processing" })
    .eq("id", id).eq("user_id", userId).eq("status", "pending");
  if (dueBefore) claim = claim.lte("scheduled_at", dueBefore);
  const { data: item, error } = await claim.select("*").maybeSingle();
  if (error) throw error;
  if (!item) return { success: false, status: null, error: "O agendamento já saiu da fila ou não existe." };

  async function update(status: string, fields: Record<string, unknown>) {
    const { error: updateError } = await supabaseAdmin.from(table).update({ status, ...fields })
      .eq("id", id).eq("user_id", userId).eq("status", "processing");
    if (updateError) throw updateError;
  }

  const statusPost = table === "scheduled_status" || item.target_type === "status";
  let jid: string | null = statusPost ? "status@broadcast" : null;
  if (item.target_type === "group" && !statusPost) {
    try {
      if (!isGroupJid(item.group_jid || "") || !item.message?.trim() || item.media_url) {
        throw new Error("Anúncio de grupo inválido.");
      }
      const group = await whatsappManager.getGroupMetadata(userId, item.group_jid);
      if (!canPostInGroup(group, whatsappManager.getMe(userId))) throw new Error("Sem permissão para publicar no grupo.");
      jid = item.group_jid;
    } catch (failure) {
      const offline = failure instanceof Error && failure.message === "WhatsApp não conectado";
      const attempts = Number(item.attempts ?? 0) + 1;
      const message = offline ? "WhatsApp desligado. Verifique a ligação." : "Não foi possível validar a participação ou permissão no grupo.";
      if (offline && attempts < 3) {
        await update("pending", { attempts, error: message, scheduled_at: new Date(Date.now() + 5 * 60_000 * attempts).toISOString() });
        return { success: false, status: "pending", error: message };
      }
      await update("failed", { attempts, error: message });
      return { success: false, status: "failed", error: message };
    }
  } else if (!statusPost && item.contact_id) {
    const { data: contact, error: contactError } = await supabaseAdmin.from("contacts").select("phone,lid")
      .eq("id", item.contact_id).eq("user_id", userId).maybeSingle();
    if (contactError) {
      await update("pending", { scheduled_at: new Date(Date.now() + 60000).toISOString(), error: "Consulta do contacto indisponível." });
      return { success: false, status: "pending", error: "Consulta do contacto indisponível. Nova tentativa agendada." };
    }
    jid = scheduledContactJid(contact);
  } else if (!statusPost && typeof item.phone === "string" && /^\+?[\d\s()-]+$/.test(item.phone)) {
    // Older jobs stored just a phone. Never fall back after a failed owner-scoped contact lookup.
    jid = scheduledContactJid({ phone: item.phone });
  }
  if (!jid) {
    await update("failed", { error: "Contacto inválido para a conta." });
    return { success: false, status: "failed", error: "Contacto inválido para a conta." };
  }

  try {
    const result = await whatsappManager.sendMessage(userId, jid, item.caption || item.message || "",
      item.media_url, item.media_type, undefined, item.media_mimetype, item.media_filename);
    if (!result?.key?.id) throw new Error("WhatsApp did not acknowledge the send");
  } catch (failure) {
    const offline = failure instanceof Error && failure.message === "WhatsApp session not connected.";
    const attempts = Number(item.attempts ?? 0) + 1;
    if (offline && attempts < 3) {
      await update("pending", { attempts, scheduled_at: new Date(Date.now() + 5 * 60_000 * attempts).toISOString(),
        error: "WhatsApp desligado. Nova tentativa agendada." });
      return { success: false, status: "pending", error: "WhatsApp desligado. Nova tentativa agendada." };
    }
    const message = offline ? "WhatsApp desligado após três tentativas."
      : "Envio por confirmar. Consulte a conversa ou o Status antes de reenviar.";
    await update("failed", { attempts, error: message });
    return { success: false, status: "failed", error: message };
  }
  await update("sent", { error: null });
  return { success: true, status: "sent", error: null };
}
