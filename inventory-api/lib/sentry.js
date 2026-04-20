/**
 * inventory-api/lib/sentry.js — Sentry initialisation (CJS, lazy).
 *
 * Add to the server's .env:
 *   SENTRY_DSN=https://YOUR_KEY@oXXXXXX.ingest.sentry.io/XXXXXXX
 *
 * The module is a no-op when SENTRY_DSN is not set, so local dev is unaffected.
 *
 * Install:
 *   cd inventory-api && npm install @sentry/node
 */
'use strict';

let Sentry = null;

function init() {
  if (!process.env.SENTRY_DSN) return;
  try {
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      // Capture 100% of transactions in production; tune down if volume is high
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    });
    console.log('[sentry] Initialised');
  } catch (e) {
    console.warn('[sentry] Could not initialise (@sentry/node not installed?):', e.message);
  }
}

/**
 * Capture an exception. Safe to call even before init() or when DSN is absent.
 * @param {Error} err
 * @param {object} [context]  Extra key-value pairs added as Sentry "extra" data
 */
function captureError(err, context = {}) {
  if (!Sentry) return;
  Sentry.withScope((scope) => {
    Object.entries(context).forEach(([k, v]) => scope.setExtra(k, v));
    Sentry.captureException(err);
  });
}

/**
 * Express error handler middleware — wire in as the LAST app.use() call.
 * Forwards errors to Sentry then calls next(err) to reach your own handler.
 */
function errorHandler() {
  if (!Sentry) {
    // Return a pass-through middleware so the call site always works
    return (err, _req, _res, next) => next(err);
  }
  return Sentry.Handlers.errorHandler();
}

/**
 * Express request handler middleware — wire in as the FIRST app.use() call
 * to attach a Sentry transaction to each request.
 */
function requestHandler() {
  if (!Sentry) return (_req, _res, next) => next();
  return Sentry.Handlers.requestHandler();
}

module.exports = { init, captureError, errorHandler, requestHandler };
