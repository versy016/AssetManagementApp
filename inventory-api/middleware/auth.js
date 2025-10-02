// inventory-api/middleware/auth.js
// Shared auth + admin-only middleware using DB users.role

const { PrismaClient } = require('../generated/prisma');
const prisma = new PrismaClient();

let admin = null;
try {
  // eslint-disable-next-line global-require
  admin = require('firebase-admin');
} catch {
  admin = null;
}

let adminInitialized = false;

function ensureAdminInit() {
  if (!admin || adminInitialized) return;
  if (!admin.apps.length) {
    try {
      if (process.env.NODE_ENV === 'production') {
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
          admin.initializeApp();
        } else {
          throw new Error('GOOGLE_APPLICATION_CREDENTIALS not set');
        }
      } else {
        try {
          const serviceAccount = require('../../config/assetmanager-dev-3a7cf-firebase-adminsdk-fbsvc-221bff9e42.json');
          admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        } catch (devError) {
          if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            admin.initializeApp();
          } else {
            adminInitialized = false;
            return;
          }
        }
      }
      adminInitialized = true;
    } catch (e) {
      console.error('[auth] Failed to init firebase-admin:', e?.message || e);
      adminInitialized = false;
    }
  }
}

async function authRequired(req, res, next) {
  // Public exceptions can be handled in routers before using this middleware
  ensureAdminInit();

  if ((process.env.NODE_ENV || 'development') !== 'production') {
    const uidFromQuery = req.query?.uid;
    if (uidFromQuery) {
      req.user = { uid: String(uidFromQuery) };
      return next();
    }
    const uidFromHeader = req.header('X-User-Id') || req.header('x-user-id');
    if (uidFromHeader) {
      req.user = { uid: String(uidFromHeader) };
      return next();
    }
  }

  if (admin && adminInitialized) {
    try {
      const header = req.headers.authorization || '';
      const [, token] = header.split(' ');
      if (!token) return res.status(401).json({ error: 'Missing Authorization Bearer token' });
      const decoded = await admin.auth().verifyIdToken(token);
      req.user = { uid: decoded.uid };
      return next();
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }

  return res.status(401).json({
    error:
      (process.env.NODE_ENV === 'production'
        ? 'Authentication required. Provide Bearer ID token.'
        : 'Authentication required. Provide X-User-Id header or Bearer ID token.'),
  });
}

async function adminOnly(req, res, next) {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(403).json({ error: 'Admin privilege required' });
    const dbUser = await prisma.users.findUnique({ where: { id: uid }, select: { role: true } });
    if (dbUser?.role === 'ADMIN') return next();
    return res.status(403).json({ error: 'Admin privilege required' });
  } catch (e) {
    console.error('[auth] adminOnly error:', e);
    return res.status(500).json({ error: 'Failed to verify admin privilege' });
  }
}

module.exports = { authRequired, adminOnly, ensureAdminInit };

