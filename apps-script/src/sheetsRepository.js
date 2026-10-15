/** Google Sheets adapter. Never return raw sheet/range handles from public service methods. */
var ReclaimSheetsRepository = (function () {
  "use strict";
  var SCHEMAS = Object.freeze({
    Organizations: ["organizationId","organizationName","country","currency","status","serviceEnabled","configVersion","createdAt","updatedAt"],
    Memberships: ["membershipId","organizationId","actorId","role","status","createdAt","updatedAt","revokedAt"],
    AuditEvents: ["eventId","timestamp","actorId","organizationId","action","outcome","reasonCode","operationId","recordRef","configVersion"],
    Idempotency: ["operationId","actorId","organizationId","operationType","payloadDigest","status","resultRef","createdAt","updatedAt"]
  });
  function safeText(value) {
    if (typeof value !== "string") return value;
    return /^[=+@\-]/.test(value) ? "'" + value : value;
  }
  function create(spreadsheetService, properties) {
    function getSheet(name) {
      if (!Object.prototype.hasOwnProperty.call(SCHEMAS, name)) throw new Error("SHEET_NOT_ALLOWED");
      var id = properties.getProperty("RECLAIM_SPREADSHEET_ID");
      if (!id) throw new Error("SPREADSHEET_NOT_CONFIGURED");
      var spreadsheet = spreadsheetService.openById(id);
      var sheet = spreadsheet.getSheetByName(name);
      if (!sheet) throw new Error("REQUIRED_SHEET_MISSING");
      var width = SCHEMAS[name].length;
      var actual = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
      if (SCHEMAS[name].some(function (h, i) { return actual[i] !== h; })) throw new Error("SCHEMA_MISMATCH");
      return sheet;
    }
    function rows(name) {
      var sheet = getSheet(name), last = sheet.getLastRow();
      if (last < 2) return [];
      var values = sheet.getRange(2, 1, last - 1, SCHEMAS[name].length).getValues();
      return values.map(function (row) {
        var out = {};
        SCHEMAS[name].forEach(function (key, i) { out[key] = row[i]; });
        return out;
      });
    }
    function findBy(name, field, value) {
      if (SCHEMAS[name].indexOf(field) < 0) throw new Error("FIELD_NOT_ALLOWED");
      var found = rows(name).filter(function (r) { return String(r[field]) === String(value); });
      if (found.length > 1) throw new Error("AMBIGUOUS_RECORD");
      return found.length ? found[0] : null;
    }
    function append(name, record) {
      var sheet = getSheet(name), schema = SCHEMAS[name];
      var row = schema.map(function (key) { return safeText(record[key] === undefined ? "" : String(record[key])); });
      sheet.appendRow(row);
      return { ok: true };
    }
    return Object.freeze({
      findOrganization: function (id) { return findBy("Organizations", "organizationId", id); },
      findMembership: function (actorId, organizationId) {
        var found = rows("Memberships").filter(function (r) {
          return String(r.actorId).toLowerCase() === String(actorId).toLowerCase() &&
            String(r.organizationId) === String(organizationId) && r.status === "ACTIVE";
        });
        if (found.length > 1) throw new Error("AMBIGUOUS_MEMBERSHIP");
        return found.length ? found[0] : null;
      },
      findOperation: function (id) { return findBy("Idempotency", "operationId", id); },
      appendAudit: function (event) { return append("AuditEvents", event); },
      appendIdempotency: function (record) { return append("Idempotency", record); },
      schemas: SCHEMAS
    });
  }
  return Object.freeze({ create: create, safeText: safeText, schemas: SCHEMAS });
}());