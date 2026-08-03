/**
 * inventory-api/lib/sentry.js — Sentry initialisation (CJS).
 *
 * Add to the server's .env:
 *   SENTRY_DSN=https://YOUR_KEY@oXXXXXX.ingest.sentry.io/XXXXXXX
 *
 * The module is a no-op when SENTRY_DSN is not set, so local dev is unaffected.
 *
 * ORDERING MATTERS. Sentry v8+ instruments Express, http, pg and friends by
 * patching them as they are required, so `init()` must run before those modules
 * are loaded. server.js requires and initialises this file above its `express`
 * require for exactly that reason — moving it below will silently produce traces
 * with no HTTP or database spans in them.
 *
 * Migration note: this used to call `Sentry.Handlers.requestHandler()` and
 * `Sentry.Handlers.errorHandler()`. That API was removed in v8. Request
 * instrumentation is now automatic, and the error handler is installed with
 * `setupExpressErrorHandler(app)` after the routes are mounted.
 */
'use strict';

let Sentry = null;

function init() {
  if (!process.env.SENTRY_DSN) {
    console.log('[sentry] SENTRY_DSN not set — error reporting disabled');
    return;
  }
  try {
    // eslint-disable-next-line global-require
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      // Capture a fifth of transactions in production; everything in dev.
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
      // Deliberately left at the default (false). Enabling it attaches request
      // bodies, headers and IP addresses to every event — this API carries asset
      // locations, user emails and signed hire documents.
      sendDefaultPii: false,
      // Lets the API map link a failing route straight to its events.
      release: process.env.SENTRY_RELEASE || undefined,
    });
    console.log('[sentry] Initialised');
  } catch (e) {
    console.warn('[sentry] Could not initialise (@sentry/node not installed?):', e.message);
    Sentry = null;
  }
}

/**
 * Capture an exception. Safe to call even before init() or when DSN is absent.
 * @param {Error} err
 * @param {object} [context] Extra key-value pairs added as Sentry "extra" data
 */
function captureError(err, context = {}) {
  if (!Sentry) return;
  Sentry.withScope((scope) => {
    Object.entries(context).forEach(([k, v]) => scope.setExtra(k, v));
    Sentry.captureException(err);
  });
}

/**
 * Install the Express error handler. Call AFTER all routes are mounted and
 * BEFORE any other error-handling middleware, so Sentry sees the error first and
 * the app's own handler still gets to shape the response.
 * @param {import('express').Express} app
 */
function setupExpressErrorHandler(app) {
  if (!Sentry) return;
  Sentry.setupExpressErrorHandler(app);
}

/** True when a DSN was configured and the SDK loaded — used by /metrics. */
function isEnabled() {
  return Boolean(Sentry);
}

/**
 * Org/project slugs, when configured, so the API map can deep-link a failing
 * route into Sentry's issue search. Returns null when not configured.
 */
function orgProject() {
  const org = process.env.SENTRY_ORG;
  const project = process.env.SENTRY_PROJECT;
  if (!org || !project) return null;
  return { org, project };
}

module.exports = { init, captureError, setupExpressErrorHandler, isEnabled, orgProject };
