import { Router, type Response } from "express";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { authenticate, type AuthRequest } from "../middleware/auth.ts";
import { readContactPhone } from "../../shared/contactPhone.ts";
import { appointmentInstant, appointmentZone, getAppointmentTimeZone } from "../services/appointmentReminders.ts";
import { dispatchAppointmentNotification, manualAppointmentKind } from "../services/appointmentDelivery.ts";

const router = Router();
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const time = /^([01]\d|2[0-3]):[0-5]\d(?::00)?$/;
const statuses = ["scheduled", "confirmed", "completed", "cancelled"];
const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const isUuid = (value: unknown): value is string => typeof value === "string" && uuid.test(value);

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function appointmentError(res: Response, error: unknown, publicRequest = false) {
  const { code, message } = (error ?? {}) as { code?: string; message?: string };
  if (code === "P0002") return res.status(404).json({ error: message || "Marcação indisponível." });
  if (code === "23P01" || code === "23505") return res.status(409).json({ error: code === "23P01" && message
    ? message : "Este horário já não está disponível." });
  if (code === "22023") return res.status(400).json({ error: message || "Confere os dados da marcação." });
  if (code === "22007" || code === "22008" || code === "22P02") {
    return res.status(400).json({ error: "Confere a data, o horário e os dados da marcação." });
  }
  console.warn("[Appointments] Request failed:", code ?? "unavailable");
  const schemaMissing = ["42883", "42703", "42P01", "PGRST202", "PGRST204", "PGRST205"].includes(code ?? "");
  return res.status(503).json({ error: !publicRequest && schemaMissing
    ? "A agenda precisa da migração 24 do Supabase."
    : "Não foi possível concluir agora. Atualiza a agenda e tenta novamente." });
}

class AppointmentInputError extends Error {
  readonly code = "22023";
}

function saveFields(body: Record<string, unknown>) {
  const fields: Record<string, string | null> = {};
  for (const key of ["contact_id", "service_id", "professional_id", "request_id"] as const) {
    const value = body[key];
    if (value === undefined) continue;
    if (value !== "" && value !== null && !isUuid(value)) throw new AppointmentInputError("Contacto, serviço ou profissional inválido.");
    fields[key] = value ? String(value) : null;
  }
  for (const [key, limit] of [["customer_name", 150], ["notes", 1000]] as const) {
    const value = body[key];
    if (value === undefined) continue;
    if (key === "notes" && value === null) { fields.notes = null; continue; }
    if (typeof value !== "string" || value.trim().length > limit) throw new AppointmentInputError("Confere o nome e as notas.");
    fields[key] = value.trim() || null;
  }
  if (body.customer_phone !== undefined) {
    if (body.customer_phone === "" || body.customer_phone === null) fields.customer_phone = null;
    else {
      const phone = readContactPhone(body.customer_phone);
      if (!phone) throw new AppointmentInputError("Indica um número de WhatsApp válido.");
      fields.customer_phone = phone;
    }
  }
  if (body.appointment_date !== undefined) {
    if (!isValidDate(body.appointment_date)) throw new AppointmentInputError("Data inválida.");
    fields.appointment_date = body.appointment_date;
  }
  for (const key of ["start_time", "end_time"] as const) {
    const value = body[key];
    if (value === undefined) continue;
    if (key === "end_time" && (value === "" || value === null)) { fields.end_time = null; continue; }
    if (typeof value !== "string" || (!time.test(value) && !(key === "end_time" && /^(24:00)(?::00)?$/.test(value)))) {
      throw new AppointmentInputError("Horário inválido.");
    }
    fields[key] = value;
  }
  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !statuses.includes(body.status)) throw new AppointmentInputError("Estado de marcação inválido.");
    fields.status = body.status;
  }
  return fields;
}

type Appointment = {
  id: string; user_id: string; schedule_revision: string; appointment_date: string; start_time: string;
  end_time: string; start_at: string | null; time_zone: string | null; customer_phone: string | null; status: string;
  service_id: string | null; professional_id: string | null;
};
type ServiceLabel = { id: string; name: string; price: number; duration_minutes: number };
type ProfessionalLabel = { id: string; name: string; role: string | null };

async function saveAppointment(userId: string, id: string | null, body: Record<string, unknown>, publicRequest: boolean) {
  const { data, error } = await supabaseAdmin.rpc("agentx_save_appointment", {
    p_user: userId, p_appointment: id, p_input: saveFields(body), p_public: publicRequest
  }).abortSignal(AbortSignal.timeout(10_000));
  if (error) throw error;
  if (!data?.appointment?.id) throw new Error("Appointment was not returned");
  return data as { appointment: Appointment; replayed: boolean };
}

