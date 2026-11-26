import { createHash, createHmac } from "node:crypto";
import { supabaseAdmin } from "../supabaseAdmin.ts";

export const appointmentManageTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function appointmentManageToken(userId: string, requestId: string, phone: string) {
  const secret = (process.env.APPOINTMENT_MANAGEMENT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
  if (!secret) throw new Error("Private booking links require a server secret");
  return createHmac("sha256", secret).update(JSON.stringify([
    "agentx:appointment-manage:v1", userId.toLowerCase(), requestId.toLowerCase(), phone,
  ])).digest("base64url");
}

export function appointmentManageHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function appointmentManagePath(userId: string, token: string) {
  return `/book/${encodeURIComponent(userId.toLowerCase())}#manage=${token}`;
}

function bookingOrigin() {
  try {
    const app = new URL(process.env.PUBLIC_APP_URL || process.env.VITE_API_URL || "");
    if (app.username || app.password || (app.protocol !== "https:" &&
      !(app.protocol === "http:" && process.env.NODE_ENV !== "production"))) return null;
    return app.origin;
  } catch {
    return null;
  }
}

export function appointmentManageUrl(path: string) {
  const origin = bookingOrigin();
  return origin ? new URL(path, origin).href : null;
}

export async function appointmentNotificationManageUrl(userId: string, appointmentId: string, revision: string, phone: string) {
  const origin = bookingOrigin();
  if (!origin) return null;
  try {
    const { data, error } = await supabaseAdmin.from("agentx_appointment_manage_links")
      .select("token_hash,appointments!inner(request_id)").eq("appointment_id", appointmentId).eq("user_id", userId)
      .eq("appointments.user_id", userId).eq("appointments.schedule_revision", revision)
      .abortSignal(AbortSignal.timeout(3_000)).maybeSingle();
    if (error) throw error;
    const appointment = Array.isArray(data?.appointments) ? data.appointments[0] : data?.appointments;
    const requestId = appointment?.request_id;
    if (!requestId || !data) return null;
    const token = appointmentManageToken(userId, requestId, phone);
    if (appointmentManageHash(token) !== data.token_hash) return null;
    return new URL(appointmentManagePath(userId, token), origin).href;
  } catch (error) {
    console.warn("[Appointments] No private link could be verified for this notice", { code: (error as { code?: string })?.code });
    return null;
  }
}
