import { appointmentReminderDue, appointmentReminderMessage, getAppointmentTimeZone } from "./services/appointmentReminders.ts";
import { dispatchScheduled, scheduledContactJid } from "./services/scheduledDispatch.ts";
import { supabaseAdmin } from "./supabaseAdmin.ts";
import { whatsappManager } from "./whatsappManager.ts";

export function startScheduler() {
  console.log("Message scheduler started.");
  
  let isRunning = false;

  const isSchemaError = (err: any) => 
    err?.code === "42P01" || 
    err?.code === "PGRST204" || 
    err?.code === "PGRST205" || 
    err?.message?.includes("does not exist") || 
    err?.message?.includes("schema cache");

  async function dispatchDue(table: "scheduled_messages" | "scheduled_status", now: string) {
    const { data, error } = await supabaseAdmin.from(table).select("id,user_id")
      .eq("status", "pending").lte("scheduled_at", now).order("scheduled_at").limit(10)
      .abortSignal(AbortSignal.timeout(8_000));
    if (error && !isSchemaError(error)) console.error(`[Scheduler] Unable to read ${table}:`, error);
    for (const item of data ?? []) {
      await dispatchScheduled(table, item.id, item.user_id, now)
        .catch((failure) => console.error(`[Scheduler] ${table} dispatch failed:`, failure));
    }
  }

  const timer = setInterval(async () => {
    if (isRunning) {
      console.log("Scheduler is already running, skipping this tick.");
      return;
    }
    
    isRunning = true;
    try {
      const now = new Date();
      const nowISO = now.toISOString();
      await dispatchDue("scheduled_messages", nowISO);
      await dispatchDue("scheduled_status", nowISO);

      // 3. Process Reminders
      const { data: pendingReminders, error: reminderError } = await supabaseAdmin
        .from("reminders")
        .select("*")
        .eq("sent", false)
        .lte("scheduled_at", nowISO)
        .order("scheduled_at").limit(10).abortSignal(AbortSignal.timeout(8_000));

      if (reminderError && !isSchemaError(reminderError)) {
        console.error("[Scheduler] Error fetching reminders:", reminderError);
      }

      if (pendingReminders && pendingReminders.length > 0) {
        console.log(`[Scheduler] Found ${pendingReminders.length} pending reminders.`);
        for (const reminder of pendingReminders) {
          try {
            const jid = reminder.phone.includes("@") ? reminder.phone : `${reminder.phone}@s.whatsapp.net`;
            const result = await whatsappManager.sendMessage(reminder.user_id, jid, `🔔 LEMBRETE: ${reminder.message}`);
            if (!result?.key?.id) throw new Error("WhatsApp did not acknowledge the reminder");
            const { error } = await supabaseAdmin.from("reminders").update({ sent: true })
              .eq("id", reminder.id).eq("user_id", reminder.user_id).abortSignal(AbortSignal.timeout(8_000));
            if (error) throw error;
            console.log(`[Scheduler] Reminder ${reminder.id} sent successfully.`);
          } catch (err: any) {
            console.error(`[Scheduler] Failed to send reminder ${reminder.id}:`, err.message);
          }
        }
      }

      // Appointments use the business time zone, irrespective of the container clock.
      try {
        const firstDate = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
        const lastDate = new Date(now.getTime() + 2 * 86400000).toISOString().slice(0, 10);
        const zones = new Map<string, Promise<string>>();
        for (let offset = 0; ; offset += 100) {
          const { data: appointments, error } = await supabaseAdmin.from("appointments")
            .select("id,user_id,customer_phone,appointment_date,start_time,reminder_24h_sent,reminder_2h_sent")
            .gte("appointment_date", firstDate).lte("appointment_date", lastDate)
            .in("status", ["scheduled", "confirmed"]).not("customer_phone", "is", null)
            .order("id").range(offset, offset + 99).abortSignal(AbortSignal.timeout(8_000));
          if (error) throw error;
          for (const appointment of appointments) {
            const jid = scheduledContactJid({ phone: appointment.customer_phone });
            if (!jid) continue;
            try {
              if (!zones.has(appointment.user_id)) zones.set(appointment.user_id, getAppointmentTimeZone(appointment.user_id));
              const timeZone = await zones.get(appointment.user_id)!;
              const field = appointmentReminderDue(appointment, timeZone, now);
              if (!field) continue;
              const { data: current, error: readError } = await supabaseAdmin.from("appointments")
                .select("id").eq("id", appointment.id).eq("user_id", appointment.user_id)
                .eq("appointment_date", appointment.appointment_date).eq("start_time", appointment.start_time)
                .eq("customer_phone", appointment.customer_phone)
                .in("status", ["scheduled", "confirmed"]).or(`${field}.eq.false,${field}.is.null`)
                .abortSignal(AbortSignal.timeout(8_000)).maybeSingle();
              if (readError || !current) continue;
              const result = await whatsappManager.sendMessage(appointment.user_id, jid, appointmentReminderMessage(appointment, timeZone));
              if (!result?.key?.id) throw new Error("WhatsApp did not acknowledge the reminder");
              const { error: updateError } = await supabaseAdmin.from("appointments").update({ [field]: true })
                .eq("id", appointment.id).eq("user_id", appointment.user_id)
                .eq("appointment_date", appointment.appointment_date).eq("start_time", appointment.start_time)
                .eq("customer_phone", appointment.customer_phone).abortSignal(AbortSignal.timeout(8_000));
              if (updateError) throw updateError;
            } catch (error) {
              console.warn("[Scheduler] Appointment reminder not confirmed:", appointment.id, error);
            }
          }
          if (appointments.length < 100) break;
        }
      } catch (error) {
        if (!isSchemaError(error)) console.error("[Scheduler] Appointment reminder query failed:", error);
      }

    } catch (err: any) {
      const text = `${err?.message || ""} ${err?.cause || ""}`;
      const transientNet =
        text.includes("fetch failed") ||
        text.includes("ENOTFOUND") ||
        text.includes("EAI_AGAIN") ||
        text.includes("getaddrinfo");
      
      // Ignore "relation does not exist" or PostgREST schema cache errors if the user hasn't created the table yet
      if (isSchemaError(err)) {
        // Silently ignore to avoid spamming the console before the user runs the SQL script
      } else if (transientNet) {
        if (!(globalThis as any).__schedulerNetWarned) {
          (globalThis as any).__schedulerNetWarned = true;
          console.warn(
            "[Scheduler] Supabase unreachable (DNS/rede). Agendamentos pausam até resolver. Em produção com rede OK isto não aparece. Local: teste `nslookup <project>.supabase.co` ou mude DNS (ex. 1.1.1.1)."
          );
        }
      } else {
        console.error("Scheduler error:", err?.message || err);
      }
    } finally {
      isRunning = false;
    }
  }, 60000); // Check every minute
  return { stop: () => clearInterval(timer) };
}
