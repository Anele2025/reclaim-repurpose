# Stage 5.5.3 — Machine-Checkable Security Evidence Intake

**Effective live-security gate: BLOCKED.**  
**Evidence assessment: BLOCKED** in the committed baseline.  
**Live Google verification: NOT VERIFIED.**

This stage adds a structured test inventory and validator. It does not access Google resources, deploy Apps Script, authenticate external logs, or authorize production release.

## Files

- `docs/digital/security-evidence/stage5_5_3_evidence.json` — synthetic baseline inventory for all required verification cases.
- `scripts/validate_security_evidence.js` — dependency-free Node.js structural validator.
- `apps-script/tests/stage5_5_3_security_evidence.test.js` — baseline validator regression tests.
- `apps-script/tests/stage5_5_4_evidence_gate_hardening.test.js` — adversarial schema, state, timestamp, and reference-path tests.
- `.github/workflows/stage5-5-3-security-evidence.yml` — repository-validation workflow.

## Run the checks

From the repository root:

```sh
node --test apps-script/tests/stage5_5_3_security_evidence.test.js
node --test apps-script/tests/stage5_5_4_evidence_gate_hardening.test.js
node scripts/validate_security_evidence.js
node --test apps-script/tests/*.test.js
python -m unittest scripts.test_package_apps_script
python scripts/package_apps_script.py
node --check < dist/apps-script/Code.gs
python scripts/validate_stage4.py
```

## Stage 5.5.4 hardening findings

The Stage 5.5.3 code inspection identified gaps in the validator's structural contract:

- Unrecognized fields were ignored, so misspelled or misleading extra claims could coexist with a passing structural result.
- `BLOCKED` records did not reject a retained `executionCommitSha`, allowing stale provenance to remain on a case that claimed no execution evidence.
- The timestamp check relied on permissive date parsing and did not reject all impossible calendar dates.
- Evidence references were not constrained to the documented repository evidence directory or a strict, safe path character set.
- `FAILED` records required an observed outcome but did not require a complete execution record and artifact reference.

The hardening adds exact key sets for the manifest, cases, and review records; consistent required fields and state transitions; stricter timestamp parsing; repository-relative evidence path rules; failed-case provenance requirements; and regression tests for these cases. These are structural consistency fixes—not external evidence authentication.

## States and interpretation

Each test case uses one of:

- `NOT_EXECUTED` — no genuine execution result has been recorded.
- `BLOCKED` — a prerequisite or safe execution path prevents execution; no result is claimed.
- `AWAITING_INDEPENDENT_REVIEW` — live execution evidence is recorded, but an independent reviewer has not accepted it.
- `FAIL` — a live execution produced a failing security outcome; retain its provenance and evidence without claiming approval.
- `PASS` — the live test passed and the required independent review is recorded as approved.

Environment values remain `NOT_STARTED`, `SYNTHETIC`, and `GOOGLE_LIVE`. A `PASS` case must identify the live environment, a valid timezone-aware timestamp, full source commit SHA, expected and observed outcomes, sanitized relative evidence reference, authorized project-owner verifier, and independent-review record. An `AWAITING_INDEPENDENT_REVIEW` case must contain the same execution provenance but must not claim completed review. Synthetic/mock methods cannot qualify.

The manifest separately records `evidenceAssessmentStatus` and the effective `gateStatus`. The effective gate is deliberately constrained to `BLOCKED` by this validator. Unknown fields are rejected. The `--enforce-live-gate` flag intentionally exits non-zero even when the manifest claims every case is verified. No command-line flag, workflow variable, or manifest field grants release authorization.

## Required coverage

The manifest enumerates 13 cases:

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

The committed baseline marks all 13 `NOT_STARTED`. AppSheet authentication remains unselected and unverified.

## What automation can and cannot prove

The validator checks schema shape, required coverage, known statuses/environments, status/evidence consistency, basic provenance formats, path safety, review-field consistency, and aggregate status. Tests demonstrate that manually editing manifest fields cannot authorize the live gate.

It cannot establish that a Google execution actually happened, that an artifact came from the claimed project or deployment, that a timestamp or verifier identity is authentic, that Drive permissions were inspected accurately, or that an independent reviewer genuinely inspected the underlying evidence. A syntactically valid commit SHA is not proof that the external execution used that commit. Repository evidence paths are references, not proof that a file exists or is genuine.

The independent reviewer must inspect the original test artifacts and execution context, including actual Drive sharing and inherited permissions. Keep private resource IDs, emails, credentials, OAuth tokens, secret URLs, raw private logs, and participant information out of committed evidence.

## Stage decision

- Repository implementation: stricter structural validation and regression tests.
- Automated validation: determined only by CI for the exact tested commit.
- Live Google verification: **NOT VERIFIED**.
- Effective live-security gate: **BLOCKED**.
- Stage 5.6 dashboards: **do not begin** until identity, tenant isolation, direct workbook access, revocation, audit, idempotency, concurrency/recovery, schema, and other mandatory live checks have passed and the underlying evidence has been independently reviewed.
