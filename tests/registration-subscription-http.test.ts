import { once } from "node:events";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticate, authorizeAdmin } from "../backend/middleware/auth.ts";
import aiRoutes from "../backend/routes/ai.ts";
import authRoutes from "../backend/routes/auth.ts";

const { createUser, getUser, removeUser, from } = vi.hoisted(() => ({
  createUser: vi.fn(), getUser: vi.fn(), removeUser: vi.fn(), from: vi.fn()
}));

vi.mock("../backend/agentManager.ts", () => ({ decrypt: vi.fn(), runAI: vi.fn() }));
vi.mock("../backend/supabaseAdmin.ts", () => ({
  supabaseAdmin: { auth: { getUser, admin: { createUser, deleteUser: removeUser } }, from }
}));

type Row = Record<string, unknown>;
type Table = "users" | "plans" | "subscriptions";
type Filter = [string, unknown];
const rows: Record<Table, Row[]> = { users: [], plans: [], subscriptions: [] };
const writes: { table: Table; values: Row; method: string }[] = [];
const profilesUnavailable = { code: "57014", message: "Private database error" };
const sessions = new Map<string, { id: string; email: string }>();
const freePlan = { id: "free-id", name: "Free", max_contacts: 50, max_messages_per_day: 20 };
const monthlyPlan = { id: "pro-id", name: "Pro", max_contacts: 500 };
let profileFailure: { code: string; message: string } | null;
let profileReadFailure: typeof profileFailure;
let api: string;
let server: Server;

function query(table: Table) {
  const filters: Filter[] = [];
  let insert: Row | null = null;
  let ignoreDuplicates = false;
  let limit = Infinity;

  function result(single: boolean) {
    if (insert && table === "users" && profileFailure) return { data: null, error: profileFailure };
    if (!insert && table === "users" && profileReadFailure) return { data: null, error: profileReadFailure };
    let matched = rows[table].filter((row) => filters.every(([key, value]) => row[key] === value)).slice(0, limit);
    if (insert) {
      const values = insert;
      const existing = matched.find((row) => table === "users"
        ? row.id === values.id || row.email === values.email : row.user_id === values.user_id);
      if (existing) {
        return { data: null, error: ignoreDuplicates ? null : { code: "23505", message: "Unique constraint" } };
      }
      rows[table].push(values);
      matched = [values];
    }
    return { data: single ? (matched[0] ?? null) : matched, error: null };
  }

  const builder = {
    select() { return builder; },
    eq(key: string, value: unknown) { filters.push([key, value]); return builder; },
    order() { return builder; },
    limit(size: number) { limit = size; return builder; },
    insert(values: Row) { insert = values; writes.push({ table, values, method: "insert" }); return builder; },
    upsert(values: Row, options: { onConflict: string; ignoreDuplicates: boolean }) {
      expect(options).toEqual({ onConflict: "user_id", ignoreDuplicates: true });
      insert = values;
      ignoreDuplicates = options.ignoreDuplicates;
      writes.push({ table, values, method: "upsert" });
      return builder;
    },
    update() { throw new Error("Registration and subscription must not update existing rows"); },
    async single() { return result(true); },
    async maybeSingle() { return result(true); },
    then(resolve: (value: ReturnType<typeof result>) => unknown, reject: (reason: unknown) => unknown) {
      return Promise.resolve().then(() => result(false)).then(resolve, reject);
    }
  };
  return builder;
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/auth", authRoutes);
  app.use("/ai", authenticate, aiRoutes);
  app.get("/admin-check", authenticate, authorizeAdmin, (_, res) => res.sendStatus(204));
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test API has no port");
  api = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.close();
  await once(server, "close");
});

beforeEach(() => {
  vi.resetAllMocks();
  writes.length = 0;
  rows.users.length = 0;
  rows.subscriptions.length = 0;
  rows.plans.splice(0, Infinity, freePlan, monthlyPlan);
  profileFailure = null;
  profileReadFailure = null;
  sessions.clear();
  from.mockImplementation(query);
  getUser.mockImplementation(async (token: string) => ({ data: { user: sessions.get(token) ?? null }, error: null }));
});

afterEach(() => vi.unstubAllEnvs());

function register(email: string, extras: Row = {}) {
  return fetch(`${api}/auth/register`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, name: " Lojista ", password: "fixture-password", ...extras }) });
}

