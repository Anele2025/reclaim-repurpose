/** Application boundary: identity, authorization, validation, idempotency and audit are enforced here. */
var ReclaimService = (function () {
  "use strict";
  function create(deps) {
    function safe(code, message, correlationId) {
      return { ok: false, error: { code: code, message: message }, correlationId: correlationId || "" };
    }
    function id() {
      if (deps.idGenerator) return deps.idGenerator();
      if (deps.utilities && typeof deps.utilities.getUuid === "function") return deps.utilities.getUuid();
      return "";
    }
    function now() { return deps.clock && deps.clock.now ? deps.clock.now() : new Date().toISOString(); }
    function actor() {
      var result = deps.identity.resolveCurrentActor(deps.session);
      return result && result.ok && typeof result.actorId === "string" && result.actorId.trim()
        ? { ok: true, actorId: result.actorId.trim().toLowerCase() }
        : { ok: false, error: { code: "IDENTITY_UNAVAILABLE", message: "Identity could not be established." } };
    }
    function membershipFor(actorId, organizationId, requiredRole) {
      var rows;
      try {
        rows = typeof deps.repository.findMembershipsForActor === "function"
          ? deps.repository.findMembershipsForActor(actorId) : null;
      } catch (_) { return { ok: false, error: { code: "AUTHORIZATION_UNAVAILABLE", message: "Access could not be verified." } }; }
      if (!Array.isArray(rows)) return { ok: false, error: { code: "AUTHORIZATION_UNAVAILABLE", message: "Access could not be verified." } };
      var candidates = rows.filter(function (m) {
        if (!m || String(m.actorId || "").toLowerCase() !== actorId) return false;
        if (requiredRole === "PLATFORM_ADMIN") return m.role === "PLATFORM_ADMIN" && (!m.organizationId || m.organizationId === "PLATFORM");
        return m.role === "COMPANY_OWNER" && String(m.organizationId) === String(organizationId);
      });
      if (candidates.length > 1) return { ok: false, error: { code: "MEMBERSHIP_AMBIGUOUS", message: "Access could not be verified." } };
      if (!candidates.length) return { ok: false, error: { code: "MEMBERSHIP_NOT_FOUND", message: "Required active membership was not found." } };
      if (candidates[0].status !== "ACTIVE") return { ok: false, error: { code: "MEMBERSHIP_INACTIVE", message: "Membership is not active." } };
      return { ok: true, membership: candidates[0] };
    }
    function organizationFor(organizationId, allowProspect) {
      if (typeof organizationId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(organizationId)) {
        return { ok: false, error: { code: "INVALID_ORGANIZATION_ID", message: "A valid organization ID is required." } };
      }
      var organization;
      try { organization = deps.repository.findOrganization(organizationId); }
      catch (_) { return { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: "The request could not be completed." } }; }
      if (!organization) return { ok: false, error: { code: "ORGANIZATION_NOT_FOUND", message: "Organization could not be verified." } };
      if (["ACTIVE", "PROSPECT"].indexOf(String(organization.status)) < 0) {
        return { ok: false, error: { code: "ORGANIZATION_INACTIVE", message: "Organization is not available for this action." } };
      }
      if (!allowProspect && organization.status !== "ACTIVE") {
        return { ok: false, error: { code: "ORGANIZATION_NOT_ACTIVE", message: "Operational access requires an active organization." } };
      }
      if (organization.serviceEnabled !== true && String(organization.serviceEnabled).toLowerCase() !== "true") {
        return { ok: false, error: { code: "SERVICE_DISABLED", message: "The organization service is not enabled." } };
      }
      if (organization.country === "Botswana" && organization.currency !== "BWP" ||
          organization.country === "Eswatini" && organization.currency !== "SZL" ||
          ["Botswana", "Eswatini"].indexOf(String(organization.country)) < 0) {
        return { ok: false, error: { code: "CONFIGURATION_INVALID", message: "Organization configuration could not be verified." } };
      }
      return { ok: true, organization: organization };
    }
    function contextFor(organizationId, requiredRole, allowProspect) {
      var identity = actor();
      if (!identity.ok) return identity;
      var membership = membershipFor(identity.actorId, organizationId, requiredRole);
      if (!membership.ok) return membership;
      var organization = organizationFor(organizationId, allowProspect);
      if (!organization.ok) return organization;
      return { ok: true, actorId: identity.actorId, membership: membership.membership, organization: organization.organization };
    }
    function audit(context, action, outcome, reasonCode, operationId, recordRef) {
      return deps.audit.record(deps.repository, {
        eventId: id(), timestamp: now(), actorId: context && context.actorId || "unknown",
        organizationId: context && context.organization && context.organization.organizationId || "",
        action: action, outcome: outcome, reasonCode: reasonCode || "",
        operationId: operationId || "", recordRef: recordRef || "",
        configVersion: context && context.organization && String(context.organization.configVersion || "") || ""
      });
    }
    function denied(result, action, correlationId, organizationId) {
      var context = { actorId: "", organization: { organizationId: organizationId || "" } };
      var logged = audit(context, action, "DENIED", result.error && result.error.code || "DENIED", "", "");
      if (!logged.ok) return safe("AUDIT_UNAVAILABLE", "Request could not be safely completed.", correlationId);
      return safe(result.error && result.error.code || "REQUEST_DENIED",
        result.error && result.error.message || "Request could not be completed.", correlationId);
    }
    function getOrganizationSummary(request) {
      var correlationId = id();
      var target = request && request.organizationId;
      var context = contextFor(target, "COMPANY_OWNER", false);
      if (!context.ok) return denied(context, "READ_ORGANIZATION_SUMMARY", correlationId, target);
      var event = audit(context, "READ_ORGANIZATION_SUMMARY", "SUCCEEDED", "", "", target);
      if (!event.ok) return safe("AUDIT_UNAVAILABLE", "Request could not be safely completed.", correlationId);
      return { ok: true, value: {
        organizationId: context.organization.organizationId,
        organizationName: context.organization.organizationName,
        country: context.organization.country, currency: context.organization.currency,
        status: context.organization.status
      }, correlationId: correlationId };
    }
    function setOrganizationServiceEnabled(request) {
      var correlationId = id();
      var target = request && request.organizationId;
      if (!request || typeof request.serviceEnabled !== "boolean" ||
          typeof request.operationId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(request.operationId)) {
        return denied({ error: { code: "INVALID_REQUEST", message: "Request fields are invalid." } },
          "SET_ORGANIZATION_SERVICE", correlationId, target);
      }
      var context = contextFor(target, "PLATFORM_ADMIN", true);
      if (!context.ok) return denied(context, "SET_ORGANIZATION_SERVICE", correlationId, target);
      if (context.organization.status === "ARCHIVED") return denied({ error: { code: "ORGANIZATION_INACTIVE", message: "Archived organizations cannot be changed." } }, "SET_ORGANIZATION_SERVICE", correlationId, target);
      var payload = JSON.stringify({ organizationId: target, serviceEnabled: request.serviceEnabled });
      if (typeof deps.digest !== "function") return safe("DIGEST_UNAVAILABLE", "Operation could not be safely prepared.", correlationId);
      var digest;
      try { digest = deps.digest(payload); } catch (_) { return safe("DIGEST_UNAVAILABLE", "Operation could not be safely prepared.", correlationId); }
      if (typeof digest !== "string" || !digest) return safe("DIGEST_UNAVAILABLE", "Operation could not be safely prepared.", correlationId);
      var result = deps.idempotency.execute(deps.repository, deps.lockService, {
        operationId: request.operationId, actorId: context.actorId, organizationId: target,
        operationType: "SET_ORGANIZATION_SERVICE", payloadDigest: digest, correlationId: correlationId
      }, now(), function () {
        var refreshed = contextFor(target, "PLATFORM_ADMIN", true);
        if (!refreshed.ok) {
          var denyAudit = audit(context, "SET_ORGANIZATION_SERVICE", "DENIED", refreshed.error.code, request.operationId, target);
          if (!denyAudit.ok) throw new Error("AUDIT_REQUIRED");
          return { ok: false, error: refreshed.error };
        }
        var pre = audit(refreshed, "SET_ORGANIZATION_SERVICE", "ATTEMPTED", "", request.operationId, target);
        if (!pre.ok) throw new Error("AUDIT_REQUIRED");
        var updated;
        try {
          updated = deps.repository.updateOrganizationServiceEnabled(target, request.serviceEnabled, now());
        } catch (_) { throw new Error("WRITE_OUTCOME_UNCERTAIN"); }
        if (!updated) return { ok: false, error: { code: "ORGANIZATION_NOT_FOUND", message: "Organization could not be verified." } };
        var post = audit(refreshed, "SET_ORGANIZATION_SERVICE", "SUCCEEDED", "", request.operationId, target);
        if (!post.ok) throw new Error("POST_WRITE_AUDIT_UNAVAILABLE");
        return { ok: true, recordRef: target, value: { organizationId: target, serviceEnabled: request.serviceEnabled } };
      });
      if (!result.ok) {
        var err = result.error || {};
        return safe(err.code || "REQUEST_FAILED", err.message || "Request could not be completed.", correlationId);
      }
      return { ok: true, value: result.value, replayed: result.replayed === true, correlationId: correlationId };
    }
    return Object.freeze({
      getOrganizationSummary: getOrganizationSummary,
      setOrganizationServiceEnabled: setOrganizationServiceEnabled
    });
  }
  return Object.freeze({ create: create });
}());