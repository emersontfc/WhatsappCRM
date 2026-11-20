import { once } from "node:events";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticate } from "../backend/middleware/auth.ts";
import router from "../backend/routes/v2Commerce.ts";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  sign: vi.fn()
}));

vi.mock("../backend/supabaseAdmin.ts", () => ({
  supabaseAdmin: {
    rpc: mocks.rpc,
    auth: { getUser: mocks.getUser },
    from: () => ({ select: () => ({ eq: () => ({ limit: () => ({ maybeSingle: mocks.maybeSingle }) }) }) }),
    storage: { from: () => ({ createSignedUrl: mocks.sign }) }
  }
}));

const org = "00000000-0000-4000-8000-000000000010";
const order = "00000000-0000-4000-8000-000000000020";
const proof = "00000000-0000-4000-8000-000000000030";
const actor = "00000000-0000-4000-8000-000000000040";
const reviewPath = `/${org}/payment-proofs/${proof}/review`;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v2/commerce", authenticate, router);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test API has no port");
  baseUrl = `http://127.0.0.1:${address.port}/api/v2/commerce`;
});
afterAll(async () => {
  server.close();
  await once(server, "close");
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: actor } }, error: null });
  mocks.maybeSingle.mockResolvedValue({ data: { role: "user" } });
});

function request(path: string, body?: unknown, token: string | null = "http-test-token") {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return fetch(baseUrl + path, {
    method: body === undefined ? "GET" : "POST", headers, body: JSON.stringify(body)
  });
}

describe("AgentX v2 commerce HTTP", () => {
  it("requires a session before querying finance data", async () => {
    const response = await request(`/${org}/payment-proofs/pending`, undefined, null);
    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("submits parsed proof data with the authenticated user and no payment transition", async () => {
    mocks.rpc.mockResolvedValue({ data: proof, error: null });
    const response = await request(`/${org}/orders/${order}/payment-proofs`, {
      text: "Confirmado. Recebeu 25.00 MT de 841234567. Transaccao: 2K3J4H5G.",
      customerId: "untrusted", status: "paid"
    });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("agentx_submit_proof", {
      p_org: org, p_order: order, p_actor: actor,
      p_text: "Confirmado. Recebeu 25.00 MT de 841234567. Transaccao: 2K3J4H5G.",
      p_claimed_amount: "25.00", p_reference: "2K3J4H5G"
    });
  });

  it("rejects a disguised attachment and submits a PDF only as unverified evidence", async () => {
    const path = `/${org}/orders/${order}/proof-attachments`;
    const send = (content: string) => {
      const data = new FormData();
      data.append("file", new Blob([content], { type: "application/pdf" }), "proof.pdf");
      return fetch(baseUrl + path, {
        method: "POST", body: data, headers: { authorization: "Bearer http-test-token" }
      });
    };
    expect((await send("<html>fake pdf</html>")).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: proof, error: null });
    expect((await send("%PDF-1.7 fixture")).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("agentx_submit_proof_attachment", {
      p_org: org, p_order: order, p_actor: actor, p_extension: "pdf",
      p_content: Buffer.from("%PDF-1.7 fixture").toString("base64")
    });
  });

  it("does not return attachment bytes after a finance authorization failure", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "42501" } });
    const response = await request(`/${org}/payment-proofs/${proof}/attachment`);
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ success: false, error: "Organization access denied" });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("agentx_get_proof_attachment", {
      p_org: org, p_proof: proof, p_actor: actor
    });
  });

  it("requires explicit settlement confirmation and a verified reference", async () => {
    expect((await request(reviewPath, { decision: "approve", settlementVerified: true })).status).toBe(400);
    expect((await request(reviewPath, {
      decision: "approve", settlementVerified: "true",
      settlementMethod: "mpesa", settlementReference: "REF1"
    })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("delegates review authorization to the same transaction and maps denial", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "42501" } });
    const response = await request(reviewPath, {
      decision: "approve", settlementVerified: true, settlementMethod: "mpesa",
      settlementReference: "ref1", actorId: "untrusted"
    });
    expect(response.status).toBe(403);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("agentx_review_payment", {
      p_organization_id: org, p_proof_id: proof, p_actor_id: actor, p_decision: "approve",
      p_note: "", p_settlement_method: "mpesa", p_settlement_reference: "REF1"
    });
  });

  it("signs a short-lived attachment only for an entitled asset in the request organization", async () => {
    const path = `/${org}/orders/${order}/download`;
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: `other/${order}`, error: null })
      .mockResolvedValueOnce({ data: `${org}/${order}`, error: null });
    expect((await request(path)).status).toBe(404);
    expect((await request(path)).status).toBe(404);
    expect(mocks.sign).not.toHaveBeenCalled();
    mocks.sign.mockResolvedValue({ data: { signedUrl: "https://storage.invalid/temporary" }, error: null });
    const response = await request(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      success: true, data: { url: "https://storage.invalid/temporary", expiresIn: 60 }
    });
    expect(mocks.sign).toHaveBeenCalledExactlyOnceWith(`${org}/${order}`, 60, { download: true });
    expect(mocks.rpc).toHaveBeenLastCalledWith("agentx_get_digital_asset", {
      p_org: org, p_order: order, p_actor: actor
    });
  });
});
