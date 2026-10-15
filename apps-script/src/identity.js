/** Apps Script identity adapter. Availability must be verified for the chosen deployment. */
var ReclaimIdentity = (function () {
  "use strict";
  function resolveCurrentActor(sessionService) {
    if (!sessionService || typeof sessionService.getActiveUser !== "function") {
      return { ok: false, error: { code: "IDENTITY_UNAVAILABLE", message: "Identity could not be established." } };
    }
    try {
      var user = sessionService.getActiveUser();
      var email = user && typeof user.getEmail === "function" ? user.getEmail() : "";
      if (typeof email !== "string" || !email.trim()) {
        return { ok: false, error: { code: "IDENTITY_UNAVAILABLE", message: "Identity could not be established." } };
      }
      return { ok: true, actorId: email.trim().toLowerCase() };
    } catch (_) {
      return { ok: false, error: { code: "IDENTITY_UNAVAILABLE", message: "Identity could not be established." } };
    }
  }
  return Object.freeze({ resolveCurrentActor: resolveCurrentActor });
}());