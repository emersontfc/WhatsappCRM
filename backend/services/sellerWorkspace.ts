import { readContactPhone } from "../../shared/contactPhone.ts";
import { isSellerMethod, sellerMethodKeys, type PaymentDestination, type PaymentDestinations, type SellerMethod,
  type SellerOverview, type SellerSettings } from "../../shared/seller.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";

const settingsFields = "payment_method,payment_recipient,recipient_name,payment_destinations,notification_phone";

export async function sellerSettings(userId: string): Promise<SellerSettings | null> {
  const { data, error } = await supabaseAdmin.from("agentx_seller_settings")
    .select(settingsFields).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data as SellerSettings | null;
}

export function parseSellerSettings(body: Record<string, unknown> | undefined): SellerSettings | null {
  const preferred = body?.payment_method;
  if (preferred != null && preferred !== "" && !isSellerMethod(preferred)) return null;
  const rawNotification = typeof body?.notification_phone === "string" ? body.notification_phone.trim() : "";
  const notification = readContactPhone(rawNotification);
  if (rawNotification && !notification) return null;

  const destinations: PaymentDestinations = {};
  const supplied = body?.payment_destinations;
  if (supplied !== undefined) {
    if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) return null;
    for (const [method, input] of Object.entries(supplied)) {
      if (!isSellerMethod(method) || !input || typeof input !== "object") return null;
      const fields = input as Partial<PaymentDestination>;
      const destination = paymentDestination(method, fields.recipient, fields.name);
      if (!destination) return null;
      destinations[method] = destination;
    }
  } else if (isSellerMethod(preferred)) {
    const legacy = paymentDestination(preferred, body?.payment_recipient, body?.recipient_name);
    if (!legacy) return null;
    destinations[preferred] = legacy;
  }
  const method = isSellerMethod(preferred) ? preferred : sellerMethodKeys.find((key) => destinations[key]);
  const destination = method && destinations[method];
  if (!method || !destination) return null;
  return { payment_method: method, payment_recipient: destination.recipient, recipient_name: destination.name,
    payment_destinations: destinations, notification_phone: notification };
}

function paymentDestination(method: SellerMethod, recipient: unknown, name: unknown): PaymentDestination | null {
  const raw = typeof recipient === "string" ? recipient.trim() : "";
  const account = method === "bank_transfer" ? raw.toUpperCase() : readContactPhone(raw);
  const holder = typeof name === "string" ? name.trim() : "";
  if (!account || !/^[A-Z0-9][A-Z0-9 -]{4,59}$/.test(account) ||
      holder.length < 2 || holder.length > 100 || /[\p{Cc}\p{Cf}]/u.test(holder)) return null;
  return { recipient: account, name: holder };
}

export async function saveSellerSettings(userId: string, settings: SellerSettings, replaceDestinations: boolean): Promise<SellerSettings> {
  const { payment_destinations, ...legacy } = settings;
  const { data, error } = await supabaseAdmin.from("agentx_seller_settings")
    .upsert({ ...legacy, ...(replaceDestinations ? { payment_destinations } : {}),
      user_id: userId, updated_at: new Date().toISOString() })
    .select(settingsFields).single();
  if (error) throw error;
  return data as SellerSettings;
}

export async function sellerOverview(userId: string, whatsappConnected: boolean): Promise<SellerOverview> {
  const [settings, agent, products, reviews, deliveries, orders] = await Promise.all([
    sellerSettings(userId),
    supabaseAdmin.from("agents").select("is_active,specialization").eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from("products").select("id,price,stock,type,deliverable_path,digital_content")
      .eq("user_id", userId).eq("is_active", true),
    supabaseAdmin.from("orders").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("status", "verification_pending"),
    supabaseAdmin.from("orders").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("status", "paid"),
    supabaseAdmin.from("orders").select("id,order_number,customer_name,status,total_amount,currency,created_at,reservation_expires_at")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(10)
  ]);
  const failure = [agent, products, reviews, deliveries, orders].find((result) => result.error);
  if (failure) throw failure.error;
  const active = products.data ?? [];
  return {
    settings, whatsappConnected,
    agentActive: agent.data?.is_active === true && ["vendas", "multifuncional"].includes(agent.data.specialization || "multifuncional"),
    products: active.length,
    readyProducts: active.filter((p) => Number(p.price) > 0 && Number(p.stock) > 0 &&
      (p.type !== "digital" || p.deliverable_path?.startsWith(`${userId}/`) || p.digital_content?.trim())).length,
    pendingReviews: reviews.count ?? 0, pendingDeliveries: deliveries.count ?? 0, orders: orders.data ?? [],
  };
}
