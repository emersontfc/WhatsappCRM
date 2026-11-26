import { afterEach, describe, expect, it, vi } from "vitest";
import { appointmentManageHash, appointmentManagePath, appointmentManageToken, appointmentManageTokenPattern,
  appointmentManageUrl } from "../backend/services/appointmentManagement.ts";

const business = "e1000000-0000-4000-8000-000000000001";
const request = "e1000000-0000-4000-8000-000000000010";
const phone = "258841234567";

afterEach(() => vi.unstubAllEnvs());

describe("private booking capabilities", () => {
  it("uses a disjoint, deterministic capability for each booking, account, recipient and key", () => {
    vi.stubEnv("APPOINTMENT_MANAGEMENT_SECRET", "owner-only-fixture-secret");
    const token = appointmentManageToken(business, request, phone);
    expect(token).toMatch(appointmentManageTokenPattern);
    expect(appointmentManageToken(business.toUpperCase(), request.toUpperCase(), phone)).toBe(token);
    expect(appointmentManageHash(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(appointmentManageToken(business, request, phone + "1")).not.toBe(token);
    expect(appointmentManageToken(business, request.replace("010", "011"), phone)).not.toBe(token);
    expect(appointmentManageToken(business.replace("001", "002"), request, phone)).not.toBe(token);
    vi.stubEnv("APPOINTMENT_MANAGEMENT_SECRET", "different-owner-only-fixture-secret");
    expect(appointmentManageToken(business, request, phone)).not.toBe(token);
  });

  it("keeps credentials in the browser fragment and only uses a trusted HTTPS origin in production", () => {
    vi.stubEnv("APPOINTMENT_MANAGEMENT_SECRET", "owner-only-fixture-secret");
    vi.stubEnv("NODE_ENV", "production");
    const token = appointmentManageToken(business, request, phone);
    const path = appointmentManagePath(business, token);

    vi.stubEnv("PUBLIC_APP_URL", "https://booking.example.invalid/api?old=1");
    const safe = new URL(appointmentManageUrl(path)!);
    expect(safe.origin).toBe("https://booking.example.invalid");
    expect(safe.pathname).toBe(`/book/${business}`);
    expect(safe.search).toBe("");
    expect(safe.hash).toBe(`#manage=${token}`);

    for (const url of ["http://booking.example.invalid", "https://wrong:password@booking.example.invalid", "javascript:alert(1)"]) {
      vi.stubEnv("PUBLIC_APP_URL", url);
      expect(appointmentManageUrl(path)).toBeNull();
    }
  });
});
