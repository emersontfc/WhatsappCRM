import { once } from "node:events";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import commerce from "../backend/routes/commerce.ts";
import type { AuthRequest } from "../backend/middleware/auth.ts";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), from: vi.fn(), rpc: vi.fn(), storage: vi.fn(), download: vi.fn(),
  approve: vi.fn(), reject: vi.fn(), fulfill: vi.fn(), operationSummary: vi.fn() }));
vi.mock("../backend/services/sellerTeam.ts", () => ({ resolveSellerTeamAccess: mocks.resolve }));
vi.mock("../backend/services/commerceService.ts", () => ({ sellerOperationSummary: mocks.operationSummary, commerceService: {
  approveOrder: mocks.approve, rejectOrder: mocks.reject, fulfillOrder: mocks.fulfill
} }));
vi.mock("../backend/supabaseAdmin.ts", () => ({ supabaseAdminConfigured: true,
  supabaseAdmin: { from: mocks.from, rpc: mocks.rpc, storage: { from: mocks.storage } } }));
vi.mock("../backend/whatsappManager.ts", () => ({ whatsappManager: {} }));

const organizationId = "bb95c1d5-4148-4d5b-8338-58fcedb03001";
const store = "bb95c1d5-4148-4d5b-8338-58fcedb03002";
const seller = "bb95c1d5-4148-4d5b-8338-58fcedb03003";
const finance = "bb95c1d5-4148-4d5b-8338-58fcedb03004";
const foreignActor = "bb95c1d5-4148-4d5b-8338-58fcedb03005";
const orderId = "bb95c1d5-4148-4d5b-8338-58fcedb03006";
const proofId = "bb95c1d5-4148-4d5b-8338-58fcedb03007";
const orderPath = `/orders/${orderId}`;
const attachmentPath = `/verifications/${proofId}/attachment`;
const order = { id: orderId, order_number: "AGX-ABCDEF012345", status: "verification_pending" };

let server: Server;
let root: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: AuthRequest, _res, next) => {
    const id = req.get("Authorization")?.replace(/^Bearer /, "");
    if (id) req.user = { id };
    next();
  });
  app.use("/api/commerce", commerce);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Commerce test server has no port");
  root = `http://127.0.0.1:${address.port}/api/commerce`;
});

afterAll(async () => {
  server.close();
  await once(server, "close");
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolve.mockImplementation(async (actor: string, selected: string) => {
    if (selected !== organizationId || ![store, seller, finance].includes(actor)) return null;
    const role = actor === store ? "owner" : actor === seller ? "operator" : "finance_admin";
    return { organizationId, accountId: store, role };
  });
});

function request(path: string, actor: string | null, { company = organizationId, method = "GET", body }: {
  company?: string | null; method?: string; body?: unknown;
} = {}) {
  const headers = new Headers();
  if (actor) headers.set("Authorization", `Bearer ${actor}`);
  if (company !== null) headers.set("X-AgentX-Company", company);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return fetch(root + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function rows<T>(data: T) {
  const result = Promise.resolve({ data, error: null });
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), abortSignal: vi.fn(), limit: vi.fn(),
    maybeSingle: () => result, then: result.then.bind(result) };
  for (const step of [query.select, query.eq, query.order, query.abortSignal, query.limit]) step.mockReturnValue(query);
  return query;
}