async function appointmentLabels(userId: string, rows: Appointment[]) {
  const services = [...new Set(rows.map((row) => row.service_id).filter(Boolean))];
  const professionals = [...new Set(rows.map((row) => row.professional_id).filter(Boolean))];
  const [serviceResult, professionalResult] = await Promise.all([
    services.length ? supabaseAdmin.from("services").select("id,name,price,duration_minutes").eq("user_id", userId).in("id", services).abortSignal(AbortSignal.timeout(8_000))
      : { data: [], error: null },
    professionals.length ? supabaseAdmin.from("professionals").select("id,name,role").eq("user_id", userId).in("id", professionals).abortSignal(AbortSignal.timeout(8_000))
      : { data: [], error: null }
  ]);
  if (serviceResult.error || professionalResult.error) throw serviceResult.error || professionalResult.error;
  const serviceById = new Map((serviceResult.data as ServiceLabel[] | null)?.map((item) => [item.id, item] as const));
  const professionalById = new Map((professionalResult.data as ProfessionalLabel[] | null)?.map((item) => [item.id, item] as const));
  return rows.map((row) => ({
    ...row, services: row.service_id ? serviceById.get(row.service_id) ?? null : null,
    professionals: row.professional_id ? professionalById.get(row.professional_id) ?? null : null
  }));
}

router.get("/public/info/:userId", async (req, res) => {
  const { userId } = req.params;
  if (!isUuid(userId)) return res.status(404).json({ error: "Estabelecimento indisponível." });
  try {
    const signal = AbortSignal.timeout(8_000);
    const [profile, services, professionals, zone] = await Promise.all([
      supabaseAdmin.from("users").select("id,name").eq("id", userId).abortSignal(signal).maybeSingle(),
      supabaseAdmin.from("services").select("id,name,description,duration_minutes,price")
        .eq("user_id", userId).eq("active", true).order("name").abortSignal(signal),
      supabaseAdmin.from("professionals").select("id,name,role")
        .eq("user_id", userId).eq("active", true).order("name").abortSignal(signal),
      getAppointmentTimeZone(userId)
    ]);
    if (profile.error || services.error || professionals.error) throw profile.error || services.error || professionals.error;
    if (!profile.data) return res.status(404).json({ error: "Estabelecimento indisponível." });
    return res.json({ success: true, data: {
      business: profile.data, services: services.data ?? [], professionals: professionals.data ?? [], timeZone: zone
    } });
  } catch (error) {
    return appointmentError(res, error, true);
  }
});

router.get("/public/slots", async (req, res) => {
  const { userId, serviceId, professionalId, date } = req.query;
  if (!isUuid(userId) || !isValidDate(date) || (serviceId && !isUuid(serviceId)) || (professionalId && !isUuid(professionalId))) {
    return res.status(400).json({ error: "Confere o estabelecimento, a data e o serviço." });
  }
  try {
    const { data, error } = await supabaseAdmin.rpc("agentx_available_appointment_slots", {
      p_user: userId, p_service: serviceId || null, p_professional: professionalId || null, p_date: date
    }).abortSignal(AbortSignal.timeout(8_000));
    if (error) throw error;
    if (!Array.isArray(data?.slots)) throw new Error("Appointment slots were not returned");
    return res.json({ success: true, ...data });
  } catch (error) {
    return appointmentError(res, error, true);
  }
});

router.post("/public/book", async (req, res) => {
  try {
    const { userId, serviceId, professionalId, customerName, customerPhone, appointmentDate, startTime, notes, requestId } = req.body ?? {};
    if (!isUuid(userId)) return res.status(404).json({ error: "Estabelecimento indisponível." });
    const { appointment, replayed } = await saveAppointment(userId, null, {
      service_id: serviceId, professional_id: professionalId, customer_name: customerName, customer_phone: customerPhone,
      appointment_date: appointmentDate, start_time: startTime, notes, request_id: requestId
    }, true);

    const [labels, delivery] = await Promise.allSettled([
      appointmentLabels(userId, [appointment]),
      dispatchAppointmentNotification(userId, appointment.id, appointment.schedule_revision, "confirmation")
    ]);
    const display = labels.status === "fulfilled" ? labels.value[0] : null;
    const confirmation = delivery.status === "fulfilled" && delivery.value.status !== "ineligible"
      ? delivery.value.status : "uncertain";
    return res.json({ success: true, confirmation, replayed, data: {
      id: appointment.id, appointment_date: appointment.appointment_date, start_time: appointment.start_time,
      end_time: appointment.end_time, time_zone: appointment.time_zone,
      services: display?.services ? { name: display.services.name } : null,
      professionals: display?.professionals ? { name: display.professionals.name } : null
    } });
  } catch (error) {
    return appointmentError(res, error, true);
  }
});

router.use(authenticate);

