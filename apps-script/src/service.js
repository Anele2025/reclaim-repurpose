/** Application service factory. Dependencies are injected; never trust identity fields from request data. */
var ReclaimService = (function () {
  "use strict";
  function create(deps) {
    function contextFor(targetOrganizationId) {
      var identity = deps.identity.resolveCurrentActor(deps.session);
      if (!identity.ok) return identity;
      var membership = deps.repository.findMembership(identity.actorId, targetOrganizationId);
      if (!membership) return { ok: false, error: { code: "MEMBERSHIP_NOT_FOUND", message: "Active membership is required." } };
      var organization = deps.repository.findOrganization(targetOrganizationId);
      var auth = deps.authorization.authorize(identity.actorId, membership, organization, targetOrganizationId, []);
      return auth.ok ? { ok: true, actorId: identity.actorId, membership: membership, organization: organization, auth: auth } : auth;
    }
    function getOrganizationSummary(request) {
      var target = request && request.organizationId;
      var context = contextFor(target);
      if (!context.ok) return safe(context);
      return { ok: true, value: { organizationId: context.organization.organizationId, organizationName: context.organization.organizationName, country: context.organization.country, currency: context.organization.currency, status: context.organization.status } };
    }
    function safe(result) {
      return { ok: false, error: { code: result.error && result.error.code || "REQUEST_DENIED", message: result.error && result.error.message || "Request could not be completed." } };
    }
    return Object.freeze({ getOrganizationSummary: getOrganizationSummary });
  }
  return Object.freeze({ create: create });
}());