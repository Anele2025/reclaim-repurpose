# Stage 5.14 — Safe Events Schema Migration and Upgrade Recovery

## Status and verified baseline

- Repository: `Anele2025/reclaim-repurpose`
- Implementation branch: `stage-5-14-safe-schema-migration`
- Verified Stage 5.13 PR: [#20](https://github.com/Anele2025/reclaim-repurpose/pull/20), draft, open, unmerged at inspection.
- Stage 5.13 head used as the implementation parent: `f781118f644b60e5d6288c0d1fe70e2167757d01`.
- Stage 5.13 base branch: `stage-5-12-claim-fencing-recovery`, base SHA `cedfc9abe73298af017817449d5a62313bd2a94c`.
- Verified Stage 5.12 PR: [#19](https://github.com/Anele2025/reclaim-repurpose/pull/19), draft, open, unmerged at inspection.
- Stage 5.12 head: `cedfc9abe73298af017817449d5a62313bd2a94c`.
- The implementation branch was created directly from the reported and independently fetched Stage 5.13 head. Existing branches and PRs were not rewritten, merged, or deployed.

## Actual Events schema contracts

### Version 1 (observed on `stage-5-11-durable-sheets-recovery`)

Exact header order (14 columns):

1. `schemaVersion`
2. `scopeKey`
3. `eventId`
4. `digest`
5. `status`
6. `claimToken`
7. `claimedAt`
8. `leaseExpiresAt`
9. `attempts`
10. `createdAt`
11. `updatedAt`
12. `completedAt`
13. `resultJson`
14. `lastErrorCode`

### Version 2 (observed on Stage 5.13 head)

Exact header order (18 columns):

1. `schemaVersion`
2. `scopeKey`
3. `organizationId`
4. `eventId`
5. `digest`
6. `status`
7. `claimToken`
8. `claimedAt`
9. `leaseExpiresAt`
10. `attempts`
11. `createdAt`
12. `updatedAt`
13. `completedAt`
14. `resultJson`
15. `lastErrorCode`
16. `registrationId`
17. `operationId`
18. `registrationFingerprint`

Version 2 adds `organizationId` and the durable registration-linkage tuple `registrationId`, `operationId`, and `registrationFingerprint`. Existing code requires exact header names/order and does not accept legacy Events headers through the normal adapter. The other tab headers (Sessions, Registrations, Audit) were unchanged between the inspected version-1 and version-2 source definitions; their persisted rows are not rewritten by this Events-only migration.

## Field-by-field migration decision

| Field | Version 1 evidence | Decision |
|---|---|---|
| `schemaVersion` | Column exists; historical rows may contain 1 | No row versions are rewritten; any non-empty v1 Events sheet is refused |
| `scopeKey` | Exists; formed from organization and account scope by adapter code | Not parsed to infer `organizationId`; delimiters are not forbidden in both inputs and the value alone is insufficiently unambiguous |
| `organizationId` | Not persisted in v1 Events rows | Cannot be safely reconstructed for arbitrary historical rows |
| `eventId`, `digest` | Persisted | Must remain immutable; no records are transformed |
| Status/claim/timing fields | Persisted | Active or stale claim state cannot be reconstructed or fenced safely during a row rewrite; no records are transformed |
| `registrationId`, `operationId` | Absent from v1 Events | Cannot be guessed from a separate registration table |
| `registrationFingerprint` | Absent from v1 Events | Cannot be reconstructed without authoritative original request evidence |

Therefore, only an exactly recognized **empty** version-1 Events sheet can be migrated automatically. A non-empty v1 Events sheet is explicitly refused for manual review. This is intentionally conservative: the stage does not claim backward compatibility for populated legacy workbooks.

## Migration protocol and state machine

The public adapter method `migrateEventsSchema()` runs under the existing bounded ScriptLock and returns explicit outcomes:

- `MIGRATED`: target headers were read back exactly and the sheet remains empty.
- `ALREADY_CURRENT`: exact version-2 headers already exist; no write is performed.
- `REFUSED`: missing sheet/marker, duplicate columns, unknown/malformed schema, or non-empty v1 Events rows.
- `INCOMPLETE`: a write failed and read-back still proves the original empty v1 schema; retry is permitted.
- `RECONCILIATION_REQUIRED`: read-back failed or found an unexpected/partial schema; do not proceed with normal use until manually inspected.

Permitted transitions:

`V1_EMPTY -> MIGRATED -> V2_EMPTY`

`V1_EMPTY -> INCOMPLETE -> (retry) -> MIGRATED`

`V1_NONEMPTY -> REFUSED` (no mutation)

`UNKNOWN_OR_MALFORMED -> REFUSED` (no mutation)

`PARTIAL_OR_UNREADABLE -> RECONCILIATION_REQUIRED`

The exact header row is the migration marker; no separate marker write is needed for the only allowed mutation. The migration changes one header row and never rewrites event records. If a write acknowledgement is lost, it reads the actual header and row count: exact v2 plus no event rows means the write persisted; exact v1 plus no event rows is retryable; anything else requires reconciliation. Google Sheets is not treated as transactional.

## Refusal conditions and concurrency boundary

- Any data row in a v1 Events sheet causes refusal. This includes PROCESSING, COMPLETE, RETRYABLE, REJECTED, and otherwise malformed/unknown event states.
- Unknown, duplicate, missing, reordered, or unexpected header columns are not silently normalized.
- The operation uses the existing ScriptLock with the configured bounded timeout and releases it through the existing `finally` path.
- The lock only coordinates cooperating executions using this Apps Script project's ScriptLock. It does not protect against direct spreadsheet edits or unrelated writers.
- Because migration only proceeds on an empty Events sheet, there are no active claims to preserve or registration links to rewrite during the permitted migration.
- No registration row is modified, deleted, or appended. No WhatsApp message is sent and no collection is scheduled.
- The method does not claim exactly-once processing or production readiness.

## Tests added in this stage

Deterministic adapter tests cover:
- exact empty v1 schema migrates and repeat invocation is a no-op;
- non-empty v1 schema is refused without changing any row;
- duplicate and unknown headers are refused without mutation;
- write acknowledgement lost after the header persists is resolved by read-back;
- pre-write failure leaves v1 intact and a retry can safely proceed;
- bounded lock acquisition failure leaves the legacy header unchanged.

These tests use a synthetic spreadsheet adapter. They do not prove real Google Sheets behavior. The full requested crash matrix and all real interleavings are not claimed as covered; the fail-closed empty-sheet-only rule reduces the mutation surface.

## Files changed

- `apps-script/src/whatsappSheetsStore.js`: adds explicit fail-closed `migrateEventsSchema()`; normal initialization remains strict and does not silently migrate legacy workbooks.
- `apps-script/tests/whatsappSheetsStore.test.js`: adds last-column support to the fake sheet and deterministic migration/refusal/retry tests.
- `.github/workflows/stage5-validation.yml`: includes the Stage 5.14 branch in push validation triggers.
- `.github/workflows/stage5-5-3-security-evidence.yml`: includes the Stage 5.14 branch in push validation triggers.
- `docs/digital/STAGE_5_14_SAFE_SCHEMA_MIGRATION.md`: this report.

## Validation evidence

The following actual GitHub Actions runs completed successfully for the implementation/test head `6bbf118365908ebc3b368916ec3f88032b1a931d`:

- [Stage 5 validation #38834615673](https://github.com/Anele2025/reclaim-repurpose/actions/runs/38834615673): **success** — 148 JavaScript tests passed, 0 failed; 4 Python packaging tests passed; deterministic Apps Script package build, generated-package checks, generated JavaScript syntax check, and Stage 4 validation passed.
- [Security Evidence Validation #38834617019](https://github.com/Anele2025/reclaim-repurpose/actions/runs/38834617019): **success** — evidence-validator and adversarial evidence-gate tests, all 148 JavaScript tests, 4 Python packaging tests, deterministic package build, syntax check, Stage 4 validation, and explicit live-gate limitation check passed.

These results verify repository tests for the code/test commit above. A subsequent report-only commit changes documentation, not implementation logic; its own Actions runs must still be checked before claiming the final PR head's checks are green.

No Google Sheet was accessed. No Apps Script was deployed. No WhatsApp provider was contacted. No real participant data or production credentials were used.

## Completion status and limitations

- Implementation: added, awaiting CI confirmation.
- Automated tests: awaiting actual run result.
- GitHub Actions: awaiting actual run result for the final head.
- Real Google Sheets integration: not verified.
- Apps Script deployment: not performed.
- WhatsApp provider integration: not verified.
- Production readiness: not established.
- Populated version-1 Events workbooks: **not safely auto-migrated**; they are refused and require a separately designed, evidence-backed recovery procedure.

## Next technical stage

After this branch's tests are independently green and reviewed, the next stage should define a controlled synthetic/isolated Google Sheets integration-test plan and deployment-readiness checklist. Do not migrate a populated production workbook or deploy based only on repository tests.
