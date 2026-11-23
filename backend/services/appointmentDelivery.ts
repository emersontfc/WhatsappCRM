import { appointmentConfirmationMessage, appointmentInstant, appointmentReminderDue, appointmentReminderMessage, appointmentZone,
  getAppointmentTimeZone } from "./appointmentReminders.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { whatsappManager } from "../whatsappManager.ts";
import { normalizeContactPhone } from "../../shared/contactPhone.ts";

export type AppointmentNotificationKind = "confirmation" | "manual" | "reminder_24h" | "reminder_2h";
type NotificationStatus = "sending" | "sent" | "retry" | "uncertain" | "ineligible";
type Notification = {
  id?: string;
  status: NotificationStatus | "claimed";
  appointment?: { appointment_date: string; start_time: string; time_zone: string; start_at: string; customer_phone: string };
};
type DispatchResult = { status: NotificationStatus; alreadySent?: boolean };

export async function dispatchAppointmentNotification(
  userId: string, appointmentId: string, revision: string, kind: AppointmentNotificationKind
): Promise<DispatchResult> {
  const { data, error } = await supabaseAdmin.rpc("agentx_claim_appointment_notification", {
    p_user: userId, p_appointment: appointmentId, p_revision: revision, p_kind: kind
  }).abortSignal(AbortSignal.timeout(8_000));
  if (error) throw error;
  const claim = data as Notification | null;
  if (!claim) throw new Error("Appointment notification claim returned no result");
  if (claim.status !== "claimed") return { status: claim.status, alreadySent: claim.status === "sent" };
  if (!claim.id || !claim.appointment) throw new Error("Appointment notification claim is incomplete");

  // The gateway can acknowledge after the HTTP caller times out. Keep the claim and record the later result.
  const pending = sendClaimedNotification(userId, claim.id, kind, claim.appointment);
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<DispatchResult>((resolve) => {
    timer = setTimeout(() => resolve({ status: "uncertain" }), 12_000);
    timer.unref();
  });
  return Promise.race([pending, deadline]).finally(() => clearTimeout(timer));
}

async function sendClaimedNotification(userId: string, notificationId: string, kind: AppointmentNotificationKind,
  appointment: NonNullable<Notification["appointment"]>): Promise<DispatchResult> {
  let status: "sent" | "retry" | "uncertain" = "uncertain";
  let messageId: string | null = null;
  try {
    const phone = normalizeContactPhone(appointment.customer_phone);
    if (phone) {
      const makeMessage = kind === "confirmation" ? appointmentConfirmationMessage : appointmentReminderMessage;
      const result = await whatsappManager.sendMessage(userId, `${phone}@s.whatsapp.net`, makeMessage(appointment, appointment.time_zone));
      if (result?.key?.id) {
        messageId = result.key.id;
        status = "sent";
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "WhatsApp session not connected.") status = "retry";
  }

  const { data: recorded, error: recordError } = await supabaseAdmin.rpc("agentx_finish_appointment_notification", {
    p_user: userId, p_notification: notificationId, p_status: status, p_message_id: messageId
  }).abortSignal(AbortSignal.timeout(8_000));
  if (recordError || !recorded) {
    console.warn("[Appointments] Delivery result could not be recorded:", recordError?.code ?? "no_result");
    // A claim remains in place. Never send again after an unknown or unrecorded acknowledgement.
    return { status: "uncertain" };
  }
  return { status };
}

export function manualAppointmentKind(appointment: { appointment_date: string; start_time: string; start_at?: string | null }, zone: string, now: Date) {
  const remaining = appointmentInstant(appointment, zone).getTime() - now.getTime();
  return remaining <= 2 * 3_600_000 ? "reminder_2h" : remaining <= 24 * 3_600_000 ? "reminder_24h" : "manual";
}

export async function processAppointmentReminders(now: Date) {
  const nowISO = now.toISOString();
  const { data: retries, error: retryError } = await supabaseAdmin.from("agentx_appointment_notifications")
    .select("id,user_id,appointment_id,revision,kind").eq("status", "retry")
    .lte("available_at", nowISO).gt("expires_at", nowISO).order("available_at").limit(20)
    .abortSignal(AbortSignal.timeout(8_000));
  if (retryError) throw retryError;

  for (const item of retries ?? []) {
    try {
      const result = await dispatchAppointmentNotification(item.user_id, item.appointment_id, item.revision, item.kind);
      if (result.status === "ineligible") {
        // Discard a disconnected retry whose appointment was cancelled or rescheduled.
        await supabaseAdmin.from("agentx_appointment_notifications").update({ expires_at: nowISO })
          .eq("id", item.id).eq("user_id", item.user_id).eq("status", "retry").abortSignal(AbortSignal.timeout(8_000));
      }
    } catch (error) {
      console.warn("[Appointments] Could not resume notification:", (error as { code?: string })?.code ?? "unavailable");
    }
  }

  // These extra UTC dates cover business zones on both sides of the date line.
  const firstDate = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const lastDate = new Date(now.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
  const zones = new Map<string, Promise<string>>();
  let after: string | undefined;
  for (;;) {
    let selection = supabaseAdmin.from("appointments")
      .select("id,user_id,customer_phone,appointment_date,start_time,start_at,time_zone,schedule_revision,reminder_24h_sent,reminder_2h_sent")
      .gte("appointment_date", firstDate).lte("appointment_date", lastDate)
      .in("status", ["scheduled", "confirmed"]).not("customer_phone", "is", null).order("id").limit(100);
    if (after) selection = selection.gt("id", after);
    const { data: appointments, error } = await selection.abortSignal(AbortSignal.timeout(8_000));
    if (error) throw error;
    for (const appointment of appointments ?? []) {
      try {
        let zone = appointment.time_zone ? appointmentZone(appointment.time_zone) : undefined;
        if (!zone) {
          if (!zones.has(appointment.user_id)) zones.set(appointment.user_id, getAppointmentTimeZone(appointment.user_id));
          zone = await zones.get(appointment.user_id)!;
        }
        const field = appointmentReminderDue(appointment, zone, now);
        if (field) await dispatchAppointmentNotification(appointment.user_id, appointment.id, appointment.schedule_revision,
          field === "reminder_2h_sent" ? "reminder_2h" : "reminder_24h");
      } catch (error) {
        console.warn("[Appointments] Could not process reminder:", (error as { code?: string })?.code ?? "unavailable");
      }
    }
    if (!appointments || appointments.length < 100) break;
    after = appointments[appointments.length - 1].id;
  }
}
