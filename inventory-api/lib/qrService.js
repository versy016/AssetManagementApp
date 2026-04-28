/**
 * qrService.js
 * Shared helpers for QR code generation used by /users/qr/* routes.
 *
 * Extracted to eliminate duplication across /qr/generate, /qr/generate-excel,
 * and /qr/preview handlers.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const prisma = require('./prisma');
const logger = require('./logger');

/* ------------------------------------------------------------------ */
/* Constants                                                            */
/* ------------------------------------------------------------------ */

/** Default directory for QR PNG files and generated sheets. */
const QR_DIR = path.join(__dirname, '..', '..', 'utils', 'qrcodes');
const SHEETS_DIR = path.join(QR_DIR, 'sheets');

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/**
 * Ensure QR_DIR and SHEETS_DIR exist.
 * Safe to call multiple times — no-op if they already exist.
 */
function ensureQRDirs() {
  if (!fs.existsSync(QR_DIR)) fs.mkdirSync(QR_DIR, { recursive: true });
  if (!fs.existsSync(SHEETS_DIR)) fs.mkdirSync(SHEETS_DIR, { recursive: true });
}

/**
 * Generate a random 8-character asset ID.
 * Uses an unambiguous alphabet that excludes visually similar characters:
 *   - 0 (zero)  → looks like O
 *   - 1 (one)   → looks like I / l
 *   - I         → looks like 1 / l
 *   - O         → looks like 0
 * Remaining: A-H, J-N, P-Z (22 letters) + 2-9 (8 digits) = 30 characters.
 * @returns {string}
 */
function makeId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/** Public web origin for check-in URLs when env is unset in production (not the API host). */
const PRODUCTION_DEFAULT_CHECKIN_BASE = 'https://gearops.com.au';

let warnedDefaultCheckinBase = false;

/**
 * Resolve the base URL for check-in links from environment / request headers.
 * Order: CHECKIN_WEB_BASE_URL, CHECKIN_BASE_URL, X-External-Base-Url, production default, then request host.
 * @param {import('express').Request} req
 * @returns {string}
 */
function resolveBase(req) {
  const fromEnv = (
    process.env.CHECKIN_WEB_BASE_URL ||
    process.env.CHECKIN_BASE_URL ||
    ''
  ).trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');

  const header = (req.get('X-External-Base-Url') || '').trim();
  if (header) return header.replace(/\/+$/, '');

  if (process.env.NODE_ENV === 'production') {
    if (!warnedDefaultCheckinBase) {
      warnedDefaultCheckinBase = true;
      logger.warn(
        '[qrService] CHECKIN_WEB_BASE_URL / CHECKIN_BASE_URL not set; using ' +
          `${PRODUCTION_DEFAULT_CHECKIN_BASE} for QR check-in links. Set one of those env vars to override.`
      );
    }
    return PRODUCTION_DEFAULT_CHECKIN_BASE;
  }

  return `${req.protocol}://${req.get('host')}`.replace(/\/+$/, '');
}

/**
 * Resolve the public-facing API base URL (for serving static files).
 * @param {import('express').Request} req
 * @returns {string}
 */
function resolveApiBase(req) {
  return (
    process.env.PUBLIC_API_BASE_URL ||
    req.get('X-External-Base-Url') ||
    `${req.protocol}://${req.get('host')}`
  );
}

/**
 * Build a public URL for a file inside the sheets directory.
 * @param {string} apiBase
 * @param {string} staticMount  e.g. '/qrcodes'
 * @param {string} filename
 * @returns {string}
 */
function sheetUrl(apiBase, staticMount, filename) {
  return `${apiBase.replace(/\/+$/, '')}${staticMount}/sheets/${filename}`;
}

/**
 * Build a public URL for a QR PNG file.
 * @param {string} apiBase
 * @param {string} staticMount
 * @param {string} id
 * @returns {string}
 */
function qrPngUrl(apiBase, staticMount, id) {
  return `${apiBase.replace(/\/+$/, '')}${staticMount}/${id}.png`;
}

/**
 * Generate a sortable timestamp string suitable for filenames.
 * Format: YYYYMMDD_HHmmss
 * @returns {string}
 */
function fileTimestamp() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, '')
    .replace('T', '_')
    .slice(0, 15);
}

/* ------------------------------------------------------------------ */
/* Core generation                                                      */
/* ------------------------------------------------------------------ */

/**
 * Generate `count` unique QR codes:
 *  1. Produce a unique 8-char ID (checking in-memory set + DB)
 *  2. Seed a placeholder asset row in the database
 *  3. Write a QR PNG to QR_DIR/<id>.png
 *
 * Returns an array of `{ id, url, pngPath }` objects where:
 *   - `url`     is the check-in deep-link encoded in the QR
 *   - `pngPath` is the absolute path to the generated PNG
 *
 * @param {object} options
 * @param {number} options.count   Number of QR codes to generate (caller should clamp)
 * @param {string} options.base    Check-in base URL (e.g. https://myapp.com)
 * @param {string} options.apiBase Public API base URL (for PNG links)
 * @param {string} options.staticMount  Static mount point (e.g. '/qrcodes')
 * @returns {Promise<Array<{id:string, url:string, pngPath:string, pngUrl:string}>>}
 */
async function generateQRCodes({ count, base, apiBase, staticMount }) {
  ensureQRDirs();

  const codes = [];
  const used = new Set();

  for (let i = 0; i < count; i += 1) {
    if (i > 0 && i % 10 === 0) {
      logger.log(`[qrService] Generated ${i}/${count} codes…`);
    }

    // Find a unique ID
    let id;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      id = makeId();
      if (used.has(id)) continue;
      // eslint-disable-next-line no-await-in-loop
      const existing = await prisma.assets.findUnique({ where: { id } });
      if (!existing) break;
    }
    used.add(id);

    // Seed placeholder asset row
    try {
      // eslint-disable-next-line no-await-in-loop
      await prisma.assets.create({
        data: {
          id,
          serial_number: null,
          model: null,
          description: 'QR reserved asset',
          location: null,
          assigned_to_id: null,
          type_id: null,
          status: 'available',
        },
      });
    } catch (e) {
      if (e?.code === 'P2002') {
        // Unique violation — retry with a new ID
        used.delete(id);
        i -= 1;
        continue;
      }
      logger.error('[qrService] Failed to insert asset', id, e);
      throw Object.assign(new Error('Failed to insert asset rows'), { code: 'DB_INSERT' });
    }

    // Build check-in URL and write PNG
    const url = `${base.replace(/\/+$/, '')}/check-in/${id}`;
    const pngPath = path.join(QR_DIR, `${id}.png`);

    try {
      // eslint-disable-next-line no-await-in-loop
      await QRCode.toFile(pngPath, url);
    } catch (e) {
      logger.error('[qrService] Failed to write QR PNG', id, e);
      throw Object.assign(new Error('Failed to write QR images'), { code: 'PNG_WRITE' });
    }

    codes.push({
      id,
      url,
      pngPath,
      pngUrl: qrPngUrl(apiBase, staticMount, id),
    });
  }

  return codes;
}

/* ------------------------------------------------------------------ */
/* Exports                                                              */
/* ------------------------------------------------------------------ */

module.exports = {
  QR_DIR,
  SHEETS_DIR,
  ensureQRDirs,
  makeId,
  resolveBase,
  resolveApiBase,
  sheetUrl,
  qrPngUrl,
  fileTimestamp,
  generateQRCodes,
};
