# Stage 5 — Digital Tracker and Impact Reporting Specification

## 1. Purpose and non-negotiable architecture

Build the digital operations layer for RECLAIM & REPURPOSE without introducing a separate custom web application.

Agreed architecture:

1. **WhatsApp** is the participant-facing communication channel for customers, collection participants and drivers where applicable.
2. **Google Sheets** is the initial operational register and reporting data source.
3. **Google Apps Script** provides controlled validation, automation, scheduled tasks and a narrow server-side interface where needed.
4. **Google AppSheet** provides the administrator dashboard and separate, appropriately restricted company-owner dashboards.
5. **A controlled API** may be introduced behind the Apps Script/AppSheet integration where stronger authorization or integrations require it. Do not expose privileged spreadsheet operations directly to untrusted callers.

The developer primarily monitors system health, queues, exceptions, security events and data quality. The developer should not have to manually operate every routine collection workflow.

**Explicit exclusion:** Do not build a separate Python, React, Node, PHP or other custom browser-based application as a replacement for AppSheet. Coding Apps Script, schema validation, tests and integrations is in scope; creating a new standalone web app is not.

Development proceeds while customer, partner, site permission and economic validation continue in parallel. Validation is not a prerequisite for starting software work, but software does not prove demand or authorize physical operations.

## 2. Initial countries and currencies

- Botswana records use BWP.
- Eswatini records use SZL.
- Do not combine currencies in totals. Cross-country summaries must show separate currency subtotals unless an explicitly documented exchange-rate method is introduced.
- Each operational record must carry a country value; country is not inferred from a user's free-text notes.

## 3. Users and authorization

### Platform administrator

The administrator can see cross-country operational metrics and, where justified, records across participating companies. Administrator actions must be attributable and logged. Access should be limited to named, authorized accounts; do not publish an unrestricted AppSheet app.

### Individual company owner

A company owner can see and manage only records belonging to their authorized organization, within their granted role. They must not be able to change their organization identifier to read another company's records.

### Staff / field operator (future role)

May create or update only the records and workflow transitions assigned to them. This role is not required for the first dashboard if the pilot is founder-operated, but the data model should not assume every operator is a platform administrator.

### Developer / technical operator

May monitor service health, failed automations, queues, sync errors, access-denial events and audit logs. Developer access to business data should be minimized and governed. Being the developer does not imply permission to silently impersonate a company owner.

### Enforcement requirements

- Identify users through authenticated Google/AppSheet identity, not a user-supplied email field.
- Maintain a membership register mapping authenticated identity to organization, role, status and scope.
- Do not rely on hidden views, slices, client-side filters or navigation controls as the only data isolation mechanism.
- Configure AppSheet security filters and authenticated access as supported by the chosen plan and data source; verify them with negative cross-organization tests.
- For every privileged Apps Script or API operation, verify caller identity, membership, role, record organization and permitted transition server-side.
- Deny access by default when identity, membership or organization scope is missing or ambiguous.
- Avoid collecting unnecessary identity documents, precise location, or sensitive personal details in operational sheets.

## 4. Minimum data model / data dictionary

Use stable, immutable IDs. Never use row number as a record identifier. Every operational row should have RecordID, Country, CreatedAt, CreatedBy, UpdatedAt, UpdatedBy, and a record status where relevant. Timestamp values should be stored consistently, preferably ISO 8601 in UTC, with local display handled separately.

### Organizations

- OrganizationID (primary ID)
- OrganizationName
- Country (Botswana or Eswatini)
- Status (PROSPECT, ACTIVE, PAUSED, ARCHIVED)
- CreatedAt, CreatedBy, UpdatedAt, UpdatedBy

### Memberships

- MembershipID
- OrganizationID
- AuthenticatedEmail
- Role (PLATFORM_ADMIN, COMPANY_OWNER, OPERATOR, READ_ONLY)
- Status (INVITED, ACTIVE, SUSPENDED, REVOKED)
- GrantedBy, GrantedAt, ExpiresAt, RevokedBy, RevokedAt
- Membership changes must be audit logged. Email must be derived from authenticated identity during authorization, not trusted from submitted form data.

