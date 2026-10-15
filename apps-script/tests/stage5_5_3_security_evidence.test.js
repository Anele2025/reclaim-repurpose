"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { REQUIRED_CASES, validateManifest } = require("../../scripts/validate_security_evidence.js");

const manifestPath = path.join(__dirname, "../../docs/digital/security-evidence/stage5_5_3_evidence.json");
const fixture = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const LIVE_SHA = "a".repeat(40);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function fullyPopulatedLiveClaim() {
  const value = clone(fixture);
  value.cases = value.cases.map(item => ({
    ...item,
    environment: "GOOGLE_LIVE",
    executedAt: "2026-10-15T10:00:00+02:00",
    executionCommitSha: LIVE_SHA,
    status: "VERIFIED",
    observedOutcome: "Observed outcome recorded for independent review.",
    evidenceRef: "docs/digital/security-evidence/reviewed/live-case-record.md",
    executionMethod: "Manual authenticated Apps Script execution under a restricted test deployment",
    verifierRole: "AUTHORIZED_PROJECT_OWNER",
    independentReviewCompleted: true,
    review: {
      reviewerRole: "INDEPENDENT_REVIEWER",
      decision: "APPROVED",
      reviewedAt: "2026-10-15T12:00:00+02:00",
      reviewRecordRef: "docs/digital/security-evidence/reviewed/review-record.md"
    }
  }));
  value.evidenceAssessmentStatus = "VERIFIED";
  value.gateStatus = "BLOCKED";
  return value;
}

test("valid synthetic inventory is structurally valid but live gate remains BLOCKED", () => {
  const result = validateManifest(fixture);
  assert.equal(result.structurallyValid, true);
  assert.equal(result.evidenceAssessmentStatus, "BLOCKED");
  assert.equal(result.gateStatus, "BLOCKED");
  assert.equal(result.verifiedCaseCount, 0);
  assert.equal(result.requiredCaseCount, 13);
});

test("missing required cases are rejected and cannot unblock the gate", () => {
  const value = clone(fixture);
  value.cases.pop();
  assert.throws(() => validateManifest(value), /Missing required test cases/);
});

test("mock-only evidence cannot satisfy a claimed live verification", () => {
  const value = fullyPopulatedLiveClaim();
  value.cases[0].executionMethod = "mocked synthetic fixture";
  assert.throws(() => validateManifest(value), /cannot describe mock-only evidence/);
});

test("placeholder evidence cannot satisfy a passing live result", () => {
  const value = fullyPopulatedLiveClaim();
  value.cases[0].evidenceRef = "TODO";
  assert.throws(() => validateManifest(value), /placeholder|evidenceRef/i);
});

test("unknown test-case identifiers are rejected", () => {
  const value = clone(fixture);
  value.cases[0].testCaseId = "MADE-UP-CASE";
  assert.throws(() => validateManifest(value), /Unknown test-case identifier/);
});

test("duplicate test-case identifiers are rejected", () => {
  const value = clone(fixture);
  value.cases[1].testCaseId = value.cases[0].testCaseId;
  assert.throws(() => validateManifest(value), /Duplicate test-case identifier/);
});

test("missing provenance fields are rejected", () => {
  const value = clone(fixture);
  delete value.cases[0].baselineCommitSha;
  assert.throws(() => validateManifest(value), /baselineCommitSha is required/);
});

test("contradictory overall and per-case states are rejected", () => {
  const value = clone(fixture);
  value.evidenceAssessmentStatus = "VERIFIED";
  assert.throws(() => validateManifest(value), /evidenceAssessmentStatus contradiction/);
});

test("AppSheet authentication remains explicitly unverified in the baseline", () => {
  const value = clone(fixture);
  const item = value.cases.find(entry => entry.testCaseId === "APPSHEET-AUTH");
  assert.equal(item.status, "NOT_STARTED");
  assert.equal(item.environment, "NOT_STARTED");
  assert.equal(item.evidenceRef, null);
  assert.equal(validateManifest(value).evidenceAssessmentStatus, "BLOCKED");
  assert.equal(validateManifest(value).gateStatus, "BLOCKED");
});

test("fully populated synthetic evidence cannot produce a live VERIFIED gate", () => {
  const value = fullyPopulatedLiveClaim();
  value.cases.forEach(item => { item.environment = "SYNTHETIC"; });
  assert.throws(() => validateManifest(value), /cannot be VERIFIED outside GOOGLE_LIVE/);
});

test("malformed JSON produces a clear CLI validation failure", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reclaim-evidence-"));
  const malformed = path.join(dir, "malformed.json");
  fs.writeFileSync(malformed, "{ definitely not json", "utf8");
  const result = spawnSync(process.execPath, [
    path.join(__dirname, "../../scripts/validate_security_evidence.js"), malformed
  ], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Security evidence validation failed/);
});

test("a live-evidence record can be represented structurally without secrets", () => {
  const value = fullyPopulatedLiveClaim();
  const result = validateManifest(value);
  assert.equal(result.structurallyValid, true);
  assert.equal(result.evidenceAssessmentStatus, "VERIFIED");
  assert.equal(result.gateStatus, "BLOCKED");
  assert.equal(JSON.stringify(value).includes("access_token"), false);
  assert.equal(JSON.stringify(value).includes("spreadsheetId"), false);
  // Structural acceptance is not proof that the external execution or review actually happened.
});

test("enforced live gate cannot be passed by editing a manifest, even with complete claims", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reclaim-evidence-"));
  const candidate = path.join(dir, "candidate.json");
  fs.writeFileSync(candidate, JSON.stringify(fullyPopulatedLiveClaim()), "utf8");
  const result = spawnSync(process.execPath, [
    path.join(__dirname, "../../scripts/validate_security_evidence.js"), candidate, "--enforce-live-gate"
  ], { encoding: "utf8" });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /external authorized reviewer must independently inspect/);
});
