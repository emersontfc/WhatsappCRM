import { appointmentInstant, appointmentReminderMessage, getAppointmentTimeZone } from "../services/appointmentReminders.ts";
import { scheduledContactJid } from "../services/scheduledDispatch.ts";
import express from "express";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { whatsappManager } from "../whatsappManager.ts";
import { authenticate } from "../middleware/auth.ts";
import { saveContactIdentity } from "../services/contactIdentity.ts";
import { readContactPhone } from "../../shared/contactPhone.ts";

const router = express.Router();

// Helper to calculate available time slots for a given professional, service, and date
function calculateSlots(
  workingDays: string[],
  startTimeStr: string,
  endTimeStr: string,
  breakStartStr: string | null,
  breakEndStr: string | null,
  durationMinutes: number,
  targetDateStr: string,
  existingAppointments: { start_time: string; end_time: string }[]
): string[] {
  // Check day of week
  const dateObj = new Date(targetDateStr + "T00:00:00");
  const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const targetDay = dayNames[dateObj.getDay()];

  if (workingDays && workingDays.length > 0 && !workingDays.includes(targetDay)) {
    return []; // Not a working day
  }

  const parseToMinutes = (timeStr: string) => {
    const [h, m] = timeStr.split(":").map(Number);
    return h * 60 + m;
  };

  const formatMinutes = (totalMinutes: number) => {
    const h = Math.floor(totalMinutes / 60).toString().padStart(2, "0");
    const m = (totalMinutes % 60).toString().padStart(2, "0");
    return `${h}:${m}`;
  };

  const startMin = parseToMinutes(startTimeStr || "08:00");
  const endMin = parseToMinutes(endTimeStr || "17:00");
  const breakStartMin = breakStartStr ? parseToMinutes(breakStartStr) : null;
  const breakEndMin = breakEndStr ? parseToMinutes(breakEndStr) : null;

  const duration = durationMinutes > 0 ? durationMinutes : 30;
  const slots: string[] = [];

  for (let current = startMin; current + duration <= endMin; current += duration) {
    const slotStart = current;
    const slotEnd = current + duration;

    // Check lunch / break conflict
    if (breakStartMin !== null && breakEndMin !== null) {
      if (slotStart < breakEndMin && slotEnd > breakStartMin) {
        continue;
      }
    }

    const slotStartStr = formatMinutes(slotStart);
    const hasConflict = existingAppointments.some((app) => {
      const appStart = parseToMinutes(app.start_time);
      const appEnd = app.end_time ? parseToMinutes(app.end_time) : appStart + duration;
      return slotStart < appEnd && slotEnd > appStart;
    });

    if (!hasConflict) {
      slots.push(slotStartStr);
    }
  }

  return slots;
}

// ==========================================
// 🌐 PUBLIC BOOKING ENDPOINTS (NO AUTH NEEDED)
// ==========================================

