import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const fakeUser = "00000000-0000-4000-8000-000000000001";
const groupAttachmentId = "00000000-0000-4000-8000-000000000025";
const unrelatedAttachmentId = "00000000-0000-4000-8000-000000000026";
const groupDocument = Buffer.from("%PDF-1.4 Receipt fixture");
const fakeToken = "agentx-integration-session";
const fakeSecret = "sb_secret_agentx-smoke-test-service-key";
const fakeAiKey = "agentx-smoke-test-gemini-key";
const publicKey = "sb_publishable_agentx_smoke-test";
const revision = "a123bcd";
const run = promisify(execFile);
let workerCalls = 0;
let sqlBootstrapCalls = 0;
let brokenCrm = false;
let unavailableCrm = false;
let missingContactMigration = false;
let missingSellerMigration = false;
let missingLeadColumn = false;
let missingSellerContract = false;
let sellerContractReady = true;
let missingPaymentContract = false;
let paymentContractReady = true;
let missingModuleContract = "";
let sellerDeliveryState = "ready";
let sellerDeliveryChecks = 0;
let missingWorkflowContract = "";
const workflowContracts = ["agentx_whatsapp_action_ready", "agentx_group_policy_ready", "agentx_catalog_campaigns_ready",
  "agentx_whatsapp_quote_ready", "agentx_whatsapp_operator_audit_ready", "agentx_human_handoff_ready"];
const sellerMigrations = /migraç(?:ão|ões).*22/;

const supabase = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  res.setHeader("content-type", "application/json");
  if (req.headers.apikey !== fakeSecret) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ message: "Invalid fixture API key" }));
  }
  if (url.pathname === "/rest/v1/rpc/exec_sql") {
    sqlBootstrapCalls++;
    res.statusCode = 403;
    return res.end(JSON.stringify({ code: "42501", message: "Runtime SQL is forbidden" }));
  }
  if (url.pathname === "/rest/v1/rpc/agentx_process_digital_deliveries") {
    workerCalls++;
    return res.end("0");
  }
  const moduleContract = url.pathname.split("/").at(-1);
  if (workflowContracts.includes(moduleContract)) {
    assert.equal(req.method, "GET");
    return res.end(JSON.stringify(moduleContract !== missingWorkflowContract));
  }
  if (["agentx_schedule_dispatch_ready", "agentx_appointment_contract_ready", "agentx_group_proof_contract_ready"].includes(moduleContract)) {
    return res.end(JSON.stringify(moduleContract !== missingModuleContract));
  }
  if (url.pathname === "/rest/v1/rpc/agentx_contact_phone") {
    if (missingContactMigration) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ code: "PGRST202", message: "Contact migration is missing" }));
    }
    return res.end(JSON.stringify("258841234567"));
  }
  if (url.pathname === "/rest/v1/rpc/agentx_seller_contract_ready") {
    if (missingSellerContract) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ code: "PGRST202", message: "Seller readiness contract missing" }));
    }
    return res.end(JSON.stringify(sellerContractReady));
  }
  if (url.pathname === "/rest/v1/rpc/agentx_seller_payments_ready") {
    if (missingPaymentContract) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ code: "PGRST202", message: "Payment readiness contract missing" }));
    }
    return res.end(JSON.stringify(paymentContractReady && sellerContractReady && !missingSellerContract));
  }
  if (url.pathname === "/rest/v1/rpc/agentx_seller_delivery_recovery_ready") {
    assert.equal(req.method, "GET");
    sellerDeliveryChecks++;
    if (sellerDeliveryState === "missing" || sellerDeliveryState === "denied") {
      res.statusCode = sellerDeliveryState === "missing" ? 404 : 403;
      return res.end(JSON.stringify({ code: sellerDeliveryState === "missing" ? "PGRST202" : "42501" }));
    }
    return res.end(JSON.stringify(sellerDeliveryState === "ready"));
  }
  if (url.pathname === "/auth/v1/user" && req.headers.authorization === `Bearer ${fakeToken}`) {
    return res.end(JSON.stringify({ id: fakeUser, aud: "authenticated", app_metadata: {}, user_metadata: {} }));
  }
  if (url.pathname === "/rest/v1/users" && url.searchParams.get("select") === "role,id") {
    return res.end(JSON.stringify([{ id: fakeUser, role: "user" }]));
  }
  if (url.pathname === "/rest/v1/agentx_group_payment_attachments") {
    assert.equal(url.searchParams.get("user_id"), `eq.${fakeUser}`);
    return res.end(JSON.stringify(url.searchParams.get("verification_id") === `eq.${groupAttachmentId}` ? [{
      storage_path: `${fakeUser}/${groupAttachmentId}`, file_name: "prova.pdf", mime_type: "application/pdf", size_bytes: groupDocument.length
    }] : []));
  }
  if (url.pathname === `/storage/v1/object/agentx-group-proofs/${fakeUser}/${groupAttachmentId}`) {
    res.setHeader("content-type", "application/pdf");
    return res.end(groupDocument);
  }
  if (url.pathname === "/rest/v1/contacts" && brokenCrm) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ code: "42703", message: "Schema fixture missing lid" }));
  }
  if (url.pathname === "/rest/v1/contacts" && unavailableCrm) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ code: "08006", message: "Fixture connection failure" }));
  }
  if (url.pathname === "/rest/v1/agentx_seller_settings" && missingSellerMigration) {
    res.statusCode = 404;
    return res.end(JSON.stringify({ code: "PGRST205", message: "Seller migration is missing" }));
  }
  if (url.pathname === "/rest/v1/leads" && missingLeadColumn) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ code: "42703", message: "column leads.last_action does not exist" }));
  }
  if (req.method === "GET" && url.pathname.startsWith("/rest/v1/")) return res.end("[]");
  res.statusCode = 404;
  return res.end("{}");
});
supabase.listen(0, "127.0.0.1");
await once(supabase, "listening");
const fixtureUrl = `http://127.0.0.1:${supabase.address().port}`;
const appEnv = { ...process.env, PORT: "0", NODE_ENV: "production", SUPABASE_URL: fixtureUrl, VITE_SUPABASE_URL: fixtureUrl,
  SUPABASE_SERVICE_ROLE_KEY: fakeSecret, VITE_SUPABASE_ANON_KEY: publicKey, GEMINI_API_KEY: fakeAiKey,
  VITE_API_URL: "", AGENTX_RELEASE: revision, DISABLE_WHATSAPP_RECONNECT: "true", DISABLE_SCHEDULER: "true",
  DISABLE_DIGITAL_DELIVERY_WORKER: "false" };
