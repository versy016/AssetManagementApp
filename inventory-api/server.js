// server.js
require('dotenv').config({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

const express = require('express');
const cors = require('cors');
const path = require('path');

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

// mount
app.use('/assets', assetRoutes);
app.use('/users', usersRouter);
app.use('/assets/asset-types', assetTypeFieldsRoutes);
app.use('/asset-types', assetTypesRoutes);                     // ← NEW top-level CRUD
app.use('/field-types', fieldTypesRoutes);                     // ← NEW top-level CRUD

// ---- Static (QR Codes) ----------------------------------------------------
const qrPath = process.env.QR_CODE_PATH || path.join(__dirname, 'utils', 'qr');
app.use('/qr', express.static(qrPath));

// ---- Health / Utilities ---------------------------------------------------
app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

app.get('/check-in/:id', (req, res) => {
  res.json({
    status: 'success',
    message: `Check-in endpoint for asset ${req.params.id}`,
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
    console.log(`[server] QR static path: ${qrPath}`);
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
