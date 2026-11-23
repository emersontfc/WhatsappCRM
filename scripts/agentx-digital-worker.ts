import { startDigitalDeliveryWorker } from "../backend/services/digitalDeliveryWorker.ts";
import { supabaseAdminConfigured } from "../backend/supabaseAdmin.ts";

if (!supabaseAdminConfigured) throw new Error("Supabase URL and service role key are required.");

const shutdown = new AbortController();
process.once("SIGINT", () => shutdown.abort());
process.once("SIGTERM", () => shutdown.abort());
await startDigitalDeliveryWorker(shutdown.signal).completion;
