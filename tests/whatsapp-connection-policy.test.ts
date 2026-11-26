import { beforeEach, describe, expect, it, vi } from "vitest";

const { primary, secondary } = vi.hoisted(() => ({ primary: vi.fn(), secondary: vi.fn() }));
vi.mock("@whiskeysockets/baileys", () => ({
  DisconnectReason: { loggedOut: 401, forbidden: 403, multideviceMismatch: 411, connectionReplaced: 440, restartRequired: 515 },
  fetchLatestBaileysVersion: primary,
  fetchLatestWaWebVersion: secondary
}));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
});

describe("WhatsApp connection policy", () => {
  it("separates expired credentials from a replacement or a server restart", async () => {
    const { whatsappDisconnectAction } = await import("../backend/services/whatsappConnectionPolicy");
    expect(whatsappDisconnectAction(401)).toBe("logged_out");
    expect(whatsappDisconnectAction(440)).toBe("replaced");
    expect(whatsappDisconnectAction(401, "Stream conflict")).toBe("replaced");
    expect(whatsappDisconnectAction(515)).toBe("restart");
    expect(whatsappDisconnectAction(408)).toBe("retry");
    expect([403, 405, 411, 429].map((code) => whatsappDisconnectAction(code))).toEqual(Array(4).fill("review"));
  });

  it("shares one bounded lookup and uses the fresh response when the primary provides a fallback", async () => {
    const { whatsappWebVersion } = await import("../backend/services/whatsappConnectionPolicy");
    primary.mockResolvedValue({ version: [2, 3000, 1], isLatest: false });
    secondary.mockResolvedValue({ version: [2, 3000, 2], isLatest: true });
    const result = await Promise.all([whatsappWebVersion(), whatsappWebVersion()]);
    expect(result).toEqual([[2, 3000, 2], [2, 3000, 2]]);
    expect(await whatsappWebVersion()).toEqual([2, 3000, 2]);
    expect(primary).toHaveBeenCalledExactlyOnceWith({ signal: expect.any(AbortSignal) });
    expect(secondary).toHaveBeenCalledExactlyOnceWith({ signal: expect.any(AbortSignal) });
  });

  it("keeps the installed library default when neither source verifies a version", async () => {
    const { whatsappWebVersion } = await import("../backend/services/whatsappConnectionPolicy");
    primary.mockRejectedValue(new Error("Timed out"));
    secondary.mockResolvedValue({ version: [2, 3000, 1], isLatest: false });
    expect(await whatsappWebVersion()).toBeUndefined();
  });

  it("recovers from a primary lookup that ignores its abort signal and never settles", async () => {
    vi.useFakeTimers();
    try {
      const { whatsappWebVersion } = await import("../backend/services/whatsappConnectionPolicy");
      primary.mockReturnValue(new Promise(() => {}));
      secondary.mockResolvedValue({ version: [2, 3000, 3], isLatest: true });
      const lookup = whatsappWebVersion();
      await vi.advanceTimersByTimeAsync(2_500);
      expect(await lookup).toEqual([2, 3000, 3]);
      expect(primary.mock.calls[0][0].signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
