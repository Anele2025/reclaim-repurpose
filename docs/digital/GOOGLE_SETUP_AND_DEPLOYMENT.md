# Google Setup and Deployment — Stage 5.3

## Status and boundary

Stage 5.3 adds an integrated, authorization-enforcing service boundary, audited organization-service configuration mutation, and recoverable idempotency orchestration. It does **not** mean a Google project, spreadsheet, AppSheet app, WhatsApp integration, or production service is deployed. No live Google account/project is verified by this repository implementation.

## Modules

- `identity.js`: reads the active Apps Script user email and fails closed if unavailable. Email availability depends on execution/deployment context; this adapter is not proof that every target account will be identifiable.
- `authorization.js`: retained central policy helpers; the service now independently resolves trusted memberships for every implemented operation.
- `sheetsRepository.js`: allow-listed sheets, exact header-width checks, typed writes, stable-ID updates, duplicate detection, and text formula-marker escaping. Idempotency schema now includes `resultJson` and `correlationId`.
- `audit.js`: validates required event fields and persists a bounded safe event shape; failures return safe codes.
- `idempotency.js`: holds a script lock across reservation and the bounded mutation, stores a successful result for identical retries, rejects conflicting payloads, and flags uncertain outcomes for reconciliation.
- `service.js`: company-owner organization summary read plus platform-admin organization service-enable/disable mutation, with trusted membership resolution, audit and idempotency.
- `entrypoints.js`: controlled Apps Script functions for the implemented reads and mutation, server-side SHA-256 payload digest, and no public `doGet` or `doPost` endpoint.

## Deployment and identity decision

The initial implementation is intended for a **restricted Apps Script project invoked by signed-in, authorized Google users**, with execution identity behavior confirmed in the actual deployment. The entry point uses `Session.getActiveUser().getEmail()`; Apps Script may return an empty email in some contexts. It fails closed when empty. Do not deploy it to execute as the owner for anonymous/public callers and assume it identifies the caller.

Before use, verify identity for the exact account types, domain settings, deployment mode, and caller access policy. If intended company owners cannot be reliably identified, do not expose this entry point; choose a reviewed authenticated architecture first. Caller-supplied identity, role, and membership are never accepted as proof.

## Required Script Property and sheets

Set Script Property `RECLAIM_SPREADSHEET_ID` to the dedicated synthetic-data test spreadsheet ID. Do not put the ID or credentials in source control. Create these sheets with exact header rows:

- `Organizations`: `organizationId, organizationName, country, currency, status, serviceEnabled, configVersion, createdAt, updatedAt`
- `Memberships`: `membershipId, organizationId, actorId, role, status, createdAt, updatedAt, revokedAt`
- `AuditEvents`: `eventId, timestamp, actorId, organizationId, action, outcome, reasonCode, operationId, recordRef, configVersion`
- `Idempotency`: `operationId, actorId, organizationId, operationType, payloadDigest, status, resultRef, createdAt, updatedAt, resultJson, correlationId`

Protect the spreadsheet so only project administrators and the required script execution identity can access it. Spreadsheet IDs are locators, not authorization. Do not share the underlying workbook with company owners unless a separate reviewed security design proves direct access cannot bypass the application boundary.

## Local tests

Use Node.js 22 and run:

```sh
node --test apps-script/tests/*.test.js
python scripts/validate_stage4.py
```

Tests use synthetic data and test doubles. They do not prove live Apps Script identity, actual Sheets permissions, concurrency across Google executions, AppSheet isolation, or deployed security.

## Security behavior and remaining limitations

- **Authorization:** The organization-summary operation requires an active `COMPANY_OWNER` membership scoped to the requested organization. The service-configuration mutation requires an active `PLATFORM_ADMIN` membership with a trusted global scope (`organizationId` blank or `PLATFORM`). Request-supplied identity, role, membership and digest are not trusted.
- **Organization status:** Company-owner operational reads require `ACTIVE` status and enabled service. `PROSPECT` is not operationally enabled. Platform administrators may change the service-enabled flag for non-archived organizations, including paused/suspended organizations, but this does not activate or unsuspend an organization.
- **Idempotency:** States are `PROCESSING`, `SUCCEEDED`, `FAILED_RETRYABLE`, and `RECONCILIATION_REQUIRED`. The shared ScriptLock is held through the bounded Sheets mutation. An identical `SUCCEEDED` retry returns its recorded result. A conflicting payload is denied. Existing `PROCESSING` and uncertain operations are not replayed automatically.
- **Recovery:** Uncertain writes, unreadable stored results, and post-write audit failures require reconciliation. No automated stale-operation worker or full multi-sheet transaction is implemented. Preserve unresolved operation rows and investigate the referenced organization and audit events before any manual action.
- **Audit:** A required pre-write audit event must persist before the organization setting changes. If a post-write audit fails, the operation is marked `RECONCILIATION_REQUIRED` when storage permits; callers must not retry blindly.
- **Storage schema:** The Idempotency sheet now requires 11 exact columns, including `resultJson` and `correlationId`. This is a Stage 5.3 schema change. There is no verified live workbook; update only a disposable synthetic test sheet by backing it up and recreating the exact header before integration testing. Do not run a silent migration against real operational data.
- **Google transaction limits:** A ScriptLock coordinates executions that use this same script/lock scope; it does not create a general transaction across Google Sheets, protect against direct spreadsheet edits, or prove behavior for other scripts/projects. Exactly-once execution is not claimed.
- **Identity:** `Session.getActiveUser().getEmail()` can be empty depending on account and execution context. Verify the exact deployment model. Do not expose a public/anonymous web app or execute as owner for untrusted callers.
- **Performance and quotas:** repository reads still scan configured tables. Measure actual size, quotas and concurrent execution behavior before use. The service does not yet implement broad operational CRUD or an AppSheet integration.
- **Live verification:** Local tests and GitHub Actions do not prove real Apps Script identity, spreadsheet permissions, locking, AppSheet isolation, quota behavior or production security.

## Local verification

Use Node.js 22 and run:

```sh
node --test apps-script/tests/*.test.js
python scripts/validate_stage4.py
```
## Test-project procedure

1. Create a dedicated Apps Script project and synthetic test spreadsheet.
2. Add the source files and manifest to the Apps Script project; configure `RECLAIM_SPREADSHEET_ID`.
3. Grant only required scopes and test with two synthetic company-owner accounts plus a platform administrator.
4. Verify active-user identity under the exact intended deployment. Confirm empty/unavailable identity is denied.
5. Test cross-organization access, revoked memberships, suspended organizations, missing headers, duplicate IDs, audit failures, and repeated operation IDs.
6. Record the deployment mode, test identities, timestamps, observed outcomes, and commit SHA. Do not record tokens or participant data.
7. Keep production deployment disabled until identity, durable idempotency recovery, audit failure policy, and direct spreadsheet access have passed review.

## Rollback

Disable the test deployment or remove its invocation permissions; preserve audit evidence. Restore the previous source revision using version control. Do not delete operational records to roll back code. Rotate/revoke credentials if exposure is suspected.

No Google deployment, AppSheet app, WhatsApp provider, QR service, GPS flow, payment gateway, or production monitoring has been created by these repository changes.
