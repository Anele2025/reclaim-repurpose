"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..", "src");
const context = vm.createContext({ Object, Array, String, Number, Date, RegExp, Math, JSON, isFinite });
for (const file of ["identity.js", "authorization.js", "sheetsRepository.js", "idempotency.js", "audit.js", "service.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
}

function makeService(actorId, memberships, options = {}) {
  const state = {
    organizations: {
      ORG_A: { organizationId: "ORG_A", organizationName: "Synthetic A", country: "Botswana", currency: "BWP", status: "ACTIVE", serviceEnabled: true, configVersion: 1 },
      ORG_B: { organizationId: "ORG_B", organizationName: "Synthetic B", country: "Eswatini", currency: "SZL", status: "ACTIVE", serviceEnabled: true, configVersion: 1 }
    },
    memberships: memberships || [],
    operations: Object.create(null),
    audit: []
  };
  const repository = {
    findMembershipsForActor: id => state.memberships.filter(m => String(m.actorId || "").toLowerCase() === String(id).toLowerCase()),
    findOrganization: id => state.organizations[id] || null,
    updateOrganizationServiceEnabled: (id, enabled) => {
      if (!state.organizations[id]) return null;
      state.organizations[id].serviceEnabled = enabled;
      state.organizations[id].configVersion += 1;
      return { ok: true };
    },
    findOperation: id => state.operations[id] || null,
    appendIdempotency: row => {
      if (state.operations[row.operationId]) throw new Error("DUPLICATE");
      state.operations[row.operationId] = { ...row };
    },
    updateOperation: (id, changes) => {
      if (!state.operations[id]) return null;
      Object.assign(state.operations[id], changes);
      return { ok: true };
    },
    appendAudit: row => {
      if (options.failAudit) throw new Error("SYNTHETIC_AUDIT_FAILURE");
      state.audit.push({ ...row });
      return { ok: true };
    }
  };
  let id = 0;
  const lockState = { canAcquire: options.canAcquire !== false, acquired: 0, released: 0 };
  const lockService = { getScriptLock: () => ({
    tryLock: () => {
      if (!lockState.canAcquire) return false;
      lockState.acquired += 1;
      return true;
    },
    releaseLock: () => { lockState.released += 1; }
  }) };
  const service = context.ReclaimService.create({
    identity: { resolveCurrentActor: () => actorId ? { ok: true, actorId } : { ok: false, error: { code: "IDENTITY_UNAVAILABLE" } } },
    session: {},
    repository,
    authorization: context.ReclaimAuthorization,
    audit: context.ReclaimAudit,
    idempotency: context.ReclaimIdempotency,
    lockService,
    digest: value => "digest:" + value,
    idGenerator: () => "synthetic-" + (++id),
    clock: { now: () => "2026-10-15T00:00:00.000Z" }
  });
  return { service, state, lockState };
}

const ownerA = [{ membershipId: "MA", actorId: "owner-a@example.invalid", organizationId: "ORG_A", role: "COMPANY_OWNER", status: "ACTIVE" }];
const admin = [{ membershipId: "MP", actorId: "admin@example.invalid", organizationId: "PLATFORM", role: "PLATFORM_ADMIN", status: "ACTIVE" }];

test("Stage 5.5: owner cannot cross organization boundary or disclose the other organization's summary", () => {
  const f = makeService("owner-a@example.invalid", ownerA);
  const allowed = f.service.getOrganizationSummary({ organizationId: "ORG_A", actorId: "admin@example.invalid", role: "PLATFORM_ADMIN" });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.value.organizationId, "ORG_A");
  const denied = f.service.getOrganizationSummary({ organizationId: "ORG_B", actorId: "owner-a@example.invalid", role: "PLATFORM_ADMIN" });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "MEMBERSHIP_NOT_FOUND");
  assert.equal(JSON.stringify(denied).includes("Synthetic B"), false);
});

test("Stage 5.5: owner cannot invoke administrator mutation by direct service call or spoofed role", () => {
  const f = makeService("owner-a@example.invalid", ownerA);
  const result = f.service.setOrganizationServiceEnabled({
    organizationId: "ORG_A", serviceEnabled: false, operationId: "stage55-op-0001", role: "PLATFORM_ADMIN", actorId: "admin@example.invalid"
  });
  assert.equal(result.ok, false);
  assert.equal(f.state.organizations.ORG_A.serviceEnabled, true);
  assert.equal(Object.keys(f.state.operations).length, 0);
});

test("Stage 5.5: revoked and ambiguous memberships fail closed", () => {
  const revoked = makeService("owner-a@example.invalid", [
    { ...ownerA[0], status: "REVOKED", revokedAt: "2026-10-14T00:00:00.000Z" }
  ]);
  assert.equal(revoked.service.getOrganizationSummary({ organizationId: "ORG_A" }).error.code, "MEMBERSHIP_INACTIVE");
  const duplicate = makeService("owner-a@example.invalid", [...ownerA, { ...ownerA[0], membershipId: "MA2" }]);
  assert.equal(duplicate.service.getOrganizationSummary({ organizationId: "ORG_A" }).error.code, "MEMBERSHIP_AMBIGUOUS");
  const malformed = makeService("owner-a@example.invalid", [
    { membershipId: "BAD", actorId: "owner-a@example.invalid", organizationId: "ORG_A", role: "UNRECOGNIZED", status: "ACTIVE" }
  ]);
  assert.equal(malformed.service.getOrganizationSummary({ organizationId: "ORG_A" }).error.code, "MEMBERSHIP_NOT_FOUND");
});

test("Stage 5.5: unavailable identity fails closed when the identity provider throws", () => {
  const result = context.ReclaimIdentity.resolveCurrentActor({ getActiveUser: () => { throw new Error("synthetic"); } });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "IDENTITY_UNAVAILABLE");
});

test("Stage 5.5: lock failure prevents mutation and corrupted stored result requires reconciliation", () => {
  const f = makeService("admin@example.invalid", admin, { canAcquire: false });
  const req = { organizationId: "ORG_A", serviceEnabled: false, operationId: "stage55-op-0002" };
  assert.equal(f.service.setOrganizationServiceEnabled(req).error.code, "LOCK_UNAVAILABLE");
  assert.equal(f.state.organizations.ORG_A.serviceEnabled, true);
  assert.equal(Object.keys(f.state.operations).length, 0);

  f.lockState.canAcquire = true;
  f.state.operations[req.operationId] = {
    operationId: req.operationId, actorId: "admin@example.invalid", organizationId: "ORG_A",
    operationType: "SET_ORGANIZATION_SERVICE",
    payloadDigest: 'digest:{"organizationId":"ORG_A","serviceEnabled":false}',
    status: "SUCCEEDED", resultJson: "{broken-json"
  };
  assert.equal(f.service.setOrganizationServiceEnabled(req).error.code, "RECONCILIATION_REQUIRED");
  assert.equal(f.state.organizations.ORG_A.serviceEnabled, true);
});

test("Stage 5.5: formula-like text is escaped without coercing legitimate numeric values", () => {
  const safeText = context.ReclaimSheetsRepository.safeText;
  assert.equal(safeText("  =SUM(A1:A2)"), "'  =SUM(A1:A2)");
  assert.equal(safeText("@IMPORT"), "'@IMPORT");
  assert.equal(safeText("-1 as text"), "'-1 as text");
  assert.equal(safeText(-1), -1);
  assert.equal(safeText(0), 0);
});
