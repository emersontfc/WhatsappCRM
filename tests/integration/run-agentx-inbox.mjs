import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { createServer, request as proxyRequest } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const otherContact = "00000000-0000-4000-8000-000000000022";
const previousLeadId = "00000000-0000-4000-8000-000000000031";
const duplicateLeadId = "00000000-0000-4000-8000-000000000032";
const foreignLeadId = "00000000-0000-4000-8000-000000000033";
const fresh = process.env.AGENTX_INBOX_FRESH === "1";
const password = "agentx-inbox-test-password";
const rest = new URL(process.argv[2]);
assert.equal(rest.hostname, "127.0.0.1");
const secret = process.env.AGENTX_FIXTURE_JWT_SECRET;
assert.ok(secret);

function token(role, sub) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role, sub, aud: role, iat: now, exp: now + 3600 })}`;
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

const users = [owner, other].map((id, index) => ({
  id, email: `loja-${index ? "b" : "a"}@example.invalid`, role: "authenticated", aud: "authenticated",
  app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z"
}));
const userTokens = users.map((user) => token("authenticated", user.id));
const publicKey = token("anon");
const serviceKey = token("service_role");
const storedObjects = new Map();
const downloadedObjects = [];
const pdfBytes = Buffer.from("%PDF-1.7\nExemplo");
const sentDocuments = (outbound) => outbound.filter((message) => message.content.document);
function testAudio() {
  const samples = Buffer.alloc(16000 * 2, 0);
  for (let i = 0; i < samples.length / 2; i++) {
    samples.writeInt16LE(Math.round(6000 * Math.sin(2 * Math.PI * 440 * i / 16000)), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(samples.length + 36, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}

let aiEndpointAvailable = true;
let aiRequests = 0;

const supabase = createServer(async (req, res) => {
  if (req.headers.origin) res.setHeader("access-control-allow-origin", req.headers.origin);
  res.setHeader("access-control-allow-headers", req.headers["access-control-request-headers"] ?? "authorization, apikey, content-type");
  res.setHeader("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  if (req.url.startsWith("/rest/v1/")) {
    const upstream = proxyRequest(new URL(req.url.slice("/rest/v1".length), rest), {
      method: req.method, headers: { ...req.headers, host: rest.host }
    }, (answer) => {
      res.writeHead(answer.statusCode, answer.headers);
      answer.pipe(res);
    });
    upstream.on("error", () => res.writeHead(502).end());
    return req.pipe(upstream);
  }

  res.setHeader("content-type", "application/json");
  if (req.url === "/fixture-ai" && req.method === "POST") {
    aiRequests++;
    let input = "";
    for await (const chunk of req) input += chunk;
    if (!aiEndpointAvailable) return res.writeHead(503).end(JSON.stringify({ error: "Simulated AI outage" }));
    const message = JSON.parse(input).message.split("\nUSER:\n").at(-1);
    const buying = message.includes("comprar");
    const paymentMethod = /e-Mola/i.test(message) ? "emola" : /transferência bancária/i.test(message) ? "bank_transfer" : undefined;
    let toolAnswer = { tool: "getProductsCatalog", args: { search: "Livro do piloto" } };
    if (message.includes("Comprovativo")) {
      toolAnswer = { tool: "submitPaymentProof", reply: "O pagamento já foi confirmado.", args: {} };
    } else if (message.includes("interesse")) {
      toolAnswer = { tool: "qualifyLEAD", args: { phone: "258870000001", interestLevel: "alto", tag: "Interessado no livro",
        notes: message.includes("limite") ? "x".repeat(501) : "Prefere o PDF" } };
    } else if (buying) {
      toolAnswer = { tool: "createOrder", reply: "O seu pedido já foi criado.",
        args: { productName: "Livro do piloto", quantity: message.includes("quatro") ? 4 : 1, paymentMethod } };
    }
    return res.end(JSON.stringify({ response: JSON.stringify(toolAnswer) }));
  }
  if (req.url.startsWith("/storage/v1/object/") && (req.method === "GET" || req.method === "POST")) {
    if (req.headers.authorization !== `Bearer ${serviceKey}`) return res.writeHead(403).end("{}");
    const objectPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname.slice("/storage/v1/object/".length));
    if (req.method === "GET") {
      const object = storedObjects.get(objectPath);
      if (!object) return res.writeHead(404).end("{}");
      downloadedObjects.push(objectPath);
      return res.writeHead(200, { "content-type": object.contentType, "content-length": object.bytes.length }).end(object.bytes);
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (objectPath.startsWith("sign/")) {
      if (!storedObjects.has(objectPath.slice(5))) return res.writeHead(404).end("{}");
      return res.end(JSON.stringify({ signedURL: `/object/${objectPath}?token=fixture-file-access` }));
    }
    const contentType = req.headers["content-type"] ?? "application/octet-stream";
    const bytes = Buffer.concat(chunks);
    if (contentType.startsWith("multipart/form-data")) {
      const fields = await new Response(bytes, { headers: { "content-type": contentType } }).formData();
      const file = [...fields.values()].find((value) => value instanceof Blob);
      if (!file) return res.writeHead(400).end("{}");
      storedObjects.set(objectPath, { bytes: Buffer.from(await file.arrayBuffer()), contentType: file.type });
    } else {
      storedObjects.set(objectPath, { bytes, contentType });
    }
    return res.end(JSON.stringify({ Key: objectPath }));
  }
  if (req.url.startsWith("/auth/v1/token") && req.method === "POST") {
    let input = "";
    for await (const chunk of req) input += chunk;
    const { email, password: supplied } = JSON.parse(input);
    const index = users.findIndex((user) => user.email === email);
    if (index < 0 || supplied !== password) return res.writeHead(400).end(JSON.stringify({ message: "Invalid fixture login" }));
    return res.end(JSON.stringify({ access_token: userTokens[index], refresh_token: "fixture-refresh", token_type: "bearer",
      expires_in: 3600, user: users[index] }));
  }
  if (req.url === "/auth/v1/user") {
    const index = userTokens.findIndex((value) => req.headers.authorization === `Bearer ${value}`);
    if (index >= 0) return res.end(JSON.stringify(users[index]));
    return res.writeHead(401).end(JSON.stringify({ message: "Invalid fixture session" }));
  }
  return res.writeHead(404).end("{}");
});

const sandbox = await mkdtemp(path.join(tmpdir(), "agentx-inbox-"));
const repo = process.cwd();
const fixtureServer = path.join(repo, "tests/integration/inbox-fixture-server.ts");
const tsx = path.join(repo, "node_modules/tsx/dist/cli.mjs");

async function start(port = 0) {
  const child = spawn(process.execPath, [tsx, fixtureServer], {
    cwd: sandbox,
    env: { ...process.env, NODE_ENV: "production", PORT: String(port), SUPABASE_URL: supabaseUrl,
      VITE_SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: serviceKey, VITE_SUPABASE_ANON_KEY: publicKey,
      GEMINI_API_KEY: "", ADMIN_EMAIL: "", INITIAL_SUPERADMIN_EMAIL: "",
      VITE_API_URL: "", DISABLE_WHATSAPP_RECONNECT: "true", DISABLE_SCHEDULER: "true", DISABLE_DIGITAL_DELIVERY_WORKER: "true" },
    stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
  const stopped = once(child, "exit");
  const outbound = [];
  child.on("message", (message) => { if (message.event === "outbound") outbound.push(message); });
  let logs = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => { logs = (logs + data).slice(-8000); });
  async function stop() {
    if (child.exitCode === null) child.kill("SIGTERM");
    const deadline = setTimeout(() => child.kill("SIGKILL"), 5000);
    try { await stopped; } finally { clearTimeout(deadline); }
  }
  async function simulate(event, details = {}) {
    const requestId = randomUUID();
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => { child.off("message", finish); reject(new Error(`Fixture timed out\n${logs}`)); }, 12000);
      function finish(message) {
        if (message.requestId !== requestId) return;
        clearTimeout(deadline);
        child.off("message", finish);
        if (message.ok) resolve();
        else reject(new Error(`Fixture event failed\n${logs}`));
      }
      child.on("message", finish);
      child.send({ event, requestId, ...details });
    });
  }
  for (let attempt = 0; attempt < 200; attempt++) {
    const match = /Server listening on port (\d+)/.exec(logs);
    if (match) return { port: Number(match[1]), base: `http://127.0.0.1:${match[1]}`, stop, simulate, outbound };
    if (child.exitCode !== null) break;
    await delay(100);
  }
  await stop();
  throw new Error(`AgentX failed to start\n${logs}`);
}

