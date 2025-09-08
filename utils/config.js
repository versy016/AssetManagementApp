// utils/config.js
const path = require('path');

// Load .env from project root (adjust if your .env lives elsewhere)
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// Try loading an optional API config; fall back to env/defaults if absent
function safeRequire(mod) {
  try { return require(mod); } catch { return null; }
}
const apiCfg = safeRequire('../inventory-api/config'); // may be null

const HOST = process.env.HOST || 'localhost';
const PORT = process.env.PORT || '3000';

const PROD_API_URL =
  (apiCfg && apiCfg.PROD_API_URL) ||
  process.env.PROD_API_URL ||
  `http://${HOST}:${PORT}`;

module.exports = {
  HOST,
  PORT,
  QR_ASSET_COUNT: parseInt(process.env.QR_ASSET_COUNT || '50', 10),
  QR_FOLDER: process.env.QR_FOLDER || 'qr',
  PROD_API_URL,
};
