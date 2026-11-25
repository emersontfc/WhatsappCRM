import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, request as proxyRequest } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import express from "express";

const rest = new URL(process.argv[2]);
assert.equal(rest.hostname, "127.0.0.1");
const secret = process.env.AGENTX_FIXTURE_JWT_SECRET;
assert.ok(secret);

const fixtureId = (value) => `90000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const owner = fixtureId(1);
const other = fixtureId(2);
const ownContact = fixtureId(11);
const otherContact = fixtureId(12);
const service = fixtureId(21);
const inactiveService = fixtureId(22);
const otherService = fixtureId(23);
const professional = fixtureId(31);
const anotherProfessional = fixtureId(32);
const otherProfessional = fixtureId(33);
const legacyAppointment = fixtureId(41);
const secondLegacyAppointment = fixtureId(42);

function token(role, sub) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const payload = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    role, sub, aud: role, exp: Math.floor(Date.now() / 1000) + 1800
  })}`;
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

const ownerToken = token("authenticated", owner);
const otherToken = token("authenticated", other);
const serviceToken = token("service_role");

for (let attempt = 0; ; attempt++) {
  const ready = await fetch(rest).catch(() => null);
  if (ready?.ok) break;
  if (attempt === 39) throw new Error("PostgREST failed to start");
  await delay(250);
}

const authProxy = createServer((req, res) => {
  if (req.url?.startsWith("/rest/v1/")) {
    const upstream = proxyRequest(new URL(req.url.slice("/rest/v1".length), rest), {
      method: req.method, headers: { ...req.headers, host: rest.host }
    }, (answer) => {
      res.writeHead(answer.statusCode, answer.headers);
      answer.pipe(res);
    });
    upstream.on("error", () => res.writeHead(502).end());
    req.pipe(upstream);
    return;
  }

  res.setHeader("content-type", "application/json");
  if (req.url === "/auth/v1/user") {
    const id = req.headers.authorization === `Bearer ${ownerToken}` ? owner
      : req.headers.authorization === `Bearer ${otherToken}` ? other : null;
    if (id) {
      res.end(JSON.stringify({ id, aud: "authenticated", role: "authenticated", email: `${id}@example.invalid` }));
      return;
    }
  }
  res.writeHead(401).end("{}");
});

authProxy.listen(0, "127.0.0.1");
await once(authProxy, "listening");
let apiServer;

