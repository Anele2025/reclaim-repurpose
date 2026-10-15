#!/usr/bin/env node
"use strict";

/**
 * Structural validator for Stage 5.5.x evidence records.
 * It cannot authenticate external Google execution or independently review artifacts.
 */
const fs = require("node:fs");
const path = require("node:path");

const CASE_STATES = new Set(["NOT_EXECUTED", "AWAITING_INDEPENDENT_REVIEW", "BLOCKED", "FAIL", "PASS"]);
const ASSESSMENT_STATES = new Set(["BLOCKED", "AWAITING_INDEPENDENT_REVIEW", "FAIL", "PASS"]);
const ENVIRONMENTS = new Set(["NOT_STARTED", "SYNTHETIC", "GOOGLE_LIVE"]);
const REQUIRED_CASES = Object.freeze([
  ["LIVE-IDENTITY", "Actual Apps Script execution identity"],
  ["IDENTITY-UNAVAILABLE", "Missing or unavailable caller identity"],
  ["ORG-ISOLATION", "Company A versus Company B data isolation"],
  ["SCOPE-SPOOFING", "Spoofed organization or resource identifier"],
  ["REVOKED-OWNER", "Revoked owner access"],
  ["ADMIN-ONLY", "Administrator-only operations"],
  ["DRIVE-DIRECT-ACCESS", "Direct Drive and spreadsheet access, including inherited and link sharing"],
  ["AUDIT-INTEGRITY", "Audit-record integrity and failure handling"],
  ["IDEMPOTENCY", "Duplicate operation IDs and idempotency"],
  ["CONCURRENCY-RECOVERY", "Concurrency, locking, and uncertain write outcomes"],
  ["SCHEMA-INTEGRITY", "Spreadsheet schema and data-integrity validation"],
  ["FORMULA-INJECTION", "Formula-injection safety"],
  ["APPSHEET-AUTH", "AppSheet-to-service authentication path"]
]);
const REQUIRED_IDS = new Set(REQUIRED_CASES.map(([id]) => id));
const SHA_RE = /^[a-f0-9]{40}$/i;
const CASE_KEYS = new Set([
  "testCaseId", "securityProperty", "environment", "executedAt", "baselineCommitSha",
  "executionCommitSha", "status", "expectedOutcome", "observedOutcome", "evidenceRef",
  "executionMethod", "verifierRole", "limitations", "independentReviewRequired",
  "independentReviewCompleted", "review"
]);
const MANIFEST_KEYS = new Set([
  "schemaVersion", "stage", "repository", "baselineCommitSha", "gateStatus",
  "gateLimitations", "cases", "evidenceAssessmentStatus"
]);
const REVIEW_KEYS = new Set(["reviewerRole", "decision", "reviewedAt", "reviewRecordRef"]);
const PLACEHOLDER_VALUE_RE = /^(?:todo|tbd|placeholder|change[-_ ]?me|not provided|unknown)$/i;
const PLACEHOLDER_PATH_SEGMENT_RE = /^(?:todo|tbd|placeholder|change[-_ ]?me|not[-_ ]provided|unknown)$/i;
const ISO_TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const EVIDENCE_PATH_RE = /^docs\/digital\/security-evidence\/[A-Za-z0-9][A-Za-z0-9._/-]*\.(?:md|txt|json|csv|png|jpe?g|pdf)$/i;

