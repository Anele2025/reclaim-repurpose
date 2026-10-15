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
const baseRequest = (overrides = {}) => ({
  organizationId: "ORG_A", siteId: "SITE_1", collectedAt: "2026-10-14T10:15:00+02:00",
  materialCategory: "PLASTIC", quantity: 12.5, unit: "kg", operationId: "collect-op-0001", ...overrides
});
function fixtures(actorId = "owner-a@example.invalid", memberships, options = {}) {
  const state = {
    organizations: {
      ORG_A: { organizationId: "ORG_A", organizationName: "Synthetic A", country: "Botswana", currency: "BWP", status: "ACTIVE", serviceEnabled: true, configVersion: 1 },
      ORG_B: { organizationId: "ORG_B", organizationName: "Synthetic B", country: "Eswatini", currency: "SZL", status: "ACTIVE", serviceEnabled: true, configVersion: 1 }
    },
    memberships: memberships || [{ membershipId: "M-A", actorId: "owner-a@example.invalid", organizationId: "ORG_A", role: "COMPANY_OWNER", status: "ACTIVE" }],
    operations: Object.create(null), collections: Object.create(null), auditEvents: [], auditCalls: 0
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
    },
    appendCollectionRecord: record => {
      if (options.failCollectionWrite) throw new Error("synthetic write failure");
      if (state.collections[record.collectionId]) throw new Error("duplicate collection");
      state.collections[record.collectionId] = { ...record };
    },
    findCollectionRecord: id => state.collections[id] ? { ...state.collections[id] } : null,
    findCollectionRecordsForOrganization: (orgId, limit) => Object.values(state.collections)
      .filter(row => row.organizationId === orgId).sort((a,b) => b.collectedAt.localeCompare(a.collectedAt)).slice(0, limit).map(row => ({ ...row })),
    updateCollectionRecord: (id, changes) => {
      const row = state.collections[id];
      if (!row) return null;
      Object.assign(row, changes);
      return { ok: true };
    }
  };
  let seq = 0;
  let held = false;
  const lockService = { getScriptLock: () => ({
    tryLock: () => { if (held || options.lockUnavailable) return false; held = true; return true; },
    releaseLock: () => { held = false; }
  }) };
  const service = context.ReclaimService.create({
    identity: { resolveCurrentActor: () => actorId ? { ok: true, actorId } : { ok: false } },
    session: {}, repository, authorization: context.ReclaimAuthorization, audit: context.ReclaimAudit,
    idempotency: context.ReclaimIdempotency, lockService,
    digest: value => "synthetic-digest:" + value,
    idGenerator: () => "synthetic-id-" + (++seq),
    clock: { now: () => "2026-10-15T00:00:00.000Z" }
  });
  return { state, repository, service };
}
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

