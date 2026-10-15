# Stage 5.7 — Collection-site registry and collection-record workflow contract

## Status and boundary

This change adds the first server-side operational collection workflow to the existing Apps Script and Google Sheets architecture. Automated tests use synthetic in-memory fixtures. It does not create a spreadsheet, deploy Apps Script, connect WhatsApp, or configure AppSheet.

A collection is initially `RECORDED`. A separate authorized handover operation may change it to `HANDED_OVER` when a destination partner and handover reference are recorded. Neither status proves that the material was independently verified as recycled.

## Collection-site registry

Each organization registers operational sites before recording collections. Site creation requires `organizationId`, a stable unique `siteId`, `siteName` (1–120 characters), `country` (`Botswana` or `Eswatini`, matching the organization country), and an `operationId`; `locationDescription` is optional and limited to 240 characters. The server assigns timestamps, actor references, and `ACTIVE` status. Site IDs are unique across the registry. Owners can retrieve/list only their organization sites, update descriptive fields, and deactivate a site without deleting it. Every mutation uses the existing idempotency and audit layer.

An `ACTIVE` site may receive new collection records only when its stored `organizationId` matches the authenticated owner organization. Unknown, inactive, and cross-organization site IDs produce the same safe `SITE_NOT_AVAILABLE` response during collection creation. Deactivation blocks new records but does not rewrite historical records; their original `siteId` remains unchanged and records remain readable under normal organization authorization.

The exact `CollectionSites` headers are: `siteId, organizationId, siteName, country, locationDescription, status, createdAt, updatedAt, createdBy, updatedBy`. Do not create or migrate a live sheet automatically. Add this sheet to the dedicated synthetic spreadsheet only after reviewing its exact schema.

## Apps Script service entrypoints

The packaged Apps Script project exposes these function-level entrypoints:

- `reclaimCreateCollectionSite(request)`
- `reclaimGetCollectionSite(request)`
- `reclaimListCollectionSites(request)`
- `reclaimUpdateCollectionSite(request)`
- `reclaimDeactivateCollectionSite(request)`
- `reclaimRecordCollection(request)`
- `reclaimGetCollectionRecord(request)`
- `reclaimListCollectionRecords(request)`
- `reclaimRecordCollectionHandover(request)`

These are Apps Script function entrypoints for authorized integrations and tests; they are not a public unauthenticated HTTP API. The chosen AppSheet/WhatsApp integration must authenticate callers and pass through the service's server-side identity and membership checks. Live identity behavior must be verified in the selected Google execution model before deployment.

## Create request

Required fields:

- `organizationId`: organization scope, checked against authenticated membership.
- `siteId`: site identifier.
- `collectedAt`: ISO-8601 timestamp with timezone.
- `materialCategory`: one of `PLASTIC`, `PAPER`, `CARDBOARD`, `GLASS`, `METAL`, `ORGANIC`, `E_WASTE`, `TEXTILES`, `MIXED_RECYCLABLES`, `OTHER`.
- `quantity`: finite number greater than zero.
- `unit`: one of `kg`, `g`, `tonne`, `item`, `bag`, `litre`.
- `operationId`: caller-generated idempotency key (8–128 safe characters).

Optional text fields: `collectorRef`, `destinationPartnerId`, `handoverRef`, and `evidenceRef`. They are bounded and formula-sensitive text is escaped before storage. Client-supplied actor IDs, roles, statuses, timestamps, and collection IDs are not accepted in the create request; trusted values are assigned by the service.

## Read/list requests

- Get: `{ organizationId, collectionId }`
- List: `{ organizationId, limit? }`, with a maximum limit of 200.

The service derives the actor from the configured identity adapter, requires active `COMPANY_OWNER` membership, checks the organization status/service flag, and refuses cross-organization record access. Read/list operations are audited.

## Handover request

Required: `organizationId`, `collectionId`, `destinationPartnerId`, `handoverRef`, and `operationId`. `evidenceRef` is optional. The operation is idempotent and audited. It does not record an independent recycling verification.

## Persistence and recovery

The `CollectionSites` and `CollectionRecords` sheet schemas are defined in `ReclaimSheetsRepository.schemas`. The adapter validates the exact header set, validates record fields and stable IDs, escapes formula-like text, and provides organization-scoped listing. Mutations use the existing Apps Script script lock and idempotency table. If storage or post-write audit outcome is uncertain, the operation returns a reconciliation-required error rather than claiming success or blindly replaying.

## Future AppSheet boundary

These service entrypoints are available for a future reviewed integration. No AppSheet app, view, security filter, or authenticated invocation route has been created or verified by this change. When configured, the owner interface must preserve server-side identity and membership checks; do not expose the underlying master spreadsheet directly to company owners.

## Remaining integration requirements

1. Provision a dedicated synthetic Google project and spreadsheet using the approved owner-run setup procedure.
2. Verify identity resolution and spreadsheet permissions with synthetic accounts.
3. Import the generated package and run owner-authorized tests against the actual Google environment.
4. Design and verify the secured AppSheet data-source/authentication route before exposing company-owner views.
5. Implement and verify the selected WhatsApp provider/webhook integration before claiming WhatsApp operation.

Repository CI is not evidence that any of these live integrations work.


## Stage 5.8 — company-scoped customer registration foundation

The repository now defines a `CustomerRegistrations` sheet with these exact headers: `registrationId, organizationId, customerName, customerPhone, locationDescription, latitude, longitude, status, createdAt, updatedAt, createdBy, operationId`. The record includes the organization scope, contact details, a location description, numeric coordinates, status, timestamps, server-derived actor attribution, and the idempotency operation ID.

The current service exposes `reclaimCreateCustomerRegistration`, `reclaimGetCustomerRegistration`, and `reclaimListCustomerRegistrations`. These functions use the existing trusted Apps Script identity adapter and require active `COMPANY_OWNER` membership for the specified organization. Client-supplied actor IDs and unknown fields are rejected. Reads and lists are organization-scoped and audited; writes use the existing idempotency and audit workflow. Cross-organization reads return the same `CUSTOMER_REGISTRATION_NOT_FOUND` result as an unknown registration.

Coordinates are mandatory at registration in this increment because the agreed routing feature depends on customer coordinates. Latitude must be a finite number from -90 through 90 and longitude from -180 through 180. Missing, string-valued, non-finite, or out-of-range coordinates are rejected. A future change may define a controlled location-correction flow, but this stage does not silently create a registration that cannot support routing.

Customer names, contact values, and location descriptions are bounded and validated. Use only synthetic customer data in tests. Do not share the master spreadsheet directly with company owners; their access must continue through a reviewed authenticated interface.

### WhatsApp integration is not live

These are restricted Apps Script function-level entrypoints, not an incoming WhatsApp webhook. No `doPost` endpoint, provider signature verification, WhatsApp Business credentials, or live messaging was added. Customer-originated registration must not be wired directly to these owner-authenticated functions or accept an untrusted organization ID. A subsequent WhatsApp integration stage must verify the provider's webhook and derive the company context from a trusted company-specific registration route before calling a narrowly scoped registration operation. Until that is implemented and live-tested, WhatsApp registration remains **NOT IMPLEMENTED / NOT LIVE-VERIFIED**.

No live spreadsheet was created or modified, no Apps Script was deployed, and no AppSheet interface was configured by Stage 5.8. CI verifies repository behavior only.
