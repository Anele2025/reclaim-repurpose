# Stage 5.13 — Adversarial Recovery and Failure-Path Hardening

## Verified baseline

- Repository: `Anele2025/reclaim-repurpose`
- Stage 5.12 source branch: `stage-5-12-claim-fencing-recovery`
- Stage 5.12 source head used to create this branch: `cedfc9abe73298af017817449d5a62313bd2a94c`
- Stage 5.12 PR #19: https://github.com/Anele2025/reclaim-repurpose/pull/19
- The PR search result records PR #19 as open; its description states draft and unmerged. The implementation did not merge or deploy it.
- Stage 5.12 validation runs verified before this stage: [Stage 5 validation #38825995492](https://github.com/Anele2025/reclaim-repurpose/actions/runs/38825995492) and [Security Evidence Validation #38825995496](https://github.com/Anele2025/reclaim-repurpose/actions/runs/38825995496), both completed successfully for the Stage 5.12 head.

## Scope

This increment preserves WhatsApp as the intended customer channel, Google Apps Script as the backend, Google Sheets as the operational store, and GitHub as source control. It does not add a custom web app, a new database, payment functionality, blockchain functionality, provider integration, live Google access, or deployment.

## Defects identified and changes implemented

### 1. Repeated claim-token source could reissue a stale token

The prior adapter used the injected token generator's output directly. If a defective or test-injected generator returned the same value on a later retry of the same event, a stale worker's token could become valid again after the previous claim was released.

The adapter now appends the persisted per-event attempt generation to the generated token. First claim generation is 1; a retry increments the stored attempt count and uses the next generation. This specifically prevents a repeated base token from revalidating an earlier claim when the event attempt counter remains consistent. It is not a substitute for a transactional store or protection from arbitrary manual edits.

### 2. Registration identifiers were only checked within one tenant

The prior registration lookup filtered by organization before searching for matching registration or operation IDs. The same stable ID could therefore be inserted under a second organization rather than being treated as a conflict.

Registration matching now searches all rows for either stable identifier, then the existing full fingerprint/status validation rejects tenant, ID, or payload mismatches. Reconciliation also searches globally by either linked identifier and explicitly requires the candidate's organization, registration ID, operation ID, successful status, and fingerprint to match before recovery. Cross-tenant collisions are treated as contradictory evidence and quarantined.

### 3. Event completion accepted non-success-shaped results

The event adapter previously allowed a caller to mark an event complete with an arbitrary result object. It now requires an object whose `ok` property is exactly `true` before completion. The registration workflow already checks durable registration success before reporting `REGISTERED`; this adds a defensive store-level invariant.

### 4. Successful write calls were not consistently verified by read-back

The prior completion path returned success immediately after a normal write call. It now re-reads the event and verifies the tenant, digest, completion status, active claim token, exact serialized result, and completion timestamp before returning success. Registration linkage revalidates the tenant, digest, processing status, token, IDs, and fingerprint. Registration persistence read-back also checks the explicit organization, registration ID, and operation ID instead of relying only on the fingerprint and status. These checks make silent/no-op fake writes fail closed; they do not make Sheets transactional.

## Tests added

Added deterministic regression tests to `apps-script/tests/whatsappSheetsStore.test.js` for:

- repeated injected claim-token output across event retries;
- rejection of a stale token from the previous generation;
- refusal to complete an event with `ok: false`;
- registration-ID reuse across organizations;
- operation-ID reuse across organizations;
- cross-tenant identifier collisions during reconciliation.

Additional tests cover missing/empty/wrong-event/wrong-scope claim tokens, changed payload under a reused registration ID, duplicate registration rows, repeated bounded reconciliation, lock release after a thrown operation, best-effort audit failure, silent/no-op writes at event completion, registration linkage, and registration append boundaries, plus read-back failures after persisted linkage/registration writes.

The fake-spreadsheet fixture remains synthetic. A seeded conflicting row models a writer bypassing this adapter; it does not claim to simulate all real Google Sheets races.

## Lifecycle and recovery rules

- A claim token is associated with the event's persisted attempt generation.
- Completion requires the active claim token and a successful result object.
- Registration idempotency searches stable identifiers across organizations, then validates the complete tenant/ID/fingerprint/status tuple.
- Reconciliation can complete an expired event only when exactly one durable registration row proves the full linked tuple; otherwise it leaves the event in `RECONCILIATION_REQUIRED`.
- Reconciliation does not delete registrations or send WhatsApp messages.
- An exception after a Sheets write is still an uncertain outcome; it is not proof that the write did not persist.
- A green test suite cannot establish a transactional or exactly-once guarantee.

## Validation status

**Automated repository validation passed for implementation commit `3104adf0fc7faea39d23ce93f308741ad184f6da`.**

- [Stage 5 validation #38827454423](https://github.com/Anele2025/reclaim-repurpose/actions/runs/38827454423): **success** — 142 JavaScript tests passed, 0 failed; 4 Python package tests passed; deterministic package build, generated-package content checks, generated JavaScript syntax check, and Stage 4 validation passed.
- [Security Evidence Validation #38827454409](https://github.com/Anele2025/reclaim-repurpose/actions/runs/38827454409): **success** — evidence-validator tests, adversarial evidence-gate tests, all 142 JavaScript tests, 4 Python package tests, deterministic package build, generated syntax check, and Stage 4 validation passed.
- Both workflows completed successfully for implementation commit `3104adf0fc7faea39d23ce93f308741ad184f6da`. A documentation-only update to this report will advance the branch head; the pull request's latest head and its own runs must still be checked separately.
- These are repository/fixture checks only. They do not prove real Google Sheets concurrency, transactional behavior, exactly-once processing, live integration, or deployment.

## Limitations and non-goals

- Google Sheets is not a transactional database.
- ScriptLock coordinates cooperating executions in its actual Apps Script lock scope; it does not fence manual edits or independent writers.
- The attempt-generation suffix relies on the persisted attempt counter remaining trustworthy. Arbitrary manual edits, counter corruption, and malicious writers outside this adapter remain outside the fencing guarantee.
- Synthetic tests are not live Google Sheets or Apps Script integration tests.
- Events schema version 2 remains incompatible with version 1 workbooks; no migration is implemented here.
- Provider webhook authentication, real WhatsApp delivery, real spreadsheet permissions, deployment, and production readiness remain unverified/not implemented.

## Next step

After independent review of this branch and its CI, plan a separately scoped synthetic workbook/schema migration assessment and then a controlled live Google integration verification only when explicitly authorized. Do not merge, migrate a live workbook, or deploy based solely on this repository test stage.
