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
function reclaimCreateCollectionSite(request) { return reclaimCreateService().createCollectionSite(request); }
function reclaimGetCollectionSite(request) { return reclaimCreateService().getCollectionSite(request); }
function reclaimListCollectionSites(request) { return reclaimCreateService().listCollectionSites(request); }
function reclaimUpdateCollectionSite(request) { return reclaimCreateService().updateCollectionSite(request); }
function reclaimDeactivateCollectionSite(request) { return reclaimCreateService().deactivateCollectionSite(request); }
function reclaimRecordCollection(request) {
  return reclaimCreateService().recordCollection(request);
}
function reclaimGetCollectionRecord(request) {
  return reclaimCreateService().getCollectionRecord(request);
}
function reclaimListCollectionRecords(request) {
  return reclaimCreateService().listCollectionRecords(request);
}
function reclaimRecordCollectionHandover(request) {
  return reclaimCreateService().recordCollectionHandover(request);
}
function reclaimCreateCustomerRegistration(request) {
  return reclaimCreateService().createCustomerRegistration(request);
}
function reclaimGetCustomerRegistration(request) {
  return reclaimCreateService().getCustomerRegistration(request);
}
function reclaimListCustomerRegistrations(request) {
  return reclaimCreateService().listCustomerRegistrations(request);
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