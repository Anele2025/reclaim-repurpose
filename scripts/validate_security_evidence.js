#!/usr/bin/env node
"use strict";

/**
 * Structural validator for Stage 5.5.3 evidence records.
 * It cannot authenticate external Google execution or independently review artifacts.
 */
const fs = require("node:fs");
const path = require("node:path");

const STATES = new Set(["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "FAILED", "VERIFIED"]);
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
const PLACEHOLDER_RE = /^(?:todo|tbd|placeholder|example(?:[-_ ].*)?|change[-_ ]?me|not provided|unknown)$/i;

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
function validDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && /(?:Z|[+-]\d{2}:?\d{2})$/.test(value);
}
function hasPlaceholder(value, location) {
  if (typeof value === "string" && PLACEHOLDER_RE.test(value.trim())) {
    fail("Placeholder value is not acceptable at " + location);
  }
  if (Array.isArray(value)) value.forEach((item, i) => hasPlaceholder(item, location + "[" + i + "]"));
  else if (isObject(value)) Object.entries(value).forEach(([key, item]) => hasPlaceholder(item, location + "." + key));
}
function validEvidenceRef(value) {
  if (!nonEmpty(value) || value.includes("\\") || value.startsWith("/") || /^[a-z]+:\/\//i.test(value)) return false;
  const parts = value.split("/");
  return parts.every(part => part && part !== "." && part !== "..") && !value.includes(":");
}
function validateVerifiedCase(item, index) {
  const prefix = "cases[" + index + "]";
  if (item.environment !== "GOOGLE_LIVE") fail(prefix + " cannot be VERIFIED outside GOOGLE_LIVE");
  if (!validDate(item.executedAt)) fail(prefix + ".executedAt must be an ISO timestamp with timezone");
  if (!SHA_RE.test(item.executionCommitSha || "")) fail(prefix + ".executionCommitSha must be a full commit SHA");
  if (!nonEmpty(item.expectedOutcome) || !nonEmpty(item.observedOutcome)) fail(prefix + " requires expected and observed outcomes");
  if (!validEvidenceRef(item.evidenceRef)) fail(prefix + ".evidenceRef must be a sanitized relative artifact path");
  if (!nonEmpty(item.executionMethod) || /mock|synthetic|test.double|fixture/i.test(item.executionMethod)) {
    fail(prefix + " executionMethod cannot describe mock-only evidence");
  }
  if (item.verifierRole !== "AUTHORIZED_PROJECT_OWNER") fail(prefix + " requires an authorized project owner as verifier");
  if (item.independentReviewRequired !== true || item.independentReviewCompleted !== true) {
    fail(prefix + " requires completed independent review");
  }
  if (!isObject(item.review)) fail(prefix + ".review is required for VERIFIED evidence");
  if (item.review.reviewerRole !== "INDEPENDENT_REVIEWER" || item.review.decision !== "APPROVED" ||
      !validDate(item.review.reviewedAt) || !validEvidenceRef(item.review.reviewRecordRef)) {
    fail(prefix + ".review must identify an independent approval record and timestamp");
  }
}
function deriveGateStatus(cases) {
  if (cases.some(item => item.status === "FAILED")) return "FAILED";
  if (cases.some(item => item.status === "BLOCKED" || item.status === "NOT_STARTED")) return "BLOCKED";
  if (cases.some(item => item.status === "IN_PROGRESS")) return "IN_PROGRESS";
  return "VERIFIED";
}
function validateManifest(manifest) {
  if (!isObject(manifest)) fail("Manifest must be a JSON object");
  if (manifest.schemaVersion !== 1) fail("schemaVersion must equal 1");
  if (!SHA_RE.test(manifest.baselineCommitSha || "")) fail("baselineCommitSha must be a full commit SHA");
  if (!Array.isArray(manifest.cases)) fail("cases must be an array");
  if (manifest.gateStatus !== "BLOCKED") fail("gateStatus must remain BLOCKED: this structural validator cannot authorize the live-security gate");
  if (!STATES.has(manifest.evidenceAssessmentStatus)) fail("evidenceAssessmentStatus is unsupported");
  hasPlaceholder(manifest, "manifest");

  const seen = new Set();
  for (let i = 0; i < manifest.cases.length; i += 1) {
    const item = manifest.cases[i];
    const prefix = "cases[" + i + "]";
    if (!isObject(item)) fail(prefix + " must be an object");
    for (const field of ["testCaseId", "securityProperty", "environment", "status", "baselineCommitSha",
      "expectedOutcome", "executionMethod", "verifierRole", "limitations"]) {
      if (!(field in item)) fail(prefix + "." + field + " is required");
    }
    if (!REQUIRED_IDS.has(item.testCaseId)) fail("Unknown test-case identifier: " + item.testCaseId);
    if (seen.has(item.testCaseId)) fail("Duplicate test-case identifier: " + item.testCaseId);
    seen.add(item.testCaseId);
    if (!STATES.has(item.status)) fail(prefix + ".status is unsupported");
    if (!ENVIRONMENTS.has(item.environment)) fail(prefix + ".environment is unsupported");
    if (!SHA_RE.test(item.baselineCommitSha || "")) fail(prefix + ".baselineCommitSha must be a full commit SHA");
    if (typeof item.independentReviewRequired !== "boolean" || typeof item.independentReviewCompleted !== "boolean") {
      fail(prefix + " review flags must be booleans");
    }
    if (item.status === "VERIFIED") validateVerifiedCase(item, i);
    else if (item.status === "NOT_STARTED" || item.status === "BLOCKED") {
      if (item.executedAt !== null || item.evidenceRef !== null || item.observedOutcome !== null) {
        fail(prefix + " cannot contain execution evidence while status is " + item.status);
      }
    } else if (item.status === "IN_PROGRESS") {
      if (item.environment === "NOT_STARTED") fail(prefix + " IN_PROGRESS requires a selected environment");
    } else if (item.status === "FAILED") {
      if (!nonEmpty(item.observedOutcome)) fail(prefix + " FAILED requires an observed outcome");
    }
  }
  const missing = [...REQUIRED_IDS].filter(id => !seen.has(id));
  if (missing.length) fail("Missing required test cases: " + missing.join(", "));
  const derived = deriveGateStatus(manifest.cases);
  if (manifest.evidenceAssessmentStatus !== derived) fail("evidenceAssessmentStatus contradiction: manifest says " + manifest.evidenceAssessmentStatus + ", derived status is " + derived);
  return { structurallyValid: true, evidenceAssessmentStatus: derived, gateStatus: "BLOCKED", requiredCaseCount: REQUIRED_IDS.size, verifiedCaseCount: manifest.cases.filter(item => item.status === "VERIFIED").length };
}
function main(argv) {
  const args = argv.slice(2);
  const enforceLiveGate = args.includes("--enforce-live-gate");
  const positional = args.filter(arg => arg !== "--enforce-live-gate");
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
module.exports = { REQUIRED_CASES, validateManifest, deriveGateStatus };
