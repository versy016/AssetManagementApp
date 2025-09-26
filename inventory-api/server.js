// inventory-api/server.js
const fs = require('fs');
const path = require('path');

require('dotenv').config({
  path: path.join(
    __dirname,
    process.env.NODE_ENV === 'test' ? '.env.test' : '.env'
  ),
});

// NOTE: config should export STATIC_MOUNT; if not, we fall back.
const config = require('./config');

const express = require('express');
const cors = require('cors');

// ---- Prisma ---------------------------------------------------------------
const { PrismaClient } = require('./generated/prisma');
const NODE_ENV = process.env.NODE_ENV || 'development';

const prisma = new PrismaClient({
  log: NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
});

// Try DB connection early so we fail fast in dev; don’t hard-exit during tests
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

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ---- Routes ---------------------------------------------------------------
const assetRoutes = require('./routes/assets');
const usersRouter = require('./routes/users');
const assetTypeFieldsRoutes = require('./routes/assetTypeFields');
const assetTypesRoutes = require('./routes/assetTypes');       // ← NEW
const fieldTypesRoutes = require('./routes/fieldTypes');       // ← NEW
const placesRoutes = require('./routes/places');               // ← NEW

// mount
app.use('/assets', assetRoutes);
app.use('/users', usersRouter);
app.use('/assets/asset-types', assetTypeFieldsRoutes);
app.use('/asset-types', assetTypesRoutes);                     // ← NEW top-level CRUD
app.use('/field-types', fieldTypesRoutes);                     // ← NEW top-level CRUD
app.use('/places', placesRoutes);                              // ← Google Places proxy

// ---- Static (QR Codes) ----------------------------------------------------
// IMPORTANT: generator writes under project-root/utils/qrcodes (+ /sheets)
const STATIC_MOUNT = (config && config.STATIC_MOUNT) || '/qrcodes';
const qrRoot = path.join(__dirname, '..', 'utils', 'qrcodes');
const sheetsDir = path.join(qrRoot, 'sheets');

// ensure dirs exist so static mount won’t 404 due to missing folder
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
  const targetBase = (process.env.CHECKIN_WEB_BASE_URL || process.env.CHECKIN_BASE_URL || '').trim();
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
    console.log(`[server] ${signal} received. Shutting down…`);
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
