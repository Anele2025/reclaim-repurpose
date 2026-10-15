/** Durable idempotency adapter. Caller must hold a ScriptLock around reserve + mutation. */
var ReclaimIdempotency = (function () {
  "use strict";
  function reserve(repository, lockService, input, now) {
    if (!input || !input.operationId || !input.actorId || !input.organizationId || !input.operationType || !input.payloadDigest) {
      return { ok: false, error: { code: "INVALID_IDEMPOTENCY_REQUEST", message: "Required operation metadata is missing." } };
    }
    var lock = lockService.getScriptLock();
    if (!lock.tryLock(10000)) return { ok: false, error: { code: "LOCK_UNAVAILABLE", message: "Operation could not be safely reserved; retry later." } };
    try {
      var existing = repository.findOperation(input.operationId);
      if (existing) {
        var same = String(existing.actorId) === input.actorId &&
          String(existing.organizationId) === input.organizationId &&
          String(existing.operationType) === input.operationType &&
          String(existing.payloadDigest) === input.payloadDigest;
        return same
          ? { ok: false, error: { code: "OPERATION_ALREADY_EXISTS", message: "Operation already exists; reconcile its recorded status before retrying." }, existingStatus: existing.status }
          : { ok: false, error: { code: "IDEMPOTENCY_CONFLICT", message: "Operation ID was previously used for different operation data." } };
      }
      repository.appendIdempotency({
        operationId: input.operationId, actorId: input.actorId, organizationId: input.organizationId,
        operationType: input.operationType, payloadDigest: input.payloadDigest, status: "PROCESSING",
        resultRef: "", createdAt: now, updatedAt: now
      });
      return { ok: true, status: "PROCESSING" };
    } catch (_) {
      return { ok: false, error: { code: "IDEMPOTENCY_STORE_UNAVAILABLE", message: "Operation could not be safely reserved." } };
    } finally {
      lock.releaseLock();
    }
  }
  return Object.freeze({ reserve: reserve });
}());