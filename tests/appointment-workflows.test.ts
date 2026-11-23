import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchAppointmentNotification } from "../backend/services/appointmentDelivery.ts";
import { appointmentInstant, appointmentReminderDue, appointmentReminderMessage, appointmentZone } from "../backend/services/appointmentReminders.ts";
import { getBookingLinkTool } from "../backend/tools/automations/getBookingLink.ts";

const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), sendMessage: vi.fn() }));
vi.mock("../backend/supabaseAdmin.ts", () => ({ supabaseAdmin: { from: mock.from, rpc: mock.rpc } }));
vi.mock("../backend/whatsappManager.ts", () => ({ whatsappManager: { sendMessage: mock.sendMessage } }));

const start = { appointment_date: "2026-12-01", start_time: "09:00:00" };
const zone = "Africa/Maputo";

describe("appointment workflows", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mock.from.mockReset();
    mock.rpc.mockReset();
    mock.sendMessage.mockReset();
  });

  it("uses business time for exact 24-hour and 2-hour reminders", () => {
    const appointment = appointmentInstant(start, zone);
    expect(appointment.toISOString()).toBe("2026-12-01T07:00:00.000Z");
    expect(appointmentReminderDue(start, zone, new Date("2026-11-30T06:59:00Z"))).toBeNull();
    expect(appointmentReminderDue(start, zone, new Date("2026-11-30T07:00:00Z"))).toBe("reminder_24h_sent");
    expect(appointmentReminderDue(start, zone, new Date("2026-12-01T05:00:00Z"))).toBe("reminder_2h_sent");
    expect(appointmentReminderDue({ ...start, reminder_2h_sent: true }, zone, new Date("2026-12-01T05:00:00Z"))).toBeNull();
    expect(appointmentReminderDue(start, zone, appointment)).toBeNull();
  });

  it("formats the outgoing reminder without patient or clinical details", () => {
    expect(appointmentReminderMessage(start, zone)).toContain("01/12/2026 às 09:00");
    expect(appointmentZone("not/a/zone")).toBe(zone);
    expect(appointmentInstant({ ...start, appointment_date: "2026-07-01" }, "Europe/Lisbon").toISOString())
      .toBe("2026-07-01T08:00:00.000Z");
  });

  it("uses the stored instant when a local time occurs twice", () => {
    const repeatedTime = { appointment_date: "2026-10-25", start_time: "01:30", start_at: "2026-10-25T00:30:00Z" };
    expect(appointmentInstant(repeatedTime, "Europe/Lisbon").toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(appointmentReminderMessage(repeatedTime, "Europe/Lisbon")).toContain("25/10/2026 às 01:30");
  });

  it("records an acknowledgement received after the caller deadline without sending again", async () => {
    vi.useFakeTimers();
    try {
      const promise = new Promise<{ key: { id: string } }>((resolve) => {
        setTimeout(() => resolve({ key: { id: "WA-ACK-LATE" } }), 13_000);
      });
      mock.sendMessage.mockReturnValue(promise);
      const claim = { id: "notification-1", status: "claimed", appointment: {
        ...start, time_zone: zone, start_at: "2026-12-01T07:00:00Z", customer_phone: "258840000123"
      } };
      mock.rpc.mockReturnValueOnce({ abortSignal: vi.fn().mockResolvedValue({ data: claim, error: null }) })
        .mockReturnValueOnce({ abortSignal: vi.fn().mockResolvedValue({ data: true, error: null }) });
      const delivery = dispatchAppointmentNotification("owner-1", "appointment-1", "revision-1", "confirmation");
      await vi.advanceTimersByTimeAsync(12_000);
      await expect(delivery).resolves.toEqual({ status: "uncertain" });
      expect(mock.rpc).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(mock.rpc).toHaveBeenLastCalledWith("agentx_finish_appointment_notification", {
        p_user: "owner-1", p_notification: "notification-1", p_status: "sent", p_message_id: "WA-ACK-LATE"
      });
      expect(mock.sendMessage).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shares the actual account booking link only when services are active", async () => {
    vi.stubEnv("PUBLIC_APP_URL", "https://agentx.example");
    const chain = {
      select: vi.fn(() => chain), eq: vi.fn(() => chain), order: vi.fn(() => chain), limit: vi.fn()
    };
    mock.from.mockReturnValue(chain);
    chain.limit.mockResolvedValueOnce({ data: [{ name: "Corte", duration_minutes: 30 }], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    const ctx = { userId: "account-a", phone: "", jid: "", role: "lead" as const, whatsappManager: {} };
    const available = await getBookingLinkTool.execute({ userId: "account-b" }, ctx);
    expect(available.success).toBe(true);
    expect(available.message).toContain("https://agentx.example/book/account-a");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "account-a");
    expect(chain.eq).toHaveBeenCalledWith("active", true);
    expect((await getBookingLinkTool.execute({}, ctx)).success).toBe(false);
    vi.unstubAllEnvs();
  });
});