### Sites / collection locations

- SiteID, OrganizationID, Country
- SiteName, LocationDescription
- ContactReference (minimal, consented, non-sensitive)
- SiteStatus
- PermissionStatus and PermissionEvidenceID (permission status is not assumed approved)
- Standard audit timestamps and actors

### Materials and collections

- CollectionID, OrganizationID, SiteID, Country
- CollectionDate, MaterialType
- Quantity, Unit
- MeasurementStatus (ESTIMATE, MEASURED, VERIFIED)
- WorkflowStatus (RECORDED, SORTED, HANDED_OVER, RECOVERY_VERIFIED, CANCELLED)
- EvidenceReference, Notes
- RECOVERY_VERIFIED requires evidence that is appropriate to the claim; it must not be set merely because material was collected or offered to a partner.

### Recovery partners

- PartnerID, OrganizationID (or an explicitly scoped shared partner record), Country
- PartnerName, AcceptedMaterialTypes
- AcceptanceConditions, MinimumQuantity, Unit
- CommercialStatus, VerificationStatus
- LastVerifiedAt, EvidenceReference
- Do not imply an agreement or accepted material until supported by records/evidence.

### Handovers

- HandoverID, OrganizationID, CollectionID, PartnerID, Country
- HandoverDate, OfferedQuantity, AcceptedQuantity, RejectedQuantity, Unit
- Status (PLANNED, DELIVERED, ACCEPTED, PARTIALLY_REJECTED, REJECTED, UNRESOLVED)
- ReceiptReference, EvidenceReference, Notes
- Accepted plus rejected quantity must not exceed offered quantity. Units must match the collection unit. Final acceptance states require a receipt or appropriate evidence reference.
- A handover receipt establishes only the fact described by that evidence; it does not automatically establish recycling.

### Finance

- FinanceID, OrganizationID, Country
- Kind (COST, REVENUE)
- Description, Amount, Currency
- Status (PLANNED, QUOTED, INCURRED, INVOICED, PAID, RECEIVED, CANCELLED)
- TransactionReference, EvidenceReference, OccurredOn
- Enforce Botswana -> BWP and Eswatini -> SZL. Keep planned, quoted, invoiced and paid/received amounts distinguishable.

### Compliance / permissions register

- RequirementID, OrganizationID when organization-specific, Country, SiteID where applicable
- Activity, RequirementOrQuestion, Status
- EvidenceReference, NextAction, ReviewDate, VerifiedBy, VerifiedAt
- APPROVED requires a source/evidence reference and defined scope. NOT_APPLICABLE requires a documented rationale and source/basis. Software must not decide legal applicability on its own.

### Evidence register

- EvidenceID, OrganizationID, Country, RelatedRecordID
- EvidenceType, ClaimSupported, SourceReference, DateObtained
- VerificationMethod, EvidenceQuality, Limitations
- ConfidentialityClassification, ReviewStatus, NextAction
- Access to evidence must follow the same organization scope as the related record.

### Audit events and automation queue

- Audit: AuditEventID, OccurredAt, ActorIdentity, ActorRole, OrganizationID, Action, EntityType, EntityID, Outcome, ReasonOrSummary, CorrelationID.
- Queue: QueueItemID, TaskType, OrganizationID, RelatedRecordID, IdempotencyKey, Status, AttemptCount, NextAttemptAt, LastErrorCode, CreatedAt, CompletedAt.
- Never store credentials, access tokens, OTP values or unnecessary personal data in audit details or queue errors.

## 5. AppSheet dashboard specification

### Administrator dashboard

- Cross-country summary with separate Botswana and Eswatini panels.
- Counts for sites, collections, handovers, unresolved exceptions, outstanding compliance actions and failed automations.
- Material summaries grouped by type, country, unit and measurement confidence.
- Recovery-partner status and evidence review queue.
- Finance summary by country and currency; no silent currency conversion.
- Audit and exception views with access restrictions.
- Clear indication of empty, estimated, measured and verified data.

