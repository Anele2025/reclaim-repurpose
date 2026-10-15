# Google Setup and Deployment — Stage 5.1

## Status

This guide prepares a future authorized Google Apps Script project. Committing `apps-script/` does **not** create a Google project, spreadsheet, AppSheet app, API deployment, WhatsApp integration, or deployed service. No Google account or live resource was accessed as part of repository implementation.

## Local validation tests

Requirements: a supported Node.js version with the built-in test runner (`node --test`; Node 18+ recommended). No third-party packages are required.

From the repository root, run:

```sh
node --test apps-script/tests/validation.test.js
```

The tests load the pure `apps-script/src/validation.js` module in a Node VM. This validates deterministic rules only. It does not verify Google authentication, Apps Script permissions, Google Sheets isolation, AppSheet security, webhook signatures, quota behavior, or production idempotency.

## Create an authorized Apps Script project

1. Use the project owner's authorized Google account and create a dedicated test spreadsheet with synthetic records only.
2. Create a standalone Apps Script project (or a container-bound project if a reviewed operational need requires it). Set the project timezone deliberately; the manifest currently uses `Africa/Gaborone` as a default for initial development, not as a substitute for storing consistent UTC timestamps.
3. Copy the pure validation source into the Apps Script project in a compatible script file. The source uses a global namespace and avoids CommonJS imports so it can run in Apps Script V8 and Node tests.
4. Keep Google service adapters separate from pure validation. Before any read/write endpoint is exposed, derive the caller identity from a verified Apps Script execution context and load current membership from a protected, administrator-controlled source. Never trust a caller-supplied email, role, or organization ID as authentication.
5. Establish organization membership, organization status, plan/workflow policy, and record scope checks on every operation. Default-deny when identity, membership, configuration, or scope is missing.
6. Store deployment-specific identifiers and secrets in approved script properties or a suitable secret facility, not source code, sheet cells, URLs, logs, or fixtures. Grant only required scopes and review every authorization prompt.
7. Test with synthetic accounts/organizations for direct reads/writes, cross-organization access, revoked memberships, suspended organizations, replayed operation IDs, error redaction, and audit coverage before connecting real operational data.

## AppSheet setup gates

- Build separate administrator and company-owner experiences only after the data source and server-side policy are reviewed.
- Require authenticated access and verify the actual AppSheet plan and security-filter capabilities in the owner's account.
- Treat views, slices, navigation, and client filters as usability controls, not the sole security boundary.
- Prove negative cross-organization access tests across views, direct source access, exports, references, and actions.
- Ensure developer monitoring uses least privilege and does not silently impersonate company owners.

## WhatsApp and QR entry points

Use organization-specific links/QRs only as routing and attribution. Validate organization status and permitted workflow server-side; links and QR contents do not authenticate participants. Before provider integration, document the provider, webhook signature method, timestamp/replay policy, idempotency persistence, retries, outbound delivery semantics, failure alerts, pricing and data handling. No provider is selected or connected by this repository change.

## Deployment, rollback, and operations

- Use separate test and production projects/spreadsheets where feasible.
- Record the source commit/version and deployment version in an audit/change record.
- Deploy only after review, authorization checks and test evidence; do not make an unreviewed public web-app deployment.
- Test backups and restoration using synthetic data; define retention and recovery objectives.
- Monitor execution failures, quota limits, stale jobs, authorization denials, data-quality errors, and integration failures only for components that are actually connected.
- Document how to revoke user membership and credentials, disable a deployment, rotate secrets, and investigate incidents.
- Review Apps Script quotas, execution limits, account policies, AppSheet licensing and security capabilities against actual expected usage before production.

## Known implementation gaps

At this stage there is no Google identity adapter, protected Sheets repository, durable idempotency store, audit persistence, organization registration UI, AppSheet app, WhatsApp provider adapter, QR generation service, GPS capture flow, payment confirmation workflow, scheduled job, monitoring deployment, backup job, or production deployment. These must be implemented and verified in later stages. The test registry is deliberately in-memory and is not production duplicate protection.
