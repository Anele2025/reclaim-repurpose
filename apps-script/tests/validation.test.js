"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourcePath = path.join(__dirname, "..", "src", "validation.js");
const context = vm.createContext({ Number, Object, Array, String });
vm.runInContext(fs.readFileSync(sourcePath, "utf8"), context, { filename: sourcePath });
const rules = context.ReclaimValidation;

const validBotswana = {
  organizationId: "ORG_BW_001",
  organizationName: "Synthetic Test Organization",
  country: "Botswana",
  status: "ACTIVE"
};

test("accepts valid Botswana and Eswatini organizations with mapped currencies", () => {
  assert.equal(rules.validateOrganization(validBotswana).ok, true);
  const sz = rules.validateOrganization({
    organizationId: "ORG_SZ_001", organizationName: "Synthetic Eswatini Org",
    country: "Eswatini", status: "PROSPECT"
  });
  assert.equal(sz.ok, true);
  assert.equal(sz.value.currency, "SZL");
  assert.equal(rules.validateOrganization(validBotswana).value.currency, "BWP");
});

test("rejects missing required organization fields and malformed records", () => {
  assert.equal(rules.validateOrganization(null).error.code, "INVALID_RECORD");
  assert.equal(rules.validateOrganization({ ...validBotswana, organizationName: " " }).error.code, "REQUIRED_FIELD");
  assert.equal(rules.validateOrganization({ ...validBotswana, organizationId: "x" }).error.code, "INVALID_ORGANIZATION_ID");
});

test("rejects unsupported countries and mismatched country/currency pairs", () => {
  assert.equal(rules.validateOrganization({ ...validBotswana, country: "South Africa" }).error.code, "UNSUPPORTED_COUNTRY");
  assert.equal(rules.validateOrganization({ ...validBotswana, currency: "SZL" }).error.code, "COUNTRY_CURRENCY_MISMATCH");
  assert.equal(rules.validateMoney("Eswatini", "BWP", 10).error.code, "COUNTRY_CURRENCY_MISMATCH");
  assert.equal(rules.validateMoney("Botswana", "BWP", 10).ok, true);
  assert.equal(rules.validateMoney("Eswatini", "SZL", 10).ok, true);
});

test("rejects invalid organization statuses and unsafe amounts", () => {
  assert.equal(rules.validateOrganization({ ...validBotswana, status: "MAGIC" }).error.code, "INVALID_STATUS");
  assert.equal(rules.validateMoney("Botswana", "BWP", -1).error.code, "INVALID_AMOUNT");
  assert.equal(rules.validateMoney("Botswana", "BWP", Infinity).error.code, "INVALID_AMOUNT");
});

test("requires a verified active membership context and denies cross-organization access", () => {
  assert.equal(rules.validateMembershipContext({ organizationId: "ORG_A" }, "ORG_A", ["COMPANY_OWNER"]).error.code, "AUTHENTICATED_MEMBERSHIP_REQUIRED");
  const member = { authenticated: true, actorId: "synthetic-user", organizationId: "ORG_A", membershipStatus: "ACTIVE", role: "COMPANY_OWNER" };
  assert.equal(rules.validateMembershipContext(member, "ORG_A", ["COMPANY_OWNER"]).ok, true);
  assert.equal(rules.validateMembershipContext(member, "ORG_B", ["COMPANY_OWNER"]).error.code, "ORGANIZATION_SCOPE_DENIED");
  assert.equal(rules.validateMembershipContext({ ...member, membershipStatus: "REVOKED" }, "ORG_A", []).error.code, "MEMBERSHIP_INACTIVE");
});

test("validates operation identifiers and detects duplicate IDs in the test registry", () => {
  assert.equal(rules.validateOperationId("operation-0001").ok, true);
  assert.equal(rules.validateOperationId("bad").error.code, "INVALID_OPERATION_ID");
  const registry = rules.createTestOperationRegistry();
  assert.equal(registry.reserve("operation-0001").ok, true);
  assert.equal(registry.reserve("operation-0001").error.code, "DUPLICATE_OPERATION");
});

test("safe error responses use allow-listed codes and do not echo secrets or raw records", () => {
  const safe = rules.safeError({ error: { code: "UNEXPECTED", field: "request", reason: "internal token=secret-value" }, raw: "private" });
  assert.equal(safe.error.code, "VALIDATION_FAILED");
  assert.equal(JSON.stringify(safe).includes("secret-value"), false);
  assert.deepEqual(Object.keys(safe), ["ok", "error"]);
});