router.get("/", async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const { startDate, endDate, professionalId, status } = req.query;
  if ((startDate !== undefined && !isValidDate(startDate)) || (endDate !== undefined && !isValidDate(endDate))
      || (professionalId !== undefined && !isUuid(professionalId))
      || (status !== undefined && (typeof status !== "string" || !statuses.includes(status)))) {
    return res.status(400).json({ error: "Filtros da agenda inválidos." });
  }
  try {
    let query = supabaseAdmin.from("appointments").select("*").eq("user_id", userId)
      .order("appointment_date").order("start_time");
    if (startDate) query = query.gte("appointment_date", startDate as string);
    if (endDate) query = query.lte("appointment_date", endDate as string);
    if (professionalId) query = query.eq("professional_id", professionalId as string);
    if (status) query = query.eq("status", status as string);
    const { data, error } = await query.abortSignal(AbortSignal.timeout(8_000));
    if (error) throw error;
    const appointments = (data ?? []) as Appointment[];
    if (!appointments.length) return res.json({ success: true, data: [] });
    const revisions = new Map(appointments.map(({ id, schedule_revision }) => [id, schedule_revision]));
    const ids = [...revisions.keys()];
    const notificationRows = [];
    // Bound PostgREST URLs.
    for (let index = 0; index < ids.length; index += 100) {
      const result = await supabaseAdmin.from("agentx_appointment_notifications")
        .select("appointment_id,revision,kind,status,updated_at,expires_at").eq("user_id", userId)
        .in("appointment_id", ids.slice(index, index + 100)).abortSignal(AbortSignal.timeout(8_000));
      if (result.error) throw result.error;
      notificationRows.push(...(result.data ?? []));
    }
    const byAppointment = new Map<string, Record<string, string>>();
    const now = Date.now();
    for (const row of notificationRows) {
      if (row.revision !== revisions.get(row.appointment_id)) continue;
      if (row.status === "retry" && Date.parse(row.expires_at) <= now) continue;
      const statuses = byAppointment.get(row.appointment_id) ?? {};
      statuses[row.kind] = row.status === "sending" && Date.parse(row.updated_at) + 120_000 <= now ? "uncertain" : row.status;
      byAppointment.set(row.appointment_id, statuses);
    }
    const labelled = await appointmentLabels(userId, appointments);
    return res.json({ success: true, data: labelled.map((row) => ({
      ...row, notification_statuses: byAppointment.get(row.id) ?? {}
    })) });
  } catch (error) {
    return appointmentError(res, error);
  }
});

router.post("/", async (req: AuthRequest, res) => {
  try {
    const { appointment, replayed } = await saveAppointment(req.user!.id, null, req.body ?? {}, false);
    return res.json({ success: true, data: appointment, replayed });
  } catch (error) {
    return appointmentError(res, error);
  }
});

router.put("/:id", async (req: AuthRequest, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: "Marcação não encontrada." });
  try {
    const { appointment } = await saveAppointment(req.user!.id, req.params.id, req.body ?? {}, false);
    return res.json({ success: true, data: appointment });
  } catch (error) {
    return appointmentError(res, error);
  }
});

router.post("/:id/reminder", async (req: AuthRequest, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: "Marcação não encontrada." });
  const userId = req.user!.id;
  try {
    const { data: appointment, error } = await supabaseAdmin.from("appointments")
      .select("appointment_date,start_time,start_at,time_zone,schedule_revision,customer_phone,status")
      .eq("id", req.params.id).eq("user_id", userId).abortSignal(AbortSignal.timeout(8_000)).maybeSingle();
    if (error) throw error;
    if (!appointment) return res.status(404).json({ error: "Marcação não encontrada." });
    const now = new Date();
    const zone = appointment.time_zone ? appointmentZone(appointment.time_zone) : await getAppointmentTimeZone(userId);
    if (!appointment.customer_phone || !["scheduled", "confirmed"].includes(appointment.status)
      || !(appointmentInstant(appointment, zone).getTime() > now.getTime())) {
      return res.status(409).json({ error: "A marcação precisa de estar ativa, no futuro e ter um número WhatsApp válido." });
    }
    const result = await dispatchAppointmentNotification(userId, req.params.id, appointment.schedule_revision, manualAppointmentKind(appointment, zone, now));
    if (result.status === "sent") return res.json({ success: true, ...result });
    if (result.status === "retry") return res.status(503).json({ error: "O WhatsApp está desligado. O lembrete fica na fila para quando voltar a ligar." });
    if (result.status === "sending") return res.status(409).json({ error: "Já há um envio em curso para este lembrete." });
    return res.status(409).json({ error: result.status === "uncertain"
      ? "O WhatsApp ainda não confirmou o envio. Verifica a conversa para evitar duplicados."
      : "A marcação mudou ou já passou. Atualiza a agenda." });
  } catch (error) {
    return appointmentError(res, error);
  }
});

