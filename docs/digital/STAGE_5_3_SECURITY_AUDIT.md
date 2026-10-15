# Stage 5.3 Security Audit and Implementation Evidence

**Audit date:** 2026-10-15  
**Repository:** Anele2025/reclaim-repurpose  
**Default branch:** main  
**Default-branch commit inspected:** 17650cc907944a40a28639c6d290de586c7e11c3  
**Stage 5.3 branch:** stage-5-3-secure-recoverable-service

## Baseline and pull-request state

- PR #5 remains open and unmerged. Base: stage-4-validation-evidence; head: stage-5-working-mvp at 2f902f929da11064feb02f7393d4d436fcbf6ca8.
- PR #6 remains open and unmerged. Base: stage-5-working-mvp; head: stage-5-2-authenticated-sheets-backend at efae99bdee1b65be554ebdc83f3158c7e7a1a1e3.
- PR #6's recorded Stage 5 validation workflow run 38732756136 succeeded for that Stage 5.2 commit. The combined-status endpoint returned no status entries; the workflow-run record is the available evidence. That run does not verify Stage 5.3 changes.
- Stage 5.3 branch was created from the Stage 5.2 head. PR #5 and PR #6 were not merged, closed, or retargeted.

## Confirmed Stage 5.2 findings

1. The service exposed only an organization-summary read; authorization helpers were not enforced as a complete service boundary.
2. Service membership lookup required a target organization, so a distinct trusted global platform-admin membership path was missing.
3. Audit persistence existed as a helper but was not integrated through successful and denied service paths.
4. Idempotency reserved a PROCESSING row and released its lock before a later mutation; it did not persist a terminal result or safely classify uncertain outcomes.
5. The operation payload digest was supplied by the caller to the idempotency adapter rather than computed by the service.
6. The Sheets adapter converted arbitrary values to strings on append, did not reject extra columns, and did not support controlled operation-state updates.
7. Formula-marker escaping did not account for leading whitespace.
8. Existing backend tests primarily exercised isolated helpers rather than the service-to-repository path.
9. The README's status text lagged the Stage 5.2 work.
10. Apps Script identity behavior, workbook permissions, AppSheet isolation, and live concurrency were not verified.

## Stage 5.3 implementation in this branch

- Central authorization now supports explicit global platform-admin scope and company-owner organization scope; the service calls this policy for its implemented operations.
- Service identity comes from the injected Apps Script identity adapter. Request-supplied role/actor/membership/digest values are not used as authorization evidence.
- The implemented owner read requires an active organization and enabled service.
- A representative platform-admin mutation toggles an organization's service-enabled flag, computes a SHA-256 payload digest through Apps Script Utilities, reserves an idempotency record, audits before and after the write, and stores a successful result.
- Idempotency holds the ScriptLock across the bounded operation, replays recorded successful results, rejects conflicting operation reuse, and marks uncertain outcomes for reconciliation rather than blind replay.
- The repository validates allow-listed sheets and exact configured headers, rejects unexpected columns and duplicate stable IDs, preserves basic value types, escapes formula-leading strings including whitespace-prefixed markers, and supports constrained updates.
- The Idempotency sheet schema now has 11 columns: operationId, actorId, organizationId, operationType, payloadDigest, status, resultRef, createdAt, updatedAt, resultJson, correlationId.
- Service-level synthetic tests cover spoofed claims, cross-organization owner access, inactive/ambiguous membership, platform-admin lookup, successful mutation, idempotent replay, conflicting payload, pre-write and post-write audit failure, lock failure, unresolved processing records, formula escaping, schema mismatch, duplicate IDs, and typed writes.
- Setup documentation and the README roadmap were updated. CI was configured to run on the Stage 5.3 branch.

## Known limits and risks

- No live Google Apps Script project or synthetic workbook was available for integration testing.
- Session.getActiveUser().getEmail() must be verified for the actual intended account/deployment model; local tests cannot establish this.
- A ScriptLock is not a general multi-sheet transaction and does not prevent direct workbook edits or writes by unrelated scripts/projects.
- Unresolved PROCESSING operations are fail-closed and require manual reconciliation. An automated stale-operation worker is not implemented.
- The representative mutation covers only serviceEnabled; broad organization/membership CRUD and operational-record workflows remain out of scope.
- The Idempotency sheet header has changed. No live sheet is verified; do not apply a silent migration to any real workbook.
- Google Sheets direct-access permissions, AppSheet security filters, WhatsApp integration, production monitoring, quota behavior, backup/restore, and deployment security remain unverified.
- GitHub Actions run 38734843323 completed successfully for head SHA 45f91be849ec45d3b945ac23eef9fb8d4797ea54. Its Node.js 22 Apps Script-compatible test step and Stage 4 structural/link validator both completed successfully. This verifies automated repository checks only; code review and live Google integration remain pending.

## Acceptance status at audit authoring

**Automated CI passed; overall acceptance remains partial.** The current reported head passed the configured Node.js test suite and Stage 4 validator. Live Google identity, permissions, locking, AppSheet isolation, source packaging, and deployment security remain unverified. No production deployment is authorized by this report.