### Company-owner dashboard

- Only the owner's organization records.
- Own sites, collections, material balances and handovers.
- Own partner records, unresolved exceptions and next actions.
- Own finance entries in the country's currency.
- Own compliance actions, evidence and upcoming review dates.
- Export access only to authorized organization-scoped records.
- No administrator-only membership controls, other companies' records, global audit logs or other organizations' finance data.

### Developer monitoring view

- Automation failures, retry queues, sync/permission errors and stale jobs.
- Failed authorization attempts, unusual membership changes and data-quality exceptions.
- Deployment/configuration version, last successful job run and backup status where available.
- Prefer operational metadata over exposing full business records.

## 6. Automation requirements

Build automation incrementally and make each operation safe to retry.

- Generate stable IDs server-side; do not use sheet row numbers as identifiers.
- Validate allowed values, country/currency pairing, quantities, units, required evidence and legal workflow transitions before writing.
- Use idempotency keys for operations that may be retried by a webhook or scheduled job.
- Record failed jobs and retry them with bounded backoff; avoid duplicate records and duplicate outbound messages.
- Keep external webhooks behind verification and replay protection. Do not trust a request because it claims to come from WhatsApp or another provider.
- Keep user-facing messages factual and distinguish recorded, delivered, accepted, and recovery verified.
- Do not send a completion notification that asserts downstream recovery unless the evidence/read model confirms the exact claim.
- Keep WhatsApp provider choice and any paid automation out of assumptions until credentials, pricing, permissions and a justified integration path are established.
- Apps Script quotas and AppSheet plan/access requirements must be checked against the actual Google account and expected usage before relying on them for production.

## 7. Data quality and impact reporting

- Blank records remain blank; do not manufacture activity.
- Store quantity and unit explicitly; do not add incompatible units.
- Show estimate and measured/verified quantities separately.
- Show offered, accepted and rejected handover quantities separately.
- Do not report collected or accepted material as recycled without downstream evidence supporting that claim.
- Do not calculate carbon savings or other environmental benefits without a documented methodology, supported factors and traceable inputs.
- Every dashboard metric should have a written definition and an identifiable source query/rule.
- Corrections must be attributable; prefer status changes and audit events over silent overwrites.

## 8. Test plan and acceptance criteria

### Functional tests

1. Create a site in Botswana and a site in Eswatini.
2. Create collection records and confirm stable IDs and country values.
3. Reject negative, infinite, malformed and unit-inconsistent quantities.
4. Reject a finance record that pairs Botswana with SZL or Eswatini with BWP.
5. Reject a final handover acceptance status without a receipt/evidence reference.
6. Verify accepted plus rejected quantities do not exceed offered quantities.
7. Verify a collection does not become RECOVERY_VERIFIED solely because a handover was recorded.
8. Confirm blank datasets render zero/empty states rather than fabricated metrics.
9. Export data and confirm organization scope, country, currency and measurement status remain intact.
10. Retry the same queued task and confirm no duplicate record or outbound message is created.

### Authorization tests

1. Unauthenticated users cannot access private dashboards or data.
2. Company A cannot read, update, export or infer Company B's records by changing an ID or URL.
3. A company owner cannot grant themselves administrator status or change their organization membership.
4. Suspended/revoked memberships fail closed.
5. Direct Apps Script/API requests are authorized server-side, not merely hidden by the AppSheet UI.
6. A platform administrator's cross-organization access is logged and restricted to the granted role.
7. Audit/evidence access cannot bypass the related record's organization boundary.

### Reliability / security tests

- Duplicate webhook and scheduled-job delivery.
- Timeout and retry after partial processing.
- Concurrent edits and conflict handling.
- Backup restoration and export/import integrity.
- Quota exhaustion, expired credentials and failed external service calls.
- Permission changes, owner removal and membership revocation.
- Log redaction: no passwords, access tokens, OTPs or unnecessary personal information.

### Release gates

