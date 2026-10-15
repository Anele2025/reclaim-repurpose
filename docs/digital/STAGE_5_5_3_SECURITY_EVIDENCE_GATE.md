# Stage 5.5.3 — Machine-Checkable Security Evidence Intake

**Effective live-security gate: BLOCKED.**  
**Evidence assessment: BLOCKED** in the committed baseline.  
**Live Google verification: NOT VERIFIED.**

This stage adds a structured test inventory and validator. It does not access Google resources, deploy Apps Script, authenticate external logs, or authorize production release.

## Files

- `docs/digital/security-evidence/stage5_5_3_evidence.json` — synthetic baseline inventory for all required verification cases.
- `scripts/validate_security_evidence.js` — dependency-free Node.js structural validator.
- `apps-script/tests/stage5_5_3_security_evidence.test.js` — adversarial tests for malformed, missing, contradictory, synthetic, and claimed live evidence.
- `.github/workflows/stage5-5-3-security-evidence.yml` — dedicated repository-validation workflow.

## Run the checks

From the repository root:

```sh
node --test apps-script/tests/stage5_5_3_security_evidence.test.js
node scripts/validate_security_evidence.js
node --test apps-script/tests/*.test.js
python -m unittest scripts.test_package_apps_script
python scripts/package_apps_script.py
node --check < dist/apps-script/Code.gs
python scripts/validate_stage4.py
```

The manifest validator exits non-zero for malformed JSON, missing or unknown cases, duplicate IDs, unsupported states, missing provenance, placeholder evidence, mock-only evidence represented as live, invalid evidence paths, and contradictory evidence-assessment states.

A structurally valid inventory with all required cases still `NOT_STARTED` is expected to pass repository validation while reporting the live gate as `BLOCKED`. This keeps ordinary development usable without falsely passing the live gate.

The optional `--enforce-live-gate` flag intentionally exits non-zero even when the manifest claims all cases are verified. This validator has no trusted external attestation mechanism and therefore cannot grant release authorization.

## States and interpretation

Each test case uses one of:

- `NOT_STARTED` — no qualifying execution has been recorded.
- `IN_PROGRESS` — an identified test environment has been selected and the test is underway.
- `BLOCKED` — a prerequisite or safe execution path is unavailable.
- `FAILED` — the observed outcome failed the required security property.
- `VERIFIED` — the record claims a qualifying live test passed and includes required provenance and independent-review fields.

Environment values are `NOT_STARTED`, `SYNTHETIC`, and `GOOGLE_LIVE`. A `VERIFIED` case must identify the live environment, timezone-aware execution time, full source commit SHA, expected and observed outcomes, sanitized relative evidence reference, authorized project-owner verifier, and an independent-review record. Synthetic/mock methods cannot qualify.

The manifest separately records `evidenceAssessmentStatus` and the effective `gateStatus`. The effective gate is deliberately constrained to `BLOCKED` by this validator. A manifest field, screenshot, CI result, or reviewer name alone is not an authenticated release attestation.

## Required coverage

The manifest enumerates these 13 cases:

1. Actual Apps Script execution identity.
2. Missing or unavailable caller identity.
3. Company A/B data isolation.
4. Spoofed organization or resource identifiers.
5. Revoked owner access.
6. Administrator-only operations.
7. Direct Google Drive/spreadsheet access, including inherited and link sharing.
8. Audit integrity and failure handling.
9. Duplicate operation IDs and idempotency.
10. Concurrency, locking, and uncertain-write recovery.
11. Spreadsheet schema and data integrity.
12. Formula-injection safety.
13. AppSheet-to-service authentication, once an actual integration path has been designed.

The baseline marks all 13 `NOT_STARTED`. AppSheet authentication remains unselected and unverified.

## Evidence intake and review procedure

1. An authorized Google project owner performs each test in a dedicated synthetic Apps Script project and disposable workbook.
2. Record the actual source SHA, timestamp with timezone, restricted deployment mode, synthetic identity label, expected/observed result, sanitized evidence reference, execution method, and limitations.
3. Keep emails, spreadsheet/project/deployment IDs, credentials, OAuth tokens, secret URLs, raw private logs, and participant information out of committed evidence. If an artifact cannot be sanitized without destroying its value, keep it in an appropriately access-controlled location and reference it using an approved non-sensitive identifier.
4. Do not change a case to `VERIFIED` until the underlying evidence has been reviewed. The independent reviewer must inspect the original test artifacts and the execution context, not merely the JSON fields or screenshots.
5. Record failed or inconclusive results as `FAILED`, `BLOCKED`, or `IN_PROGRESS` as appropriate. Do not delete failed results to make the inventory pass.
6. Have a reviewer who did not execute the test independently inspect the evidence, including actual Drive sharing/inherited permissions for direct-access cases.
7. Obtain an explicit release decision through the project's separately authorized review process. The current validator does not authenticate reviewers, Google logs, or external artifacts and intentionally cannot grant that decision.
8. Retain the private test-resource inventory and cleanup decision. Do not share the master workbook with company owners. Do not create, share, deploy, or delete Google resources without the project owner's explicit authorization.

## What automation cannot prove

The validator can check structure, required coverage, internal consistency, and obvious contradictions. It cannot establish that:

- a Google execution actually happened;
- an artifact came from the claimed Google project or deployment;
- a timestamp or verifier identity is authentic;
- an independent reviewer genuinely inspected the evidence;
- Drive permissions were inspected accurately;
- the observed outcome was not fabricated outside the repository.

For this reason, the CI workflow is explicitly named repository validation, and its green result is **not** live Google security approval. The effective gate remains blocked until real tests are performed and the underlying evidence is independently reviewed through an authorized process.

## Stage decision

- Repository validator and tests: intended for automated validation.
- Live Google verification: **NOT VERIFIED**.
- Effective live-security gate: **BLOCKED**.
- AppSheet dashboards / Stage 5.6: **do not begin** until identity, tenant isolation, direct workbook access, revocation, audit, idempotency, concurrency/recovery, schema, and other mandatory live checks have passed and been reviewed.
