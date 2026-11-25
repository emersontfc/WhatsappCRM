import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, resolveApiUrl } from "../src/lib/api";
import { isPublicSupabaseKey, publicConfig } from "../shared/publicConfig";

const { session, request } = vi.hoisted(() => ({ session: vi.fn(), request: vi.fn() }));
vi.mock("../src/supabase", () => ({ getSession: session }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("window", { location: { origin: "https://panel.example" }, __ENV__: { VITE_API_URL: "https://api.example/prefix/api/" } });
  vi.stubGlobal("fetch", request);
  session.mockResolvedValue({ access_token: "test-user-session" });
});
afterEach(() => vi.unstubAllGlobals());

describe("shared AgentX API transport", () => {
  it("uses the configured runtime server and deduplicates the API prefix", async () => {
    request.mockResolvedValue(Response.json({ success: true }));
    expect(await apiFetch("/api/operations")).toEqual({ success: true });
    expect(request).toHaveBeenCalledExactlyOnceWith("https://api.example/prefix/api/operations", expect.objectContaining({
      headers: new Headers({ accept: "application/json", authorization: "Bearer test-user-session" })
    }));
  });

  it("keeps same-origin calls and rejects external URLs before obtaining a session", async () => {
    vi.stubGlobal("window", { location: { origin: "https://panel.example" } });
    expect(resolveApiUrl("/api/ready")).toBe("https://panel.example/api/ready");
    await expect(apiFetch("https://outside.example/path")).rejects.toThrow("caminho relativo");
    await expect(apiFetch("//outside.example/path")).rejects.toThrow("caminho relativo");
    expect(session).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects a proxy HTML response even if it has status 200", async () => {
    request.mockResolvedValue(new Response("<!doctype html><title>Proxy</title>", {
      headers: { "content-type": "text/html", "x-request-id": "trace-1" }
    }));
    await expect(apiFetch("/api/whatsapp/send-scheduled", { method: "POST" })).rejects.toMatchObject({
      status: 200, requestId: "trace-1", message: expect.stringContaining("inesperada")
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("preserves structured API errors and never replays an unconfirmed write", async () => {
    request.mockResolvedValue(Response.json({ error: "Não foi possível confirmar" }, {
      status: 503, headers: { "x-request-id": "trace-2" }
    }));
    await expect(apiFetch("/api/orders", { method: "POST", body: "{}" })).rejects.toMatchObject({
      status: 503, requestId: "trace-2", message: "Não foi possível confirmar (503)"
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("applies the deadline while waiting for Supabase Auth", async () => {
    session.mockReturnValue(new Promise(() => {}));
    await expect(apiFetch("/api/ready", { timeout: 15 })).rejects.toThrow("demorou");
    expect(request).not.toHaveBeenCalled();
  });

  it("allows public registration while the previous session is stalled", async () => {
    session.mockReturnValue(new Promise(() => {}));
    request.mockResolvedValue(Response.json({ success: true }));
    await expect(apiFetch("/api/auth/register", { method: "POST", authenticate: false })).resolves.toEqual({ success: true });
    expect(session).not.toHaveBeenCalled();
    const [, options] = request.mock.calls[0];
    expect(options.headers.has("Authorization")).toBe(false);
  });

  it("rejects a write when the current session belongs to a different account", async () => {
    session.mockResolvedValue({ access_token: "test-user-session", user: { id: "new-account" } });
    await expect(apiFetch("/api/whatsapp/reset", { method: "POST", accountId: "old-account" })).rejects.toMatchObject({ status: 401 });
    expect(request).not.toHaveBeenCalled();
  });
});

describe("public configuration boundary", () => {
  const jwt = (role: string) => `header.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
  it("permits public and legacy anonymous keys and excludes server credentials", () => {
    expect(isPublicSupabaseKey(jwt("anon"))).toBe(true);
    expect(isPublicSupabaseKey("sb_publishable_test-project")).toBe(true);
    expect(isPublicSupabaseKey("sb_secret_test-secret")).toBe(false);
    expect(publicConfig({ VITE_SUPABASE_ANON_KEY: jwt("service_role"), GEMINI_API_KEY: "demo-secret" })).toEqual({
      VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "", VITE_API_URL: ""
    });
  });
});