Do not call the digital layer production-ready until:
- the owner has configured authenticated Google identities and the actual AppSheet security model;
- cross-organization negative tests pass;
- audit, backup/restore and failure handling are tested;
- all automated checks pass on the intended source;
- Google account/AppSheet plan constraints and any paid provider dependencies are known;
- the app has a documented incident and access-revocation procedure.

Passing software tests does not replace legal/site permission, safety, customer validation, receiving-partner verification or other gates for physical operations.

## 9. Implementation sequence

1. Review Stage 1–4 registers and preserve their field meanings.
2. Design the Google Sheets tables and stable ID rules; do not use row numbers as IDs.
3. Build and test the server-side Apps Script validation functions with synthetic data.
4. Configure Google identity and organization membership enforcement before exposing organization-specific data.
5. Build the AppSheet administrator and company-owner views against the secured data model.
6. Add developer monitoring for errors, queues, audit events and data quality.
7. Add WhatsApp integration only after provider choice, authorization, replay protection and failure behavior are specified.
8. Run functional, isolation, retry, backup and release-gate tests.
9. Continue market validation in parallel; use real workflows to improve the software without treating software completion as evidence of commercial success.

## 10. Current status and boundaries

This document is a specification, not proof that Google Sheets, Apps Script, AppSheet, WhatsApp or a production API has been configured or deployed. Google cloud resources must be created in the authorized account and verified there.

No custom standalone web application is authorized by this plan. No real customer, partner, permit, financial or impact evidence is implied. Physical collection, sorting, storage, transport and handover remain gated by applicable requirements and verified arrangements.


## 11. Required product detail: organization registration and service configuration

The platform administrator may register, review, activate, pause, suspend, and archive participating organizations. Each organization must have a stable immutable `OrganizationID`, name, country (`Botswana` or `Eswatini`), status, authorized owner memberships, and versioned service configuration. Do not reuse IDs after archival.

A service plan is an **operational configuration**, not automatically a paid subscription. It may define enabled workflows, material categories, collection/visit limits, evidence requirements, reporting cadence, and support/operational responsibilities. Any price, billing, or subscription semantics require a separately approved business requirement and are out of scope here. Enforce plan rules in server-side business logic for every create/update/automation path, not only by hiding AppSheet controls.

Record an append-only audit event for plan assignment/change, activation, suspension, revocation, owner membership change, and status change. Include actor, timestamp, organization, action, prior/new configuration version or safe summary, reason, and correlation/operation ID. Never put secrets or unnecessary personal data in the audit record. A suspended organization must fail closed for restricted workflows while retaining authorized read-only access only if policy explicitly permits it.

## 12. WhatsApp entry links and QR routing

Support organization-specific WhatsApp entry links and QR codes that resolve to the correct organization/workflow. The encoded organization/workflow reference is a routing and attribution hint only; it is not proof of identity, consent, or authorization. Treat all parameters as untrusted.

On every server-side action, resolve the organization from trusted configuration, verify that it exists and is active, validate the requested workflow against its service configuration, and apply identity/membership and record-scope authorization. Reject unknown, suspended, malformed, or disallowed organization/workflow combinations. Avoid placing personal data or secrets in links or QR payloads. Provide a safe fallback for expired or invalid routes. Do not claim a WhatsApp Business API, provider webhook, outbound messaging, or delivery-status integration exists until it is implemented and verified with provider-side evidence.

## 13. GPS and location privacy

Request a location only when it is necessary for a defined operation—for example, a participant explicitly requests a pickup and a location is needed to dispatch it, or a driver records a specific visit/handover. Explain the purpose before requesting consent. Do not request continuous/background tracking by default.

