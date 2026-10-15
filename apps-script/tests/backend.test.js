"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..", "src");
const context = vm.createContext({ Object, Array, String, Number, Date, RegExp, Math, JSON });
for (const file of ["identity.js", "authorization.js", "sheetsRepository.js", "idempotency.js", "audit.js", "service.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
}
const identity = context.ReclaimIdentity;
const auth = context.ReclaimAuthorization;
const repoModule = context.ReclaimSheetsRepository;
const idem = context.ReclaimIdempotency;

function fixtures(actorId, memberships, options = {}) {
  const state = {
    organizations: {
      ORG_A: { organizationId: "ORG_A", organizationName: "Synthetic A", country: "Botswana", currency: "BWP", status: "ACTIVE", serviceEnabled: true, configVersion: 1 },
      ORG_B: { organizationId: "ORG_B", organizationName: "Synthetic B", country: "Eswatini", currency: "SZL", status: "ACTIVE", serviceEnabled: true, configVersion: 1 },
      ORG_C: { organizationId: "ORG_C", organizationName: "Synthetic C", country: "Botswana", currency: "BWP", status: "PROSPECT", serviceEnabled: false, configVersion: 1 }
    },
    memberships: memberships || [],
    operations: Object.create(null),
    auditEvents: [],
    auditCalls: 0
  };
  const repository = {
    findMembershipsForActor: id => state.memberships.filter(m => m.actorId.toLowerCase() === id.toLowerCase()),
    findOrganization: id => state.organizations[id] || null,
    updateOrganizationServiceEnabled: (id, enabled) => {
      const org = state.organizations[id];
      if (!org) return null;
      org.serviceEnabled = enabled;
      org.configVersion = Number(org.configVersion || 0) + 1;
      return { ok: true };
    },
    findOperation: id => state.operations[id] || null,
    appendIdempotency: row => {
      if (state.operations[row.operationId]) throw new Error("duplicate");
      state.operations[row.operationId] = { ...row };
    },
    updateOperation: (id, changes) => {
      if (!state.operations[id]) return null;
      Object.assign(state.operations[id], changes);
      return { ok: true };
    },
    appendAudit: event => {
      state.auditCalls += 1;
      if (options.failAuditAt === state.auditCalls || options.failAllAudit) throw new Error("synthetic storage error");
      state.auditEvents.push({ ...event });
      return { ok: true };
    }
  };
  let seq = 0;
  const lockState = { acquired: 0, released: 0, canAcquire: options.canAcquire !== false };
  const lockService = { getScriptLock: () => ({
    tryLock: () => { if (!lockState.canAcquire) return false; lockState.acquired += 1; return true; },
    releaseLock: () => { lockState.released += 1; }
  }) };
  const service = context.ReclaimService.create({
    identity: { resolveCurrentActor: () => actorId ? { ok: true, actorId } : { ok: false, error: { code: "IDENTITY_UNAVAILABLE" } } },
    session: {}, repository, authorization: auth, audit: context.ReclaimAudit, idempotency: idem, lockService,
    digest: value => "test-digest:" + value,
    idGenerator: () => "synthetic-id-" + (++seq),
    clock: { now: () => "2026-10-15T00:00:00.000Z" }
  });
  return { state, repository, service, lockState };
}

test("identity adapter fails closed when identity is missing or inaccessible", () => {
  assert.equal(identity.resolveCurrentActor(null).error.code, "IDENTITY_UNAVAILABLE");
  assert.equal(identity.resolveCurrentActor({ getActiveUser: () => ({ getEmail: () => "" }) }).ok, false);
  assert.equal(identity.resolveCurrentActor({ getActiveUser: () => ({ getEmail: () => "Test@Example.invalid" }) }).actorId, "test@example.invalid");
});

test("central policy rejects inactive memberships and cross-organization record scope", () => {
  const org = { organizationId: "ORG_A", status: "ACTIVE", serviceEnabled: true };
  const owner = { actorId: "owner@example.invalid", organizationId: "ORG_A", role: "COMPANY_OWNER", status: "ACTIVE" };
  assert.equal(auth.authorize("owner@example.invalid", null, org, "ORG_A", []).ok, false);
  assert.equal(auth.authorize("owner@example.invalid", { ...owner, status: "REVOKED" }, org, "ORG_A", []).error.code, "MEMBERSHIP_INACTIVE");
  assert.equal(auth.authorizeRecordScope({ ok: true, role: "COMPANY_OWNER", organizationId: "ORG_A" }, { organizationId: "ORG_B" }).ok, false);
});

test("company owner can read only the organization tied to trusted membership, not spoofed request claims", () => {
  const f = fixtures("owner@example.invalid", [
    { membershipId: "M1", actorId: "owner@example.invalid", organizationId: "ORG_A", role: "COMPANY_OWNER", status: "ACTIVE" }
  ]);
  const ok = f.service.getOrganizationSummary({ organizationId: "ORG_A", actorId: "admin@example.invalid", role: "PLATFORM_ADMIN" });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.organizationId, "ORG_A");
  const denied = f.service.getOrganizationSummary({ organizationId: "ORG_B", actorId: "owner@example.invalid", role: "PLATFORM_ADMIN" });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "MEMBERSHIP_NOT_FOUND");
  assert.equal(f.state.auditEvents.some(e => e.outcome === "DENIED"), true);
});