router.delete("/:id", async (req: AuthRequest, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: "Marcação não encontrada." });
  try {
    const { data, error } = await supabaseAdmin.rpc("agentx_delete_appointment", {
      p_user: req.user!.id, p_appointment: req.params.id
    }).abortSignal(AbortSignal.timeout(8_000));
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Marcação não encontrada." });
    return res.json({ success: true });
  } catch (error) {
    return appointmentError(res, error);
  }
});

async function saveResource(table: "services" | "professionals", userId: string, id: unknown, payload: object) {
  if (id && !isUuid(id)) throw new AppointmentInputError("Identificador inválido.");
  const query = id ? supabaseAdmin.from(table).update(payload).eq("id", id).eq("user_id", userId)
    : supabaseAdmin.from(table).insert({ ...payload, user_id: userId });
  const { data, error } = await query.select().abortSignal(AbortSignal.timeout(8_000)).maybeSingle();
  if (error) throw error;
  return data;
}

for (const table of ["services", "professionals"] as const) {
  router.get(`/${table}`, async (req: AuthRequest, res) => {
    try {
      const { data, error } = await supabaseAdmin.from(table).select("*").eq("user_id", req.user!.id).order("name")
        .abortSignal(AbortSignal.timeout(8_000));
      if (error) throw error;
      return res.json({ success: true, data });
    } catch (error) {
      return appointmentError(res, error);
    }
  });
  router.delete(`/${table}/:id`, async (req: AuthRequest, res) => {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: "Registo não encontrado." });
    try {
      const { data, error } = await supabaseAdmin.from(table).delete().eq("id", req.params.id).eq("user_id", req.user!.id)
        .select("id").abortSignal(AbortSignal.timeout(8_000)).maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: "Registo não encontrado." });
      return res.json({ success: true });
    } catch (error) {
      return appointmentError(res, error);
    }
  });
}

router.post("/services", async (req: AuthRequest, res) => {
  const { id, name, description, duration_minutes = 30, price = 0, active = true } = req.body ?? {};
  if (typeof name !== "string" || !name.trim() || name.trim().length > 150 || !Number.isInteger(duration_minutes)
    || duration_minutes < 1 || duration_minutes > 1440 || !Number.isFinite(Number(price)) || Number(price) < 0
    || typeof active !== "boolean" || (description && (typeof description !== "string" || description.length > 1000))) {
    return res.status(400).json({ error: "Confere o nome, duração e preço do serviço." });
  }
  try {
    const data = await saveResource("services", req.user!.id, id, {
      name: name.trim(), description: description?.trim() || null, duration_minutes, price: Number(price), active
    });
    if (!data) return res.status(404).json({ error: "Serviço não encontrado." });
    return res.json({ success: true, data });
  } catch (error) {
    return appointmentError(res, error);
  }
});

router.post("/professionals", async (req: AuthRequest, res) => {
  const { id, name, role, email, phone, working_days = days.slice(0, 5), start_time = "08:00", end_time = "17:00",
    break_start = "12:00", break_end = "13:00", active = true } = req.body ?? {};
  const opens = typeof start_time === "string" ? start_time.slice(0, 5) : "";
  const closes = typeof end_time === "string" ? end_time.slice(0, 5) : "";
  const pauseFrom = typeof break_start === "string" ? break_start.slice(0, 5) : "";
  const pauseTo = typeof break_end === "string" ? break_end.slice(0, 5) : "";
  if (typeof name !== "string" || !name.trim() || name.trim().length > 150
    || !Array.isArray(working_days) || working_days.some((day) => !days.includes(day))
    || !time.test(start_time) || !time.test(end_time) || opens >= closes || typeof active !== "boolean"
    || ([role, email, phone].some((value) => value != null && (typeof value !== "string" || value.length > 150)))
    || (Boolean(break_start) !== Boolean(break_end))
    || (break_start && (!time.test(break_start) || !time.test(break_end) || pauseFrom < opens || pauseTo > closes || pauseFrom >= pauseTo))) {
    return res.status(400).json({ error: "Confere os dias de trabalho, o horário e o intervalo." });
  }
  try {
    const data = await saveResource("professionals", req.user!.id, id, {
      name: name.trim(), role: role?.trim() || null, email: email?.trim() || null, phone: phone?.trim() || null,
      working_days: [...new Set(working_days)], start_time: opens, end_time: closes,
      break_start: pauseFrom || null, break_end: pauseTo || null, active
    });
    if (!data) return res.status(404).json({ error: "Profissional não encontrado." });
    return res.json({ success: true, data });
  } catch (error) {
    return appointmentError(res, error);
  }
});

export default router;
