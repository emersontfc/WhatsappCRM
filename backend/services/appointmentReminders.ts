import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { supabaseAdmin } from "../supabaseAdmin.ts";

export const defaultAppointmentZone = "Africa/Maputo";
const hour = 60 * 60 * 1000;

export function appointmentZone(value?: string | null) {
  if (value) {
    try {
      new Intl.DateTimeFormat("pt-MZ", { timeZone: value }).format();
      return value;
    } catch { /* Existing profiles can contain a legacy time zone. */ }
  }
  return defaultAppointmentZone;
}

type AppointmentTime = { appointment_date: string; start_time: string; start_at?: string | null };

export function appointmentInstant(appointment: AppointmentTime, timeZone: string): Date {
  return appointment.start_at ? new Date(appointment.start_at)
    : fromZonedTime(`${appointment.appointment_date}T${appointment.start_time}`, timeZone);
}

export function appointmentReminderDue(
  appointment: AppointmentTime & { reminder_24h_sent?: boolean | null; reminder_2h_sent?: boolean | null },
  timeZone: string, now: Date
) {
  const remaining = appointmentInstant(appointment, timeZone).getTime() - now.getTime();
  if (remaining > 0 && remaining <= 2 * hour && !appointment.reminder_2h_sent) return "reminder_2h_sent";
  if (remaining > 2 * hour && remaining <= 24 * hour && !appointment.reminder_24h_sent) return "reminder_24h_sent";
  return null;
}

export function appointmentReminderMessage(appointment: AppointmentTime, timeZone: string) {
  const date = formatInTimeZone(appointmentInstant(appointment, timeZone), timeZone, "dd/MM/yyyy 'às' HH:mm");
  return `Lembrete: tens uma marcação para ${date}. Se precisares de alterar o horário, responde a esta mensagem para falar com a equipa.`;
}

export function appointmentConfirmationMessage(appointment: AppointmentTime, timeZone: string) {
  const date = formatInTimeZone(appointmentInstant(appointment, timeZone), timeZone, "dd/MM/yyyy 'às' HH:mm");
  return `A tua marcação ficou registada para ${date}. Para alterar o horário, responde a esta mensagem.`;
}

export async function getAppointmentTimeZone(userId: string) {
  const { data, error } = await supabaseAdmin.from("company_profile").select("timezone").eq("user_id", userId)
    .abortSignal(AbortSignal.timeout(8_000)).maybeSingle();
  if (error && !["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code)) throw error;
  return appointmentZone(data?.timezone);
}