// Get business info, services and professionals for public booking page
router.get("/public/info/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ success: false, error: "ID de usuário obrigatório" });

    // Fetch user profile
    const { data: userProfile } = await supabaseAdmin
      .from("users")
      .select("id, name")
      .eq("id", userId)
      .single();

    // Fetch active services
    const { data: services } = await supabaseAdmin
      .from("services")
      .select("id,name,description,duration_minutes,price")
      .eq("user_id", userId)
      .eq("active", true)
      .order("name", { ascending: true });

    // Fetch active professionals
    const { data: professionals } = await supabaseAdmin
      .from("professionals")
      .select("id,name,role,working_days,start_time,end_time")
      .eq("user_id", userId)
      .eq("active", true)
      .order("name", { ascending: true });

    res.json({
      success: true,
      data: {
        business: userProfile || { id: userId, name: "Marcações" },
        services: services || [],
        professionals: professionals || []
      }
    });
  } catch (err: any) {
    console.error("[Appointments] Error in /public/info:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Calculate free slots publicly for a specific date, professional & service
router.get("/public/slots", async (req, res) => {
  try {
    const { userId, professionalId, serviceId, date } = req.query;

    if (!userId || !date) {
      return res.status(400).json({ success: false, error: "Parâmetros incompletos (userId e date são obrigatórios)" });
    }

    // Fetch service duration
    let durationMinutes = 30;
    if (serviceId) {
      const { data: service } = await supabaseAdmin
        .from("services")
        .select("duration_minutes")
        .eq("id", serviceId as string).eq("user_id", userId as string).eq("active", true)
        .maybeSingle();
      if (!service) return res.status(404).json({ success: false, error: "Serviço indisponível." });
      if (service?.duration_minutes) durationMinutes = service.duration_minutes;
    }

    // Fetch professional working hours or use default
    let workingDays = ["mon", "tue", "wed", "thu", "fri", "sat"];
    let startTime = "08:00";
    let endTime = "17:00";
    let breakStart: string | null = "12:00";
    let breakEnd: string | null = "13:00";

    if (professionalId) {
      const { data: prof } = await supabaseAdmin
        .from("professionals")
        .select("*")
        .eq("id", professionalId as string).eq("user_id", userId as string).eq("active", true)
        .maybeSingle();
      if (!prof) return res.status(404).json({ success: false, error: "Profissional indisponível." });
      if (prof) {
        if (prof.working_days && prof.working_days.length > 0) workingDays = prof.working_days;
        if (prof.start_time) startTime = prof.start_time;
        if (prof.end_time) endTime = prof.end_time;
        breakStart = prof.break_start || null;
        breakEnd = prof.break_end || null;
      }
    }

    // Fetch existing appointments on that date (excluding cancelled)
    let query = supabaseAdmin
      .from("appointments")
      .select("start_time, end_time")
      .eq("user_id", userId as string)
      .eq("appointment_date", date as string)
      .neq("status", "cancelled");

    if (professionalId) {
      query = query.eq("professional_id", professionalId as string);
    }

    const { data: existingApps } = await query;

    const slots = calculateSlots(
      workingDays,
      startTime,
      endTime,
      breakStart,
      breakEnd,
      durationMinutes,
      date as string,
      existingApps || []
    );

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return res.status(400).json({ success: false, error: "Data inválida." });
    const timeZone = await getAppointmentTimeZone(String(userId));
    const available = slots.filter((time) =>
      appointmentInstant({ appointment_date: String(date), start_time: time }, timeZone).getTime() > Date.now());
    res.json({ success: true, slots: available, durationMinutes });
  } catch (err: any) {
    console.error("[Appointments] Error in /public/slots:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create booking publicly (from patient booking page)
router.post("/public/book", async (req, res) => {
  try {
    const {
      userId,
      serviceId,
      professionalId,
      customerName,
      customerPhone,
      appointmentDate,
      startTime,
      notes
    } = req.body;

    if (!userId || !customerName || !customerPhone || !appointmentDate || !startTime) {
      return res.status(400).json({ success: false, error: "Preencha todos os campos obrigatórios." });
    }

    const cleanPhone = readContactPhone(customerPhone);

    // Get service details
    let durationMinutes = 30;
    if (serviceId) {
      const { data: service } = await supabaseAdmin
        .from("services")
        .select("name, duration_minutes, price")
        .eq("id", serviceId).eq("user_id", userId).eq("active", true)
        .maybeSingle();
      if (!service) return res.status(404).json({ success: false, error: "Serviço indisponível." });
      if (service) {
        durationMinutes = service.duration_minutes || 30;
      }
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !cleanPhone) {
      return res.status(400).json({ success: false, error: "Data, horário ou telefone inválido." });
    }
    if (professionalId) {
      const { data: professional, error } = await supabaseAdmin.from("professionals").select("id")
        .eq("id", professionalId).eq("user_id", userId).eq("active", true).maybeSingle();
      if (error) throw error;
      if (!professional) return res.status(404).json({ success: false, error: "Profissional indisponível." });
    }

    // Calculate end time
    const [h, m] = startTime.split(":").map(Number);
    const endMinutes = h * 60 + m + durationMinutes;
    if (endMinutes > 24 * 60 || !(appointmentInstant({ appointment_date: appointmentDate, start_time: startTime },
      await getAppointmentTimeZone(userId)).getTime() > Date.now())) {
      return res.status(400).json({ success: false, error: "Escolhe um horário futuro dentro do dia de atendimento." });
    }
    const endTime = `${Math.floor(endMinutes / 60).toString().padStart(2, "0")}:${(endMinutes % 60).toString().padStart(2, "0")}`;

    // Verify slot is still available
    let conflictQuery = supabaseAdmin
      .from("appointments")
      .select("id")
      .eq("user_id", userId)
      .eq("appointment_date", appointmentDate)
      .neq("status", "cancelled")
      .lt("start_time", endTime).gt("end_time", startTime);

    if (professionalId) {
      conflictQuery = conflictQuery.eq("professional_id", professionalId);
    }

    const { data: conflicts, error: conflictError } = await conflictQuery;
    if (conflictError) throw conflictError;
    if (conflicts && conflicts.length > 0) {
      return res.status(409).json({ success: false, error: "Este horário acabou de ser reservado. Por favor, escolha outro horário." });
    }

    const contact = await saveContactIdentity(userId, {
      phone: cleanPhone, name: customerName, tags: ["Agendamento Online", "Paciente/Cliente"]
    });
    if (!contact?.id) throw new Error("Não foi possível guardar o contacto da marcação.");

    // Create appointment
    const { data: appointment, error: insertError } = await supabaseAdmin
      .from("appointments")
      .insert({
        user_id: userId,
        contact_id: contact.id,
        service_id: serviceId || null,
        professional_id: professionalId || null,
        customer_name: customerName,
        customer_phone: cleanPhone,
        appointment_date: appointmentDate,
        start_time: startTime,
        end_time: endTime,
        status: "scheduled",
        notes: notes || null,
      })
      .select(`
        *,
        services (id, name, price, duration_minutes),
        professionals (id, name, role)
      `)
      .single();

    if (insertError) throw insertError;

    // Send instant WhatsApp Confirmation to Patient if user has active session
    try {
      const jid = `${cleanPhone}@s.whatsapp.net`;
      const dateFormatted = new Date(appointmentDate + "T00:00:00").toLocaleDateString("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric"
      });

      const confirmText = `Recebemos o teu pedido de marcação para ${dateFormatted}, às ${startTime}. Se precisares de alterar o horário, responde a esta mensagem para falar com a equipa.`;

      await whatsappManager.sendMessage(userId, jid, confirmText);
      console.log(`[Appointments] WhatsApp confirmation sent to ${jid}`);
    } catch (msgErr: any) {
      console.warn("[Appointments] Could not send WhatsApp confirmation (session may be disconnected):", msgErr.message);
    }

    res.json({
      success: true,
      message: "Agendamento realizado com sucesso!",
      data: appointment
    });
  } catch (err: any) {
    console.error("[Appointments] Error in /public/book:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 🔒 AUTHENTICATED ENDPOINTS (DASHBOARD)
// ==========================================

// Apply authentication middleware to all routes below
router.use(authenticate);

// ------------------------------------------
// 📅 APPOINTMENTS CRUD
// ------------------------------------------
router.get("/", async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const { startDate, endDate, professionalId, status } = req.query;

    let query = supabaseAdmin
      .from("appointments")
      .select(`
        *,
        services (id, name, price, duration_minutes),
        professionals (id, name, role, phone)
      `)
      .eq("user_id", userId)
      .order("appointment_date", { ascending: true })
      .order("start_time", { ascending: true });

    if (startDate) query = query.gte("appointment_date", startDate as string);
    if (endDate) query = query.lte("appointment_date", endDate as string);
    if (professionalId) query = query.eq("professional_id", professionalId as string);
    if (status) query = query.eq("status", status as string);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ success: true, data });
  } catch (err: any) {
    console.error("[Appointments] Error fetching appointments:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const {
      service_id,
      professional_id,
      contact_id,
      customer_name,
      customer_phone,
      appointment_date,
      start_time,
      end_time,
      status,
      notes
    } = req.body;

    if (!customer_name || !appointment_date || !start_time) {
      return res.status(400).json({ success: false, error: "Nome, data e horário são obrigatórios." });
    }

    // Calculate end time if not provided
    let calculatedEndTime = end_time;
    if (!calculatedEndTime) {
      let durationMinutes = 30;
      if (service_id) {
        const { data: s } = await supabaseAdmin.from("services").select("duration_minutes").eq("id", service_id).maybeSingle();
        if (s?.duration_minutes) durationMinutes = s.duration_minutes;
      }
      const [h, m] = start_time.split(":").map(Number);
      const total = h * 60 + m + durationMinutes;
      calculatedEndTime = `${Math.floor(total / 60).toString().padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
    }

    const { data, error } = await supabaseAdmin
      .from("appointments")
      .insert({
        user_id: userId,
        contact_id: contact_id || null,
        service_id: service_id || null,
        professional_id: professional_id || null,
        customer_name,
        customer_phone: customer_phone || null,
        appointment_date,
        start_time,
        end_time: calculatedEndTime,
        status: status || "scheduled",
        notes: notes || null
      })
      .select(`
        *,
        services (id, name, price, duration_minutes),
        professionals (id, name, role)
      `)
      .single();

    if (error) throw error;

    res.json({ success: true, data });
  } catch (err: any) {
    console.error("[Appointments] Error creating appointment:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/:id/reminder", async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const { data, error } = await supabaseAdmin.from("appointments")
      .select("appointment_date,start_time,customer_phone,status")
      .eq("id", req.params.id).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Marcação não encontrada." });
    const jid = scheduledContactJid({ phone: data.customer_phone });
    const timeZone = await getAppointmentTimeZone(userId);
    const instant = appointmentInstant(data, timeZone).getTime();
    if (!jid || !["scheduled", "confirmed"].includes(data.status) || !(instant > Date.now())) {
      return res.status(409).json({ error: "A marcação precisa de estar ativa, no futuro e ter um número WhatsApp válido." });
    }
    const sent = await whatsappManager.sendMessage(userId, jid, appointmentReminderMessage(data, timeZone));
    if (!sent?.key?.id) {
      return res.status(503).json({ error: "O WhatsApp não confirmou o envio. Consulta a conversa antes de tentar novamente." });
    }
    return res.json({ success: true });
  } catch (error) {
    const offline = error instanceof Error && error.message === "WhatsApp session not connected.";
    return res.status(503).json({ error: offline
      ? "Liga o WhatsApp antes de enviar o lembrete."
      : "Não foi possível confirmar o envio. Consulta a conversa antes de tentar novamente." });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const { id } = req.params;
    const updates = req.body;
    const { user_id: _account, ...fields } = updates;

    const { data, error } = await supabaseAdmin
      .from("appointments")
      .update(fields)
      .eq("id", id)
      .eq("user_id", userId)
      .select(`
        *,
        services (id, name, price, duration_minutes),
        professionals (id, name, role)
      `)
      .single();

    if (error) throw error;

    res.json({ success: true, data });
  } catch (err: any) {
    console.error("[Appointments] Error updating appointment:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from("appointments")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error) throw error;

    res.json({ success: true, message: "Agendamento excluído com sucesso." });
  } catch (err: any) {
    console.error("[Appointments] Error deleting appointment:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ------------------------------------------
// 🛠️ SERVICES CRUD
// ------------------------------------------
router.get("/services", async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const { data, error } = await supabaseAdmin
      .from("services")
      .select("*")
      .eq("user_id", userId)
      .order("name", { ascending: true });

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/services", async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const { id, name, description, duration_minutes, price, active } = req.body;

    if (!name) return res.status(400).json({ success: false, error: "Nome do serviço é obrigatório." });

    if (id) {
      const { data, error } = await supabaseAdmin
        .from("services")
        .update({
          name,
          description: description || null,
          duration_minutes: duration_minutes || 30,
          price: price || 0,
          active: active !== undefined ? active : true
        })
        .eq("id", id)
        .eq("user_id", userId)
        .select()
        .single();
      if (error) throw error;
      return res.json({ success: true, data });
    } else {
      const { data, error } = await supabaseAdmin
        .from("services")
        .insert({
          user_id: userId,
          name,
          description: description || null,
          duration_minutes: duration_minutes || 30,
          price: price || 0,
          active: active !== undefined ? active : true
        })
        .select()
        .single();
      if (error) throw error;
      return res.json({ success: true, data });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete("/services/:id", async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from("services")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error) throw error;
    res.json({ success: true, message: "Serviço removido com sucesso." });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ------------------------------------------
// 👨‍⚕️ PROFESSIONALS CRUD
// ------------------------------------------
router.get("/professionals", async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const { data, error } = await supabaseAdmin
      .from("professionals")
      .select("*")
      .eq("user_id", userId)
      .order("name", { ascending: true });

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/professionals", async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const {
      id,
      name,
      role,
      email,
      phone,
      working_days,
      start_time,
      end_time,
      break_start,
      break_end,
      active
    } = req.body;

    if (!name) return res.status(400).json({ success: false, error: "Nome do profissional é obrigatório." });

    const payload = {
      name,
      role: role || null,
      email: email || null,
      phone: phone || null,
      working_days: working_days || ["mon", "tue", "wed", "thu", "fri"],
      start_time: start_time || "08:00",
      end_time: end_time || "17:00",
      break_start: break_start || "12:00",
      break_end: break_end || "13:00",
      active: active !== undefined ? active : true
    };

    if (id) {
      const { data, error } = await supabaseAdmin
        .from("professionals")
        .update(payload)
        .eq("id", id)
        .eq("user_id", userId)
        .select()
        .single();
      if (error) throw error;
      return res.json({ success: true, data });
    } else {
      const { data, error } = await supabaseAdmin
        .from("professionals")
        .insert({ user_id: userId, ...payload })
        .select()
        .single();
      if (error) throw error;
      return res.json({ success: true, data });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete("/professionals/:id", async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from("professionals")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error) throw error;
    res.json({ success: true, message: "Profissional removido com sucesso." });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
