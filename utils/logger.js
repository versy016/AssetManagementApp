/**
 * utils/logger.js
 * Lightweight dev logger — all calls are no-ops in production builds.
 * Use this instead of console.log throughout the app.
 *
 * Usage:
 *   import logger from '../utils/logger';
 *   logger.log('Fetching asset', assetId);
 *   logger.warn('Unexpected state', val);
 *   logger.error('Failed to load', err);  // always logs (even in prod)
 */

const IS_DEV = process.env.NODE_ENV !== 'production';

const logger = {
  /** Debug-only — stripped in production */
  log: IS_DEV ? (...args) => console.log('[GearOps]', ...args) : () => {},
  /** Warn-only — stripped in production */
  warn: IS_DEV ? (...args) => console.warn('[GearOps]', ...args) : () => {},
  /** Always logs — use for genuine errors */
  error: (...args) => console.error('[GearOps]', ...args),
};

export default logger;
