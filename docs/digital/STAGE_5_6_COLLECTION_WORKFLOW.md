# Stage 5.6 — Collection-record workflow contract

## Status and boundary

This change adds the first server-side operational collection workflow to the existing Apps Script and Google Sheets architecture. Automated tests use synthetic in-memory fixtures. It does not create a spreadsheet, deploy Apps Script, connect WhatsApp, or configure AppSheet.

A collection is initially `RECORDED`. A separate authorized handover operation may change it to `HANDED_OVER` when a destination partner and handover reference are recorded. Neither status proves that the material was independently verified as recycled.

## Apps Script service entrypoints

The packaged Apps Script project exposes these function-level entrypoints:

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

The `CollectionRecords` sheet schema is defined in `ReclaimSheetsRepository.schemas`. The adapter validates the exact header set, validates record fields and stable IDs, escapes formula-like text, and provides organization-scoped listing. Mutations use the existing Apps Script script lock and idempotency table. If storage or post-write audit outcome is uncertain, the operation returns a reconciliation-required error rather than claiming success or blindly replaying.

## Remaining integration requirements

1. Provision a dedicated synthetic Google project and spreadsheet using the approved owner-run setup procedure.
2. Verify identity resolution and spreadsheet permissions with synthetic accounts.
3. Import the generated package and run owner-authorized tests against the actual Google environment.
4. Design and verify the secured AppSheet data-source/authentication route before exposing company-owner views.
5. Implement and verify the selected WhatsApp provider/webhook integration before claiming WhatsApp operation.

Repository CI is not evidence that any of these live integrations work.