- **Consent granted:** collect only the minimum precision needed for the task; record coordinates only when genuinely supplied and operationally necessary.
- **Consent denied:** allow a manual address/landmark or mark location unavailable where the workflow can safely continue; do not penalize or silently override the choice.
- **Location unavailable:** record an explicit unavailable/not-provided state and offer a manual alternative.
- **Potentially inaccurate:** preserve the reported accuracy radius when supplied, timestamp when actually supplied, and a user-confirmation step where needed. Do not claim a GPS fix is verified merely because coordinates exist.
- **Access and retention:** restrict precise coordinates to assigned operators and authorized organization members with a need to know; hide or generalize them in broad reports. Define a documented retention period per purpose, delete or aggregate when no longer needed subject to legal/operational holds, and log authorized access/export. Do not collect location in background without a separately reviewed and explicit requirement.

A location field must distinguish not requested, consented/provided, denied, unavailable, and inaccurate/needs-confirmation. Do not fabricate accuracy or timestamp metadata.

## 14. Collection request and material lifecycle states

Preserve Stage 1 operational CSV field meanings and identifiers wherever practical. Map new application entities to the existing customer/site, collection, material event, handover, finance, and impact schemas; document any necessary migration before changing a field.

A collection request/visit should record stable IDs, organization and country, site/request reference, requested/planned/actual visit times as applicable, material type, quantity and unit, measurement method/confidence, contamination/quality result, operator, status, and evidence references. Keep request/visit status distinct from material disposition. Use explicit states such as `REQUESTED`, `PLANNED`, `IN_PROGRESS`, `COLLECTED`, `PARTIALLY_COLLECTED`, `NOT_COLLECTED`, `CANCELLED`, and `UNRESOLVED` where appropriate.

Material disposition must distinguish at least planned, collected, sorted, rejected/contaminated, handed over, partner accepted/rejected, and unresolved quantities. Do not overwrite a prior state without an attributable correction/audit event. Quantity and unit must be explicit and compatible across related events. A partner acceptance or handover receipt proves only what that evidence says; **collection, sorting, and handover are not verified recycling**. Use a recovery/recycling verified state only after suitable downstream processing evidence has been reviewed and linked to the relevant material flow.

## 15. Manual payment confirmation (no payment integration in this stage)

Manual records must distinguish `EXPECTED`, `REPORTED`, `PENDING_CONFIRMATION`, `CONFIRMED`, `REJECTED`, `CORRECTION_PENDING`, `CORRECTED`, and `CANCELLED` as applicable. A participant's WhatsApp message or unsupported claim is not evidence of successful payment.

Define a least-privilege policy before enabling payment records. The person reporting a payment must be identified; confirmation must be performed by a separately authorized role where practicable, with conflicts of interest and self-confirmation explicitly controlled. Record amount, currency, event timestamp, recorded/confirmed actor, confirmation method, transaction/reference number where relevant, evidence reference, and correction linkage. Never store full payment credentials or secrets. Corrections must be append-only adjustments or linked correction events; do not silently rewrite financial history.

Keep Botswana monetary amounts in BWP and Eswatini monetary amounts in SZL. Do not silently convert. This stage does not implement a payment gateway, bank connection, card processing, or mobile-money API unless a separately verified existing project requirement is approved.

## 16. Developer operations and monitoring

Provide a least-privilege monitoring view/record set for:
- failed automation and integration jobs, with safe error codes and correlation IDs;
- retry queues, attempt counts, next retry time, and stale/in-progress tasks;
- authorization denials, repeated failures, and suspicious cross-organization access attempts;
- data-quality failures, invalid transitions, missing evidence, and unresolved records;
- WhatsApp webhook/send/delivery failures only after such integration exists;
- Apps Script quotas, execution timeouts, backup/export and restore failures, and configuration/deployment drift where measurable.

Monitoring should expose operational metadata by default, not full participant or financial records. Developer identity is not an automatic bypass. Any emergency elevated access must be explicitly authorized, time-limited, justified, audited, and reviewed. Alert thresholds, retry bounds, retention, and recovery objectives must be configured and tested before production reliance. Do not report monitoring coverage for a service that is not integrated.

## 17. Privacy, security, and trust boundaries

