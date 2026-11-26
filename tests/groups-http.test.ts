import { once } from "node:events";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticate } from "../backend/middleware/auth.ts";
import groups from "../backend/routes/groups.ts";

const { gateway, catalog, policyRead, policyWrite } = vi.hoisted(() => ({ gateway: {
  getGroupMetadata: vi.fn(), getMe: vi.fn(), updateGroupSubject: vi.fn(), updateGroupDescription: vi.fn(),
  updateGroupAccess: vi.fn(), getGroupInvite: vi.fn(), getGroupJoinRequests: vi.fn(), reviewGroupJoinRequest: vi.fn(),
  updateGroupParticipants: vi.fn(), sendMessage: vi.fn(), leaveGroup: vi.fn()
}, catalog: { select: vi.fn(), eq: vi.fn(), gt: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn() },
policyRead: vi.fn(), policyWrite: vi.fn() }));
vi.mock("../backend/whatsappManager.ts", () => ({ whatsappManager: gateway }));
vi.mock("../backend/supabaseAdmin.ts", () => ({ supabaseAdmin: {
  auth: { getUser: async () => ({ data: { user: { id: "account-a" } }, error: null }) },
  from: (table: string) => table === "products" ? catalog
    : table === "users" ? ({ select: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { role: "user" } }) }) }) }) })
      : policyRead(table),
  rpc: policyWrite,
} }));

const jid = "12036312345@g.us";
const self = "258841234567@s.whatsapp.net";
const lid = "1234567890@lid";
const member = "258851234567@s.whatsapp.net";
const owner = "258861234567@s.whatsapp.net";
const newMember = "258871234567@s.whatsapp.net";
const newMemberLid = "9876543210@lid";
const invite = "abcdefghijklmnopqrstuv";
const product = { id: "c3e1e2fb-166b-4db4-a27e-4fc8d20ed396", name: "Livro do catálogo", price: 400, currency: "MT" };

function metadata(admin = true, announce = false) {
  return {
    id: jid, subject: "Grupo de teste", owner, announce, inviteCode: invite,
    participants: [{ id: lid, phoneNumber: self, admin: admin ? "admin" : null },
      { id: owner, admin: "superadmin" }, { id: member, admin: null }]
  };
}

let server: Server;
let root: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/whatsapp/groups", authenticate, groups);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test API has no port");
  root = `http://127.0.0.1:${address.port}/api/whatsapp/groups/`;
});
afterAll(async () => {
  server.close();
  await once(server, "close");
});
beforeEach(() => {
  vi.resetAllMocks();
  gateway.getMe.mockReturnValue({ id: "258841234567:4@s.whatsapp.net" });
  gateway.getGroupMetadata.mockResolvedValue(metadata());
  catalog.select.mockReturnValue(catalog);
  catalog.eq.mockReturnValue(catalog);
  catalog.gt.mockReturnValue(catalog);
  catalog.order.mockReturnValue(catalog);
  catalog.limit.mockResolvedValue({ data: [product], error: null });
  catalog.maybeSingle.mockResolvedValue({ data: product, error: null });
  policyWrite.mockReturnValue({ abortSignal: async () => ({ data: null, error: null }) });
});

function request(path = "", method = "GET", body?: unknown, authorized = true) {
  return fetch(root + encodeURIComponent(jid) + path, {
    method,
    headers: { "content-type": "application/json", ...(authorized ? { authorization: "Bearer test-group-session" } : {}) },
    body: JSON.stringify(body)
  });
}

