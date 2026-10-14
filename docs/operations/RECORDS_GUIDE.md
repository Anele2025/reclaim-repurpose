# Stage 1 — Operational records guide

**Status:** Draft operating templates for pilot design. No real pilot, customer, partner, destination, or transaction is represented here.

## Files

CSV templates are in [templates/operations](../../templates/operations/).

- [customers_sites.csv](../../templates/operations/customers_sites.csv) — organization/site register.
- [recovery_partners.csv](../../templates/operations/recovery_partners.csv) — partner qualification and destination verification.
- [collections.csv](../../templates/operations/collections.csv) — collection visit header and responsibility.
- [material_events.csv](../../templates/operations/material_events.csv) — material quantities across distinct lifecycle events, including handovers and discrepancies.
- [finance_ledger.csv](../../templates/operations/finance_ledger.csv) — costs and revenue, in the transaction's actual currency.
- [monthly_impact.csv](../../templates/operations/monthly_impact.csv) — monthly material-flow summary by country, site, and material.

All rows currently included in these files are fictional test data. Delete test rows or retain them clearly marked as test data before any operational use. Never enter real personal contact details, identity numbers, credentials, or sensitive customer data in this public-facing project repository. The contact fields are deliberately limited to roles and whether details are stored separately.

## Record IDs and relationships

Use immutable, unique IDs that do not encode personal data. Suggested production formats are `CUS-YYYY-NNNN`, `PAR-YYYY-NNNN`, `COL-YYYY-NNNN`, `EVT-YYYY-NNNNN`, `FIN-YYYY-NNNNN`, and `IMP-YYYY-MM-SITE-NN`. The `TEST-` prefix is reserved for examples. Do not reuse an ID after a record is voided; preserve a correction trail.

- `collections.SiteRecordID` references `customers_sites.RecordID`.
- `material_events.CollectionID` references `collections.CollectionID`; `SiteRecordID` must match that collection's site.
- `material_events.DestinationPartnerID` references `recovery_partners.PartnerID` when a partner is involved.
- `finance_ledger.SiteRecordID`, `CollectionID`, and `CounterpartyRecordID` link to the relevant site, collection, or partner/customer ID where applicable.
- `monthly_impact.SiteRecordID` references the site register. Evidence reference fields should point to controlled records or securely stored documents, not contain secrets or personal information.

A CSV file does not enforce foreign keys or uniqueness by itself. Check these relationships when importing or reviewing records.

## Shared field conventions

- **CountryCode:** use `BW` for Botswana and `SZ` for Eswatini in these templates. Confirm codes with the eventual system's data dictionary before integration.
- **Dates:** `YYYY-MM-DD`; month-only reporting period: `YYYY-MM`; timestamps: ISO 8601 with an explicit local offset where known.
- **Quantities:** non-negative decimal numbers; retain the unit with every quantity. Use one unit consistently for a given material and report, preferably kg for weighed materials. Record the measurement method and evidence.
- **CurrencyCode:** `BWP` for Botswana pula and `SZL` for Eswatini lilangeni. Do not combine amounts from different currencies without a separately documented exchange rate, date, source, and conversion calculation.
- **RecordStatus:** `TEST_DATA`, `DRAFT`, `ACTIVE`, `INACTIVE`, or `VOIDED`. A voided record should not be deleted from an operational audit trail.
- **Blank vs zero:** blank means unknown/not recorded/not applicable as defined by context; zero means measured or confirmed zero. Do not fill missing evidence with zero.
- **Evidence references:** use a stable internal reference and secure storage location. Never publish confidential agreements or personal data in this repository.
- **People:** record the responsible person's role or internal staff ID in operational datasets. Keep contact details in an access-controlled system only when necessary.

## File-specific fields and validation

### 1. Customers and sites

Primary key: `RecordID`. Required for an operational record: ID, country, organization/site name, site type, service area, permission status, record owner, and review date. Site type should be a controlled value such as `University`, `Residence`, `Office`, `Retail`, `Community`, or `Other`. Permission status: `NOT_VERIFIED`, `PENDING`, `APPROVED`, or `DECLINED`. Do not schedule collection until access permission and site arrangements are confirmed. Avoid storing named individual contact details in this CSV.

### 2. Recovery partners

Primary key: `PartnerID`. Required before a destination is treated as verified: country, partner and facility identity, accepted material types, acceptance-criteria evidence, verification status/date/person, required handover evidence, local compliance check status, and agreement status. Verification status: `NOT_VERIFIED`, `IN_REVIEW`, `VERIFIED`, `SUSPENDED`. Agreement status: `NO_AGREEMENT`, `DRAFT`, `ACTIVE`, `EXPIRED`, `TERMINATED`. Local compliance status: `NOT_VERIFIED`, `IN_REVIEW`, `CHECKED`, `ACTION_REQUIRED`. A claimed partner or online listing is not sufficient proof of acceptance, authorization, or an active agreement. Recheck on material changes and at a defined review interval.

### 3. Collections

