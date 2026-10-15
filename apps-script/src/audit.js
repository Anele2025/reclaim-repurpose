/** Safe structured audit events. Never include secrets, raw requests, or participant records. */
var ReclaimAudit = (function () {
  "use strict";
  var REQUIRED = ["eventId", "timestamp", "action", "outcome"];
  function record(repository, event) {
    if (!repository || typeof repository.appendAudit !== "function" || !event || typeof event !== "object") {
      return { ok: false, error: { code: "AUDIT_UNAVAILABLE", message: "Required audit record could not be persisted." } };
    }
    for (var i = 0; i < REQUIRED.length; i += 1) {
      if (typeof event[REQUIRED[i]] !== "string" || !event[REQUIRED[i]].trim()) {
        return { ok: false, error: { code: "AUDIT_EVENT_INVALID", message: "Required audit event fields are missing." } };
      }
    }
    var safe = {
      eventId: event.eventId, timestamp: event.timestamp, actorId: event.actorId || "unknown",
      organizationId: event.organizationId || "", action: event.action,
      outcome: event.outcome, reasonCode: event.reasonCode || "",
      operationId: event.operationId || "", recordRef: event.recordRef || "",
      configVersion: event.configVersion || ""
    };
    try {
      repository.appendAudit(safe);
      return { ok: true };
    } catch (_) {
      return { ok: false, error: { code: "AUDIT_UNAVAILABLE", message: "Required audit record could not be persisted." } };
    }
  }
  return Object.freeze({ record: record });
}());