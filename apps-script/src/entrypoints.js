/**
 * No doGet/doPost is intentionally exposed in Stage 5.2.
 * These functions are for a controlled Apps Script execution context, not a public API.
 * Confirm Session identity behavior for the deployed account and execution model before use.
 */
function reclaimGetMyOrganizationSummary(organizationId) {
  try {
    var props = PropertiesService.getScriptProperties();
    var repository = ReclaimSheetsRepository.create(SpreadsheetApp, props);
    var service = ReclaimService.create({
      identity: ReclaimIdentity, session: Session,
      authorization: ReclaimAuthorization, repository: repository
    });
    return service.getOrganizationSummary({ organizationId: organizationId });
  } catch (_) {
    return { ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "Request could not be completed." } };
  }
}