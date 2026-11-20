import { setTimeout as delay } from "node:timers/promises";
import { supabaseAdmin } from "../backend/supabaseAdmin.ts";

const shutdown = new AbortController();
process.once("SIGINT", () => shutdown.abort());
process.once("SIGTERM", () => shutdown.abort());

if (!(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)?.trim() ||
    !(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY)?.trim()) {
  throw new Error("Supabase URL and service role key are required");
}

let waitMs = 5_000;
while (!shutdown.signal.aborted) {
  try {
    const { data, error } = await supabaseAdmin.rpc("agentx_process_digital_deliveries").abortSignal(AbortSignal.any([shutdown.signal, AbortSignal.timeout(15_000)]));
    if (error) throw error;
    if (data > 0) console.info("[Digital delivery] Fulfilled orders", data);
    waitMs = data === 50 ? 100 : 5_000;
  } catch (error) {
    if (shutdown.signal.aborted) break;
    console.error("[Digital delivery] Outbox processing failed", error);
    waitMs = Math.min(Math.max(waitMs * 2, 5_000), 60_000);
  }
  try {
    await delay(waitMs, undefined, { signal: shutdown.signal });
  } catch (error) {
    if (!shutdown.signal.aborted) throw error;
  }
}
