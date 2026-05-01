// Reads only Google-related keys from inventory-api/.env for expo.extra (Maps tab).
// Production / EAS: inventory-api/.env is usually NOT on the build worker (gitignored).
// Set GOOGLE_MAPS_WEB_KEY or EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY (etc.) in Expo → Environment variables
// for the build profile, or under "env" in eas.json for that profile, then rebuild web/app.
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

const googleMapsWebKey = googleMapsWebKeyFromEnv();
if (!googleMapsWebKey && process.env.EAS_BUILD === 'true') {
  // eslint-disable-next-line no-console
  console.warn(
    '[GearOps app.config] googleMapsWebKey is empty on EAS Build. Maps tab will show "missing key" in production. ' +
      'Add GOOGLE_MAPS_WEB_KEY or EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY (or GOOGLE_MAPS_API_KEY / GOOGLE_PLACES_API_KEY) ' +
      'to Expo project Environment variables for this profile, then rebuild. Also allow referrer https://gearops.com.au/* (and www) on that key.'
  );
}

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...(config.extra || {}),
    googleMapsWebKey,
  },
});
