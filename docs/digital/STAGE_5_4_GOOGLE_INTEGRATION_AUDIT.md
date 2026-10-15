# Stage 5.4 Google Integration and Packaging Audit

**Audit date:** 2026-10-15  
**Repository:** `Anele2025/reclaim-repurpose`  
**Default branch:** `main`  
**Default-branch SHA inspected:** `17650cc907944a40a28639c6d290de586c7e11c3`  
**Stage 5.3 base SHA inspected:** `0096aafb73e8bdcda761b889fbe835a75e3cbf5d`  
**Stage 5.4 branch:** `stage-5-4-google-integration-packaging`

## 1. Fresh baseline and PR audit

All pull requests #1–#7 were queried from GitHub immediately before Stage 5.4 edits. They were open and unmerged at audit time:

| PR | Base branch (SHA) | Head branch (SHA) | State |
|---|---|---|---|
| [#1](https://github.com/Anele2025/reclaim-repurpose/pull/1) | `main` (`17650cc907944a40a28639c6d290de586c7e11c3`) | `stage-1-operational-records` (`2e65bcdda262d0c39b0a281c7431ffc7c15da725`) | Open, unmerged |
| [#2](https://github.com/Anele2025/reclaim-repurpose/pull/2) | `stage-1-operational-records` (`2e65bcdda262d0c39b0a281c7431ffc7c15da725`) | `stage-2-pilot-economics` (`557996c325df69fdd338948530eb1b01530978e5`) | Open, unmerged |
| [#3](https://github.com/Anele2025/reclaim-repurpose/pull/3) | `stage-2-pilot-economics` (`557996c325df69fdd338948530eb1b01530978e5`) | `stage-3-pilot-operating-procedures` (`e7cd6a6e51602eccdaa2ed0647486279df5abb9d`) | Open, unmerged |
| [#4](https://github.com/Anele2025/reclaim-repurpose/pull/4) | `stage-3-pilot-operating-procedures` (`e7cd6a6e51602eccdaa2ed0647486279df5abb9d`) | `stage-4-validation-evidence` (`058554e06fe9d6fb3b3bd2ba3e8bb994d0c10d33`) | Open, unmerged |
| [#5](https://github.com/Anele2025/reclaim-repurpose/pull/5) | `stage-4-validation-evidence` (`058554e06fe9d6fb3b3bd2ba3e8bb994d0c10d33`) | `stage-5-working-mvp` (`2f902f929da11064feb02f7393d4d436fcbf6ca8`) | Open, unmerged |
| [#6](https://github.com/Anele2025/reclaim-repurpose/pull/6) | `stage-5-working-mvp` (`2f902f929da11064feb02f7393d4d436fcbf6ca8`) | `stage-5-2-authenticated-sheets-backend` (`efae99bdee1b65be554ebdc83f3158c7e7a1a1e3`) | Open, unmerged |
| [#7](https://github.com/Anele2025/reclaim-repurpose/pull/7) | `stage-5-2-authenticated-sheets-backend` (`efae99bdee1b65be554ebdc83f3158c7e7a1a1e3`) | `stage-5-3-secure-recoverable-service` (`0096aafb73e8bdcda761b889fbe835a75e3cbf5d`) | Open, unmerged |

The inspected `main` and Stage 5.3 branch refs matched the recorded SHAs above. The Stage 5.3 pull-request run [38735236829](https://github.com/Anele2025/reclaim-repurpose/actions/runs/38735236829) and push run [38735232465](https://github.com/Anele2025/reclaim-repurpose/actions/runs/38735232465) both completed successfully for `0096aafb73e8bdcda761b889fbe835a75e3cbf5d`. Those runs tested Stage 5.3, not Stage 5.4.

## 2. Runtime and packaging findings

### Confirmed from repository source

- The manifest was `apps-script/appsscript.json`, configured for V8 and `Africa/Gaborone`, but it did not explicitly declare OAuth scopes.
- Runtime modules are plain JavaScript global scripts using IIFEs and global names such as `ReclaimIdentity`, `ReclaimAuthorization`, `ReclaimSheetsRepository`, `ReclaimAudit`, `ReclaimIdempotency`, and `ReclaimService`.
- The module order is relevant because `entrypoints.js` refers to the other globals. There was no existing package assembler in the inspected tree.
- Node.js tests use `node:test`, `node:fs`, `node:path`, and `node:vm`; these are test-harness dependencies, not runtime source modules.
- `entrypoints.js` exposes two named functions and does not define `doGet` or `doPost`.
- The identity adapter reads `Session.getActiveUser().getEmail()` and fails closed when email is absent or an error occurs.
- The Apps Script source and mocked tests do not establish the behavior of identity, permissions, quotas, or locking in a real Google deployment.

### Stage 5.4 implementation

- Added `scripts/package_apps_script.py`, which assembles the explicit module order into one generated `Code.gs` and copies the validated manifest into `dist/apps-script/`.
- The package includes only `Code.gs` and `appsscript.json`; Node tests and repository scripts are not copied.
- The packaging gate validates JSON, V8 runtime, timezone, explicit approved OAuth scopes, required entry points, prohibited public `doGet`/`doPost` entry points, Node/CommonJS/ES-module source patterns, and basic high-confidence secret patterns.
- Added `scripts/test_package_apps_script.py` for deterministic-output, manifest-scope, missing-source, and package-content tests.
- Added explicit `spreadsheets` and `userinfo.email` scopes to `apps-script/appsscript.json`. This is a source-level least-privilege baseline, not proof that the deployed application will work with every account/deployment mode.
- Updated the Stage 5 validation workflow to run package tests, build the package, assert the expected package files/entry points, run the Node.js 22 tests, and run the Stage 4 validator.

## 3. Commands

From the repository root with Python 3 and Node.js 22 available:

```sh
python -m unittest scripts.test_package_apps_script
python scripts/package_apps_script.py
node --test apps-script/tests/*.test.js
python scripts/validate_stage4.py
```

Generated files are placed in `dist/apps-script/Code.gs` and `dist/apps-script/appsscript.json`. The package is an import-ready source bundle for a dedicated Apps Script test project; no deploy command is run.

## 4. Identity and execution-model gate

The code fails closed when `Session.getActiveUser().getEmail()` returns no usable email. This protects against proceeding with an unknown identity, but it does not prove that a company owner can be identified in every execution context.

Before live use, test the intended execution model using synthetic accounts. Record whether the script runs as the accessing user or the deployer, the account types/domain configuration, the returned identity result, and observed denials. If owner identity is unavailable or ambiguous, keep the affected entry point disabled; do not accept a caller-supplied email or role as a workaround.

## 5. Spreadsheet security boundary

The repository adapter allow-lists four sheets and validates exact headers, including the 11-column Idempotency schema with `resultJson` and `correlationId`. It is not a transaction manager for multiple sheets. ScriptLock serializes cooperating executions using that lock; it does not stop a person with direct spreadsheet permissions or an unrelated script/project from editing the workbook.

Minimum test-project access model:

- Use a dedicated synthetic spreadsheet and Script Property `RECLAIM_SPREADSHEET_ID`.
- Restrict workbook access to the minimum administrators and execution identity required by the chosen model.
- Do not share the underlying workbook with company owners merely to let them use the application.
- Test direct workbook access separately from API authorization.
- Do not migrate or change any real workbook as part of this stage.

## 6. Verification status

**Repository-level implementation:** packaging gate and tests added. GitHub Actions run [38737015687](https://github.com/Anele2025/reclaim-repurpose/actions/runs/38737015687) completed successfully for head SHA `a23c624de545c80fba297c9863bcb14738ccbd21`. The job passed the Node.js 22 suite, package unit tests, deterministic package build, generated-code checks, and Stage 4 validator.

**Live Google integration:** **BLOCKED / NOT VERIFIED.** No authorized live Apps Script project or disposable Google spreadsheet was available during this repository audit. No actual Google identity, spreadsheet permission, live lock/concurrency, quota, or deployment test is claimed.

Mocks and repository CI cannot prove Google runtime behavior. The Stage 5.4 work does not establish production readiness.

## 7. Manual live-test checklist

- [ ] Create a dedicated Apps Script test project and a disposable synthetic workbook.
- [ ] Import only the generated `Code.gs` and `appsscript.json`.
- [ ] Configure Script Property `RECLAIM_SPREADSHEET_ID` to the synthetic workbook ID; do not commit it.
- [ ] Create exact synthetic `Organizations`, `Memberships`, `AuditEvents`, and `Idempotency` schemas.
- [ ] Authorize only the scopes shown in the manifest.
- [ ] Test platform administrator, company owner A, company owner B, revoked owner, unknown identity, and identity-unavailable cases.
- [ ] Verify cross-organization access is denied and direct workbook permissions do not expose another organization's data.
- [ ] Exercise missing/extra headers, duplicate stable IDs, formula-like text, audit failure, identical retries, conflicting operation IDs, lock contention, and unresolved operations.
- [ ] Record source SHA, test date, deployment model, synthetic labels, expected result, observed result, and cleanup.
- [ ] Keep production deployment disabled until the live identity and workbook-access gates pass independent review.

## 8. Rollback and next gate

For the test project, disable the test deployment or remove invocation permissions and preserve the audit evidence. Restore source through version control; do not delete operational data as a code rollback method. Revoke exposed credentials if exposure is suspected.

The next acceptance gate is a genuine authorized Google integration test. AppSheet dashboards must not be treated as secure until both the server-side identity boundary and the underlying data-source permissions are verified.
