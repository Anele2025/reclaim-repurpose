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
        var timestamp = now();
        var record = {
          collectionId: collectionId, organizationId: value.organizationId, siteId: value.siteId,
          collectedAt: value.collectedAt, materialCategory: value.materialCategory, quantity: value.quantity,
          unit: value.unit, collectorRef: value.collectorRef, destinationPartnerId: value.destinationPartnerId,
          handoverRef: value.handoverRef, evidenceRef: value.evidenceRef,
          status: value.handoverRef && value.destinationPartnerId ? "HANDED_OVER" : "RECORDED",
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
      if (!result.ok) return safe(result.error && result.error.code || "REQUEST_FAILED", result.error && result.error.message || "Request could not be completed.", correlationId);
      if (result.replayed && !audit(context, "RECORD_COLLECTION_HANDOVER_REPLAY", "REPLAYED", "", request.operationId, request.collectionId).ok) return safe("AUDIT_UNAVAILABLE", "Request could not be safely completed.", correlationId);
      return { ok: true, value: result.value, replayed: result.replayed === true, correlationId: correlationId };
    }

    return Object.freeze({
      getOrganizationSummary: getOrganizationSummary,
      setOrganizationServiceEnabled: setOrganizationServiceEnabled,
      recordCollection: recordCollection,
      getCollectionRecord: getCollectionRecord,
      listCollectionRecords: listCollectionRecords,
      recordCollectionHandover: recordCollectionHandover
    });
  }
  return Object.freeze({ create: create });
}());