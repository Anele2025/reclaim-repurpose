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
      var result;
      try { result = deps.identity.resolveCurrentActor(deps.session); }
      catch (_) { result = null; }
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
      if (!candidates.length) return { ok: false, error: { code: "MEMBERSHIP_NOT_FOUND", message: "Required membership was not found." } };
      if (candidates[0].status !== "ACTIVE") return { ok: false, error: { code: "MEMBERSHIP_INACTIVE", message: "Membership is not active." } };
      return { ok: true, membership: candidates[0] };
    }
    function organizationFor(organizationId, allowProspect, requiredRole) {
      if (typeof organizationId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(organizationId)) {
        return { ok: false, error: { code: "INVALID_ORGANIZATION_ID", message: "A valid organization ID is required." } };
      }
      var organization;
      try { organization = deps.repository.findOrganization(organizationId); }
      catch (_) { return { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: "The request could not be completed." } }; }
      if (!organization) return { ok: false, error: { code: "ORGANIZATION_NOT_FOUND", message: "Organization could not be verified." } };
      if (requiredRole === "PLATFORM_ADMIN") {
        if (["ACTIVE", "PROSPECT", "PAUSED", "SUSPENDED"].indexOf(String(organization.status)) < 0) {
          return { ok: false, error: { code: "ORGANIZATION_INACTIVE", message: "Archived or unknown organizations cannot be changed." } };
        }
      } else {
        if (["ACTIVE", "PROSPECT"].indexOf(String(organization.status)) < 0) {
          return { ok: false, error: { code: "ORGANIZATION_INACTIVE", message: "Organization is not available for this action." } };
        }
        if (!allowProspect && organization.status !== "ACTIVE") {
          return { ok: false, error: { code: "ORGANIZATION_NOT_ACTIVE", message: "Operational access requires an active organization." } };
        }
        if (organization.serviceEnabled !== true && String(organization.serviceEnabled).toLowerCase() !== "true") {
          return { ok: false, error: { code: "SERVICE_DISABLED", message: "The organization service is not enabled." } };
        }
      }
      if ((organization.country === "Botswana" && organization.currency !== "BWP") ||
          (organization.country === "Eswatini" && organization.currency !== "SZL") ||
          ["Botswana", "Eswatini"].indexOf(String(organization.country)) < 0) {
        return { ok: false, error: { code: "CONFIGURATION_INVALID", message: "Organization configuration could not be verified." } };
      }
      if (typeof organization.configVersion !== "string" && typeof organization.configVersion !== "number") {
        return { ok: false, error: { code: "CONFIGURATION_INVALID", message: "Organization configuration could not be verified." } };
      }
      return { ok: true, organization: organization };
    }
    function contextFor(organizationId, requiredRole, allowProspect) {
      var identity = actor();
      if (!identity.ok) return identity;
      var membership = membershipFor(identity.actorId, organizationId, requiredRole);
      if (!membership.ok) return membership;
      var organization = organizationFor(organizationId, allowProspect, requiredRole);
      if (!organization.ok) return organization;
      var version = Number(organization.organization.configVersion);
      if (!isFinite(version) || version < 1 || Math.floor(version) !== version) {
        return { ok: false, error: { code: "CONFIGURATION_INVALID", message: "Organization configuration could not be verified." } };
      }
      var policy;
      try {
        policy = deps.authorization.authorize(identity.actorId, membership.membership,
          organization.organization, organizationId, [requiredRole]);
      } catch (_) {
        return { ok: false, error: { code: "AUTHORIZATION_UNAVAILABLE", message: "Access could not be verified." } };
      }
      if (!policy || !policy.ok) return policy || { ok: false, error: { code: "AUTHORIZATION_UNAVAILABLE", message: "Access could not be verified." } };
      return { ok: true, actorId: identity.actorId, membership: membership.membership, organization: organization.organization, auth: policy };
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
      var identity = actor();
      var context = { actorId: identity.ok ? identity.actorId : "unknown", organization: { organizationId: typeof organizationId === "string" ? organizationId : "" } };
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
        try { updated = deps.repository.updateOrganizationServiceEnabled(target, request.serviceEnabled, now()); }
        catch (_) { throw new Error("WRITE_OUTCOME_UNCERTAIN"); }
        if (!updated) return { ok: false, error: { code: "ORGANIZATION_NOT_FOUND", message: "Organization could not be verified." } };
        var post = audit(refreshed, "SET_ORGANIZATION_SERVICE", "SUCCEEDED", "", request.operationId, target);
        if (!post.ok) throw new Error("POST_WRITE_AUDIT_UNAVAILABLE");
        return { ok: true, recordRef: target, value: { organizationId: target, serviceEnabled: request.serviceEnabled } };
      });
      if (!result.ok) {
        var err = result.error || {};
        var failureAudit = audit(context, "SET_ORGANIZATION_SERVICE", "FAILED", err.code || "REQUEST_FAILED", request.operationId, target);
        if (!failureAudit.ok && err.code !== "RECONCILIATION_REQUIRED") {
          return safe("AUDIT_UNAVAILABLE", "Request could not be safely completed.", correlationId);
        }
        return safe(err.code || "REQUEST_FAILED", err.message || "Request could not be completed.", correlationId);
      }
      if (result.replayed === true) {
        var replayAudit = audit(context, "SET_ORGANIZATION_SERVICE_REPLAY", "REPLAYED", "", request.operationId, target);
        if (!replayAudit.ok) return safe("AUDIT_UNAVAILABLE", "Request could not be safely completed.", correlationId);
      }
      return { ok: true, value: result.value, replayed: result.replayed === true, correlationId: correlationId };
    }


    var SITE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;
    function siteInput(request, mode) {
      if (!request || typeof request !== "object" || Array.isArray(request)) return { ok: false, error: { code: "INVALID_REQUEST", message: "Request fields are invalid." } };
      var allowed = mode === "DEACTIVATE" ? ["organizationId","siteId","operationId"] : ["organizationId","siteId","siteName","country","locationDescription","operationId"];
      if (Object.keys(request).some(function (key) { return allowed.indexOf(key) < 0; })) return { ok: false, error: { code: "INVALID_REQUEST", message: "Request fields are invalid." } };
      if (typeof request.organizationId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(request.organizationId) || typeof request.siteId !== "string" || !SITE_ID_PATTERN.test(request.siteId)) return { ok: false, error: { code: "INVALID_SITE_SCOPE", message: "Organization and site identifiers are required." } };
      if (typeof request.operationId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(request.operationId)) return { ok: false, error: { code: "INVALID_OPERATION_ID", message: "A valid operation ID is required." } };
      var value = { organizationId: request.organizationId, siteId: request.siteId, operationId: request.operationId };
      if (mode === "CREATE" || (mode === "UPDATE" && Object.prototype.hasOwnProperty.call(request, "siteName"))) {
        if (typeof request.siteName !== "string" || !request.siteName.trim() || request.siteName.trim().length > 120 || /[\u0000-\u001F]/.test(request.siteName)) return { ok: false, error: { code: "INVALID_SITE_NAME", message: "Site name must contain 1–120 safe characters." } };
        value.siteName = request.siteName.trim();
      }
      if (mode === "CREATE" || (mode === "UPDATE" && Object.prototype.hasOwnProperty.call(request, "country"))) {
        if (["Botswana","Eswatini"].indexOf(request.country) < 0) return { ok: false, error: { code: "UNSUPPORTED_SITE_COUNTRY", message: "Country must be Botswana or Eswatini." } };
        value.country = request.country;
      }
      if (mode === "CREATE" || (mode === "UPDATE" && Object.prototype.hasOwnProperty.call(request, "locationDescription"))) {
        var location = optionalText(request.locationDescription, "locationDescription", 240);
        if (!location.ok) return { ok: false, error: { code: "INVALID_SITE_LOCATION", message: "Site location description is invalid." } };
        value.locationDescription = location.value;
      }
      if (mode === "UPDATE" && !Object.prototype.hasOwnProperty.call(request, "siteName") && !Object.prototype.hasOwnProperty.call(request, "country") && !Object.prototype.hasOwnProperty.call(request, "locationDescription")) return { ok: false, error: { code: "INVALID_REQUEST", message: "At least one permitted site detail must be supplied." } };
      return { ok: true, value: value };
    }
    function createCollectionSite(request) {
      var correlationId = id(), input = siteInput(request, "CREATE");
      if (!input.ok) return denied(input, "CREATE_COLLECTION_SITE", correlationId, request && request.organizationId);
      var value = input.value, context = contextFor(value.organizationId, "COMPANY_OWNER", false);
      if (!context.ok) return denied(context, "CREATE_COLLECTION_SITE", correlationId, value.organizationId);
      if (value.country !== context.organization.country) return denied({ error: { code: "SITE_COUNTRY_MISMATCH", message: "Site country must match the organization's registered country." } }, "CREATE_COLLECTION_SITE", correlationId, value.organizationId);
      if (typeof deps.digest !== "function") return safe("DIGEST_UNAVAILABLE", "Operation could not be safely prepared.", correlationId);
      var digest; try { digest = deps.digest(JSON.stringify(value)); } catch (_) { return safe("DIGEST_UNAVAILABLE", "Operation could not be safely prepared.", correlationId); }
      if (typeof digest !== "string" || !digest) return safe("DIGEST_UNAVAILABLE", "Operation could not be safely prepared.", correlationId);
      var result = deps.idempotency.execute(deps.repository, deps.lockService, { operationId: value.operationId, actorId: context.actorId, organizationId: value.organizationId, operationType: "CREATE_COLLECTION_SITE", payloadDigest: digest, correlationId: correlationId }, now(), function () {
        var refreshed = contextFor(value.organizationId, "COMPANY_OWNER", false);
        if (!refreshed.ok) throw new Error("AUTHORIZATION_CHANGED");
        var existing; try { existing = deps.repository.findCollectionSite(value.siteId); } catch (_) { throw new Error("STORAGE_UNAVAILABLE"); }
        if (existing) return { ok: false, error: { code: "SITE_ID_UNAVAILABLE", message: "Site ID is already registered or unavailable." } };
        if (!audit(refreshed, "CREATE_COLLECTION_SITE", "ATTEMPTED", "", value.operationId, value.siteId).ok) throw new Error("AUDIT_REQUIRED");
        var timestamp = now(), site = { siteId: value.siteId, organizationId: value.organizationId, siteName: value.siteName, country: value.country, locationDescription: value.locationDescription, status: "ACTIVE", createdAt: timestamp, updatedAt: timestamp, createdBy: refreshed.actorId, updatedBy: refreshed.actorId };
        try { deps.repository.appendCollectionSite(site); } catch (_) { throw new Error("WRITE_OUTCOME_UNCERTAIN"); }
        if (!audit(refreshed, "CREATE_COLLECTION_SITE", "SUCCEEDED", "", value.operationId, value.siteId).ok) throw new Error("POST_WRITE_AUDIT_UNAVAILABLE");
        return { ok: true, recordRef: value.siteId, value: site };
      });
      if (!result.ok) { var err = result.error || {}; if (!audit(context, "CREATE_COLLECTION_SITE", "FAILED", err.code || "REQUEST_FAILED", value.operationId, value.siteId).ok && err.code !== "RECONCILIATION_REQUIRED") return safe("AUDIT_UNAVAILABLE", "Request could not be safely completed.", correlationId); return safe(err.code || "REQUEST_FAILED", err.message || "Request could not be completed.", correlationId); }
      if (result.replayed && !audit(context, "CREATE_COLLECTION_SITE_REPLAY", "REPLAYED", "", value.operationId, value.siteId).ok) return safe("AUDIT_UNAVAILABLE", "Request could not be safely completed.", correlationId);
      return { ok: true, value: result.value, replayed: result.replayed === true, correlationId: correlationId };
    }
    function getCollectionSite(request) {
      var correlationId = id(), target = request && request.organizationId, siteId = request && request.siteId;
      if (!request || typeof request !== "object" || Array.isArray(request) || Object.keys(request).some(function (key) { return ["organizationId","siteId"].indexOf(key) < 0; }) || typeof siteId !== "string" || !SITE_ID_PATTERN.test(siteId)) return denied({ error: { code: "INVALID_REQUEST", message: "Request fields are invalid." } }, "READ_COLLECTION_SITE", correlationId, target);
      var context = contextFor(target, "COMPANY_OWNER", false); if (!context.ok) return denied(context, "READ_COLLECTION_SITE", correlationId, target);
      var site; try { site = deps.repository.findCollectionSite(siteId); } catch (_) { return safe("STORAGE_UNAVAILABLE", "The request could not be completed.", correlationId); }
      if (!site || String(site.organizationId) !== String(context.organization.organizationId)) return safe("SITE_NOT_FOUND", "Site could not be found.", correlationId);
      if (!audit(context, "READ_COLLECTION_SITE", "SUCCEEDED", "", "", siteId).ok) return safe("AUDIT_UNAVAILABLE", "Request could not be safely completed.", correlationId);
      return { ok: true, value: site, correlationId: correlationId };
    }
    function listCollectionSites(request) {
      var correlationId = id(), target = request && request.organizationId, limit = request && request.limit !== undefined ? request.limit : 100;
      if (!request || typeof request !== "object" || Array.isArray(request) || Object.keys(request).some(function (key) { return ["organizationId","limit"].indexOf(key) < 0; }) || typeof limit !== "number" || !isFinite(limit) || Math.floor(limit) !== limit || limit < 1 || limit > 200) return denied({ error: { code: "INVALID_REQUEST", message: "Request fields are invalid." } }, "LIST_COLLECTION_SITES", correlationId, target);
      var context = contextFor(target, "COMPANY_OWNER", false); if (!context.ok) return denied(context, "LIST_COLLECTION_SITES", correlationId, target);
      var sites; try { sites = deps.repository.findCollectionSitesForOrganization(context.organization.organizationId, limit); } catch (_) { return safe("STORAGE_UNAVAILABLE", "The request could not be completed.", correlationId); }
      if (!Array.isArray(sites) || sites.some(function (site) { return String(site.organizationId) !== String(context.organization.organizationId); })) return safe("STORAGE_INTEGRITY_ERROR", "Sites could not be safely returned.", correlationId);
      if (!audit(context, "LIST_COLLECTION_SITES", "SUCCEEDED", "", "", "").ok) return safe("AUDIT_UNAVAILABLE", "Request could not be safely completed.", correlationId);
      return { ok: true, value: sites, correlationId: correlationId };
    }
    function mutateCollectionSite(request, deactivate) {
      var action = deactivate ? "DEACTIVATE_COLLECTION_SITE" : "UPDATE_COLLECTION_SITE", correlationId = id(), input = siteInput(request, deactivate ? "DEACTIVATE" : "UPDATE");
      if (!input.ok) return denied(input, action, correlationId, request && request.organizationId);
      var value = input.value, context = contextFor(value.organizationId, "COMPANY_OWNER", false); if (!context.ok) return denied(context, action, correlationId, value.organizationId);
      if (value.country && value.country !== context.organization.country) return denied({ error: { code: "SITE_COUNTRY_MISMATCH", message: "Site country must match the organization's registered country." } }, action, correlationId, value.organizationId);
      if (typeof deps.digest !== "function") return safe("DIGEST_UNAVAILABLE", "Operation could not be safely prepared.", correlationId);
      var digest; try { digest = deps.digest(JSON.stringify({ organizationId: value.organizationId, siteId: value.siteId, siteName: value.siteName, country: value.country, locationDescription: value.locationDescription, deactivate: deactivate })); } catch (_) { return safe("DIGEST_UNAVAILABLE", "Operation could not be safely prepared.", correlationId); }
      if (typeof digest !== "string" || !digest) return safe("DIGEST_UNAVAILABLE", "Operation could not be safely prepared.", correlationId);
      var result = deps.idempotency.execute(deps.repository, deps.lockService, { operationId: value.operationId, actorId: context.actorId, organizationId: value.organizationId, operationType: action, payloadDigest: digest, correlationId: correlationId }, now(), function () {
        var refreshed = contextFor(value.organizationId, "COMPANY_OWNER", false); if (!refreshed.ok) throw new Error("AUTHORIZATION_CHANGED");
        var current; try { current = deps.repository.findCollectionSite(value.siteId); } catch (_) { throw new Error("STORAGE_UNAVAILABLE"); }
        if (!current || String(current.organizationId) !== String(refreshed.organization.organizationId)) return { ok: false, error: { code: "SITE_NOT_FOUND", message: "Site could not be found." } };
        if (!audit(refreshed, action, "ATTEMPTED", "", value.operationId, value.siteId).ok) throw new Error("AUDIT_REQUIRED");
        var changes = { updatedAt: now(), updatedBy: refreshed.actorId };
        if (deactivate) changes.status = "INACTIVE";
        else { if (value.siteName !== undefined) changes.siteName = value.siteName; if (value.country !== undefined) changes.country = value.country; if (value.locationDescription !== undefined) changes.locationDescription = value.locationDescription; }
        var updated; try { updated = deps.repository.updateCollectionSite(value.siteId, changes); } catch (_) { throw new Error("WRITE_OUTCOME_UNCERTAIN"); }
        if (!updated) return { ok: false, error: { code: "SITE_NOT_FOUND", message: "Site could not be found." } };
        if (!audit(refreshed, action, "SUCCEEDED", "", value.operationId, value.siteId).ok) throw new Error("POST_WRITE_AUDIT_UNAVAILABLE");
        var site = {}; Object.keys(current).forEach(function (key) { site[key] = current[key]; }); Object.keys(changes).forEach(function (key) { site[key] = changes[key]; });
        return { ok: true, recordRef: value.siteId, value: site };
      });
      if (!result.ok) { var err = result.error || {}; if (!audit(context, action, "FAILED", err.code || "REQUEST_FAILED", value.operationId, value.siteId).ok && err.code !== "RECONCILIATION_REQUIRED") return safe("AUDIT_UNAVAILABLE", "Request could not be safely completed.", correlationId); return safe(err.code || "REQUEST_FAILED", err.message || "Request could not be completed.", correlationId); }
      if (result.replayed && !audit(context, action + "_REPLAY", "REPLAYED", "", value.operationId, value.siteId).ok) return safe("AUDIT_UNAVAILABLE", "Request could not be safely completed.", correlationId);
      return { ok: true, value: result.value, replayed: result.replayed === true, correlationId: correlationId };
    }
    function updateCollectionSite(request) { return mutateCollectionSite(request, false); }
    function deactivateCollectionSite(request) { return mutateCollectionSite(request, true); }

    var MATERIAL_CATEGORIES = ["PLASTIC","PAPER","CARDBOARD","GLASS","METAL","ORGANIC","E_WASTE","TEXTILES","MIXED_RECYCLABLES","OTHER"];
    var COLLECTION_UNITS = ["kg","g","tonne","item","bag","litre"];
    function validTimestamp(value) {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
      var parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
      if (!parts) return false;
      var year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
      var hour = Number(parts[4]), minute = Number(parts[5]), second = Number(parts[6]);
      var days = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31,30,31,30,31,31,30,31,30,31];
      return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] &&
        hour <= 23 && minute <= 59 && second <= 59 && isFinite(Date.parse(value));
    }
    function optionalText(value, field, max) {
      if (value === undefined || value === null || value === "") return { ok: true, value: "" };
      if (typeof value !== "string" || value.trim().length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) {
        return { ok: false, error: { code: "INVALID_COLLECTION_FIELD", message: "Collection field is invalid: " + field + "." } };
      }
      return { ok: true, value: value.trim() };
    }
    function collectionInput(request) {
      if (!request || typeof request !== "object" || Array.isArray(request)) return { ok: false, error: { code: "INVALID_REQUEST", message: "Request fields are invalid." } };
      var allowed = ["organizationId","siteId","collectedAt","materialCategory","quantity","unit","collectorRef","destinationPartnerId","handoverRef","evidenceRef","operationId"];
      if (Object.keys(request).some(function (key) { return allowed.indexOf(key) < 0; })) return { ok: false, error: { code: "INVALID_REQUEST", message: "Request fields are invalid." } };
      if (typeof request.organizationId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(request.organizationId) ||
          typeof request.siteId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(request.siteId)) {
        return { ok: false, error: { code: "INVALID_COLLECTION_SCOPE", message: "Organization and site identifiers are required." } };
      }
      if (!validTimestamp(request.collectedAt)) return { ok: false, error: { code: "INVALID_COLLECTION_DATE", message: "Collection date must be a real ISO timestamp with a timezone." } };
      if (MATERIAL_CATEGORIES.indexOf(request.materialCategory) < 0) return { ok: false, error: { code: "INVALID_MATERIAL_CATEGORY", message: "Material category is not supported." } };
      if (typeof request.quantity !== "number" || !isFinite(request.quantity) || request.quantity <= 0) return { ok: false, error: { code: "INVALID_COLLECTION_QUANTITY", message: "Quantity must be a finite number greater than zero." } };
      if (COLLECTION_UNITS.indexOf(request.unit) < 0) return { ok: false, error: { code: "INVALID_COLLECTION_UNIT", message: "Measurement unit is not supported." } };
      var operation = typeof request.operationId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(request.operationId);
      if (!operation) return { ok: false, error: { code: "INVALID_OPERATION_ID", message: "A valid operation ID is required." } };
      var fields = {};
      ["collectorRef","destinationPartnerId","handoverRef","evidenceRef"].forEach(function (key) {
        fields[key] = optionalText(request[key], key, key === "evidenceRef" ? 256 : 128);
      });
      var keys = Object.keys(fields);
      for (var i = 0; i < keys.length; i += 1) if (!fields[keys[i]].ok) return fields[keys[i]];
      return { ok: true, value: {
        organizationId: request.organizationId, siteId: request.siteId, collectedAt: request.collectedAt,
        materialCategory: request.materialCategory, quantity: request.quantity, unit: request.unit,
        collectorRef: fields.collectorRef.value, destinationPartnerId: fields.destinationPartnerId.value,
        handoverRef: fields.handoverRef.value, evidenceRef: fields.evidenceRef.value, operationId: request.operationId
      } };
    }
    function recordCollection(request) {
      var correlationId = id();
      var input = collectionInput(request);
      if (!input.ok) return denied(input, "CREATE_COLLECTION_RECORD", correlationId, request && request.organizationId);
      var value = input.value, context = contextFor(value.organizationId, "COMPANY_OWNER", false);
      if (!context.ok) return denied(context, "CREATE_COLLECTION_RECORD", correlationId, value.organizationId);
      if (typeof deps.digest !== "function") return safe("DIGEST_UNAVAILABLE", "Operation could not be safely prepared.", correlationId);
      var digest;
      try { digest = deps.digest(JSON.stringify(value)); } catch (_) { return safe("DIGEST_UNAVAILABLE", "Operation could not be safely prepared.", correlationId); }
      if (typeof digest !== "string" || !digest) return safe("DIGEST_UNAVAILABLE", "Operation could not be safely prepared.", correlationId);
      var collectionId = id();
      if (typeof collectionId !== "string" || !collectionId.trim()) return safe("ID_GENERATION_UNAVAILABLE", "Record could not be safely created.", correlationId);
      var result = deps.idempotency.execute(deps.repository, deps.lockService, {
        operationId: value.operationId, actorId: context.actorId, organizationId: value.organizationId,
        operationType: "CREATE_COLLECTION_RECORD", payloadDigest: digest, correlationId: correlationId
      }, now(), function () {
        var refreshed = contextFor(value.organizationId, "COMPANY_OWNER", false);
        if (!refreshed.ok) {
          if (!audit(context, "CREATE_COLLECTION_RECORD", "DENIED", refreshed.error.code, value.operationId, collectionId).ok) throw new Error("AUDIT_REQUIRED");
          return { ok: false, error: refreshed.error };
        }
        if (!audit(refreshed, "CREATE_COLLECTION_RECORD", "ATTEMPTED", "", value.operationId, collectionId).ok) throw new Error("AUDIT_REQUIRED");
        var registeredSite;
        try { registeredSite = deps.repository.findCollectionSite(value.siteId); } catch (_) { throw new Error("STORAGE_UNAVAILABLE"); }
        if (!registeredSite || String(registeredSite.organizationId) !== String(refreshed.organization.organizationId) || registeredSite.status !== "ACTIVE") return { ok: false, error: { code: "SITE_NOT_AVAILABLE", message: "An active registered site in this organization is required." } };
        var timestamp = now();
        var record = {
          collectionId: collectionId, organizationId: value.organizationId, siteId: value.siteId,
          collectedAt: value.collectedAt, materialCategory: value.materialCategory, quantity: value.quantity,
          unit: value.unit, collectorRef: value.collectorRef, destinationPartnerId: value.destinationPartnerId,
          handoverRef: value.handoverRef, evidenceRef: value.evidenceRef,
          status: "RECORDED",
          createdAt: timestamp, updatedAt: timestamp, createdBy: refreshed.actorId, operationId: value.operationId
        };
        try { deps.repository.appendCollectionRecord(record); } catch (_) { throw new Error("WRITE_OUTCOME_UNCERTAIN"); }
        if (!audit(refreshed, "CREATE_COLLECTION_RECORD", "SUCCEEDED", "", value.operationId, collectionId).ok) throw new Error("POST_WRITE_AUDIT_UNAVAILABLE");
        return { ok: true, recordRef: collectionId, value: record };
      });
      if (!result.ok) {
        var err = result.error || {};
        if (!audit(context, "CREATE_COLLECTION_RECORD", "FAILED", err.code || "REQUEST_FAILED", value.operationId, "").ok && err.code !== "RECONCILIATION_REQUIRED") return safe("AUDIT_UNAVAILABLE", "Request could not be safely completed.", correlationId);
        return safe(err.code || "REQUEST_FAILED", err.message || "Request could not be completed.", correlationId);
      }
      if (result.replayed && !audit(context, "CREATE_COLLECTION_RECORD_REPLAY", "REPLAYED", "", value.operationId, result.value && result.value.collectionId || "").ok) return safe("AUDIT_UNAVAILABLE", "Request could not be safely completed.", correlationId);
      return { ok: true, value: result.value, replayed: result.replayed === true, correlationId: correlationId };
    }
    function getCollectionRecord(request) {
      var correlationId = id(), target = request && request.organizationId, recordId = request && request.collectionId;
      if (!request || typeof request !== "object" || Array.isArray(request) ||
          Object.keys(request).some(function (key) { return ["organizationId","collectionId"].indexOf(key) < 0; })) {
        return denied({ error: { code: "INVALID_REQUEST", message: "Request fields are invalid." } }, "READ_COLLECTION_RECORD", correlationId, target);
      }
      if (typeof recordId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(recordId)) return denied({ error: { code: "INVALID_COLLECTION_ID", message: "Collection record ID is invalid." } }, "READ_COLLECTION_RECORD", correlationId, target);
      var context = contextFor(target, "COMPANY_OWNER", false);
      if (!context.ok) return denied(context, "READ_COLLECTION_RECORD", correlationId, target);
      var record;
      try { record = deps.repository.findCollectionRecord(recordId); } catch (_) { return safe("STORAGE_UNAVAILABLE", "The request could not be completed.", correlationId); }
      if (!record || String(record.organizationId) !== String(context.organization.organizationId)) return safe("COLLECTION_NOT_FOUND", "Collection record could not be found.", correlationId);
      if (!audit(context, "READ_COLLECTION_RECORD", "SUCCEEDED", "", "", recordId).ok) return safe("AUDIT_UNAVAILABLE", "Request could not be safely completed.", correlationId);
      return { ok: true, value: record, correlationId: correlationId };
    }
    function listCollectionRecords(request) {
      var correlationId = id(), target = request && request.organizationId;
      var limit = request && request.limit !== undefined ? request.limit : 100;
      if (request && Object.keys(request).some(function (key) { return ["organizationId","limit"].indexOf(key) < 0; }) ||
          typeof limit !== "number" || !isFinite(limit) || Math.floor(limit) !== limit || limit < 1 || limit > 200) {
        return denied({ error: { code: "INVALID_REQUEST", message: "Request fields are invalid." } }, "LIST_COLLECTION_RECORDS", correlationId, target);
      }
      var context = contextFor(target, "COMPANY_OWNER", false);
      if (!context.ok) return denied(context, "LIST_COLLECTION_RECORDS", correlationId, target);
      var records;
      try { records = deps.repository.findCollectionRecordsForOrganization(context.organization.organizationId, limit); }
      catch (_) { return safe("STORAGE_UNAVAILABLE", "The request could not be completed.", correlationId); }
      if (!Array.isArray(records) || records.some(function (record) { return String(record.organizationId) !== String(context.organization.organizationId); })) return safe("STORAGE_INTEGRITY_ERROR", "Records could not be safely returned.", correlationId);
      if (!audit(context, "LIST_COLLECTION_RECORDS", "SUCCEEDED", "", "", "").ok) return safe("AUDIT_UNAVAILABLE", "Request could not be safely completed.", correlationId);
      return { ok: true, value: records, correlationId: correlationId };
    }
    function recordCollectionHandover(request) {
      var correlationId = id();
      if (!request || typeof request !== "object" || Array.isArray(request) ||
          Object.keys(request).some(function (key) { return ["organizationId","collectionId","destinationPartnerId","handoverRef","evidenceRef","operationId"].indexOf(key) < 0; }) ||
          typeof request.collectionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(request.collectionId) ||
          typeof request.operationId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(request.operationId)) {
        return denied({ error: { code: "INVALID_REQUEST", message: "Request fields are invalid." } }, "RECORD_COLLECTION_HANDOVER", correlationId, request && request.organizationId);
      }
      var partner = optionalText(request.destinationPartnerId, "destinationPartnerId", 128);
      var handover = optionalText(request.handoverRef, "handoverRef", 128);
      var evidence = optionalText(request.evidenceRef, "evidenceRef", 256);
      if (!partner.ok || !handover.ok || !evidence.ok || !partner.value || !handover.value) return denied({ error: { code: "INVALID_HANDOVER", message: "A destination partner and handover reference are required." } }, "RECORD_COLLECTION_HANDOVER", correlationId, request.organizationId);
      var context = contextFor(request.organizationId, "COMPANY_OWNER", false);
      if (!context.ok) return denied(context, "RECORD_COLLECTION_HANDOVER", correlationId, request.organizationId);
      var payload = { organizationId: request.organizationId, collectionId: request.collectionId, destinationPartnerId: partner.value, handoverRef: handover.value, evidenceRef: evidence.value };
      if (typeof deps.digest !== "function") return safe("DIGEST_UNAVAILABLE", "Operation could not be safely prepared.", correlationId);
      var digest;
      try { digest = deps.digest(JSON.stringify(payload)); } catch (_) { return safe("DIGEST_UNAVAILABLE", "Operation could not be safely prepared.", correlationId); }
      if (typeof digest !== "string" || !digest) return safe("DIGEST_UNAVAILABLE", "Operation could not be safely prepared.", correlationId);
      var result = deps.idempotency.execute(deps.repository, deps.lockService, {
        operationId: request.operationId, actorId: context.actorId, organizationId: request.organizationId,
        operationType: "RECORD_COLLECTION_HANDOVER", payloadDigest: digest, correlationId: correlationId
      }, now(), function () {
        var refreshed = contextFor(request.organizationId, "COMPANY_OWNER", false);
        if (!refreshed.ok) throw new Error("AUTHORIZATION_CHANGED");
        var current;
        try { current = deps.repository.findCollectionRecord(request.collectionId); } catch (_) { throw new Error("STORAGE_UNAVAILABLE"); }
        if (!current || String(current.organizationId) !== String(refreshed.organization.organizationId)) return { ok: false, error: { code: "COLLECTION_NOT_FOUND", message: "Collection record could not be found." } };
        if (current.status === "HANDED_OVER" && current.handoverRef !== handover.value) return { ok: false, error: { code: "HANDOVER_ALREADY_RECORDED", message: "A different handover is already recorded." } };
        if (!audit(refreshed, "RECORD_COLLECTION_HANDOVER", "ATTEMPTED", "", request.operationId, request.collectionId).ok) throw new Error("AUDIT_REQUIRED");
        var changes = { destinationPartnerId: partner.value, handoverRef: handover.value, evidenceRef: evidence.value, status: "HANDED_OVER", updatedAt: now() };
        var updated;
        try { updated = deps.repository.updateCollectionRecord(request.collectionId, changes); } catch (_) { throw new Error("WRITE_OUTCOME_UNCERTAIN"); }
        if (!updated) return { ok: false, error: { code: "COLLECTION_NOT_FOUND", message: "Collection record could not be found." } };
        if (!audit(refreshed, "RECORD_COLLECTION_HANDOVER", "SUCCEEDED", "", request.operationId, request.collectionId).ok) throw new Error("POST_WRITE_AUDIT_UNAVAILABLE");
        var value = {};
        Object.keys(current).forEach(function (key) { value[key] = current[key]; });
        Object.keys(changes).forEach(function (key) { value[key] = changes[key]; });
        return { ok: true, recordRef: request.collectionId, value: value };
      });
      if (!result.ok) {
        var handoverError = result.error || {};
        var failureEvent = audit(context, "RECORD_COLLECTION_HANDOVER", "FAILED", handoverError.code || "REQUEST_FAILED", request.operationId, request.collectionId);
        if (!failureEvent.ok && handoverError.code !== "RECONCILIATION_REQUIRED") return safe("AUDIT_UNAVAILABLE", "Request could not be safely completed.", correlationId);
        return safe(handoverError.code || "REQUEST_FAILED", handoverError.message || "Request could not be completed.", correlationId);
      }
      if (result.replayed && !audit(context, "RECORD_COLLECTION_HANDOVER_REPLAY", "REPLAYED", "", request.operationId, request.collectionId).ok) return safe("AUDIT_UNAVAILABLE", "Request could not be safely completed.", correlationId);
      return { ok: true, value: result.value, replayed: result.replayed === true, correlationId: correlationId };
    }

    var REGISTRATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
    function customerRegistrationInput(request) {
      if (!request || typeof request !== "object" || Array.isArray(request)) return { ok: false, error: { code: "INVALID_REQUEST", message: "Request fields are invalid." } };
      var allowed = ["organizationId","registrationId","customerName","customerPhone","locationDescription","latitude","longitude","operationId"];
      if (Object.keys(request).some(function (key) { return allowed.indexOf(key) < 0; })) return { ok: false, error: { code: "INVALID_REQUEST", message: "Request fields are invalid." } };
      if (typeof request.organizationId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(request.organizationId) || typeof request.registrationId !== "string" || !REGISTRATION_ID_PATTERN.test(request.registrationId)) return { ok: false, error: { code: "INVALID_CUSTOMER_REGISTRATION_SCOPE", message: "Organization and registration identifiers are required." } };
      if (typeof request.operationId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(request.operationId)) return { ok: false, error: { code: "INVALID_OPERATION_ID", message: "A valid operation ID is required." } };
      if (typeof request.customerName !== "string" || !request.customerName.trim() || request.customerName.trim().length > 120 || /[\u0000-\u001F]/.test(request.customerName)) return { ok: false, error: { code: "INVALID_CUSTOMER_NAME", message: "Customer name must contain 1–120 safe characters." } };
      if (typeof request.customerPhone !== "string" || !request.customerPhone.trim() || request.customerPhone.trim().length > 32 || /[\u0000-\u001F]/.test(request.customerPhone)) return { ok: false, error: { code: "INVALID_CUSTOMER_PHONE", message: "Customer contact number is invalid." } };
      var digits = request.customerPhone.replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 15) return { ok: false, error: { code: "INVALID_CUSTOMER_PHONE", message: "Customer contact number is invalid." } };
      if (typeof request.latitude !== "number" || !isFinite(request.latitude) || request.latitude < -90 || request.latitude > 90 || typeof request.longitude !== "number" || !isFinite(request.longitude) || request.longitude < -180 || request.longitude > 180) return { ok: false, error: { code: "INVALID_CUSTOMER_COORDINATES", message: "Valid latitude and longitude are required for routing." } };
      var location = optionalText(request.locationDescription, "locationDescription", 240);
      if (!location.ok) return { ok: false, error: { code: "INVALID_CUSTOMER_LOCATION", message: "Customer location description is invalid." } };
      return { ok: true, value: { organizationId: request.organizationId, registrationId: request.registrationId, customerName: request.customerName.trim(), customerPhone: request.customerPhone.trim(), locationDescription: location.value, latitude: request.latitude, longitude: request.longitude, operationId: request.operationId } };
    }
    function createCustomerRegistration(request) {
      var correlationId = id(), input = customerRegistrationInput(request);
      if (!input.ok) return denied(input, "CREATE_CUSTOMER_REGISTRATION", correlationId, request && request.organizationId);
      var value = input.value, context = contextFor(value.organizationId, "COMPANY_OWNER", false);
      if (!context.ok) return denied(context, "CREATE_CUSTOMER_REGISTRATION", correlationId, value.organizationId);
      if (typeof deps.digest !== "function") return safe("DIGEST_UNAVAILABLE", "Operation could not be safely prepared.", correlationId);
      var digest; try { digest = deps.digest(JSON.stringify(value)); } catch (_) { return safe("DIGEST_UNAVAILABLE", "Operation could not be safely prepared.", correlationId); }
      if (typeof digest !== "string" || !digest) return safe("DIGEST_UNAVAILABLE", "Operation could not be safely prepared.", correlationId);
      var result = deps.idempotency.execute(deps.repository, deps.lockService, { operationId: value.operationId, actorId: context.actorId, organizationId: value.organizationId, operationType: "CREATE_CUSTOMER_REGISTRATION", payloadDigest: digest, correlationId: correlationId }, now(), function () {
        var refreshed = contextFor(value.organizationId, "COMPANY_OWNER", false);
        if (!refreshed.ok) throw new Error("AUTHORIZATION_CHANGED");
        var existing; try { existing = deps.repository.findCustomerRegistration(value.registrationId); } catch (_) { throw new Error("STORAGE_UNAVAILABLE"); }
        if (existing) return { ok: false, error: { code: "REGISTRATION_ID_UNAVAILABLE", message: "Registration ID is already registered or unavailable." } };
        if (!audit(refreshed, "CREATE_CUSTOMER_REGISTRATION", "ATTEMPTED", "", value.operationId, value.registrationId).ok) throw new Error("AUDIT_REQUIRED");
        var timestamp = now();
        var registration = { registrationId: value.registrationId, organizationId: refreshed.organization.organizationId, customerName: value.customerName, customerPhone: value.customerPhone, locationDescription: value.locationDescription, latitude: value.latitude, longitude: value.longitude, status: "REGISTERED", createdAt: timestamp, updatedAt: timestamp, createdBy: refreshed.actorId, operationId: value.operationId };
        try { deps.repository.appendCustomerRegistration(registration); } catch (_) { throw new Error("WRITE_OUTCOME_UNCERTAIN"); }
        if (!audit(refreshed, "CREATE_CUSTOMER_REGISTRATION", "SUCCEEDED", "", value.operationId, value.registrationId).ok) throw new Error("POST_WRITE_AUDIT_UNAVAILABLE");
        return { ok: true, recordRef: value.registrationId, value: registration };
      });
      if (!result.ok) { var err = result.error || {}; if (!audit(context, "CREATE_CUSTOMER_REGISTRATION", "FAILED", err.code || "REQUEST_FAILED", value.operationId, value.registrationId).ok && err.code !== "RECONCILIATION_REQUIRED") return safe("AUDIT_UNAVAILABLE", "Request could not be safely completed.", correlationId); return safe(err.code || "REQUEST_FAILED", err.message || "Request could not be completed.", correlationId); }
      if (result.replayed && !audit(context, "CREATE_CUSTOMER_REGISTRATION_REPLAY", "REPLAYED", "", value.operationId, value.registrationId).ok) return safe("AUDIT_UNAVAILABLE", "Request could not be safely completed.", correlationId);
      return { ok: true, value: result.value, replayed: result.replayed === true, correlationId: correlationId };
    }
    function getCustomerRegistration(request) {
      var correlationId = id(), target = request && request.organizationId, registrationId = request && request.registrationId;
      if (!request || typeof request !== "object" || Array.isArray(request) || Object.keys(request).some(function (key) { return ["organizationId","registrationId"].indexOf(key) < 0; }) || typeof registrationId !== "string" || !REGISTRATION_ID_PATTERN.test(registrationId)) return denied({ error: { code: "INVALID_REQUEST", message: "Request fields are invalid." } }, "READ_CUSTOMER_REGISTRATION", correlationId, target);
      var context = contextFor(target, "COMPANY_OWNER", false);
      if (!context.ok) return denied(context, "READ_CUSTOMER_REGISTRATION", correlationId, target);
      var record; try { record = deps.repository.findCustomerRegistration(registrationId); } catch (_) { return safe("STORAGE_UNAVAILABLE", "The request could not be completed.", correlationId); }
      if (!record || String(record.organizationId) !== String(context.organization.organizationId)) return safe("CUSTOMER_REGISTRATION_NOT_FOUND", "Customer registration could not be found.", correlationId);
      if (!audit(context, "READ_CUSTOMER_REGISTRATION", "SUCCEEDED", "", "", registrationId).ok) return safe("AUDIT_UNAVAILABLE", "Request could not be safely completed.", correlationId);
      return { ok: true, value: record, correlationId: correlationId };
    }
    function listCustomerRegistrations(request) {
      var correlationId = id(), target = request && request.organizationId, limit = request && request.limit !== undefined ? request.limit : 100;
      if (!request || typeof request !== "object" || Array.isArray(request) || Object.keys(request).some(function (key) { return ["organizationId","limit"].indexOf(key) < 0; }) || typeof limit !== "number" || !isFinite(limit) || Math.floor(limit) !== limit || limit < 1 || limit > 200) return denied({ error: { code: "INVALID_REQUEST", message: "Request fields are invalid." } }, "LIST_CUSTOMER_REGISTRATIONS", correlationId, target);
      var context = contextFor(target, "COMPANY_OWNER", false);
      if (!context.ok) return denied(context, "LIST_CUSTOMER_REGISTRATIONS", correlationId, target);
      var records; try { records = deps.repository.findCustomerRegistrationsForOrganization(context.organization.organizationId, limit); } catch (_) { return safe("STORAGE_UNAVAILABLE", "The request could not be completed.", correlationId); }
      if (!Array.isArray(records) || records.some(function (record) { return String(record.organizationId) !== String(context.organization.organizationId); })) return safe("STORAGE_INTEGRITY_ERROR", "Customer registrations could not be safely returned.", correlationId);
      if (!audit(context, "LIST_CUSTOMER_REGISTRATIONS", "SUCCEEDED", "", "", "").ok) return safe("AUDIT_UNAVAILABLE", "Request could not be safely completed.", correlationId);
      return { ok: true, value: records, correlationId: correlationId };
    }

    return Object.freeze({
      getOrganizationSummary: getOrganizationSummary,
      setOrganizationServiceEnabled: setOrganizationServiceEnabled,
      createCollectionSite: createCollectionSite,
      getCollectionSite: getCollectionSite,
      listCollectionSites: listCollectionSites,
      updateCollectionSite: updateCollectionSite,
      deactivateCollectionSite: deactivateCollectionSite,
      recordCollection: recordCollection,
      getCollectionRecord: getCollectionRecord,
      listCollectionRecords: listCollectionRecords,
      recordCollectionHandover: recordCollectionHandover,
      createCustomerRegistration: createCustomerRegistration,
      getCustomerRegistration: getCustomerRegistration,
      listCustomerRegistrations: listCustomerRegistrations
    });
  }
  return Object.freeze({ create: create });
}());