# Stage 5.5.1 — Execution Identity and Company-Owner Data Isolation

**Gate decision: BLOCKED / NOT VERIFIED**

## 1. Fresh repository baseline

Audit performed against the Stage 5.5 branch `stage-5-5-live-google-verification`.

- Stage 5.5 head audited: `762822f72e96be4b509627bc283160d6f9bd6fa2` — “Record Stage 5.5 CI evidence and live gate status”.
- Stage 5.5 PR: [#9](https://github.com/Anele2025/reclaim-repurpose/pull/9), found by the GitHub open-PR search; it is intended to remain unmerged.
- Stage 5.4 PR: [#8](https://github.com/Anele2025/reclaim-repurpose/pull/8), found by the GitHub open-PR search; it is intended to remain unmerged.
- Stage 5.5 CI run: [38738167117](https://github.com/Anele2025/reclaim-repurpose/actions/runs/38738167117). The `pure-validation` job completed successfully and its listed steps passed. The checked commit is `762822f72e96be4b509627bc283160d6f9bd6fa2`.
- The Stage 5.5 branch contains adversarial tests and the Stage 5.5 live Google verification runbook. No authorized live Google project or disposable workbook was available to this audit.

This is a repository review, not proof of deployed Google behavior. This document does not assert that any live identity, sharing, or concurrency test passed.

## 2. Existing identity and authorization flow

The reviewed `apps-script/src/identity.js` adapter calls `Session.getActiveUser().getEmail()`. It normalizes a non-empty string email to lowercase and returns `IDENTITY_UNAVAILABLE` if the service is missing, the email is empty/non-string, or the provider throws. It does not fall back to a caller-supplied email or to `getEffectiveUser()`.

The reviewed entry points in `apps-script/src/entrypoints.js` construct the repository from Script Properties and pass `Session` to the service. The service resolves identity itself and then obtains membership from the repository. Authorization checks membership status, role, organization scope, organization status, and service enablement. Request-provided actor/role values are not the trusted identity source.

The Sheets adapter in `apps-script/src/sheetsRepository.js` uses the configured `RECLAIM_SPREADSHEET_ID`, an allow-list of sheet names, and exact header/schema validation. The Idempotency schema currently has 11 columns, including `resultJson` and `correlationId`.

### Identity distinctions that must not be conflated

- **Active user:** the user on whose behalf the script is currently running, as exposed by `Session.getActiveUser()`. The email may be unavailable in some contexts. The code correctly fails closed when it is unavailable.
- **Effective user:** the account whose authority the script is using, as exposed by `Session.getEffectiveUser()`. In a web app configured to execute as its deployer, this can be the deployer rather than the visitor. It is not a safe substitute for caller identity.
- **Client-supplied identity:** any email, actor ID, role, organization ID, or spreadsheet ID submitted by a client. These are claims or locators, not proof of identity or authorization.
- **Trusted membership:** the server-side membership row looked up for the resolved active-user identity. This is the source the authorization layer should use to decide role and scope.

### Deployment-mode decision

The current implementation is suitable only for a restricted test configuration in which the actual caller identity can be established and verified. Do not expose it publicly or switch it to execute as the owner merely to make access work.

For each intended deployment configuration, record whether the script executes as the accessing user or as the deployer, which accounts can invoke it, whether `getActiveUser().getEmail()` returns the expected identity, and whether an unrecognized or unavailable identity is denied. A mock cannot establish these facts.

No claim is made that identity availability is guaranteed for consumer Gmail accounts, external Workspace users, cross-domain users, or every deployment mode. Those account/deployment combinations require actual authorized testing before being supported.

## 3. Company-owner data-isolation options

### Option A — Shared master workbook

**Decision: reject direct owner access to the master workbook.**

- Trust boundary: Google Drive and workbook permissions, plus any app-level authorization.
- Identity: Drive access is granted to Google accounts; the Apps Script service separately resolves caller identity.
- Authorization: service-side checks can protect calls routed through the service, but cannot protect the workbook from an owner who can open it directly.
- Risk: direct readers may inspect or export accessible rows, sheets, hidden tabs, or other data; UI hiding and slices are not a confidentiality boundary. A spreadsheet ID is not an access-control mechanism.
- Operations: simple to maintain initially, but risky for tenant isolation and accidental disclosure.
- Compatibility: the master workbook can remain the private operational record store; sharing it with company owners is not acceptable under the current evidence.
- Live proof required: inspect Drive sharing, inherited folder permissions, editors/viewers, link-sharing, and whether each owner can open or export the workbook.

### Option B — Separate owner-specific data sources

**Candidate for the simplest safe dashboard model, subject to review.**

- Trust boundary: a private master workbook plus a separately permissioned source per company, containing only fields that company may see.
- Identity: Google/AppSheet sign-in for the owner, with an explicit mapping from authenticated identity to one company.
- Authorization: enforce membership and organization scope before creating/updating the owner's projection; do not let a client choose an arbitrary source or organization.
- Risk: stale projections, accidental over-copying, incorrect sharing, and delayed revocation. Source separation reduces blast radius but does not automatically make sync logic safe.
- Operations: more setup and synchronization work, but access can be reasoned about at the Drive-file boundary.
- Compatibility: compatible with Sheets as the operational store and AppSheet as a later dashboard. Keep the master private.
- Live proof required: test actual file permissions, owner A versus owner B, revocation, copied/exported content, sync failure behavior, and stale-access removal.

### Option C — Server-mediated access

**Candidate for the smallest data-minimizing API boundary, but not yet verified for AppSheet integration.**

- Trust boundary: the Apps Script service and its authenticated caller context.
- Identity: an authentication method that reliably identifies the actual signed-in caller; current `getActiveUser()` behavior must be proven for the selected deployment.
- Authorization: every operation checks server-resolved membership and organization scope; only permitted fields and actions are returned. The caller must not choose an arbitrary spreadsheet ID or claim a role.
- Risk: identity unavailable in a deployment mode, overly broad script execution authority, unsafe endpoint exposure, or accidental response leakage. Direct workbook access must still remain restricted.
- Operations: centralized rules, but requires a supported and verified way for AppSheet to call the service with trustworthy authentication, plus operational monitoring and quota management.
- Compatibility: potentially compatible with the existing Apps Script boundary; do not assume AppSheet-to-Apps-Script authentication works securely without an integration design and test.
- Live proof required: caller identity, authentication/token handling if used, authorization bypass attempts, response minimization, direct invocation, revoked memberships, and actual AppSheet connector behavior.

### Recommendation

Keep the master workbook private. Do not grant company owners direct access to it. First prove the current restricted Apps Script execution identity in a dedicated synthetic environment. For the future dashboard, compare a server-mediated interface with separate owner-specific data sources based on the actual AppSheet authentication/connector capabilities available to the project. Option B is the conservative fallback if the current identity boundary cannot be proven for a supported server-mediated path. This is a recommendation, not a claim that either option has passed a live test.

AppSheet slices, hidden tabs, view filters, and client-side filtering alone are not acceptable isolation controls.

## 4. Automated tests reviewed and limits

The Stage 5.5 test file `apps-script/tests/stage5_5_adversarial.test.js` contains synthetic tests for cross-organization denial and non-disclosure, attempted admin mutation with spoofed role/actor fields, revoked/ambiguous/malformed membership, identity-provider exceptions, lock acquisition failure, malformed stored success results, and formula-like strings versus numeric values.

The test uses injected dependencies and an in-memory repository. It can prove the tested service logic for those fixtures, but cannot prove Google account identity, Drive permissions, Apps Script deployment behavior, real ScriptLock contention between executions, Google quotas, or AppSheet security.

No production code change was justified by the repository evidence reviewed in this stage. Do not add duplicate tests simply to create activity. If further unit tests are added later, include actual missing-email, missing-method, and malformed identity-provider cases only after confirming the existing test suite does not already cover them. Keep test doubles labelled as such.

## 5. Authorized live-test prerequisites

Do not start until the project owner explicitly authorizes use of a dedicated test project and disposable workbook.

Required:
1. A dedicated Apps Script project, separate from any production or personal operational workbook.
2. A disposable Google spreadsheet with synthetic data only.
3. Separately authenticated synthetic test accounts labelled Platform Admin, Company A Owner, Company B Owner, and Revoked Owner. Do not put personal account details in the evidence report.
4. The owner has permission to configure the test project's source, deployment, Script Properties, and access controls.
5. A written inventory of created resources, sharing settings, test cases, and cleanup actions.
6. Only the existing manifest scopes required for Sheets access and email identity: `https://www.googleapis.com/auth/spreadsheets` and `https://www.googleapis.com/auth/userinfo.email`. Confirm the manifest and consent screen in the actual project; do not add broader scopes without a separately documented need.
7. Script Property `RECLAIM_SPREADSHEET_ID` set privately in the test Apps Script project to the disposable spreadsheet ID. Never commit it or paste it into chat.

Use the existing Stage 5.5 runbook for the exact sheet headers. In summary, create `Organizations`, `Memberships`, `AuditEvents`, and `Idempotency` with exact schemas copied from `ReclaimSheetsRepository.schemas`. The Idempotency sheet must contain the 11 current columns. Do not silently migrate or test against operational data.

## 6. Live test procedure and evidence

Use the actual Google UI for the account and project in question. Google UI labels may vary by account or interface version; verify the current labels rather than relying on assumed menu names.

1. Create the disposable workbook and Apps Script project while signed in as the authorized project owner. Record the resource labels and IDs privately; store only redacted evidence references in the report.
2. Import the deterministic package generated by `python scripts/package_apps_script.py`. Inspect the generated `dist/apps-script/appsscript.json` and approve only the declared scopes needed by the tested functionality.
3. Set `RECLAIM_SPREADSHEET_ID` in the test project's Script Properties. Do not put it in source code.
4. Keep the workbook restricted to the project owner and only the execution identity required by the selected test mode. Do not share the master workbook with either company owner.
5. Test the exact intended deployment mode. Sign in separately as each synthetic test identity and record the identity returned by the actual execution, without logging tokens or secrets.
6. Verify that Company A can read only its own synthetic summary; Company A cannot read Company B's summary or invoke admin-only mutation; Company B can read only its own summary; the administrator can perform only the documented admin action; and the revoked owner is denied after revocation.
7. Test missing/unavailable identity and confirm denial. Test actual workbook access separately by checking each account's ability to open the master workbook. An application-level denial does not prove that Drive access is denied.
8. Test audit persistence, missing/incorrect headers, duplicate and conflicting operation IDs, uncertain outcomes, repeated requests, and concurrent executions only in the disposable project. Record that ScriptLock serializes cooperating executions within its scope; it is not a general Sheets transaction and does not protect against direct edits or other projects.
9. Review Drive sharing and any inherited folder/link access after tests. Confirm company owners were never granted master-workbook access.
10. Export or capture only sanitized evidence: timestamp with timezone, source SHA, deployment mode, synthetic account label, case ID, expected result, observed result, pass/fail, and a redacted evidence reference. Do not record emails, access tokens, secret URLs, real participant records, or full sensitive rows.
11. Revoke test deployments/access and remove test-only resources only after evidence is preserved and cleanup is authorized. Verify the deployment is inaccessible, sharing grants are removed, and the disposable workbook/project is deleted or retained in a documented restricted test area according to the owner's decision.

### Evidence log template

| Field | Value |
|---|---|
| Source commit SHA | |
| Test case ID | |
| Timestamp and timezone | |
| Deployment execution mode | |
| Synthetic account label | |
| Expected result | |
| Observed result | |
| Pass / fail / blocked | |
| Sanitized evidence reference | |
| Cleanup verified by / time | |

Never mark a case passed if it was skipped, mocked, inferred, or not observed in the actual Google environment.

## 7. Idempotency, audit and schema caveats

The current implementation uses a ScriptLock to coordinate the protected operation path and records idempotency states. A lock is not a transaction spanning all Sheets writes. Partial writes, process termination, direct edits, separate scripts/projects, and post-write audit failures remain important failure modes. Uncertain outcomes must remain in reconciliation and must not be blindly replayed. Exactly-once processing is not claimed.

Preserve the exact source schemas and the 11-column Idempotency contract. Test schema errors on the disposable workbook only. Do not implement a live migration as part of this stage.

## 8. Known risks and unresolved decisions

- Active-user email availability under the actual deployment/account combination is not verified.
- The correct AppSheet-to-service authentication pattern has not been selected or tested.
- Direct Drive permissions and inherited sharing are not verified in a live test.
- Separate owner-specific projection synchronization, revocation timing, and stale-data handling have not been implemented or verified.
- Real concurrent execution, quotas, and recovery from actual Google service failures remain unverified.
- No production deployment, real participant data, WhatsApp connection, or AppSheet dashboard is authorized by this stage.

## 9. Gate decision and unblock action

**Decision: BLOCKED / NOT VERIFIED.**

Repository CI passed for the audited Stage 5.5 SHA, but the live security gate is not satisfied.

**Exact next action:** the authorized project owner must provide/authorize a dedicated synthetic Apps Script test project, disposable workbook, and separately authenticated test identities. Run and record the identity, organization-isolation, direct-Drive-permission, audit, idempotency, and concurrency cases under the intended deployment mode. If identity is not reliably available, stop and choose a reviewed authentication/data-source design before building AppSheet dashboards.

Do not mark Stage 5.5.1 live verification complete or begin Stage 5.6 AppSheet implementation until the applicable security tests have actual recorded evidence.
