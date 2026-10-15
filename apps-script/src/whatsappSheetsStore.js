/**
 * Durable, provider-independent Google Sheets adapters for WhatsApp registration.
 *
 * Guarantees are bounded: one ScriptLock serializes cooperating executions in this
 * Apps Script project. Sheets writes are not multi-row transactions; uncertain writes
 * are returned as retryable outcomes and must be reconciled by stable IDs.
 */
var ReclaimWhatsAppSheetsStore = (function () {
  "use strict";
  var VERSION = 1;
  var DEFAULT_BATCH_LIMIT = 50;
  var HEADERS = {
    Events: ["schemaVersion", "scopeKey", "eventId", "digest", "status", "claimToken", "claimedAt", "leaseExpiresAt", "attempts", "createdAt", "updatedAt", "completedAt", "resultJson", "lastErrorCode"],
    Sessions: ["schemaVersion", "scopeKey", "organizationId", "senderKey", "sessionJson", "updatedAt", "expiresAt"],
    Registrations: ["schemaVersion", "organizationId", "registrationId", "operationId", "payloadFingerprint", "payloadJson", "status", "createdAt", "updatedAt"],
    Audit: ["schemaVersion", "occurredAt", "kind", "organizationId", "recordKey", "outcome", "diagnosticCode"]
  };
  function fail(code) { var error = new Error(code); error.code = code; throw error; }
  function nonempty(value, max) {
    return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
  }
  function canonical(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    return "{" + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ":" + canonical(value[key]);
    }).join(",") + "}";
  }
  function create(deps) {
    if (!deps || !deps.spreadsheet || typeof deps.spreadsheet.getSheetByName !== "function" ||
        !deps.lockService || typeof deps.lockService.getScriptLock !== "function" ||
        typeof deps.now !== "function" || typeof deps.digest !== "function") {
      fail("STORE_CONFIGURATION_INVALID");
    }
    var timeoutMs = Number(deps.lockTimeoutMs || 5000);
    var leaseMs = Number(deps.claimLeaseMs || 120000);
    var batchLimit = Number(deps.batchLimit || DEFAULT_BATCH_LIMIT);
    if (!(timeoutMs > 0 && leaseMs > 0 && batchLimit > 0 && batchLimit <= 500)) fail("STORE_CONFIGURATION_INVALID");
    var lockDepth = 0;
    function nowMs() {
      var value = deps.now();
      var result = typeof value === "number" ? value : Date.parse(value);
      if (!isFinite(result)) fail("CLOCK_UNAVAILABLE");
      return result;
    }
    function withLock(callback) {
      if (lockDepth > 0) {
        lockDepth++;
        try { return callback(); } finally { lockDepth--; }
      }
      var lock = deps.lockService.getScriptLock();
      var acquired = false;
      try {
        acquired = lock.tryLock(timeoutMs);
        if (!acquired) fail("STORE_LOCK_BUSY");
        lockDepth = 1;
        return callback();
      } finally {
        lockDepth = 0;
        if (acquired) lock.releaseLock();
      }
    }
    function sheet(name) {
      var target = deps.spreadsheet.getSheetByName(name);
      if (!target) fail("SHEET_MISSING_" + name.toUpperCase());
      var expected = HEADERS[name];
      var actual = target.getRange(1, 1, 1, expected.length).getValues()[0];
      if (expected.some(function (field, index) { return actual[index] !== field; })) fail("SCHEMA_MISMATCH_" + name.toUpperCase());
      return target;
    }
    function rows(name) {
      var target = sheet(name);
      var last = target.getLastRow();
      if (last < 2) return [];
      return target.getRange(2, 1, last - 1, HEADERS[name].length).getValues().map(function (values, index) {
        var row = { _row: index + 2 };
        HEADERS[name].forEach(function (key, column) { row[key] = values[column]; });
        return row;
      });
    }
    function write(name, rowNumber, record) {
      var values = HEADERS[name].map(function (key) { return record[key] === undefined ? "" : record[key]; });
      if (rowNumber) sheet(name).getRange(rowNumber, 1, 1, values.length).setValues([values]);
      else sheet(name).appendRow(values);
    }
    function audit(kind, organizationId, recordKey, outcome, diagnosticCode) {
      try {
        var stamp = nowMs();
        write("Audit", 0, { schemaVersion: VERSION, occurredAt: stamp, kind: kind,
          organizationId: organizationId || "", recordKey: recordKey || "",
          outcome: outcome, diagnosticCode: diagnosticCode || "" });
      } catch (_) {
        // Audit is best-effort and never changes the outcome of the primary operation.
      }
    }
    function scope(org, accountScope) {
      if (!nonempty(org, 120)) fail("TENANT_SCOPE_INVALID");
      return org + "|" + (nonempty(accountScope, 160) ? accountScope : "default");
    }
    function eventRow(org, eventId, accountScope) {
      var key = scope(org, accountScope);
      var found = rows("Events").filter(function (row) {
        return row.scopeKey === key && row.eventId === eventId;
      });
      if (found.length > 1) fail("EVENT_LEDGER_DUPLICATE_ROWS");
      return found[0] || null;
    }
    function eventStore(accountScope) {
      return {
        begin: function (eventId, digest, organizationId) {
          if (!nonempty(eventId, 180) || !nonempty(digest, 256)) return { status: "UNAVAILABLE" };
          try { return withLock(function () {
            var existing = eventRow(organizationId, eventId, accountScope);
            var stamp = nowMs();
            if (existing) {
              if (existing.digest !== digest) {
                audit("EVENT", organizationId, eventId, "CONFLICT", "EVENT_ID_CONFLICT");
                return { status: "CONFLICT" };
              }
              if (existing.status === "COMPLETE") return { status: "REPLAY", result: safeJson(existing.resultJson) };
              if (existing.status === "REJECTED") return { status: "REPLAY" };
              if (existing.status === "PROCESSING") {
                if (Number(existing.leaseExpiresAt) > stamp) return { status: "IN_PROGRESS" };
                // An expired lease cannot prove the prior execution stopped. Quarantine
                // rather than steal the claim; reconciliation/manual review is required.
                existing.status = "RECONCILIATION_REQUIRED"; existing.claimToken = "";
                existing.leaseExpiresAt = ""; existing.updatedAt = stamp;
                existing.lastErrorCode = "LEASE_EXPIRED_REVIEW_REQUIRED";
                write("Events", existing._row, existing);
                audit("EVENT", organizationId, eventId, "MANUAL_REVIEW", "LEASE_EXPIRED_REVIEW_REQUIRED");
                return { status: "UNAVAILABLE", code: "RECONCILIATION_REQUIRED" };
              }
              if (existing.status === "RECONCILIATION_REQUIRED" || !["RETRYABLE"].includes(existing.status)) return { status: "UNAVAILABLE" };
              var token = String(deps.idGenerator ? deps.idGenerator("claim") : stamp + "-" + Math.random());
              existing.status = "PROCESSING"; existing.claimToken = token; existing.claimedAt = stamp;
              existing.leaseExpiresAt = stamp + leaseMs; existing.attempts = Number(existing.attempts || 0) + 1;
              existing.updatedAt = stamp; existing.lastErrorCode = "";
              write("Events", existing._row, existing);
              audit("EVENT", organizationId, eventId, "RECOVERED_CLAIM", "");
              return { status: "NEW", claimToken: token };
            }
            var claimToken = String(deps.idGenerator ? deps.idGenerator("claim") : stamp + "-" + Math.random());
            write("Events", 0, { schemaVersion: VERSION, scopeKey: scope(organizationId, accountScope),
              eventId: eventId, digest: digest, status: "PROCESSING", claimToken: claimToken,
              claimedAt: stamp, leaseExpiresAt: stamp + leaseMs, attempts: 1, createdAt: stamp,
              updatedAt: stamp, completedAt: "", resultJson: "", lastErrorCode: "" });
            audit("EVENT", organizationId, eventId, "CLAIMED", "");
            return { status: "NEW", claimToken: claimToken };
          }); } catch (error) {
            audit("EVENT", organizationId, eventId, "ERROR", error.code || "EVENT_STORE_FAILURE");
            return { status: "UNAVAILABLE", code: error.code || "EVENT_STORE_FAILURE" };
          }
        },
        complete: function (eventId, digest, organizationId, result) {
          return withLock(function () {
            var record = eventRow(organizationId, eventId, accountScope);
            if (!record || record.digest !== digest) fail("EVENT_CLAIM_MISMATCH");
            if (record.status === "COMPLETE") {
              if (record.resultJson !== JSON.stringify(result)) fail("EVENT_COMPLETION_CONFLICT");
              return { ok: true, replay: true };
            }
            if (record.status !== "PROCESSING") fail("EVENT_STATE_INVALID");
            var stamp = nowMs();
            record.status = "COMPLETE"; record.updatedAt = stamp; record.completedAt = stamp;
            record.leaseExpiresAt = ""; record.resultJson = JSON.stringify(result); record.lastErrorCode = "";
            write("Events", record._row, record);
            audit("EVENT", organizationId, eventId, "COMPLETE", "");
            return { ok: true };
          });
        },
        release: function (eventId, digest, organizationId, errorCode) {
          return withLock(function () {
            var record = eventRow(organizationId, eventId, accountScope);
            if (!record) return { ok: true, missing: true };
            if (record.digest !== digest) fail("EVENT_CLAIM_MISMATCH");
            if (record.status === "COMPLETE") return { ok: true, completed: true };
            if (record.status !== "PROCESSING") return { ok: true, unchanged: true };
            var stamp = nowMs();
            record.status = "RETRYABLE"; record.claimToken = ""; record.leaseExpiresAt = "";
            record.updatedAt = stamp; record.lastErrorCode = nonempty(errorCode, 80) ? errorCode : "PROCESSING_RETRYABLE";
            write("Events", record._row, record);
            audit("EVENT", organizationId, eventId, "RELEASED", record.lastErrorCode);
            return { ok: true };
          });
        }
      };
    }
    function safeJson(value) {
      if (typeof value !== "string" || !value) return null;
      try { return JSON.parse(value); } catch (_) { return null; }
    }
    function sessionStore(accountScope) {
      function key(org, sender) {
        if (!nonempty(sender, 80)) fail("SENDER_SCOPE_INVALID");
        return { scopeKey: scope(org, accountScope), org: org, sender: sender };
      }
      function find(org, sender) {
        var k = key(org, sender);
        var matches = rows("Sessions").filter(function (row) {
          return row.scopeKey === k.scopeKey && row.organizationId === k.org && row.senderKey === k.sender;
        });
        if (matches.length > 1) fail("SESSION_DUPLICATE_ROWS");
        return matches[0] || null;
      }
      return {
        get: function (org, sender) {
          return withLock(function () {
            var record = find(org, sender);
            if (!record) return null;
            if (Number(record.expiresAt) && Number(record.expiresAt) <= nowMs()) return null;
            if (typeof record.sessionJson !== "string" || !record.sessionJson) return null;
            var value = safeJson(record.sessionJson);
            if (!value) fail("SESSION_JSON_INVALID");
            return value;
          });
        },
        put: function (org, sender, value) {
          if (!value || typeof value !== "object" || Array.isArray(value)) fail("SESSION_INVALID");
          return withLock(function () {
            var k = key(org, sender), stamp = nowMs(), record = find(org, sender);
            var expiresAt = Number(value.expiresAt || 0);
            var output = { schemaVersion: VERSION, scopeKey: k.scopeKey, organizationId: k.org,
              senderKey: k.sender, sessionJson: JSON.stringify(value), updatedAt: stamp, expiresAt: expiresAt };
            write("Sessions", record ? record._row : 0, output);
            audit("SESSION", org, "sender-scoped", "SAVED", "");
            return { ok: true, durable: true };
          });
        },
        remove: function (org, sender) {
          return withLock(function () {
            var record = find(org, sender);
            if (!record) return { ok: true, missing: true };
            // Keep a tombstone rather than deleting data needed for diagnosis.
            var k = key(org, sender), stamp = nowMs();
            record.sessionJson = ""; record.updatedAt = stamp; record.expiresAt = 0;
            write("Sessions", record._row, record);
            audit("SESSION", org, "sender-scoped", "CLEARED", "");
            return { ok: true };
          });
        },
        withSenderLock: function (org, sender, callback) {
          key(org, sender);
          if (typeof callback !== "function") fail("CALLBACK_INVALID");
          return withLock(callback);
        }
      };
    }
    function registrationStore() {
      function matches(request) {
        return rows("Registrations").filter(function (row) {
          return row.organizationId === request.organizationId &&
            (row.registrationId === request.registrationId || row.operationId === request.operationId);
        });
      }
      function fingerprint(request) {
        var payload = { organizationId: request.organizationId, registrationId: request.registrationId,
          operationId: request.operationId, customerName: request.customerName,
          customerPhone: request.customerPhone, locationDescription: request.locationDescription || "",
          latitude: request.latitude, longitude: request.longitude };
        return String(deps.digest(canonical(payload)));
      }
      return {
        create: function (request) {
          var required = request && nonempty(request.organizationId, 120) &&
            nonempty(request.registrationId, 180) && nonempty(request.operationId, 180) &&
            nonempty(request.customerName, 120) && nonempty(request.customerPhone, 80) &&
            typeof request.latitude === "number" && isFinite(request.latitude) && request.latitude >= -90 && request.latitude <= 90 &&
            typeof request.longitude === "number" && isFinite(request.longitude) && request.longitude >= -180 && request.longitude <= 180;
          if (!required) return { ok: false, durable: false, code: "REGISTRATION_INVALID" };
          try { return withLock(function () {
            var mark = fingerprint(request);
            var existing = matches(request);
            if (existing.length > 1) {
              audit("REGISTRATION", request.organizationId, request.operationId, "MANUAL_REVIEW", "DUPLICATE_ROWS");
              return { ok: false, durable: false, code: "REGISTRATION_DUPLICATE_ROWS", retryable: false };
            }
            if (existing.length === 1) {
              if (existing[0].payloadFingerprint !== mark || existing[0].status !== "SUCCEEDED") {
                audit("REGISTRATION", request.organizationId, request.operationId, "CONFLICT", "IDEMPOTENCY_CONFLICT");
                return { ok: false, durable: false, code: "IDEMPOTENCY_CONFLICT", retryable: false };
              }
              audit("REGISTRATION", request.organizationId, request.operationId, "IDEMPOTENT_REUSE", "");
              return { ok: true, durable: true, registrationId: request.registrationId, replay: true };
            }
            var stamp = nowMs();
            var payload = { organizationId: request.organizationId, registrationId: request.registrationId,
              operationId: request.operationId, customerName: request.customerName,
              customerPhone: request.customerPhone, locationDescription: request.locationDescription || "",
              latitude: request.latitude, longitude: request.longitude };
            write("Registrations", 0, { schemaVersion: VERSION, organizationId: request.organizationId,
              registrationId: request.registrationId, operationId: request.operationId, payloadFingerprint: mark,
              payloadJson: JSON.stringify(payload), status: "SUCCEEDED", createdAt: stamp, updatedAt: stamp });
            // Re-read by stable identifiers before reporting durable success.
            var verify = matches(request);
            if (verify.length !== 1 || verify[0].payloadFingerprint !== mark || verify[0].status !== "SUCCEEDED") {
              audit("REGISTRATION", request.organizationId, request.operationId, "UNCERTAIN", "POST_WRITE_VERIFY_FAILED");
              return { ok: false, durable: false, code: "PERSISTENCE_UNCERTAIN", retryable: true };
            }
            audit("REGISTRATION", request.organizationId, request.operationId, "CREATED", "");
            return { ok: true, durable: true, registrationId: request.registrationId, replay: false };
          }); } catch (error) {
            audit("REGISTRATION", request.organizationId, request.operationId, "UNCERTAIN", error.code || "PERSISTENCE_UNCERTAIN");
            return { ok: false, durable: false, code: error.code || "PERSISTENCE_UNCERTAIN", retryable: true };
          }
        }
      };
    }
    function initialize() {
      return withLock(function () {
        Object.keys(HEADERS).forEach(function (name) {
          var target = deps.spreadsheet.getSheetByName(name);
          if (!target) target = deps.spreadsheet.insertSheet(name);
          var current = target.getRange(1, 1, 1, HEADERS[name].length).getValues()[0];
          var empty = current.every(function (cell) { return cell === "" || cell === null; });
          if (empty && target.getLastRow() <= 1) target.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]);
          else if (HEADERS[name].some(function (field, index) { return current[index] !== field; })) fail("SCHEMA_MISMATCH_" + name.toUpperCase());
        });
        return { ok: true, schemaVersion: VERSION, tabs: Object.keys(HEADERS) };
      });
    }
    function reconcile(options) {
      options = options || {};
      var limit = Number(options.limit || batchLimit);
      if (!(limit > 0 && limit <= batchLimit)) fail("RECONCILIATION_LIMIT_INVALID");
      return withLock(function () {
        var stamp = nowMs(), inspected = 0, released = 0, review = 0;
        var candidates = rows("Events").filter(function (record) {
          return record.status === "PROCESSING" && Number(record.leaseExpiresAt) > 0 && Number(record.leaseExpiresAt) <= stamp;
        }).slice(0, limit);
        candidates.forEach(function (record) {
          inspected++;
          // Expiry is not proof the prior execution stopped. Quarantine the claim;
          // never automatically replay an event whose side effects are uncertain.
          record.status = "RECONCILIATION_REQUIRED"; record.claimToken = ""; record.leaseExpiresAt = "";
          record.updatedAt = stamp; record.lastErrorCode = "LEASE_EXPIRED_REVIEW_REQUIRED";
          write("Events", record._row, record);
          audit("RECONCILIATION", "", record.eventId, "MANUAL_REVIEW", "LEASE_EXPIRED_REVIEW_REQUIRED");
          review++;
        });
        var duplicateOps = {};
        var remaining = Math.max(0, limit - inspected);
        rows("Registrations").slice(0, remaining).forEach(function (record) {
          inspected++;
          var key = record.organizationId + "|" + record.operationId;
          duplicateOps[key] = (duplicateOps[key] || 0) + 1;
        });
        Object.keys(duplicateOps).forEach(function (key) {
          if (duplicateOps[key] > 1) {
            review++;
            audit("RECONCILIATION", "", key, "MANUAL_REVIEW", "DUPLICATE_OPERATION_ROWS");
          }
        });
        return { ok: true, inspected: inspected, releasedExpiredClaims: released, manualReview: review, limit: limit };
      });
    }
    return Object.freeze({ initialize: initialize, eventStore: eventStore,
      sessionStore: sessionStore, registrationStore: registrationStore, reconcile: reconcile,
      schema: function () { return JSON.parse(JSON.stringify(HEADERS)); } });
  }
  return Object.freeze({ create: create });
}());
