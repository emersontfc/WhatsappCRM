import { randomUUID } from "node:crypto";
import express, { type Response } from "express";
import { access } from "node:fs/promises";
import path from "node:path";
import type { AuthRequest } from "../middleware/auth.ts";
import { dispatchScheduled, scheduledContactJid } from "../services/scheduledDispatch.ts";
import { disconnectedSchedule, scheduleAttachment, scheduleTableFor, scheduleUuid, writableScheduleGroup,
  type ScheduleTable, type ScheduleTarget } from "../services/schedulePolicy.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";

const router = express.Router();
const mediaTypes = ["image", "video", "audio", "document"];
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const isoInstant = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/;

function databaseError(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  if (["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "")) return "Faltam campos da Agenda. Verifica se as migrações 13, 16, 17 e 23 foram aplicadas.";
  if (code === "42501") return "A API não tem permissão para consultar a Agenda.";
  return null;
}

function fail(res: Response, operation: string, error: unknown, fallback: string) {
  console.warn("[Agenda] Store operation failed", { operation, code: (error as { code?: string } | null)?.code, requestId: res.get("X-Request-Id") });
  return res.status(503).json({ error: databaseError(error) ?? fallback });
}

async function isMatchingSchedule(table: ScheduleTable, id: string, userId: string, target: ScheduleTarget, signal: AbortSignal) {
  const columns = table === "scheduled_messages" ? "id,target_type" : "id";
  const { data, error } = await supabaseAdmin.from(table).select(columns).eq("id", id).eq("user_id", userId)
    .abortSignal(signal).maybeSingle();
  if (error) throw error;
  return !!data && (table === "scheduled_status" || ((data as { target_type?: string }).target_type ?? "contact") === target);
}

router.get("/", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Inicia sessão para abrir a Agenda." });
  try {
    const signal = AbortSignal.timeout(8_000);
    const [contacts, messages, statuses] = await Promise.all([
      supabaseAdmin.from("contacts").select("id,name,phone,lid").eq("user_id", userId).order("name").abortSignal(signal),
      supabaseAdmin.from("scheduled_messages").select("*").eq("user_id", userId).order("scheduled_at").abortSignal(signal),
      supabaseAdmin.from("scheduled_status").select("*").eq("user_id", userId).order("scheduled_at").abortSignal(signal)
    ]);
    const warnings = [
      contacts.error && "Não foi possível consultar os contactos.",
      messages.error && (databaseError(messages.error) ?? "Não foi possível consultar as mensagens agendadas."),
      statuses.error && (databaseError(statuses.error) ?? "Não foi possível consultar os Status agendados.")
    ].filter((item): item is string => typeof item === "string");
    if (contacts.error && messages.error && statuses.error) {
      return fail(res, "list", messages.error, "Não foi possível consultar a Agenda.");
    }
    return res.set("Cache-Control", "no-store").json({ success: true, data: {
      contacts: contacts.error ? null : (contacts.data ?? []).filter((contact) => scheduledContactJid(contact)),
      messages: messages.error ? null : messages.data,
      statuses: statuses.error ? null : statuses.data,
      warnings: [...new Set(warnings)], schedulerEnabled: process.env.DISABLE_SCHEDULER !== "true",
    } });
  } catch (error) {
    return fail(res, "list", error, "Não foi possível consultar a Agenda.");
  }
});

async function save(req: AuthRequest, res: Response) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Inicia sessão para guardar o agendamento." });
  const id = req.params.id;
  const body = req.body ?? {};
  const type = body.target_type as ScheduleTarget;
  const table = scheduleTableFor(type, id ? body.source_table : undefined);
  const incoming = text(body.scheduled_at);
  const scheduledAt = Date.parse(incoming);
  const requestKey = id ? null : (body.request_key ?? randomUUID());
  if (!table || (id && !scheduleUuid.test(id)) ||
      (requestKey !== null && (typeof requestKey !== "string" || !scheduleUuid.test(requestKey))) ||
      !isoInstant.test(incoming) || !Number.isFinite(scheduledAt) || scheduledAt < Date.now() - 120_000) {
    return res.status(400).json({ error: "Seleciona um destino e uma data válidos para o agendamento." });
  }
  const message = text(body.message);
  const submittedMedia = text(body.media_url);
  const mediaType = text(body.media_type);
  const mediaUrl = submittedMedia ? scheduleAttachment(submittedMedia, userId, mediaType) : null;
  const repeatDays = body.repeat_days ?? 0;
  let repeatZone = text(body.repeat_zone) || "Africa/Maputo";
  if (![0, 1, 7].includes(repeatDays) || (type === "contact" && repeatDays !== 0)) {
    return res.status(400).json({ error: "Frequência de publicação inválida." });
  }
  try {
    repeatZone = new Intl.DateTimeFormat("pt-MZ", { timeZone: repeatZone }).resolvedOptions().timeZone;
  } catch {
    return res.status(400).json({ error: "O fuso horário do agendamento é inválido." });
  }
  if (submittedMedia && (!mediaUrl || !mediaTypes.includes(mediaType))) {
    return res.status(400).json({ error: "Volta a anexar o ficheiro pela Agenda." });
  }
  if ((!message && !mediaUrl) || message.length > (type === "status" && !mediaUrl ? 700 : 4096) ||
    (type === "group" && mediaUrl && mediaType === "audio") ||
    (type === "status" && mediaUrl && !["image", "video"].includes(mediaType)) ||
    (mediaUrl && mediaType === "audio" && message)) {
    return res.status(400).json({ error: "O texto, o ficheiro ou o destino selecionado são inválidos para este agendamento." });
  }

  try {
    const signal = AbortSignal.timeout(8_000);
    if (requestKey) {
      const { data, error } = await supabaseAdmin.from(table).select("id").eq("user_id", userId)
        .eq("request_key", requestKey).abortSignal(signal).maybeSingle();
      if (error) throw error;
      if (data) return res.json({ success: true, id: data.id });
    }
    if (id && !await isMatchingSchedule(table, id, userId, type, signal)) {
      return res.status(404).json({ error: "Agendamento não encontrado." });
    }
    const contactId = text(body.contact_id);
    const groupJid = text(body.group_jid);
    let groupName: string | null = null;
    if (type === "contact") {
      if (!scheduleUuid.test(contactId)) return res.status(400).json({ error: "Seleciona um contacto da tua conta." });
      const { data, error } = await supabaseAdmin.from("contacts").select("phone,lid")
        .eq("id", contactId).eq("user_id", userId).abortSignal(signal).maybeSingle();
      if (error) throw error;
      if (!scheduledContactJid(data)) return res.status(400).json({ error: "O contacto selecionado não está disponível para envio." });
    } else if (type === "group") {
      try {
        const group = await writableScheduleGroup(userId, groupJid);
        if (!group) return res.status(403).json({ error: "A conta ligada não pode publicar nesse grupo." });
        groupName = group.subject || null;
      } catch (error) {
        return disconnectedSchedule(error)
          ? res.status(409).json({ error: "Liga o WhatsApp antes de agendar um anúncio no grupo." })
          : res.status(502).json({ error: "O WhatsApp não confirmou a permissão para publicar no grupo." });
      }
    }
    if (mediaUrl?.startsWith("/uploads/")) {
      try {
        await access(path.resolve(process.cwd(), "uploads", path.basename(mediaUrl)));
      } catch {
        return res.status(400).json({ error: "A nota de voz já não está disponível. Anexa-a novamente." });
      }
    }
    const scheduledISO = new Date(scheduledAt).toISOString();
    const payload = {
      user_id: userId, scheduled_at: scheduledISO, status: "pending", attempts: 0, error: null, retry_at: null,
      media_url: mediaUrl, media_type: mediaUrl ? mediaType : null,
      repeat_days: repeatDays, repeat_zone: repeatZone, repeat_anchor_at: scheduledISO,
      ...(requestKey ? { request_key: requestKey } : {}),
      ...(table === "scheduled_status" ? { caption: message } : {
        message, target_type: type, contact_id: type === "contact" ? contactId : null, phone: null,
        group_jid: type === "group" ? groupJid : null, group_name: groupName,
        media_mimetype: mediaUrl ? text(body.media_mimetype).slice(0, 120) || null : null,
        media_filename: mediaUrl ? text(body.media_filename).replace(/[\r\n]/g, "").slice(0, 180) || null : null
      })
    };
    const store = supabaseAdmin.from(table);
    const query = id ? store.update(payload).eq("id", id).eq("user_id", userId).eq("status", "pending") : store.insert(payload);
    const { data, error } = await query.select("id").abortSignal(AbortSignal.timeout(8_000)).maybeSingle();
    if (error?.code === "23505" && requestKey) {
      const { data: saved, error: readError } = await supabaseAdmin.from(table).select("id").eq("user_id", userId)
        .eq("request_key", requestKey).abortSignal(AbortSignal.timeout(8_000)).maybeSingle();
      if (readError) throw readError;
      if (saved) return res.json({ success: true, id: saved.id });
    }
    if (error) throw error;
    if (!data) return id ? res.status(409).json({ error: "O agendamento já saiu da fila." })
      : fail(res, "create", null, "A base não confirmou a gravação do agendamento.");
    return res.status(id ? 200 : 201).json({ success: true, id: data.id });
  } catch (error) {
    return fail(res, id ? "update" : "create", error, "Não foi possível guardar o agendamento.");
  }
}

