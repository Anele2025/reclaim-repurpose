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
          if (options.failNextReadTab === name) {
            options.failNextReadTab = "";
            throw new Error("synthetic read-back failure");
          }
          return Array.from({ length: rowCount }, (_, r) =>
            Array.from({ length: colCount }, (_, c) => (data[row - 1 + r] || [])[col - 1 + c] ?? ""));
        },
        setValues(values) {
          if (options.dropSetWriteTab === name) {
            options.dropSetWriteTab = "";
            return; // simulate a storage adapter that returns without persisting
          }
          if (options.failSetBeforeWriteTab === name) {
            options.failSetBeforeWriteTab = "";
            throw new Error("synthetic setValues failure before write");
          }
          values.forEach((valuesRow, r) => {
            const index = row - 1 + r;
            if (!data[index]) data[index] = [];
            valuesRow.forEach((value, c) => { data[index][col - 1 + c] = value; });
          });
          if (options.failReadAfterSetTab === name) {
            options.failReadAfterSetTab = "";
            options.failNextReadTab = name;
          }
          if (options.failSetAfterWriteTab === name) {
            options.failSetAfterWriteTab = "";
            throw new Error("synthetic acknowledgement lost after write");
          }
        }
      };
    }
    return {
      getRange: range,
      getLastColumn() {
        let last = 0;
        data.forEach(row => {
          if (row) row.forEach((value, index) => {
            if (value !== "" && value !== null && value !== undefined) last = Math.max(last, index + 1);
          });
        });
        return last;
      },
      getLastRow() {
        let last = 0;
        data.forEach((row, index) => { if (row && row.some(value => value !== "" && value !== null && value !== undefined)) last = index + 1; });
        return last;
      },
      appendRow(values) {
        if (options.dropAppendWriteTab === name) {
          options.dropAppendWriteTab = "";
          return; // simulate a storage adapter that returns without persisting
        }
        if (options.failAppendBeforeWriteTab === name) {
          options.failAppendBeforeWriteTab = "";
          throw new Error("synthetic append failure before write");
        }
        data.push(values.slice());
        if (options.failReadAfterAppendTab === name) {
          options.failReadAfterAppendTab = "";
          options.failNextReadTab = name;
        }
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
  let lockReleases = 0;
  const lock = { tryLock: () => !options.lockBusy, releaseLock: () => { lockReleases++; } };
  const api = context.ReclaimWhatsAppSheetsStore.create({
    spreadsheet,
    lockService: { getScriptLock: () => lock },
    now: () => clock,
    digest: value => "sha256:" + value,
    idGenerator: options.idGenerator || (prefix => prefix + "-" + (++id)),
    lockTimeoutMs: 50,
    claimLeaseMs: 100,
    batchLimit: 3
  });
  if (!options.skipInitialize) api.initialize();
  return { api, spreadsheet, options, lock, lockReleases: () => lockReleases, advance: ms => { clock += ms; } };
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
  assert.equal(events.complete("fenced-event", "digest", "ORG_A", second.claimToken, { ok: true }).ok, true);
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


test("claim generations fence stale workers even when the injected token source collides", () => {
  const f = fixture({ idGenerator: () => "constant-token" });
  const events = f.api.eventStore("ACCOUNT_A");
  const first = events.begin("collision-event", "digest", "ORG_A");
  events.release("collision-event", "digest", "ORG_A", first.claimToken, "RETRY");
  const second = events.begin("collision-event", "digest", "ORG_A");
  assert.notEqual(second.claimToken, first.claimToken);
  assert.throws(() => events.complete("collision-event", "digest", "ORG_A", first.claimToken, { ok: true }), /STALE_CLAIM_TOKEN/);
  assert.equal(events.complete("collision-event", "digest", "ORG_A", second.claimToken, { ok: true }).ok, true);
});

test("event completion refuses a non-success result", () => {
  const f = fixture();
  const events = f.api.eventStore("ACCOUNT_A");
  const claim = events.begin("false-result", "digest", "ORG_A");
  assert.throws(() => events.complete("false-result", "digest", "ORG_A", claim.claimToken, { ok: false }), /EVENT_RESULT_INVALID/);
  assert.equal(events.begin("false-result", "digest", "ORG_A").status, "IN_PROGRESS");
});

test("registration IDs and operation IDs cannot be reused across tenants", () => {
  const f = fixture();
  const store = f.api.registrationStore();
  const original = { organizationId: "ORG_A", registrationId: "global-reg", operationId: "global-op",
    customerName: "Synthetic Customer", customerPhone: "synthetic-sender", latitude: 0, longitude: 0 };
  assert.equal(store.create(original).ok, true);
  const reusedRegistration = store.create({ ...original, organizationId: "ORG_B", operationId: "other-op" });
  assert.equal(reusedRegistration.ok, false);
  assert.equal(reusedRegistration.code, "IDEMPOTENCY_CONFLICT");
  const reusedOperation = store.create({ ...original, organizationId: "ORG_B", registrationId: "other-reg" });
  assert.equal(reusedOperation.ok, false);
  assert.equal(reusedOperation.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(f.spreadsheet.getSheetByName("Registrations").getLastRow(), 2);
});

test("reconciliation treats cross-tenant identifier collisions as contradictory evidence", () => {
  const f = fixture();
  const eventsA = f.api.eventStore("ACCOUNT_A");
  const claim = eventsA.begin("cross-tenant-recovery", "digest", "ORG_A");
  const request = { organizationId: "ORG_A", registrationId: "shared-reg", operationId: "shared-op",
    customerName: "Synthetic Customer", customerPhone: "synthetic-sender", locationDescription: "",
    latitude: 0, longitude: 0 };
  eventsA.linkRegistration("cross-tenant-recovery", "digest", "ORG_A", claim.claimToken, request);
  const otherTenant = { ...request, organizationId: "ORG_B" };
  // Create a conflicting row under another tenant by seeding the fake sheet,
  // representing a writer that bypassed this adapter's cooperative lock.
  const tab = f.spreadsheet.getSheetByName("Registrations");
  tab.appendRow([2, "ORG_B", "shared-reg", "shared-op", "different-fingerprint", JSON.stringify(otherTenant), "SUCCEEDED", 1, 1]);
  f.advance(101);
  const result = f.api.reconcile({ limit: 1 });
  assert.equal(result.quarantinedExpiredClaims, 1);
  assert.equal(eventsA.begin("cross-tenant-recovery", "digest", "ORG_A").code, "RECONCILIATION_REQUIRED");
});


test("missing, empty, wrong-event, and wrong-tenant claim tokens fail closed", () => {
  const f = fixture();
  const eventsA = f.api.eventStore("ACCOUNT_A");
  const eventsB = f.api.eventStore("ACCOUNT_B");
  const one = eventsA.begin("token-event-a", "digest-a", "ORG_A");
  const two = eventsA.begin("token-event-b", "digest-b", "ORG_A");
  assert.throws(() => eventsA.complete("token-event-a", "digest-a", "ORG_A", "", { ok: true }), /STALE_CLAIM_TOKEN/);
  assert.throws(() => eventsA.complete("token-event-a", "digest-a", "ORG_A", undefined, { ok: true }), /STALE_CLAIM_TOKEN/);
  assert.throws(() => eventsA.complete("token-event-a", "digest-a", "ORG_A", two.claimToken, { ok: true }), /STALE_CLAIM_TOKEN/);
  assert.throws(() => eventsB.complete("token-event-a", "digest-a", "ORG_A", one.claimToken, { ok: true }), /EVENT_CLAIM_MISMATCH/);
  assert.equal(eventsA.begin("token-event-a", "digest-a", "ORG_A").status, "IN_PROGRESS");
});

test("registration ID reuse with changed payload is rejected without adding a row", () => {
  const f = fixture();
  const store = f.api.registrationStore();
  const original = { organizationId: "ORG_A", registrationId: "stable-reg", operationId: "stable-op",
    customerName: "Synthetic Customer", customerPhone: "synthetic-sender", latitude: 0, longitude: 0 };
  assert.equal(store.create(original).ok, true);
  const changed = store.create({ ...original, customerName: "Different Synthetic Customer" });
  assert.equal(changed.ok, false);
  assert.equal(changed.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(f.spreadsheet.getSheetByName("Registrations").getLastRow(), 2);
});

test("duplicate registration rows are never accepted as durable success", () => {
  const f = fixture();
  const store = f.api.registrationStore();
  const request = { organizationId: "ORG_A", registrationId: "dup-reg", operationId: "dup-op",
    customerName: "Synthetic Customer", customerPhone: "synthetic-sender", latitude: 0, longitude: 0 };
  assert.equal(store.create(request).ok, true);
  const row = f.spreadsheet.getSheetByName("Registrations")._data[1].slice();
  f.spreadsheet.getSheetByName("Registrations").appendRow(row);
  const retry = store.create(request);
  assert.equal(retry.ok, false);
  assert.equal(retry.durable, false);
  assert.equal(retry.code, "REGISTRATION_DUPLICATE_ROWS");
});

test("repeated reconciliation remains bounded and does not re-create registrations", () => {
  const f = fixture();
  const events = f.api.eventStore("ACCOUNT_A");
  const claim = events.begin("repeat-reconcile", "digest", "ORG_A");
  const request = { organizationId: "ORG_A", registrationId: "repeat-reg", operationId: "repeat-op",
    customerName: "Synthetic Customer", customerPhone: "synthetic-sender", locationDescription: "",
    latitude: 0, longitude: 0 };
  events.linkRegistration("repeat-reconcile", "digest", "ORG_A", claim.claimToken, request);
  f.api.registrationStore().create(request);
  f.advance(101);
  const first = f.api.reconcile({ limit: 1 });
  const countAfterFirst = f.spreadsheet.getSheetByName("Registrations").getLastRow();
  const second = f.api.reconcile({ limit: 1 });
  assert.equal(first.quarantinedExpiredClaims, 0);
  assert.equal(second.inspected, 1); // no event candidate; one registration row inspected for duplicate-operation review
  assert.equal(f.spreadsheet.getSheetByName("Registrations").getLastRow(), countAfterFirst);
  assert.equal(events.begin("repeat-reconcile", "digest", "ORG_A").status, "REPLAY");
});

test("adapter releases ScriptLock when a guarded operation throws", () => {
  const f = fixture();
  const before = f.lockReleases();
  assert.throws(() => f.api.eventStore("ACCOUNT_A").complete("missing", "digest", "ORG_A", "token", { ok: true }), /EVENT_CLAIM_MISMATCH/);
  assert.equal(f.lockReleases(), before + 1);
});

test("audit append failure does not fabricate failure after primary registration is verified", () => {
  const f = fixture();
  const store = f.api.registrationStore();
  const request = { organizationId: "ORG_A", registrationId: "audit-reg", operationId: "audit-op",
    customerName: "Synthetic Customer", customerPhone: "synthetic-sender", latitude: 0, longitude: 0 };
  f.options.failAppendBeforeWriteTab = "Audit";
  const result = store.create(request);
  assert.equal(result.ok, true);
  assert.equal(result.durable, true);
  assert.equal(f.spreadsheet.getSheetByName("Registrations").getLastRow(), 2);
});


test("event completion does not report success when a write returns without persisting", () => {
  const f = fixture();
  const events = f.api.eventStore("ACCOUNT_A");
  const claim = events.begin("silent-completion", "digest", "ORG_A");
  f.options.dropSetWriteTab = "Events";
  assert.throws(() => events.complete("silent-completion", "digest", "ORG_A", claim.claimToken, { ok: true }), /EVENT_COMPLETION_UNCERTAIN/);
  assert.equal(events.begin("silent-completion", "digest", "ORG_A").status, "IN_PROGRESS");
});

test("registration linkage fails closed when a write returns without persisting", () => {
  const f = fixture();
  const events = f.api.eventStore("ACCOUNT_A");
  const claim = events.begin("silent-link", "digest", "ORG_A");
  const request = { organizationId: "ORG_A", registrationId: "silent-reg", operationId: "silent-op",
    customerName: "Synthetic Customer", customerPhone: "synthetic-sender", locationDescription: "",
    latitude: 0, longitude: 0 };
  f.options.dropSetWriteTab = "Events";
  assert.throws(() => events.linkRegistration("silent-link", "digest", "ORG_A", claim.claimToken, request), /REGISTRATION_LINK_UNCERTAIN/);
});

test("registration persistence verifies the stable identifier tuple after a silent append failure", () => {
  const f = fixture();
  const store = f.api.registrationStore();
  const request = { organizationId: "ORG_A", registrationId: "silent-reg", operationId: "silent-op",
    customerName: "Synthetic Customer", customerPhone: "synthetic-sender", latitude: 0, longitude: 0 };
  f.options.dropAppendWriteTab = "Registrations";
  const result = store.create(request);
  assert.equal(result.ok, false);
  assert.equal(result.durable, false);
  assert.equal(result.code, "PERSISTENCE_UNCERTAIN");
  assert.equal(f.spreadsheet.getSheetByName("Registrations").getLastRow(), 1);
});


test("registration linkage reports uncertainty when the post-write read-back fails", () => {
  const f = fixture();
  const events = f.api.eventStore("ACCOUNT_A");
  const claim = events.begin("readback-link", "digest", "ORG_A");
  const request = { organizationId: "ORG_A", registrationId: "readback-reg", operationId: "readback-op",
    customerName: "Synthetic Customer", customerPhone: "synthetic-sender", locationDescription: "",
    latitude: 0, longitude: 0 };
  f.options.failReadAfterSetTab = "Events";
  assert.throws(() => events.linkRegistration("readback-link", "digest", "ORG_A", claim.claimToken, request), /synthetic read-back failure/);
  const retry = events.linkRegistration("readback-link", "digest", "ORG_A", claim.claimToken, request);
  assert.equal(retry.ok, true);
  assert.equal(retry.durable, true);
  assert.equal(retry.replay, true);
});

test("registration creation can safely resolve a persisted write after read-back failure", () => {
  const f = fixture();
  const store = f.api.registrationStore();
  const request = { organizationId: "ORG_A", registrationId: "readback-reg", operationId: "readback-op",
    customerName: "Synthetic Customer", customerPhone: "synthetic-sender", latitude: 0, longitude: 0 };
  f.options.failReadAfterAppendTab = "Registrations";
  const uncertain = store.create(request);
  assert.equal(uncertain.ok, false);
  assert.equal(uncertain.durable, false);
  assert.equal(uncertain.retryable, true);
  const retry = store.create(request);
  assert.equal(retry.ok, true);
  assert.equal(retry.durable, true);
  assert.equal(retry.replay, true);
  assert.equal(f.spreadsheet.getSheetByName("Registrations").getLastRow(), 2);
});


const LEGACY_EVENTS_HEADERS = ["schemaVersion", "scopeKey", "eventId", "digest", "status", "claimToken", "claimedAt", "leaseExpiresAt", "attempts", "createdAt", "updatedAt", "completedAt", "resultJson", "lastErrorCode"];

function seedLegacyEvents(f, records = []) {
  const tab = f.spreadsheet.getSheetByName("Events");
  tab._data[0] = LEGACY_EVENTS_HEADERS.slice();
  records.forEach(row => tab.appendRow(row));
  return tab;
}

test("empty, exactly recognized version 1 Events schema migrates and is idempotent", () => {
  const f = fixture();
  const tab = seedLegacyEvents(f);
  const result = f.api.migrateEventsSchema();
  assert.equal(result.status, "MIGRATED");
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.acknowledgementLost, false);
  assert.deepEqual(tab._data[0], f.api.schema().Events);
  assert.equal(tab.getLastRow(), 1);
  assert.equal(f.api.migrateEventsSchema().status, "ALREADY_CURRENT");
  assert.equal(tab.getLastRow(), 1);
});

test("non-empty version 1 Events schema is refused without mutating any legacy record", () => {
  const f = fixture();
  const legacyRow = [1, "ORG_A|ACCOUNT_A", "legacy-event", "digest-old", "COMPLETE", "old-token", 1, "", 1, 1, 2, 2, '{"ok":true}', ""];
  const tab = seedLegacyEvents(f, [legacyRow]);
  const before = JSON.stringify(tab._data);
  const result = f.api.migrateEventsSchema();
  assert.equal(result.status, "REFUSED");
  assert.equal(result.code, "LEGACY_EVENT_ROWS_REQUIRE_MANUAL_REVIEW");
  assert.equal(result.recordCount, 1);
  assert.equal(JSON.stringify(tab._data), before);
});

test("malformed, duplicate, and unknown Events headers are refused without mutation", () => {
  const f = fixture();
  const tab = seedLegacyEvents(f);
  tab._data[0][2] = "scopeKey";
  const before = JSON.stringify(tab._data);
  const duplicate = f.api.migrateEventsSchema();
  assert.equal(duplicate.status, "REFUSED");
  assert.equal(duplicate.code, "EVENT_SCHEMA_DUPLICATE_COLUMN");
  assert.equal(JSON.stringify(tab._data), before);

  tab._data[0] = LEGACY_EVENTS_HEADERS.slice();
  tab._data[0][0] = "futureSchemaVersion";
  const unknownBefore = JSON.stringify(tab._data);
  assert.equal(f.api.migrateEventsSchema().status, "REFUSED");
  assert.equal(JSON.stringify(tab._data), unknownBefore);
});

test("lost acknowledgement after persisted migration is resolved by schema read-back", () => {
  const f = fixture();
  const tab = seedLegacyEvents(f);
  f.options.failSetAfterWriteTab = "Events";
  const result = f.api.migrateEventsSchema();
  assert.equal(result.status, "MIGRATED");
  assert.equal(result.acknowledgementLost, true);
  assert.deepEqual(tab._data[0], f.api.schema().Events);
  assert.equal(tab.getLastRow(), 1);
});

test("pre-write migration failure leaves version 1 unchanged and safe retry can proceed", () => {
  const f = fixture();
  const tab = seedLegacyEvents(f);
  f.options.failSetBeforeWriteTab = "Events";
  const failed = f.api.migrateEventsSchema();
  assert.equal(failed.status, "INCOMPLETE");
  assert.equal(failed.retryable, true);
  assert.deepEqual(tab._data[0], LEGACY_EVENTS_HEADERS);
  assert.equal(f.api.migrateEventsSchema().status, "MIGRATED");
});

test("busy ScriptLock prevents migration and does not mutate the legacy schema", () => {
  const f = fixture({ lockBusy: true, skipInitialize: true });
  const tab = f.spreadsheet.insertSheet("Events");
  tab.getRange(1, 1, 1, LEGACY_EVENTS_HEADERS.length).setValues([LEGACY_EVENTS_HEADERS]);
  const before = JSON.stringify(tab._data);
  assert.throws(() => f.api.migrateEventsSchema(), /STORE_LOCK_BUSY/);
  assert.equal(JSON.stringify(tab._data), before);
});