describe("WhatsApp group administration API", () => {
  it("requires sign-in and confirmed membership of the chosen group", async () => {
    expect((await request("/invite", "GET", undefined, false)).status).toBe(401);
    expect(gateway.getGroupMetadata).not.toHaveBeenCalled();
    gateway.getGroupMetadata.mockResolvedValue({ ...metadata(), participants: [{ id: owner, admin: "superadmin" }] });
    expect((await request()).status).toBe(403);
    gateway.getGroupMetadata.mockResolvedValue({ ...metadata(), id: "8888@g.us" });
    expect((await request()).status).toBe(502);
  });

  it("matches the linked phone to a LID member and withholds invite codes from details", async () => {
    const result = await (await request()).json();
    expect(result.permissions).toEqual({ manage: true, post: true, selfId: lid });
    expect(result.metadata).not.toHaveProperty("inviteCode");
    expect(gateway.getGroupMetadata).toHaveBeenCalledExactlyOnceWith("account-a", jid);
    gateway.getGroupMetadata.mockResolvedValue(metadata(false, true));
    const ordinary = await (await request()).json();
    expect(ordinary.permissions).toEqual({ manage: false, post: false, selfId: lid });
    expect((await request("/invite")).status).toBe(403);
    expect(gateway.getGroupInvite).not.toHaveBeenCalled();
  });

  it("validates each setting and delegates changes under the authorized account", async () => {
    expect((await request("/settings", "PATCH", { field: "announce", value: "true" })).status).toBe(400);
    expect(gateway.updateGroupAccess).not.toHaveBeenCalled();
    expect((await request("/settings", "PATCH", { field: "description", value: " Regras da comunidade " })).status).toBe(200);
    expect((await request("/subject", "POST", { subject: " Equipa " })).status).toBe(200);
    expect(gateway.updateGroupDescription).toHaveBeenCalledExactlyOnceWith("account-a", jid, "Regras da comunidade");
    expect(gateway.updateGroupSubject).toHaveBeenCalledExactlyOnceWith("account-a", jid, "Equipa");
  });

  it("closes and opens group writing only for admins and verifies each resulting mode", async () => {
    const setting = (value: boolean) => request("/settings", "PATCH", { field: "announce", value });
    gateway.getGroupMetadata.mockResolvedValueOnce(metadata(false));
    expect((await setting(true)).status).toBe(403);
    expect(gateway.updateGroupAccess).not.toHaveBeenCalled();

    gateway.getGroupMetadata.mockResolvedValueOnce(metadata()).mockResolvedValueOnce(metadata(true, true));
    expect(await (await setting(true)).json()).toEqual({ success: true, announce: true });
    gateway.getGroupMetadata.mockResolvedValueOnce(metadata(true, true)).mockResolvedValueOnce(metadata());
    expect(await (await setting(false)).json()).toEqual({ success: true, announce: false });
    expect(gateway.updateGroupAccess).toHaveBeenNthCalledWith(1, "account-a", jid, "announce", true);
    expect(gateway.updateGroupAccess).toHaveBeenNthCalledWith(2, "account-a", jid, "announce", false);

    expect((await setting(true)).status).toBe(409);
    expect(await (await setting(false)).json()).toEqual({ success: true, announce: false });
    expect(gateway.updateGroupAccess).toHaveBeenCalledTimes(3);
  });

  it("only rotates a confirmed valid invitation through the explicit mutation", async () => {
    gateway.getGroupInvite.mockResolvedValueOnce(invite).mockResolvedValueOnce("bad/path").mockResolvedValueOnce(invite);
    const read = await request("/invite");
    expect(read.headers.get("cache-control")).toBe("no-store");
    expect(await read.json()).toMatchObject({ url: `https://chat.whatsapp.com/${invite}` });
    expect((await request("/invite/reset", "POST")).status).toBe(502);
    expect((await request("/invite/reset", "POST")).status).toBe(200);
    expect(gateway.getGroupInvite).toHaveBeenNthCalledWith(1, "account-a", jid, false);
    expect(gateway.getGroupInvite).toHaveBeenNthCalledWith(2, "account-a", jid, true);
  });

  it("filters request identities and only confirms a gateway-approved decision", async () => {
    gateway.getGroupJoinRequests.mockResolvedValue([{ jid: member, request_time: "1" }, { jid: "invalid" }, { jid: member }]);
    expect(await (await request("/requests")).json()).toEqual({ success: true, participants: [member] });
    gateway.reviewGroupJoinRequest.mockResolvedValueOnce([{ jid: member, status: "403" }])
      .mockResolvedValueOnce([{ jid: member, status: "200" }]);
    expect((await request("/requests", "POST", { participant: member, action: "approve" })).status).toBe(409);
    expect((await request("/requests", "POST", { participant: member, action: "reject" })).status).toBe(200);
    expect(gateway.reviewGroupJoinRequest).toHaveBeenLastCalledWith("account-a", jid, member, "reject");
  });

  it("protects the linked account and creator and reports WhatsApp privacy rejections", async () => {
    for (const id of [self, owner]) {
      expect((await request("/participants", "POST", { action: "remove", participants: [id] })).status).toBe(400);
    }
    expect(gateway.updateGroupParticipants).not.toHaveBeenCalled();
    gateway.updateGroupParticipants.mockResolvedValueOnce([{ jid: newMember, status: "403" }]);
    const denied = await request("/participants", "POST", { action: "add", participants: ["+258 87 123 4567"] });
    expect(denied.status).toBe(409);
    expect(await denied.json()).toMatchObject({ error: expect.stringContaining("exige convite") });
    expect(gateway.updateGroupParticipants).toHaveBeenCalledExactlyOnceWith("account-a", jid, [newMember], "add");
    const repeated = await request("/participants", "POST", { action: "add", participants: [member] });
    expect(await repeated.json()).toEqual({ success: true, status: "unchanged" });
    expect(gateway.updateGroupParticipants).toHaveBeenCalledTimes(1);
  });

  it("confirms additions and removals by identity and membership, including phone aliases for LID", async () => {
    const afterAdd = { ...metadata(), participants: [...metadata().participants,
      { id: newMemberLid, phoneNumber: newMember, admin: null }] };
    const mutate = (action: string, participant: string) => request("/participants", "POST", { action, participants: [participant] });
    gateway.updateGroupParticipants.mockResolvedValueOnce([{ jid: newMemberLid, status: "200" }]);
    gateway.getGroupMetadata.mockResolvedValueOnce(metadata()).mockResolvedValueOnce(afterAdd);
    expect(await (await mutate("add", "+258 87 123 4567")).json()).toEqual({ success: true, status: "confirmed" });

    gateway.updateGroupParticipants.mockResolvedValueOnce([{ jid: newMember, status: "200" }]);
    gateway.getGroupMetadata.mockResolvedValueOnce(afterAdd).mockResolvedValueOnce(metadata());
    expect(await (await mutate("remove", newMemberLid)).json()).toEqual({ success: true, status: "confirmed" });

    gateway.updateGroupParticipants.mockResolvedValueOnce([{ jid: member, status: "200" }]);
    expect((await mutate("add", newMember)).status).toBe(409);
    gateway.updateGroupParticipants.mockResolvedValueOnce([{ jid: member, status: "200" }]);
    expect((await mutate("remove", member)).status).toBe(409);
  });

  it("does not post in closed groups without admin permission or claim an unconfirmed send", async () => {
    gateway.getGroupMetadata.mockResolvedValueOnce(metadata(false, true)).mockResolvedValue(metadata(false));
    expect((await request("/announce", "POST", { text: "Olá" })).status).toBe(403);
    expect(gateway.sendMessage).not.toHaveBeenCalled();
    gateway.sendMessage.mockResolvedValueOnce({}).mockResolvedValueOnce({ key: { id: "accepted" } });
    expect((await request("/announce", "POST", { text: "Olá" })).status).toBe(502);
    const result = await request("/announce", "POST", { text: " Olá " });
    expect(await result.json()).toEqual({ success: true, status: "sent" });
    expect(gateway.sendMessage).toHaveBeenLastCalledWith("account-a", jid, "Olá");
  });

  it("reads scoped policy and warns of busy group settings instead of changing them", async () => {
    const scope = vi.fn();
    const reads: Record<string, unknown> = { group_rules: null, agentx_group_hours: null, agentx_group_warnings: [] };
    policyRead.mockImplementation((table: string) => {
      const result = { data: reads[table], error: null };
      const chain = {
        select: () => chain, eq: (column: string, value: string) => { scope(table, column, value); return chain; },
        order: () => chain, limit: () => chain,
        abortSignal: () => table === "agentx_group_warnings" ? Promise.resolve(result) : chain,
        maybeSingle: async () => result,
      };
      return chain;
    });
    gateway.getGroupMetadata.mockResolvedValueOnce(metadata(false));
    expect(await (await request("/policy")).json()).toEqual({ success: true, schedule: null, warnings: [], announce: false,
      rules: { allowed_link_hosts: [], blocked_words: [], warning_limit: 0 } });
    expect(scope.mock.calls).toEqual(Object.keys(reads).flatMap((table) =>
      [[table, "user_id", "account-a"], [table, "group_jid", jid]]));

    const body = { userId: "untrusted", rules: { allowed_link_hosts: ["Example.COM"], blocked_words: ["AVISO FALSO"], warning_limit: 2 },
      schedule: { enabled: true, timezone: "Africa/Maputo", days: [7, 1], opens_at: "21:00", closes_at: "05:00" } };
    gateway.getGroupMetadata.mockResolvedValueOnce(metadata(false));
    expect((await request("/policy", "PUT", body)).status).toBe(403);
    expect((await request("/policy", "PUT", { ...body, schedule: { ...body.schedule, opens_at: "24:00" } })).status).toBe(400);
    expect(policyWrite).not.toHaveBeenCalled();
    expect((await request("/policy", "PUT", body)).status).toBe(200);
    expect(policyWrite).toHaveBeenCalledWith("agentx_set_group_policy", {
      p_user: "account-a", p_group: jid, p_rules: { allowed_link_hosts: ["example.com"], blocked_words: ["aviso falso"], warning_limit: 2 },
      p_schedule: { ...body.schedule, days: [1, 7] },
    });
    policyWrite.mockReturnValueOnce({ abortSignal: async () => ({ error: { code: "55P03" } }) });
    expect((await request("/policy", "PUT", body)).status).toBe(409);
  });

  it("posts a selected group's promotion using the current product from the authenticated account", async () => {
    const listing = await request("/promotion-products");
    expect(await listing.json()).toEqual({ success: true, products: [product] });
    const publish = (body: unknown) => request("/promotions", "POST", body);
    gateway.sendMessage.mockResolvedValue({ key: { id: "accepted-promotion" } });
    expect(await (await publish({ productId: product.id, text: " Só hoje ", userId: "account-b", price: 1 })).json())
      .toEqual({ success: true, status: "sent" });
    expect(catalog.select).toHaveBeenCalledWith("id,name,price,currency");
    expect(catalog.eq).toHaveBeenCalledWith("user_id", "account-a");
    expect(catalog.eq).toHaveBeenCalledWith("is_active", true);
    expect(catalog.gt).toHaveBeenCalledWith("stock", 0);
    expect(catalog.eq).toHaveBeenCalledWith("id", product.id);
    expect(gateway.sendMessage).toHaveBeenCalledExactlyOnceWith("account-a", jid, expect.stringMatching(/Só hoje[\s\S]*Livro do catálogo[\s\S]*400[.,]00 MT/));

    catalog.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await publish({ productId: product.id })).status).toBe(409);
    expect((await publish({ text: "a".repeat(4096) })).status).toBe(400);
    gateway.getGroupMetadata.mockResolvedValueOnce(metadata(false, true));
    expect((await publish({ text: "Teste" })).status).toBe(403);
    expect(gateway.sendMessage).toHaveBeenCalledTimes(1);
  });
});
