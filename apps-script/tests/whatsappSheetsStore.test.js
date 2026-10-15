"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "whatsappSheetsStore.js"), "utf8");
const context = vm.createContext({ Object, Array, String, Number, Date, RegExp, Math, JSON, isFinite, parseInt });
vm.runInContext(source, context, { filename: "whatsappSheetsStore.js" });

function fakeSpreadsheet(options = {}) {
  const tabs = new Map();
  function sheet(name) {
    const data = [];
    function range(row, col, rowCount, colCount) {
      return {
        getValues() {
          return Array.from({ length: rowCount }, (_, r) =>
            Array.from({ length: colCount }, (_, c) => (data[row - 1 + r] || [])[col - 1 + c] ?? ""));
        },
        setValues(values) {
          if (options.failSetBeforeWriteTab === name) {
            options.failSetBeforeWriteTab = "";
            throw new Error("synthetic setValues failure before write");
          }
          values.forEach((valuesRow, r) => {
            const index = row - 1 + r;
            if (!data[index]) data[index] = [];
            valuesRow.forEach((value, c) => { data[index][col - 1 + c] = value; });
          });
          if (options.failSetAfterWriteTab === name) {
            options.failSetAfterWriteTab = "";
            throw new Error("synthetic acknowledgement lost after write");
          }
        }
      };
    }
    return {
      getRange: range,
      getLastRow() {
        let last = 0;
        data.forEach((row, index) => { if (row && row.some(value => value !== "" && value !== null && value !== undefined)) last = index + 1; });
        return last;
      },
      appendRow(values) {
        data.push(values.slice());
        if (options.failAppendAfterWriteTab === name) {
          options.failAppendAfterWriteTab = "";
          throw new Error("synthetic append acknowledgement lost after write");
        }
      },
      _data: data
    };
  }
  return {
    getSheetByName(name) { return tabs.get(name) || null; },
    insertSheet(name) { const created = sheet(name); tabs.set(name, created); return created; },
    _tabs: tabs
  };
}
function fixture(options = {}) {
  const spreadsheet = fakeSpreadsheet(options);
  let clock = 1_800_000_000_000;
  let id = 0;
  const lock = { tryLock: () => !options.lockBusy, releaseLock: () => {} };
  const api = context.ReclaimWhatsAppSheetsStore.create({
    spreadsheet,
    lockService: { getScriptLock: () => lock },
    now: () => clock,
    digest: value => "sha256:" + value,
    idGenerator: prefix => prefix + "-" + (++id),
    lockTimeoutMs: 50,
    claimLeaseMs: 100,
    batchLimit: 3
  });
  if (!options.skipInitialize) api.initialize();
  return { api, spreadsheet, options, advance: ms => { clock += ms; } };
}
const event = (store, id = "event-1", digest = "digest", org = "ORG_A") => store.eventStore("ACCOUNT_A").begin(id, digest, org);

test("configuration and lock failures fail closed", () => {
  assert.throws(() => context.ReclaimWhatsAppSheetsStore.create({}), /STORE_CONFIGURATION_INVALID/);
  const f = fixture({ lockBusy: true, skipInitialize: true });
  assert.throws(() => f.api.reconcile(), /STORE_LOCK_BUSY/);
});

test("initialize creates versioned schema tabs and is repeatable", () => {
  const f = fixture();
  assert.deepEqual(f.api.initialize().tabs, ["Events", "Sessions", "Registrations", "Audit"]);
  assert.equal(f.api.schema().Events[0], "schemaVersion");
  assert.doesNotThrow(() => f.api.initialize());
});

test("event lifecycle distinguishes new, in-progress, completed replay, and conflicting reuse", () => {
  const f = fixture();
  const events = f.api.eventStore("ACCOUNT_A");
  const first = events.begin("e1", "d1", "ORG_A");
  assert.equal(first.status, "NEW");
  assert.equal(events.begin("e1", "d1", "ORG_A").status, "IN_PROGRESS");
  events.complete("e1", "d1", "ORG_A", first.claimToken, { ok: true, code: "CONTINUE" });
  assert.equal(events.begin("e1", "d1", "ORG_A").status, "REPLAY");
  assert.equal(events.begin("e1", "different", "ORG_A").status, "CONFLICT");
  assert.equal(events.begin("e1", "d1", "ORG_B").status, "NEW");
});

