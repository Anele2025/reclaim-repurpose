/** Allow-listed Google Sheets adapter. Callers never receive raw sheets or ranges. */
var ReclaimSheetsRepository = (function () {
  "use strict";
  var SCHEMAS = Object.freeze({
    Organizations: ["organizationId","organizationName","country","currency","status","serviceEnabled","configVersion","createdAt","updatedAt"],
    Memberships: ["membershipId","organizationId","actorId","role","status","createdAt","updatedAt","revokedAt"],
    AuditEvents: ["eventId","timestamp","actorId","organizationId","action","outcome","reasonCode","operationId","recordRef","configVersion"],
    Idempotency: ["operationId","actorId","organizationId","operationType","payloadDigest","status","resultRef","createdAt","updatedAt","resultJson","correlationId"]
  });
  var STABLE_IDS = Object.freeze({
    Organizations: "organizationId", Memberships: "membershipId",
    AuditEvents: "eventId", Idempotency: "operationId"
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
        Idempotency: ["operationId","actorId","organizationId","operationType","payloadDigest","status","correlationId"]
      }[name];
      if (required && required.some(function (key) { return record[key] === undefined || record[key] === null || String(record[key]).trim() === ""; })) {
        throw new Error("REQUIRED_FIELD_MISSING");
      }
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
      schemas: SCHEMAS
    });
  }
  return Object.freeze({ create: create, safeText: safeText, schemas: SCHEMAS });
}());