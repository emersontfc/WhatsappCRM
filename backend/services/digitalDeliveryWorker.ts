import { setTimeout as delay } from "node:timers/promises";
import { supabaseAdmin } from "../supabaseAdmin.ts";

export type DeliveryWorkerState = "disabled" | "starting" | "running" | "unavailable";

export function startDigitalDeliveryWorker(signal: AbortSignal) {
  let state: DeliveryWorkerState = "starting";
  let lastSuccessAt: string | null = null;

  const completion = (async () => {
    let waitMs = 5_000;
    while (!signal.aborted) {
      try {
        const { data, error } = await supabaseAdmin.rpc("agentx_process_digital_deliveries")
          .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
        if (error) throw error;
        if (typeof data !== "number") throw new Error("Invalid delivery worker response");
        if (data > 0) console.info("[Digital delivery] Fulfilled orders", data);
        lastSuccessAt = new Date().toISOString();
        state = "running";
        waitMs = data === 50 ? 100 : 5_000;
      } catch (error) {
        if (signal.aborted) break;
        if (state !== "unavailable") console.error("[Digital delivery] Outbox processing failed", error);
        state = "unavailable";
        waitMs = Math.min(Math.max(waitMs * 2, 5_000), 60_000);
      }
      try {
        await delay(waitMs, undefined, { signal });
      } catch (error) {
        if (!signal.aborted) throw error;
      }
    }
  })();

  return { completion, status: () => ({ state, lastSuccessAt }) };
}
