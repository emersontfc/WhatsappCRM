import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const fakeUser = "00000000-0000-4000-8000-000000000001";
const fakeToken = "agentx-integration-session";
const fakeSecret = "sb_secret_agentx-smoke-test-service-key";
const fakeAiKey = "agentx-smoke-test-gemini-key";
const publicKey = "sb_publishable_agentx_smoke-test";
const revision = "a123bcd";
const run = promisify(execFile);
let workerCalls = 0;
let brokenCrm = false;
let missingContactMigration = false;
let missingSellerMigration = false;
let missingLeadColumn = false;
let missingSellerContract = false;
let sellerContractReady = true;

const supabase = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  res.setHeader("content-type", "application/json");
  if (req.headers.apikey !== fakeSecret) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ message: "Invalid fixture API key" }));
  }
  if (url.pathname === "/rest/v1/rpc/agentx_process_digital_deliveries") {
    workerCalls++;
    return res.end("0");
  }
  if (url.pathname === "/rest/v1/rpc/agentx_schedule_contract_ready") return res.end("false");
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
  if (url.pathname === "/auth/v1/user" && req.headers.authorization === `Bearer ${fakeToken}`) {
    return res.end(JSON.stringify({ id: fakeUser, aud: "authenticated", app_metadata: {}, user_metadata: {} }));
  }
  if (url.pathname === "/rest/v1/users" && url.searchParams.get("select") === "role,id") {
    return res.end(JSON.stringify([{ id: fakeUser, role: "user" }]));
  }
  if (url.pathname === "/rest/v1/contacts" && brokenCrm) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ code: "42703", message: "Schema fixture missing lid" }));
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

async function startApp() {
  const child = spawn(process.execPath, [tsx, "server.ts"], {
    env: appEnv,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => { logs = (logs + data).slice(-12000); });
  const exit = once(child, "exit");
  const stop = async () => {
    if (child.exitCode === null) child.kill("SIGTERM");
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
    try { await exit; } finally { clearTimeout(timeout); }
  };
  for (let attempt = 0; attempt < 200; attempt++) {
    const matches = /Server listening on port (\d+)/.exec(logs);
    if (matches) return { base: `http://127.0.0.1:${matches[1]}`, stop };
    if (child.exitCode !== null) break;
    await delay(100);
  }
  await stop();
  throw new Error(`Server failed to start\n${logs}`);
}

async function assertDegradedReadiness() {
  const degraded = await startApp();
  try {
    const liveness = await fetch(degraded.base + "/api/health");
    const readiness = await fetch(degraded.base + "/api/ready");
    assert.equal(liveness.status, 200);
    assert.equal(readiness.status, 503);
    assert.deepEqual(await readiness.json(), { ready: false, release: revision });
  } finally {
    await degraded.stop();
  }
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
    assert.equal(status.modules.agenda, "migration_required");
    assert.equal(status.whatsapp, "disconnected");
    assert.equal(status.schedulerEnabled, false);
    assert.equal(status.deliveryWorker.state, "running");
    assert.ok(workerCalls > 0);

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
  await assert.rejects(preflight(), { code: 1, stderr: /migrações 20 e 21/ });
  missingSellerMigration = false;
  missingLeadColumn = true;
  await assert.rejects(preflight(), { code: 1, stderr: /migrações 20 e 21/ });
  await assertDegradedReadiness();
  missingLeadColumn = false;
  missingSellerContract = true;
  await assert.rejects(preflight(), { code: 1, stderr: /migrações 20 e 21/ });
  await assertDegradedReadiness();
  missingSellerContract = false;
  sellerContractReady = false;
  await assert.rejects(preflight(), { code: 1, stderr: /migrações 20 e 21/ });
  sellerContractReady = true;
  missingContactMigration = true;
  await assert.rejects(preflight(), { code: 1, stderr: /esquema principal do CRM/ });
  missingContactMigration = false;
  brokenCrm = true;
  await assert.rejects(preflight(), { code: 1, stderr: /esquema principal do CRM/ });
  await assertDegradedReadiness();
  console.log("AgentX production HTTP smoke passed (ready, degraded schema, auth and delivery worker)");
} finally {
  supabase.closeAllConnections();
  supabase.close();
}
