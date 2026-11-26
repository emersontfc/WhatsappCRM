import { once } from "node:events";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import campaigns from "../backend/routes/catalogCampaigns.ts";
import { captureCatalogCampaignInterest, readCatalogCampaignCode } from "../backend/services/catalogCampaignAttribution.ts";
import { campaignCode, campaignMessage, merchantCampaignPhone, ownedCatalogCover, prepareCatalogCampaignDispatch } from "../backend/services/catalogCampaigns.ts";

const { from, rpc, getMe, getGroups, writableGroup, dispatch, download } = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), getMe: vi.fn(), getGroups: vi.fn(), writableGroup: vi.fn(), dispatch: vi.fn(), download: vi.fn()
}));
vi.mock("../backend/supabaseAdmin.ts", () => ({ supabaseAdmin: { from, rpc, storage: { from: () => ({ download }) } } }));
vi.mock("../backend/whatsappManager.ts", () => ({ whatsappManager: { getMe, getGroups } }));
vi.mock("../backend/services/schedulePolicy.ts", async (module) => ({
  ...await module<typeof import("../backend/services/schedulePolicy.ts")>(), writableScheduleGroup: writableGroup
}));
vi.mock("../backend/services/scheduledDispatch.ts", () => ({ dispatchScheduled: dispatch }));

const userId = "4c13a1be-b031-4585-8240-92439c960001";
const productId = "4c13a1be-b031-4585-8240-92439c960002";
const campaignId = "4c13a1be-b031-4585-8240-92439c960003";
const scheduleId = "4c13a1be-b031-4585-8240-92439c960004";
const key = "4c13a1be-b031-4585-8240-92439c960005";
const phone = "258840000001";
const jid = "120363000000001@g.us";
const code = `AXC-${"7".repeat(32)}`;
const coverPath = `${userId}/4c13a1be-b031-4585-8240-92439c960006`;
const image = Buffer.from("ffd8ff0001", "hex");
const product = { id: productId, name: "Livro Ciências & História", price: 130, stock: 7, currency: "MT", catalog_cover_path: coverPath };
let api: string;
let server: Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _, next) => {
    if (req.get("authorization") === "Bearer seller-session") Object.assign(req, { user: { id: userId } });
    next();
  });
  app.use("/campaigns", campaigns);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Campaign test server has no port");
  api = `http://127.0.0.1:${address.port}/campaigns`;
});

afterAll(async () => {
  server.close();
  await once(server, "close");
});

beforeEach(() => {
  vi.resetAllMocks();
  getMe.mockReturnValue({ id: `${phone}:21@s.whatsapp.net` });
  getGroups.mockResolvedValue({});
  writableGroup.mockResolvedValue({ id: jid, subject: "Grupo da loja" });
  from.mockReturnValue(readResult(null));
  rpc.mockImplementation((name: string) => name === "agentx_seller_catalog_availability" ? stockResult(5)
    : { abortSignal: async () => ({ data: { id: campaignId, scheduleId, created: true, status: "pending" }, error: null }) });
});
afterEach(() => vi.unstubAllEnvs());

function readResult(data: unknown) {
  const result = Promise.resolve({ data, error: null });
  const query = { select: () => query, eq: () => query, gt: () => query, order: () => query, limit: () => query,
    abortSignal: () => query, maybeSingle: () => result, then: result.then.bind(result) };
  return query;
}

function stockResult(stock: number) {
  return { abortSignal: async () => ({ data: [{ product_id: productId, available_stock: stock }], error: null }) };
}

function publish(data: Record<string, unknown> = {}, authenticated = true) {
  return fetch(api, {
    method: "POST", headers: { "content-type": "application/json", ...(authenticated ? { authorization: "Bearer seller-session" } : {}) },
    body: JSON.stringify({ productId, groupJid: jid, requestKey: key, publishNow: true, caption: "Disponível", ...data })
  });
}