test("authorized owner creates a collection record with trusted actor and audit trail", () => {
  const f = fixtures();
  const result = f.service.recordCollection(baseRequest());
  assert.equal(result.ok, true);
  assert.equal(result.value.organizationId, "ORG_A");
  assert.equal(result.value.createdBy, "owner-a@example.invalid");
  assert.equal(result.value.status, "RECORDED");
  assert.equal(f.state.collections[result.value.collectionId].quantity, 12.5);
  assert.equal(f.state.auditEvents.some(e => e.action === "CREATE_COLLECTION_RECORD" && e.outcome === "SUCCEEDED"), true);
});
test("collection validation rejects missing fields, invalid dates, categories, units and quantities", () => {
  const cases = [
    [baseRequest({ siteId: "" }), "INVALID_COLLECTION_SCOPE"],
    [baseRequest({ collectedAt: "2026-02-30T10:15:00Z", operationId: "collect-op-0002" }), "INVALID_COLLECTION_DATE"],
    [baseRequest({ materialCategory: "RADIOACTIVE", operationId: "collect-op-0003" }), "INVALID_MATERIAL_CATEGORY"],
    [baseRequest({ unit: "mystery", operationId: "collect-op-0004" }), "INVALID_COLLECTION_UNIT"],
    [baseRequest({ quantity: NaN, operationId: "collect-op-0005" }), "INVALID_COLLECTION_QUANTITY"],
    [baseRequest({ quantity: -1, operationId: "collect-op-0006" }), "INVALID_COLLECTION_QUANTITY"],
    [baseRequest({ collectedAt: "2026-10-14T10:15:00", operationId: "collect-op-0007" }), "INVALID_COLLECTION_DATE"]
  ];
  for (const [request, code] of cases) {
    const f = fixtures();
    const result = f.service.recordCollection(request);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, code);
    assert.equal(Object.keys(f.state.collections).length, 0);
  }
});
test("unavailable identity and revoked membership fail closed", () => {
  assert.equal(fixtures(null).service.recordCollection(baseRequest()).error.code, "IDENTITY_UNAVAILABLE");
  const revoked = fixtures("owner-a@example.invalid", [{ membershipId:"M-A", actorId:"owner-a@example.invalid", organizationId:"ORG_A", role:"COMPANY_OWNER", status:"REVOKED" }]);
  assert.equal(revoked.service.recordCollection(baseRequest()).error.code, "MEMBERSHIP_INACTIVE");
});
test("cross-organization access and client actor spoofing are rejected", () => {
  const f = fixtures();
  assert.equal(f.service.recordCollection(baseRequest({ organizationId: "ORG_B" })).error.code, "MEMBERSHIP_NOT_FOUND");
  assert.equal(f.service.recordCollection(baseRequest({ actorId: "admin@example.invalid", operationId: "collect-op-0008" })).error.code, "INVALID_REQUEST");
  assert.equal(f.service.listCollectionRecords({ organizationId: "ORG_B" }).error.code, "MEMBERSHIP_NOT_FOUND");
});
test("identical operation retry returns the original collection without duplicate write", () => {
  const f = fixtures();
  const request = baseRequest();
  const first = f.service.recordCollection(request);
  const second = f.service.recordCollection(request);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.replayed, true);
  assert.equal(Object.keys(f.state.collections).length, 1);
});
test("reusing an operation ID with changed data is rejected", () => {
  const f = fixtures();
  assert.equal(f.service.recordCollection(baseRequest()).ok, true);
  const changed = f.service.recordCollection(baseRequest({ quantity: 99 }));
  assert.equal(changed.ok, false);
  assert.equal(changed.error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(Object.keys(f.state.collections).length, 1);
});
test("audit and storage failures never report a successful collection", () => {
  const auditFailure = fixtures("owner-a@example.invalid", undefined, { failAuditAt: 1 });
  assert.equal(auditFailure.service.recordCollection(baseRequest()).ok, false);
  const storageFailure = fixtures("owner-a@example.invalid", undefined, { failCollectionWrite: true });
  const result = storageFailure.service.recordCollection(baseRequest());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "RECONCILIATION_REQUIRED");
  assert.equal(storageFailure.state.operations["collect-op-0001"].status, "RECONCILIATION_REQUIRED");
});
test("collection reads and lists are organization-scoped", () => {
  const f = fixtures();
  const created = f.service.recordCollection(baseRequest());
  assert.equal(f.service.getCollectionRecord({ organizationId:"ORG_A", collectionId:created.value.collectionId }).ok, true);
  assert.equal(f.service.getCollectionRecord({ organizationId:"ORG_A", collectionId:"synthetic-other-id" }).error.code, "COLLECTION_NOT_FOUND");
  assert.equal(f.service.listCollectionRecords({ organizationId:"ORG_A" }).value.length, 1);
  f.state.collections["synthetic-org-b-id"] = { ...created.value, collectionId:"synthetic-org-b-id", organizationId:"ORG_B" };
  assert.equal(f.service.listCollectionRecords({ organizationId:"ORG_A" }).value.length, 1);
});
test("handover is recorded explicitly and never claims verified recycling", () => {
  const f = fixtures();
  const created = f.service.recordCollection(baseRequest());
  const handover = f.service.recordCollectionHandover({
    organizationId:"ORG_A", collectionId:created.value.collectionId,
    destinationPartnerId:"PARTNER_1", handoverRef:"HANDOVER-001", evidenceRef:"synthetic-evidence-001",
    operationId:"handover-op-0001"
  });
  assert.equal(handover.ok, true);
  assert.equal(handover.value.status, "HANDED_OVER");
  assert.equal(handover.value.handoverRef, "HANDOVER-001");
  assert.equal(handover.value.recyclingVerified, undefined);
  assert.equal(f.service.recordCollectionHandover({
    organizationId:"ORG_A", collectionId:created.value.collectionId,
    destinationPartnerId:"PARTNER_1", handoverRef:"HANDOVER-002", operationId:"handover-op-0002"
  }).error.code, "HANDOVER_ALREADY_RECORDED");
  assert.equal(f.service.recordCollectionHandover({
    organizationId:"ORG_A", collectionId:created.value.collectionId, destinationPartnerId:"PARTNER_1",
    handoverRef:"HANDOVER-001", recyclingVerified:true, operationId:"handover-op-0003"
  }).error.code, "INVALID_REQUEST");
});
test("Sheets repository validates schema, enforces collection constraints and escapes formula-like text", () => {
  const sheets = {};
  Object.keys(repoModule.schemas).forEach(name => { sheets[name] = fakeSheet(Array.from(repoModule.schemas[name])); });
  const repository = repoModule.create(fakeSpreadsheet(sheets), { getProperty: () => "synthetic-sheet-id" });
  assert.throws(() => repoModule.create(fakeSpreadsheet({}), { getProperty: () => "synthetic-sheet-id" }).findCollectionRecord("COLL_1"), /REQUIRED_SHEET_MISSING/);
  assert.throws(() => repoModule.create(fakeSpreadsheet({ CollectionRecords: fakeSheet(["collectionId","wrong"]) }), { getProperty: () => "synthetic-sheet-id" }).findCollectionRecord("COLL_1"), /SCHEMA_MISMATCH/);
  repository.appendCollectionRecord({
    collectionId:"COLL_1", organizationId:"ORG_A", siteId:"=IMPORTXML(\"x\")", collectedAt:"2026-10-14T10:15:00+02:00",
    materialCategory:"PLASTIC", quantity:3, unit:"kg", collectorRef:"", destinationPartnerId:"", handoverRef:"", evidenceRef:"",
    status:"RECORDED", createdAt:"now", updatedAt:"now", createdBy:"owner-a@example.invalid", operationId:"collect-op-0001"
  });
  assert.equal(sheets.CollectionRecords._grid[1][2], "'=IMPORTXML(\"x\")");
  assert.equal(repository.findCollectionRecord("COLL_1").status, "RECORDED");
  assert.equal(repository.findCollectionRecordsForOrganization("ORG_B", 10).length, 0);
  assert.throws(() => repository.appendCollectionRecord({
    collectionId:"COLL_2", organizationId:"ORG_A", siteId:"SITE_1", collectedAt:"2026-10-14T10:15:00+02:00",
    materialCategory:"PLASTIC", quantity:-2, unit:"kg", status:"RECORDED", createdAt:"now", updatedAt:"now",
    createdBy:"owner-a@example.invalid", operationId:"collect-op-0002"
  }), /INVALID_COLLECTION_QUANTITY/);
});
test("handover cannot be applied to another organization's record", () => {
  const f = fixtures();
  const created = f.service.recordCollection(baseRequest());
  f.state.collections["foreign-record"] = { ...created.value, collectionId:"foreign-record", organizationId:"ORG_B" };
  const result = f.service.recordCollectionHandover({
    organizationId:"ORG_A", collectionId:"foreign-record", destinationPartnerId:"PARTNER_1",
    handoverRef:"HANDOVER-1", operationId:"handover-op-0004"
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "COLLECTION_NOT_FOUND");
});
