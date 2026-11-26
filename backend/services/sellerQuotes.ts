import { randomBytes } from "node:crypto";
import type { SellerMethod } from "../../shared/seller.ts";
import { normalizeContactPhone } from "../../shared/contactPhone.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { formatAgentOrderPaymentReply, readAgentPaymentMethods } from "./agentPaymentReply.ts";

type SaveQuote = {
  userId: string;
  contactId: string;
  outboundMessageId: string;
  productId: string;
  unitPrice: number;
  currency: string;
};

type AcceptQuote = {
  userId: string;
  contactId: string;
  sourceMessageId: string;
  phone?: string | null;
  quantity: number;
  paymentMethod?: SellerMethod;
  quotedMessageId?: string | null;
};

type QuoteFailure = "missing" | "unavailable" | "price_changed" | "payment_unavailable" | "expired" | "intervening" | "invalid";
type QuoteResolution = { status: "accepted" | "replayed"; text: string; orderId: string } | { status: QuoteFailure; text: string };
type QuoteOrder = Parameters<typeof formatAgentOrderPaymentReply>[0] & { id: string };

const replies: Record<QuoteFailure, string> = {
  missing: "Qual é o produto que queres encomendar? Envia o nome para eu indicar o preço e o stock.",
  unavailable: "O produto indicado já não está disponível na quantidade pedida. Podes consultar o catálogo para escolher outra opção.",
  price_changed: "O preço ou a moeda do produto mudou. Envia o nome do produto para consultar o preço atual antes de encomendar.",
  payment_unavailable: "O método de pagamento não está disponível para este pedido.",
  expired: "A proposta expirou. Envia o nome do produto para consultar o preço e o stock atuais.",
  intervening: "Preciso de confirmar qual é a proposta que queres aceitar. Envia o nome do produto para eu indicar o preço e o stock.",
  invalid: "Não foi possível confirmar esta proposta. Envia o nome do produto ou fala com a equipa antes de pagar."
};

export async function saveSellerQuote(input: SaveQuote): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("agentx_save_seller_quote", {
    p_user: input.userId, p_contact: input.contactId, p_outbound_message: input.outboundMessageId,
    p_product: input.productId, p_unit_price: input.unitPrice, p_currency: input.currency
  }).abortSignal(AbortSignal.timeout(5_000));
  if (error) throw error;
  return data === true;
}

function failed(status: QuoteFailure): QuoteResolution {
  return { status, text: replies[status] };
}

async function paymentUnavailable(userId: string): Promise<QuoteResolution> {
  return { status: "payment_unavailable", text: `${replies.payment_unavailable} ${await readAgentPaymentMethods(userId)}` };
}

export async function acceptSellerQuote(input: AcceptQuote): Promise<QuoteResolution> {
  const phone = normalizeContactPhone(input.phone);
  if (!phone) return failed("invalid");
  const { data, error } = await supabaseAdmin.rpc("agentx_accept_seller_quote", {
    p_user: input.userId, p_contact: input.contactId, p_source_message: input.sourceMessageId,
    p_phone: phone, p_quantity: input.quantity, p_method: input.paymentMethod ?? null,
    p_order_number: `AGX-${randomBytes(6).toString("hex").toUpperCase()}`, p_quoted_message: input.quotedMessageId ?? null
  }).abortSignal(AbortSignal.timeout(8_000));
  if (error) {
    if (error.code === "P0002" || error.message?.includes("Insufficient available stock")) return failed("unavailable");
    if (error.message?.includes("Catalog price or currency changed")) return failed("price_changed");
    if (/método de pagamento|payment method|payment destination/i.test(error.message ?? "")) {
      return paymentUnavailable(input.userId);
    }
    throw error;
  }
  const status = data?.status;
  if (status === "payment_unavailable") return paymentUnavailable(input.userId);
  if (status === "accepted" || status === "replayed") {
    const order = data?.order as QuoteOrder | undefined;
    if (typeof order?.id !== "string" || typeof data.productName !== "string" ||
      !Number.isInteger(data.quantity) || data.quantity < 1) return failed("invalid");
    return { status, orderId: order.id,
      text: `${data.quantity} × ${data.productName}\n${formatAgentOrderPaymentReply(order, input.paymentMethod)}` };
  }
  return failed(typeof status === "string" && Object.hasOwn(replies, status) ? status as QuoteFailure : "invalid");
}
