"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "src", "whatsappRegistration.js"), "utf8");
const context = vm.createContext({ Object, Array, String, Number, Date, RegExp, Math, JSON, isFinite, parseInt });
vm.runInContext(source, context, { filename: "whatsappRegistration.js" });
const moduleUnderTest = context.ReclaimWhatsAppRegistration;
function fixture(options = {}) {
  const state = { sessions: new Map(), events: new Map(), registrations: [], parseCalls: 0, verifyCalls: 0, routeCalls: 0, nextId: 0, sessionPutCalls: 0 };
  const key = (org, sender) => org + "|" + sender;
  const deps = {
    verifyWebhook: () => { state.verifyCalls++; return options.verified !== false; },
    parseWebhook: request => { state.parseCalls++; if (options.parseThrows) throw new Error("bad"); return request.payload; },
    resolveOrganization: request => { state.routeCalls++; return Object.prototype.hasOwnProperty.call(options, "organization") ? options.organization : (request.trustedRoute || ""); },
    digestEvent: event => JSON.stringify({ eventId: event.eventId, senderId: event.senderId, type: event.type, text: event.text, latitude: event.latitude, longitude: event.longitude }),
    eventStore: {
      begin(id, digest, org) {
        const previous = state.events.get(org + "|" + id);
        if (!previous) { state.events.set(org + "|" + id, { digest, org, status: "PROCESSING" }); return { status: "NEW" }; }
        if (previous.digest !== digest || previous.org !== org) return { status: "CONFLICT" };
        if (previous.status === "COMPLETE") return { status: "REPLAY", result: previous.result };
        return { status: "IN_PROGRESS" };
      },
      complete(id, digest, org, result) {
        if (options.failComplete) throw new Error("completion unavailable");
        const key = org + "|" + id, previous = state.events.get(key);
        if (!previous || previous.digest !== digest || previous.status !== "PROCESSING") throw new Error("claim mismatch");
        state.events.set(key, { digest, org, status: "COMPLETE", result });
      },
      release(id, digest, org) {
        const key = org + "|" + id, previous = state.events.get(key);
        if (previous && previous.digest === digest && previous.status === "PROCESSING") state.events.delete(key);
      }
    },
    sessionStore: {
      get: (org, sender) => state.sessions.get(key(org, sender)) || null,
      put: (org, sender, value) => { state.sessionPutCalls++; if (options.failFirstSessionPut && state.sessionPutCalls === 1) throw new Error("session unavailable"); state.sessions.set(key(org, sender), JSON.parse(JSON.stringify(value))); },
      remove: (org, sender) => state.sessions.delete(key(org, sender)),
      withSenderLock: (org, sender, callback) => callback()
    },
    createRegistration: request => {
      if (options.persistThrows) throw new Error("write failed");
      if (options.persistNotDurable) return { ok: true, durable: false };
      state.registrations.push(request);
      return { ok: true, durable: true, registrationId: request.registrationId };
    },
    now: () => 1_800_000_000_000,
    idGenerator: prefix => prefix + "-" + (++state.nextId)
  };
  return { api: moduleUnderTest.create(deps), state, deps };
}
const req = event => ({ trustedRoute: "ORG_A", payload: { events: [event] } });
const txt = (eventId, text, senderId = "whatsapp:+26770000001", extra = {}) => ({ eventId, senderId, type: "text", text, ...extra });
const loc = (eventId, latitude = -24.6282, longitude = 25.9231, senderId = "whatsapp:+26770000001") => ({ eventId, senderId, type: "location", latitude, longitude });
function run(api, event, requestOverrides = {}) {
  return api.handleWebhook({ ...req(event), ...requestOverrides });
}
function message(result) { return result.results[0].message; }
function send(api, event) { return run(api, event); }
function beginNameLocationConfirm(f) {
  send(f.api, txt("e1", "hello"));
  send(f.api, txt("e2", "Synthetic Customer"));
  send(f.api, loc("e3"));
}
test("webhook authenticity is checked before parsing or routing", () => {
  const f = fixture({ verified: false });
  const result = run(f.api, txt("e1", "hello"));
  assert.equal(result.error.code, "WEBHOOK_UNAUTHENTICATED");
  assert.equal(f.state.parseCalls, 0);
  assert.equal(f.state.routeCalls, 0);
});
test("missing integration dependencies fail closed", () => {
  const api = moduleUnderTest.create({});
  assert.equal(api.handleWebhook({}).error.code, "INTEGRATION_NOT_CONFIGURED");
});
test("malformed payloads and unsupported event types are rejected", () => {
  const f = fixture();
  assert.equal(f.api.handleWebhook({ trustedRoute: "ORG_A", payload: { events: "no" } }).error.code, "INVALID_WEBHOOK");
  const g = fixture();
  assert.equal(run(g.api, { eventId: "e", senderId: "s", type: "image" }).error.code, "INVALID_EVENT");
  const h = fixture({ parseThrows: true });
  assert.equal(h.api.handleWebhook({}).error.code, "INVALID_WEBHOOK");
});
test("unconfigured trusted company route fails closed and customer-supplied organization is ignored", () => {
  const f = fixture({ organization: "" });
  const result = run(f.api, { ...txt("e1", "hello"), organizationId: "ORG_B", actorId: "admin", role: "PLATFORM_ADMIN" });
  assert.equal(result.error.code, "COMPANY_ROUTE_UNAVAILABLE");
  assert.equal(f.state.sessions.size, 0);
  const g = fixture();
  send(g.api, { ...txt("e1", "hello"), organizationId: "ORG_B", actorId: "admin", role: "PLATFORM_ADMIN" });
  assert.equal(g.state.routeCalls, 1);
  assert.equal(g.state.sessions.has("ORG_A|whatsapp:+26770000001"), true);
  assert.equal(g.state.sessions.has("ORG_B|whatsapp:+26770000001"), false);
});
test("valid flow requires name, WhatsApp location, and explicit confirmation before durable registration", () => {
  const f = fixture();
  assert.match(message(send(f.api, txt("e1", "hello"))), /full name/i);
  assert.match(message(send(f.api, txt("e2", "Synthetic Customer"))), /share your location/i);
  assert.match(message(send(f.api, txt("e3", "address: UB campus"))), /share your WhatsApp location/i);
  assert.match(message(send(f.api, loc("e4"))), /Reply CONFIRM/i);
  assert.equal(f.state.registrations.length, 0);
  const done = send(f.api, txt("e5", "CONFIRM"));
  assert.equal(done.results[0].code, "REGISTERED");
  assert.equal(f.state.registrations.length, 1);
  assert.equal(f.state.registrations[0].organizationId, "ORG_A");
  assert.equal(f.state.registrations[0].customerName, "Synthetic Customer");
  assert.equal(f.state.registrations[0].customerPhone, "whatsapp:+26770000001");
  assert.equal(f.state.registrations[0].latitude, -24.6282);
  assert.equal(f.state.registrations[0].longitude, 25.9231);
  assert.match(message(done), /not a collection booking/i);
  assert.equal(f.state.sessions.size, 0);
});
test("text address alone cannot satisfy coordinate requirement", () => {
  const f = fixture();
  send(f.api, txt("e1", "hello")); send(f.api, txt("e2", "Name"));
  const result = send(f.api, txt("e3", "Gaborone, Botswana"));
  assert.match(message(result), /cannot replace latitude and longitude/i);
  assert.equal(f.state.registrations.length, 0);
});
test("invalid coordinates are rejected before advancing to confirmation", () => {
  for (const [lat, lon] of [[91, 20], [-91, 20], [20, 181], [20, -181], ["-24", 25], [NaN, 25]]) {
    const f = fixture();
    send(f.api, txt("e1", "hello")); send(f.api, txt("e2", "Name"));
    const result = send(f.api, loc("e3", lat, lon));
    assert.equal(result.error.code, "INVALID_EVENT");
    assert.equal(f.state.registrations.length, 0);
  }
});
test("overlong name is rejected and correction is possible", () => {
  const f = fixture();
  send(f.api, txt("e1", "hello"));
  const longName = send(f.api, txt("e2", "x".repeat(121)));
  assert.match(message(longName), /too long/i);
  assert.equal(f.state.sessions.get("ORG_A|whatsapp:+26770000001").step, "NAME");
  assert.match(message(send(f.api, txt("e3", "Correct Name"))), /share your location/i);
});
test("edit restarts data collection and does not submit prematurely", () => {
  const f = fixture(); beginNameLocationConfirm(f);
  assert.match(message(send(f.api, txt("e4", "EDIT"))), /send your full name/i);
  assert.equal(f.state.registrations.length, 0);
  assert.equal(f.state.sessions.get("ORG_A|whatsapp:+26770000001").step, "NAME");
});
test("cancel removes session and does not create a registration", () => {
  const f = fixture(); send(f.api, txt("e1", "hello"));
  assert.equal(send(f.api, txt("e2", "STOP")).results[0].code, "CANCELLED");
  assert.equal(f.state.sessions.size, 0);
  assert.equal(f.state.registrations.length, 0);
});
test("duplicate event is ignored and conflicting event ID is rejected", () => {
  const f = fixture();
  assert.equal(send(f.api, txt("e1", "hello")).results[0].code, "CONTINUE");
  assert.equal(send(f.api, txt("e1", "hello")).results[0].code, "DUPLICATE_IGNORED");
  assert.equal(send(f.api, txt("e1", "different content")).error.code, "EVENT_ID_CONFLICT");
  assert.equal(f.state.sessions.get("ORG_A|whatsapp:+26770000001").step, "NAME");
});
test("sender sessions are isolated by company and sender", () => {
  const f = fixture();
  send(f.api, txt("e1", "hello", "sender-A"));
  send(f.api, txt("e2", "hello", "sender-B"));
  send(f.api, txt("e3", "Alice", "sender-A"));
  assert.equal(f.state.sessions.get("ORG_A|sender-A").step, "LOCATION");
  assert.equal(f.state.sessions.get("ORG_A|sender-B").step, "NAME");
});
test("success is never claimed when registration persistence throws or is not durable", () => {
  for (const opts of [{ persistThrows: true }, { persistNotDurable: true }]) {
    const f = fixture(opts); beginNameLocationConfirm(f);
    const result = send(f.api, txt("e4", "CONFIRM"));
    assert.equal(result.results[0].code, "PERSISTENCE_UNAVAILABLE");
    assert.notEqual(result.results[0].code, "REGISTERED");
    assert.equal(f.state.sessions.size, 1);
  }
});
test("expired session restarts rather than submitting stale information", () => {
  const f = fixture(); send(f.api, txt("e1", "hello"));
  f.state.sessions.get("ORG_A|whatsapp:+26770000001").expiresAt = 1;
  const result = send(f.api, txt("e2", "CONFIRM"));
  assert.match(message(result), /full name/i);
  assert.equal(f.state.registrations.length, 0);
});
test("registration callback receives no client-supplied actor or role fields", () => {
  const f = fixture(); beginNameLocationConfirm(f);
  send(f.api, { ...txt("e4", "CONFIRM"), actorId: "admin", role: "PLATFORM_ADMIN", organizationId: "ORG_B" });
  assert.equal(f.state.registrations[0].organizationId, "ORG_A");
  assert.equal(Object.hasOwn(f.state.registrations[0], "actorId"), false);
  assert.equal(Object.hasOwn(f.state.registrations[0], "role"), false);
});
test("provider event batches are bounded", () => {
  const f = fixture();
  const result = f.api.handleWebhook({ trustedRoute: "ORG_A", payload: { events: Array.from({ length: 21 }, (_, i) => txt("e"+i, "hello")) } });
  assert.equal(result.error.code, "INVALID_WEBHOOK");
});

test("failed session write releases the event for a safe retry", () => {
  const f = fixture({ failFirstSessionPut: true });
  const first = send(f.api, txt("retry-event", "hello"));
  assert.equal(first.error.code, "SESSION_STORE_UNAVAILABLE");
  assert.equal(f.state.sessions.size, 0);
  const retry = send(f.api, txt("retry-event", "hello"));
  assert.equal(retry.results[0].code, "CONTINUE");
  assert.equal(f.state.sessions.size, 1);
});
test("in-progress duplicate event does not mutate session state", () => {
  const f = fixture();
  f.state.events.set("ORG_A|busy-event", { digest: JSON.stringify({ eventId: "busy-event", senderId: "whatsapp:+26770000001", type: "text", text: "hello" }), org: "ORG_A", status: "PROCESSING" });
  const result = send(f.api, txt("busy-event", "hello"));
  assert.equal(result.results[0].code, "EVENT_IN_PROGRESS");
  assert.equal(f.state.sessions.size, 0);
});
test("uncertain event completion never reports successful processing", () => {
  const f = fixture({ failComplete: true });
  const result = send(f.api, txt("complete-failure", "hello"));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "EVENT_STORE_UNAVAILABLE");
  assert.equal(f.state.sessions.size, 1);
});
