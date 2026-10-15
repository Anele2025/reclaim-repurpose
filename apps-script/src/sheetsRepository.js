/** Allow-listed Google Sheets adapter. Callers never receive raw sheets or ranges. */
var ReclaimSheetsRepository = (function () {
  "use strict";
  var SCHEMAS = Object.freeze({
    Organizations: ["organizationId","organizationName","country","currency","status","serviceEnabled","configVersion","createdAt","updatedAt"],
    Memberships: ["membershipId","organizationId","actorId","role","status","createdAt","updatedAt","revokedAt"],
    AuditEvents: ["eventId","timestamp","actorId","organizationId","action","outcome","reasonCode","operationId","recordRef","configVersion"],
    Idempotency: ["operationId","actorId","organizationId","operationType","payloadDigest","status","resultRef","createdAt","updatedAt","resultJson","correlationId"],
    CollectionSites: ["siteId","organizationId","siteName","country","locationDescription","status","createdAt","updatedAt","createdBy","updatedBy"],
    CollectionRecords: ["collectionId","organizationId","siteId","collectedAt","materialCategory","quantity","unit","collectorRef","destinationPartnerId","handoverRef","evidenceRef","status","createdAt","updatedAt","createdBy","operationId"],
    CustomerRegistrations: ["registrationId","organizationId","customerName","customerPhone","locationDescription","latitude","longitude","status","createdAt","updatedAt","createdBy","operationId"]
  });
  var STABLE_IDS = Object.freeze({
    Organizations: "organizationId", Memberships: "membershipId",
    AuditEvents: "eventId", Idempotency: "operationId", CollectionSites: "siteId", CollectionRecords: "collectionId", CustomerRegistrations: "registrationId"
  });
  function safeText(value) {
    if (typeof value !== "string") return value;
    return /^\s*[=+\-@]/.test(value) ? "'" + value : value;
  }
  function create(spreadsheetService, properties) {
    function getSheet(name) {
      if (!Object.prototype.hasOwnProperty.call(SCHEMAS, name)) throw new Error("SHEET_NOT_ALLOWED");
      var id = properties && properties.getProperty("RECLAIM_SPREADSHEET_ID");
      if (typeof id !== "string" || !id.trim()) throw new Error("SPREADSHEET_NOT_CONFIGURED");
      var spreadsheet = spreadsheetService.openById(id);
      var sheet = spreadsheet.getSheetByName(name);
      if (!sheet) throw new Error("REQUIRED_SHEET_MISSING");
      var width = SCHEMAS[name].length;
      if (sheet.getLastColumn() < width) throw new Error("SCHEMA_MISMATCH");
      var actual = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
      if (SCHEMAS[name].some(function (h, i) { return actual[i] !== h; })) throw new Error("SCHEMA_MISMATCH");
      if (sheet.getLastColumn() > width) throw new Error("UNEXPECTED_SCHEMA_COLUMNS");
      return sheet;
    }
    function rowsWithNumbers(name) {
      var sheet = getSheet(name), last = sheet.getLastRow();
      if (last < 2) return [];
      var values = sheet.getRange(2, 1, last - 1, SCHEMAS[name].length).getValues();
      return values.map(function (row, offset) {
        var record = {};
        SCHEMAS[name].forEach(function (key, i) { record[key] = row[i]; });
        if (name === "CustomerRegistrations" && (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(String(record.registrationId)) || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(String(record.organizationId)) || typeof record.customerName !== "string" || !record.customerName.trim() || record.customerName.length > 120 || typeof record.customerPhone !== "string" || !record.customerPhone.trim() || record.customerPhone.length > 32 || typeof record.locationDescription !== "string" || record.locationDescription.length > 240 || typeof record.latitude !== "number" || !isFinite(record.latitude) || record.latitude < -90 || record.latitude > 90 || typeof record.longitude !== "number" || !isFinite(record.longitude) || record.longitude < -180 || record.longitude > 180 || record.status !== "REGISTERED" || typeof record.createdAt !== "string" || !record.createdAt || typeof record.updatedAt !== "string" || !record.updatedAt)) throw new Error("PERSISTED_CUSTOMER_REGISTRATION_INVALID");
        if (name === "CollectionSites" && (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(String(record.siteId)) || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(String(record.organizationId)) || typeof record.siteName !== "string" || !record.siteName.trim() || record.siteName.length > 120 || ["Botswana","Eswatini"].indexOf(String(record.country)) < 0 || ["ACTIVE","INACTIVE"].indexOf(String(record.status)) < 0 || typeof record.locationDescription !== "string" || record.locationDescription.length > 240 || typeof record.createdAt !== "string" || !record.createdAt || typeof record.updatedAt !== "string" || !record.updatedAt)) throw new Error("PERSISTED_SITE_INVALID");
        return { record: record, rowNumber: offset + 2 };
      });
    }
    function rows(name) {
      return rowsWithNumbers(name).map(function (item) { return item.record; });
    }
    function findAll(name, field, value) {
      if (!Object.prototype.hasOwnProperty.call(SCHEMAS, name) || SCHEMAS[name].indexOf(field) < 0) throw new Error("FIELD_NOT_ALLOWED");
      return rows(name).filter(function (record) { return String(record[field]) === String(value); });
    }
    function findUnique(name, field, value) {
      var found = findAll(name, field, value);
      if (found.length > 1) throw new Error("AMBIGUOUS_RECORD");
      return found.length ? found[0] : null;
    }
    function append(name, record) {
      if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("INVALID_RECORD");
      var schema = SCHEMAS[name];
      if (!schema) throw new Error("SHEET_NOT_ALLOWED");
      if (Object.keys(record).some(function (key) { return schema.indexOf(key) < 0; })) throw new Error("FIELD_NOT_ALLOWED");
      var stable = STABLE_IDS[name];
      if (stable && (record[stable] === undefined || record[stable] === null || String(record[stable]) === "")) throw new Error("STABLE_ID_REQUIRED");
      var required = {
        Organizations: ["organizationId","organizationName","country","currency","status","serviceEnabled","configVersion"],
        Memberships: ["membershipId","organizationId","actorId","role","status"],
        AuditEvents: ["eventId","timestamp","action","outcome"],
        Idempotency: ["operationId","actorId","organizationId","operationType","payloadDigest","status","correlationId"],
        CollectionSites: ["siteId","organizationId","siteName","country","status","createdAt","updatedAt","createdBy","updatedBy"],
        CollectionRecords: ["collectionId","organizationId","siteId","collectedAt","materialCategory","quantity","unit","status","createdAt","updatedAt","createdBy","operationId"],
        CustomerRegistrations: ["registrationId","organizationId","customerName","customerPhone","latitude","longitude","status","createdAt","updatedAt","createdBy","operationId"]
      }[name];
      if (required && required.some(function (key) { return record[key] === undefined || record[key] === null || String(record[key]).trim() === ""; })) {
        throw new Error("REQUIRED_FIELD_MISSING");
      }
      if (name === "Organizations") {
        var expectedCurrency = record.country === "Botswana" ? "BWP" : record.country === "Eswatini" ? "SZL" : "";
        if (!expectedCurrency || record.currency !== expectedCurrency) throw new Error("COUNTRY_CURRENCY_MISMATCH");
        if (["PROSPECT","ACTIVE","PAUSED","SUSPENDED","ARCHIVED"].indexOf(record.status) < 0) throw new Error("INVALID_ORGANIZATION_STATUS");
        if (typeof record.serviceEnabled !== "boolean" || !isFinite(Number(record.configVersion)) || Number(record.configVersion) < 1 || Math.floor(Number(record.configVersion)) !== Number(record.configVersion)) throw new Error("INVALID_ORGANIZATION_CONFIGURATION");
      }
      if (name === "Memberships") {
        if (["PLATFORM_ADMIN","COMPANY_OWNER"].indexOf(record.role) < 0) throw new Error("INVALID_MEMBERSHIP_ROLE");
        if (["INVITED","ACTIVE","SUSPENDED","REVOKED"].indexOf(record.status) < 0) throw new Error("INVALID_MEMBERSHIP_STATUS");
        if (record.role === "PLATFORM_ADMIN" && record.organizationId && record.organizationId !== "PLATFORM") throw new Error("INVALID_ADMIN_SCOPE");
      }
      if (name === "Idempotency" && ["PROCESSING","SUCCEEDED","FAILED_RETRYABLE","RECONCILIATION_REQUIRED"].indexOf(record.status) < 0) throw new Error("INVALID_OPERATION_STATUS");
      if (name === "CollectionSites") {
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(String(record.siteId)) || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(String(record.organizationId))) throw new Error("INVALID_SITE_SCOPE");
        if (typeof record.siteName !== "string" || !record.siteName.trim() || record.siteName.trim().length > 120) throw new Error("INVALID_SITE_NAME");
        if (["Botswana","Eswatini"].indexOf(record.country) < 0) throw new Error("UNSUPPORTED_SITE_COUNTRY");
        if (["ACTIVE","INACTIVE"].indexOf(record.status) < 0) throw new Error("INVALID_SITE_STATUS");
        if (typeof record.locationDescription !== "string" || record.locationDescription.length > 240) throw new Error("INVALID_SITE_LOCATION");
        if (typeof record.createdAt !== "string" || !record.createdAt || typeof record.updatedAt !== "string" || !record.updatedAt) throw new Error("INVALID_SITE_TIMESTAMP");
      }
      if (name === "CustomerRegistrations") {
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(String(record.registrationId)) || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(String(record.organizationId))) throw new Error("INVALID_CUSTOMER_REGISTRATION_SCOPE");
        if (typeof record.customerName !== "string" || !record.customerName.trim() || record.customerName.trim().length > 120 || /[\\u0000-\\u001F]/.test(record.customerName)) throw new Error("INVALID_CUSTOMER_NAME");
        if (typeof record.customerPhone !== "string" || !record.customerPhone.trim() || record.customerPhone.length > 32) throw new Error("INVALID_CUSTOMER_PHONE");
        if (typeof record.locationDescription !== "string" || record.locationDescription.length > 240) throw new Error("INVALID_CUSTOMER_LOCATION");
        if (typeof record.latitude !== "number" || !isFinite(record.latitude) || record.latitude < -90 || record.latitude > 90 || typeof record.longitude !== "number" || !isFinite(record.longitude) || record.longitude < -180 || record.longitude > 180) throw new Error("INVALID_CUSTOMER_COORDINATES");
        if (record.status !== "REGISTERED") throw new Error("INVALID_CUSTOMER_REGISTRATION_STATUS");
      }
      if (name === "CollectionRecords") {
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(String(record.organizationId)) || !/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(String(record.siteId))) throw new Error("INVALID_COLLECTION_SCOPE");
        if (typeof record.quantity !== "number" || !isFinite(record.quantity) || record.quantity <= 0) throw new Error("INVALID_COLLECTION_QUANTITY");
        if (["PLASTIC","PAPER","CARDBOARD","GLASS","METAL","ORGANIC","E_WASTE","TEXTILES","MIXED_RECYCLABLES","OTHER"].indexOf(record.materialCategory) < 0) throw new Error("INVALID_MATERIAL_CATEGORY");
        if (["kg","g","tonne","item","bag","litre"].indexOf(record.unit) < 0) throw new Error("INVALID_COLLECTION_UNIT");
        if (["RECORDED","HANDED_OVER"].indexOf(record.status) < 0) throw new Error("INVALID_COLLECTION_STATUS");
      }
      if (name === "AuditEvents" && ["SUCCEEDED","DENIED","ATTEMPTED","FAILED","REPLAYED","RECOVERED"].indexOf(record.outcome) < 0) throw new Error("INVALID_AUDIT_OUTCOME");
      var existing = stable ? findAll(name, stable, record[stable]) : [];
      if (existing.length) throw new Error("DUPLICATE_STABLE_ID");
      var sheet = getSheet(name);
      var row = schema.map(function (key) {
        var value = record[key] === undefined ? "" : record[key];
        if (value === null || ["string","number","boolean"].indexOf(typeof value) >= 0 || value instanceof Date) {
          return safeText(value);
        }
        throw new Error("INVALID_FIELD_TYPE");
      });
      sheet.appendRow(row);
      return { ok: true };
    }
    function updateById(name, id, changes) {
      var stable = STABLE_IDS[name];
      if (!stable) throw new Error("UPDATE_NOT_ALLOWED");
      var sheet = getSheet(name), matches = rowsWithNumbers(name).filter(function (item) {
        return String(item.record[stable]) === String(id);
      });
      if (matches.length > 1) throw new Error("AMBIGUOUS_RECORD");
      if (!matches.length) return null;
      var record = matches[0].record;
      Object.keys(changes || {}).forEach(function (key) {
        if (SCHEMAS[name].indexOf(key) < 0 || key === stable) throw new Error("FIELD_NOT_ALLOWED");
        var value = changes[key];
        if (!(value === null || ["string","number","boolean"].indexOf(typeof value) >= 0 || value instanceof Date)) throw new Error("INVALID_FIELD_TYPE");
        if (key === "status" && name === "Organizations" && ["PROSPECT","ACTIVE","PAUSED","SUSPENDED","ARCHIVED"].indexOf(value) < 0) throw new Error("INVALID_ORGANIZATION_STATUS");
        if (key === "status" && name === "Memberships" && ["INVITED","ACTIVE","SUSPENDED","REVOKED"].indexOf(value) < 0) throw new Error("INVALID_MEMBERSHIP_STATUS");
        if (key === "status" && name === "Idempotency" && ["PROCESSING","SUCCEEDED","FAILED_RETRYABLE","RECONCILIATION_REQUIRED"].indexOf(value) < 0) throw new Error("INVALID_OPERATION_STATUS");
        if (key === "serviceEnabled" && name === "Organizations" && typeof value !== "boolean") throw new Error("INVALID_ORGANIZATION_CONFIGURATION");
        if (name === "CollectionSites" && key === "status" && ["ACTIVE","INACTIVE"].indexOf(value) < 0) throw new Error("INVALID_SITE_STATUS");
        if (name === "CollectionSites" && key === "siteName" && (typeof value !== "string" || !value.trim() || value.trim().length > 120)) throw new Error("INVALID_SITE_NAME");
        if (name === "CollectionSites" && key === "country" && ["Botswana","Eswatini"].indexOf(value) < 0) throw new Error("UNSUPPORTED_SITE_COUNTRY");
        if (name === "CollectionSites" && key === "locationDescription" && (typeof value !== "string" || value.length > 240)) throw new Error("INVALID_SITE_LOCATION");
        if (name === "CollectionRecords" && key === "status" && ["RECORDED","HANDED_OVER"].indexOf(value) < 0) throw new Error("INVALID_COLLECTION_STATUS");
        if (name === "CollectionRecords" && key === "quantity" && (typeof value !== "number" || !isFinite(value) || value <= 0)) throw new Error("INVALID_COLLECTION_QUANTITY");
        record[key] = safeText(value);
      });
      sheet.getRange(matches[0].rowNumber, 1, 1, SCHEMAS[name].length)
        .setValues([SCHEMAS[name].map(function (key) { return record[key]; })]);
      return { ok: true };
    }
    return Object.freeze({
      findOrganization: function (id) { return findUnique("Organizations", "organizationId", id); },
      findMembership: function (actorId, organizationId) {
        var found = rows("Memberships").filter(function (r) {
          return String(r.actorId).toLowerCase() === String(actorId).toLowerCase() &&
            String(r.organizationId) === String(organizationId);
        });
        if (found.length > 1) throw new Error("AMBIGUOUS_MEMBERSHIP");
        return found.length ? found[0] : null;
      },
      findMembershipsForActor: function (actorId) {
        return rows("Memberships").filter(function (r) { return String(r.actorId).toLowerCase() === String(actorId).toLowerCase(); });
      },
      appendOrganization: function (record) { return append("Organizations", record); },
      appendMembership: function (record) { return append("Memberships", record); },
      updateOrganizationServiceEnabled: function (id, enabled, updatedAt) {
        var current = findUnique("Organizations", "organizationId", id);
        if (!current) return null;
        var version = Number(current.configVersion);
        if (!isFinite(version) || version < 0) throw new Error("CONFIG_VERSION_INVALID");
        return updateById("Organizations", id, { serviceEnabled: enabled, updatedAt: updatedAt, configVersion: version + 1 });
      },
      updateMembershipStatus: function (id, status, updatedAt, revokedAt) {
        return updateById("Memberships", id, { status: status, updatedAt: updatedAt, revokedAt: revokedAt || "" });
      },
      findOperation: function (id) { return findUnique("Idempotency", "operationId", id); },
      appendAudit: function (event) { return append("AuditEvents", event); },
      appendIdempotency: function (record) { return append("Idempotency", record); },
      updateOperation: function (id, changes) { return updateById("Idempotency", id, changes); },
      appendCollectionSite: function (record) { return append("CollectionSites", record); },
      findCollectionSite: function (id) { return findUnique("CollectionSites", "siteId", id); },
      findCollectionSitesForOrganization: function (organizationId, limit) {
        var rowsForOrg = findAll("CollectionSites", "organizationId", organizationId);
        rowsForOrg.sort(function (a, b) { return String(a.siteName).localeCompare(String(b.siteName)); });
        return rowsForOrg.slice(0, Math.max(1, Math.min(Number(limit) || 100, 200)));
      },
      updateCollectionSite: function (id, changes) { return updateById("CollectionSites", id, changes); },
      appendCollectionRecord: function (record) { return append("CollectionRecords", record); },
      findCollectionRecord: function (id) { return findUnique("CollectionRecords", "collectionId", id); },
      findCollectionRecordsForOrganization: function (organizationId, limit) {
        var rowsForOrg = findAll("CollectionRecords", "organizationId", organizationId);
        rowsForOrg.sort(function (a, b) { return String(b.collectedAt).localeCompare(String(a.collectedAt)); });
        return rowsForOrg.slice(0, Math.max(1, Math.min(Number(limit) || 100, 200)));
      },
      updateCollectionRecord: function (id, changes) { return updateById("CollectionRecords", id, changes); },
      appendCustomerRegistration: function (record) { return append("CustomerRegistrations", record); },
      findCustomerRegistration: function (id) { return findUnique("CustomerRegistrations", "registrationId", id); },
      findCustomerRegistrationsForOrganization: function (organizationId, limit) {
        var rowsForOrg = findAll("CustomerRegistrations", "organizationId", organizationId);
        rowsForOrg.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
        return rowsForOrg.slice(0, Math.max(1, Math.min(Number(limit) || 100, 200)));
      },
      schemas: SCHEMAS
    });
  }
  return Object.freeze({ create: create, safeText: safeText, schemas: SCHEMAS });
}());