/**
 * Provider-independent WhatsApp registration workflow.
 *
 * This module deliberately exposes no doPost/doGet endpoint and implements no
 * provider signature algorithm. A provider adapter must authenticate the raw
 * request, parse its documented payload, and resolve a trusted company route.
 * Missing adapters fail closed. No owner-authenticated entrypoint is called.
 */
var ReclaimWhatsAppRegistration = (function () {
  "use strict";
  var MAX_TEXT = 240;
  var SESSION_TTL_MS = 24 * 60 * 60 * 1000;
  function failure(code, message) {
    return { ok: false, error: { code: code, message: message } };
  }
  function text(value, max) {
    return typeof value === "string" && value.trim().length > 0 &&
      value.trim().length <= (max || MAX_TEXT) ? value.trim() : "";
  }
  function coordinates(lat, lon) {
    return typeof lat === "number" && typeof lon === "number" &&
      isFinite(lat) && isFinite(lon) && lat >= -90 && lat <= 90 &&
      lon >= -180 && lon <= 180;
  }
  function validEvent(event) {
    if (!event || typeof event !== "object" || Array.isArray(event)) return false;
    if (!text(event.eventId, 180) || !text(event.senderId, 80)) return false;
    if (event.type === "text") return typeof event.text === "string" && event.text.length <= MAX_TEXT;
    if (event.type === "location") return coordinates(event.latitude, event.longitude) &&
      (event.locationDescription === undefined || typeof event.locationDescription === "string");
    return false;
  }
  function create(deps) {
    function ready() {
      return !!deps && typeof deps.verifyWebhook === "function" &&
        typeof deps.parseWebhook === "function" &&
        typeof deps.resolveOrganization === "function" &&
        typeof deps.digestEvent === "function" &&
        deps.eventStore && typeof deps.eventStore.begin === "function" &&
        typeof deps.eventStore.complete === "function" &&
        typeof deps.eventStore.release === "function" &&
        deps.sessionStore && typeof deps.sessionStore.get === "function" &&
        typeof deps.sessionStore.put === "function" &&
        typeof deps.sessionStore.withSenderLock === "function" &&
        typeof deps.createRegistration === "function" &&
        typeof deps.now === "function" && typeof deps.idGenerator === "function";
    }
    function response(ok, code, message, extra) {
      var result = { ok: ok, code: code, message: message };
      if (extra) Object.keys(extra).forEach(function (key) { result[key] = extra[key]; });
      return result;
    }
    function nextMessage(event, session, organizationId, nowMs) {
      // Persist the event marker with each state transition. If the event store
      // completion fails after a session write, a retry can detect the transition.
      function persistSession(value) {
        value.lastProcessedEventId = event.eventId;
        deps.sessionStore.put(organizationId, event.senderId, value);
      }
      var incoming = event.type === "text" ? text(event.text, MAX_TEXT) : "";
      if (session && session.expiresAt && nowMs > session.expiresAt) session = null;
      if (!session) {
        session = { step: "NAME", createdAt: nowMs, updatedAt: nowMs,
          expiresAt: nowMs + SESSION_TTL_MS, customerPhone: event.senderId };
        persistSession(session);
        return response(true, "CONTINUE", "Welcome to waste-collection registration. What is your full name?");
      }
      session.updatedAt = nowMs;
      session.expiresAt = nowMs + SESSION_TTL_MS;
      if (session.step === "NAME") {
        if (!incoming || /^(cancel|stop)$/i.test(incoming)) {
          if (/^(cancel|stop)$/i.test(incoming)) {
            deps.sessionStore.remove && deps.sessionStore.remove(organizationId, event.senderId);
            return response(true, "CANCELLED", "Registration cancelled. Message us again whenever you are ready.");
          }
          return response(true, "CONTINUE", "Please send your name (1–120 characters).");
        }
        if (incoming.length > 120) return response(true, "CONTINUE", "That name is too long. Please send a name of at most 120 characters.");
        session.customerName = incoming;
        session.step = "LOCATION";
        deps.sessionStore.put(organizationId, event.senderId, session);
        return response(true, "CONTINUE", "Thanks. Please share your location using WhatsApp's location attachment. A text address alone is not enough to register; you may also send a short address description.");
      }
      if (session.step === "LOCATION") {
        if (event.type === "text") {
          if (/^(cancel|stop)$/i.test(incoming)) {
            deps.sessionStore.remove && deps.sessionStore.remove(organizationId, event.senderId);
            return response(true, "CANCELLED", "Registration cancelled. Message us again whenever you are ready.");
          }
          if (/^address\s*:/i.test(incoming)) {
            var description = text(incoming.replace(/^address\s*:/i, ""), 240);
            if (!description) return response(true, "CONTINUE", "Please add a short description after 'address:'. You must still share your WhatsApp location.");
            session.locationDescription = description;
            deps.sessionStore.put(organizationId, event.senderId, session);
            return response(true, "CONTINUE", "Address description saved. Now share your WhatsApp location attachment so we can record valid coordinates.");
          }
          return response(true, "CONTINUE", "Please share a WhatsApp location attachment. A text address cannot replace latitude and longitude.");
        }
        if (!coordinates(event.latitude, event.longitude)) return response(true, "CONTINUE", "That location is invalid. Please share your location again.");
        session.latitude = event.latitude;
        session.longitude = event.longitude;
        if (event.locationDescription) session.locationDescription = text(event.locationDescription, 240) || session.locationDescription || "";
        session.step = "CONFIRM";
        deps.sessionStore.put(organizationId, event.senderId, session);
        return response(true, "CONTINUE", "Please confirm your registration: name " + session.customerName +
          "; WhatsApp number " + session.customerPhone + "; coordinates " + session.latitude + ", " + session.longitude +
          (session.locationDescription ? "; location " + session.locationDescription : "") +
          ". Reply CONFIRM to submit or EDIT to start again. This does not schedule a collection.");
      }
      if (session.step === "CONFIRM") {
        if (/^edit$/i.test(incoming)) {
          session = { step: "NAME", createdAt: nowMs, updatedAt: nowMs,
            expiresAt: nowMs + SESSION_TTL_MS, customerPhone: event.senderId };
          deps.sessionStore.put(organizationId, event.senderId, session);
          return response(true, "CONTINUE", "No registration was submitted. Please send your full name again.");
        }
        if (!/^confirm$/i.test(incoming)) return response(true, "CONTINUE", "Reply CONFIRM to submit or EDIT to correct your details.");
        var registrationId = deps.idGenerator("registration");
        var operationId = deps.idGenerator("operation");
        var saved;
        try {
          saved = deps.createRegistration({
            organizationId: organizationId,
            registrationId: registrationId,
            customerName: session.customerName,
            customerPhone: session.customerPhone,
            locationDescription: session.locationDescription || "",
            latitude: session.latitude,
            longitude: session.longitude,
            operationId: operationId
          });
        } catch (_) {
          return response(false, "PERSISTENCE_UNAVAILABLE", "We could not complete registration right now. Please try again later.");
        }
        if (!saved || saved.ok !== true || saved.durable !== true) {
          return response(false, "PERSISTENCE_UNAVAILABLE", "We could not confirm that your registration was saved. Please try again later.");
        }
        deps.sessionStore.remove && deps.sessionStore.remove(organizationId, event.senderId);
        return response(true, "REGISTERED", "Your waste-collection registration was saved. This is not a collection booking; the company may contact you about next steps.", { registrationId: saved.registrationId || registrationId });
      }
      deps.sessionStore.remove && deps.sessionStore.remove(organizationId, event.senderId);
      return response(true, "RESET", "Your registration session was reset. Please send another message to begin again.");
    }
    function handleWebhook(request) {
      if (!ready()) return failure("INTEGRATION_NOT_CONFIGURED", "WhatsApp integration is not configured.");
      var verified = false;
      try { verified = deps.verifyWebhook(request) === true; } catch (_) { verified = false; }
      if (!verified) return failure("WEBHOOK_UNAUTHENTICATED", "Webhook could not be authenticated.");
      var parsed;
      try { parsed = deps.parseWebhook(request); } catch (_) { return failure("INVALID_WEBHOOK", "Webhook payload is invalid."); }
      if (!parsed || !Array.isArray(parsed.events) || parsed.events.length > 20) {
        return failure("INVALID_WEBHOOK", "Webhook payload is invalid.");
      }
      var results = [];
      for (var i = 0; i < parsed.events.length; i++) {
        var event = parsed.events[i];
        if (!validEvent(event)) return failure("INVALID_EVENT", "A supported customer message is required.");
        var organizationId = "";
        try { organizationId = text(deps.resolveOrganization(request), 120); } catch (_) { organizationId = ""; }
        if (!organizationId) return failure("COMPANY_ROUTE_UNAVAILABLE", "This registration channel is not configured for a participating company.");
        var digest;
        try { digest = text(deps.digestEvent(event), 256); } catch (_) { digest = ""; }
        if (!digest) return failure("EVENT_INTEGRITY_UNAVAILABLE", "Message could not be safely processed.");
        var claim;
        try { claim = deps.eventStore.begin(event.eventId, digest, organizationId); } catch (_) { claim = null; }
        if (!claim || !["NEW", "REPLAY", "CONFLICT", "IN_PROGRESS"].includes(claim.status)) {
          return failure("EVENT_STORE_UNAVAILABLE", "Message could not be safely processed; retry later.");
        }
        if (claim.status === "CONFLICT") return failure("EVENT_ID_CONFLICT", "Conflicting duplicate event was rejected.");
        if (claim.status === "REPLAY") {
          results.push(claim.result || response(true, "DUPLICATE_IGNORED", "Duplicate message ignored."));
          continue;
        }
        if (claim.status === "IN_PROGRESS") {
          results.push(response(false, "EVENT_IN_PROGRESS", "This message is still being processed; retry shortly."));
          continue;
        }
        var nowValue;
        try { nowValue = deps.now(); } catch (_) { nowValue = null; }
        var nowMs = typeof nowValue === "number" ? nowValue : Date.parse(nowValue);
        if (!isFinite(nowMs)) {
          try { deps.eventStore.release(event.eventId, digest, organizationId); } catch (_) {}
          return failure("CLOCK_UNAVAILABLE", "Message could not be safely processed.");
        }
        var result;
        try {
          result = deps.sessionStore.withSenderLock(organizationId, event.senderId, function () {
            var session = deps.sessionStore.get(organizationId, event.senderId);
            if (session && session.lastProcessedEventId === event.eventId) {
              return response(true, "RECOVERED_TRANSITION", "Your last message was processed. Please send your next response if needed.");
            }
            return nextMessage(event, session, organizationId, nowMs);
          });
          if (!result || typeof result.ok !== "boolean") throw new Error("INVALID_WORKFLOW_RESULT");
        } catch (_) {
          try { deps.eventStore.release(event.eventId, digest, organizationId); } catch (_) {}
          return failure("SESSION_STORE_UNAVAILABLE", "Registration session is temporarily unavailable; retry later.");
        }
        if (result.ok === false) {
          try { deps.eventStore.release(event.eventId, digest, organizationId); } catch (_) {}
          results.push(result);
          continue;
        }
        try {
          deps.eventStore.complete(event.eventId, digest, organizationId, result);
        } catch (_) {
          // Do not report success while completion is uncertain. The persisted
          // session marker makes a retry safe after a successful state transition.
          return failure("EVENT_STORE_UNAVAILABLE", "Message outcome could not be confirmed; retry later.");
        }
        results.push(result);
      }
      return { ok: true, code: "PROCESSED", results: results };
    }
    return Object.freeze({ handleWebhook: handleWebhook });
  }
  return Object.freeze({ create: create });
}());