Primary key: `CollectionID`. Required for each visit: country, site ID, planned date, actual times where completed, collection status, responsible role, and recorder/timestamp. Collection status: `PLANNED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `EXCEPTION`. Use one collection ID for a single visit/event at a site; create material-event rows for individual material types and later lifecycle transitions. A completed visit does not prove a receiving partner accepted the material.

### 4. Material events

Primary key: `EventID`. Required for each event: collection ID where related to a collection, country, site, date, event type, material type, quantity, unit, measurement method, responsible role, recorder/timestamp, and evidence or a reason why evidence is unavailable. Event type: `COLLECTED`, `SORTED`, `TRANSFERRED_TO_PARTNER`, `ACCEPTED_BY_PARTNER`, `REJECTED_BY_PARTNER`, `REUSED`, `RECYCLED`, `DISCREPANCY_RECORDED`, `CORRECTION`. Acceptance status: `NOT_APPLICABLE`, `PENDING`, `ACCEPTED`, `PARTIALLY_ACCEPTED`, `REJECTED`, `UNKNOWN`. Discrepancy status: `NO_DISCREPANCY`, `OPEN`, `UNDER_REVIEW`, `RESOLVED`. Resolution status: `NOT_APPLICABLE`, `OPEN`, `RESOLVED`.

Each row represents **one material, one quantity, and one event at one point in its lifecycle**. For example, record collection, sorting, transfer, acceptance/rejection, and confirmed reuse/recycling as separate events with separate IDs. Never sum all event quantities to calculate total material recovered: the same material may appear in several stages. Reconcile the flow by collection, material, period, and evidence. If a partner accepts 8 kg out of 10 kg transferred, record 8 kg accepted and 2 kg rejected (or otherwise unaccounted for with an open discrepancy), supported by the handover evidence. Do not mark the remaining 2 kg rejected unless the partner or an investigation confirms it.

### 5. Finance ledger

Primary key: `TransactionID`. Required: date, country, transaction type, category, description, non-negative amount, currency, payment status, recorder, and evidence reference or documented reason for absence. Transaction type: `COST` or `REVENUE`. Payment status: `PENDING`, `PAID`, `PARTIALLY_PAID`, `OVERDUE`, `CANCELLED`, `NOT_APPLICABLE`. Store costs and revenue as positive amounts, and use `TransactionType` to distinguish them. Tax treatment status is a tracking field, not tax advice: confirm country-specific treatment with an appropriately qualified source.

### 6. Monthly impact report

Use one row per reporting month, country, site, and material type (or a clearly documented grouping). Quantities are stage-specific and must not be added together as if they were separate material. Collected quantity is supported by collection-event evidence; sorted quantity by sorting records; accepted quantity by receiving partner evidence; rejected quantity by rejection evidence; reused quantity by credible reuse evidence; recycled quantity by evidence that recycling/processing actually occurred. A weigh ticket showing receipt may prove acceptance but does not, by itself, prove recycling. If processing cannot be verified, leave recycled quantity blank/unknown or zero only when confirmed to be zero, and explain the limitation. Keep each stage's unit explicit. Data quality status: `TEST_DATA_ONLY`, `UNREVIEWED`, `REVIEWED`, `REQUIRES_CORRECTION`. Measurement basis: `MEASURED`, `ESTIMATED`, `MIXED`, `FICTIONAL_TEST_DATA`.

## Monthly reconciliation and review checklist

1. Confirm the reporting month, country, site, material type, units, and reporting owner.
2. Check that all production IDs are unique and all referenced site, collection, and partner IDs exist.
3. Reconcile collected quantities to collection events; investigate duplicates, missing weights, and corrections.
4. Match transfers and partner acceptance/rejection to receipts, weigh tickets, or other documented evidence.
5. Keep accepted, rejected, reused, and recycled quantities distinct. Do not infer recycling from collection, sorting, or acceptance.
6. Record discrepancies and keep them open until evidence supports resolution.
7. Reconcile finance entries to receipts/invoices and payment status. Keep BWP and SZL separate unless a conversion is explicitly documented.
8. Have a second person review the monthly report where practical. Record the reviewer and review date; if no independent reviewer is available, disclose that limitation.
9. Include measurement method, estimates, data gaps, and evidence references in the report.
10. Store source documents with access controls and backups. Do not attach sensitive documents to public GitHub.

## Country-specific launch gate

Botswana and Eswatini must be assessed separately. Before operating in either country, confirm relevant local requirements for the chosen material, collection activity, storage, transport, facility, business, taxes, municipal permissions, worker safety, and environmental handling with the relevant authorities or qualified local advisers. This guide does not determine which permits are required and does not establish compliance. Do not begin a material stream until a safe destination, acceptance criteria, permissions, and responsibilities have been checked for that country and site.

## CSV use

These files are spreadsheet-ready templates, not a connected database or a Google Sheets workbook. Import them into a spreadsheet or approved record system; preserve IDs, dates, units, and currency codes. The included sample rows are fictional and must not be reported as actual activity. CSV alone does not enforce access control, validation, audit logs, or referential integrity.
