import { once } from "node:events";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticate } from "../backend/middleware/auth.ts";
import groups from "../backend/routes/groups.ts";

const { gateway } = vi.hoisted(() => ({ gateway: {
  getGroupMetadata: vi.fn(), getMe: vi.fn(), updateGroupSubject: vi.fn(), updateGroupDescription: vi.fn(),
  updateGroupAccess: vi.fn(), getGroupInvite: vi.fn(), getGroupJoinRequests: vi.fn(), reviewGroupJoinRequest: vi.fn(),
  updateGroupParticipants: vi.fn(), sendMessage: vi.fn(), leaveGroup: vi.fn()
} }));
vi.mock("../backend/whatsappManager.ts", () => ({ whatsappManager: gateway }));
vi.mock("../backend/supabaseAdmin.ts", () => ({ supabaseAdmin: {
  auth: { getUser: async () => ({ data: { user: { id: "account-a" } }, error: null }) },
  from: () => ({ select: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { role: "user" } }) }) }) }) })
} }));

const jid = "12036312345@g.us";
const self = "258841234567@s.whatsapp.net";
const lid = "1234567890@lid";
const member = "258851234567@s.whatsapp.net";
const owner = "258861234567@s.whatsapp.net";
const invite = "abcdefghijklmnopqrstuv";

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
    expect((await request("/settings", "PATCH", { field: "announce", value: true })).status).toBe(200);
    expect((await request("/settings", "PATCH", { field: "description", value: " Regras da comunidade " })).status).toBe(200);
    expect((await request("/subject", "POST", { subject: " Equipa " })).status).toBe(200);
    expect(gateway.updateGroupAccess).toHaveBeenCalledExactlyOnceWith("account-a", jid, "announce", true);
    expect(gateway.updateGroupDescription).toHaveBeenCalledExactlyOnceWith("account-a", jid, "Regras da comunidade");
    expect(gateway.updateGroupSubject).toHaveBeenCalledExactlyOnceWith("account-a", jid, "Equipa");
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
    gateway.updateGroupParticipants.mockResolvedValueOnce([{ jid: member, status: "403" }])
      .mockResolvedValueOnce([{ jid: member, status: "200" }]);
    const denied = await request("/participants", "POST", { action: "add", participants: ["+258 85 123 4567"] });
    expect(denied.status).toBe(409);
    expect(await denied.json()).toMatchObject({ error: expect.stringContaining("exige convite") });
    expect(gateway.updateGroupParticipants).toHaveBeenNthCalledWith(1, "account-a", jid, [member], "add");
    expect((await request("/participants", "POST", { action: "promote", participants: [member] })).status).toBe(200);
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
});