let app, browser, supabaseUrl;
try {
  await symlink(path.join(repo, "dist"), path.join(sandbox, "dist"), "dir");
  supabase.listen(0, "127.0.0.1");
  await once(supabase, "listening");
  supabaseUrl = `http://127.0.0.1:${supabase.address().port}`;
  for (let attempt = 0; attempt < 40; attempt++) {
    const response = await fetch(rest).catch(() => null);
    if (response?.ok) break;
    if (attempt === 39) throw new Error("PostgREST did not start");
    await delay(250);
  }

  app = await start();
  const readiness = await fetch(app.base + "/api/ready", { signal: AbortSignal.timeout(12000) });
  assert.equal(readiness.status, 200);
  assert.equal((await readiness.json()).ready, true);
  const api = (route, index = 0, body) => fetch(app.base + "/api" + route, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(index < 0 ? {} : { authorization: `Bearer ${userTokens[index]}` }) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(12000)
  });
  const call = (route, index, body) => api("/whatsapp" + route, index, body);
  const saveContact = (phone, index = 0, name = "Contacto guardado") => api("/contacts", index, { phone, name });
  assert.equal((await call("/chats", -1)).status, 401);
  const existingConnection = await call("/connect", 0, {});
  assert.equal(existingConnection.status, 200);
  assert.equal((await existingConnection.json()).status, "connected");
  if (fresh) {
    const operations = await api("/operations");
    assert.equal(operations.status, 200);
    const { modules } = await operations.json();
    for (const module of ["crm", "sales", "agenda", "bookings", "groups", "agent", "delivery"]) {
      assert.equal(modules[module], "ready", `Fresh installation must provision ${module}`);
    }
    const subscription = await api("/ai/subscription");
    assert.equal(subscription.status, 200);
    const { data } = await subscription.json();
    assert.equal(data.role, "user");
    assert.equal(data.plan, "Pro");
    assert.equal(data.subscription.plans.name, "Pro");
    assert.equal(data.planDetails.ai_enabled, true);

    const organization = await api("/v2/commerce/organizations", 0, { name: "Loja A", slug: "loja-a" });
    assert.equal(organization.status, 201, await organization.clone().text());
    const { id: organizationId } = (await organization.json()).data;
    assert.ok(organizationId);
    const ownOrganizations = await api("/v2/commerce/organizations");
    assert.equal(ownOrganizations.status, 200);
    assert.deepEqual((await ownOrganizations.json()).data.map(row => row.organization_id), [organizationId]);
    const otherOrganizations = await api("/v2/commerce/organizations", 1);
    assert.equal(otherOrganizations.status, 200);
    assert.deepEqual((await otherOrganizations.json()).data, []);
  }

  const historyContact = randomUUID();
  const fixtureHeaders = { authorization: `Bearer ${serviceKey}`, "content-type": "application/json" };
  const insertHistoryFixture = (table, body) => fetch(new URL(`/${table}`, rest), {
    method: "POST", headers: fixtureHeaders, body: JSON.stringify(body)
  });
  assert.equal((await insertHistoryFixture("contacts", { id: historyContact, user_id: owner, name: "Paginação", phone: "258881234000" })).status, 201);
  const sample = [null, null, "2026-01-01T12:00:00.123Z", "2026-01-01T12:00:00.123Z",
    "2026-01-01T12:00:00.123001Z", "2026-01-01T12:00:01Z"].map((timestamp, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
    user_id: owner, contact_id: historyContact, type: "inbound", text: `Página ${index}`, timestamp, is_read: false
  }));
  assert.equal((await insertHistoryFixture("messages", sample)).status, 201);
  const historyPath = `/chats/${historyContact}/messages`;
  async function readMessagePage(query, expectedRows, more, account = 0) {
    const response = await call(`${historyPath}?${query}`, account);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get("cache-control"), "no-store");
    const page = await response.json();
    assert.equal(page.success, true);
    assert.deepEqual(page.messages.map(({ id }) => id), expectedRows.map(({ id }) => id));
    assert.equal(page.hasMore, more);
    assert.deepEqual(page.messages.map(({ is_read }) => is_read), expectedRows.map(() => false));
    if (!expectedRows.length) {
      assert.equal(page.beforeCursor, null);
      assert.equal(page.afterCursor, null);
    }
    return page;
  }
  const newestPage = await readMessagePage("limit=2", sample.slice(4), true);
  const previousPage = await readMessagePage(`limit=2&before=${newestPage.beforeCursor}`, sample.slice(2, 4), true);
  const oldestPage = await readMessagePage(`limit=2&before=${previousPage.beforeCursor}`, sample.slice(0, 2), false);
  await readMessagePage(`before=${oldestPage.beforeCursor}`, [], false);
  await readMessagePage(`before=${oldestPage.afterCursor}`, sample.slice(0, 1), false);
  const firstCatchUp = await readMessagePage(`limit=2&after=${oldestPage.beforeCursor}`, sample.slice(1, 3), true);
  const secondCatchUp = await readMessagePage(`limit=2&after=${firstCatchUp.afterCursor}`, sample.slice(3, 5), true);
  await readMessagePage(`after=${secondCatchUp.afterCursor}`, sample.slice(5), false);
  await readMessagePage(`limit=2&after=${newestPage.afterCursor}`, [], false);
  await readMessagePage(`limit=2&before=${newestPage.beforeCursor}`, [], false, 1);
  assert.equal((await call(`${historyPath}?limit=2`, -1)).status, 401);
  await readMessagePage("limit=100", sample, false);
  const unpaginatedHistory = await (await call(historyPath)).json();
  assert.deepEqual(Object.keys(unpaginatedHistory), ["success", "messages"]);
  assert.equal(unpaginatedHistory.messages.length, sample.length);
  if (fresh) {
    const directHistory = new URL(`/messages?contact_id=eq.${historyContact}&select=id`, rest);
    for (const [index, expectedRows] of [[0, sample.length], [1, 0]]) {
      const asBrowser = await fetch(directHistory, { headers: { authorization: `Bearer ${userTokens[index]}` } });
      assert.equal(asBrowser.status, 200);
      assert.equal((await asBrowser.json()).length, expectedRows);
    }
  }

  const encodeTestCursor = (payload) => Buffer.from(JSON.stringify(payload)).toString("base64url");
  for (const invalidQuery of ["limit=0", "limit=101", "limit=2.5", "limit=2&limit=3", "before=%23", "after=",
    `before=${newestPage.beforeCursor}&after=${newestPage.afterCursor}`, `before[]=${newestPage.beforeCursor}`,
    `before=${encodeTestCursor(["2026-02-30T12:00:00Z", sample[0].id])}`,
    `before=${encodeTestCursor(["2026-01-01T12:00:00Z", `${sample[0].id}),timestamp.not.is.null`])}`,
    `before=${encodeTestCursor([`2026-01-01T12:00:00Z\",user_id.eq.${other}`, sample[0].id])}`]) {
    const response = await call(`${historyPath}?${invalidQuery}`);
    assert.equal(response.status, 400, `Invalid history query ${invalidQuery}: ${await response.text()}`);
  }
  assert.equal((await fetch(new URL(`/messages?contact_id=eq.${historyContact}`, rest),
    { method: "DELETE", headers: fixtureHeaders })).status, 204);
  assert.equal((await fetch(new URL(`/contacts?id=eq.${historyContact}`, rest), { method: "DELETE", headers: fixtureHeaders })).status, 204);
  console.log("Inbox pagination passed across timestamp ties, fractional seconds, legacy rows and authenticated tenant boundaries.");

  const legacyId = "00000000-0000-4000-8000-000000000013";
  const primaryId = "00000000-0000-4000-8000-000000000015";
  const duplicateId = "00000000-0000-4000-8000-000000000016";
  assert.equal((await saveContact("258849998888", -1)).status, 401);
  assert.equal((await saveContact("104928502847592@lid")).status, 400);
  const exactMatch = await saveContact("+258 85 777 7777");
  assert.equal(exactMatch.status, 200);
  assert.deepEqual((await exactMatch.json()).data,
    { id: primaryId, phone: "258857777777", name: "Contacto guardado", created: false });
  const exactRows = await fetch(new URL(`/contacts?user_id=eq.${owner}&phone=eq.258857777777&select=id,agentx_legacy_phone_duplicate&order=id`, rest),
    { headers: { authorization: `Bearer ${serviceKey}` } });
  assert.deepEqual(await exactRows.json(), [
    { id: primaryId, agentx_legacy_phone_duplicate: false },
    ...(!fresh ? [{ id: duplicateId, agentx_legacy_phone_duplicate: true }] : [])
  ]);
  const legacy = await saveContact("258849998888");
  assert.equal(legacy.status, 200);
  assert.deepEqual((await legacy.json()).data,
    { id: legacyId, phone: "258849998888", name: "Contacto guardado", created: false });
  if (!fresh) {
    const history = await call(`/chats/${duplicateId}/messages`);
    assert.equal((await history.json()).messages[0].msg_id, "legacy-duplicate-message");
    const { messages: legacyHistory } = await (await call("/chats/00000000-0000-4000-8000-000000000014/messages")).json();
    assert.equal(legacyHistory[0].msg_id, "legacy-contact-message");
  }
  const synced = await call("/sync-contacts", 0, {});
  assert.equal(synced.status, 200);
  assert.deepEqual(await synced.json(), {
    success: true, total: fresh ? 4 : 6, savedCount: 2, activeChatsCount: 0, cleanedCount: 0, withoutPhone: 1, failed: 0
  });
  const resolvedContact = await saveContact("83 123 4567");
  assert.equal(resolvedContact.status, 200);
  assert.equal((await resolvedContact.json()).data.phone, "258831234567");

  const otherAccount = await saveContact("0849998888", 1);
  assert.equal(otherAccount.status, 201);
  const otherCsvContactId = (await otherAccount.json()).data.id;
  assert.notEqual(otherCsvContactId, legacyId);

  const variants = await Promise.all([saveContact("+258 86 123 4567"), saveContact("(86) 123-4567")]);
  assert.deepEqual(variants.map((result) => result.status).sort(), [200, 201]);
  const variantRows = await Promise.all(variants.map(async (result) => (await result.json()).data));
  assert.equal(variantRows[0].id, variantRows[1].id);
  assert.ok(variantRows.every(({ phone }) => phone === "258861234567"));

  const importResult = await api("/contacts/import", 0, {
    csv: [
      "\uFEFFNome;Telefone", "Contacto legado;00258 84 999 8888", '"Pessoa, Lda";258851234567:2@s.whatsapp.net',
      "Apelido repetido;85 123 4567", "LID;104928502847592@lid", "LID sem sufixo;104928502847592",
      "Grupo;12036302918234@g.us"
    ].join("\r\n")
  });
  assert.equal(importResult.status, 200);
  assert.deepEqual((await importResult.json()).data, { created: 1, updated: 1, invalid: 3, duplicates: 1, limited: 0 });
  const stored = await fetch(new URL(`/contacts?user_id=eq.${owner}&phone=in.(258851234567,258861234567)&select=name,phone&order=phone`, rest),
    { headers: { authorization: `Bearer ${serviceKey}` } });
  assert.deepEqual(await stored.json(), [
    { name: "Pessoa, Lda", phone: "258851234567" }, { name: "Contacto guardado", phone: "258861234567" }
  ]);
  const directDuplicate = await fetch(new URL("/contacts", rest), {
    method: "POST", headers: { authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
    body: JSON.stringify({ user_id: owner, name: "Duplicado", phone: "0861234567", agentx_legacy_phone_duplicate: true })
  });
  assert.equal(directDuplicate.status, 409);
  const changeDuplicate = await fetch(new URL(`/contacts?id=eq.${fresh ? primaryId : duplicateId}`, rest), {
    method: "PATCH", headers: { authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
    body: JSON.stringify({ phone: "0861234567" })
  });
  assert.equal(changeDuplicate.status, 409);

  let page;
  if (process.env.AGENTX_INBOX_BROWSER === "1") {
    const { chromium } = createRequire(import.meta.url)("playwright");
    browser = await chromium.launch({ executablePath: process.env.AGENTX_TEST_CHROMIUM || "/usr/bin/chromium",
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });

    const stalledSession = await browser.newPage();
    await stalledSession.addInitScript(({ user, accessToken }) => {
      localStorage.setItem("sb-127-auth-token", JSON.stringify({
        user, access_token: accessToken, refresh_token: "stalled-refresh", expires_at: 1
      }));
    }, { user: users[0], accessToken: userTokens[0] });
    let refreshStarted = false;
    await stalledSession.route("**/auth/v1/token?grant_type=refresh_token", () => { refreshStarted = true; });
    await stalledSession.goto(app.base + "/login");
    await stalledSession.getByRole("heading", { name: "Bem-vindo de volta" }).waitFor({ timeout: 7_000 });
    assert.equal(refreshStarted, true);
    await stalledSession.close();

    page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on("pageerror", (error) => console.error("Inbox browser error:", error.message));
    await page.goto(app.base + "/login");
    await page.locator('input[type="email"]').fill(users[0].email);
    await page.locator('input[type="password"]').fill(password);
    const signIn = "**/auth/v1/token?grant_type=password";
    await page.route(signIn, () => {});
    await page.locator('button[type="submit"]').click();
    await page.getByRole("alert").getByText("Não foi possível contactar o serviço de autenticação.", { exact: false })
      .waitFor({ timeout: 12_000 });
    await page.unroute(signIn);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL("**/dashboard", { timeout: 15000 });
    console.log("Browser login passed with stalled session recovery, auth timeout and successful retry.");
    await page.goto(app.base + "/contacts");
    await page.getByRole("button", { name: "Novo Contacto" }).click();
    await page.getByPlaceholder("Nome do cliente").fill("Contacto do navegador");
    await page.getByPlaceholder("84 88 5828 8").fill("87 111 2222");
    const [saved] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/api/contacts")),
      page.getByRole("button", { name: "Guardar" }).click()
    ]);
    assert.equal(saved.status(), 201);
    await page.getByText("Contacto do navegador", { exact: true }).waitFor();

    const [imported] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/api/contacts/import")),
      page.locator('input[type="file"][accept=".csv"]').setInputFiles({
        name: "contactos.csv", mimeType: "text/csv",
        buffer: Buffer.from("Nome,Telefone\nContacto atualizado,+258 87 111 2222\nRepetido,871112222")
      })
    ]);
    assert.deepEqual((await imported.json()).data, { created: 0, updated: 1, invalid: 0, duplicates: 1, limited: 0 });
    await page.getByText("Contacto atualizado", { exact: true }).waitFor();
    assert.equal(await page.getByText("Contacto do navegador", { exact: true }).count(), 0);
    await page.goto(app.base + "/messages");
    await page.getByRole("button", { name: /Contacto com LID/ }).waitFor({ timeout: 15000 });
  }

  await app.simulate("incoming");
  const { chats } = await (await call("/chats")).json();
  const contact = chats.find((chat) => chat.name === "Cliente de teste");
  assert.ok(contact);
  assert.equal(contact.phone, "258840000001");
  assert.ok(!chats.some((chat) => chat.id === otherContact));

  const foreignSend = await call("/send", 0, { contactId: otherContact, jid: "258870000001@s.whatsapp.net", text: "Teste inválido" });
  assert.equal(foreignSend.status, 404);
  assert.equal(app.outbound.length, 0);
  assert.deepEqual((await (await call(`/chats/${contact.id}/messages`, 1)).json()).messages, []);

  const reply = "Olá, o artigo custa 500 MT.";
  if (page) {
    await page.getByRole("button", { name: /Cliente de teste/ }).click({ timeout: 15000 });
    const history = page.getByRole("log", { name: "Histórico da conversa" });
    await history.getByText("Olá, gostaria de saber o preço.", { exact: true }).waitFor();
    await page.getByPlaceholder("Digite uma mensagem...").fill(reply);
    const [response] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/api/whatsapp/send")),
      page.getByRole("button", { name: "Enviar mensagem" }).click({ timeout: 8000 })
    ]);
    assert.equal(response.status(), 200);
    assert.equal((await response.json()).historySaved, true);
    await history.getByText(reply, { exact: true }).waitFor();
  } else {
    const response = await call("/send", 0, { contactId: contact.id, text: reply });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).historySaved, true);
  }
  assert.equal(app.outbound.length, 1);
  assert.equal(app.outbound[0].jid, "258840000001@s.whatsapp.net");

  await app.simulate("unconfirmed");
  const uncertain = await call("/send", 0, { contactId: contact.id, text: "Mensagem sem confirmação" });
  assert.equal(uncertain.status, 502);

  const port = app.port;
  await app.stop();
  app = await start(port);
  await app.simulate("incoming"); // WhatsApp can replay the same event on reconnect.
  const { messages } = await (await call(`/chats/${contact.id}/messages`)).json();
  assert.equal(messages.length, 2);
  assert.ok(messages.some((message) => message.msg_id === "fixture-inbound-1"));
  assert.ok(messages.some((message) => /^fixture-outbound-/.test(message.msg_id)));
  if (page) {
    await page.goto(app.base + "/messages");
    await page.getByRole("button", { name: /Cliente de teste/ }).click({ timeout: 15000 });
    const history = page.getByRole("log", { name: "Histórico da conversa" });
    await history.getByText("Olá, gostaria de saber o preço.", { exact: true }).waitFor();
    await history.getByText(reply, { exact: true }).waitFor();
    assert.equal(await history.getByText(reply, { exact: true }).count(), 1);
  }

  const seller = "/commerce/seller";
  const ownerSettings = {
    payment_method: "mpesa",
    payment_destinations: {
      mpesa: { recipient: "84 000 0003", name: "Loja de teste" },
      emola: { recipient: "87 000 0006", name: "Loja de teste" },
      bank_transfer: { recipient: "000111222333", name: "Loja de teste" }
    },
    notification_phone: "85 000 0004"
  };
  const configure = (settings = ownerSettings) => fetch(app.base + "/api" + seller + "/settings", {
    method: "PUT", headers: { authorization: `Bearer ${userTokens[0]}`, "content-type": "application/json" },
    body: JSON.stringify(settings)
  });
  assert.equal((await api(seller, -1)).status, 401);
  assert.equal((await configure({ ...ownerSettings, payment_destinations: {
    ...ownerSettings.payment_destinations, mpesa: { recipient: "123@lid", name: "Loja de teste" }
  } })).status, 400);

  if (page) {
    await page.goto(app.base + "/seller");
    await page.getByRole("heading", { name: "Vendedor", exact: true }).waitFor();
    for (const [method, { recipient, name }] of Object.entries(ownerSettings.payment_destinations)) {
      const groupName = { mpesa: "M-Pesa", emola: "e-Mola", bank_transfer: "Transferência bancária" }[method];
      const group = page.getByRole("group", { name: groupName, exact: true });
      await group.getByRole("textbox", { name: method === "bank_transfer" ? "Conta ou NIB" : "Número", exact: true }).fill(recipient);
      await group.getByRole("textbox", { name: "Nome do titular", exact: true }).fill(name);
    }
    await page.getByRole("textbox", { name: /WhatsApp para avisos/ }).fill(ownerSettings.notification_phone);
    await page.getByRole("button", { name: "Guardar métodos" }).click();
    await page.getByText("+258850000004", { exact: true }).waitFor();
  } else {
    assert.equal((await configure()).status, 200);
  }
  const otherSettings = (await (await api(seller, 1)).json()).data.settings;
  assert.equal(otherSettings.payment_method, "emola");
  assert.deepEqual(otherSettings.payment_destinations, { emola: { recipient: "258870000005", name: "Loja anterior" } });

  const storageAuth = { authorization: `Bearer ${serviceKey}`, "content-type": "application/json" };
  const agent = await fetch(new URL("/agents", rest), { method: "POST", headers: storageAuth,
    body: JSON.stringify({ user_id: owner, provider: "custom", api_url: supabaseUrl + "/fixture-ai", is_active: true, specialization: "vendas" }) });
  assert.equal(agent.status, 201);

  const productBody = new FormData();
  for (const [key, value] of Object.entries({ name: "Livro do piloto", price: "250", stock: "3", type: "digital" })) productBody.set(key, value);
  productBody.set("file", new Blob([pdfBytes], { type: "application/pdf" }), "livro.pdf");
  const productResponse = await fetch(app.base + "/api/commerce/products", { method: "POST",
    headers: { authorization: `Bearer ${userTokens[0]}` }, body: productBody });
  assert.equal(productResponse.status, 200);
  const product = (await productResponse.json()).data;
  assert.equal(storedObjects.size, 1);
  assert.deepEqual(storedObjects.values().next().value.bytes, pdfBytes);

  const identity = { jid: "109876543211124@lid", altJid: "258840000002@s.whatsapp.net" };
  const sell = (text, messageId) => app.simulate("sales", { text, messageId, ...identity });
  const read = async (resource, filter = "") => {
    const response = await fetch(new URL("/" + resource + filter, rest), { headers: storageAuth });
    assert.equal(response.status, 200);
    return response.json();
  };
  const overview = (await (await api(seller)).json()).data;
  assert.equal(overview.readyProducts, 1);
  assert.equal(overview.agentActive, true);
  assert.equal(overview.whatsappConnected, true);
  await app.simulate("inbound", { text: "Bom dia", messageId: "inbound-before-ai", ...identity });
  const [passiveLead] = await read("leads", fresh ? `?user_id=eq.${owner}&phone=eq.258840000002` : `?id=eq.${previousLeadId}`);
  assert.ok(passiveLead.contact_id);
  assert.equal(passiveLead.last_message, "Bom dia");
  assert.equal(passiveLead.stage, "novo");
  await app.simulate("inbound", { text: "Bom dia", messageId: "lid-without-phone", jid: "109876543211125@lid" });
  const [lidContact] = await read("contacts", "?lid=eq.109876543211125");
  assert.equal(lidContact.phone, null);
  assert.deepEqual(await read("leads", `?contact_id=eq.${lidContact.id}`), []);

  await sell("Quanto custa o livro?", "catalogue-one");
  assert.match(app.outbound.at(-1).content.text, /Livro do piloto.*250 MT/);
  assert.doesNotMatch(app.outbound.at(-1).content.text, /fixture-file-access|agentx-product-files/);
  await sell("Tenho interesse no livro.", "qualify-one");
  const [lead] = await read("leads", `?id=eq.${passiveLead.id}`);
  assert.equal(lead.contact_id, passiveLead.contact_id);
  assert.equal(lead.interest_level, "alto");
  if (!fresh) assert.match(lead.notes, /Nota histórica da loja A/);
  assert.match(lead.notes, /Prefere o PDF/);
  assert.match(lead.last_action, /interesse|qualifica/i);
  assert.match(app.outbound.at(-1).content.text, /Registei o teu interesse/);
  assert.doesNotMatch(app.outbound.at(-1).content.text, /falha|last_action|qualifyLead/i);
  const [qualifiedContact] = await read("contacts", `?id=eq.${lead.contact_id}`);
  assert.ok(qualifiedContact.tags.includes("Interessado no livro"));
  if (!fresh) assert.equal((await read("leads", `?id=eq.${duplicateLeadId}`))[0].notes, "Nota do duplicado");
  assert.equal((await read("leads", `?id=eq.${foreignLeadId}`))[0].notes, "Nota privada da loja B");
  const ownerLeadCount = fresh ? 1 : 2;
  assert.equal((await read("leads", `?user_id=eq.${owner}`)).length, ownerLeadCount);
  const readAsOther = await fetch(new URL("/leads?select=id", rest),
    { headers: { authorization: `Bearer ${userTokens[1]}` } });
  assert.equal(readAsOther.status, 200);
  assert.deepEqual(await readAsOther.json(), [{ id: foreignLeadId }]);

  await sell("Tenho interesse e indico uma nota no limite.", "qualify-note-limit");
  const [updatedNotes] = await read("leads", `?id=eq.${lead.id}&select=notes`);
  assert.match(updatedNotes.notes, /Prefere o PDF/);
  assert.equal(updatedNotes.notes.split("\n").at(-1).length, 500);
  await sell("Quero comprar quatro livros.", "insufficient-stock");
  assert.match(app.outbound.at(-1).content.text, /indisponível na quantidade pedida/i);
  assert.doesNotMatch(app.outbound.at(-1).content.text, /pedido já foi criado/i);
  assert.deepEqual((await (await api(seller)).json()).data.orders, []);
  assert.equal((await read("products", `?id=eq.${product.id}`))[0].stock, 3);

  await sell("Quero comprar o livro.", "purchase-one");
  const [order] = (await (await api(seller)).json()).data.orders;
  assert.equal(order.status, "awaiting_payment");
  assert.match(app.outbound.at(-1).content.text, /250 MT.*258840000003/);
  const [createdOrder] = await read("orders", `?id=eq.${order.id}`);
  assert.equal(createdOrder.lead_id, lead.id);
  assert.deepEqual(createdOrder.seller_payment, { method: "mpesa", recipient: "258840000003", name: "Loja de teste" });
  assert.equal((await read("products", `?id=eq.${product.id}`))[0].stock, 3);
  const changedSettings = { ...ownerSettings, payment_destinations: {
    ...ownerSettings.payment_destinations, mpesa: { recipient: "84 000 0005", name: "Loja de teste" }
  } };
  assert.equal((await configure(changedSettings)).status, 200);
  await sell("Quero comprar o livro.", "purchase-one");
  assert.match(app.outbound.at(-1).content.text, /258840000003/);
  await sell(`Qual é o número de M-Pesa para pagar o pedido ${order.order_number}?`, "purchase-payment-details");
  const paymentReply = app.outbound.at(-1);
  assert.equal(paymentReply.jid, identity.jid);
  assert.ok(paymentReply.content.text.includes(order.order_number));
  assert.match(paymentReply.content.text, /250\s+MT/);
  assert.match(paymentReply.content.text, /M-Pesa.*258840000003.*Loja de teste/i);
  assert.doesNotMatch(paymentReply.content.text, /258840000005|258850000004|258870000006|000111222333/);
  await sell("E qual é o número?", "purchase-payment-details-follow-up");
  assert.match(app.outbound.at(-1).content.text, /M-Pesa.*258840000003.*Loja de teste/i);
  await app.simulate("sales", {
    jid: "258840000010@s.whatsapp.net", text: `Qual é o número de M-Pesa para pagar o pedido ${order.order_number}?`,
    messageId: "purchase-payment-details-wrong-buyer"
  });
  assert.equal(app.outbound.at(-1).jid, "258840000010@s.whatsapp.net");
  assert.doesNotMatch(app.outbound.at(-1).content.text, /258840000003|258840000005|258850000004|258870000006|000111222333/);
  assert.equal((await read("leads", `?user_id=eq.${owner}&phone=eq.258840000010`)).length, 1);
  assert.equal((await (await api(seller)).json()).data.orders.length, 1);
  assert.equal((await api(`/commerce/orders/${order.id}/delivery`, 0, {})).status, 503);

  const approve = (id, data, index = 0) => api(`/commerce/orders/${id}/approve`, index, data);
  const approval = { settlementVerified: true };
  assert.equal((await approve(order.id, {})).status, 400);
  assert.equal((await approve(order.id, approval)).status, 409);

  const notifications = () => app.outbound.filter((message) => message.jid === "258850000004@s.whatsapp.net").length;
  const wrongRecipient = "Comprovativo M-Pesa. Recebeu 250.00 MT de 841234567. Transaccao: AGWRONG01. Titular destinatário: Outra Pessoa.";
  await sell(`${wrongRecipient} Pedido ${order.order_number}`, "proof-wrong-recipient");
  const [mismatchedProof] = await read("payment_verifications", "?source_message_id=eq.proof-wrong-recipient");
  assert.equal(mismatchedProof.extracted_data.recipientMatch, "mismatch");
  assert.equal(mismatchedProof.status, "pending");
  assert.equal((await approve(order.id, { ...approval, proofId: mismatchedProof.id })).status, 409);
  assert.equal((await read("orders", `?id=eq.${order.id}`))[0].status, "verification_pending");
  assert.equal((await read("products", `?id=eq.${product.id}`))[0].stock, 3);
  assert.equal(sentDocuments(app.outbound).length, 0);
  assert.equal(downloadedObjects.length, 0);

  const priorNotifications = notifications();
  const receipt = "Confirmado ABZA12CD34. Transferiste 250.00MT e a taxa foi de 0.00MT para 258840000003 - Loja de teste aos 25/11/26 as 8:47 PM. O teu novo saldo M-Pesa e de 0.00MT. Continua a transferir SEM TAXAS de M-Pesa para M-Pesa. Em caso de duvida, liga 100.";
  const aiBeforeMpesa = aiRequests;
  await sell(receipt, "proof-one");
  await sell(receipt, "proof-one");
  const [correctProof] = await read("payment_verifications", "?source_message_id=eq.proof-one");
  assert.equal(correctProof.status, "pending");
  assert.equal(correctProof.proof_type, "sms");
  assert.equal(correctProof.provider, "mpesa");
  assert.equal(correctProof.transaction_reference, "ABZA12CD34");
  assert.equal(correctProof.amount, 250);
  assert.equal(correctProof.extracted_data.currency, "MT");
  assert.equal(correctProof.extracted_data.recipientAccount, "258840000003");
  assert.equal(correctProof.extracted_data.recipientName, "Loja de teste");
  assert.equal(correctProof.extracted_data.recipientMatch, "match");
  assert.equal(correctProof.extracted_data.date, "25/11/2026");
  assert.equal(correctProof.extracted_data.time, "20:47");
  assert.equal(correctProof.sender_phone, "");
  assert.equal(correctProof.sender_name, "");
  assert.equal(aiRequests, aiBeforeMpesa);
  assert.equal((await read("orders", `?id=eq.${order.id}`))[0].status, "verification_pending");
  assert.equal((await read("payment_verifications", `?order_id=eq.${order.id}`)).length, 2);
  assert.equal((await (await api(seller)).json()).data.pendingReviews, 1);
  assert.equal(notifications(), priorNotifications + 1);
  assert.equal(sentDocuments(app.outbound).length, 0);
  assert.equal(downloadedObjects.length, 0);
  assert.equal((await read("products", `?id=eq.${product.id}`))[0].stock, 3);
  assert.match(app.outbound.at(-1).content.text, /aguarda.*confirmação|validação humana/i);

  const confirmCorrectProof = { ...approval, proofId: correctProof.id };
  assert.equal((await approve(order.id, confirmCorrectProof, 1)).status, 404);
  assert.equal((await approve(order.id, { ...confirmCorrectProof, settlementAmount: "25" })).status, 409);
  if (page) {
    await page.goto(app.base + "/seller");
    await page.getByRole("link", { name: /Comprovativos pendentes/ }).click();
    await page.getByText("Destinatário divergente", { exact: true }).waitFor();
    const wrongCard = page.getByRole("heading", { name: /AGWRONG01/ }).locator("xpath=../..");
    assert.equal(await wrongCard.getByRole("button", { name: /Aprovar/i }).count(), 0);
    const correctCard = page.getByRole("heading", { name: /ABZA12CD34/ }).locator("xpath=../..");
    await correctCard.getByRole("button", { name: /Aprovar/i }).click();
    const dialog = page.getByRole("dialog");
    assert.equal(await dialog.getByRole("textbox", { name: /Referência oficial da transação|Valor recebido/i }).count(), 0);
    await dialog.getByRole("checkbox", { name: "Confirmei no prestador o recebimento deste valor na conta da loja." }).check();
    const [confirmed] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/approve")),
      dialog.getByRole("button", { name: "Confirmar pagamento" }).click()
    ]);
    assert.equal(confirmed.status(), 200);
    assert.deepEqual(confirmed.request().postDataJSON(), confirmCorrectProof);
    assert.equal((await confirmed.json()).fulfillment.delivered, true);
  } else {
    const attempts = await Promise.all([approve(order.id, confirmCorrectProof), approve(order.id, confirmCorrectProof)]);
    assert.ok(attempts.every((response) => response.status === 200));
  }
  assert.equal((await approve(order.id, confirmCorrectProof)).status, 200);
  assert.equal((await read("payment_verifications", `?id=eq.${correctProof.id}`))[0].status, "approved");
  assert.equal((await read("payment_verifications", `?id=eq.${mismatchedProof.id}`))[0].status, "rejected");
  assert.equal((await read("orders", `?id=eq.${order.id}`))[0].payment_reference, "ABZA12CD34");
  const documents = sentDocuments(app.outbound);
  assert.equal(documents.length, 1);
  assert.equal(documents[0].jid, "258840000002@s.whatsapp.net");
  assert.equal(documents[0].content.fileName, "livro.pdf");
  assert.equal(documents[0].content.mimetype, "application/pdf");
  assert.deepEqual(Buffer.from(documents[0].content.document.data), pdfBytes);
  assert.match(documents[0].content.caption, /Pagamento confirmado/i);
  const [documentMessage] = await read("messages", `?contact_id=eq.${lead.contact_id}&type=eq.outbound&media_type=eq.document`);
  assert.equal(documentMessage.media_filename, "livro.pdf");
  assert.equal(documentMessage.media_mimetype, "application/pdf");
  assert.equal(documentMessage.media_url, null);
  assert.ok(downloadedObjects.length > 0);
  assert.ok(downloadedObjects.every((objectPath) => objectPath === `agentx-product-files/${product.deliverable_path}`));
  assert.ok(!app.outbound.some((message) => /fixture-file-access|storage\/v1/.test(JSON.stringify(message.content))));
  assert.equal((await read("products", `?id=eq.${product.id}`))[0].stock, 2);
  assert.equal((await read("leads", `?id=eq.${lead.id}`))[0].stage, "venda_fechada");
  assert.equal((await (await api(seller)).json()).data.orders.find(({ id }) => id === order.id).status, "fulfilled");
  const manual = { phone: "84 000 0002", contactId: lead.contact_id, name: "Cliente atualizado", value: 300 };
  assert.equal((await api("/leads", -1, manual)).status, 401);
  assert.equal((await api("/leads", 0, { ...manual, contactId: otherContact })).status, 404);
  assert.equal((await api("/leads", 0, { ...manual, phone: "258850000000" })).status, 400);
  const manualSave = await api("/leads", 0, { ...manual, userId: other });
  assert.equal(manualSave.status, 200);
  const manualLead = (await manualSave.json()).data;
  assert.equal(manualLead.id, lead.id);
  assert.equal(manualLead.stage, "venda_fechada");
  assert.equal(manualLead.name, manual.name);
  assert.equal(manualLead.value, manual.value);
  assert.match(manualLead.notes, /Prefere o PDF/);
  assert.equal((await read("leads", `?user_id=eq.${owner}`)).length, ownerLeadCount + 1);
  if (page) {
    await page.goto(app.base + `/leads?id=${lead.id}`);
    await page.getByRole("heading", { name: "Cliente atualizado", exact: true }).waitFor();
    await page.getByText("Interesse · alto", { exact: true }).waitFor();
    assert.match(await page.getByPlaceholder("Detalhes da proposta, condições negociadas, prazos...").inputValue(), /Prefere o PDF/);
  }

  await sell("Quero comprar mais um livro.", "purchase-two");
  const secondOrder = (await (await api(seller)).json()).data.orders.find(({ id }) => id !== order.id);
  assert.match(app.outbound.at(-1).content.text, /258840000005/);
  const secondReceipt = receipt.replace("258840000003", "258840000005");
  await sell(`${secondReceipt} Pedido ${secondOrder.order_number}`, "proof-two");
  const [duplicateProof] = await read("payment_verifications", "?source_message_id=eq.proof-two");
  assert.equal(duplicateProof.extracted_data.recipientMatch, "match");
  assert.equal((await approve(secondOrder.id, { ...approval, proofId: duplicateProof.id })).status, 409);
  await sell(`${secondReceipt.replace("ABZA12CD34", "ABZA12CD35")} Pedido ${secondOrder.order_number}`, "proof-two-alternative");
  const [alternativeProof] = await read("payment_verifications", "?source_message_id=eq.proof-two-alternative");
  const repliesBeforeRejectingOne = app.outbound.length;
  const rejectedProof = await api(`/commerce/orders/${secondOrder.id}/reject`, 0,
    { reason: "Referência já utilizada", proofId: duplicateProof.id });
  assert.equal(rejectedProof.status, 200);
  assert.equal((await read("payment_verifications", `?id=eq.${duplicateProof.id}`))[0].status, "rejected");
  assert.equal((await read("payment_verifications", `?id=eq.${alternativeProof.id}`))[0].status, "pending");
  assert.equal((await read("orders", `?id=eq.${secondOrder.id}`))[0].status, "verification_pending");
  assert.equal(app.outbound.length, repliesBeforeRejectingOne);
  assert.equal((await api(`/commerce/orders/${secondOrder.id}/reject`, 0, { reason: "Referência já utilizada" })).status, 200);
  assert.equal((await read("orders", `?id=eq.${secondOrder.id}`))[0].status, "rejected");
  assert.equal((await read("products", `?id=eq.${product.id}`))[0].stock, 2);
  assert.equal(sentDocuments(app.outbound).length, 1);

  await sell("Quero comprar um livro por e-Mola.", "purchase-emola");
  const [emolaOrder] = await read("orders", "?source_message_id=eq.purchase-emola");
  assert.equal(emolaOrder.payment_method, "emola");
  assert.equal(emolaOrder.seller_payment.recipient, "258870000006");
  assert.match(app.outbound.at(-1).content.text, /e-Mola.*258870000006/i);
  const emolaProofText = "Comprovativo e-Mola. Recebeu 250.00 MT de 871234567. Beneficiário: Loja de teste.";
  await sell(`${emolaProofText} Pedido ${emolaOrder.order_number}`, "proof-emola-no-reference");
  const [emolaProof] = await read("payment_verifications", "?source_message_id=eq.proof-emola-no-reference");
  assert.ok(!emolaProof.transaction_reference);
  assert.doesNotMatch(app.outbound.at(-1).content.text, /pagamento já foi confirmado/i);

  const filePath = `agentx-product-files/${product.deliverable_path}`;
  const file = storedObjects.get(filePath);
  storedObjects.delete(filePath);
  const emolaConfirmed = await approve(emolaOrder.id, { ...approval, proofId: emolaProof.id });
  assert.equal(emolaConfirmed.status, 200);
  assert.equal((await emolaConfirmed.json()).fulfillment.delivered, false);
  assert.equal((await read("orders", `?id=eq.${emolaOrder.id}`))[0].status, "paid");
  assert.equal(sentDocuments(app.outbound).length, 1);
  storedObjects.set(filePath, file);
  const completedDelivery = await api(`/commerce/orders/${emolaOrder.id}/delivery`, 0, {});
  assert.equal(completedDelivery.status, 200);
  assert.equal((await completedDelivery.json()).delivered, true);
  assert.equal((await read("orders", `?id=eq.${emolaOrder.id}`))[0].status, "fulfilled");
  assert.equal(sentDocuments(app.outbound).length, 2);
  assert.equal((await read("products", `?id=eq.${product.id}`))[0].stock, 1);

  await sell("Quero comprar por transferência bancária.", "purchase-bank");
  const [bankOrder] = await read("orders", "?source_message_id=eq.purchase-bank");
  assert.equal(bankOrder.status, "awaiting_payment");
  assert.equal(bankOrder.payment_method, "bank_transfer");
  assert.equal(bankOrder.seller_payment.recipient, "000111222333");
  assert.match(app.outbound.at(-1).content.text, /transferência bancária.*000111222333/i);
  assert.equal(sentDocuments(app.outbound).length, 2);

  aiEndpointAvailable = false;
  const outageIdentity = { jid: "258840000007@s.whatsapp.net" };
  await app.simulate("sales", { ...outageIdentity, text: "Quanto custa o Livro do piloto e aceitam M-Pesa?", messageId: "outage-catalogue" });
  const catalogueReply = app.outbound.at(-1);
  assert.equal(catalogueReply.jid, outageIdentity.jid);
  assert.match(catalogueReply.content.text, /Livro do piloto.*250\s+MT.*1 em stock/);
  for (const label of [/M-Pesa/i, /e-Mola/i, /transferência bancária/i]) assert.match(catalogueReply.content.text, label);
  assert.doesNotMatch(catalogueReply.content.text, /258840000005|258850000004|258870000006|000111222333/);
  const [catalogueContact] = await read("contacts", "?phone=eq.258840000007");
  assert.equal(catalogueContact.ai_paused, false);
  assert.deepEqual(await read("orders", "?source_message_id=eq.outage-catalogue"), []);
  assert.deepEqual(await read("agentx_human_handoffs", `?contact_id=eq.${catalogueContact.id}`), []);

  const handoffAdmin = "258850000011";
  assert.equal((await api("/ai/profile", 0, { phone: "+258 85 000 0011", admin_phones: "258850000012" })).status, 200);
  await app.simulate("sales", { ...outageIdentity, text: "Quero falar com uma pessoa.", messageId: "outage-human-request" });
  const requesterReply = app.outbound.findLast((message) => message.jid === outageIdentity.jid);
  assert.match(requesterReply?.content.text, /encaminh|equipa/i);
  const [escalatedContact] = await read("contacts", `?id=eq.${catalogueContact.id}`);
  assert.equal(escalatedContact.ai_paused, true);
  assert.ok(escalatedContact.ai_paused_at);
  const handoffs = await read("agentx_human_handoffs", `?contact_id=eq.${catalogueContact.id}`);
  assert.equal(handoffs.length, 1);
  assert.equal(handoffs[0].user_id, owner);
  assert.equal(handoffs[0].cause, "requested");
  assert.equal(handoffs[0].source_message_id, "outage-human-request");
  assert.equal(handoffs[0].paused_at, escalatedContact.ai_paused_at);
  assert.deepEqual(await read("orders", "?source_message_id=eq.outage-human-request"), []);

  await app.simulate("handoffs");
  let [deliveredHandoff] = await read("agentx_human_handoffs", `?id=eq.${handoffs[0].id}`);
  for (let attempt = 0; attempt < 20 && deliveredHandoff.status === "sending"; attempt++) {
    await delay(100);
    [deliveredHandoff] = await read("agentx_human_handoffs", `?id=eq.${handoffs[0].id}`);
  }
  assert.equal(deliveredHandoff.status, "sent");
  assert.match(deliveredHandoff.whatsapp_message_id, /^fixture-outbound-/);
  await app.simulate("handoffs");
  const handoffAlerts = app.outbound.filter((message) => /à espera de atendimento humano/i.test(message.content.text ?? ""));
  assert.equal(handoffAlerts.length, 1);
  assert.equal(handoffAlerts[0].jid, `${handoffAdmin}@s.whatsapp.net`);
  assert.equal(handoffAlerts[0].userId, owner);
  assert.doesNotMatch(handoffAlerts[0].content.text, /258840000007|Quero falar com uma pessoa/);

  const smsIdentity = { jid: "258840000008@s.whatsapp.net" };
  aiEndpointAvailable = true;
  await app.simulate("sales", { ...smsIdentity, text: "Quero comprar um livro por e-Mola.", messageId: "purchase-emola-sms" });
  const [smsOrder] = await read("orders", "?source_message_id=eq.purchase-emola-sms");
  assert.equal(smsOrder.status, "awaiting_payment");
  assert.equal(smsOrder.payment_method, "emola");

  const sms = "D da transacao PP261125.2001.i00000. Transferiste 250.00MT para conta 870000006, nome: LOJA DE TESTE as 20:01:33 de 25/11/2026. Taxa: 0.00MT. O saldo da tua conta e xxxxMT. Conteudo: megas.";
  const documentsBeforeSms = sentDocuments(app.outbound).length;
  const downloadsBeforeSms = downloadedObjects.length;
  const notificationsBeforeSms = notifications();
  const aiBeforeSms = aiRequests;
  aiEndpointAvailable = false;
  await app.simulate("sales", { ...smsIdentity, text: sms, messageId: "proof-emola-outgoing-sms" });
  assert.equal(aiRequests, aiBeforeSms);
  const [smsProof] = await read("payment_verifications", "?source_message_id=eq.proof-emola-outgoing-sms");
  assert.equal(smsProof.order_id, smsOrder.id);
  assert.equal(smsProof.proof_type, "sms");
  assert.equal(smsProof.status, "pending");
  assert.equal(smsProof.provider, "emola");
  assert.equal(smsProof.transaction_reference, "PP261125.2001.I00000");
  assert.equal(smsProof.amount, 250);
  assert.equal(smsProof.extracted_data.recipientAccount, "870000006");
  assert.equal(smsProof.extracted_data.recipientName, "LOJA DE TESTE");
  assert.equal(smsProof.extracted_data.recipientMatch, "match");
  assert.equal(smsProof.extracted_data.time, "20:01:33");
  assert.equal(smsProof.extracted_data.date, "25/11/2026");
  assert.equal((await read("orders", `?id=eq.${smsOrder.id}`))[0].status, "verification_pending");
  assert.equal((await approve(smsOrder.id, { proofId: smsProof.id })).status, 400);
  assert.equal(notifications(), notificationsBeforeSms + 1);
  assert.equal(sentDocuments(app.outbound).length, documentsBeforeSms);
  assert.equal(downloadedObjects.length, downloadsBeforeSms);
  assert.equal((await read("products", `?id=eq.${product.id}`))[0].stock, 1);
  assert.match(app.outbound.at(-1).content.text, /aguarda.*confirmação/i);

  const smsApproval = await approve(smsOrder.id, { ...approval, proofId: smsProof.id });
  assert.equal(smsApproval.status, 200);
  assert.equal((await smsApproval.json()).fulfillment.delivered, true);
  assert.equal((await read("payment_verifications", `?id=eq.${smsProof.id}`))[0].status, "approved");
  const [fulfilledSmsOrder] = await read("orders", `?id=eq.${smsOrder.id}`);
  assert.equal(fulfilledSmsOrder.status, "fulfilled");
  assert.equal(fulfilledSmsOrder.payment_reference, "PP261125.2001.I00000");
  assert.equal(sentDocuments(app.outbound).length, documentsBeforeSms + 1);
  assert.equal(sentDocuments(app.outbound).at(-1).jid, smsIdentity.jid);
  assert.equal((await read("products", `?id=eq.${product.id}`))[0].stock, 0);

  const uploadAudio = (buffer, index = 0) => {
    const body = new FormData();
    body.set("audio", new Blob([buffer], { type: "audio/wav" }), "nota-teste.wav");
    return fetch(app.base + "/api/media/upload-audio", {
      method: "POST",
      headers: index < 0 ? {} : { authorization: `Bearer ${userTokens[index]}` },
      body, signal: AbortSignal.timeout(30000)
    });
  };
  assert.equal((await uploadAudio(testAudio(), -1)).status, 401);
  assert.equal((await uploadAudio(Buffer.from("ficheiro que não contém áudio"))).status, 422);
  const prepared = await uploadAudio(testAudio());
  assert.equal(prepared.status, 200);
  const voice = await prepared.json();
  assert.match(voice.filename, new RegExp(`^voice-${owner}-[0-9a-f-]+\.ogg$`));
  assert.equal(voice.mimetype, "audio/ogg; codecs=opus");
  assert.equal(voice.duration, 1);
  assert.equal((await fetch(voice.url)).status, 404);
  const privateVoicePath = `/media/voice/${voice.filename}`;
  assert.equal((await api(privateVoicePath, -1)).status, 401);
  assert.equal((await api(privateVoicePath, 1)).status, 404);
  const playback = await api(privateVoicePath);
  assert.equal(playback.status, 200);
  assert.match(playback.headers.get("content-type"), /^audio\/ogg/);
  const bytes = Buffer.from(await playback.arrayBuffer());
  assert.equal(bytes.toString("ascii", 0, 4), "OggS");
  assert.ok(bytes.includes("OpusHead"));

  const voiceSend = { mediaUrl: voice.url, mediaType: "audio", duration: 1, fileName: "nota-teste.wav" };
  const beforeVoiceSend = app.outbound.length;
  const crossTenantVoice = await call("/send", 1, { ...voiceSend, contactId: otherCsvContactId });
  assert.equal(crossTenantVoice.status, 422);
  assert.match((await crossTenantVoice.json()).error, /outra conta/);
  const missingVoice = await call("/send", 0, { ...voiceSend, contactId: contact.id, mediaUrl: "/uploads/ficheiro-inexistente.ogg" });
  assert.equal(missingVoice.status, 422);
  assert.equal(app.outbound.length, beforeVoiceSend);
  const postedVoice = await call("/send", 0, { ...voiceSend, contactId: contact.id });
  assert.equal(postedVoice.status, 200);
  const postedVoiceResult = await postedVoice.json();
  assert.equal(postedVoiceResult.historySaved, true);
  assert.equal(postedVoiceResult.message.media_mimetype, "audio/ogg; codecs=opus");
  assert.equal(postedVoiceResult.message.media_type, "audio");
  const wireVoice = app.outbound.at(-1);
  assert.equal(wireVoice.jid, "258840000001@s.whatsapp.net");
  assert.equal(wireVoice.content.ptt, true);
  assert.equal(wireVoice.content.seconds, 1);
  assert.deepEqual(Buffer.from(wireVoice.content.audio.data), bytes);

  if (page) {
    await page.goto(app.base + "/messages");
    await page.getByRole("button", { name: /Cliente de teste/ }).click({ timeout: 15000 });
    const history = page.getByRole("log", { name: "Histórico da conversa" });
    const [browserPlayback] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith("/api" + privateVoicePath)),
      history.getByRole("button", { name: "Ouvir nota de voz" }).first().click()
    ]);
    assert.equal(browserPlayback.status(), 200);
    const encodedBrowserAudio = history.locator("audio").first();
    await page.waitForFunction(element => element.readyState > 0 && element.src.startsWith("blob:"),
      await encodedBrowserAudio.elementHandle());
    const input = page.getByPlaceholder("Digite uma mensagem...");
    await input.fill("Rascunho mantido após gravar");
    await page.getByTitle("Gravar Áudio de Voz").click();
    await page.getByRole("button", { name: "Iniciar gravação" }).click();
    const stop = page.getByRole("button", { name: "Parar gravação" });
    await stop.waitFor();
    await delay(450);
    await stop.click();
    await page.getByText("Áudio Gravado", { exact: true }).waitFor();
    const [browserUpload, browserSend] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith("/api/media/upload-audio")),
      page.waitForResponse(response => response.url().endsWith("/api/whatsapp/send")),
      page.getByRole("button", { name: "Enviar", exact: true }).click()
    ]);
    assert.equal(browserUpload.status(), 200);
    assert.equal(browserSend.status(), 200);
    assert.equal((await browserSend.json()).historySaved, true);
    await input.waitFor();
    assert.equal(await input.inputValue(), "Rascunho mantido após gravar");

    await app.simulate("unconfirmed");
    const [attachment, unconfirmed] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith("/api/media/upload-audio")),
      page.waitForResponse(response => response.url().endsWith("/api/whatsapp/send")),
      page.locator('input[type="file"]').setInputFiles({
        name: "nota-teste.wav", mimeType: "audio/wav", buffer: testAudio()
      })
    ]);
    assert.equal(attachment.status(), 200);
    assert.equal(unconfirmed.status(), 502);
    await page.getByText("Envio por confirmar. Verifica no WhatsApp antes de repetir.", { exact: true }).waitFor();
    assert.equal(await page.getByText("Anexo enviado.", { exact: true }).count(), 0);
    assert.equal(await input.inputValue(), "Rascunho mantido após gravar");

    const seedChat = async (rows) => {
      const response = await fetch(new URL("/messages", rest), {
        method: "POST", headers: storageAuth,
        body: JSON.stringify(rows.map(row => ({ user_id: owner, contact_id: contact.id, type: "inbound", is_read: true, ...row })))
      });
      assert.equal(response.status, 201);
    };
    const chatRows = (count, key, title, startedAt) => Array.from({ length: count }, (_, index) => ({
      msg_id: `${key}-${index + 1}`, text: `${title} ${index + 1}`, timestamp: new Date(startedAt + index * 1000).toISOString()
    }));
    await seedChat(chatRows(61, "pagination-older", "Mensagem anterior", Date.now() - 3_600_000));
    const messageRoute = `/api/whatsapp/chats/${contact.id}/messages`;
    let realtimeSocket;
    let realtimeAvailable = true;
    const subscribedTopics = new Set();
    await page.routeWebSocket(/\/realtime\/v1\/websocket/, socket => {
      realtimeSocket = socket;
      socket.onMessage(frame => {
        if (!realtimeAvailable || typeof frame !== "string") return;
        const [joinRef, ref, topic, event] = JSON.parse(frame);
        if (event === "phx_join") subscribedTopics.add(topic);
        if (["phx_join", "phx_leave", "heartbeat"].includes(event)) {
          socket.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: {} }]));
        }
      });
    });
    const recoveryRequests = [];
    const conversationRequests = [];
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.pathname === "/api/whatsapp/chats" || url.pathname === messageRoute) {
        conversationRequests.push(url.pathname + url.search);
        if (url.searchParams.has("after")) recoveryRequests.push(url.searchParams.get("after"));
      }
    });
    const initialPage = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === messageRoute && url.searchParams.get("limit") === "50" &&
        !url.searchParams.has("before") && !url.searchParams.has("after");
    });
    await page.goto(app.base + `/messages?contactId=${contact.id}`);
    assert.equal((await (await initialPage).json()).messages.length, 50);

    const orderedHistory = page.getByRole("log", { name: "Histórico da conversa" });
    const earlier = orderedHistory.getByRole("button", { name: "Carregar mensagens anteriores" });
    await earlier.waitFor();
    assert.equal(await orderedHistory.getByText("Mensagem anterior 1", { exact: true }).count(), 0);
    await orderedHistory.evaluate(element => { element.scrollTop = 0; });
    const formerlyFirst = await orderedHistory.locator("[data-chat-message]").first().elementHandle();
    const rowOffset = () => formerlyFirst.evaluate(row =>
      row.getBoundingClientRect().top - row.closest('[role="log"]').getBoundingClientRect().top);
    const previousOffset = await rowOffset();
    const earlierResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === messageRoute && url.searchParams.has("before");
    });
    await earlier.click();
    assert.equal((await earlierResponse).status(), 200);
    await orderedHistory.getByText("Mensagem anterior 1", { exact: true }).waitFor({ state: "attached" });
    assert.ok(Math.abs(await rowOffset() - previousOffset) <= 2, "Older pagination should preserve the visible scroll anchor");
    assert.ok(subscribedTopics.has(`realtime:messages-contacts-${owner}`));
    assert.ok(subscribedTopics.has(`realtime:messages-chat-${owner}-${contact.id}`));
    // Let the subscription reconciliation launched during first render settle.
    await delay(750);
    const requestsWhileSubscribed = conversationRequests.length;
    await delay(4500);
    assert.deepEqual(conversationRequests.slice(requestsWhileSubscribed), [],
      "Realtime should suppress fallback polling for both contacts and history");

    realtimeAvailable = false;
    await page.evaluate(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
      window.dispatchEvent(new Event("offline"));
    });
    await realtimeSocket.close();
    const newBatch = chatRows(106, "pagination-newer", "Mensagem acumulada", Date.now() + 60_000);
    await seedChat(newBatch);
    const beforeReconnect = recoveryRequests.length;
    await page.evaluate(() => {
      Reflect.deleteProperty(navigator, "onLine");
      window.dispatchEvent(new Event("online"));
    });
    await orderedHistory.getByText("Mensagem acumulada 106", { exact: true }).waitFor({ state: "attached" });
    assert.equal(await orderedHistory.getByText(/^Mensagem acumulada \d+$/).count(), 106);
    assert.equal(await orderedHistory.getByText("Mensagem anterior 1", { exact: true }).count(), 1);
    assert.ok(new Set(recoveryRequests.slice(beforeReconnect)).size >= 3, "Reconnect should drain multiple distinct delta cursors");
    await seedChat([{ msg_id: "pagination-late", text: "Mensagem recente atrasada", timestamp: newBatch.at(-6).timestamp }]);
    await page.evaluate(() => { window.dispatchEvent(new Event("online")); });
    await orderedHistory.getByText("Mensagem recente atrasada", { exact: true }).waitFor({ state: "attached" });
    console.log("Inbox pagination and browser reconnect passed (Realtime suppresses fast polls, older scroll anchor, 106 catch-up messages and a late arrival)");
  }

  // Simulate an ambiguous gateway response after the sale was approved. A reviewer can only
  // close the delivery after checking receipt, and closing it never sends a second document.
  const restock = await fetch(new URL(`/products?id=eq.${product.id}`, rest), {
    method: "PATCH", headers: storageAuth, body: JSON.stringify({ stock: 1 })
  });
  assert.ok(restock.ok);
  aiEndpointAvailable = true;
  await app.simulate("sales", { ...smsIdentity, text: "Quero comprar um livro por e-Mola.", messageId: "purchase-delivery-review" });
  const [reviewOrder] = await read("orders", "?source_message_id=eq.purchase-delivery-review");
  assert.equal(reviewOrder.status, "awaiting_payment");
  await app.simulate("sales", { ...smsIdentity, text: sms.replace("i00000", "i00001"), messageId: "proof-delivery-review" });
  const [reviewProof] = await read("payment_verifications", "?source_message_id=eq.proof-delivery-review");
  await app.simulate("unconfirmed");
  const documentsBeforeReview = sentDocuments(app.outbound).length;
  const approvedForReview = await approve(reviewOrder.id, { ...approval, proofId: reviewProof.id });
  assert.equal(approvedForReview.status, 200);
  assert.equal((await approvedForReview.json()).fulfillment.delivered, false);
  const [unconfirmedOrder] = await read("orders", `?id=eq.${reviewOrder.id}`);
  assert.equal(unconfirmedOrder.status, "paid");
  assert.ok(unconfirmedOrder.delivery_started_at);
  assert.equal(sentDocuments(app.outbound).length, documentsBeforeReview + 1);

  const reviewPath = `/commerce/orders/${reviewOrder.id}/delivery/confirm`;
  const review = (account, verified) => api(reviewPath, account, { deliveryVerified: verified });
  const repeatDelivery = await api(`/commerce/orders/${reviewOrder.id}/delivery`, 0, {});
  assert.equal((await repeatDelivery.json()).delivered, false);
  assert.equal((await review(-1, true)).status, 401);
  assert.equal((await review(1, true)).status, 404);
  assert.equal((await review(0, false)).status, 400);
  if (page) {
    await page.goto(app.base + `/orders?q=${reviewOrder.order_number}`);
    await page.getByRole("button", { name: "Rever entrega", exact: true }).click();
    const reviewDialog = page.getByRole("dialog");
    await reviewDialog.getByRole("checkbox", { name: /Confirmei que o cliente recebeu/ }).check();
    const [result] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith(`/api${reviewPath}`)),
      reviewDialog.getByRole("button", { name: "Confirmar entrega", exact: true }).click()
    ]);
    assert.equal(result.status(), 200);
  } else {
    assert.equal((await review(0, true)).status, 200);
  }
  assert.equal((await review(0, true)).status, 200);
  assert.equal((await read("orders", `?id=eq.${reviewOrder.id}`))[0].status, "fulfilled");
  const audited = await read("agent_operations", `?order_id=eq.${reviewOrder.id}&step=eq.fulfilled`);
  assert.equal(audited.length, 1);
  assert.equal(audited[0].metadata.source, "operator_review");
  assert.equal(sentDocuments(app.outbound).length, documentsBeforeReview + 1);
  console.log("Delivery review passed after a missing gateway acknowledgement: owner confirmed, one audit event, no second send.");

  if (fresh) {
    await app.simulate("confirmed");
    const stockForCampaign = await fetch(new URL(`/products?id=eq.${product.id}`, rest), {
      method: "PATCH", headers: storageAuth, body: JSON.stringify({ stock: 5 })
    });
    assert.equal(stockForCampaign.status, 204);
    const groupJid = "120363000000001@g.us";
    const campaignPath = "/catalog-campaigns";
    const cover = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/zXQAAAAASUVORK5CYII=", "base64");
    const coverForm = new FormData();
    coverForm.append("image", new Blob([cover], { type: "image/png" }), "catalogo.png");
    const uploadCover = await fetch(`${app.base}/api${campaignPath}/products/${product.id}/cover`, {
      method: "POST", headers: { authorization: `Bearer ${userTokens[0]}` }, body: coverForm
    });
    assert.equal(uploadCover.status, 200, await uploadCover.text());
    const otherCover = await api(`${campaignPath}/products/${product.id}/cover`, 1);
    assert.equal(otherCover.status, 404);
    const catalog = await (await api(campaignPath)).json();
    assert.ok(catalog.data.groups.some(({ id }) => id === groupJid));
    assert.ok(catalog.data.products.some(({ id, hasCover }) => id === product.id && hasCover));
    const campaignRequest = { productId: product.id, groupJid, requestKey: randomUUID(), publishNow: true, caption: "Oferta do grupo" };
    const preview = await api(`${campaignPath}/preview`, 0, { productId: product.id, caption: campaignRequest.caption });
    assert.equal(preview.status, 200);
    assert.match((await preview.json()).preview, /Oferta do grupo[\s\S]*Stock disponível/);
    assert.equal((await api(campaignPath, 1, campaignRequest)).status, 403);
    const published = await api(campaignPath, 0, campaignRequest);
    assert.equal(published.status, 201);
    const campaign = await published.json();
    assert.equal(campaign.status, "sent", JSON.stringify(campaign));
    const groupSends = () => app.outbound.filter(({ jid }) => jid === groupJid);
    assert.equal(groupSends().length, 1);
    assert.deepEqual(Buffer.from(groupSends()[0].content.image.data), cover);
    const invite = groupSends()[0].content.caption.match(/https:\/\/wa\.me\/[^\s]+/)?.[0];
    assert.ok(invite);
    const interestText = new URL(invite).searchParams.get("text");
    assert.match(interestText, /AXC-[0-9A-F]{32}/);
    await api(campaignPath, 0, campaignRequest);
    assert.equal(groupSends().length, 1, "Campaign POST retry must not send a second promotion");
    const campaignInterest = { jid: "258841110098@s.whatsapp.net", text: interestText, messageId: "fixture-campaign-interest" };
    await app.simulate("ingress", campaignInterest);
    await app.simulate("ingress", campaignInterest);
    const interests = await read("agentx_catalog_campaign_interests", `?campaign_id=eq.${campaign.id}`);
    assert.equal(interests.length, 1);
    assert.ok(interests[0].lead_id);
    const originsPath = `${campaignPath}/lead-origins/${interests[0].lead_id}`;
    const origin = await (await api(originsPath, 0)).json();
    assert.ok(JSON.stringify(origin).includes("Grupo de teste de campanhas"));
    const otherOrigin = await (await api(originsPath, 1)).json();
    assert.ok(!JSON.stringify(otherOrigin).includes("Grupo de teste de campanhas"));
    console.log("Campaign pilot passed: private cover, authorized group, one acknowledged promotion and one scoped lead attribution.");

    const text = "teste de receção idempotente";
    const responseText = "Resposta única da automação";
    const jid = "258841110099@s.whatsapp.net";
    const createReply = await fetch(`${supabaseUrl}/rest/v1/quick_reply`, {
      method: "POST", headers: { authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
      body: JSON.stringify({ user_id: owner, trigger: text, response_text: responseText })
    });
    assert.equal(createReply.status, 201);
    const repeats = () => app.outbound.filter((record) => record.jid === jid && record.content.text === responseText).length;
    const legacy = { jid, text, messageId: "fixture-historical-action" };
    const live = { jid, text, messageId: "fixture-live-action" };
    await app.simulate("ingress", { ...legacy, upsertType: "history" });
    await app.simulate("ingress", legacy);
    await app.simulate("ingress", { ...live, upsertType: "append" });
    assert.equal(repeats(), 0);
    assert.equal((await read("messages", "?msg_id=eq.fixture-live-action")).length, 1);
    await Promise.all([app.simulate("ingress", live), app.simulate("ingress", live)]);
    assert.equal(repeats(), 1);
    assert.equal((await read("agentx_whatsapp_action_claims", "?message_id=eq.fixture-live-action")).length, 1);

    const adminPhone = "258841110201";
    const adminJid = `${adminPhone}@s.whatsapp.net`;
    const alternateAdmin = "258851110202";
    const adminLid = "109876543212122@lid";
    const otherAdmin = "258841110204";
    const operatorProfile = { phone: "+258 84 111 0201", admin_phones: "85 111 0202" };
    assert.equal((await api("/ai/profile", -1, operatorProfile)).status, 401);
    const setupOperator = await api("/ai/profile", 0, operatorProfile);
    const ownerProfile = await setupOperator.json();
    assert.equal(setupOperator.status, 200, JSON.stringify(ownerProfile));
    assert.equal(ownerProfile.data.id, owner);
    assert.equal(ownerProfile.data.phone, operatorProfile.phone);
    assert.equal(ownerProfile.data.admin_phones, operatorProfile.admin_phones);
    const setupOther = await api("/ai/profile", 1, { phone: otherAdmin, admin_phones: "" });
    const otherProfile = await setupOther.json();
    assert.equal(setupOther.status, 200, JSON.stringify(otherProfile));
    assert.equal(otherProfile.data.id, other);
    assert.equal(otherProfile.data.phone, otherAdmin);
    const statusCommand = { jid: adminJid, text: "/agentx status Horário de hoje", messageId: "fixture-admin-status" };
    const commandWireStart = app.outbound.length;
    const rejectedCommands = [
      { ...statusCommand, jid: "258841110203@s.whatsapp.net", messageId: "fixture-unknown-admin" },
      { ...statusCommand, account: "other", messageId: "fixture-cross-account-admin" },
      { ...statusCommand, jid: `${otherAdmin}@s.whatsapp.net`, messageId: "fixture-other-account-admin" },
      { ...statusCommand, jid: groupJid, participant: adminJid, messageId: "fixture-group-admin" },
      { ...statusCommand, jid: `${adminPhone}@lid`, messageId: "fixture-unverified-admin-lid" },
      { ...statusCommand, fromMe: true, messageId: "fixture-outgoing-admin-command" },
      { ...statusCommand, timestamp: Math.floor(Date.now() / 1000) - 300, messageId: "fixture-stale-admin-command" },
      { ...statusCommand, upsertType: "append", messageId: "fixture-appended-admin-command" }
    ];
    for (const parameters of rejectedCommands) await app.simulate("ingress", parameters);
    const historyCommand = { ...statusCommand, messageId: "fixture-history-admin-command" };
    await app.simulate("ingress", { ...historyCommand, upsertType: "history" });
    await app.simulate("ingress", historyCommand);
    assert.deepEqual(app.outbound.slice(commandWireStart), [], "Rejected commands cannot post Status, answer, or fall through to automation");

    await Promise.all([app.simulate("ingress", statusCommand), app.simulate("ingress", statusCommand)]);
    const posted = app.outbound.slice(commandWireStart);
    assert.equal(posted.length, 2, "One Status and one private reply are sent even with concurrent duplicate upserts");
    assert.equal(posted[0].userId, owner);
    assert.equal(posted[0].jid, "status@broadcast");
    assert.equal(posted[0].content.text, "Horário de hoje");
    assert.ok(posted[0].statusJidList.includes("258860000001@s.whatsapp.net"));
    assert.ok(!posted[0].statusJidList.includes("258860000002@s.whatsapp.net"));
    assert.equal(posted[1].userId, owner);
    assert.equal(posted[1].jid, adminJid);
    assert.match(posted[1].content.text, /^AgentX: .*Status.*(?:publicado|aceite)/i);
    assert.deepEqual((await read("whatsapp_operator_commands", `?message_id=eq.${statusCommand.messageId}&select=user_id,message_id`)),
      [{ user_id: owner, message_id: statusCommand.messageId }]);

    const lidCommand = { jid: adminLid, altJid: `${alternateAdmin}@s.whatsapp.net`, text: "/agentx status Horário atualizado", messageId: "fixture-verified-lid-admin" };
    const lidWireStart = app.outbound.length;
    await app.simulate("ingress", lidCommand);
    const lidPosted = app.outbound.slice(lidWireStart);
    assert.equal(lidPosted.length, 2);
    assert.equal(lidPosted[0].userId, owner);
    assert.equal(lidPosted[0].jid, "status@broadcast");
    assert.equal(lidPosted[0].content.text, "Horário atualizado");
    assert.equal(lidPosted[1].userId, owner);
    assert.ok([adminLid, `${alternateAdmin}@s.whatsapp.net`].includes(lidPosted[1].jid), "The reply reaches only the verified LID or its associated PN");
    assert.match(lidPosted[1].content.text, /^AgentX: .*Status.*(?:publicado|aceite)/i);
    assert.equal((await read("contacts", `?user_id=eq.${owner}&lid=eq.${adminLid.split("@")[0]}&select=phone`))[0]?.phone, alternateAdmin);

    const ingressPort = app.port;
    await app.stop();
    app = await start(ingressPort);
    await app.simulate("ingress", live);
    assert.equal(repeats(), 0, "A replay after a process restart must not trigger an automation again");
    await app.simulate("ingress", statusCommand);
    await app.simulate("ingress", lidCommand);
    assert.deepEqual(app.outbound, [], "Authorized commands already processed cannot post again after restart");
    console.log("WhatsApp action deduplication passed: sync-only history, concurrent upserts and replay after restart.");
    console.log("WhatsApp remote admin commands passed: one Status and private confirmation, verified LID mapping, tenant isolation, group and history rejection.");
  }

  assert.equal((await call("/pause", 1, {})).status, 200);
  const qrAfterPause = (await (await call("/qr", 1)).json());
  assert.deepEqual(qrAfterPause, { success: true, qr: null, status: "disconnected" });
  assert.equal((await (await call("/status", 1)).json()).status, "disconnected");
  console.log("Existing connection was preserved and QR polling did not restart a paused session.");

  const stockForOfflinePurchase = await fetch(new URL(`/products?id=eq.${product.id}`, rest), {
    method: "PATCH", headers: storageAuth, body: JSON.stringify({ stock: 2 })
  });
  assert.equal(stockForOfflinePurchase.status, 204);
  aiEndpointAvailable = false;
  const aiBeforeOfflinePurchase = aiRequests;
  const offlineBuyer = { jid: "258840000013@s.whatsapp.net", text: "Quero comprar 1 Livro do piloto por M-Pesa", messageId: "outage-exact-purchase" };
  const documentsBeforeOfflinePurchase = sentDocuments(app.outbound).length;
  await app.simulate("sales", offlineBuyer);
  assert.equal(aiRequests, aiBeforeOfflinePurchase);
  const [offlineOrder] = await read("orders", "?source_message_id=eq.outage-exact-purchase");
  assert.equal(offlineOrder.status, "awaiting_payment");
  assert.equal(offlineOrder.total_amount, 250);
  assert.equal(offlineOrder.seller_payment.method, "mpesa");
  assert.equal(offlineOrder.seller_payment.recipient, "258840000005");
  const [offlineItem] = await read("order_items", `?order_id=eq.${offlineOrder.id}`);
  assert.equal(offlineItem.product_id, product.id);
  assert.equal(offlineItem.quantity, 1);
  assert.equal(app.outbound.at(-1).jid, offlineBuyer.jid);
  assert.match(app.outbound.at(-1).content.text, /M-Pesa.*258840000005/);
  assert.ok(app.outbound.at(-1).content.text.includes(offlineOrder.order_number));
  const [offlineBuyerContact] = await read("contacts", "?phone=eq.258840000013");
  assert.equal(offlineBuyerContact.ai_paused, false);
  assert.equal((await read("products", `?id=eq.${product.id}`))[0].stock, 2);
  assert.equal(sentDocuments(app.outbound).length, documentsBeforeOfflinePurchase);

  const unacknowledgedBuyer = "258840000016";
  const unacknowledgedJid = `${unacknowledgedBuyer}@s.whatsapp.net`;
  await app.simulate("unconfirmed");
  await app.simulate("ingress", { jid: unacknowledgedJid, text: "Livro do piloto", messageId: "outage-unacknowledged-quote" });
  await app.simulate("confirmed");
  await app.simulate("ingress", { jid: unacknowledgedJid, text: "peco 1", messageId: "outage-unacknowledged-purchase" });
  assert.match(app.outbound.at(-1).content.text, /qual é o produto/i);
  assert.deepEqual(await read("orders", `?user_id=eq.${owner}&customer_phone=eq.${unacknowledgedBuyer}`), []);

  const secondProduct = await fetch(new URL("/products", rest), {
    method: "POST", headers: storageAuth, body: JSON.stringify({
      user_id: owner, name: "Caderno A5", price: 90, currency: "MT", stock: 4, type: "physical", is_active: true
    })
  });
  assert.equal(secondProduct.status, 201);

  const ambiguousBuyer = "258840000014";
  const ambiguousJid = `${ambiguousBuyer}@s.whatsapp.net`;
  await app.simulate("ingress", { jid: ambiguousJid, text: "quais os produtos que tem", messageId: "outage-ambiguous-catalogue" });
  await app.simulate("ingress", { jid: ambiguousJid, text: "peco 1", messageId: "outage-ambiguous-purchase" });
  assert.equal(app.outbound.at(-1).jid, ambiguousJid);
  assert.match(app.outbound.at(-1).content.text, /produto|artigo/i);
  assert.doesNotMatch(app.outbound.at(-1).content.text, /AGX-|258840000005/);
  assert.deepEqual(await read("orders", `?user_id=eq.${owner}&customer_phone=eq.${ambiguousBuyer}`), []);

  const conversationalBuyer = "258840000015";
  const conversationalJid = `${conversationalBuyer}@s.whatsapp.net`;
  const aiBeforeConversation = aiRequests;
  for (const [text, messageId] of [["oque voces tem", "outage-conversation-first-catalogue"],
    ["quais os produtos que tem", "outage-conversation-second-catalogue"]]) {
    await app.simulate("ingress", { jid: conversationalJid, text, messageId });
    const catalogue = app.outbound.at(-1);
    assert.equal(catalogue.jid, conversationalJid);
    assert.match(catalogue.content.text, /Livro do piloto.*250\s+MT/);
    assert.match(catalogue.content.text, /Caderno A5.*90\s+MT/);
  }
  await app.simulate("ingress", { jid: conversationalJid, text: "Livro do piloto", messageId: "outage-conversation-quote" });
  const quoteReply = app.outbound.at(-1);
  assert.equal(quoteReply.jid, conversationalJid);
  assert.match(quoteReply.content.text, /Livro do piloto.*250\s+MT.*2 em stock/);
  assert.doesNotMatch(quoteReply.content.text, /Caderno A5|AGX-|258840000005/);
  assert.deepEqual(await read("orders", `?user_id=eq.${owner}&customer_phone=eq.${conversationalBuyer}`), []);

  const accepted = { jid: conversationalJid, text: "peco 1", messageId: "outage-conversation-purchase" };
  await app.simulate("ingress", accepted);
  const orderReply = app.outbound.at(-1);
  assert.equal(orderReply.jid, conversationalJid);
  const conversationalOrders = await read("orders", `?user_id=eq.${owner}&customer_phone=eq.${conversationalBuyer}`);
  assert.equal(conversationalOrders.length, 1, orderReply.content.text);
  const [conversationalOrder] = conversationalOrders;
  assert.equal(conversationalOrder.source_message_id, accepted.messageId);
  assert.equal(conversationalOrder.status, "awaiting_payment");
  assert.equal(conversationalOrder.total_amount, 250);
  assert.ok(orderReply.content.text.includes(conversationalOrder.order_number));
  assert.match(orderReply.content.text, /M-Pesa.*258840000005/);
  const [conversationalItem] = await read("order_items", `?order_id=eq.${conversationalOrder.id}`);
  assert.equal(conversationalItem.product_id, product.id);
  assert.equal(conversationalItem.quantity, 1);
  assert.equal(aiRequests, aiBeforeConversation);
  await app.simulate("ingress", accepted);
  await app.simulate("ingress", { ...accepted, messageId: "outage-conversation-purchase-again" });
  assert.equal(app.outbound.at(-1).jid, conversationalJid);
  assert.match(app.outbound.at(-1).content.text, /produto|artigo/i);
  assert.doesNotMatch(app.outbound.at(-1).content.text, /AGX-|258840000005/);

  await app.simulate("ingress", { jid: conversationalJid, text: "Livro do piloto", messageId: "outage-conversation-second-quote" });
  const changedPrice = await fetch(new URL(`/products?id=eq.${product.id}`, rest), {
    method: "PATCH", headers: storageAuth, body: JSON.stringify({ price: 275 })
  });
  assert.equal(changedPrice.status, 204);
  await app.simulate("ingress", { ...accepted, messageId: "outage-conversation-price-changed" });
  assert.equal(app.outbound.at(-1).jid, conversationalJid);
  assert.match(app.outbound.at(-1).content.text, /preço.*mudou.*275\s+MT/i);
  assert.doesNotMatch(app.outbound.at(-1).content.text, /AGX-|258840000005/);
  assert.equal((await read("orders", `?user_id=eq.${owner}&customer_phone=eq.${conversationalBuyer}`)).length, 1);
  assert.equal((await read("products", `?id=eq.${product.id}`))[0].stock, 2);
  assert.equal(sentDocuments(app.outbound).length, documentsBeforeOfflinePurchase);

  console.log("Audio upload, Opus playback, account isolation and PTT payload passed" + (page ? " (Chromium microphone and acknowledgement verified)" : ""));
  console.log(`AgentX contacts and inbox passed using PostgreSQL, PostgREST, simulated WhatsApp and a real server restart${page ? " (Chromium UI verified)" : ""}`);
  console.log(`Seller flow passed on the ${fresh ? "freshly installed" : "repaired legacy"} schema: multiple payment methods, recipient review, approval without retyping a reference, duplicate settlement blocked and PDF bytes sent as a WhatsApp document`);
  if (fresh) console.log("Fresh installation: deployment schema and subscription verified with stubbed Auth, Storage, AI and WhatsApp.");
  console.log("Seller replied during AI outage with live catalogue and configured payment methods; only the explicit request queued a human handoff");
  console.log("Payment instructions reused the matching buyer's saved order destination after the merchant changed settings");
  console.log("Explicit offline purchase created one unpaid order with stock and delivery unchanged");
  console.log("Conversational offline purchase accepted one quote and rejected a vague selection, repeat request and changed price without creating more orders");
  console.log("Outgoing M-Pesa and e-Mola SMS recognized without AI: recipient and reference persisted, manual approval required before delivery");
} finally {
  await browser?.close();
  await app?.stop();
  supabase.closeAllConnections();
  supabase.close();
  await rm(sandbox, { recursive: true, force: true });
}
