/**
 * Pure Stage 5.1 validation rules shared by Apps Script V8 and local Node tests.
 * This module does NOT authenticate callers or query Google services.
 */
var ReclaimValidation = (function () {
  "use strict";

  var COUNTRIES = Object.freeze({ Botswana: "BWP", Eswatini: "SZL" });
  var ORGANIZATION_STATUSES = Object.freeze(["PROSPECT", "ACTIVE", "PAUSED", "SUSPENDED", "ARCHIVED"]);
  var MEMBERSHIP_STATUSES = Object.freeze(["INVITED", "ACTIVE", "SUSPENDED", "REVOKED"]);
  var OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
  var ORGANIZATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;

  function failure(code, field, reason) {
    return { ok: false, error: { code: code, field: field, reason: reason } };
  }

  function validateOrganization(record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return failure("INVALID_RECORD", "organization", "Expected an organization object.");
    }
    var required = ["organizationId", "organizationName", "country", "status"];
    for (var i = 0; i < required.length; i += 1) {
      var key = required[i];
      if (typeof record[key] !== "string" || record[key].trim() === "") {
        return failure("REQUIRED_FIELD", key, "A non-empty value is required.");
      }
    }
    if (!ORGANIZATION_ID_PATTERN.test(record.organizationId)) {
      return failure("INVALID_ORGANIZATION_ID", "organizationId", "Use 3–64 safe letters, numbers, underscores or hyphens.");
    }
    if (record.organizationName.trim().length > 160) {
      return failure("INVALID_ORGANIZATION_NAME", "organizationName", "Name must be 160 characters or fewer.");
    }
    if (!Object.prototype.hasOwnProperty.call(COUNTRIES, record.country)) {
      return failure("UNSUPPORTED_COUNTRY", "country", "Country must be Botswana or Eswatini.");
    }
    if (ORGANIZATION_STATUSES.indexOf(record.status) === -1) {
      return failure("INVALID_STATUS", "status", "Organization status is not allowed.");
    }
    if (record.currency !== undefined && record.currency !== COUNTRIES[record.country]) {
      return failure("COUNTRY_CURRENCY_MISMATCH", "currency", "Currency does not match the organization's country.");
    }
    return { ok: true, value: {
      organizationId: record.organizationId,
      organizationName: record.organizationName.trim(),
      country: record.country,
      currency: COUNTRIES[record.country],
      status: record.status
    } };
  }

  function validateMoney(country, currency, amount) {
    if (!Object.prototype.hasOwnProperty.call(COUNTRIES, country)) {
      return failure("UNSUPPORTED_COUNTRY", "country", "Country must be Botswana or Eswatini.");
    }
    if (currency !== COUNTRIES[country]) {
      return failure("COUNTRY_CURRENCY_MISMATCH", "currency", "Currency does not match the country.");
    }
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
      return failure("INVALID_AMOUNT", "amount", "Amount must be a finite non-negative number.");
    }
    return { ok: true, value: { country: country, currency: currency, amount: amount } };
  }

  function validateMembershipContext(context, targetOrganizationId, requiredRoles) {
    // Context must be constructed by trusted server-side identity + membership lookup.
    if (!context || context.authenticated !== true ||
        typeof context.actorId !== "string" || context.actorId.trim() === "" ||
        typeof context.organizationId !== "string" || context.organizationId.trim() === "") {
      return failure("AUTHENTICATED_MEMBERSHIP_REQUIRED", "membership", "A verified active membership context is required.");
    }
    if (MEMBERSHIP_STATUSES.indexOf(context.membershipStatus) === -1 ||
        context.membershipStatus !== "ACTIVE") {
      return failure("MEMBERSHIP_INACTIVE", "membership", "Membership is not active.");
    }
    if (typeof targetOrganizationId !== "string" || targetOrganizationId.trim() === "") {
      return failure("ORGANIZATION_REQUIRED", "organizationId", "A target organization is required.");
    }
    var roles = Array.isArray(requiredRoles) ? requiredRoles : [];
    if (context.role !== "PLATFORM_ADMIN" && context.organizationId !== targetOrganizationId) {
      return failure("ORGANIZATION_SCOPE_DENIED", "organizationId", "The requested organization is outside the permitted scope.");
    }
    if (roles.length && roles.indexOf(context.role) === -1 && context.role !== "PLATFORM_ADMIN") {
      return failure("ROLE_DENIED", "role", "The role is not permitted for this action.");
    }
    return { ok: true, value: { actorId: context.actorId, organizationId: targetOrganizationId, role: context.role } };
  }

  function validateOperationId(operationId) {
    if (typeof operationId !== "string" || !OPERATION_ID_PATTERN.test(operationId)) {
      return failure("INVALID_OPERATION_ID", "operationId", "Operation ID must be 8–128 safe characters.");
    }
    return { ok: true, value: operationId };
  }

  function safeError(error) {
    var allowed = {
      INVALID_RECORD: true, REQUIRED_FIELD: true, INVALID_ORGANIZATION_ID: true,
      INVALID_ORGANIZATION_NAME: true, UNSUPPORTED_COUNTRY: true, INVALID_STATUS: true,
      COUNTRY_CURRENCY_MISMATCH: true, INVALID_AMOUNT: true,
      AUTHENTICATED_MEMBERSHIP_REQUIRED: true, MEMBERSHIP_INACTIVE: true,
      ORGANIZATION_REQUIRED: true, ORGANIZATION_SCOPE_DENIED: true, ROLE_DENIED: true,
      INVALID_OPERATION_ID: true, DUPLICATE_OPERATION: true
    };
    var candidate = error && error.error && error.error.code;
    var code = allowed[candidate] ? candidate : "VALIDATION_FAILED";
    var field = error && error.error && typeof error.error.field === "string" ? error.error.field : "request";
    var reason = error && error.error && typeof error.error.reason === "string" ? error.error.reason : "Request could not be validated.";
    return { ok: false, error: { code: code, field: field, reason: reason } };
  }

  // Test helper only. Production duplicate detection needs a durable, atomic server-side store.
  function createTestOperationRegistry() {
    var seen = Object.create(null);
    return {
      reserve: function (operationId) {
        var valid = validateOperationId(operationId);
        if (!valid.ok) return valid;
        if (seen[operationId]) return failure("DUPLICATE_OPERATION", "operationId", "Operation ID has already been used.");
        seen[operationId] = true;
        return { ok: true, value: operationId };
      }
    };
  }

  return Object.freeze({
    validateOrganization: validateOrganization,
    validateMoney: validateMoney,
    validateMembershipContext: validateMembershipContext,
    validateOperationId: validateOperationId,
    safeError: safeError,
    createTestOperationRegistry: createTestOperationRegistry,
    countries: COUNTRIES,
    organizationStatuses: ORGANIZATION_STATUSES
  });
}());
