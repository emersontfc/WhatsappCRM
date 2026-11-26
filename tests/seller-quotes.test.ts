import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, abortSignal } = vi.hoisted(() => ({ rpc: vi.fn(), abortSignal: vi.fn() }));
vi.mock("../backend/supabaseAdmin.ts", () => ({ supabaseAdmin: { rpc } }));

import { acceptSellerQuote, saveSellerQuote } from "../backend/services/sellerQuotes.ts";

const acceptance = {
  userId: "a-merchant", contactId: "scoped-contact", sourceMessageId: "incoming-message",
  quotedMessageId: "actual-outgoing-message", phone: "84 000 0123", quantity: 2, paymentMethod: "mpesa" as const
};
const order = {
  id: "order-id", order_number: "AGX-0123456789AB", status: "awaiting_payment", total_amount: "190.00",
  currency: "MT", payment_method: "mpesa", seller_payment: { method: "mpesa", recipient: "258850000111", name: "Loja Teste" }
};

describe("seller conversation quotes", () => {
  beforeEach(() => {
    rpc.mockReset();
    abortSignal.mockReset();
    rpc.mockReturnValue({ abortSignal });
  });

  it("stores the actual outbound identity and product price together", async () => {
    abortSignal.mockResolvedValue({ data: true, error: null });
    await expect(saveSellerQuote({ userId: acceptance.userId, contactId: acceptance.contactId,
      outboundMessageId: acceptance.quotedMessageId, productId: "known-product", unitPrice: 95, currency: "MT" })).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("agentx_save_seller_quote", { p_user: acceptance.userId, p_contact: acceptance.contactId,
      p_outbound_message: acceptance.quotedMessageId, p_product: "known-product", p_unit_price: 95, p_currency: "MT" });
  });

  it("passes the real ingress ID and explicit WhatsApp reply reference to SQL", async () => {
    abortSignal.mockResolvedValue({ data: { status: "accepted", order: {
      ...order, reservation_expires_at: new Date(Date.now() + 60_000).toISOString()
    }, quantity: 2, productName: "Caderno escolar" }, error: null });
    const result = await acceptSellerQuote(acceptance);
    expect(result).toMatchObject({ status: "accepted", orderId: order.id });
    expect(result.text).toContain("2 × Caderno escolar");
    expect(result.text).toContain("258850000111");
    expect(rpc).toHaveBeenCalledWith("agentx_accept_seller_quote", expect.objectContaining({
      p_user: acceptance.userId, p_contact: acceptance.contactId, p_source_message: acceptance.sourceMessageId,
      p_quoted_message: acceptance.quotedMessageId, p_phone: "258840000123", p_quantity: 2, p_method: "mpesa"
    }));
  });

  it("asks for the product when the quote is stale or a different native reply is referenced", async () => {
    abortSignal.mockResolvedValue({ data: { status: "intervening" }, error: null });
    const result = await acceptSellerQuote(acceptance);
    expect(result).toMatchObject({ status: "intervening" });
    expect(result.text).toContain("nome do produto");
    expect(result.text).not.toContain(order.order_number);
  });

  it("uses current reviewed payment status on a replay and withholds payment instructions", async () => {
    abortSignal.mockResolvedValue({ data: { status: "replayed", order: { ...order, status: "verification_pending" },
      quantity: 2, productName: "Caderno escolar" }, error: null });
    const result = await acceptSellerQuote(acceptance);
    expect(result).toMatchObject({ status: "replayed", orderId: order.id });
    expect(result.text).toContain("comprovativo aguarda revisão");
    expect(result.text).not.toContain("258850000111");
  });
});
