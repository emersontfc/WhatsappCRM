import { beforeEach, describe, expect, it, vi } from "vitest";
import { appointmentInstant, appointmentReminderDue, appointmentReminderMessage, appointmentZone } from "../backend/services/appointmentReminders.ts";
import { getBookingLinkTool } from "../backend/tools/automations/getBookingLink.ts";

const mock = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../backend/supabaseAdmin.ts", () => ({ supabaseAdmin: { from: mock.from } }));

const start = { appointment_date: "2026-12-01", start_time: "09:00:00" };
const zone = "Africa/Maputo";

describe("appointment workflows", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mock.from.mockReset();
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
