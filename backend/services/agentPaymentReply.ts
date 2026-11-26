import { normalizeContactPhone } from "../../shared/contactPhone.ts";
import { isSellerMethod, sellerMethodKeys, sellerMethods, type OrderPayment, type SellerMethod } from "../../shared/seller.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { parseSellerSettings } from "./sellerWorkspace.ts";

type PaymentRequest = { userId: string; phone?: string | null; desiredMethod?: SellerMethod; orderNumber?: string };
type PaymentOrder = {
  order_number: string;
  status: string;
  total_amount?: number | string | null;
  currency?: string | null;
  payment_method?: string | null;
  seller_payment?: unknown;
  reservation_expires_at?: string | null;
};

const orderFields = "order_number,status,total_amount,currency,payment_method,seller_payment,reservation_expires_at";
const orderReference = /^AGX-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const pendingStatuses = ["created", "awaiting_payment", "verification_pending", "rejected"];
const payable = (status: string) => status === "created" || status === "awaiting_payment";
const money = new Intl.NumberFormat("pt-MZ", { maximumFractionDigits: 2 });
const list = new Intl.ListFormat("pt-MZ");
const reserveDeadline = new Intl.DateTimeFormat("pt-MZ", {
  timeZone: "Africa/Maputo", dateStyle: "short", timeStyle: "short"
});

const cannotRead = "Não foi possível consultar o pedido agora. Confirma com a equipa antes de fazer qualquer pagamento.";
const noOrder = "Diz-me o produto que queres comprar para podermos confirmar o pedido antes de pagares.";
const needsReference = "Há mais de um pedido. Indica o número AGX do pedido que queres consultar antes de pagares.";

const inactiveStatus: Record<string, string> = {
  verification_pending: "O comprovativo aguarda revisão. Aguarda a confirmação antes de fazer outro pagamento.",
  paid: "O pagamento já foi confirmado. Aguarda a entrega.",
  fulfilled: "O pedido já foi pago e a entrega concluída.",
  rejected: "O comprovativo foi rejeitado. Confirma o próximo passo com a equipa antes de voltar a pagar.",
  cancelled: "O pedido foi cancelado. Confirma com a equipa antes de pagar.",
  expired: "O pedido expirou. Confirma com a equipa antes de pagar.",
  refunded: "O pagamento foi reembolsado. Confirma com a equipa antes de voltar a pagar."
};

function validReference(value: unknown): value is string {
  return typeof value === "string" && value.length <= 50 && orderReference.test(value);
}

function readOrderPayment(value: unknown): OrderPayment | null {
  if (!value || typeof value !== "object") return null;
  const { method, recipient, name } = value as Partial<OrderPayment>;
  if (!isSellerMethod(method) || typeof recipient !== "string" || /[\p{Cc}\p{Cf}]/u.test(recipient) ||
      typeof name !== "string" || !parseSellerSettings({ payment_method: method, payment_destinations: { [method]: { recipient, name } } })) return null;
  return { method, recipient: recipient.trim(), name: name.trim() };
}

export function formatAgentOrderPaymentReply(order: PaymentOrder, desiredMethod?: SellerMethod) {
  if (!validReference(order.order_number)) return cannotRead;
  const prefix = `Pedido ${order.order_number}`;
  if (!payable(order.status)) {
    const status = Object.hasOwn(inactiveStatus, order.status) ? inactiveStatus[order.status] : cannotRead;
    return `${prefix}. ${status}`;
  }
  const expiresAt = Date.parse(order.reservation_expires_at ?? "");
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return Number.isFinite(expiresAt)
      ? `${prefix}. A reserva expirou. Se já pagaste, fala com a equipa antes de fazer outro pagamento.`
      : `${prefix}. A equipa precisa de confirmar uma reserva antes de receberes os dados de pagamento.`;
  }

  const destination = readOrderPayment(order.seller_payment);
  if (!destination || order.payment_method !== destination.method) {
    return `${prefix}. Os dados de pagamento deste pedido precisam de ser confirmados com a equipa antes de pagares.`;
  }
  const label = sellerMethods[destination.method];
  if (desiredMethod && desiredMethod !== destination.method) {
    return `${prefix}. O pedido foi preparado para ${label}. Para mudar o método, confirma primeiro com a equipa antes de pagares.`;
  }

  const total = String(order.total_amount ?? "");
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(total) || Number(total) <= 0 || typeof order.currency !== "string" || !/^[A-Z]{2,3}$/.test(order.currency)) {
    return `${prefix}. O valor precisa de ser confirmado com a equipa antes de pagares.`;
  }
  return `${prefix} · ${money.format(Number(total))} ${order.currency}. Reserva até ${reserveDeadline.format(expiresAt)} (hora de Maputo). Paga por ${label} para ${destination.recipient} (titular: ${destination.name}). Envia o comprovativo com a referência ${order.order_number} antes do fim da reserva.`;
}

export async function readAgentPaymentMethods(userId: string): Promise<string> {
  try {
    const { data, error } = await supabaseAdmin.from("agentx_seller_settings").select("payment_destinations")
      .eq("user_id", userId).abortSignal(AbortSignal.timeout(5_000)).maybeSingle();
    if (error) throw error;
    const destinations = data?.payment_destinations;
    const labels = sellerMethodKeys.filter((method) => {
      const destination = destinations?.[method];
      return destination && parseSellerSettings({ payment_method: method, payment_destinations: { [method]: destination } });
    }).map((method) => sellerMethods[method]);
    return labels.length ? `Métodos de pagamento disponíveis: ${list.format(labels)}.`
      : "Confirma os métodos de pagamento disponíveis com a equipa.";
  } catch {
    return "Não foi possível consultar os métodos de pagamento. Confirma com a equipa.";
  }
}

export async function readAgentPaymentReply({ userId, phone, desiredMethod, orderNumber }: PaymentRequest): Promise<string> {
  const buyer = normalizeContactPhone(phone);
  if (!buyer) return "Ainda não consigo confirmar o número associado a esta conversa. Confirma o pedido com a equipa antes de pagares.";
  const reference = typeof orderNumber === "string" ? orderNumber.trim().toUpperCase() : undefined;
  if (orderNumber !== undefined && !validReference(reference)) return "Indica um número de pedido AGX válido antes de pagares.";
  const aliases = [buyer, `+${buyer}`, `00${buyer}`];
  if (/^2588[2-7]\d{7}$/.test(buyer)) aliases.push(buyer.slice(3), `0${buyer.slice(3)}`);

  try {
    const signal = AbortSignal.timeout(6_000);
    const ownOrders = () => supabaseAdmin.from("orders").select(orderFields).eq("user_id", userId).in("customer_phone", aliases);
    const candidate = reference ? ownOrders().eq("order_number", reference) : ownOrders().in("status", pendingStatuses);
    const { data: orders, error } = await candidate.limit(2).abortSignal(signal);
    if (error) throw error;
    if (orders && orders.length > 1) return needsReference;
    if (orders?.[0]) return formatAgentOrderPaymentReply(orders[0], desiredMethod);
    if (reference) return "Não encontrei esse pedido para o teu número. Confirma o código com a equipa antes de transferires dinheiro.";

    const { data: recent, error: historyError } = await ownOrders()
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).abortSignal(signal);
    if (historyError) throw historyError;
    if (!recent?.[0]) return `${await readAgentPaymentMethods(userId)} ${noOrder}`;
    if (payable(recent[0].status)) return "Indica o número AGX para eu confirmar qual é o pedido antes de pagares.";
    return formatAgentOrderPaymentReply(recent[0], desiredMethod);
  } catch {
    return cannotRead;
  }
}
