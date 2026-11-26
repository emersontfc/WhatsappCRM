import { afterEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../backend/supabaseAdmin.ts", () => ({ supabaseAdmin: { rpc } }));

import { dispatchSellerNotice, processSellerNotices, retrySellerNotice } from "../backend/services/sellerNotices.ts";

const claim = {
  id: "notice-a",
  user_id: "account-a",
  order_id: "order-a",
  kind: "proof_review" as const,
  recipient: "258841000000",
  order_number: "AGX-NOTICE",
  rejected_reason: null,
  claim_token: "claim-a",
};
const transport = (response: Promise<{ key?: { id?: string } } | null>, status = "connected") => ({
  getSessionStatus: vi.fn(() => status),
  sendMessage: vi.fn(() => response),
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("seller notices", () => {
  it("records only a bounded, non-empty WhatsApp acknowledgement", async () => {
    const driver = transport(Promise.resolve({ key: { id: " w-a " } }));
    await expect(dispatchSellerNotice(driver, claim)).resolves.toEqual({ status: "sent", receipt: "w-a" });
    expect(driver.sendMessage).toHaveBeenCalledWith("account-a", "258841000000@s.whatsapp.net",
      expect.stringContaining("AGX-NOTICE"));
    await expect(dispatchSellerNotice(transport(Promise.resolve({ key: { id: "" } })), claim))
      .resolves.toEqual({ status: "uncertain", reason: "no_receipt" });
  });

  it("returns retry only for an explicit pre-send disconnect", async () => {
    const offline = transport(Promise.resolve(null), "disconnected");
    await expect(dispatchSellerNotice(offline, claim)).resolves.toEqual({ status: "retry", reason: "whatsapp_offline" });
    expect(offline.sendMessage).not.toHaveBeenCalled();

    await expect(dispatchSellerNotice(transport(Promise.reject(new Error("WhatsApp session not connected."))), claim))
      .resolves.toEqual({ status: "retry", reason: "whatsapp_offline" });
    await expect(dispatchSellerNotice(transport(Promise.reject(new Error("Resposta interrompida"))), claim))
      .resolves.toEqual({ status: "uncertain", reason: "transport_unknown" });
  });

  it("stops waiting for transport without categorizing a timeout as safe to retry", async () => {
    vi.useFakeTimers();
    const driver = transport(new Promise(() => {}));
    const result = dispatchSellerNotice(driver, claim, 50);
    await vi.advanceTimersByTimeAsync(50);
    await expect(result).resolves.toEqual({ status: "uncertain", reason: "ack_timeout" });
    expect(driver.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch when a valid current recipient is missing", async () => {
    const driver = transport(Promise.resolve(null));
    await expect(dispatchSellerNotice(driver, { ...claim, recipient: null }))
      .resolves.toEqual({ status: "failed", reason: "missing_recipient" });
    expect(driver.sendMessage).not.toHaveBeenCalled();
  });

  it("scopes claims and authoritative retry to the server RPC", async () => {
    const now = new Date("2026-11-27T12:00:00Z");
    rpc.mockReturnValueOnce({ abortSignal: async () => ({ data: [claim], error: null }) })
      .mockReturnValueOnce({ abortSignal: async () => ({ data: true, error: null }) })
      .mockReturnValueOnce({ abortSignal: async () => ({ data: false, error: null }) });

    await processSellerNotices(transport(Promise.resolve({ key: { id: "operator-ack" } })), now,
      { userId: "account-a", noticeId: "notice-a" });
    expect(rpc).toHaveBeenNthCalledWith(1, "agentx_claim_seller_notices", {
      p_now: now.toISOString(), p_user: "account-a", p_notice: "notice-a",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "agentx_finish_seller_notice", {
      p_user: "account-a", p_notice: "notice-a", p_claim: "claim-a",
      p_outcome: "sent", p_reason: null, p_receipt: "operator-ack", p_now: expect.any(String),
    });
    await expect(retrySellerNotice("actor-a", "org-a", "notice-a")).resolves.toBe(false);
    expect(rpc).toHaveBeenNthCalledWith(3, "agentx_retry_seller_notice", {
      p_actor: "actor-a", p_org: "org-a", p_notice: "notice-a",
    });
  });
});
