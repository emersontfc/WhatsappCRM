import { once } from "node:events";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import scheduleRoutes from "../backend/routes/schedule.ts";
import type { AuthRequest } from "../backend/middleware/auth.ts";

const mocks = vi.hoisted(() => ({ from: vi.fn(), group: vi.fn(), send: vi.fn(), identity: vi.fn() }));
vi.mock("../backend/supabaseAdmin.ts", () => ({ supabaseAdmin: { from: mocks.from } }));
vi.mock("../backend/whatsappManager.ts", () => ({
  whatsappManager: { getGroupMetadata: mocks.group, getMe: mocks.identity, sendMessage: mocks.send }
}));

const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const contact = "00000000-0000-4000-8000-000000000011";
const foreignContact = "00000000-0000-4000-8000-000000000022";
const person = "258840000111@s.whatsapp.net";
const groupJid = "12345@g.us";

type Row = Record<string, unknown>;
const storage: Record<string, Row[]> = {
  contacts: [{ id: contact, user_id: owner, name: "Cliente", phone: "258841234567" },
    { id: foreignContact, user_id: other, name: "Contacto externo", phone: "258849876543" }],
  scheduled_messages: [],
  scheduled_status: []
};

function from(table: string) {
  let operation = "select";
  let payload: Row = {};
  const filters: Array<(row: Row) => boolean> = [];
  function perform() {
    if (operation === "insert") {
      const row = { id: crypto.randomUUID(), ...payload };
      storage[table].push(row);
      return [row];
    }
    const matches = storage[table].filter((row) => filters.every((filter) => filter(row)));
    if (operation === "update") for (const row of matches) Object.assign(row, payload);
    if (operation === "delete") storage[table] = storage[table].filter((row) => !matches.includes(row));
    return matches;
  }
  const chain = {
    select: () => chain,
    order: () => chain,
    abortSignal: () => chain,
    eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return chain; },
    neq: (key: string, value: unknown) => { filters.push((row) => row[key] !== value); return chain; },
    insert: (values: Row) => { operation = "insert"; payload = values; return chain; },
    update: (values: Row) => { operation = "update"; payload = values; return chain; },
    delete: () => { operation = "delete"; return chain; },
    maybeSingle: async () => ({ data: perform()[0] ?? null, error: null }),
    then: <T>(resolve: (result: { data: Row[]; error: null }) => T) =>
      Promise.resolve({ data: perform(), error: null }).then(resolve)
  };
  return chain;
}

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: AuthRequest, _res, next) => {
    if (req.headers.authorization === "Bearer owner") req.user = { id: owner };
    if (req.headers.authorization === "Bearer other") req.user = { id: other };
    next();
  });
  app.use("/api/schedule", scheduleRoutes);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/schedule`;
});

afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.resetAllMocks();
  storage.scheduled_messages = [];
  storage.scheduled_status = [];
  mocks.from.mockImplementation(from);
  mocks.identity.mockReturnValue({ id: person });
  mocks.group.mockResolvedValue({ id: groupJid, subject: "Grupo confirmado", participants: [{ id: person, admin: null }] });
  mocks.send.mockResolvedValue({ key: { id: "AGENDADO-1" } });
});

function request(path = "", method = "GET", body?: Row, actor: string | null = "owner") {
  return fetch(base + path, {
    method, headers: { "Content-Type": "application/json", ...(actor ? { Authorization: `Bearer ${actor}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}

function draft(overrides: Row = {}) {
  return { target_type: "contact", contact_id: contact, message: "Consulta amanhã",
    scheduled_at: new Date(Date.now() + 600_000).toISOString(), request_key: crypto.randomUUID(), ...overrides };
}

describe("owner-scoped Agenda API", () => {
  it("saves once, scopes the contact and reads the saved agenda by authenticated owner", async () => {
    expect((await request("", "GET", undefined, null)).status).toBe(401);
    expect((await request("", "POST", draft({ contact_id: foreignContact }))).status).toBe(400);
    const body = draft({ user_id: other });
    const original = await request("", "POST", body);
    const repeated = await request("", "POST", body);
    expect(original.status).toBe(201);
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual(await original.json());
    expect(storage.scheduled_messages).toEqual([expect.objectContaining({ user_id: owner, contact_id: contact, status: "pending" })]);
    expect((await (await request("", "GET", undefined, "other")).json()).data.messages).toEqual([]);
  });

  it("uses a confirmed group name and sends the group announcement only once", async () => {
    const body = draft({ target_type: "group", group_jid: groupJid, group_name: "Nome adulterado por cliente" });
    mocks.group.mockResolvedValueOnce({ subject: "Apenas admins", announce: true, participants: [{ id: person }] });
    expect((await request("", "POST", body)).status).toBe(403);
    const saved = await request("", "POST", body);
    expect(saved.status).toBe(201);
    const { id } = await saved.json();
    expect(storage.scheduled_messages[0].group_name).toBe("Grupo confirmado");
    expect((await request(`/${id}/send`, "POST", { target_type: "group" }, "other")).status).toBe(404);
    const results = await Promise.all([
      request(`/${id}/send`, "POST", { target_type: "group" }),
      request(`/${id}/send`, "POST", { target_type: "group" })
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(owner, groupJid, "Consulta amanhã",
      undefined, undefined, undefined, null, null, undefined);
    expect(storage.scheduled_messages[0]).toMatchObject({ status: "sent", dispatch_receipt_id: "AGENDADO-1" });
  });

  it("posts a group's own scheduled image and rejects foreign files and voice notes", async () => {
    vi.stubEnv("SUPABASE_URL", "https://fixture-project.invalid");
    const ownerMedia = `https://fixture-project.invalid/storage/v1/object/public/media/${owner}/flyer.png`;
    const body = draft({ target_type: "group", group_jid: groupJid, media_type: "image", media_url: ownerMedia,
      media_mimetype: "image/png", media_filename: "flyer.png" });
    expect((await request("", "POST", { ...body, media_url: ownerMedia.replace(owner, other) })).status).toBe(400);
    expect((await request("", "POST", { ...body, message: "", media_type: "audio",
      media_url: `/uploads/voice-${owner}-${crypto.randomUUID()}.ogg` })).status).toBe(400);

    const saved = await request("", "POST", body);
    expect(saved.status).toBe(201);
    const { id } = await saved.json();
    expect((await request(`/${id}/send`, "POST", { target_type: "group" })).status).toBe(200);
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(owner, groupJid, "Consulta amanhã",
      ownerMedia, "image", undefined, "image/png", "flyer.png", undefined);
  });

  it("edits and deletes only available jobs and rejects untrusted attachments", async () => {
    expect((await request("", "POST", draft({ media_type: "image", media_url: "https://example.org/picture.png" }))).status).toBe(400);
    const initial = await request("", "POST", draft({ target_type: "status" }));
    const { id } = await initial.json();
    const edit = draft({ target_type: "status", message: "Legenda revista" });
    expect((await request(`/${id}`, "PATCH", edit, "other")).status).toBe(404);
    expect((await request(`/${id}`, "PATCH", edit)).status).toBe(200);
    expect(storage.scheduled_status[0].caption).toBe("Legenda revista");
    const remove = () => request(`/${id}?target_type=status`, "DELETE");
    storage.scheduled_status[0].status = "processing";
    expect((await remove()).status).toBe(409);
    storage.scheduled_status[0].status = "pending";
    expect((await remove()).status).toBe(200);
    expect(storage.scheduled_status).toEqual([]);
  });
});