function fail(message) {
  const error = new Error(message);
  error.name = "EvidenceValidationError";
  throw error;
}
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function exactKeys(value, allowed, location) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail("Unexpected field " + location + "." + key);
  }
}
function requiredKeys(value, required, location) {
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail(location + "." + key + " is required");
  }
}
function validDate(value) {
  if (typeof value !== "string") return false;
  const match = ISO_TIMESTAMP_RE.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , zone] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const h = Number(hour), min = Number(minute), sec = Number(second);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (m < 1 || m > 12 || d < 1 || d > days || h > 23 || min > 59 || sec > 59) return false;
  if (zone !== "Z") {
    const offset = /[+-](\d{2}):(\d{2})$/.exec(zone);
    if (!offset || Number(offset[1]) > 14 || Number(offset[2]) > 59 ||
        (Number(offset[1]) === 14 && Number(offset[2]) !== 0)) return false;
  }
  return Number.isFinite(Date.parse(value));
}
function hasPlaceholder(value, location) {
  if (typeof value === "string" && PLACEHOLDER_VALUE_RE.test(value.trim())) {
    fail("Placeholder value is not acceptable at " + location);
  }
  if (Array.isArray(value)) value.forEach((item, i) => hasPlaceholder(item, location + "[" + i + "]"));
  else if (isObject(value)) Object.entries(value).forEach(([key, item]) => hasPlaceholder(item, location + "." + key));
}
function validEvidenceRef(value) {
  if (!nonEmpty(value) || value !== value.trim() || !EVIDENCE_PATH_RE.test(value)) return false;
  if (value.includes("//") || value.includes("\\") || /[%?#:\s]/.test(value)) return false;
  const parts = value.split("/");
  if (parts.some(part => {
    const stem = part.replace(/\.[^.]+$/, "");
    return !part || part === "." || part === ".." ||
      PLACEHOLDER_PATH_SEGMENT_RE.test(part) || PLACEHOLDER_PATH_SEGMENT_RE.test(stem);
  })) return false;
  return parts[0] === "docs" && parts[1] === "digital" && parts[2] === "security-evidence";
}
function requireNullableEvidenceFields(item, prefix) {
  for (const field of ["executedAt", "executionCommitSha", "observedOutcome", "evidenceRef"]) {
    if (item[field] !== null) fail(prefix + "." + field + " must be null when no execution result is recorded");
  }
  if (item.review !== null) fail(prefix + ".review must be null before completed independent review");
  if (item.independentReviewCompleted !== false) fail(prefix + ".independentReviewCompleted must be false");
}
function validateExecutedCase(item, prefix, reviewState) {
  if (item.environment !== "GOOGLE_LIVE") fail(prefix + " requires GOOGLE_LIVE evidence");
  if (!validDate(item.executedAt)) fail(prefix + ".executedAt must be a real ISO timestamp with timezone");
  if (!SHA_RE.test(item.executionCommitSha || "")) fail(prefix + ".executionCommitSha must be a full commit SHA");
  if (!nonEmpty(item.expectedOutcome) || !nonEmpty(item.observedOutcome)) fail(prefix + " requires expected and observed outcomes");
  if (!validEvidenceRef(item.evidenceRef)) fail(prefix + ".evidenceRef must be a sanitized relative repository artifact path");
  if (!nonEmpty(item.executionMethod) || /mock|synthetic|test[ ._-]*double|fixture/i.test(item.executionMethod)) {
    fail(prefix + " executionMethod cannot describe mock-only evidence");
  }
  if (item.verifierRole !== "AUTHORIZED_PROJECT_OWNER") fail(prefix + " requires an authorized project owner as verifier");
  if (item.independentReviewRequired !== true) fail(prefix + " requires independent review");
  if (reviewState === "approved") {
    if (item.independentReviewCompleted !== true || !isObject(item.review)) {
      fail(prefix + " PASS requires completed independent review");
    }
    exactKeys(item.review, REVIEW_KEYS, prefix + ".review");
    requiredKeys(item.review, REVIEW_KEYS, prefix + ".review");
    if (item.review.reviewerRole !== "INDEPENDENT_REVIEWER" || item.review.decision !== "APPROVED" ||
        !validDate(item.review.reviewedAt) || !validEvidenceRef(item.review.reviewRecordRef)) {
      fail(prefix + ".review must identify an independent approval record and timestamp");
    }
    if (Date.parse(item.review.reviewedAt) < Date.parse(item.executedAt)) {
      fail(prefix + ".review.reviewedAt cannot precede execution");
    }
  } else {
    if (item.independentReviewCompleted !== false || item.review !== null) {
      fail(prefix + " cannot claim completed independent review before approval");
    }
  }
}
function deriveGateStatus(cases) {
  if (cases.some(item => item.status === "FAIL")) return "FAIL";
  if (cases.some(item => item.status === "BLOCKED" || item.status === "NOT_EXECUTED")) return "BLOCKED";
  if (cases.some(item => item.status === "AWAITING_INDEPENDENT_REVIEW")) return "AWAITING_INDEPENDENT_REVIEW";
  return "PASS";
}
function validateManifest(manifest) {
  if (!isObject(manifest)) fail("Manifest must be a JSON object");
  exactKeys(manifest, MANIFEST_KEYS, "manifest");
  requiredKeys(manifest, MANIFEST_KEYS, "manifest");
  if (manifest.schemaVersion !== 1) fail("schemaVersion must equal 1");
  if (manifest.stage !== "5.5.3") fail("stage must equal 5.5.3 for this evidence schema");
  if (manifest.repository !== "Anele2025/reclaim-repurpose") fail("repository must identify the expected repository");
  if (!SHA_RE.test(manifest.baselineCommitSha || "")) fail("baselineCommitSha must be a full commit SHA");
  if (!Array.isArray(manifest.gateLimitations) || manifest.gateLimitations.length === 0 ||
      !manifest.gateLimitations.every(nonEmpty)) fail("gateLimitations must be a non-empty array of strings");
  if (!Array.isArray(manifest.cases)) fail("cases must be an array");
  if (manifest.gateStatus !== "BLOCKED") fail("gateStatus must remain BLOCKED: this structural validator cannot authorize the live-security gate");
  if (!ASSESSMENT_STATES.has(manifest.evidenceAssessmentStatus)) fail("evidenceAssessmentStatus is unsupported");
  hasPlaceholder(manifest, "manifest");

  const seen = new Set();
  for (let i = 0; i < manifest.cases.length; i += 1) {
    const item = manifest.cases[i];
    const prefix = "cases[" + i + "]";
    if (!isObject(item)) fail(prefix + " must be an object");
    exactKeys(item, CASE_KEYS, prefix);
    requiredKeys(item, CASE_KEYS, prefix);
    for (const field of ["testCaseId", "securityProperty", "expectedOutcome", "executionMethod", "verifierRole", "limitations"]) {
      if (!nonEmpty(item[field])) fail(prefix + "." + field + " must be a non-empty string");
    }
    if (!REQUIRED_IDS.has(item.testCaseId)) fail("Unknown test-case identifier: " + item.testCaseId);
    if (seen.has(item.testCaseId)) fail("Duplicate test-case identifier: " + item.testCaseId);
    seen.add(item.testCaseId);
    if (!CASE_STATES.has(item.status)) fail(prefix + ".status is unsupported");
    if (!ENVIRONMENTS.has(item.environment)) fail(prefix + ".environment is unsupported");
    if (!SHA_RE.test(item.baselineCommitSha || "")) fail(prefix + ".baselineCommitSha must be a full commit SHA");
    if (item.baselineCommitSha !== manifest.baselineCommitSha) fail(prefix + ".baselineCommitSha must match the manifest baseline");
    if (item.executionCommitSha !== null && !SHA_RE.test(item.executionCommitSha)) fail(prefix + ".executionCommitSha must be null or a full commit SHA");
    if (item.executedAt !== null && !validDate(item.executedAt)) fail(prefix + ".executedAt must be a real ISO timestamp with timezone");
    if (item.observedOutcome !== null && !nonEmpty(item.observedOutcome)) fail(prefix + ".observedOutcome must be null or a non-empty string");
    if (item.evidenceRef !== null && !validEvidenceRef(item.evidenceRef)) fail(prefix + ".evidenceRef must be a sanitized relative repository artifact path");
    if (typeof item.independentReviewRequired !== "boolean" || typeof item.independentReviewCompleted !== "boolean") {
      fail(prefix + " review flags must be booleans");
    }
    if (item.status === "PASS") {
      validateExecutedCase(item, prefix, "approved");
    } else if (item.status === "AWAITING_INDEPENDENT_REVIEW") {
      validateExecutedCase(item, prefix, "pending");
    } else if (item.status === "NOT_EXECUTED") {
      if (item.environment !== "NOT_STARTED") fail(prefix + " NOT_EXECUTED status requires NOT_STARTED environment");
      requireNullableEvidenceFields(item, prefix);
      if (item.verifierRole !== "NOT_ASSIGNED") fail(prefix + ".verifierRole must be NOT_ASSIGNED before execution");
    } else if (item.status === "BLOCKED") {
      requireNullableEvidenceFields(item, prefix);
      if (item.environment === "NOT_STARTED" && item.verifierRole !== "NOT_ASSIGNED") {
        fail(prefix + " without a selected environment must not claim an assigned verifier");
      }
    } else if (item.status === "FAIL") {
      validateExecutedCase(item, prefix, "failed");
    }
  }
  const missing = [...REQUIRED_IDS].filter(id => !seen.has(id));
  if (missing.length) fail("Missing required test cases: " + missing.join(", "));
  const derived = deriveGateStatus(manifest.cases);
  if (manifest.evidenceAssessmentStatus !== derived) fail("evidenceAssessmentStatus contradiction: manifest says " + manifest.evidenceAssessmentStatus + ", derived status is " + derived);
  return {
    structurallyValid: true,
    evidenceAssessmentStatus: derived,
    gateStatus: "BLOCKED",
    requiredCaseCount: REQUIRED_IDS.size,
    passedCaseCount: manifest.cases.filter(item => item.status === "PASS").length,
    verifiedCaseCount: manifest.cases.filter(item => item.status === "PASS").length
  };
}
function main(argv) {
  const args = argv.slice(2);
  const enforceLiveGate = args.includes("--enforce-live-gate");
  const positional = args.filter(arg => arg !== "--enforce-live-gate");
  if (positional.length > 1 || args.some(arg => arg.startsWith("--") && arg !== "--enforce-live-gate")) {
    console.error("Security evidence validation failed: unsupported command-line arguments");
    process.exitCode = 1;
    return;
  }
  const manifestPath = path.resolve(positional[0] || "docs/digital/security-evidence/stage5_5_3_evidence.json");
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const result = validateManifest(manifest);
    console.log(JSON.stringify({
      repositoryEvidenceValidation: "PASSED",
      structuralValidation: "PASSED",
      evidenceAssessmentStatus: result.evidenceAssessmentStatus,
      liveSecurityGate: "BLOCKED",
      liveGateAuthorization: "NOT_GRANTED_BY_STRUCTURAL_VALIDATOR",
      verifiedCaseCount: result.verifiedCaseCount,
      requiredCaseCount: result.requiredCaseCount,
      note: "This validator cannot authenticate Google execution or independently inspect evidence. A passing structural check is not live-security approval."
    }, null, 2));
    if (enforceLiveGate) {
      console.error("Live gate enforcement refused: an external authorized reviewer must independently inspect the underlying evidence; this validator cannot grant release authorization.");
      process.exitCode = 3;
    }
  } catch (error) {
    console.error("Security evidence validation failed: " + error.message);
    process.exitCode = 1;
  }
}
if (require.main === module) main(process.argv);
module.exports = { REQUIRED_CASES, validateManifest, deriveGateStatus, validDate, validEvidenceRef };
