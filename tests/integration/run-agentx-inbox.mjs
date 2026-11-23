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
const storedObjects = new Set();

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
    let input = "";
    for await (const chunk of req) input += chunk;
    const message = JSON.parse(input).message.split("\nUSER:\n").at(-1);
    const buying = message.includes("comprar");
    return res.end(JSON.stringify({ response: JSON.stringify({ tool: buying ? "createOrder" : "getProductsCatalog",
      args: buying ? { productName: "Livro do piloto" } : { search: "Livro do piloto" } }) }));
  }
  if (req.url.startsWith("/storage/v1/object/") && req.method === "POST") {
    if (req.headers.authorization !== `Bearer ${serviceKey}`) return res.writeHead(403).end("{}");
    const objectPath = req.url.slice("/storage/v1/object/".length);
    for await (const _ of req) { /* Consume the request body. */ }
    if (objectPath.startsWith("sign/")) {
      if (!storedObjects.has(objectPath.slice(5))) return res.writeHead(404).end("{}");
      return res.end(JSON.stringify({ signedURL: `/object/${objectPath}?token=fixture-file-access` }));
    }
    storedObjects.add(objectPath);
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
  const api = (route, index = 0, body) => fetch(app.base + "/api" + route, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(index < 0 ? {} : { authorization: `Bearer ${userTokens[index]}` }) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(12000)
  });
  const call = (route, index, body) => api("/whatsapp" + route, index, body);
  const saveContact = (phone, index = 0, name = "Contacto guardado") => api("/contacts", index, { phone, name });
  assert.equal((await call("/chats", -1)).status, 401);

  const legacyId = "00000000-0000-4000-8000-000000000013";
  const primaryId = "00000000-0000-4000-8000-000000000015";
  const duplicateId = "00000000-0000-4000-8000-000000000016";
  assert.equal((await saveContact("258849998888", -1)).status, 401);
  assert.equal((await saveContact("104928502847592@lid")).status, 400);
  const exactMatch = await saveContact("+258 85 777 7777");
  assert.equal(exactMatch.status, 200);
  assert.deepEqual((await exactMatch.json()).data,
    { id: primaryId, phone: "258857777777", name: "Contacto guardado", created: false });
  const history = await call(`/chats/${duplicateId}/messages`);
  assert.equal((await history.json()).messages[0].msg_id, "legacy-duplicate-message");
  const exactRows = await fetch(new URL(`/contacts?user_id=eq.${owner}&phone=eq.258857777777&select=id,agentx_legacy_phone_duplicate&order=id`, rest),
    { headers: { authorization: `Bearer ${serviceKey}` } });
  assert.deepEqual(await exactRows.json(), [
    { id: primaryId, agentx_legacy_phone_duplicate: false }, { id: duplicateId, agentx_legacy_phone_duplicate: true }
  ]);
  const legacy = await saveContact("258849998888");
  assert.equal(legacy.status, 200);
  assert.deepEqual((await legacy.json()).data,
    { id: legacyId, phone: "258849998888", name: "Contacto guardado", created: false });
  const { messages: legacyHistory } = await (await call("/chats/00000000-0000-4000-8000-000000000014/messages")).json();
  assert.equal(legacyHistory[0].msg_id, "legacy-contact-message");
  const synced = await call("/sync-contacts", 0, {});
  assert.equal(synced.status, 200);
  assert.deepEqual(await synced.json(), { success: true, total: 6, savedCount: 2, activeChatsCount: 0, cleanedCount: 0, withoutPhone: 1, failed: 0 });
  const resolvedContact = await saveContact("83 123 4567");
  assert.equal(resolvedContact.status, 200);
  assert.equal((await resolvedContact.json()).data.phone, "258831234567");

  const otherAccount = await saveContact("0849998888", 1);
  assert.equal(otherAccount.status, 201);
  assert.notEqual((await otherAccount.json()).data.id, legacyId);

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
  const changeDuplicate = await fetch(new URL(`/contacts?id=eq.${duplicateId}`, rest), {
    method: "PATCH", headers: { authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
    body: JSON.stringify({ phone: "0861234567" })
  });
  assert.equal(changeDuplicate.status, 409);

  let page;
  if (process.env.AGENTX_INBOX_BROWSER === "1") {
    const { chromium } = createRequire(import.meta.url)("playwright");
    browser = await chromium.launch({ executablePath: process.env.AGENTX_TEST_CHROMIUM || "/usr/bin/chromium",
      args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on("pageerror", (error) => console.error("Inbox browser error:", error.message));
    await page.goto(app.base + "/login");
    await page.locator('input[type="email"]').fill(users[0].email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL("**/dashboard", { timeout: 15000 });
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
  assert.deepEqual(messages.map((message) => message.msg_id).sort(), ["fixture-inbound-1", "fixture-outbound-1"]);
  if (page) {
    await page.goto(app.base + "/messages");
    await page.getByRole("button", { name: /Cliente de teste/ }).click({ timeout: 15000 });
    const history = page.getByRole("log", { name: "Histórico da conversa" });
    await history.getByText("Olá, gostaria de saber o preço.", { exact: true }).waitFor();
    await history.getByText(reply, { exact: true }).waitFor();
    assert.equal(await history.getByText(reply, { exact: true }).count(), 1);
  }

  const seller = "/commerce/seller";
  const ownerSettings = { payment_method: "mpesa", payment_recipient: "84 000 0003",
    recipient_name: "Loja de teste", notification_phone: "85 000 0004" };
  const configure = (settings = ownerSettings) => fetch(app.base + "/api" + seller + "/settings", {
    method: "PUT", headers: { authorization: `Bearer ${userTokens[0]}`, "content-type": "application/json" },
    body: JSON.stringify(settings)
  });
  assert.equal((await api(seller, -1)).status, 401);
  assert.equal((await configure({ ...ownerSettings, payment_recipient: "123@lid" })).status, 400);

  if (page) {
    await page.goto(app.base + "/seller");
    await page.getByRole("heading", { name: "Vendedor", exact: true }).waitFor();
    await page.getByRole("textbox", { name: "Número que recebe o pagamento" }).fill(ownerSettings.payment_recipient);
    await page.getByRole("textbox", { name: "Nome do titular" }).fill(ownerSettings.recipient_name);
    await page.getByRole("textbox", { name: /WhatsApp para avisos/ }).fill(ownerSettings.notification_phone);
    await page.getByRole("button", { name: "Guardar pagamento" }).click();
    await page.getByText("+258850000004", { exact: true }).waitFor();
  } else {
    assert.equal((await configure()).status, 200);
  }
  assert.equal((await (await api(seller, 1)).json()).data.settings, null);

  const storageAuth = { authorization: `Bearer ${serviceKey}`, "content-type": "application/json" };
  const agent = await fetch(new URL("/agents", rest), { method: "POST", headers: storageAuth,
    body: JSON.stringify({ user_id: owner, provider: "custom", api_url: supabaseUrl + "/fixture-ai", is_active: true, specialization: "vendas" }) });
  assert.equal(agent.status, 201);

  const productBody = new FormData();
  for (const [key, value] of Object.entries({ name: "Livro do piloto", price: "250", stock: "3", type: "digital" })) productBody.set(key, value);
  productBody.set("file", new Blob(["%PDF-1.7\nExemplo"], { type: "application/pdf" }), "livro.pdf");
  const productResponse = await fetch(app.base + "/api/commerce/products", { method: "POST",
    headers: { authorization: `Bearer ${userTokens[0]}` }, body: productBody });
  assert.equal(productResponse.status, 200);
  const product = (await productResponse.json()).data;
  assert.equal(storedObjects.size, 1);

  const sell = (text, messageId) => app.simulate("sales", { text, messageId });
  const read = async (resource, filter = "") => {
    const response = await fetch(new URL("/" + resource + filter, rest), { headers: storageAuth });
    assert.equal(response.status, 200);
    return response.json();
  };
  const overview = (await (await api(seller)).json()).data;
  assert.equal(overview.readyProducts, 1);
  assert.equal(overview.agentActive, true);
  assert.equal(overview.whatsappConnected, true);
  await sell("Quanto custa o livro?", "catalogue-one");
  assert.match(app.outbound.at(-1).content.text, /Livro do piloto.*250 MT/);
  assert.doesNotMatch(app.outbound.at(-1).content.text, /fixture-file-access|agentx-product-files/);
  const [lead] = await read("leads", "?phone=eq.258840000002");
  assert.ok(lead.contact_id);

  await sell("Quero comprar o livro.", "purchase-one");
  const [order] = (await (await api(seller)).json()).data.orders;
  assert.equal(order.status, "awaiting_payment");
  assert.match(app.outbound.at(-1).content.text, /250 MT.*258840000003/);
  assert.equal((await read("orders", `?id=eq.${order.id}`))[0].lead_id, lead.id);
  assert.equal((await read("products", `?id=eq.${product.id}`))[0].stock, 3);
  assert.equal((await configure({ ...ownerSettings, payment_recipient: "84 000 0005" })).status, 200);
  await sell("Quero comprar o livro.", "purchase-one");
  assert.match(app.outbound.at(-1).content.text, /258840000003/);
  assert.equal((await (await api(seller)).json()).data.orders.length, 1);
  assert.equal((await api(`/commerce/orders/${order.id}/delivery`, 0, {})).status, 503);

  const receipt = "M-Pesa Confirmado. Recebeu 250.00 MT de 841234567. Transaccao: AGVALID01";
  await sell(`${receipt} Pedido ${order.order_number}`, "proof-one");
  await sell(`${receipt} Pedido ${order.order_number}`, "proof-one");
  assert.equal((await read("payment_verifications", `?order_id=eq.${order.id}`)).length, 1);
  assert.equal((await (await api(seller)).json()).data.pendingReviews, 1);
  assert.equal(app.outbound.filter((message) => message.jid === "258850000004@s.whatsapp.net").length, 1);
  assert.ok(!app.outbound.some((message) => message.content.text?.includes("fixture-file-access")));

  const approve = (id, data, index = 0) => api(`/commerce/orders/${id}/approve`, index, data);
  const approval = { settlementVerified: true, settlementMethod: "mpesa", settlementReference: "AGVALID01", settlementAmount: "250,00" };
  assert.equal((await approve(order.id, {})).status, 400);
  assert.equal((await approve(order.id, { ...approval, settlementReference: "" })).status, 400);
  assert.equal((await approve(order.id, approval, 1)).status, 404);
  assert.equal((await approve(order.id, { ...approval, settlementAmount: "25" })).status, 409);
  if (page) {
    await page.goto(app.base + "/seller");
    await page.getByRole("link", { name: /Comprovativos pendentes/ }).click();
    await page.getByRole("button", { name: /Aprovar/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Referência oficial da transação" }).fill(approval.settlementReference);
    await dialog.getByRole("textbox", { name: "Valor recebido em MT" }).fill(approval.settlementAmount);
    await dialog.getByRole("checkbox").check();
    const [confirmed] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/approve")),
      dialog.getByRole("button", { name: "Confirmar pagamento" }).click()
    ]);
    assert.equal(confirmed.status(), 200);
    assert.equal((await confirmed.json()).fulfillment.delivered, true);
  } else {
    const attempts = await Promise.all([approve(order.id, approval), approve(order.id, approval)]);
    assert.ok(attempts.every((response) => response.status === 200));
  }
  assert.equal((await approve(order.id, approval)).status, 200);
  assert.equal(app.outbound.filter((message) => message.content.text?.includes("fixture-file-access")).length, 1);
  assert.equal((await read("products", `?id=eq.${product.id}`))[0].stock, 2);
  assert.equal((await read("leads", `?id=eq.${lead.id}`))[0].stage, "venda_fechada");
  assert.equal((await (await api(seller)).json()).data.orders.find(({ id }) => id === order.id).status, "fulfilled");

  await sell("Quero comprar mais um livro.", "purchase-two");
  const secondOrder = (await (await api(seller)).json()).data.orders.find(({ id }) => id !== order.id);
  assert.match(app.outbound.at(-1).content.text, /258840000005/);
  await sell(`${receipt} Pedido ${secondOrder.order_number}`, "proof-two");
  assert.equal((await approve(secondOrder.id, { ...approval, settlementReference: "ag-valid01" })).status, 409);
  assert.equal((await api(`/commerce/orders/${secondOrder.id}/reject`, 0, { reason: "Referência já utilizada" })).status, 200);
  assert.equal((await read("orders", `?id=eq.${secondOrder.id}`))[0].status, "rejected");
  assert.equal((await read("products", `?id=eq.${product.id}`))[0].stock, 2);
  assert.equal(app.outbound.filter((message) => message.content.text?.includes("fixture-file-access")).length, 1);

  console.log(`AgentX contacts and inbox passed using PostgreSQL, PostgREST, simulated WhatsApp and a real server restart${page ? " (Chromium UI verified)" : ""}`);
  console.log("Seller flow passed: scoped settings, catalogue and lead, confirmed order, proof review, deduplicated settlement and a single file delivery");
} finally {
  await browser?.close();
  await app?.stop();
  supabase.closeAllConnections();
  supabase.close();
  await rm(sandbox, { recursive: true, force: true });
}
