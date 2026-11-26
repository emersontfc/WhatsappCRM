import { once } from "node:events";
import type { Server } from "node:http";
import express from "express";
import { generateWAMessage } from "@whiskeysockets/baileys";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import scheduleRoutes from "../backend/routes/schedule.ts";
import whatsappRoutes from "../backend/routes/whatsapp.ts";
import type { AuthRequest } from "../backend/middleware/auth.ts";

const mocks = vi.hoisted(() => ({ from: vi.fn(), group: vi.fn(), send: vi.fn(), identity: vi.fn(), campaign: vi.fn() }));
vi.mock("../backend/supabaseAdmin.ts", () => ({ supabaseAdmin: { from: mocks.from } }));
vi.mock("../backend/lib/plan.ts", () => ({ getPlan: async () => ({ max_messages_per_day: 100 }) }));
vi.mock("../backend/services/catalogCampaigns.ts", () => ({ prepareCatalogCampaignDispatch: mocks.campaign }));
vi.mock("../backend/whatsappManager.ts", () => ({
  whatsappManager: { getGroupMetadata: mocks.group, getMe: mocks.identity, sendMessage: mocks.send }
}));

const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const contact = "00000000-0000-4000-8000-000000000011";
const secondContact = "00000000-0000-4000-8000-000000000012";
const foreignContact = "00000000-0000-4000-8000-000000000022";
const source = "00000000-0000-4000-8000-000000000111";
const foreignSource = "00000000-0000-4000-8000-000000000122";
const person = "258840000111@s.whatsapp.net";
const groupJid = "12345@g.us";

type Row = Record<string, unknown>;
const storage: Record<string, Row[]> = {
  contacts: [{ id: contact, user_id: owner, name: "Cliente", phone: "258841234567" },
    { id: secondContact, user_id: owner, name: "Segundo cliente", phone: "258841234568" },
    { id: foreignContact, user_id: other, name: "Contacto externo", phone: "258849876543" }],
  messages: [],
  subscriptions: [],
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
    limit: () => chain,
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
  app.use("/api/whatsapp", whatsappRoutes);
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
  storage.subscriptions = [{ user_id: owner, messages_used: 0 }];
  storage.messages = [
    { id: source, user_id: owner, contact_id: contact, type: "inbound", msg_id: "WA-TEXTO-1", text: "Pergunta do cliente" },
    { id: foreignSource, user_id: other, contact_id: foreignContact, type: "inbound", msg_id: "WA-OUTRA-CONTA", text: "Privada" }
  ];
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

const quotation = { messageId: source, message: { key: { id: "WA-TEXTO-1", remoteJid: "258841234567@s.whatsapp.net", fromMe: false },
  message: { conversation: "Pergunta do cliente" } } };

describe("WhatsApp quoted text", () => {
  function send(body: Row) {
    return fetch(base.replace(/\/schedule$/, "/whatsapp/send"), { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer owner" }, body: JSON.stringify(body) });
  }

  it("uses the saved WhatsApp text and key and rejects quotes from other conversations or accounts", async () => {
    const body = { contactId: contact, replyToMessageId: source, text: "Sim, confirmo" };
    expect((await send({ ...body, contactId: secondContact })).status).toBe(404);
    expect((await send({ ...body, replyToMessageId: foreignSource })).status).toBe(404);
    expect((await send({ ...body, mediaType: "image", mediaUrl: "https://example.invalid/photo.png" })).status).toBe(400);
    expect(mocks.send).not.toHaveBeenCalled();
    expect((await send({ ...body, quote: { text: "Citação adulterada" }, jid: "258849876543@s.whatsapp.net" })).status).toBe(200);
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(owner, "258841234567@s.whatsapp.net", "Sim, confirmo",
      undefined, undefined, undefined, undefined, undefined, contact, quotation);
    const protocolMessage = await generateWAMessage("258841234567@s.whatsapp.net", { text: "Sim, confirmo" }, {
      userJid: person, quoted: quotation.message, messageId: "WA-RESPOSTA-1",
      upload: async () => { throw new Error("Quoted text must not upload media"); }
    });
    expect(protocolMessage.message?.extendedTextMessage?.contextInfo).toMatchObject({
      stanzaId: "WA-TEXTO-1", quotedMessage: { conversation: "Pergunta do cliente" }
    });
  });

  it("stores the quote once, preserves it when rescheduled and reconstructs it at dispatch", async () => {
    const body = draft({ reply_to_message_id: source });
    expect((await request("", "POST", { ...body, contact_id: secondContact })).status).toBe(404);
    expect((await request("", "POST", { ...body, reply_to_message_id: foreignSource })).status).toBe(404);
    const saved = await request("", "POST", body);
    expect(saved.status).toBe(201);
    const { id } = await saved.json();
    expect(await (await request("", "POST", body)).json()).toEqual({ success: true, id });
    expect(storage.scheduled_messages).toHaveLength(1);
    const revision = draft({ message: "Resposta revista" });
    expect((await request(`/${id}`, "PATCH", { ...revision, contact_id: secondContact })).status).toBe(404);
    expect((await request(`/${id}`, "PATCH", revision)).status).toBe(200);
    expect(storage.scheduled_messages[0].reply_to_message_id).toBe(source);
    expect((await request(`/${id}/send`, "POST", { target_type: "contact" })).status).toBe(200);
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(owner, "258841234567@s.whatsapp.net", "Resposta revista",
      undefined, undefined, undefined, null, null, contact, quotation);
  });

  it("never dispatches an unquoted message if its original disappears", async () => {
    const response = await request("", "POST", draft({ reply_to_message_id: source }));
    expect(response.status).toBe(201);
    const { id } = await response.json();
    storage.messages = [];
    expect((await request(`/${id}/send`, "POST", { target_type: "contact" })).status).toBe(409);
    expect(storage.scheduled_messages[0]).toMatchObject({ status: "failed", reply_to_message_id: source });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

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

  it("uses only the verified campaign content once a group job is claimed", async () => {
    const initial = await request("", "POST", draft({ target_type: "group", group_jid: groupJid }));
    expect(initial.status).toBe(201);
    const { id } = await initial.json();
    const campaignId = crypto.randomUUID();
    storage.scheduled_messages[0].campaign_id = campaignId;
    const image = Buffer.from("campaign fixture");
    mocks.campaign.mockResolvedValue({ message: "Produto ABC · 800 MT", image, mimetype: "image/png", filename: "capa.png" });
    expect((await request(`/${id}`, "PATCH", draft({ target_type: "group", group_jid: groupJid, message: "Alterado na Agenda" }))).status).toBe(409);
    expect((await request(`/${id}/send`, "POST", { target_type: "group" })).status).toBe(200);
    expect(mocks.campaign).toHaveBeenCalledExactlyOnceWith(owner, campaignId, id, groupJid);
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(owner, groupJid, "Produto ABC · 800 MT",
      image, "image", undefined, "image/png", "capa.png", undefined);
  });
});
