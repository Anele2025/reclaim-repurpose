"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { validateManifest, validDate, validEvidenceRef } = require("../../scripts/validate_security_evidence.js");

const root = path.join(__dirname, "../..");
const validator = path.join(root, "scripts/validate_security_evidence.js");
const baselinePath = path.join(root, "docs/digital/security-evidence/stage5_5_3_evidence.json");
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const SHA = "b".repeat(40);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function verifiedClaim() {
  const value = clone(baseline);
  value.cases = value.cases.map(item => ({
    ...item,
    environment: "GOOGLE_LIVE",
    executedAt: "2026-10-15T10:00:00+02:00",
    executionCommitSha: SHA,
    status: "PASS",
    observedOutcome: "Synthetic test fixture claims a pass; this is not real evidence.",
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
  value.evidenceAssessmentStatus = "PASS";
  value.gateStatus = "BLOCKED";
  return value;
}
function runCli(args) {
  return spawnSync(process.execPath, [validator, ...args], { encoding: "utf8" });
}

test("baseline passes structural validation while the effective gate remains blocked", () => {
  const result = validateManifest(baseline);
  assert.equal(result.structurallyValid, true);
  assert.equal(result.evidenceAssessmentStatus, "BLOCKED");
  assert.equal(result.gateStatus, "BLOCKED");
  assert.equal(result.verifiedCaseCount, 0);
  assert.equal(result.requiredCaseCount, 13);
});

test("complete synthetic claims cannot authorize the effective live gate", () => {
  const value = verifiedClaim();
  value.cases.forEach(item => { item.environment = "SYNTHETIC"; });
  assert.throws(() => validateManifest(value), /requires GOOGLE_LIVE evidence/);
});

test("editing gateStatus alone cannot pass the live gate", () => {
  const value = clone(baseline);
  value.gateStatus = "PASS";
  assert.throws(() => validateManifest(value), /gateStatus must remain BLOCKED/);
});

test("inconsistent evidenceAssessmentStatus is rejected", () => {
  const value = clone(baseline);
  value.evidenceAssessmentStatus = "PASS";
  assert.throws(() => validateManifest(value), /evidenceAssessmentStatus contradiction/);
});

test("missing required cases are rejected", () => {
  const value = clone(baseline);
  value.cases.pop();
  assert.throws(() => validateManifest(value), /Missing required test cases/);
});

test("duplicate and unknown case IDs are rejected", () => {
  const duplicate = clone(baseline);
  duplicate.cases[1].testCaseId = duplicate.cases[0].testCaseId;
  assert.throws(() => validateManifest(duplicate), /Duplicate test-case identifier/);
  const unknown = clone(baseline);
  unknown.cases[0].testCaseId = "MADE-UP";
  assert.throws(() => validateManifest(unknown), /Unknown test-case identifier/);
});

test("unknown fields are rejected at manifest, case, and review levels", () => {
  const manifestExtra = clone(baseline);
  manifestExtra.authorized = true;
  assert.throws(() => validateManifest(manifestExtra), /Unexpected field manifest.authorized/);
  const caseExtra = clone(baseline);
  caseExtra.cases[0].gateOverride = true;
  assert.throws(() => validateManifest(caseExtra), /Unexpected field cases\[0\].gateOverride/);
  const reviewExtra = verifiedClaim();
  reviewExtra.cases[0].review.externalApproval = true;
  assert.throws(() => validateManifest(reviewExtra), /Unexpected field cases\[0\].review.externalApproval/);
});

test("calendar-invalid and malformed timestamps are rejected", () => {
  for (const stamp of ["2026-02-30T10:00:00Z", "2026-13-01T10:00:00Z", "2026-10-15", "2026-10-15T10:00:00"]) {
    assert.equal(validDate(stamp), false, stamp);
  }
  const value = verifiedClaim();
  value.cases[0].executedAt = "2026-02-30T10:00:00Z";
  assert.throws(() => validateManifest(value), /real ISO timestamp/);
  value.cases[0].executedAt = "2026-10-15T10:00:00Z";
  value.cases[0].executionCommitSha = "abc123";
  assert.throws(() => validateManifest(value), /full commit SHA/);
});

test("review must be independent, structurally complete, and after execution", () => {
  const value = verifiedClaim();
  delete value.cases[0].review.reviewerRole;
  assert.throws(() => validateManifest(value), /review.reviewerRole is required/);
  const earlier = verifiedClaim();
  earlier.cases[0].review.reviewedAt = "2026-10-14T12:00:00+02:00";
  assert.throws(() => validateManifest(earlier), /cannot precede execution/);
});

test("mock-only and synthetic methods cannot qualify as verified live evidence", () => {
  for (const method of ["mocked execution", "synthetic manual execution", "test-double run", "fixture result"]) {
    const value = verifiedClaim();
    value.cases[0].executionMethod = method;
    assert.throws(() => validateManifest(value), /cannot describe mock-only evidence/);
  }
});

test("evidence references reject traversal, absolute paths, URLs, query fragments, and placeholders", () => {
  for (const ref of [
    "/docs/digital/security-evidence/pass.md",
    "docs/digital/security-evidence/../../private.md",
    "https://example.com/private",
    "file:///private/evidence.md",
    "docs/digital/security-evidence/pass.md?token=secret",
    "docs/digital/security-evidence/#pass.md",
    "docs/digital/security-evidence/placeholder.md",
    "docs/digital/security-evidence/pass\\..\\private.md",
    "docs/digital/security-evidence//pass.md"
  ]) assert.equal(validEvidenceRef(ref), false, ref);
});

test("ordinary words in safe repository paths are not treated as placeholders", () => {
  assert.equal(validEvidenceRef("docs/digital/security-evidence/reviewed/example-study-results.md"), true);
  assert.equal(validEvidenceRef("docs/digital/security-evidence/owner-review/approval-record.pdf"), true);
});

test("NOT_EXECUTED and BLOCKED cannot retain stale execution evidence", () => {
  const notStarted = clone(baseline);
  notStarted.cases[0].executionCommitSha = SHA;
  assert.throws(() => validateManifest(notStarted), /executionCommitSha must be null/);
  const blocked = clone(baseline);
  blocked.cases[0].status = "BLOCKED";
  blocked.cases[0].executionCommitSha = SHA;
  blocked.evidenceAssessmentStatus = "BLOCKED";
  assert.throws(() => validateManifest(blocked), /executionCommitSha must be null/);
});

test("FAIL requires an execution record and consistent aggregate status", () => {
  const value = clone(baseline);
  Object.assign(value.cases[0], {
    status: "FAIL",
    environment: "GOOGLE_LIVE",
    executedAt: "2026-10-15T10:00:00Z",
    executionCommitSha: SHA,
    observedOutcome: "Live synthetic-account security test failed as expected.",
    executionMethod: "Manual authenticated Apps Script execution under a restricted test deployment",
    evidenceRef: "docs/digital/security-evidence/test-runs/failure-record.md",
    verifierRole: "AUTHORIZED_PROJECT_OWNER"
  });
  value.evidenceAssessmentStatus = "FAIL";
  assert.equal(validateManifest(value).evidenceAssessmentStatus, "FAIL");
  value.cases[0].evidenceRef = null;
  assert.throws(() => validateManifest(value), /evidenceRef must be a sanitized relative repository artifact path/);
});

test("live evidence awaiting independent review is distinct from a passed case", () => {
  const value = verifiedClaim();
  value.cases.forEach(item => {
    item.status = "AWAITING_INDEPENDENT_REVIEW";
    item.independentReviewCompleted = false;
    item.review = null;
  });
  value.evidenceAssessmentStatus = "AWAITING_INDEPENDENT_REVIEW";
  const result = validateManifest(value);
  assert.equal(result.evidenceAssessmentStatus, "AWAITING_INDEPENDENT_REVIEW");
  assert.equal(result.gateStatus, "BLOCKED");
  assert.equal(result.passedCaseCount, 0);
});

test("AppSheet authentication cannot be marked complete without qualifying live evidence", () => {
  const value = clone(baseline);
  const item = value.cases.find(entry => entry.testCaseId === "APPSHEET-AUTH");
  item.status = "PASS";
  item.environment = "GOOGLE_LIVE";
  value.evidenceAssessmentStatus = "BLOCKED";
  assert.throws(() => validateManifest(value), /executedAt must be a real ISO timestamp/);
});

test("malformed JSON and unsupported CLI flags fail with non-zero status", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reclaim-evidence-"));
  const malformed = path.join(dir, "malformed.json");
  fs.writeFileSync(malformed, "{ definitely not json", "utf8");
  const result = runCli([malformed]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Security evidence validation failed/);
  const flag = runCli(["--bypass"]);
  assert.equal(flag.status, 1);
  assert.match(flag.stderr, /unsupported command-line arguments/);
});

test("editing a complete manifest cannot authorize release even when all cases claim success", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reclaim-evidence-"));
  const candidate = path.join(dir, "candidate.json");
  fs.writeFileSync(candidate, JSON.stringify(verifiedClaim()), "utf8");
  const result = runCli([candidate, "--enforce-live-gate"]);
  assert.equal(result.status, 3);
  assert.match(result.stderr, /external authorized reviewer must independently inspect/);
});
