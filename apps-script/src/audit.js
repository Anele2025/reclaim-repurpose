var ReclaimAudit = (function () {
  "use strict";
  function record(repository, event) {
    var safe = {
      eventId: event.eventId, timestamp: event.timestamp, actorId: event.actorId || "unknown",
      organizationId: event.organizationId || "", action: event.action,
      outcome: event.outcome, reasonCode: event.reasonCode || "",
      operationId: event.operationId || "", recordRef: event.recordRef || "",
      configVersion: event.configVersion || ""
    };
    try { repository.appendAudit(safe); return { ok: true }; }
    catch (_) { return { ok: false, error: { code: "AUDIT_UNAVAILABLE", message: "Required audit record could not be persisted." } }; }
  }
  return Object.freeze({ record: record });
}());