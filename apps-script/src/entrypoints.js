/**
 * Restricted Apps Script entry points. No public doGet/doPost endpoint is exposed.
 * Identity availability must be verified for the chosen execution model before deployment.
 */
function reclaimGetMyOrganizationSummary(organizationId) {
  return reclaimCreateService().getOrganizationSummary({ organizationId: organizationId });
}
function reclaimSetOrganizationServiceEnabled(request) {
  return reclaimCreateService().setOrganizationServiceEnabled(request);
}
function reclaimCreateService() {
  var props = PropertiesService.getScriptProperties();
  var repository = ReclaimSheetsRepository.create(SpreadsheetApp, props);
  return ReclaimService.create({
    identity: ReclaimIdentity, session: Session, authorization: ReclaimAuthorization,
    repository: repository, audit: ReclaimAudit, idempotency: ReclaimIdempotency,
    lockService: LockService, utilities: Utilities,
    digest: function (value) {
      var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
      return bytes.map(function (b) { return ("0" + ((b + 256) % 256).toString(16)).slice(-2); }).join("");
    }
  });
}