const tsx = "node_modules/tsx/dist/cli.mjs";

function preflight(env = appEnv) {
  return run(process.execPath, [tsx, "scripts/check-agentx-release.ts"], { env, timeout: 12_000 });
}

async function startApp(env = appEnv) {
  const child = spawn(process.execPath, [tsx, "server.ts"], {
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => { logs = (logs + data).slice(-12000); });
  const exit = once(child, "close");
  const stop = async () => {
    if (child.exitCode === null) child.kill("SIGTERM");
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
    try { await exit; } finally { clearTimeout(timeout); }
  };
  for (let attempt = 0; attempt < 450; attempt++) {
    const matches = /Server listening on port (\d+)/.exec(logs);
    if (matches) return { base: `http://127.0.0.1:${matches[1]}`, stop, logs: () => logs };
    if (child.exitCode !== null) break;
    await delay(100);
  }
  await stop();
  throw new Error(`Server failed to start\n${logs}`);
}

async function assertDegradedReadiness({ env = appEnv, module = "sales", state = "migration_required" } = {}) {
  const degraded = await startApp(env);
  try {
    const [liveness, readiness, login, operations] = await Promise.all([
      fetch(degraded.base + "/api/health"), fetch(degraded.base + "/api/ready"), fetch(degraded.base + "/login"),
      fetch(degraded.base + "/api/operations", { headers: { authorization: `Bearer ${fakeToken}` } })
    ]);
    assert.equal(liveness.status, 200);
    assert.equal(readiness.status, 503);
    assert.deepEqual(await readiness.json(), { ready: false, release: revision });
    assert.equal(login.status, 200);
    const html = await login.text();
    assert.match(html, /<div id="root">/);
    assert.ok(!html.includes(fakeSecret) && !html.includes(fakeAiKey));
    assert.equal(operations.status, 200);
    assert.equal((await operations.json()).modules[module], state);
  } finally {
    await degraded.stop();
  }
  assert.equal(sqlBootstrapCalls, 0, "Application startup must not call exec_sql on an incomplete schema");
  const diagnostic = state === "migration_required" ? /Esquema Supabase por atualizar[\s\S]*DEPLOY_VPS\.md/ : /Supabase está indisponível/;
  assert.match(degraded.logs(), diagnostic);
  assert.ok(!degraded.logs().includes(fakeSecret) && !degraded.logs().includes(fakeAiKey));
}

try {
  const misplacedKey = `fixture.${Buffer.from('{"role":"service_role"}').toString("base64url")}.fixture`;
  await assert.rejects(preflight({ ...appEnv, VITE_SUPABASE_ANON_KEY: misplacedKey }), (error) => {
    assert.match(error.stderr, /VITE_SUPABASE_ANON_KEY deve conter a chave pública/);
    assert.ok(!error.stderr.includes(misplacedKey) && !error.stdout.includes(misplacedKey));
    return error.code === 1;
  });
  const preflightResult = await preflight();
  assert.match(preflightResult.stdout, /Pré-verificação concluída/);

  const healthy = await startApp();
  try {
    const request = (path, auth = false) => fetch(healthy.base + path, {
      headers: auth ? { authorization: `Bearer ${fakeToken}` } : {}, signal: AbortSignal.timeout(10_000)
    });
    const readiness = await request("/api/ready");
    assert.equal(readiness.status, 200);
    assert.ok(readiness.headers.get("x-request-id"));
    assert.deepEqual(await readiness.json(), { ready: true, release: revision });
    assert.equal((await request("/api/operations")).status, 401);

    const status = await (await request("/api/operations", true)).json();
    assert.equal(status.modules.crm, "ready");
    assert.equal(status.modules.sales, "ready");
    for (const module of ["agenda", "bookings", "groups"]) assert.equal(status.modules[module], "ready");
    assert.equal(status.whatsapp, "disconnected");
    assert.equal(status.schedulerEnabled, false);
    assert.equal(status.deliveryWorker.state, "running");
    assert.ok(workerCalls > 0);

    const attachment = (id) => `/api/commerce/verifications/${id}/attachment`;
    assert.equal((await request(attachment(groupAttachmentId))).status, 401);
    assert.equal((await request(attachment(unrelatedAttachmentId), true)).status, 404);
    const file = await request(attachment(groupAttachmentId), true);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("cache-control"), "no-store");
    assert.deepEqual(await file.json(), { success: true, name: "prova.pdf", mime: "application/pdf", base64: groupDocument.toString("base64") });

    const unknown = await request("/api");
    assert.equal(unknown.status, 404);
    assert.match(unknown.headers.get("content-type"), /application\/json/);
    assert.equal((await request("/api/debug/db")).status, 404);
    const html = await (await request("/dashboard")).text();
    assert.ok(html.includes(publicKey));
    assert.ok(!html.includes(fakeSecret) && !html.includes(fakeAiKey));
  } finally {
    await healthy.stop();
  }

  missingSellerMigration = true;
  await assert.rejects(preflight(), { code: 1, stderr: sellerMigrations });
  missingSellerMigration = false;
  missingLeadColumn = true;
  await assert.rejects(preflight(), { code: 1, stderr: sellerMigrations });
  await assertDegradedReadiness();
  missingLeadColumn = false;
  missingSellerContract = true;
  await assert.rejects(preflight(), { code: 1, stderr: sellerMigrations });
  await assertDegradedReadiness();
  missingSellerContract = false;
  sellerContractReady = false;
  await assert.rejects(preflight(), { code: 1, stderr: sellerMigrations });
  sellerContractReady = true;
  missingPaymentContract = true;
  await assert.rejects(preflight(), { code: 1, stderr: sellerMigrations });
  await assertDegradedReadiness();
  missingPaymentContract = false;
  paymentContractReady = false;
  await assert.rejects(preflight(), { code: 1, stderr: sellerMigrations });
  paymentContractReady = true;
  missingContactMigration = true;
  await assert.rejects(preflight(), { code: 1, stderr: /esquema principal do CRM/ });
  missingContactMigration = false;
  brokenCrm = true;
  await assert.rejects(preflight(), { code: 1, stderr: /esquema principal do CRM/ });
  await assertDegradedReadiness({ module: "crm" });
  brokenCrm = false;
  missingLeadColumn = true;
  await assertDegradedReadiness({ env: { ...appEnv, NODE_ENV: "development" } });
  missingLeadColumn = false;
  unavailableCrm = true;
  await assertDegradedReadiness({ module: "crm", state: "unavailable" });
  unavailableCrm = false;
  for (const [contract, migration] of [["agentx_schedule_dispatch_ready", 23], ["agentx_appointment_contract_ready", 24], ["agentx_group_proof_contract_ready", 25]]) {
    missingModuleContract = contract;
    await assert.rejects(preflight(), { code: 1, stderr: new RegExp(String(migration)) });
  }
  missingModuleContract = "";
  for (const state of ["missing", "denied", "incomplete"]) {
    sellerDeliveryState = state;
    await assert.rejects(preflight(), { code: 1, stderr: /migração 26.*26_seller_delivery_recovery\.sql/ });
  }
  sellerDeliveryState = "ready";
  for (const [index, contract] of workflowContracts.entries()) {
    missingWorkflowContract = contract;
    await assert.rejects(preflight(), { code: 1, stderr: new RegExp(`supabase/migrations/${index + 27}_`) });
  }
  missingWorkflowContract = "";
  const checksBeforeRuntime = sellerDeliveryChecks;
  const compatible = await startApp();
  try {
    const readiness = await fetch(compatible.base + "/api/ready");
    assert.equal(readiness.status, 200);
    assert.deepEqual(await readiness.json(), { ready: true, release: revision });
  } finally {
    await compatible.stop();
  }
  assert.equal(sellerDeliveryChecks, checksBeforeRuntime, "Migration 26 is checked only during release preflight");
  console.log("AgentX HTTP smoke passed (read-only startup in development and production, readiness, migrations, private proofs, auth and delivery worker)");
} finally {
  supabase.closeAllConnections();
  supabase.close();
}
