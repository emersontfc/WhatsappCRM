import { processAppointmentReminders } from "./services/appointmentDelivery.ts";
import { dispatchScheduled } from "./services/scheduledDispatch.ts";
import { processGroupAccessSchedules } from "./services/groupAccessSchedule.ts";
import { supabaseAdmin } from "./supabaseAdmin.ts";
import { whatsappManager } from "./whatsappManager.ts";

export function startScheduler() {
  console.log("Message scheduler started.");
  
  let isRunning = false;

  const isSchemaError = (err: any) => 
    err?.code === "42P01" || 
    err?.code === "PGRST202" ||
    err?.code === "PGRST204" || 
    err?.code === "PGRST205" || 
    err?.message?.includes("does not exist") || 
    err?.message?.includes("schema cache");

  let appointmentsRunning = false;
  const processAppointments = async () => {
    if (appointmentsRunning) return;
    appointmentsRunning = true;
    try {
      await processAppointmentReminders(new Date());
    } catch (error) {
      if (!isSchemaError(error)) console.warn("[Scheduler] Appointment reminders unavailable:", (error as { code?: string })?.code);
    } finally {
      appointmentsRunning = false;
    }
  };
  const appointmentTimer = setInterval(processAppointments, 60_000);
  void processAppointments();

  let groupAccessRunning = false;
  const processGroupAccess = async () => {
    if (groupAccessRunning) return;
    groupAccessRunning = true;
    try {
      await processGroupAccessSchedules();
    } catch (error) {
      if (!isSchemaError(error)) console.warn("[Scheduler] Group opening hours unavailable:", (error as { code?: string })?.code);
    } finally {
      groupAccessRunning = false;
    }
  };
  const groupAccessTimer = setInterval(processGroupAccess, 60_000);
  void processGroupAccess();

  async function dispatchDue(table: "scheduled_messages" | "scheduled_status", now: string) {
    const { data, error } = await supabaseAdmin.from(table).select("id,user_id")
      .eq("status", "pending").lte("scheduled_at", now).or(`retry_at.is.null,retry_at.lte.${now}`)
      .order("scheduled_at").limit(10)
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
      const { error: expiryError } = await supabaseAdmin.rpc("agentx_expire_agenda_claims").abortSignal(AbortSignal.timeout(8_000));
      if (expiryError && !isSchemaError(expiryError)) console.warn("[Scheduler] Unable to expire interrupted Agenda sends.", expiryError.code);
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
  return { stop: () => {
    clearInterval(timer);
    clearInterval(appointmentTimer);
    clearInterval(groupAccessTimer);
  } };
}