test("released events may be retried but expired processing claims are quarantined", () => {
  const f = fixture();
  const events = f.api.eventStore("ACCOUNT_A");
  const first = events.begin("e1", "d1", "ORG_A");
  events.release("e1", "d1", "ORG_A", first.claimToken, "TEMPORARY_FAILURE");
  assert.equal(events.begin("e1", "d1", "ORG_A").status, "NEW");
  f.advance(101);
  const expired = events.begin("e1", "d1", "ORG_A");
  assert.equal(expired.status, "UNAVAILABLE");
  assert.equal(expired.code, "RECONCILIATION_REQUIRED");
});

test("invalid event transitions and mismatched event digests are rejected", () => {
  const f = fixture();
  const events = f.api.eventStore("ACCOUNT_A");
  assert.throws(() => events.complete("missing", "d", "ORG_A", "no-token", { ok: true }), /EVENT_CLAIM_MISMATCH/);
  const claim = events.begin("e1", "d1", "ORG_A");
  assert.throws(() => events.complete("e1", "d2", "ORG_A", claim.claimToken, { ok: true }), /EVENT_CLAIM_MISMATCH/);
});

test("session writes are durable, scoped, and cleared without deleting audit history", () => {
  const f = fixture();
  const sessions = f.api.sessionStore("ACCOUNT_A");
  sessions.put("ORG_A", "sender-1", { step: "NAME", expiresAt: 1_900_000_000_000 });
  assert.equal(sessions.get("ORG_A", "sender-1").step, "NAME");
  assert.equal(sessions.get("ORG_B", "sender-1"), null);
  assert.equal(f.api.sessionStore("ACCOUNT_B").get("ORG_A", "sender-1"), null);
  sessions.remove("ORG_A", "sender-1");
  assert.equal(sessions.get("ORG_A", "sender-1"), null);
  assert.ok(f.spreadsheet.getSheetByName("Audit").getLastRow() > 1);
});

test("expired sessions are not returned", () => {
  const f = fixture();
  const sessions = f.api.sessionStore("ACCOUNT_A");
  sessions.put("ORG_A", "sender", { step: "CONFIRM", expiresAt: 1_700_000_000_000 });
  assert.equal(sessions.get("ORG_A", "sender"), null);
});

test("registration creation is idempotent for identical payloads and rejects conflicts", () => {
  const f = fixture();
  const store = f.api.registrationStore();
  const request = { organizationId: "ORG_A", registrationId: "reg-1", operationId: "op-1",
    customerName: "Synthetic Customer", customerPhone: "synthetic-sender", locationDescription: "",
    latitude: -24.6, longitude: 25.9 };
  assert.equal(store.create(request).ok, true);
  assert.equal(store.create({ ...request }).replay, true);
  assert.equal(f.spreadsheet.getSheetByName("Registrations").getLastRow(), 2);
  assert.equal(store.create({ ...request, customerName: "Different Customer" }).code, "IDEMPOTENCY_CONFLICT");
});

test("operation ID reuse with a different registration ID is detected", () => {
  const f = fixture();
  const store = f.api.registrationStore();
  const request = { organizationId: "ORG_A", registrationId: "reg-1", operationId: "op-1",
    customerName: "Synthetic Customer", customerPhone: "synthetic-sender", latitude: 0, longitude: 0 };
  store.create(request);
  assert.equal(store.create({ ...request, registrationId: "reg-2" }).code, "IDEMPOTENCY_CONFLICT");
});

