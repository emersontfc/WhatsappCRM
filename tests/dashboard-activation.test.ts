import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/lib/api";
import { loadActivation } from "../src/lib/useActivation";

const { fetchSubscription, currentUser } = vi.hoisted(() => ({ fetchSubscription: vi.fn(), currentUser: vi.fn() }));

vi.mock("../src/supabase", () => ({ getUser: currentUser, getSession: vi.fn() }));
vi.mock("../src/lib/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/lib/api")>(),
  apiFetch: fetchSubscription
}));

beforeEach(() => vi.resetAllMocks());

describe("dashboard activation", () => {
  it.each(["Free", "Pro", "Admin"])("uses the authenticated subscription for the %s plan", async (plan) => {
    const planDetails = { max_contacts: 500, ai_enabled: true };
    fetchSubscription.mockResolvedValue({ success: true, data: { id: "merchant-a", plan, planDetails } });
    const { signal } = new AbortController();
    await expect(loadActivation("merchant-a", signal)).resolves.toEqual({ isActivated: true, plan, planDetails, error: null });
    expect(fetchSubscription).toHaveBeenCalledExactlyOnceWith("/api/ai/subscription", { accountId: "merchant-a", signal, timeout: 8_000 });
    expect(currentUser).not.toHaveBeenCalled();
  });

  it("keeps other accounts and expired sessions from activating the dashboard", async () => {
    const signal = new AbortController().signal;
    fetchSubscription.mockResolvedValueOnce({ success: true, data: { id: "merchant-b", plan: "Admin" } });
    await expect(loadActivation("merchant-a", signal)).resolves.toMatchObject({ isActivated: false, plan: null, planDetails: null });
    fetchSubscription.mockRejectedValueOnce(new ApiError("Unauthorized", 401));
    await expect(loadActivation("merchant-a", signal)).resolves.toMatchObject({ isActivated: false, plan: null, error: expect.stringMatching(/sessão/) });
    expect(currentUser).not.toHaveBeenCalled();
  });

  it("offers Free limits on a temporary failure only to an authenticated user", async () => {
    const signal = new AbortController().signal;
    fetchSubscription.mockRejectedValue(new ApiError("Timeout"));
    await expect(loadActivation("merchant-a", signal)).resolves.toMatchObject({ isActivated: true, plan: "Free", error: expect.any(String) });
    currentUser.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "merchant-a" });
    await expect(loadActivation(undefined, signal)).resolves.toMatchObject({ isActivated: false, plan: null });
    await expect(loadActivation(undefined, signal)).resolves.toMatchObject({ isActivated: true, plan: "Free" });
  });
});
