/** Central policy. Membership and organization arguments must come from trusted repository lookups. */
var ReclaimAuthorization = (function () {
  "use strict";
  var ROLES = ["PLATFORM_ADMIN", "COMPANY_OWNER"];
  function deny(code, message) { return { ok: false, error: { code: code, message: message } }; }
  function authorize(actorId, membership, organization, targetOrganizationId, requiredRoles) {
    if (!actorId || !membership || membership.actorId !== actorId) return deny("MEMBERSHIP_NOT_FOUND", "Active membership is required.");
    if (membership.status !== "ACTIVE") return deny("MEMBERSHIP_INACTIVE", "Membership is not active.");
    if (ROLES.indexOf(membership.role) < 0) return deny("ROLE_DENIED", "Role is not permitted.");
    if (!organization || organization.organizationId !== targetOrganizationId) return deny("ORGANIZATION_NOT_FOUND", "Organization could not be verified.");
    if (["ACTIVE", "PROSPECT"].indexOf(organization.status) < 0) return deny("ORGANIZATION_INACTIVE", "Organization is not available for this action.");
    if (membership.role !== "PLATFORM_ADMIN" && membership.organizationId !== targetOrganizationId) return deny("ORGANIZATION_SCOPE_DENIED", "Organization is outside the permitted scope.");
    if (requiredRoles && requiredRoles.length && requiredRoles.indexOf(membership.role) < 0) return deny("ROLE_DENIED", "Role is not permitted for this action.");
    if (organization.serviceEnabled === false) return deny("SERVICE_DISABLED", "The organization service is not enabled.");
    return { ok: true, actorId: actorId, organizationId: targetOrganizationId, role: membership.role };
  }
  function authorizeRecordScope(context, record) {
    if (!context || !context.ok || !record || typeof record.organizationId !== "string") return deny("RECORD_SCOPE_UNVERIFIED", "Record scope could not be verified.");
    if (context.role !== "PLATFORM_ADMIN" && record.organizationId !== context.organizationId) return deny("ORGANIZATION_SCOPE_DENIED", "Record is outside the permitted scope.");
    return { ok: true };
  }
  return Object.freeze({ authorize: authorize, authorizeRecordScope: authorizeRecordScope });
}());