/**
 * inventory-api/lib/logger.js
 * Structured server-side logger.
 * In production: only warn/error are emitted.
 * In development: all levels are printed with a timestamp prefix.
 *
 * logger.error() also reports to Sentry. That is deliberate and load-bearing:
 * route handlers in this codebase catch their own errors and respond 500
 * directly rather than calling next(err), so Express's error middleware — where
 * Sentry installs its handler — almost never runs. Without this hook Sentry sees
 * an empty project while the API returns 500s.
 *
 * Pass the Error itself, not just its message, wherever you can:
 *   logger.error('[bookings] approve failed:', e)        ← keeps the stack
 *   logger.error('[bookings] approve failed:', e.message) ← message only
 * Both are reported; only the first is diagnosable.
 */

// Safe to require: lib/sentry.js logs via console, so there is no cycle here.
const sentry = require('./sentry');

const IS_DEV = process.env.NODE_ENV !== 'production';

const ts = () => new Date().toISOString();

/** Best-effort text for the args that are not Errors, used as the event title. */
function describe(args) {
  return args
    .filter((a) => !(a instanceof Error))
    .map((a) => {
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch (_) {
        return String(a);
      }
    })
    .join(' ')
    .trim();
}

function reportToSentry(args) {
  try {
    const err = args.find((a) => a instanceof Error);
    const text = describe(args);
    if (err) {
      sentry.captureError(err, text ? { logMessage: text } : {});
      return;
    }
    // No Error to hand over — synthesise one so the event still carries a stack
    // pointing at the call site, and so grouping has something stable to key on.
    sentry.captureError(new Error(text || 'logger.error called with no message'), {
      synthesised: true,
    });
  } catch (_) {
    // Reporting must never break logging.
  }
}

const logger = {
  log: IS_DEV ? (...args) => console.log(`[${ts()}] [INFO]`, ...args) : () => {},
  info: IS_DEV ? (...args) => console.log(`[${ts()}] [INFO]`, ...args) : () => {},
  warn: (...args) => console.warn(`[${ts()}] [WARN]`, ...args),
  error: (...args) => {
    console.error(`[${ts()}] [ERROR]`, ...args);
    reportToSentry(args);
  },
};

module.exports = logger;
