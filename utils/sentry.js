/**
 * utils/sentry.js — Sentry error reporting for the React Native / Expo app.
 *
 * Add to your app's .env (or Expo secrets):
 *   EXPO_PUBLIC_SENTRY_DSN=https://YOUR_KEY@oXXXXXX.ingest.sentry.io/XXXXXXX
 *
 * Install:
 *   npx expo install @sentry/react-native
 *   npx @sentry/wizard@latest -i reactNative   ← wires into app.json + metro
 *
 * Usage:
 *   import { captureError, captureMessage } from '../../utils/sentry';
 *
 *   try { ... } catch (err) { captureError(err, { screen: 'Dashboard' }); }
 */

import { Platform } from 'react-native';

let Sentry = null;

function getSentry() {
  if (Sentry) return Sentry;
  try {
    Sentry = require('@sentry/react-native');
  } catch {
    // package not installed yet — silently degrade
  }
  return Sentry;
}

/**
 * Call once at app startup (in app/_layout.js before the Navigator).
 */
export function initSentry() {
  const S = getSentry();
  if (!S) return;
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  S.init({
    dsn,
    environment: __DEV__ ? 'development' : 'production',
    tracesSampleRate: __DEV__ ? 1.0 : 0.2,
    // Attach device/platform info automatically
    integrations: [
      new S.ReactNativeTracing(),
    ],
  });
}

/**
 * Capture an exception. Safe to call even if Sentry is not installed.
 * @param {Error}  err
 * @param {object} [context]  Extra key-value pairs shown in Sentry issue detail
 */
export function captureError(err, context = {}) {
  if (__DEV__) {
    // In dev always log to console so you see it immediately
    console.error('[Sentry]', err?.message || err, context);
  }
  const S = getSentry();
  if (!S) return;
  S.withScope((scope) => {
    scope.setExtra('platform', Platform.OS);
    Object.entries(context).forEach(([k, v]) => scope.setExtra(k, v));
    S.captureException(err instanceof Error ? err : new Error(String(err)));
  });
}

/**
 * Capture a plain message (non-error events, e.g. unexpected API states).
 * @param {string} message
 * @param {'fatal'|'error'|'warning'|'info'|'debug'} [level]
 * @param {object} [context]
 */
export function captureMessage(message, level = 'info', context = {}) {
  if (__DEV__) console.warn('[Sentry]', level, message, context);
  const S = getSentry();
  if (!S) return;
  S.withScope((scope) => {
    scope.setLevel(level);
    Object.entries(context).forEach(([k, v]) => scope.setExtra(k, v));
    S.captureMessage(message);
  });
}
