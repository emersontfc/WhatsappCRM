import { supabaseAdmin } from "../supabaseAdmin.ts";

const requirements = {
  crm: [["users", "id"], ["contacts", "id,user_id,phone,lid"], ["messages", "id,user_id,contact_id,msg_id"]],
  agent: [["agents", "id,user_id,provider,is_active"]],
  agenda: [["scheduled_messages", "id,user_id,target_type,group_jid,attempts,repeat_days,error"],
    ["scheduled_status", "id,user_id,caption,attempts,repeat_days,error"]],
  sales: [["products", "id,user_id,price,stock"], ["orders", "id,user_id,status,lead_id"],
    ["order_items", "id,order_id,product_id"], ["payment_verifications", "id,user_id,order_id"], ["leads", "id,user_id,stage"]],
  delivery: [["agentx_orders", "id,organization_id,status"], ["agentx_digital_deliveries", "organization_id,order_id"]],
  bookings: [["services", "id,user_id,active"], ["appointments", "id,user_id,appointment_date,reminder_24h_sent,reminder_2h_sent"]],
  groups: [["group_rules", "user_id,group_jid,active"], ["agentx_group_events", "id,user_id,group_jid,outcome"]]
} as const;

type Module = keyof typeof requirements;
export type PlatformState = "ready" | "migration_required" | "unverified" | "unavailable";

function isSchemaError(code?: string) {
  return ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");
}

export function makePlatformChecks(configured: boolean) {
  const cache = new Map<Module, { value: Promise<PlatformState>; until: number }>();

  async function checkModule(module: Module): Promise<PlatformState> {
    if (!configured) return "unavailable";
    try {
      const signal = AbortSignal.timeout(5_000);
      const results = await Promise.all(requirements[module].map(([table, columns]) =>
        supabaseAdmin.from(table).select(columns).limit(0).abortSignal(signal)));
      if (results.some(({ error }) => error && !isSchemaError(error.code))) return "unavailable";
      if (results.some(({ error }) => error)) return "migration_required";
      if (module !== "agenda") return "ready";

      const { data, error } = await supabaseAdmin.rpc("agentx_schedule_contract_ready").abortSignal(signal);
      if (error?.code === "PGRST202" || error?.code === "42883") return "unverified";
      if (error || typeof data !== "boolean") return "unavailable";
      return data ? "ready" : "migration_required";
    } catch {
      return "unavailable";
    }
  }

  function check(module: Module) {
    const now = Date.now();
    const entry = cache.get(module);
    if (entry && entry.until > now) return entry.value;
    const value = checkModule(module);
    cache.set(module, { value, until: now + 15_000 });
    return value;
  }

  return {
    check,
    async all() {
      const modules = Object.keys(requirements) as Module[];
      const entries = await Promise.all(modules.map(async (module) => [module, await check(module)] as const));
      return Object.fromEntries(entries) as Record<Module, PlatformState>;
    }
  };
}