test("identity absence, ambiguous membership, revoked membership and invalid country/currency fail closed", () => {
  const noIdentity = fixtures(null, []);
  assert.equal(noIdentity.service.getOrganizationSummary({ organizationId: "ORG_A" }).error.code, "IDENTITY_UNAVAILABLE");
  const ambiguous = fixtures("owner@example.invalid", [
    { actorId: "owner@example.invalid", organizationId: "ORG_A", role: "COMPANY_OWNER", status: "ACTIVE" },
    { actorId: "OWNER@example.invalid", organizationId: "ORG_A", role: "COMPANY_OWNER", status: "ACTIVE" }
  ]);
  assert.equal(ambiguous.service.getOrganizationSummary({ organizationId: "ORG_A" }).error.code, "MEMBERSHIP_AMBIGUOUS");
  const revoked = fixtures("owner@example.invalid", [
    { actorId: "owner@example.invalid", organizationId: "ORG_A", role: "COMPANY_OWNER", status: "REVOKED" }
  ]);
  assert.equal(revoked.service.getOrganizationSummary({ organizationId: "ORG_A" }).error.code, "MEMBERSHIP_INACTIVE");
  const invalid = fixtures("owner@example.invalid", [
    { actorId: "owner@example.invalid", organizationId: "ORG_A", role: "COMPANY_OWNER", status: "ACTIVE" }
  ]);
  invalid.state.organizations.ORG_A.currency = "SZL";
  assert.equal(invalid.service.getOrganizationSummary({ organizationId: "ORG_A" }).error.code, "CONFIGURATION_INVALID");
});

test("platform administrator is resolved only through an active trusted global membership", () => {
  const absent = fixtures("admin@example.invalid", []);
  assert.equal(absent.service.setOrganizationServiceEnabled({ organizationId: "ORG_A", serviceEnabled: false, operationId: "op-admin-0001" }).error.code, "MEMBERSHIP_NOT_FOUND");
  const admin = fixtures("admin@example.invalid", [
    { membershipId: "ADMIN1", actorId: "admin@example.invalid", organizationId: "PLATFORM", role: "PLATFORM_ADMIN", status: "ACTIVE" }
  ]);
  const result = admin.service.setOrganizationServiceEnabled({ organizationId: "ORG_A", serviceEnabled: false, operationId: "op-admin-0001", role: "COMPANY_OWNER" });
  assert.equal(result.ok, true);
  assert.equal(admin.state.organizations.ORG_A.serviceEnabled, false);
  assert.equal(admin.state.operations["op-admin-0001"].status, "SUCCEEDED");
  assert.equal(admin.state.auditEvents.some(e => e.action === "SET_ORGANIZATION_SERVICE" && e.outcome === "SUCCEEDED"), true);
});