describe("catalogue group campaigns", () => {
  it("formats the real item and a bounded Unicode WhatsApp opt-in link with the exact product name", () => {
    const content = campaignMessage(product, "Conhece o nosso livro", phone, code);
    const link = new URL(content.slice(content.indexOf("https://")));
    expect(link.origin + link.pathname).toBe(`https://wa.me/${phone}`);
    expect(link.searchParams.get("text")).toBe(`Olá! Tenho interesse em ${product.name}. ${code}`);
    expect(content).toContain("Stock disponível: 7");
    expect(content).toMatch(/130[,.]00 MT/);
    const extreme = campaignMessage({ ...product, name: "🧪識".repeat(500), stock: 1_000_000_000 }, "🧪".repeat(200), phone, code);
    expect(extreme.length).toBeLessThanOrEqual(1024);
    expect(new URL(extreme.slice(extreme.indexOf("https://"))).searchParams.get("text")).toMatch(new RegExp(`${code}$`));
    expect(campaignCode()).toMatch(/^AXC-[A-F0-9]{32}$/);
    expect(merchantCampaignPhone({ id: "12345678901234@lid" })).toBeNull();
  });

  it("handles only one complete attribution code and scopes the persisted interest to the incoming contact", async () => {
    expect(readCatalogCampaignCode(`Olá ${code.toLowerCase()}`)).toBe(code);
    expect(readCatalogCampaignCode(`${code} AXC-${"1".repeat(32)}`)).toBeNull();
    expect(readCatalogCampaignCode(`${code}0`)).toBeNull();
    rpc.mockReturnValueOnce({ abortSignal: async () => ({ data: "interest-uuid", error: null }) });
    expect(await captureCatalogCampaignInterest(userId, "contact-id", `Olá ${code}`, "message-id")).toBe("interest-uuid");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("agentx_capture_catalog_campaign_interest", {
      p_user: userId, p_contact: "contact-id", p_source_message: "message-id", p_code: code, p_message: `Olá ${code}`
    });
  });

  it("rejects unsigned requests and protected groups before creating the queue item", async () => {
    expect((await publish({}, false)).status).toBe(401);
    writableGroup.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "120363000000002@g.us", subject: "Outro grupo" });
    expect((await publish()).status).toBe(403);
    expect((await publish()).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("queues the authenticated actor and does not send an already completed request again", async () => {
    dispatch.mockResolvedValue({ status: "sent", error: null });
    const result = await publish({ userId: "other-merchant", price: 1, media_url: "https://example.invalid/private" });
    expect(result.status).toBe(201);
    expect(await result.json()).toMatchObject({ status: "sent" });
    expect(rpc).toHaveBeenCalledWith("agentx_queue_catalog_campaign", expect.objectContaining({
      p_user: userId, p_product: productId, p_group: jid, p_merchant_phone: phone, p_key: key
    }));
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("price");
    expect(dispatch).toHaveBeenCalledExactlyOnceWith("scheduled_messages", scheduleId, userId, expect.any(String));

    rpc.mockReturnValueOnce({ abortSignal: async () => ({ data: { id: campaignId, scheduleId, created: false, status: "sent" }, error: null }) });
    expect((await publish()).status).toBe(200);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("recovers a pending immediate dispatch with the same request after an ambiguous response, keeping cancelled jobs cancelled", async () => {
    vi.stubEnv("DISABLE_SCHEDULER", "true");
    dispatch.mockRejectedValueOnce(new Error("Process interrupted after creating the queue row"))
      .mockResolvedValueOnce({ status: "sent", error: null });
    expect(await (await publish()).json()).toMatchObject({ id: campaignId, status: "queued" });
    const existing = { id: campaignId, product_id: productId, group_jid: jid, caption: "Disponível" };
    from.mockReturnValueOnce(readResult(existing)).mockReturnValueOnce(readResult({ id: scheduleId, status: "pending" }));
    expect(await (await publish()).json()).toMatchObject({ id: campaignId, status: "sent" });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledTimes(1);

    from.mockReturnValueOnce(readResult(existing)).mockReturnValueOnce(readResult(null));
    expect(await (await publish()).json()).toMatchObject({ id: campaignId, status: "cancelled" });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("re-times and cancels only a pending Agenda row scoped to the current account", async () => {
    const eq = vi.fn(() => query);
    const update = vi.fn(() => query);
    const remove = vi.fn(() => query);
    const single = vi.fn().mockResolvedValue({ data: { id: scheduleId }, error: null });
    const query = { eq, update, delete: remove, select: () => query, abortSignal: () => query, maybeSingle: single };
    from.mockReturnValue(query);
    const scheduledAt = new Date(Date.now() + 60_000).toISOString();
    const path = `${api}/${campaignId}/schedule`;
    const headers = { authorization: "Bearer seller-session", "content-type": "application/json" };
    expect((await fetch(path, { method: "PATCH", headers, body: JSON.stringify({ scheduledAt }) })).status).toBe(200);
    expect(update).toHaveBeenCalledExactlyOnceWith({ scheduled_at: scheduledAt, error: null, retry_at: null });
    expect(eq.mock.calls).toEqual([["campaign_id", campaignId], ["user_id", userId], ["status", "pending"]]);

    eq.mockClear();
    expect(await (await fetch(path, { method: "DELETE", headers })).json()).toMatchObject({ status: "cancelled" });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(eq.mock.calls).toEqual([["campaign_id", campaignId], ["user_id", userId], ["status", "pending"]]);
    single.mockResolvedValueOnce({ data: null, error: null });
    expect((await fetch(path, { method: "DELETE", headers })).status).toBe(409);
  });

  it("shows available stock in the campaign list and preview, hiding products whose units are all held", async () => {
    const headers = { authorization: "Bearer seller-session", "content-type": "application/json" };
    const list = () => fetch(api, { headers });
    const preview = () => fetch(api + "/preview", {
      headers, method: "POST", body: JSON.stringify({ productId })
    });
    from.mockImplementation((table: string) => readResult(table === "products" ? [product] : []));
    const listed = await list();
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({ data: { products: [{ id: productId, stock: 5, hasCover: true }] } });
    rpc.mockReturnValueOnce(stockResult(0));
    expect(await (await list()).json()).toMatchObject({ data: { products: [] } });

    from.mockReturnValue(readResult(product));
    const visiblePreview = await preview();
    expect(visiblePreview.status).toBe(200);
    expect((await visiblePreview.json()).preview).toContain("Stock disponível: 5");
    rpc.mockReturnValueOnce(stockResult(0));
    expect((await preview()).status).toBe(409);
    expect(rpc.mock.calls).toEqual(Array.from({ length: 4 }, () => ["agentx_seller_catalog_availability", { p_user: userId }]));
  });

  it("reads photo bytes only for the same account, claimed schedule and verified shop number", async () => {
    const filters: unknown[] = [];
    from.mockImplementation((table: string) => {
      const data = table === "agentx_catalog_campaigns" ? {
        id: campaignId, product_id: productId, group_jid: jid, merchant_phone: phone, code, caption: "Promoção"
      } : table === "scheduled_messages" ? { id: scheduleId } : product;
      const query = { select: () => query, eq: (column: string, value: unknown) => { filters.push([table, column, value]); return query; },
        gt: () => query, abortSignal: () => query, maybeSingle: async () => ({ data, error: null }) };
      return query;
    });
    download.mockResolvedValue({ data: new Blob([new Uint8Array(image)]), error: null });
    expect(ownedCatalogCover(userId, `${userId}/../secret`)).toBe(false);
    expect(ownedCatalogCover(userId, `https://example.invalid/${coverPath}`)).toBe(false);
    expect(await prepareCatalogCampaignDispatch(userId, campaignId, scheduleId, "120363000000999@g.us")).toBeNull();
    expect(download).not.toHaveBeenCalled();
    const prepared = await prepareCatalogCampaignDispatch(userId, campaignId, scheduleId, jid);
    expect(prepared).toMatchObject({ image, mimetype: "image/jpeg", filename: "produto.jpg" });
    expect(prepared?.message).toContain(`https://wa.me/${phone}`);
    expect(prepared?.message).toContain("Stock disponível: 5");
    rpc.mockReturnValueOnce(stockResult(0));
    expect(await prepareCatalogCampaignDispatch(userId, campaignId, scheduleId, jid)).toBeNull();
    expect(filters).toContainEqual(["scheduled_messages", "status", "processing"]);
    expect(filters).toContainEqual(["products", "user_id", userId]);
    expect(download).toHaveBeenCalledExactlyOnceWith(coverPath, {}, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
});