router.post("/", save);
router.patch("/:id", save);

router.delete("/:id", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const id = req.params.id;
  const target = req.query.target_type as ScheduleTarget;
  const table = scheduleTableFor(target, req.query.source_table);
  if (!userId) return res.status(401).json({ error: "Inicia sessão para apagar o agendamento." });
  if (!table || !scheduleUuid.test(id)) return res.status(400).json({ error: "Agendamento inválido." });
  try {
    const signal = AbortSignal.timeout(8_000);
    if (!await isMatchingSchedule(table, id, userId, target, signal)) return res.status(404).json({ error: "Agendamento não encontrado." });
    const { data, error } = await supabaseAdmin.from(table).delete().eq("id", id).eq("user_id", userId)
      .neq("status", "processing").select("id").abortSignal(signal).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(409).json({ error: "O agendamento está em processamento." });
    return res.json({ success: true });
  } catch (error) {
    return fail(res, "delete", error, "Não foi possível apagar o agendamento.");
  }
});

router.post("/:id/send", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const id = req.params.id;
  const target = req.body?.target_type as ScheduleTarget;
  const table = scheduleTableFor(target, req.body?.source_table);
  if (!userId) return res.status(401).json({ error: "Inicia sessão para enviar o agendamento." });
  if (!table || !scheduleUuid.test(id)) return res.status(400).json({ error: "Agendamento inválido." });
  try {
    if (!await isMatchingSchedule(table, id, userId, target, AbortSignal.timeout(8_000))) {
      return res.status(404).json({ error: "Agendamento não encontrado." });
    }
    const result = await dispatchScheduled(table, id, userId);
    return res.status(result.success ? 200 : 409).json(result);
  } catch (error) {
    return fail(res, "send", error, "Não foi possível confirmar o envio. Consulta o estado da Agenda antes de repetir.");
  }
});

export default router;
