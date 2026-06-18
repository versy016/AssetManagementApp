// inventory-api/server.js
const fs = require('fs');
const path = require('path');

require('dotenv').config({
  path: path.join(
    __dirname,
    process.env.NODE_ENV === 'test' ? '.env.test' : '.env'
  ),
});

// Sentry must be initialised before any other requires so it can instrument them
const sentry = require('./lib/sentry');
sentry.init();

// NOTE: config should export STATIC_MOUNT; if not, we fall back.
const config = require('./config');

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
// BoldSign removed — self-hosted signing is now handled in hireDisclaimer.js

// ---- Prisma (singleton) ---------------------------------------------------
const prisma = require('./lib/prisma');
const NODE_ENV = process.env.NODE_ENV || 'development';

// Try DB connection early so we fail fast in dev; don't hard-exit during tests
(async () => {
  try {
    await prisma.$connect();
    console.log('[server] Database connected');
  } catch (err) {
    console.error('[server] Database connection error:', err);
    if (NODE_ENV !== 'test') process.exit(1);
  }
})();

// ---- App + Middleware -----------------------------------------------------
const app = express();
const PORT = Number(process.env.PORT || 3000);

// IMPORTANT: API runs behind Nginx on EC2.
// '1' tells express-rate-limit to read the real client IP from the
// X-Forwarded-For header that Nginx sets, instead of seeing 127.0.0.1
// for every request (which would make ALL users share one rate-limit bucket).
if (NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(cors());
app.use(sentry.requestHandler()); // must be first middleware

// ---- Rate limiting --------------------------------------------------------
// Only enforce rate limits in production — dev/test traffic is trusted localhost.
const isNonProd = () => NODE_ENV !== 'production';

// Standard limit: 500 requests per minute per real client IP.
// Generous enough for normal app usage (dashboard load ~8 requests,
// so a user would need to navigate 60+ screens/min to hit this),
// but still blocks runaway scripts or credential-stuffing attempts.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  skip: isNonProd,
});

// Upload limit: 60 requests per 15 minutes per IP.
// Allows a user to upload ~60 documents in a session without being blocked,
// while still preventing automated bulk-upload abuse.
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many upload requests, please try again later.' },
  skip: isNonProd,
});

app.use('/api', apiLimiter);
app.use('/assets', apiLimiter);
app.use('/users', apiLimiter);
app.use('/asset-types', apiLimiter);
app.use('/field-types', apiLimiter);
app.use('/places', apiLimiter);
app.use('/activity', apiLimiter);
app.use('/labels', apiLimiter);
app.use('/hire-disclaimer', apiLimiter);

// Signing page & submission — unauthenticated but token-gated; allow generous limit
// per IP so signers on mobile/proxy IPs aren't blocked after a few retries.
const signingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many signing requests. Please try again later.' },
  skip: isNonProd,
});
app.use('/hire-disclaimer/signing', signingLimiter);
app.use('/asset-documents', uploadLimiter);
app.use('/admin', apiLimiter);

// Public endpoints — strict rate limit (5 requests per 15 min per IP).
// These are intentionally very tight because they are unauthenticated and
// update asset state (status → lost, creates action records, sends emails).
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions. Please try again later.' },
  skip: isNonProd,
});
app.use('/public', publicLimiter);

// Only parse JSON when Content-Type is explicitly application/json (never parse multipart as JSON)
app.use(express.json({
  limit: '10mb',
  type: (req) => {
    const ct = (req.get('Content-Type') || '').toLowerCase();
    return ct.startsWith('application/json') && !ct.includes('multipart');
  },
}));
app.use(express.urlencoded({ extended: true, type: 'application/x-www-form-urlencoded' }));

// ---- Routes ---------------------------------------------------------------
const assetRoutes = require('./routes/assets');
const usersRouter = require('./routes/users');
const assetTypeFieldsRoutes = require('./routes/assetTypeFields');
const assetTypesRoutes = require('./routes/assetTypes');
const fieldTypesRoutes = require('./routes/fieldTypes');
const placesRoutes = require('./routes/places');
const activityRoutes = require('./routes/activity');
const labelsRoutes = require('./routes/labels');
const assetDocumentsRoutes = require('./routes/assetDocuments');
const hireDisclaimerRoutes = require('./routes/hireDisclaimer');
const publicAssetsRoutes   = require('./routes/publicAssets');
const adminUsersRoutes     = require('./routes/adminUsers');
const assetScanRoutes      = require('./routes/assetScan');
const tasksRoutes          = require('./routes/tasks');

// Mount the vision scan route BEFORE the catch-all assetRoutes so the more
// specific `/assets/scan-image` path wins.
app.use('/assets/scan-image', assetScanRoutes);
app.use('/assets', assetRoutes);
app.use('/users', usersRouter);
app.use('/assets/asset-types', assetTypeFieldsRoutes);
app.use('/asset-types', assetTypesRoutes);
app.use('/field-types', fieldTypesRoutes);
app.use('/places', placesRoutes);
app.use('/activity', activityRoutes);
app.use('/labels', labelsRoutes);
app.use('/assets', assetDocumentsRoutes);
app.use('/asset-documents', assetDocumentsRoutes);
app.use('/hire-disclaimer', hireDisclaimerRoutes);
app.use('/public', publicAssetsRoutes);
app.use('/admin/users', adminUsersRoutes);
app.use('/tasks', tasksRoutes);

