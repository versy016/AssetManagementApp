// Reads only Google-related keys from inventory-api/.env for expo.extra (Maps tab).
// We intentionally do NOT call dotenv.config() on that file — loading all vars into process.env
// would inline EXPO_PUBLIC_* from the API .env into the client bundle and break local dev
// (e.g. stale EXPO_PUBLIC_API_URL → ERR_CONNECTION_TIMED_OUT).
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const apiEnvPath = path.resolve(__dirname, 'inventory-api', '.env');
let apiEnvFile = {};
try {
  if (fs.existsSync(apiEnvPath)) {
    apiEnvFile = dotenv.parse(fs.readFileSync(apiEnvPath, 'utf8'));
  }
} catch {
  /* ignore */
}

function googleMapsWebKeyFromEnv() {
  const fromFile = (k) => (apiEnvFile[k] != null ? String(apiEnvFile[k]).trim() : '');
  return String(
    fromFile('GOOGLE_MAPS_WEB_KEY') ||
      fromFile('EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY') ||
      fromFile('GOOGLE_MAPS_API_KEY') ||
      fromFile('GOOGLE_PLACES_API_KEY') ||
      fromFile('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY') ||
      process.env.GOOGLE_MAPS_WEB_KEY ||
      process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY ||
      process.env.GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_PLACES_API_KEY ||
      process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
      ''
  ).trim();
}

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...(config.extra || {}),
    googleMapsWebKey: googleMapsWebKeyFromEnv(),
  },
});