describe("company-scoped commerce", () => {
  it("rejects missing sessions, malformed selectors, foreign access and a revoked membership on the next request", async () => {
    expect((await request("/orders", null)).status).toBe(401);
    expect((await request("/orders", seller, { company: "" })).status).toBe(400);
    expect((await request("/orders", foreignActor)).status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();

    expect(await (await request("/access", seller)).json()).toEqual({ success: true, data: { organizationId, role: "operator" } });
    mocks.resolve.mockResolvedValueOnce(null);
    expect((await request("/orders", seller)).status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("queries sales with the linked owner ID and the delegate-safe order projection", async () => {
    const query = rows([order]);
    mocks.from.mockReturnValue(query);
    expect(await (await request("/orders", seller)).json()).toEqual({ success: true, data: [order] });
    expect(mocks.from).toHaveBeenCalledWith("orders");
    expect(query.eq).toHaveBeenCalledWith("user_id", store);
    expect(query.select).toHaveBeenCalledWith(expect.stringContaining("order_items(id,product_name"));
    expect(query.select.mock.calls[0][0]).not.toMatch(/\*|seller_payment|deliverable_snapshot/);

    expect((await request("/orders", seller, { company: null })).status).toBe(200);
    expect(query.eq).toHaveBeenLastCalledWith("user_id", seller);
  });

  it("keeps payment review with finance and delivery or catalog changes with sales", async () => {
    for (const path of ["/verifications", attachmentPath]) expect((await request(path, seller)).status).toBe(403);
    for (const path of ["/approve", "/reject"]) {
      expect((await request(orderPath + path, seller, { method: "POST", body: { proofId } })).status).toBe(403);
    }
    for (const path of ["/cancel", "/delivery", "/delivery/confirm"]) {
      expect((await request(orderPath + path, finance, { method: "POST" })).status).toBe(403);
    }
    expect((await request("/seller/settings", seller, { method: "PUT" })).status).toBe(403);
    expect((await request("/products", finance, { method: "POST", body: { name: "Produto" } })).status).toBe(403);
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.reject).not.toHaveBeenCalled();
    expect(mocks.fulfill).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("shows sales a status change without reading private notes from the timeline", async () => {
    const event = { id: "review", step: "admin_rejected", created_at: "2026-11-27T00:00:00Z" };
    const query = rows([event]);
    mocks.from.mockReturnValue(query);
    mocks.operationSummary.mockReturnValue("A equipa financeira reviu o comprovativo.");
    const response = await request("/operations-feed", seller);
    expect(await response.json()).toEqual({ success: true, data: [{ ...event, description: "A equipa financeira reviu o comprovativo." }] });
    expect(query.eq).toHaveBeenCalledWith("user_id", store);
    expect(query.select.mock.calls[0][0]).not.toMatch(/\*|description|metadata/);
    expect(mocks.operationSummary).toHaveBeenCalledWith(event.step);
  });

  it("passes the financial actor to confirmation and the seller actor to cancellation, withholding private result fields", async () => {
    const orderNumber = order.order_number;
    const approval = { success: true, order: { ...order, status: "paid", seller_payment: { recipient: "private" } },
      fulfillment: { delivered: false } };
    mocks.approve.mockResolvedValue(approval);
    expect((await request(orderPath + "/approve", finance, { method: "POST", body: { proofId } })).status).toBe(400);
    expect(mocks.approve).not.toHaveBeenCalled();
    const approved = await request(orderPath + "/approve", finance, { method: "POST", body: { proofId, settlementVerified: true } });
    expect(approved.status).toBe(200);
    expect(approved.headers.get("Cache-Control")).toBe("no-store");
    expect(await approved.json()).toEqual({ ...approval, order: { id: orderId, order_number: orderNumber, status: "paid" } });
    expect(mocks.approve).toHaveBeenCalledExactlyOnceWith(orderId, store,
      { verified: true, proofId, method: null, reference: null, amount: null }, { actorId: finance, organizationId });

    mocks.rpc.mockReturnValue({ abortSignal: async () => ({ data: { ...order, status: "cancelled", seller_payment: "private" }, error: null }) });
    const cancelled = await request(orderPath + "/cancel", seller, { method: "POST" });
    expect(await cancelled.json()).toEqual({ success: true, data: { id: orderId, status: "cancelled" } });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("agentx_seller_team_cancel_order", { p_actor: seller, p_org: organizationId, p_order: orderId });
  });

  it("downloads an exact private proof only through an authorized company account", async () => {
    const bytes = Buffer.from("%PDF-1.7\nComprovativo de teste");
    const noGroupProof = rows(null);
    const directProof = rows({ storage_path: `${store}/${proofId}.pdf`, file_name: "prova.pdf",
      mime_type: "application/pdf", size_bytes: bytes.length });
    mocks.from.mockReturnValueOnce(noGroupProof).mockReturnValueOnce(directProof);
    mocks.storage.mockReturnValue({ download: mocks.download });
    mocks.download.mockResolvedValue({ data: new Blob([bytes]), error: null });
    for (const actor of [seller, foreignActor]) expect((await request(attachmentPath, actor)).status).toBe(403);
    expect(mocks.download).not.toHaveBeenCalled();

    const attachment = await request(attachmentPath, finance);
    expect(attachment.status).toBe(200);
    expect(attachment.headers.get("Cache-Control")).toBe("no-store");
    expect(await attachment.json()).toEqual({ success: true, name: "prova.pdf", mime: "application/pdf", base64: bytes.toString("base64") });
    expect(directProof.eq.mock.calls).toEqual([["user_id", store], ["verification_id", proofId]]);
    expect(mocks.storage).toHaveBeenCalledExactlyOnceWith("agentx-direct-proofs");
  });
});
