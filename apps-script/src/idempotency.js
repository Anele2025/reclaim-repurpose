/** Recoverable idempotency orchestration. Mutations run while the shared script lock is held. */
var ReclaimIdempotency = (function () {
  "use strict";
  var STATES = Object.freeze(["PROCESSING", "SUCCEEDED", "FAILED_RETRYABLE", "RECONCILIATION_REQUIRED"]);
  function fail(code, message) { return { ok: false, error: { code: code, message: message } }; }
  function execute(repository, lockService, input, now, mutation) {
    if (!input || !input.operationId || !input.actorId || !input.organizationId ||
        !input.operationType || !input.payloadDigest || !input.correlationId ||
        typeof mutation !== "function") {
      return fail("INVALID_IDEMPOTENCY_REQUEST", "Required operation metadata is missing.");
    }
    var lock;
    try { lock = lockService.getScriptLock(); }
    catch (_) { return fail("LOCK_UNAVAILABLE", "Operation could not be safely reserved; retry later."); }
    var acquired = false;
    try { acquired = lock.tryLock(10000); } catch (_) { acquired = false; }
    if (!acquired) return fail("LOCK_UNAVAILABLE", "Operation could not be safely reserved; retry later.");
    var reserved = false;
    try {
      var operation = repository.findOperation(input.operationId);
      if (operation) {
        var same = String(operation.actorId) === input.actorId &&
          String(operation.organizationId) === input.organizationId &&
          String(operation.operationType) === input.operationType &&
          String(operation.payloadDigest) === input.payloadDigest;
        if (!same) return fail("IDEMPOTENCY_CONFLICT", "Operation ID was previously used for different operation data.");
        if (operation.status === "SUCCEEDED") {
          try { return { ok: true, replayed: true, value: JSON.parse(String(operation.resultJson || "null")), correlationId: input.correlationId }; }
          catch (_) { return fail("RECONCILIATION_REQUIRED", "Stored operation result is unreadable; do not repeat the mutation."); }
        }
        if (STATES.indexOf(String(operation.status)) < 0 || operation.status === "PROCESSING" ||
            operation.status === "RECONCILIATION_REQUIRED") {
          return fail("RECONCILIATION_REQUIRED", "Operation outcome is not safely replayable; reconcile its recorded status first.");
        }
        return fail("RETRY_REQUIRES_NEW_OPERATION", "A failed operation is not replayed. Confirm it had no side effects before creating a new operation ID.");
      }
      repository.appendIdempotency({
        operationId: input.operationId, actorId: input.actorId, organizationId: input.organizationId,
        operationType: input.operationType, payloadDigest: input.payloadDigest,
        status: "PROCESSING", resultRef: "", resultJson: "", correlationId: input.correlationId,
        createdAt: now, updatedAt: now
      });
      reserved = true;
      var result = mutation();
      if (!result || result.ok !== true) {
        repository.updateOperation(input.operationId, {
          status: "FAILED_RETRYABLE", resultRef: "", resultJson: "", updatedAt: now
        });
        return result || fail("MUTATION_FAILED", "Operation did not complete.");
      }
      repository.updateOperation(input.operationId, {
        status: "SUCCEEDED", resultRef: String(result.recordRef || ""),
        resultJson: JSON.stringify(result.value === undefined ? null : result.value), updatedAt: now
      });
      return { ok: true, replayed: false, value: result.value, correlationId: input.correlationId };
    } catch (_) {
      if (reserved) {
        try {
          repository.updateOperation(input.operationId, {
            status: "RECONCILIATION_REQUIRED", resultRef: "", resultJson: "", updatedAt: now
          });
        } catch (__) { /* A PROCESSING row is intentionally a fail-closed recovery signal. */ }
      }
      return fail("RECONCILIATION_REQUIRED", "The operation outcome is uncertain; do not retry until the recorded state is reconciled.");
    } finally {
      try { lock.releaseLock(); } catch (_) { /* No further action is safe if release fails. */ }
    }
  }
  return Object.freeze({ execute: execute, states: STATES });
}());