"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..", "src");
const context = vm.createContext({ Object, Array, String, Number, Date, RegExp, Math, JSON });
for (const file of ["identity.js","authorization.js","sheetsRepository.js","idempotency.js","audit.js","service.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
}
const auth = context.ReclaimAuthorization;
const identity = context.ReclaimIdentity;
const idem = context.ReclaimIdempotency;
const repoModule = context.ReclaimSheetsRepository;

test("identity adapter fails closed when identity is missing or inaccessible", () => {
  assert.equal(identity.resolveCurrentActor(null).error.code, "IDENTITY_UNAVAILABLE");
  assert.equal(identity.resolveCurrentActor({ getActiveUser: () => ({ getEmail: () => "" }) }).ok, false);
  assert.equal(identity.resolveCurrentActor({ getActiveUser: () => ({ getEmail: () => "Test@Example.invalid" }) }).actorId, "test@example.invalid");
});

test("authorization denies missing, revoked, wrong-role and cross-organization membership", () => {
  const org = { organizationId: "ORG_A", status: "ACTIVE", serviceEnabled: true };
  const owner = { actorId: "owner@example.invalid", organizationId: "ORG_A", role: "COMPANY_OWNER", status: "ACTIVE" };
  assert.equal(auth.authorize("owner@example.invalid", null, org, "ORG_A", []).ok, false);
  assert.equal(auth.authorize("owner@example.invalid", { ...owner, status: "REVOKED" }, org, "ORG_A", []).error.code, "MEMBERSHIP_INACTIVE");
  assert.equal(auth.authorize("owner@example.invalid", owner, org, "ORG_B", []).error.code, "ORGANIZATION_NOT_FOUND");
  assert.equal(auth.authorize("owner@example.invalid", owner, { ...org, status: "SUSPENDED" }, "ORG_A", []).error.code, "ORGANIZATION_INACTIVE");
  assert.equal(auth.authorize("owner@example.invalid", { ...owner, role: "UNAPPROVED" }, org, "ORG_A", []).error.code, "ROLE_DENIED");
  assert.equal(auth.authorizeRecordScope({ ok: true, role: "COMPANY_OWNER", organizationId: "ORG_A" }, { organizationId: "ORG_B" }).ok, false);
});

test("organization membership and service configuration must match", () => {
  const owner = { actorId: "owner@example.invalid", organizationId: "ORG_A", role: "COMPANY_OWNER", status: "ACTIVE" };
  assert.equal(auth.authorize("owner@example.invalid", owner, { organizationId: "ORG_A", status: "ACTIVE", serviceEnabled: false }, "ORG_A", []).error.code, "SERVICE_DISABLED");
});

test("formula-leading strings are escaped before Sheets writes", () => {
  assert.equal(repoModule.safeText("=IMPORTXML(\"x\")"), "'=IMPORTXML(\"x\")");
  assert.equal(repoModule.safeText("+cmd"), "'+cmd");
  assert.equal(repoModule.safeText("ordinary text"), "ordinary text");
});

test("durable idempotency adapter detects same ID and conflicting operation payloads", () => {
  const records = Object.create(null);
  const repo = {
    findOperation: id => records[id] || null,
    appendIdempotency: row => { records[row.operationId] = row; }
  };
  const lock = { tryLock: () => true, releaseLock: () => {} };
  const lockService = { getScriptLock: () => lock };
  const request = { operationId: "operation-0001", actorId: "synthetic", organizationId: "ORG_A", operationType: "CREATE_TEST", payloadDigest: "digest-a" };
  assert.equal(idem.reserve(repo, lockService, request, "2026-10-15T00:00:00Z").ok, true);
  assert.equal(idem.reserve(repo, lockService, request, "2026-10-15T00:00:01Z").error.code, "OPERATION_ALREADY_EXISTS");
  assert.equal(idem.reserve(repo, lockService, { ...request, payloadDigest: "digest-b" }, "2026-10-15T00:00:02Z").error.code, "IDEMPOTENCY_CONFLICT");
});

test("idempotency fails closed when lock cannot be acquired", () => {
  const result = idem.reserve({}, { getScriptLock: () => ({ tryLock: () => false, releaseLock: () => {} }) },
    { operationId: "operation-0001", actorId: "x", organizationId: "ORG_A", operationType: "X", payloadDigest: "x" }, "now");
  assert.equal(result.error.code, "LOCK_UNAVAILABLE");
});

test("audit failure returns a safe structured error", () => {
  const result = context.ReclaimAudit.record({ appendAudit: () => { throw new Error("private spreadsheet detail"); } },
    { eventId: "evt", timestamp: "now", action: "READ", outcome: "DENIED" });
  assert.equal(result.error.code, "AUDIT_UNAVAILABLE");
  assert.equal(JSON.stringify(result).includes("private spreadsheet detail"), false);
});
