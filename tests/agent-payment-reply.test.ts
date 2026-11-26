import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatAgentOrderPaymentReply, readAgentPaymentMethods, readAgentPaymentReply } from "../backend/services/agentPaymentReply.ts";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../backend/supabaseAdmin.ts", () => ({ supabaseAdmin: { from } }));

const userId = "seller-account";
const phone = "258841234567";
const snapshot = { method: "mpesa", recipient: "258841234000", name: "Loja Número Um" };
const order = {
  id: "order-1", user_id: userId, customer_phone: phone, order_number: "AGX-AB12", status: "awaiting_payment",
  total_amount: "250.25", currency: "MT", payment_method: "mpesa", seller_payment: snapshot, created_at: "2026-10-01"
};
const settings = {
  user_id: userId, notification_phone: "258840000000", payment_recipient: "258840000001", recipient_name: "Destino global",
  payment_destinations: {
    mpesa: { recipient: "258840000001", name: "Destino global" },
    emola: { recipient: "258871111111", name: "Outra conta da loja" },
    bank_transfer: { recipient: "ACCOUNT999", name: "Titular bancário" },
    unsupported: { recipient: "PAYPAL132", name: "Usem outro método" }
  }
};
const data = { orders: [], agentx_seller_settings: [] } as Record<string, Record<string, unknown>[]>;
const projections: [string, string][] = [];
let unavailable = false;

function query(table: string) {
  let rows = data[table];
  const state = { rows };
  const result = () => unavailable ? { data: null, error: { code: "503", message: "private diagnostic" } } : { data: state.rows, error: null };
  const builder = {
    select(columns: string) { projections.push([table, columns]); return builder; },
    eq(key: string, value: unknown) { state.rows = state.rows.filter((row) => row[key] === value); return builder; },
    in(key: string, values: string[]) { state.rows = state.rows.filter((row) => values.includes(String(row[key]))); return builder; },
    order(key: string) { state.rows = [...state.rows].sort((left, right) => String(right[key]).localeCompare(String(left[key]))); return builder; },
    limit(size: number) { state.rows = state.rows.slice(0, size); return builder; },
    abortSignal(signal: AbortSignal) { expect(signal).toBeInstanceOf(AbortSignal); return builder; },
    async maybeSingle() { const { data, error } = result(); return { data: data?.[0] ?? null, error }; },
    then(resolve: (value: ReturnType<typeof result>) => unknown, reject: (error: unknown) => unknown) {
      return Promise.resolve(result()).then(resolve, reject);
    }
  };
  return builder;
}

beforeEach(() => {
  vi.resetAllMocks();
  from.mockImplementation(query);
  data.orders = [];
  data.agentx_seller_settings = [settings];
  projections.length = 0;
  unavailable = false;
});

describe("seller payment replies", () => {
  it("uses only the existing snapshot for a uniquely identified, unpaid order", async () => {
    data.orders = [
      { ...order, user_id: "other-seller", seller_payment: { ...snapshot, recipient: "258841230099" } },
      { ...order, customer_phone: "258841230088", seller_payment: { ...snapshot, recipient: "258841230077" } },
      { ...order, customer_phone: "841234567" }
    ];
    const answer = await readAgentPaymentReply({ userId, phone, desiredMethod: "mpesa", orderNumber: " agx-ab12 " });
    expect(answer).toContain("Pedido AGX-AB12 · 250,25 MT");
    expect(answer).toContain(`M-Pesa para ${snapshot.recipient} (titular: ${snapshot.name})`);
    expect(answer).toContain("referência AGX-AB12");
    expect(answer).not.toMatch(/258841230099|258841230077|25884000000/);
    expect(from).not.toHaveBeenCalledWith("agentx_seller_settings");
  });

  it("does not advise sending funds for ambiguous or unknown order references", async () => {
    data.orders = [order, { ...order, id: "order-2", order_number: "AGX-AB34", status: "verification_pending" }];
    const answer = await readAgentPaymentReply({ userId, phone });
    expect(answer).toMatch(/Há mais de um pedido.+número AGX/);
    expect(answer).not.toContain(snapshot.recipient);
    const missing = await readAgentPaymentReply({ userId, phone, orderNumber: "AGX-FOREIGN" });
    expect(missing).toMatch(/Não encontrei esse pedido para o teu número/);
    expect(from).not.toHaveBeenCalledWith("agentx_seller_settings");
  });

  it.each(["verification_pending", "paid", "fulfilled", "cancelled", "expired", "rejected", "refunded"])(
    "protects payment details when the order is %s", async (status) => {
      data.orders = [{ ...order, status }];
      for (const orderNumber of [order.order_number, undefined]) {
        const answer = await readAgentPaymentReply({ userId, phone, orderNumber });
        expect(answer).toContain(order.order_number);
        expect(answer).not.toMatch(/Paga por|titular|25884/);
      }
      expect(from).not.toHaveBeenCalledWith("agentx_seller_settings");
    }
  );

  it("fails closed for unexpected methods and malformed or missing snapshots", () => {
    expect(formatAgentOrderPaymentReply(order, "emola")).toMatch(/preparado para M-Pesa.+confirma primeiro com a equipa/);
    for (const candidate of [
      { ...order, payment_method: "emola" },
      { ...order, seller_payment: null },
      { ...order, seller_payment: { ...snapshot, recipient: "25884\n1234000" } },
      { ...order, total_amount: "-10.00" },
      { ...order, currency: "MT https://example.invalid" }
    ]) {
      const reply = formatAgentOrderPaymentReply(candidate);
      expect(reply).toMatch(/confirmado[s]? com a equipa/);
      expect(reply).not.toMatch(/Paga por|titular|25884/);
    }
  });

  it("lists available method labels before a purchase without querying or rendering destinations from other fields", async () => {
    data.agentx_seller_settings.push({ user_id: "other-seller", payment_destinations: {} });
    const methods = await readAgentPaymentMethods(userId);
    expect(methods).toBe("Métodos de pagamento disponíveis: M-Pesa, e-Mola e Transferência bancária.");
    expect(methods).not.toMatch(/25884|25887|ACCOUNT|PAYPAL|Titular/);
    expect(projections).toEqual([["agentx_seller_settings", "payment_destinations"]]);
    const answer = await readAgentPaymentReply({ userId, phone });
    expect(answer).toContain(methods);
    expect(answer).toMatch(/produto.+confirmar o pedido/);
  });

  it("rejects unresolved LID and does not invent payment data on a read failure", async () => {
    const unresolved = await readAgentPaymentReply({ userId, phone: "258841234567@lid" });
    expect(unresolved).toContain("não consigo confirmar o número");
    expect(from).not.toHaveBeenCalled();
    unavailable = true;
    expect(await readAgentPaymentReply({ userId, phone })).toMatch(/^Não foi possível consultar o pedido/);
    expect(from).not.toHaveBeenCalledWith("agentx_seller_settings");
  });
});