try {
  process.env.SUPABASE_URL = `http://127.0.0.1:${authProxy.address().port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceToken;
  const [{ default: appointmentRoutes }, { whatsappManager }, { processAppointmentReminders }] = await Promise.all([
    import("../../backend/routes/appointments.ts"), import("../../backend/whatsappManager.ts"),
    import("../../backend/services/appointmentDelivery.ts")
  ]);

  let transport = "sent";
  let heldSend;
  const outbound = [];
  whatsappManager.sendMessage = async (userId, jid, text) => {
    if (transport === "offline") throw new Error("WhatsApp session not connected.");
    outbound.push({ userId, jid, text });
    if (transport === "hold") await new Promise((resolve) => { heldSend = resolve; });
    if (transport === "uncertain") return {};
    return { key: { id: `appointment-fixture-${outbound.length}` } };
  };

  const app = express();
  app.use(express.json());
  app.use("/api/appointments", appointmentRoutes);
  apiServer = app.listen(0, "127.0.0.1");
  await once(apiServer, "listening");
  const base = `http://127.0.0.1:${apiServer.address().port}/api/appointments`;

  async function call(path, { method = "GET", auth, body } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000)
    });
    return { status: response.status, body: await response.json() };
  }

  function expectStatus(result, expected) {
    const possible = Array.isArray(expected) ? expected : [expected];
    assert.ok(possible.includes(result.status), `Expected HTTP ${possible.join(" or ")}, got ${result.status} ${JSON.stringify(result.body)}`);
    return result.body;
  }

  async function select(path, credential = serviceToken) {
    const response = await fetch(new URL(path, rest), { headers: { authorization: `Bearer ${credential}` } });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  }

  async function updateFixture(table, id, body) {
    const response = await fetch(new URL(`/${table}?id=eq.${id}`, rest), {
      method: "PATCH",
      headers: { authorization: `Bearer ${serviceToken}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 204, await response.text());
  }

  async function until(check, description) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (check()) return;
      await delay(25);
    }
    throw new Error(`Timed out waiting for ${description}`);
  }

  const nextWorkday = new Date();
  nextWorkday.setUTCDate(nextWorkday.getUTCDate() + 2);
  while ([0, 6].includes(nextWorkday.getUTCDay())) nextWorkday.setUTCDate(nextWorkday.getUTCDate() + 1);
  const date = nextWorkday.toISOString().slice(0, 10);
  const weekend = new Date(nextWorkday);
  do { weekend.setUTCDate(weekend.getUTCDate() + 1); } while (weekend.getUTCDay() !== 0);

  const savedLegacy = (await select(`/appointments?id=eq.${legacyAppointment}`))[0];
  assert.equal(savedLegacy.notes, "Nota que existia antes da migração.");
  assert.equal(savedLegacy.status, "completed");
  assert.equal(savedLegacy.reminder_24h_sent, true);
  assert.equal(savedLegacy.reminder_2h_sent, true);
  assert.equal(savedLegacy.schedule_revision, "00000000-0000-0000-0000-000000000000");

  expectStatus(await call("/"), 401);
  const readOwnAppointments = () => call("/", { auth: ownerToken });
  const legacyAppointments = expectStatus(await readOwnAppointments(), 200).data;
  const [firstLegacy, secondLegacy] = [legacyAppointment, secondLegacyAppointment]
    .map((fixture) => legacyAppointments.find(({ id }) => id === fixture));
  assert.equal(firstLegacy.schedule_revision, secondLegacy.schedule_revision);
  assert.deepEqual(firstLegacy.notification_statuses, { manual: "sent" });
  assert.deepEqual(secondLegacy.notification_statuses, { manual: "uncertain" });

  const listing = expectStatus(await call(`/public/info/${owner}`), 200).data;
  assert.equal(listing.business.name, "Loja Maputo");
  assert.equal(listing.timeZone, "Africa/Maputo");
  assert.equal(listing.business.email, undefined);
  assert.deepEqual(listing.services.map(({ id }) => id), [service]);
  assert.deepEqual(listing.professionals.map(({ id }) => id), [professional, anotherProfessional]);
  expectStatus(await call(`/public/info/${fixtureId(3)}`), 404);

  function slots(overrides) {
    return call(`/public/slots?${new URLSearchParams({ userId: owner, serviceId: service, professionalId: professional, date, ...overrides })}`);
  }

  const opening = expectStatus(await slots(), 200);
  assert.equal(opening.durationMinutes, 30);
  assert.equal(opening.slots[0], "09:00");
  assert.ok(opening.slots.includes("11:30") && opening.slots.includes("13:00"));
  assert.ok(!opening.slots.includes("12:00") && !opening.slots.includes("12:30"));
  assert.deepEqual(expectStatus(await slots({ date: weekend.toISOString().slice(0, 10) }), 200).slots, []);
  expectStatus(await slots({ date: "2026-02-30" }), 400);
  expectStatus(await slots({ serviceId: inactiveService }), 404);
  expectStatus(await slots({ serviceId: otherService }), 404);
  expectStatus(await slots({ professionalId: otherProfessional }), 404);

  const publicBody = {
    userId: owner, serviceId: service, professionalId: professional, requestId: randomUUID(),
    customerName: "Cliente da agenda", customerPhone: "84 999 8888",
    appointmentDate: date, startTime: "09:00", notes: "Nota privada que não deve aparecer no WhatsApp."
  };
  const book = (body) => call("/public/book", { method: "POST", body });
  expectStatus(await book({ ...publicBody, startTime: "12:00", requestId: randomUUID() }), 409);
  expectStatus(await book({ ...publicBody, startTime: "09:05", requestId: randomUUID() }), 409);
  expectStatus(await book({ ...publicBody, serviceId: otherService, requestId: randomUUID() }), 404);
  expectStatus(await book({ ...publicBody, professionalId: otherProfessional, requestId: randomUUID() }), 404);
  assert.equal(outbound.length, 0);

  const otherPublicBody = {
    ...publicBody, requestId: randomUUID(), customerName: "Outro cliente", customerPhone: "84 999 8877"
  };
  const simultaneous = await Promise.all([book(publicBody), book(otherPublicBody)]);
  const winner = simultaneous.findIndex(({ status }) => status === 200 || status === 201);
  assert.notEqual(winner, -1, JSON.stringify(simultaneous));
  const reserved = expectStatus(simultaneous[winner], [200, 201]);
  expectStatus(simultaneous[1 - winner], 409);
  assert.ok(reserved.data?.id, JSON.stringify(reserved));
  assert.equal(reserved.confirmation, "sent");
  assert.equal(reserved.data.time_zone, "Africa/Maputo");
  assert.equal(reserved.data.customer_phone, undefined);
  assert.equal(reserved.data.notes, undefined);
  const bookingId = reserved.data.id;
  const [publicAppointment, ...remaining] = await select(`/appointments?appointment_date=eq.${date}`);
  assert.equal(remaining.length, 0);
  assert.equal(Date.parse(publicAppointment.start_at), Date.parse(date + "T07:00:00Z"));
  assert.equal(outbound.length, 1);
  assert.equal(outbound[0].userId, owner);
  const canonicalPhone = winner === 0 ? "258849998888" : "258849998877";
  assert.equal(publicAppointment.customer_phone, canonicalPhone);
  assert.equal(outbound[0].jid, `${canonicalPhone}@s.whatsapp.net`);
  assert.match(outbound[0].text, /09:00/);
  assert.doesNotMatch(outbound[0].text, /Nota privada|Cliente da agenda|Outro cliente/);
  const winningRequest = [publicBody, otherPublicBody][winner];
  const replayed = expectStatus(await book(winningRequest), [200, 201]);
  assert.equal(replayed.data.id, bookingId);
  assert.equal(replayed.replayed, true);
  expectStatus(await book({ ...winningRequest, startTime: "09:30" }), 409);
  assert.equal(outbound.length, 1);
  const afterBooking = expectStatus(await slots(), 200).slots;
  assert.ok(!afterBooking.includes("09:00") && afterBooking.includes("09:30"));

  const scoped = expectStatus(await call("/", { auth: otherToken }), 200).data;
  assert.deepEqual(scoped, []);
  assert.deepEqual(await select(`/appointments?id=eq.${bookingId}`, otherToken), []);
  expectStatus(await call(`/${bookingId}`, { method: "PUT", auth: otherToken, body: { status: "cancelled" } }), 404);

  const dashboardBody = {
    contact_id: ownContact, service_id: service, professional_id: professional,
    customer_name: "Cliente anterior", customer_phone: "258849998888",
    appointment_date: date, start_time: "09:00"
  };
  const create = (body) => call("/", { method: "POST", auth: ownerToken, body });
  for (const patch of [{ contact_id: otherContact }, { service_id: otherService }, { professional_id: otherProfessional }]) {
    expectStatus(await create({ ...dashboardBody, ...patch, start_time: "10:00" }), 404);
  }
  expectStatus(await create(dashboardBody), 409);
  const parallelProfessional = expectStatus(await create({
    ...dashboardBody, professional_id: anotherProfessional, contact_id: null, customer_phone: "258849999901"
  }), [200, 201]).data;
  assert.ok(parallelProfessional?.id);

  const put = (body) => call(`/${bookingId}`, { method: "PUT", auth: ownerToken, body });
  const reminder = () => call(`/${bookingId}/reminder`, { method: "POST", auth: ownerToken });
  transport = "hold";
  const inFlight = reminder();
  try {
    await until(() => heldSend, "the start of the first reminder");
    expectStatus(await reminder(), 409);
    expectStatus(await put({ start_time: "10:00" }), 409);
    expectStatus(await call(`/${bookingId}`, { method: "DELETE", auth: ownerToken }), 409);
    assert.equal(outbound.length, 2);
  } finally {
    transport = "sent";
    heldSend?.();
  }
  expectStatus(await inFlight, 200);
  expectStatus(await reminder(), 200);
  assert.equal(outbound.length, 2);

  const beforeReschedule = (await select(`/appointments?id=eq.${bookingId}`))[0];
  const rescheduled = expectStatus(await put({ start_time: "10:00" }), 200).data;
  assert.equal(rescheduled.start_time.slice(0, 5), "10:00");
  assert.equal(rescheduled.end_time.slice(0, 5), "10:30");
  assert.notEqual(rescheduled.schedule_revision, beforeReschedule.schedule_revision);
  assert.equal(rescheduled.reminder_2h_sent, false);

  transport = "uncertain";
  expectStatus(await reminder(), 409);
  transport = "sent";
  expectStatus(await reminder(), 409);
  assert.equal(outbound.length, 3);
  const afterUncertainty = expectStatus(await readOwnAppointments(), 200).data.find(({ id }) => id === bookingId);
  assert.equal(afterUncertainty.notification_statuses.manual, "uncertain");

  const retryAppointment = expectStatus(await create({ ...dashboardBody, start_time: "11:00" }), [200, 201]).data;
  transport = "offline";
  const retryReminder = () => call(`/${retryAppointment.id}/reminder`, { method: "POST", auth: ownerToken });
  expectStatus(await retryReminder(), 503);
  assert.equal(outbound.length, 3);
  const afterOffline = expectStatus(await readOwnAppointments(), 200).data.find(({ id }) => id === retryAppointment.id);
  assert.equal(afterOffline.notification_statuses?.manual, "retry");
  transport = "sent";
  expectStatus(await retryReminder(), 503);
  assert.equal(outbound.length, 3);
  const [deferred] = await select(`/agentx_appointment_notifications?appointment_id=eq.${retryAppointment.id}&kind=eq.manual`);
  assert.equal(deferred.attempts, 1);
  await updateFixture("agentx_appointment_notifications", deferred.id, { available_at: new Date(Date.now() - 5000).toISOString() });
  const currentTime = new Date();
  await Promise.all([processAppointmentReminders(currentTime), processAppointmentReminders(currentTime)]);
  const [finished] = await select(`/agentx_appointment_notifications?id=eq.${deferred.id}`);
  assert.equal(finished.status, "sent");
  assert.equal(finished.attempts, 2);
  assert.equal(finished.whatsapp_message_id, "appointment-fixture-4");
  assert.equal(outbound.length, 4);

  // Move a fixture into the reminder window so the test can run at any hour.
  const nearStart = new Date(Date.now() + 75 * 60_000);
  const maputoStart = new Date(nearStart.getTime() + 2 * 3_600_000).toISOString();
  await updateFixture("appointments", parallelProfessional.id, {
    appointment_date: maputoStart.slice(0, 10), start_time: maputoStart.slice(11, 16), start_at: nearStart.toISOString()
  });
  const nearReminder = () => call(`/${parallelProfessional.id}/reminder`, { method: "POST", auth: ownerToken });
  await Promise.all([processAppointmentReminders(new Date()), processAppointmentReminders(new Date())]);
  assert.equal(outbound.length, 5);
  assert.equal(expectStatus(await nearReminder(), 200).alreadySent, true);
  assert.equal(outbound.length, 5);
  assert.equal(outbound[4].jid, "258849999901@s.whatsapp.net");
  const [dueReminder, ...duplicateReminders] = await select(`/agentx_appointment_notifications?appointment_id=eq.${parallelProfessional.id}`);
  assert.equal(duplicateReminders.length, 0);
  assert.equal(dueReminder.kind, "reminder_2h");
  assert.equal(dueReminder.whatsapp_message_id, "appointment-fixture-5");
  const [nearAppointment] = await select(`/appointments?id=eq.${parallelProfessional.id}`);
  assert.equal(nearAppointment.reminder_2h_sent, true);
  assert.equal(nearAppointment.reminder_24h_sent, false);

  // Stop after the booking transaction, as if the HTTP process died before trying to send the confirmation.
  const committed = await fetch(new URL("/rpc/agentx_save_appointment", rest), {
    method: "POST", headers: { authorization: `Bearer ${serviceToken}`, "content-type": "application/json" },
    body: JSON.stringify({ p_user: owner, p_appointment: null, p_public: true, p_input: {
      appointment_date: date, start_time: "11:30", service_id: service, professional_id: professional,
      customer_name: "Cliente após reinício", customer_phone: "258849999902", request_id: randomUUID()
    } })
  });
  assert.equal(committed.status, 200, await committed.clone().text());
  const { appointment: queuedBooking } = await committed.json();
  const [pendingConfirmation] = await select(`/agentx_appointment_notifications?appointment_id=eq.${queuedBooking.id}`);
  assert.equal(pendingConfirmation.kind, "confirmation");
  assert.equal(pendingConfirmation.status, "retry");
  assert.equal(pendingConfirmation.attempts, 0);
  await Promise.all([processAppointmentReminders(new Date()), processAppointmentReminders(new Date())]);
  const [sentConfirmation] = await select(`/agentx_appointment_notifications?id=eq.${pendingConfirmation.id}`);
  assert.equal(sentConfirmation.status, "sent");
  assert.equal(sentConfirmation.whatsapp_message_id, "appointment-fixture-6");
  assert.equal(outbound.length, 6);
  assert.equal(outbound[5].jid, "258849999902@s.whatsapp.net");

  console.log("Appointment integration passed with PostgreSQL and PostgREST: public hours, tenant scope, concurrent booking, WhatsApp acknowledgement, rescheduling, unknown send containment and server retry after process interruption.");
} finally {
  apiServer?.closeAllConnections();
  apiServer?.close();
  authProxy.closeAllConnections();
  authProxy.close();
}
