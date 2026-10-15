"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..", "src");
const context = vm.createContext({ Object, Array, String, Number, Date, RegExp, Math, JSON, isFinite, parseInt });
for (const file of ["identity.js", "authorization.js", "sheetsRepository.js", "idempotency.js", "audit.js", "service.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
}
const repoModule = context.ReclaimSheetsRepository;
const validRequest = (overrides = {}) => ({
  organizationId: "ORG_A", registrationId: "REG_0001", customerName: "Synthetic Customer",
  customerPhone: "+26771234567", locationDescription: "Synthetic test address",
  latitude: -24.6282, longitude: 25.9231, operationId: "register-op-0001", ...overrides
});
function fixtures(actorId = "owner-a@example.invalid", memberships, options = {}) {
  const state = {
    organizations: {
      ORG_A: { organizationId: "ORG_A", organizationName: "Synthetic A", country: "Botswana", currency: "BWP", status: "ACTIVE", serviceEnabled: true, configVersion: 1 },
      ORG_B: { organizationId: "ORG_B", organizationName: "Synthetic B", country: "Eswatini", currency: "SZL", status: "ACTIVE", serviceEnabled: true, configVersion: 1 }
    },
    memberships: memberships || [{ membershipId: "M-A", actorId: "owner-a@example.invalid", organizationId: "ORG_A", role: "COMPANY_OWNER", status: "ACTIVE" }],
    operations: Object.create(null), registrations: Object.create(null), auditEvents: [], auditCalls: 0
  };
  const repository = {
    findMembershipsForActor: id => state.memberships.filter(m => m.actorId.toLowerCase() === id.toLowerCase()),
    findOrganization: id => state.organizations[id] || null,
    findOperation: id => state.operations[id] || null,
    appendIdempotency: row => { if (state.operations[row.operationId]) throw new Error("duplicate operation"); state.operations[row.operationId] = { ...row }; },
    updateOperation: (id, changes) => { if (!state.operations[id]) return null; Object.assign(state.operations[id], changes); return { ok: true }; },
    appendAudit: event => {
      state.auditCalls += 1;
      if (options.failAuditAt === state.auditCalls || options.failAllAudit) throw new Error("synthetic audit failure");
      state.auditEvents.push({ ...event });
      return { ok: true };
    },
    findCustomerRegistration: id => state.registrations[id] ? { ...state.registrations[id] } : null,
    appendCustomerRegistration: record => {
      if (options.failWrite) throw new Error("synthetic write failure");
      if (state.registrations[record.registrationId]) throw new Error("duplicate registration");
      state.registrations[record.registrationId] = { ...record };
    },
    findCustomerRegistrationsForOrganization: (orgId, limit) => Object.values(state.registrations)
      .filter(record => record.organizationId === orgId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map(record => ({ ...record }))
  };
  let seq = 0, held = false;
  const lockService = { getScriptLock: () => ({
    tryLock: () => { if (held || options.lockUnavailable) return false; held = true; return true; },
    releaseLock: () => { held = false; }
  }) };
  const service = context.ReclaimService.create({
    identity: { resolveCurrentActor: () => options.throwIdentity ? (() => { throw new Error("identity outage"); })() : actorId ? { ok: true, actorId } : { ok: false } },
    session: {}, repository, authorization: context.ReclaimAuthorization, audit: context.ReclaimAudit,
    idempotency: context.ReclaimIdempotency, lockService,
    digest: value => "synthetic-digest:" + value,
    idGenerator: () => "synthetic-id-" + (++seq),
    clock: { now: () => "2026-10-15T00:00:00.000Z" }
  });
  return { state, repository, service };
}

test("authorized company owner creates a registration with server-assigned scope and audit", () => {
  const f = fixtures();
  const result = f.service.createCustomerRegistration(validRequest({ organizationId: "ORG_A", actorId: undefined }));
  assert.equal(result.ok, true);
  assert.equal(result.value.organizationId, "ORG_A");
  assert.equal(result.value.createdBy, "owner-a@example.invalid");
  assert.equal(result.value.status, "REGISTERED");
  assert.equal(result.value.latitude, -24.6282);
  assert.equal(result.value.longitude, 25.9231);
  assert.equal(f.state.registrations.REG_0001.customerPhone, "+26771234567");
  assert.equal(f.state.auditEvents.some(e => e.action === "CREATE_CUSTOMER_REGISTRATION" && e.outcome === "SUCCEEDED"), true);
});

test("registration rejects unknown fields and malformed customer input", () => {
  const cases = [
    [validRequest({ extraRole: "PLATFORM_ADMIN" }), "INVALID_REQUEST"],
    [validRequest({ customerName: "  " }), "INVALID_CUSTOMER_NAME"],
    [validRequest({ customerPhone: "abc" }), "INVALID_CUSTOMER_PHONE"],
    [validRequest({ latitude: 91 }), "INVALID_CUSTOMER_COORDINATES"],
    [validRequest({ longitude: -181 }), "INVALID_CUSTOMER_COORDINATES"],
    [validRequest({ latitude: " -24.6" }), "INVALID_CUSTOMER_COORDINATES"],
    [validRequest({ latitude: NaN }), "INVALID_CUSTOMER_COORDINATES"],
    [validRequest({ longitude: Infinity }), "INVALID_CUSTOMER_COORDINATES"],
    [validRequest({ locationDescription: "x".repeat(241) }), "INVALID_CUSTOMER_LOCATION"],
    [validRequest({ operationId: "bad" }), "INVALID_OPERATION_ID"]
  ];
  for (const [request, code] of cases) {
    const f = fixtures();
    const result = f.service.createCustomerRegistration(request);
    assert.equal(result.ok, false, code);
    assert.equal(result.error.code, code);
    assert.equal(Object.keys(f.state.registrations).length, 0);
  }
});

test("identity absence and revoked membership fail closed", () => {
  assert.equal(fixtures(null).service.createCustomerRegistration(validRequest()).error.code, "IDENTITY_UNAVAILABLE");
  const revoked = fixtures("owner-a@example.invalid", [
    { membershipId: "M-A", actorId: "owner-a@example.invalid", organizationId: "ORG_A", role: "COMPANY_OWNER", status: "REVOKED" }
  ]);
  assert.equal(revoked.service.createCustomerRegistration(validRequest()).error.code, "MEMBERSHIP_INACTIVE");
});

test("a company owner cannot create or read another organization's registration", () => {
  const f = fixtures();
  assert.equal(f.service.createCustomerRegistration(validRequest({ organizationId: "ORG_B" })).error.code, "MEMBERSHIP_NOT_FOUND");
  f.state.registrations.REG_OTHER = { ...validRequest({ organizationId: "ORG_B", registrationId: "REG_OTHER" }), status: "REGISTERED", createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z", createdBy: "owner-b@example.invalid" };
  assert.equal(f.service.getCustomerRegistration({ organizationId: "ORG_A", registrationId: "REG_OTHER" }).error.code, "CUSTOMER_REGISTRATION_NOT_FOUND");
  assert.equal(f.service.listCustomerRegistrations({ organizationId: "ORG_A" }).value.length, 0);
});

test("identical operation retry returns the original registration without duplicate write", () => {
  const f = fixtures();
  const first = f.service.createCustomerRegistration(validRequest());
  const second = f.service.createCustomerRegistration(validRequest());
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.replayed, true);
  assert.equal(Object.keys(f.state.registrations).length, 1);
});

test("reusing operation ID with changed payload is rejected", () => {
  const f = fixtures();
  assert.equal(f.service.createCustomerRegistration(validRequest()).ok, true);
  const changed = f.service.createCustomerRegistration(validRequest({ customerName: "Different Synthetic Customer" }));
  assert.equal(changed.ok, false);
  assert.equal(changed.error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(Object.keys(f.state.registrations).length, 1);
});

test("failed audit or storage write never reports successful registration", () => {
  const auditFailure = fixtures("owner-a@example.invalid", undefined, { failAuditAt: 1 });
  assert.equal(auditFailure.service.createCustomerRegistration(validRequest()).ok, false);
  assert.equal(Object.keys(auditFailure.state.registrations).length, 0);
  const storageFailure = fixtures("owner-a@example.invalid", undefined, { failWrite: true });
  const result = storageFailure.service.createCustomerRegistration(validRequest());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "RECONCILIATION_REQUIRED");
  assert.equal(storageFailure.state.operations["register-op-0001"].status, "RECONCILIATION_REQUIRED");
});

test("company owner can retrieve and list only organization-scoped registrations", () => {
  const f = fixtures();
  const created = f.service.createCustomerRegistration(validRequest());
  assert.equal(f.service.getCustomerRegistration({ organizationId: "ORG_A", registrationId: created.value.registrationId }).ok, true);
  assert.equal(f.service.getCustomerRegistration({ organizationId: "ORG_A", registrationId: "REG_UNKNOWN" }).error.code, "CUSTOMER_REGISTRATION_NOT_FOUND");
  assert.equal(f.service.listCustomerRegistrations({ organizationId: "ORG_A" }).value.length, 1);
  assert.equal(f.service.listCustomerRegistrations({ organizationId: "ORG_A", limit: 0 }).error.code, "INVALID_REQUEST");
});

function fakeSheet(headers, dataRows = []) {
  const grid = [headers.slice(), ...dataRows.map(row => row.slice())];
  return {
    getLastColumn: () => headers.length, getLastRow: () => grid.length,
    getRange: (row, col, numRows, numCols) => ({
      getDisplayValues: () => grid.slice(row - 1, row - 1 + numRows).map(r => r.slice(col - 1, col - 1 + numCols).map(v => String(v))),
      getValues: () => grid.slice(row - 1, row - 1 + numRows).map(r => r.slice(col - 1, col - 1 + numCols)),
      setValues: values => { values.forEach((r, i) => { grid[row - 1 + i] = r.slice(); }); }
    }),
    appendRow: row => { grid.push(row.slice()); }, _grid: grid
  };
}
function fakeSpreadsheet(sheets) { return { openById: () => ({ getSheetByName: name => sheets[name] || null }) }; }

test("Sheets adapter persists only validated customer registrations and rejects invalid coordinates", () => {
  const headers = repoModule.schemas.CustomerRegistrations;
  const sheet = fakeSheet(headers);
  const repo = repoModule.create(fakeSpreadsheet({ CustomerRegistrations: sheet }), { getProperty: () => "synthetic-sheet-id" });
  const record = {
    registrationId: "REG_0001", organizationId: "ORG_A", customerName: "Synthetic Customer", customerPhone: "+26771234567",
    locationDescription: "Synthetic location", latitude: -24.6, longitude: 25.9, status: "REGISTERED",
    createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z",
    createdBy: "owner-a@example.invalid", operationId: "register-op-0001"
  };
  repo.appendCustomerRegistration(record);
  assert.equal(repo.findCustomerRegistration("REG_0001").customerName, "Synthetic Customer");
  assert.throws(() => repo.appendCustomerRegistration({ ...record, registrationId: "REG_0002", latitude: 100, operationId: "register-op-0002" }), /INVALID_CUSTOMER_COORDINATES/);
  assert.throws(() => repo.appendCustomerRegistration({ ...record, registrationId: "REG_0001" }), /DUPLICATE_STABLE_ID/);
});

test("Sheets adapter rejects malformed persisted customer registration records", () => {
  const headers = repoModule.schemas.CustomerRegistrations;
  const invalid = ["REG_0001", "ORG_A", "Synthetic Customer", "+26771234567", "", 95, 25.9, "REGISTERED", "2026-10-15T00:00:00.000Z", "2026-10-15T00:00:00.000Z", "owner-a@example.invalid", "register-op-0001"];
  const sheet = fakeSheet(headers, [invalid]);
  const repo = repoModule.create(fakeSpreadsheet({ CustomerRegistrations: sheet }), { getProperty: () => "synthetic-sheet-id" });
  assert.throws(() => repo.findCustomerRegistration("REG_0001"), /PERSISTED_CUSTOMER_REGISTRATION_INVALID/);
});
