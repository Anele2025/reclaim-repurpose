# Stage 5.5.2 — Live Google Security Verification

**Gate decision: BLOCKED / NOT VERIFIED**  
**Scope:** synthetic Google integration verification readiness only; not production deployment or AppSheet dashboard implementation.

## 1. Fresh repository baseline

Repository: `Anele2025/reclaim-repurpose`.

- Stage 5.5.1 commit audited: `f667fc0ac3444fea656dc22cedfc83be7b15608f` — [commit](https://github.com/Anele2025/reclaim-repurpose/commit/f667fc0ac3444fea656dc22cedfc83be7b15608f).
- Stage 5.5.1 branch: `stage-5-5-1-identity-isolation-review`.
- Stage 5.5.1 CI run: [38738822400](https://github.com/Anele2025/reclaim-repurpose/actions/runs/38738822400), completed successfully for the audited commit. The `pure-validation` job passed Node.js tests, Python package tests, deterministic package generation, generated-package validation, and the Stage 4 validator.
- PR #8: [Stage 5.4](https://github.com/Anele2025/reclaim-repurpose/pull/8), listed by the fresh GitHub open-PR search.
- PR #9: [Stage 5.5](https://github.com/Anele2025/reclaim-repurpose/pull/9), listed by the fresh GitHub open-PR search.
- PR #10: [Stage 5.5.1](https://github.com/Anele2025/reclaim-repurpose/pull/10), listed by the fresh GitHub open-PR search.
- No existing PR was merged, closed, retargeted, or otherwise modified in this stage.

The CI result is repository-level evidence only. The repository's Stage 5.5 and 5.5.1 documents already mark live Google verification as blocked.

## 2. Google environment and authorization availability

No authorized Google Drive, Google Sheets, or Apps Script project-management connector was available in the connected tool inventory for this execution. The available GitHub connection does not grant Google account access.

Consequently, this stage did **not** create, configure, share, deploy, inspect, or delete any Google resource. It did not execute live Google tests. There is no Google project ID, deployment ID, spreadsheet ID, live execution log, or real-account result to report.

This is the correct fail-closed outcome; no live test has been simulated or described as passed.

## 3. Implementation inspected

The reviewed `apps-script/src/identity.js` resolves the actor using `Session.getActiveUser().getEmail()`, normalizes a non-empty email, and fails closed with `IDENTITY_UNAVAILABLE` if the session method is missing, the email is missing or not a string, or the provider throws. It does not substitute a caller-provided identity or `Session.getEffectiveUser()`.

The reviewed entry points construct the Sheets repository from Script Properties and pass the Apps Script `Session` service to the service layer. The repository uses an allow-list of sheet names and exact header schemas. The Idempotency schema contains 11 columns, including `resultJson` and `correlationId`.

The manifest at `appsscript.json` was not found at the queried repository path. This does not prove that no manifest exists; inspect the actual package output at `dist/apps-script/appsscript.json` and the source/package builder before configuring any live test. Do not assume or add scopes based on this report alone.

## 4. Test inventory and honest status

| Test category | Current evidence | Stage 5.5.2 result |
|---|---|---|
| Node.js service and security tests | Synthetic fixtures/test doubles; CI passed on audited SHA | Repository tests passed; not live Google |
| Identity behavior per deployed account | No authorized Google environment | Blocked |
| Active versus effective identity | Code inspection only | Live behavior blocked |
| Company A/B cross-organization isolation | Existing adversarial synthetic tests | Unit-test coverage only |
| Direct Drive sharing and inherited permissions | No Drive access | Blocked |
| Revoked-owner access after revocation | Synthetic membership tests only | Live behavior blocked |
| Real ScriptLock concurrency | No live Apps Script execution | Blocked |
| Sheets audit/idempotency/recovery under actual failures | Unit tests only | Blocked |
| AppSheet-to-service authentication | No AppSheet/Google account environment | Not selected or verified |
| Cleanup and resource revocation | No resources created | Not applicable; no cleanup performed |

Do not mark any blocked or mocked case as a live pass.

## 5. Manual live-test procedure for the authorized project owner

Perform these steps only in a dedicated test environment and only after the project owner explicitly authorizes the creation/configuration of those test resources.

### A. Prepare test identities and resources

1. Use a dedicated Apps Script project and disposable Google spreadsheet, separate from production and any personal operational workbook.
2. Create or obtain separately authenticated synthetic identities labelled Platform Administrator, Company A Owner, Company B Owner, and Revoked Owner. Keep actual email addresses out of GitHub evidence.
3. Create the synthetic organizations and membership rows. Use exact current headers from `ReclaimSheetsRepository.schemas` in `apps-script/src/sheetsRepository.js`; do not hand-retype or invent column schemas.
4. Confirm the Idempotency sheet has all 11 headers: `operationId`, `actorId`, `organizationId`, `operationType`, `payloadDigest`, `status`, `resultRef`, `createdAt`, `updatedAt`, `resultJson`, `correlationId`.
5. Inspect the generated package manifest at `dist/apps-script/appsscript.json` and the package builder. Grant only the scopes demonstrably needed by the code under test; document the purpose of each. Do not add broad scopes merely to bypass an authorization issue.
6. Set Script Property `RECLAIM_SPREADSHEET_ID` privately in the test project's Apps Script settings to the disposable spreadsheet ID. Do not put it in source, a commit, or this report.
7. Keep the master workbook private. Do not share it with either company owner.

### B. Deploy only the test version

1. Use the restricted test execution mode approved by the project owner. Record whether it executes as the accessing user or as the deployer.
2. Restrict invocation to the intended test accounts and domain/account population. Do not choose public access.
3. If the current code's entry points are only internal Apps Script functions and do not expose a supported caller-facing web endpoint, do not invent a web API or assume AppSheet can call these functions directly. Record the supported test invocation mechanism and stop if none exists.
4. Sign in as each synthetic identity and observe `Session.getActiveUser().getEmail()` and `Session.getEffectiveUser().getEmail()` within the test project. Record only synthetic identity labels and redacted outcomes, not secrets.
5. If identity is missing, ambiguous, or differs from the authenticated caller, stop the test for that mode and mark it unsuitable for owner operations until the authentication design is reviewed.

### C. Run expected security outcomes

| Case | Expected outcome |
|---|---|
| Platform Administrator with valid membership | Only documented admin operation permitted |
| Company A Owner requests Company A summary | Allowed for authorized Company A data |
| Company A Owner requests Company B summary | Denied; Company B data not disclosed |
| Company B Owner requests Company A summary | Denied; Company A data not disclosed |
| Owner calls admin-only operation | Denied, even if request includes a spoofed role/actor |
| Revoked Owner after membership revocation | Denied |
| Missing/unavailable identity | Denied |
| Caller submits forged organization or spreadsheet ID | Must not expand authority or redirect protected storage |
| Company owner opens master workbook directly | Access denied by actual Drive permissions |
| Required audit write fails | Protected operation must not be reported as successful if the contract requires audit persistence |
| Duplicate operation ID and same payload | Existing safe idempotent result or documented in-progress/reconciliation response |
| Duplicate operation ID and conflicting payload | Denied |
| Missing schema or malformed stored result | Fail closed; uncertain outcomes require reconciliation |

Execute lock/concurrency and uncertain-write tests only where the test environment can actually induce and observe them. Do not infer them from unit tests.

### D. Inspect Google Drive permissions

In the actual Drive UI, inspect the disposable master workbook and its parent folders. Review direct and inherited viewers/editors, link-sharing, group grants, and any domain-wide grants. Confirm each owner identity cannot open or export the master workbook. UI labels may vary; verify current controls rather than relying on guessed menu names.

An application-level denial is not proof of direct Drive isolation.

### E. Record sanitized evidence

For each case, record:
- source commit SHA;
- case ID;
- timestamp and timezone;
- deployment execution mode;
- synthetic identity label;
- expected outcome;
- observed outcome;
- pass/fail/blocked;
- redacted evidence reference.

Do not include emails, OAuth tokens, passwords, secret deployment URLs, spreadsheet IDs, real participant information, or sensitive row contents in public repository evidence.

### F. Cleanup

After evidence is preserved, obtain explicit authorization before deleting test resources or revoking test access. Remove test-only deployment access and sharing grants; verify those changes in the actual UI. Delete or retain the disposable project/workbook only according to the owner's explicit decision and record the outcome. No resources were created during this stage, so no cleanup was performed here.

## 6. AppSheet compatibility decision

No AppSheet dashboard or connector integration was built or tested.

- **Private master workbook:** remains mandatory; company owners must not be given direct access.
- **Separate owner-specific data sources:** a conservative option if the master remains private and projections are generated with tested organization scoping, minimal fields, revocation, and synchronization controls.
- **Server-mediated access:** potentially centralizes authorization, but must not be selected until the actual AppSheet-to-service authentication mechanism and active-user identity behavior are proven for the chosen deployment.
- **Hidden tabs, slices, view filters, and UI visibility:** not authorization boundaries.

The final model remains an unresolved design choice pending actual account/product capabilities and live evidence.

## 7. Remaining blockers and gate

**Decision: BLOCKED / NOT VERIFIED.**

Exact blockers:
1. No authorized Google test project/workbook and separately authenticated synthetic identities were available through the current tool environment.
2. Active/effective identity behavior under the intended Apps Script deployment mode has not been observed live.
3. Drive sharing and direct workbook access have not been verified.
4. Real execution behavior for audit persistence, idempotency, uncertain writes, and concurrency remains unverified.
5. AppSheet-to-service authentication and tenant isolation remain untested.

**Next action required:** the authorized project owner must set up or authorize the dedicated synthetic test project, disposable workbook, and four labelled test identities, then execute and record the tests above. If the current entry points do not provide a supported way to invoke the service under each caller identity, that is a design blocker to resolve before deployment—not permission to expose a public endpoint.

Do not start Stage 5.6 AppSheet dashboards until the required live identity and data-isolation checks pass or a reviewed alternative is implemented and verified.
