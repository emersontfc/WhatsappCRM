import { readContactPhone } from "../../shared/contactPhone.ts";
import { isSellerMethod, type SellerOverview, type SellerSettings } from "../../shared/seller.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";

const settingsFields = "payment_method,payment_recipient,recipient_name,notification_phone";

export async function sellerSettings(userId: string): Promise<SellerSettings | null> {
  const { data, error } = await supabaseAdmin.from("agentx_seller_settings")
    .select(settingsFields).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data as SellerSettings | null;
}

export function parseSellerSettings(body: Record<string, unknown> | undefined): SellerSettings | null {
  const method = body?.payment_method;
  if (!isSellerMethod(method)) return null;
  const rawRecipient = typeof body?.payment_recipient === "string" ? body.payment_recipient.trim() : "";
  const recipient = method === "bank_transfer" ? rawRecipient.toUpperCase() : readContactPhone(rawRecipient);
  const name = typeof body?.recipient_name === "string" ? body.recipient_name.trim() : "";
  const rawNotification = typeof body?.notification_phone === "string" ? body.notification_phone.trim() : "";
  const notification = readContactPhone(rawNotification);
  if (!recipient || !/^[A-Z0-9][A-Z0-9 -]{4,59}$/.test(recipient) ||
      name.length < 2 || name.length > 100 || /[\r\n\p{Cc}\p{Cf}]/u.test(name) ||
      (rawNotification && !notification)) return null;
  return { payment_method: method, payment_recipient: recipient, recipient_name: name, notification_phone: notification };
}

export async function saveSellerSettings(userId: string, settings: SellerSettings) {
  const { error } = await supabaseAdmin.from("agentx_seller_settings")
    .upsert({ ...settings, user_id: userId, updated_at: new Date().toISOString() });
  if (error) throw error;
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
    supabaseAdmin.from("orders").select("id,order_number,customer_name,status,total_amount,currency,created_at")
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
