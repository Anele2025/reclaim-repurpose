# Stage 5.12 — Claim-Token Fencing and Durable Registration Recovery

## Verification baseline

- Repository: `Anele2025/reclaim-repurpose`
- Verified source branch: `stage-5-11-durable-sheets-recovery`
- Baseline SHA: `32dd60a66277dcdacd6fe66112f4f5c6dbcdd91e`
- The branch compared identical to that SHA at inspection time.
- PR #18 was reported open in GitHub search; its recorded target is Stage 5.10. PR #17 is also open. This Stage 5.12 branch is stacked directly on the Stage 5.11 source head and neither predecessor was merged by this work.

## Implemented

- Bumped the Sheets adapter schema to version 2. Events now persist tenant identity plus registration ID, operation ID, and registration fingerprint.
- Added claim-token generation using Apps Script `Utilities.getUuid()` by default, with the existing injected ID generator retained for deterministic tests.
- Changed event completion and release to require a claim token matching the persisted token. Missing or stale tokens fail with `STALE_CLAIM_TOKEN`.
- Added `linkRegistration`, which persists the stable registration operation and canonical payload fingerprint before registration persistence is called, then re-reads the event record to verify the linkage.
- Updated the workflow to pass the claim token through completion/release and to fail closed if durable linkage cannot be confirmed.
- Extended bounded reconciliation: an expired claim is completed only when its linked registration row is uniquely present, marked `SUCCEEDED`, and matches the stored fingerprint. Otherwise it is quarantined for manual review. Reconciliation does not delete registrations or send messages.
- Added fake-adapter tests for stale-worker fencing, linkage persistence, successful linked-registration recovery, and conservative quarantine when a linked registration is missing.
- Added the Stage 5.12 branch to relevant validation workflow triggers.

## Files changed

- `apps-script/src/whatsappSheetsStore.js`
- `apps-script/src/whatsappRegistration.js`
- `apps-script/tests/whatsappSheetsStore.test.js`
- `apps-script/tests/whatsappRegistration.test.js`
- `.github/workflows/stage5-validation.yml`
- `.github/workflows/stage5-5-3-security-evidence.yml`
- `docs/digital/GOOGLE_SETUP_AND_DEPLOYMENT.md`
- `docs/digital/STAGE_5_12_CLAIM_FENCING_AND_RECOVERY.md`

## State and recovery rules

1. A successful `begin` persists a new token before returning `NEW`.
2. Only the currently persisted token can link registration, complete the event, or release it.
3. The workflow writes event-to-registration linkage before invoking the registration adapter.
4. Registration persistence remains idempotent by the existing stable registration/operation identifiers.
5. Reconciliation may recover an expired event only when one matching durable registration record proves the linked operation succeeded.
6. Expired claims without a uniquely matching durable registration remain `RECONCILIATION_REQUIRED`; the system does not assume the previous worker stopped.
7. Stale workers are fenced from later event mutations through the cooperating adapter. The lock does not protect against direct spreadsheet edits or other writers.

## Verification status

- Implementation: committed on the Stage 5.12 branch.
- Test changes: committed; automated tests have **not been independently executed in this implementation session**.
- CI: pending a GitHub Actions run for the final branch head; do not infer a pass from the existence of workflow files.
- Real Google Sheets / Apps Script integration: NOT TESTED.
- WhatsApp provider integration: NOT IMPLEMENTED.
- Deployment: NOT PERFORMED.
- Production readiness: NOT APPROVED.

## Known limitations and migration warning

The Events schema is now version 2. Existing version 1 sheets will fail schema validation; this increment intentionally does not perform an automatic migration. Test only against a disposable synthetic workbook until a separately reviewed migration procedure exists.

Google Sheets does not provide a multi-row transaction. A write may persist while its acknowledgement is lost, and independent sheet operations are not atomic. The reconciliation logic only recovers a registration when the linked row is uniquely present and its fingerprint matches. Missing or contradictory evidence remains a manual-review case. Claim-token fencing is only enforced by cooperating code using this adapter's ScriptLock; it does not prevent manual cell edits or writes from other projects. This is not an exactly-once execution or message-delivery guarantee.

## Next step

Inspect the exact Stage 5.12 branch head and its Actions runs. Fix any regression or packaging failures before considering Stage 5.13 adversarial recovery testing. Do not merge, deploy, connect a live workbook, or enable a WhatsApp endpoint without separate authorization.
