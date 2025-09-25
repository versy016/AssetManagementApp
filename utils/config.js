// utils/config.js
const path = require('path');

// Load env from project root (adjust if your .env lives elsewhere)
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// Try loading inventory API config; fall back to env/defaults if absent
function safeRequire(mod) {
  try { return require(mod); } catch { return null; }
}
const apiCfg = safeRequire('../inventory-api/config'); // may be null

const HOST = process.env.HOST || 'localhost';
const PORT = process.env.PORT || '3000';

// Public API base for generating absolute URLs to server endpoints
const PROD_API_URL =
  process.env.PROD_API_URL ||
  (apiCfg && apiCfg.API_URL) ||
  `http://${HOST}:${PORT}`;

// Static mount path must match inventory-api/config.js
const STATIC_MOUNT =
  process.env.STATIC_MOUNT ||
  (apiCfg && apiCfg.STATIC_MOUNT) ||
  '/qrcodes';

module.exports = {
  HOST,
  PORT,
  QR_ASSET_COUNT: parseInt(process.env.QR_ASSET_COUNT || '50', 10),
  QR_FOLDER: path.join('utils', 'qrcodes'),
  QR_SHEETS_FOLDER: path.join('utils', 'qrcodes', 'sheets'),
  PROD_API_URL,
  STATIC_MOUNT,
};