test("registration validation rejects invalid coordinates and missing IDs", () => {
  const store = fixture().api.registrationStore();
  assert.equal(store.create({ organizationId: "ORG_A" }).code, "REGISTRATION_INVALID");
  assert.equal(store.create({ organizationId: "ORG_A", registrationId: "r", operationId: "o",
    customerName: "Name", customerPhone: "sender", latitude: 95, longitude: 0 }).code, "REGISTRATION_INVALID");
});

test("reconciliation is bounded, repeatable, and never deletes registration rows", () => {
  const f = fixture();
  const events = f.api.eventStore("ACCOUNT_A");
  events.begin("e1", "d1", "ORG_A");
  events.begin("e2", "d2", "ORG_A");
  events.begin("e3", "d3", "ORG_A");
  events.begin("e4", "d4", "ORG_A");
  f.advance(101);
  const first = f.api.reconcile({ limit: 2 });
  assert.equal(first.inspected <= 2, true);
  const second = f.api.reconcile({ limit: 2 });
  assert.equal(second.inspected <= 2, true);
  assert.throws(() => f.api.reconcile({ limit: 4 }), /RECONCILIATION_LIMIT_INVALID/);
  assert.equal(f.spreadsheet.getSheetByName("Registrations").getLastRow(), 1);
});

test("schema mismatch fails closed", () => {
  const f = fixture();
  f.spreadsheet.getSheetByName("Events").getRange(1, 1, 1, 1).setValues([["wrong"]]);
  const result = f.api.eventStore("ACCOUNT_A").begin("e1", "d1", "ORG_A");
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.code, "SCHEMA_MISMATCH_EVENTS");
});


test("session update failures are thrown and do not fabricate a durable write", () => {
  const f = fixture();
  const sessions = f.api.sessionStore("ACCOUNT_A");
  sessions.put("ORG_A", "sender", { step: "NAME", expiresAt: 1_900_000_000_000 });
  f.options.failSetBeforeWriteTab = "Sessions";
  assert.throws(() => sessions.put("ORG_A", "sender", { step: "LOCATION", expiresAt: 1_900_000_000_000 }), /synthetic setValues failure/);
  assert.equal(sessions.get("ORG_A", "sender").step, "NAME");
});

test("registration write with lost acknowledgement is safe to retry by stable IDs", () => {
  const f = fixture({ failAppendAfterWriteTab: "Registrations" });
  const store = f.api.registrationStore();
  const request = { organizationId: "ORG_A", registrationId: "reg-lost-ack", operationId: "op-lost-ack",
    customerName: "Synthetic Customer", customerPhone: "synthetic-sender", latitude: 0, longitude: 0 };
  const uncertain = store.create(request);
  assert.equal(uncertain.ok, false);
  assert.equal(uncertain.durable, false);
  assert.equal(uncertain.retryable, true);
  const retry = store.create({ ...request });
  assert.equal(retry.ok, true);
  assert.equal(retry.replay, true);
  assert.equal(f.spreadsheet.getSheetByName("Registrations").getLastRow(), 2);
});

test("event completion acknowledgement loss is detected as a completed replay on retry", () => {
  const f = fixture();
  const events = f.api.eventStore("ACCOUNT_A");
  const claim = events.begin("lost-complete", "digest", "ORG_A");
  f.options.failSetAfterWriteTab = "Events";
  assert.throws(() => events.complete("lost-complete", "digest", "ORG_A", claim.claimToken, { ok: true, code: "CONTINUE" }), /acknowledgement lost/);
  assert.equal(events.begin("lost-complete", "digest", "ORG_A").status, "REPLAY");
});

test("provider account scopes isolate event identity", () => {
  const f = fixture();
  assert.equal(f.api.eventStore("ACCOUNT_A").begin("same-id", "same-digest", "ORG_A").status, "NEW");
  assert.equal(f.api.eventStore("ACCOUNT_B").begin("same-id", "same-digest", "ORG_A").status, "NEW");
});

