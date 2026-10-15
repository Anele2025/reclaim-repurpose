# Stage 5.5 Live Google Integration Verification

**Decision: BLOCKED / NOT VERIFIED**  
**Repository baseline:** `b7c278d868730e964ce9f11487af58e2915fc983` (Stage 5.4 head at audit start)  
**Stage branch:** `stage-5-5-live-google-verification`  
**Purpose:** controlled acceptance gate; not a production deployment or an AppSheet build.

## 1. Scope and verified baseline

Stage 5.4 PR #8 was checked at the start of this stage: it was open and unmerged, with base `stage-5-3-secure-recoverable-service` at `0096aafb73e8bdcda761b889fbe835a75e3cbf5d` and head `stage-5-4-google-integration-packaging` at `b7c278d868730e964ce9f11487af58e2915fc983`. Its Stage 5 validation workflow run [38737216259](https://github.com/Anele2025/reclaim-repurpose/actions/runs/38737216259) completed successfully for that exact SHA. The single `pure-validation` job passed the Node.js 22 tests, package unit tests, deterministic package build, generated package checks, and Stage 4 validator. These are repository-level results, not live Google verification.

The existing implementation includes:
- `Session.getActiveUser().getEmail()` identity resolution that fails closed when the email is absent or the adapter throws.
- Trusted server-side membership lookup and role/scope checks in the service layer.
- Allow-listed sheet names and exact schemas in `sheetsRepository.js`.
- Formula-marker escaping for string values while preserving non-string numeric values.
- ScriptLock-based idempotency coordination, recorded successful results, conflicting-payload denial, and reconciliation-required states for uncertain outcomes.
- Audit events that are required for protected reads and mutations.

These code paths are exercised by Node tests with synthetic fixtures and test doubles. That does not establish how Google identity, sharing permissions, lock behavior, quotas, or deployment execution behave in a real Google project.

## 2. Explicit test environment prerequisites

**No live Google test is claimed in this report.** Do not access or modify any Google resource until the project owner has explicitly authorized the test and the exact test accounts/resources are agreed.

Prepare only after authorization:
1. A dedicated Apps Script project, separate from any production project.
2. A disposable Google spreadsheet containing synthetic records only.
3. Three separately authenticated test accounts: platform administrator, Company A owner, and Company B owner. Add a revoked-owner account or revoke a synthetic membership during the test.
4. Script Property `RECLAIM_SPREADSHEET_ID` set only inside the test project to the disposable spreadsheet ID.
5. Exact headers copied from `ReclaimSheetsRepository.schemas`:
   - `Organizations`: `organizationId, organizationName, country, currency, status, serviceEnabled, configVersion, createdAt, updatedAt`
   - `Memberships`: `membershipId, organizationId, actorId, role, status, createdAt, updatedAt, revokedAt`
   - `AuditEvents`: `eventId, timestamp, actorId, organizationId, action, outcome, reasonCode, operationId, recordRef, configVersion`
   - `Idempotency`: `operationId, actorId, organizationId, operationType, payloadDigest, status, resultRef, createdAt, updatedAt, resultJson, correlationId`
6. Access restricted to the project owner and only the execution identity required by the chosen deployment. Do not share the master workbook with either company owner.
7. A written resource inventory and cleanup plan before the first live operation.

Never commit spreadsheet IDs, personal account details, OAuth tokens, deployment URLs containing secrets, or raw sensitive execution logs.

## 3. Identity and authorization matrix

For every row, record timestamp with timezone, source SHA, test account label (not email), deployment mode, expected outcome, observed outcome, evidence reference, and pass/fail. Do not mark a test passed based on a mock.

| Case | Expected result | Live status |
|---|---|---|
| Active platform administrator, global membership | Authorized for documented admin operation; audit persisted | BLOCKED / NOT VERIFIED |
| Active Company A owner reads Company A | Allowed; only Company A summary returned | BLOCKED / NOT VERIFIED |
| Active Company B owner reads Company B | Allowed; only Company B summary returned | BLOCKED / NOT VERIFIED |
| Company A owner requests Company B | Denied; no Company B fields disclosed | BLOCKED / NOT VERIFIED |
| Revoked owner | Denied after membership revocation | BLOCKED / NOT VERIFIED |
| Unknown identity | Denied without protected data | BLOCKED / NOT VERIFIED |
| Active-user email missing or inaccessible | Denied; no fallback to caller-supplied identity | BLOCKED / NOT VERIFIED |
| Company owner invokes admin mutation directly | Denied server-side even if the UI is bypassed | BLOCKED / NOT VERIFIED |
| Direct invocation with spoofed actor/role fields | Caller-supplied claims do not grant access | BLOCKED / NOT VERIFIED |
| Stale, duplicate, malformed, or wrongly scoped membership | Denied; authorization ambiguity fails closed | BLOCKED / NOT VERIFIED |

The current repository tests include synthetic coverage for missing identity, revoked and ambiguous memberships, cross-organization access, spoofed role/actor request fields, and owner/admin role separation. Live behavior remains unverified.

## 4. Direct spreadsheet access and organization isolation

