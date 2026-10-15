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
- `CollectionSites`: `siteId, organizationId, siteName, country, locationDescription, status, createdAt, updatedAt, createdBy, updatedBy`
- `CustomerRegistrations`: `registrationId, organizationId, customerName, customerPhone, locationDescription, latitude, longitude, status, createdAt, updatedAt, createdBy, operationId`

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


## Stage 5.4 — reproducible source packaging and integration gate

Stage 5.4 adds a deterministic repository packaging command. The modular files under `apps-script/src/` are kept as plain global JavaScript source for tests; the packager concatenates them in a declared order into one `Code.gs` because Apps Script projects do not load this repository's Node.js test harness. The generated bundle includes only `Code.gs` and `appsscript.json`.

Run from the repository root:

```sh
python -m unittest scripts.test_package_apps_script
python scripts/package_apps_script.py
node --test apps-script/tests/*.test.js
python scripts/validate_stage4.py
```

Output: `dist/apps-script/Code.gs` and `dist/apps-script/appsscript.json`. The command prepares files only. It does not authenticate to Google, import a project, deploy code, or verify real service behavior. CI must run the packaging gate and the existing Node.js 22 and Stage 4 checks.

The manifest now explicitly declares these scopes:

- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/userinfo.email`

These scopes support the current Sheets adapter and active-user email check. Reassess them if functionality changes; do not add broader scopes without a documented need. The packager fails if the manifest uses a scope outside its reviewed allow-list.

### Live Google test remains blocked until an authorized environment exists

Use only a dedicated Apps Script test project and disposable synthetic spreadsheet. Set Script Property `RECLAIM_SPREADSHEET_ID` in that test project; never commit the spreadsheet ID or credentials. Import the generated package and verify the exact intended execution mode using synthetic administrator and company-owner accounts. The identity adapter denies requests when `Session.getActiveUser().getEmail()` is empty, but mocked tests cannot prove that this email will be available for every account and deployment configuration.

Restrict direct workbook permissions independently. A script's application-level authorization does not protect a workbook from users who already have direct access. Test cross-organization access, direct workbook access, schema errors, audit failure, repeated operations, locking, and uncertain outcomes before considering AppSheet integration.

See `docs/digital/STAGE_5_4_GOOGLE_INTEGRATION_AUDIT.md` for the current audit and manual acceptance checklist. Live Google identity, workbook permissions, locking/concurrency, quotas, and deployment security remain **NOT VERIFIED** until tested against real authorized Google services.


## Stage 5.5 — controlled live integration verification

Stage 5.5 adds adversarial repository regression tests and a synthetic-only live Google test runbook at [Stage 5.5 live Google integration verification](STAGE_5_5_LIVE_GOOGLE_INTEGRATION_VERIFICATION.md). Run all local checks, including `node --test apps-script/tests/*.test.js`. These tests use local fixtures/test doubles; they are not live Google tests.

The live gate remains **BLOCKED / NOT VERIFIED** until an authorized dedicated Apps Script project and disposable synthetic workbook are tested using separately authenticated synthetic administrator and company-owner accounts. Verify identity in the exact intended execution mode, cross-organization denials, direct workbook permissions, lock contention, audit failure and recovery before AppSheet integration. Do not use the production workbook or share the master workbook with company owners. Do not claim a live test passed unless observed and recorded.


## Stage 5.9 — WhatsApp customer-registration workflow boundary

**Status: provider-independent workflow implemented for automated testing; not a live WhatsApp integration.** No WhatsApp provider is selected in this repository increment. There is deliberately no public Apps Script `doPost` endpoint and no change to the restricted owner-authenticated entrypoints.

- `whatsappRegistration.js` provides a provider-independent state machine for collecting a customer name, a provider-supplied sender identifier, a WhatsApp location attachment with finite latitude/longitude, an optional short address description, and explicit confirmation.
- A text address never substitutes for coordinates. Invalid coordinates are rejected. A successful customer message says registration was saved only when the injected persistence adapter returns `ok: true` and `durable: true`; it does not claim that a collection was scheduled.
- The workflow requires injected adapters for raw-request authentication, provider payload parsing, trusted organization routing, event idempotency, session storage, and durable registration creation. Missing adapters fail closed. It does not call the owner-authenticated `reclaimCreateCustomerRegistration` entrypoint and does not accept customer-supplied actor IDs, roles, or organization IDs as authority.
- The company route is resolved from the trusted request/configuration adapter, not from the event body. If that adapter cannot identify a single participating company, processing stops with `COMPANY_ROUTE_UNAVAILABLE`.
- Provider event IDs are claimed with a payload digest. Identical replays are ignored and conflicting reuse of an event ID is rejected. The production adapter must make event claiming atomic and durable, scope the key to the provider's documented event identity, and define retry/reconciliation behavior.
- Session storage is an injected boundary. The workflow sets a 24-hour expiry and scopes sessions by organization and sender; a production store must enforce expiry, durable updates, safe concurrency, and cleanup of abandoned sessions. The current automated tests use in-memory adapters only.
- The workflow returns response messages as structured results. A selected provider adapter must send those responses according to provider API requirements, respect rate limits and delivery failures, and avoid acknowledging successful registration until durable storage has completed.

### Required decisions before live deployment

1. Select the WhatsApp provider (for example, Meta WhatsApp Cloud API or Twilio) and document its exact webhook signature, verification challenge, payload, retry, and outbound-message requirements.
2. Implement and review the provider-specific raw-body signature verifier and parser. The `verifyWebhook` callback must authenticate the original request bytes and relevant headers before payload processing; a boolean supplied by an untrusted caller is not sufficient.
3. Configure an administrator-controlled mapping from the provider's receiving business/phone-number identity to one active participating organization. Never route from customer message text or an untrusted organization ID.
4. Implement durable, atomic event-deduplication and conversation-session adapters, including concurrency and recovery behavior.
5. Implement a trusted, auditable backend adapter for creating a customer registration. It must preserve Stage 5.8 field validation, organization isolation, stable operation IDs, audit, and idempotency without impersonating a company owner or exposing owner-only methods publicly.
6. Verify the deployment identity and permissions, configure secrets outside source control, test with a synthetic provider account, and only then perform a separately authorized deployment.

### Stage 5.9 verification boundary

Tests exercise the provider-independent state machine with synthetic in-memory adapters. They do not verify an actual provider signature, provider webhook challenge, outbound WhatsApp delivery, atomic persistence under concurrent Apps Script executions, live Google Sheets, Apps Script deployment, or production credentials. A passing CI run is not evidence of live integration or production readiness.


## Stage 5.10 — recoverable event-processing adapter contract

**Provider decision:** no WhatsApp provider is selected in this repository state. This increment does not implement provider-specific signature verification, a provider verification challenge, outbound WhatsApp delivery, or a public webhook endpoint.

The provider-independent registration workflow now requires explicit event lifecycle methods (`begin`, `complete`, and `release`) and a per-organization/per-sender session-lock adapter (`withSenderLock`). The event adapter must distinguish a new event, a completed replay, a conflicting event ID, and an event already in progress. Session transitions mark the provider event ID so a retry can detect a transition that persisted before event completion failed. A session-write failure releases a processing claim for retry; an event-completion failure returns a retryable failure rather than claiming success.

**This is an adapter contract, not a production durable-store implementation.** The current tests use in-memory synthetic adapters. They do not provide cross-execution locking, durable leases, atomic event/session transactions, or crash recovery across independent Google Sheets writes. A production adapter must provide atomic event claiming and completion, expiry/lease recovery for abandoned PROCESSING claims, safe per-sender locking, and a stable idempotency key for registration persistence. It must also recover safely if registration persistence succeeds but event completion or outbound message delivery fails. Do not deploy with the test adapters.

The confirmation transition now allocates and persists a registration ID and operation ID before attempting registration storage. Retries reuse those same identifiers instead of generating a new idempotency key. A workflow-level persistence failure is returned as an overall retryable failure, not as an overall successful webhook result. This protects the retry contract only when the eventual registration adapter actually enforces idempotency for the stable operation ID.

The session marker reduces duplicate state transitions after a successful session write, but it cannot make two separate stores transactional. In particular, if registration persistence succeeds and the event-completion write fails, the event remains uncertain until the production adapter's recovery process reconciles it against the stable registration operation ID. Do not retry that submission with newly generated IDs or claim end-to-end exactly-once processing without verified idempotent storage.

### Verification boundary

Automated tests now cover event lifecycle statuses, conflicting IDs, duplicate/in-progress handling, retry after a session-write failure, uncertain completion errors, and the existing registration conversation. The tests use in-memory adapters and synchronous lock simulation. They do not prove concurrency safety or durability in Apps Script/Google Sheets.

Before provider-specific implementation, select a provider and verify its official raw-body authentication, receiving-account identity, event IDs, challenge, acknowledgement/retry, inbound location payload, outbound-message and rate-limit requirements. The selected provider's receiving-account identity must map through administrator-controlled configuration to exactly one active organization. Secrets must be stored in supported deployment configuration and must never be committed to source.
