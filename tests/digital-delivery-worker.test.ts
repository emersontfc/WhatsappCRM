import { beforeEach, describe, expect, it, vi } from "vitest";
import { startDigitalDeliveryWorker } from "../backend/services/digitalDeliveryWorker.ts";

const { rpc, abortSignal } = vi.hoisted(() => ({ rpc: vi.fn(), abortSignal: vi.fn() }));
vi.mock("../backend/supabaseAdmin.ts", () => ({ supabaseAdmin: { rpc } }));

beforeEach(() => {
  vi.resetAllMocks();
  rpc.mockReturnValue({ abortSignal });
});

describe("automatic digital delivery processor", () => {
  it("runs without a separate process and stops on server shutdown", async () => {
    const controller = new AbortController();
    abortSignal.mockResolvedValue({ data: 0, error: null });
    const worker = startDigitalDeliveryWorker(controller.signal);
    try {
      await vi.waitFor(() => expect(worker.status()).toMatchObject({ state: "running", lastSuccessAt: expect.any(String) }));
      expect(rpc).toHaveBeenCalledExactlyOnceWith("agentx_process_digital_deliveries");
    } finally {
      controller.abort();
      await worker.completion;
    }
  });

  it("reports failure while the database refuses the delivery RPC", async () => {
    const controller = new AbortController();
    abortSignal.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    const worker = startDigitalDeliveryWorker(controller.signal);
    try {
      await vi.waitFor(() => expect(worker.status()).toEqual({ state: "unavailable", lastSuccessAt: null }));
    } finally {
      controller.abort();
      await worker.completion;
    }
  });
});