Application authorization and Google Sheets sharing are separate controls. For each company-owner test account:
- Attempt to open the spreadsheet directly using the normal Google Drive interface.
- Verify the account cannot read or export Company A, Company B, Memberships, AuditEvents, or Idempotency data outside its authorization.
- Confirm neither owner is a direct viewer/editor of the master workbook.
- Confirm an owner cannot manipulate organization IDs, filters, record IDs, or request arguments to read another organization's data through the approved entry point.
- Confirm denied responses contain only safe error codes/messages, not record contents or internal exception details.

If the proposed single-workbook model requires sharing the master workbook with company owners, **stop**. Do not proceed by relying on AppSheet slices, hidden views, or client-side filters. Document the smallest compatible remedy for review: keep the master workbook private to the trusted script/admin identity and expose only a separately secured owner-specific data source or a verified server-mediated interface. Do not implement that redesign as part of this test gate.

## 5. Concurrency, idempotency, recovery and audit

Run these tests only in the disposable workbook, with unique synthetic operation IDs:
- Two overlapping requests with the same operation ID and same payload.
- Reuse of an operation ID with a different payload.
- Lock acquisition failure/timeout.
- A previously recorded `PROCESSING` operation.
- A `RECONCILIATION_REQUIRED` operation.
- A `SUCCEEDED` operation with malformed/unreadable `resultJson`.
- Failure before the organization write.
- Failure after the write but before the final audit completes.
- Audit store unavailable.
- Retry after a known safe failure, without reusing an operation ID where the implementation requires a new one.
- Delayed duplicate execution and conflicting organization configuration updates.

Expected behavior: no blind replay of uncertain operations, no duplicate mutation for a successful identical retry, conflicting payloads denied, and safe denial if a lock or required audit is unavailable. Record the actual number of writes, resulting operation state, audit rows, and observed response. Do not describe ScriptLock as a multi-sheet transaction or claim exactly-once execution.

## 6. Schema and input integrity

Confirm exact sheet names and header order, including the 11-column Idempotency schema with `resultJson` and `correlationId`. In the disposable workbook, test missing headers, extra columns, missing required sheets, duplicate stable IDs, invalid membership status, invalid country/currency pairing, invalid operation status, and malformed records.

Test formula-like **text** beginning with `=`, `+`, `-`, `@`, including leading whitespace. Verify that text is escaped, while legitimate numeric values (including negative numeric values if a future field permits them) remain numeric. Capture before/after values and cell types in the synthetic test only.

Run repository checks from the repository root:
```sh
node --test apps-script/tests/*.test.js
python -m unittest scripts.test_package_apps_script
python scripts/package_apps_script.py
node --check < dist/apps-script/Code.gs
python scripts/validate_stage4.py
```

CI must separately report all job steps and the tested commit SHA. A skipped test, mocked test, package build, or green CI is not evidence that a live Google integration test passed.

## 7. Evidence log template

For each test, record:

| Field | Required value |
|---|---|
| Evidence ID | Synthetic label such as `S55-AUTH-001` |
| Date/time | ISO 8601 with timezone |
| Commit SHA | Exact tested SHA |
| Deployment mode | Exact Apps Script mode and caller policy |
| Actor label | `ADMIN`, `OWNER_A`, `OWNER_B`, `REVOKED_OWNER`; no personal email in Git |
| Setup | Synthetic workbook/project labels; no IDs or secrets |
| Expected result | Explicit allow/deny and data-disclosure expectation |
| Observed result | Actual result, including error code and whether data changed |
| Outcome | PASS / FAIL / BLOCKED |
| Cleanup | What test rows/resources were removed or disabled |

Do not write a test result until it has actually been observed. Keep the detailed evidence in an approved private record if it contains account or project details; commit only sanitized summaries.

## 8. Cleanup and rollback

After authorized testing:
1. Disable test deployments and remove invocation permissions.
2. Remove temporary sharing grants and verify the access list again.
3. Export only sanitized evidence needed for review.
4. Delete the disposable workbook/project only if the owner authorized deletion and evidence retention requirements are met.
5. Confirm cleanup in the evidence log.
6. Preserve repository audit documents and CI records.
7. If a credential or secret may have been exposed, revoke/rotate it and document the incident.

Code rollback is through version control. Do not use deletion of operational rows as a code rollback strategy.

## 9. Gate decision and remaining risks

**Current gate: BLOCKED / NOT VERIFIED.**

Repository tests and CI can verify deterministic code behavior against test doubles. No authorized Google test project, disposable live workbook, or separately authenticated test accounts were available to establish actual identity availability, direct spreadsheet access boundaries, real lock contention, quota behavior, or deployed execution security. No live test, deployment, AppSheet integration, or production readiness is claimed.

Do not begin Stage 5.6 AppSheet dashboard implementation until:
- identity is reliable for the exact execution model;
- cross-organization access and owner/admin role separation pass live tests;
- direct workbook access is independently verified;
- idempotency, audit-failure and uncertain-write behavior is recorded;
- the final CI run passes for the exact PR head SHA.

If live Google resources remain unavailable, keep the gate blocked and continue only safe repository-level verification.