test("completed identical mutation retries return recorded result without repeating the write", () => {
  const f = fixtures("admin@example.invalid", [
    { membershipId: "ADMIN1", actorId: "admin@example.invalid", organizationId: "PLATFORM", role: "PLATFORM_ADMIN", status: "ACTIVE" }
  ]);
  const request = { organizationId: "ORG_A", serviceEnabled: false, operationId: "op-admin-0002" };
  const first = f.service.setOrganizationServiceEnabled(request);
  const version = f.state.organizations.ORG_A.configVersion;
  const second = f.service.setOrganizationServiceEnabled(request);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.replayed, true);
  assert.equal(f.state.organizations.ORG_A.configVersion, version);
  assert.equal(f.lockState.acquired, f.lockState.released);
});

test("same operation ID with changed payload is rejected and does not write", () => {
  const f = fixtures("admin@example.invalid", [
    { membershipId: "ADMIN1", actorId: "admin@example.invalid", organizationId: "PLATFORM", role: "PLATFORM_ADMIN", status: "ACTIVE" }
  ]);
  assert.equal(f.service.setOrganizationServiceEnabled({ organizationId: "ORG_A", serviceEnabled: false, operationId: "op-admin-0003" }).ok, true);
  const result = f.service.setOrganizationServiceEnabled({ organizationId: "ORG_A", serviceEnabled: true, operationId: "op-admin-0003" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(f.state.organizations.ORG_A.serviceEnabled, false);
});

test("pre-write audit failure prevents the organization mutation and leaves a reconciliation signal", () => {
  const f = fixtures("admin@example.invalid", [
    { membershipId: "ADMIN1", actorId: "admin@example.invalid", organizationId: "PLATFORM", role: "PLATFORM_ADMIN", status: "ACTIVE" }
  ], { failAuditAt: 1 });
  const result = f.service.setOrganizationServiceEnabled({ organizationId: "ORG_A", serviceEnabled: false, operationId: "op-admin-0004" });
  assert.equal(result.ok, false);
  assert.equal(f.state.organizations.ORG_A.serviceEnabled, true);
  assert.equal(f.state.operations["op-admin-0004"].status, "RECONCILIATION_REQUIRED");
});

test("post-write audit failure does not invite blind replay", () => {
  const f = fixtures("admin@example.invalid", [
    { membershipId: "ADMIN1", actorId: "admin@example.invalid", organizationId: "PLATFORM", role: "PLATFORM_ADMIN", status: "ACTIVE" }
  ], { failAuditAt: 2 });
  const request = { organizationId: "ORG_A", serviceEnabled: false, operationId: "op-admin-0005" };
  const result = f.service.setOrganizationServiceEnabled(request);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "RECONCILIATION_REQUIRED");
  assert.equal(f.state.organizations.ORG_A.serviceEnabled, false);
  assert.equal(f.state.operations["op-admin-0005"].status, "RECONCILIATION_REQUIRED");
  assert.equal(f.service.setOrganizationServiceEnabled(request).error.code, "RECONCILIATION_REQUIRED");
});

test("idempotency fails closed on lock failure and retains unresolved PROCESSING operations", () => {
  const f = fixtures("admin@example.invalid", [
    { membershipId: "ADMIN1", actorId: "admin@example.invalid", organizationId: "PLATFORM", role: "PLATFORM_ADMIN", status: "ACTIVE" }
  ], { canAcquire: false });
  assert.equal(f.service.setOrganizationServiceEnabled({ organizationId: "ORG_A", serviceEnabled: false, operationId: "op-admin-0006" }).error.code, "LOCK_UNAVAILABLE");
  f.lockState.canAcquire = true;
  f.state.operations["op-admin-0007"] = { operationId: "op-admin-0007", actorId: "admin@example.invalid", organizationId: "ORG_A", operationType: "SET_ORGANIZATION_SERVICE", payloadDigest: "test-digest:{\"organizationId\":\"ORG_A\",\"serviceEnabled\":false}", status: "PROCESSING" };
  assert.equal(f.service.setOrganizationServiceEnabled({ organizationId: "ORG_A", serviceEnabled: false, operationId: "op-admin-0007" }).error.code, "RECONCILIATION_REQUIRED");
  assert.equal(f.state.organizations.ORG_A.serviceEnabled, true);
});

test("repository text escaping handles formula markers and leading whitespace", () => {
  assert.equal(repoModule.safeText('=IMPORTXML("x")'), "'=IMPORTXML(\"x\")");
  assert.equal(repoModule.safeText("  +cmd"), "'  +cmd");
  assert.equal(repoModule.safeText("-1 as text"), "'-1 as text");
  assert.equal(repoModule.safeText("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(repoModule.safeText("ordinary text"), "ordinary text");
  assert.equal(repoModule.safeText(12), 12);
});


function fakeSheet(headers, dataRows = []) {
  const grid = [headers.slice(), ...dataRows.map(row => row.slice())];
  return {
    getLastColumn: () => headers.length,
    getLastRow: () => grid.length,
    getRange: (row, col, numRows, numCols) => ({
      getDisplayValues: () => grid.slice(row - 1, row - 1 + numRows).map(r => r.slice(col - 1, col - 1 + numCols).map(v => String(v))),
      getValues: () => grid.slice(row - 1, row - 1 + numRows).map(r => r.slice(col - 1, col - 1 + numCols)),
      setValues: values => { values.forEach((r, i) => { grid[row - 1 + i] = r.slice(); }); }
    }),
    appendRow: row => { grid.push(row.slice()); },
    _grid: grid
  };
}
function fakeSpreadsheet(sheets) {
  return { openById: () => ({ getSheetByName: name => sheets[name] || null }) };
}

test("Sheets repository rejects missing and incompatible schemas and ambiguous stable IDs", () => {
  const orgHeaders = Array.from(repoModule.schemas.Organizations);
  const validRow = ["ORG_A", "Synthetic A", "Botswana", "BWP", "ACTIVE", true, 1, "created", "updated"];
  const missing = repoModule.create(fakeSpreadsheet({}), { getProperty: () => "synthetic-sheet" });
  assert.throws(() => missing.findOrganization("ORG_A"), /REQUIRED_SHEET_MISSING/);
  const wrong = repoModule.create(fakeSpreadsheet({ Organizations: fakeSheet(["organizationId", "wrong"]) }), { getProperty: () => "synthetic-sheet" });
  assert.throws(() => wrong.findOrganization("ORG_A"), /SCHEMA_MISMATCH/);
  const duplicateSheet = fakeSheet(orgHeaders, [validRow, validRow]);
  const duplicate = repoModule.create(fakeSpreadsheet({ Organizations: duplicateSheet }), { getProperty: () => "synthetic-sheet" });
  assert.throws(() => duplicate.findOrganization("ORG_A"), /AMBIGUOUS_RECORD/);
});

test("Sheets repository preserves typed values and escapes untrusted text on writes", () => {
  const sheets = {};
  Object.keys(repoModule.schemas).forEach(name => { sheets[name] = fakeSheet(Array.from(repoModule.schemas[name])); });
  const repository = repoModule.create(fakeSpreadsheet(sheets), { getProperty: () => "synthetic-sheet" });
  repository.appendOrganization({
    organizationId: "ORG_Z", organizationName: "  =formula", country: "Botswana", currency: "BWP",
    status: "PROSPECT", serviceEnabled: false, configVersion: 1, createdAt: "now", updatedAt: "now"
  });
  const stored = repository.findOrganization("ORG_Z");
  assert.equal(stored.organizationName, "'  =formula");
  assert.equal(stored.serviceEnabled, false);
  assert.equal(stored.configVersion, 1);
  assert.throws(() => repository.appendOrganization({
    organizationId: "ORG_Z", organizationName: "Duplicate", country: "Botswana", currency: "BWP",
    status: "PROSPECT", serviceEnabled: false, configVersion: 1, createdAt: "now", updatedAt: "now"
  }), /DUPLICATE_STABLE_ID/);
  assert.throws(() => repository.appendOrganization({
    organizationId: "ORG_Y", organizationName: "Wrong currency", country: "Botswana", currency: "SZL",
    status: "PROSPECT", serviceEnabled: false, configVersion: 1, createdAt: "now", updatedAt: "now"
  }), /COUNTRY_CURRENCY_MISMATCH/);
});