- Enforce authenticated identity, active membership, role, organization, record ownership/scope, organization status, service-plan rules, and allowed workflow transitions on the server.
- AppSheet security filters and views are defense-in-depth, not the only authorization layer. Test direct data-source and API access paths.
- Keep secrets in appropriate Google-managed script properties/secret facilities or approved secret management; never in source, Sheets, URLs, logs, fixtures, or committed manifests. Rotate and revoke compromised credentials.
- Verify provider webhook signatures using the provider's documented method, validate timestamps where supported, and persist replay/idempotency identifiers with bounded retention. Reject invalid signatures and duplicate/replayed events. Until implemented, treat all webhook integration as unavailable.
- Log security-relevant membership, organization configuration, denied access, exports, sensitive record access where justified, corrections, and privileged actions. Redact tokens, OTPs, credentials, precise location and unnecessary personal data from logs.
- Minimize collection and access to personal data; define purpose, retention, deletion, export and incident-response procedures. Confirm country-specific privacy and legal requirements independently for Botswana and Eswatini.
- Use synthetic fixtures only in automated tests. Never include real credentials, access tokens, participant secrets, real participant data, or genuine location data in source control.
- Use a server-side membership lookup based on the authenticated execution identity. An organization ID supplied by a caller is only a requested target and never establishes authorization.

## 18. First local validation module: contract and boundary

The first implementation layer may contain pure JavaScript validation functions usable both in Apps Script's V8 runtime and local Node.js tests. Keep these functions separate from Google services. They may validate required organization fields, stable ID format, supported country/currency pairs, enumerated statuses, operation IDs, and whether a requested organization matches a membership context that has already been loaded and authenticated by trusted server-side code.

**Important limitation:** a pure function receiving `authenticatedEmail`, `role`, or `OrganizationID` from an arbitrary caller cannot authenticate that caller. It must not be exposed as a security endpoint by itself. The production adapter must obtain identity from a verified execution context, load current membership from a protected source, check membership status/role and organization status, then call the pure policy function. Tests of the pure function prove only the supplied-context policy, not Google authentication, data-source isolation, or deployed security.

Use structured, non-sensitive validation errors (stable error code and safe field/reason). Do not echo full input records, email addresses, coordinates, credentials, or secrets in failures. Detect duplicate operation IDs through a durable server-side idempotency store with atomic/locked reservation and defined retention; an in-memory test set alone is not production duplicate protection.

## 19. Country, currency, and local requirements

Allowed country/currency combinations for applicable monetary records are exactly Botswana/BWP and Eswatini/SZL. Reject unsupported countries, mismatched currencies, and missing currency where an amount requires one. Never silently convert. Any later exchange-rate reporting must be a separately specified feature that records source, rate, effective timestamp, calculation, and original amount/currency alongside the converted value.

Country-specific legal, environmental, municipal, transport, employment, tax, privacy, site-access, and waste-handling requirements must be verified independently for each country and actual activity/site. Software validation is not legal advice or regulatory clearance.

## 20. Stage 5.1 release evidence

Stage 5.1 may be considered complete only when:
1. README and this specification accurately state the implementation status and agreed architecture.
2. Existing Stage 1–4 schemas and documents remain intact, or any intentional change is explained.
3. Pure validation source has local automated tests for valid/invalid organizations, country/currency rules, missing fields, invalid statuses, cross-organization policy attempts, duplicate operation IDs, and safe errors.
4. Tests are run and tied to the exact commit SHA; CI is claimed only when a current commit has a successful corresponding run.
5. Setup/deployment instructions explain project creation, authorization, test/deploy workflow, script properties, quotas, AppSheet plan/security checks, rollback, and what has not been verified.
6. The PR remains open and unmerged. No Google deployment or WhatsApp integration is claimed without direct evidence.
7. No standalone custom web application, blockchain, smart contracts, or cryptocurrency is introduced.

The next technical stage after this baseline is the authenticated Apps Script/Google Sheets adapter: derive caller identity from the actual Google execution context, perform server-side membership and organization-status lookup, enforce authorization on each read/write, and add integration tests in an authorized Google test project. Do not expose company data until negative cross-organization tests pass.