function request(path: string, token?: string) {
  return fetch(api + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
}

function subscription(token?: string, query = "") {
  return request(`/ai/subscription${query}`, token);
}

describe("public account provisioning and authenticated subscription", () => {
  it("registers configured administrator email addresses only with user and Free defaults", async () => {
    vi.stubEnv("ADMIN_EMAIL", "billing@example.invalid");
    vi.stubEnv("INITIAL_SUPERADMIN_EMAIL", "owner@example.invalid");
    createUser.mockResolvedValue({ data: { user: { id: "registered-user", email: "owner@example.invalid" } }, error: null });

    const response = await register(" OWNER@EXAMPLE.INVALID ", { role: "superadmin", plan: "Premium" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, user: { id: "registered-user" } });
    expect(createUser).toHaveBeenCalledExactlyOnceWith({ email: "owner@example.invalid", password: "fixture-password",
      email_confirm: true, user_metadata: { full_name: "Lojista" } });
    expect(rows.users).toEqual([{ id: "registered-user", email: "owner@example.invalid", name: "Lojista", role: "user", plan: "Free" }]);
  });

  it("reports profile persistence failure and lets the same authenticated identity finish setup", async () => {
    vi.stubEnv("ADMIN_EMAIL", "recover@example.invalid");
    const identity = { id: "recovered-user", email: "recover@example.invalid" };
    createUser.mockResolvedValue({ data: { user: identity }, error: null });
    profileFailure = profilesUnavailable;
    const registration = await register(identity.email);
    expect(registration.status).toBe(503);
    expect(await registration.json()).toEqual({ error: expect.stringMatching(/Inicia sessão/) });
    expect(removeUser).not.toHaveBeenCalled();
    expect(rows.users).toHaveLength(0);

    profileFailure = null;
    sessions.set("recovery-session", identity);
    const recovered = await subscription("recovery-session");
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ success: true, data: {
      id: identity.id, email: identity.email, role: "user", plan: "Free", subscription: { user_id: identity.id, plan_id: freePlan.id }
    } });
    expect((await request("/admin-check", "recovery-session")).status).toBe(403);
    const before = writes.length;
    expect((await subscription("recovery-session")).status).toBe(200);
    expect(writes).toHaveLength(before);
    expect(rows.users).toHaveLength(1);
    expect(rows.subscriptions).toHaveLength(1);
  });

  it("accepts a profile for the same Auth identity and leaves email or identity conflicts untouched", async () => {
    const existing = { id: "existing-auth-id", email: "first@example.invalid", role: "user", plan: "Pro", name: "Perfil existente" };
    rows.users.push(existing);
    createUser.mockResolvedValueOnce({ data: { user: { id: existing.id, email: existing.email } }, error: null });
    expect((await register(existing.email)).status).toBe(200);
    expect(rows.users).toEqual([existing]);

    createUser.mockResolvedValueOnce({ data: { user: { id: "other-auth-id", email: existing.email } }, error: null });
    expect((await register(existing.email)).status).toBe(503);
    expect(rows.users).toEqual([existing]);

    createUser.mockResolvedValueOnce({ data: { user: null }, error: { code: "email_exists" } });
    expect((await register(existing.email)).status).toBe(409);
    expect(removeUser).not.toHaveBeenCalled();
  });

  it("requires a session and ignores email configuration and tenant parameters for existing profiles", async () => {
    const identity = { id: "existing-user", email: "configured@example.invalid" };
    vi.stubEnv("INITIAL_SUPERADMIN_EMAIL", identity.email);
    vi.stubEnv("ADMIN_EMAIL", identity.email);
    sessions.set("configured-session", identity);
    rows.users.push({ ...identity, role: "user", plan: "Pro" }, { id: "another-user", email: "admin@example.invalid", role: "admin" });
    rows.subscriptions.push({ user_id: identity.id, plan: "Pro", plans: monthlyPlan });

    expect((await subscription()).status).toBe(401);
    expect((await subscription("unknown-session")).status).toBe(401);
    const response = await subscription("configured-session", "?userId=another-user&role=admin");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ success: true, data: {
      ...identity, plan: "Pro", role: "user", planDetails: monthlyPlan
    } });
    expect((await request("/admin-check", "configured-session")).status).toBe(403);
    expect(writes).toEqual([]);
  });

  it.each(["admin", "superadmin"])("preserves explicitly assigned role %s without email-based changes", async (role) => {
    const identity = { id: `manual-${role}`, email: "assigned@example.invalid" };
    const token = `assigned-${role}`;
    vi.stubEnv("ADMIN_EMAIL", "irrelevant@example.invalid");
    sessions.set(token, identity);
    rows.users.push({ ...identity, role, plan: "Free" });

    const response = await subscription(token);
    expect(await response.json()).toMatchObject({ success: true, data: {
      role, plan: "Admin", subscription: null, planDetails: { max_contacts: 999999, ai_enabled: true }
    } });
    expect((await request("/admin-check", token)).status).toBe(204);
    expect(writes).toEqual([]);
  });

  it("adds a missing subscription only for the signed-in Free profile", async () => {
    const identity = { id: "free-profile", email: "loja@example.invalid" };
    sessions.set("free-profile-session", identity);
    rows.users.push({ ...identity, role: "user", plan: "Free" });
    rows.subscriptions.push({ user_id: "other-profile", plan: "Pro", plans: monthlyPlan });
    const responses = await Promise.all([subscription("free-profile-session"), subscription("free-profile-session")]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(rows.subscriptions).toHaveLength(2);
    expect(rows.subscriptions[0]).toMatchObject({ user_id: "other-profile", plan: "Pro" });
    expect(rows.subscriptions[1]).toMatchObject({ user_id: identity.id, plan: "Free", plan_id: freePlan.id });
    expect(writes.every(({ table, method }) => table === "subscriptions" && method === "upsert")).toBe(true);
  });

  it("does not mistake a profile read failure for a missing row", async () => {
    sessions.set("unavailable-profile-session", { id: "failed-profile", email: "blocked@example.invalid" });
    profileReadFailure = profilesUnavailable;
    const response = await subscription("unavailable-profile-session");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ success: false });
    expect(writes).toEqual([]);
  });
});
