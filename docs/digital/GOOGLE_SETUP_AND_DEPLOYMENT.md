# Google Setup and Deployment — Stage 5.2

## Status and boundary

Stage 5.2 adds Apps Script-compatible backend modules and local tests. It does **not** mean a Google project, spreadsheet, AppSheet app, WhatsApp integration, or production service is deployed. No live Google account/project was available to verify in this repository implementation.

## Modules

- `identity.js`: reads the active Apps Script user email and fails closed if unavailable. Email availability depends on execution/deployment context; this adapter is not proof that every target account will be identifiable.
- `authorization.js`: central membership, role, organization status, service-enabled, and record-scope policy.
- `sheetsRepository.js`: allow-listed sheet names, required headers, stable ID lookups, duplicate-row detection, and formula-leading string escaping.
- `audit.js`: safe structured audit writes and fail-closed result when persistence fails.
- `idempotency.js`: durable row reservation under a ScriptLock, duplicate/conflicting payload detection, and safe lock/store errors.
- `service.js`: injected application service; currently exposes only a minimal organization-summary read.
- `entrypoints.js`: controlled Apps Script function; no public `doGet` or `doPost` endpoint is exposed.

## Deployment and identity decision

The initial implementation is intended for a **restricted Apps Script project invoked by signed-in, authorized Google users**, with execution identity behavior confirmed in the actual deployment. The entry point uses `Session.getActiveUser().getEmail()`; Apps Script may return an empty email in some contexts. It fails closed when empty. Do not deploy it to execute as the owner for anonymous/public callers and assume it identifies the caller.

Before use, verify identity for the exact account types, domain settings, deployment mode, and caller access policy. If intended company owners cannot be reliably identified, do not expose this entry point; choose a reviewed authenticated architecture first. Caller-supplied identity, role, and membership are never accepted as proof.

## Required Script Property and sheets

Set Script Property `RECLAIM_SPREADSHEET_ID` to the dedicated synthetic-data test spreadsheet ID. Do not put the ID or credentials in source control. Create these sheets with exact header rows:

- `Organizations`: `organizationId, organizationName, country, currency, status, serviceEnabled, configVersion, createdAt, updatedAt`
- `Memberships`: `membershipId, organizationId, actorId, role, status, createdAt, updatedAt, revokedAt`
- `AuditEvents`: `eventId, timestamp, actorId, organizationId, action, outcome, reasonCode, operationId, recordRef, configVersion`
- `Idempotency`: `operationId, actorId, organizationId, operationType, payloadDigest, status, resultRef, createdAt, updatedAt`

Protect the spreadsheet so only project administrators and the required script execution identity can access it. Spreadsheet IDs are locators, not authorization. Do not share the underlying workbook with company owners unless a separate reviewed security design proves direct access cannot bypass the application boundary.

## Local tests

Use Node.js 22 and run:

```sh
node --test apps-script/tests/*.test.js
python scripts/validate_stage4.py
```

Tests use synthetic data and test doubles. They do not prove live Apps Script identity, actual Sheets permissions, concurrency across Google executions, AppSheet isolation, or deployed security.

## Important limitations to close before production

- **Not a full transaction:** Sheets writes across multiple rows are not atomic. The idempotency adapter reserves a PROCESSING record under ScriptLock, but Stage 5.2 does not yet implement safe completion updates, interrupted-write reconciliation, or automatic stale-operation recovery. Do not use it as complete production idempotency yet.
- **Digest responsibility:** the caller/service must calculate a stable payload digest on the server; never trust a caller-provided digest in a public API.
- **Authorization integration:** policy modules are tested, but every future read/write service must call them using membership and organization records loaded from trusted repository methods. Platform-admin membership resolution still needs an explicit global-admin lookup path before admin actions are implemented.
- **Sheet writes:** formula-leading strings are escaped, but date/number validation and field-specific schema validation remain required for each operational write.
- **Audit guarantees:** audit helper reports failure, but mutation orchestration must stop or reconcile if required audit persistence fails.
- **Schema version:** required headers are checked; the current adapter does not yet persist or enforce a versioned migration registry.
- **Performance and quotas:** repository lookups currently read configured tables; measure scale and quota behavior before real use.

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