// ---- Static (QR Codes) ----------------------------------------------------
// IMPORTANT: generator writes under project-root/utils/qrcodes (+ /sheets)
const STATIC_MOUNT = (config && config.STATIC_MOUNT) || '/qrcodes';
const qrRoot = path.join(__dirname, '..', 'utils', 'qrcodes');
const sheetsDir = path.join(qrRoot, 'sheets');

// ensure dirs exist so static mount won't 404 due to missing folder
try {
  if (!fs.existsSync(qrRoot)) fs.mkdirSync(qrRoot, { recursive: true });
  if (!fs.existsSync(sheetsDir)) fs.mkdirSync(sheetsDir, { recursive: true });
} catch (e) {
  console.error('[server] Failed to create QR directories:', e);
}

// Optional legacy mount (kept for backward compatibility)
app.use('/qr', express.static(qrRoot));

// New canonical static mount for PNG/PDF
console.log('[server] Setting up QR static:');
console.log('         STATIC_MOUNT =', STATIC_MOUNT);
console.log('         qrRoot       =', qrRoot, 'exists:', fs.existsSync(qrRoot));
console.log('         sheetsDir    =', sheetsDir, 'exists:', fs.existsSync(sheetsDir));
try {
  const rootFiles = fs.readdirSync(qrRoot);
  const sheetFiles = fs.existsSync(sheetsDir) ? fs.readdirSync(sheetsDir) : [];
  console.log('         root files  =', rootFiles.length);
  console.log('         sheets files=', sheetFiles.length);
} catch (e) {
  console.warn('[server] Unable to read QR directories:', e.message || e);
}

app.use(
  STATIC_MOUNT,
  express.static(qrRoot, {
    maxAge: '7d',
    index: false,
    extensions: ['png', 'pdf'],
  })
);

// Debug endpoint to verify static state quickly
app.get('/__debug/qr-static', (_req, res) => {
  const detail = (dir) => {
    try {
      const exists = fs.existsSync(dir);
      const files = exists ? fs.readdirSync(dir) : [];
      return { dir, exists, count: files.length, sample: files.slice(0, 10) };
    } catch (e) {
      return { dir, error: e.message || String(e) };
    }
  };
  res.json({
    STATIC_MOUNT,
    qrRoot: detail(qrRoot),
    sheetsDir: detail(sheetsDir),
    hint: `Sample URLs: ${STATIC_MOUNT}/ABCD1234.png and ${STATIC_MOUNT}/sheets/<sheet>.pdf`,
  });
});

// ---- Health / Utilities ---------------------------------------------------
app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

app.get('/check-in/:id', (req, res) => {
  const id = req.params.id;
  let targetBase = (process.env.CHECKIN_WEB_BASE_URL || process.env.CHECKIN_BASE_URL || '').trim();
  if (!targetBase && NODE_ENV === 'production') {
    targetBase = 'https://gearops.com.au';
  }
  const currentBase = `${req.protocol}://${req.get('host')}`;
  const normalize = (s) => String(s || '').replace(/\/+$/, '');

  if (targetBase && normalize(targetBase) !== normalize(currentBase)) {
    const url = `${normalize(targetBase)}/check-in/${encodeURIComponent(id)}`;
    return res.redirect(302, url);
  }

  // Fallback: simple JSON to show the endpoint is alive
  return res.json({
    status: 'success',
    message: `Check-in endpoint for asset ${id}`,
    timestamp: new Date().toISOString(),
  });
});

// ---- Error handler (last) -------------------------------------------------
// Sentry must come before the custom handler so it captures the error first
app.use(sentry.errorHandler());
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({
    status: 'error',
    message: 'Something went wrong!',
    ...(NODE_ENV === 'development' && { error: err.message }),
  });
});

// ---- Server bootstrap & shutdown -----------------------------------------
let server; // exported only when started here

function start() {
  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] Listening on http://localhost:${PORT} (${NODE_ENV})`);
    console.log(`[server] Mounted ${qrRoot} at '${STATIC_MOUNT}' and '/qr' (legacy)`);
  });

  const shutdown = async (signal) => {
    console.log(`[server] ${signal} received. Shutting down...`);
    server?.close(async () => {
      console.log('[server] HTTP server closed');
      try {
        await prisma.$disconnect();
        console.log('[server] Prisma disconnected');
      } finally {
        process.exit(0);
      }
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Only start when run directly (`node server.js`), not when imported by tests
if (require.main === module && NODE_ENV !== 'test') {
  start();
}

// Export app for Supertest; optionally export prisma for tooling
module.exports = { app, prisma };