test("claim tokens fence stale workers from completing or releasing a newer claim", () => {
  const f = fixture();
  const events = f.api.eventStore("ACCOUNT_A");
  const first = events.begin("fenced-event", "digest", "ORG_A");
  events.release("fenced-event", "digest", "ORG_A", first.claimToken, "RETRY");
  const second = events.begin("fenced-event", "digest", "ORG_A");
  assert.equal(second.status, "NEW");
  assert.notEqual(second.claimToken, first.claimToken);
  assert.throws(() => events.complete("fenced-event", "digest", "ORG_A", first.claimToken, { ok: true }), /STALE_CLAIM_TOKEN/);
  assert.throws(() => events.release("fenced-event", "digest", "ORG_A", first.claimToken, "STALE"), /STALE_CLAIM_TOKEN/);
  assert.deepEqual(events.complete("fenced-event", "digest", "ORG_A", second.claimToken, { ok: true }), { ok: true });
});

test("registration linkage is persisted before the registration adapter is invoked", () => {
  const f = fixture();
  const events = f.api.eventStore("ACCOUNT_A");
  const claim = events.begin("linked-event", "digest", "ORG_A");
  const request = { organizationId: "ORG_A", registrationId: "reg-link", operationId: "op-link",
    customerName: "Synthetic Customer", customerPhone: "synthetic-sender", locationDescription: "",
    latitude: -24.6, longitude: 25.9 };
  assert.equal(events.linkRegistration("linked-event", "digest", "ORG_A", claim.claimToken, request).durable, true);
  const headers = f.api.schema().Events;
  const row = f.spreadsheet.getSheetByName("Events")._data[1];
  assert.equal(row[headers.indexOf("registrationId")], "reg-link");
  assert.equal(row[headers.indexOf("operationId")], "op-link");
  assert.ok(row[headers.indexOf("registrationFingerprint")]);
  assert.throws(() => events.linkRegistration("linked-event", "digest", "ORG_A", "stale", request), /STALE_CLAIM_TOKEN/);
});

test("reconciliation completes an expired claim only when its linked registration is durably confirmed", () => {
  const f = fixture();
  const events = f.api.eventStore("ACCOUNT_A");
  const claim = events.begin("recover-registration", "digest-r", "ORG_A");
  const request = { organizationId: "ORG_A", registrationId: "reg-recover", operationId: "op-recover",
    customerName: "Synthetic Customer", customerPhone: "synthetic-sender", locationDescription: "",
    latitude: -24.6, longitude: 25.9 };
  assert.equal(events.linkRegistration("recover-registration", "digest-r", "ORG_A", claim.claimToken, request).durable, true);
  assert.equal(f.api.registrationStore().create(request).durable, true);
  f.advance(101);
  const result = f.api.reconcile({ limit: 1 });
  assert.equal(result.quarantinedExpiredClaims, 0);
  assert.equal(events.begin("recover-registration", "digest-r", "ORG_A").status, "REPLAY");
  assert.throws(() => events.complete("recover-registration", "digest-r", "ORG_A", claim.claimToken, { ok: true }), /STALE_CLAIM_TOKEN/);
});

test("reconciliation quarantines linked claims when the registration row is absent", () => {
  const f = fixture();
  const events = f.api.eventStore("ACCOUNT_A");
  const claim = events.begin("recover-missing", "digest-m", "ORG_A");
  const request = { organizationId: "ORG_A", registrationId: "reg-missing", operationId: "op-missing",
    customerName: "Synthetic Customer", customerPhone: "synthetic-sender", locationDescription: "",
    latitude: 0, longitude: 0 };
  events.linkRegistration("recover-missing", "digest-m", "ORG_A", claim.claimToken, request);
  f.advance(101);
  const result = f.api.reconcile({ limit: 1 });
  assert.equal(result.quarantinedExpiredClaims, 1);
  assert.equal(events.begin("recover-missing", "digest-m", "ORG_A").code, "RECONCILIATION_REQUIRED");
  assert.throws(() => events.release("recover-missing", "digest-m", "ORG_A", claim.claimToken, "STALE"), /STALE_CLAIM_TOKEN/);
});
