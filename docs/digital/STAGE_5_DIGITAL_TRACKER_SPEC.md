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
