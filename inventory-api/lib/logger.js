/**
 * inventory-api/lib/logger.js
 * Structured server-side logger.
 * In production: only warn/error are emitted.
 * In development: all levels are printed with a timestamp prefix.
 */

const IS_DEV = process.env.NODE_ENV !== 'production';

const ts = () => new Date().toISOString();

const logger = {
  log: IS_DEV ? (...args) => console.log(`[${ts()}] [INFO]`, ...args) : () => {},
  info: IS_DEV ? (...args) => console.log(`[${ts()}] [INFO]`, ...args) : () => {},
  warn: (...args) => console.warn(`[${ts()}] [WARN]`, ...args),
  error: (...args) => console.error(`[${ts()}] [ERROR]`, ...args),
};

module.exports = logger;
