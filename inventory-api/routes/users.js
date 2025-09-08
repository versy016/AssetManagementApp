// routes/users.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('../generated/prisma');
const prisma = new PrismaClient();

/**
 * Try to require firebase-admin. If it's not installed, we keep going gracefully.
 */
let admin = null;
try {
  // eslint-disable-next-line import/no-extraneous-dependencies, global-require
  admin = require('firebase-admin');
} catch {
  admin = null;
}

/** Tracks whether we successfully initialized firebase-admin */
let adminInitialized = false;

/**
 * Initialize firebase-admin exactly once (only if the module is available).
 * Will read credentials from GOOGLE_APPLICATION_CREDENTIALS if set,
 * otherwise falls back to the local json in the repo.
 */
function ensureAdminInit() {
  if (!admin || adminInitialized) return;
  if (!admin.apps.length) {
    try {
      // In production, we MUST use environment variables.
      if (process.env.NODE_ENV === 'production') {
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
          admin.initializeApp();
        } else {
          throw new Error('GOOGLE_APPLICATION_CREDENTIALS environment variable is not set in production.');
        }
      } else {
        // In development, we can fall back to a local file.
        try {
          const serviceAccount = require('../../config/assetmanager-dev-3a7cf-firebase-adminsdk-fbsvc-221bff9e42.json');
          admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        } catch (devError) {
          console.warn('Could not find local Firebase credentials, relying on GOOGLE_APPLICATION_CREDENTIALS for development.');
          admin.initializeApp(); // Try initializing from env var as a last resort for dev
        }
      }
      adminInitialized = true;
    } catch (e) {
      console.error('Failed to init firebase-admin:', e);
      adminInitialized = false;
    }
  }
}

/**
 * Auth middleware:
 * - If firebase-admin is available: verify the Bearer ID token and set req.user to decoded token
 * - Else, support a secure fallback using X-Admin-Api-Key == process.env.ADMIN_API_KEY
 */
async function authRequired(req, res, next) {
  ensureAdminInit();

  if (admin && adminInitialized) {
    try {
      const header = req.headers.authorization || '';
      const [, token] = header.split(' ');
      if (!token) return res.status(401).json({ error: 'Missing Authorization Bearer token' });
      const decoded = await admin.auth().verifyIdToken(token);
      req.user = decoded;
      return next();
    } catch (e) {
      console.error('Auth error:', e);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }

  const apiKey = req.header('X-Admin-Api-Key') || req.header('x-admin-api-key');
  if (apiKey && process.env.ADMIN_API_KEY && apiKey === process.env.ADMIN_API_KEY) {
    req.user = { uid: 'api-key', admin: true, email: 'api@local' };
    return next();
  }

  return res.status(401).json({
    error:
      'Authentication unavailable. Install and configure firebase-admin or provide a valid X-Admin-Api-Key.',
  });
}

/**
 * Admin gate:
 * - Allow if req.user.admin === true
 * - Else fall back to DB role check (users.role === 'ADMIN')
 */
async function adminOnly(req, res, next) {
  try {
    if (req.user?.admin === true) return next();

    const uid = req.user?.uid;
    if (!uid) return res.status(403).json({ error: 'Admin privilege required' });

    const dbUser = await prisma.users.findUnique({
      where: { id: uid },
      select: { role: true },
    });

    if (dbUser?.role === 'ADMIN') return next();

    return res.status(403).json({ error: 'Admin privilege required' });
  } catch (e) {
    console.error('adminOnly error:', e);
    return res.status(500).json({ error: 'Failed to verify admin privilege' });
  }
}

/* ------------------------------------------------------------------------- */
/*                                   Routes                                  */
/* ------------------------------------------------------------------------- */

/**
 * Create a user
 * POST /users
 */
router.post('/', async (req, res) => {
  const { id, name, useremail } = req.body;

  if (!id || !name) {
    return res.status(400).json({ error: 'Missing id or name' });
  }

  try {
    const newUser = await prisma.users.create({
      data: {
        id,
        name,
        useremail: useremail ? String(useremail).toLowerCase() : null,
        userassets: [],
      },
    });

    return res.status(201).json(newUser);
  } catch (err) {
    console.error('Create user error:', err);
    return res.status(500).json({ error: 'Failed to create user' });
  }
});

/**
 * Assign asset to user
 * POST /users/:userId/assign-asset
 */
router.post('/:userId/assign-asset', async (req, res) => {
  const { userId } = req.params;
  const { assetId } = req.body;

  if (!assetId) {
    return res.status(400).json({ error: 'Missing assetId in body' });
  }

  try {
    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const asset = await prisma.assets.findUnique({ where: { id: assetId } });
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    await prisma.assets.update({
      where: { id: assetId },
      data: { assigned_to_id: userId },
    });

    const has = Array.isArray(user.userassets) && user.userassets.includes(assetId);
    if (!has) {
      await prisma.users.update({
        where: { id: userId },
        data: { userassets: { push: assetId } },
      });
    }

    return res.json({ message: 'Asset successfully assigned to user', assetId, userId });
  } catch (err) {
    console.error('❌ Asset assignment error:', err);
    return res.status(500).json({ error: 'Failed to assign asset' });
  }
});

/**
 * LOOKUP BY EMAIL (place BEFORE "/:id")
 * GET /users/lookup/by-email?email=someone@company.com
 * Admin-only
 */
router.get('/lookup/by-email', authRequired, adminOnly, async (req, res) => {
  try {
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'email is required' });

    const user = await prisma.users.findUnique({
      where: { useremail: email },
      select: { id: true, name: true, useremail: true, role: true },
    });

    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json(user);
  } catch (e) {
    console.error('lookup by email error:', e);
    return res.status(500).json({ error: 'Lookup failed' });
  }
});

/**
 * NEW: Generate QR codes & seed placeholder assets
 * POST /qr/generate      ← if this router is mounted at "/", client calls /qr/generate
 *                         ← if mounted at "/users", client calls /users/qr/generate
 * Body: { count: number }   (default 65)
 * Admin-only
 *
 * Response:
 * { count: number, codes: [{ id: string, url: string }] }
 */
router.post('/qr/generate', authRequired, adminOnly, async (req, res) => {
  const count = Math.min(Math.max(Number(req.body?.count || 65), 1), 500); // 1..500 hard limit

  // Where should the /check-in link point?
  const base =
    process.env.CHECKIN_BASE_URL ||
    req.get('X-External-Base-Url') ||
    // Try to reconstruct from the request
    `${req.protocol}://${req.get('host')}`;

  // Helper to make 8-char ID (A–Z, 0–9)
  const makeId = () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let out = '';
    for (let i = 0; i < 8; i += 1) {
      out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
  };

  const codes = [];
  const used = new Set();

  try {
    for (let i = 0; i < count; i += 1) {
      // ensure unique id (avoid collisions within this batch and DB)
      let id;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        id = makeId();
        if (used.has(id)) continue;
        const existing = await prisma.assets.findUnique({ where: { id } });
        if (!existing) break;
      }
      used.add(id);

      // Seed a minimal asset row
      try {
        await prisma.assets.create({
          data: {
            id,
            serial_number: null,
            model: null,
            description: 'QR reserved asset',
            location: null,
            assigned_to_id: null,
            type_id: null,
            status: 'available', // normalized
          },
        });
      } catch (e) {
        // Unique violation? Try again with a new id
        if (e?.code === 'P2002') {
          used.delete(id);
          i -= 1;
          continue;
        }
        console.error('Failed to insert asset', id, e);
        return res.status(500).json({ error: 'Failed to insert asset rows' });
      }

      const url = `${base.replace(/\/+$/, '')}/check-in/${id}`;
      codes.push({ id, url });
    }

    return res.json({ count: codes.length, codes });
  } catch (e) {
    console.error('QR generation failed:', e);
    return res.status(500).json({ error: 'QR generation failed' });
  }
});

/**
 * Promote a user to ADMIN (sets DB role + Firebase custom claim when available)
 * POST /users/:id/promote
 * Admin-only
 */
router.post('/:id/promote', authRequired, adminOnly, async (req, res) => {
  ensureAdminInit();
  const targetUid = req.params.id;

  try {
    await prisma.users.update({ where: { id: targetUid }, data: { role: 'ADMIN' } });

    let firebaseClaimsUpdated = false;
    if (admin && adminInitialized) {
      try {
        const u = await admin.auth().getUser(targetUid);
        const existing = u.customClaims || {};
        await admin.auth().setCustomUserClaims(targetUid, { ...existing, admin: true });
        firebaseClaimsUpdated = true;
      } catch (e) {
        console.warn('Promote: could not update Firebase custom claims:', e?.message || e);
      }
    }

    return res.json({ ok: true, uid: targetUid, role: 'ADMIN', firebaseClaimsUpdated });
  } catch (e) {
    console.error('Promote error:', e);
    return res.status(500).json({ error: 'Failed to promote user' });
  }
});

/**
 * Demote a user to USER (unsets admin claim when available)
 * POST /users/:id/demote
 * Admin-only
 */
router.post('/:id/demote', authRequired, adminOnly, async (req, res) => {
  ensureAdminInit();
  const targetUid = req.params.id;

  try {
    await prisma.users.update({ where: { id: targetUid }, data: { role: 'USER' } });

    let firebaseClaimsUpdated = false;
    if (admin && adminInitialized) {
      try {
        const u = await admin.auth().getUser(targetUid);
        const existing = u.customClaims || {};
        const { admin: _drop, ...rest } = existing;
        await admin.auth().setCustomUserClaims(targetUid, { ...rest, admin: false });
        firebaseClaimsUpdated = true;
      } catch (e) {
        console.warn('Demote: could not update Firebase custom claims:', e?.message || e);
      }
    }

    return res.json({ ok: true, uid: targetUid, role: 'USER', firebaseClaimsUpdated });
  } catch (e) {
    console.error('Demote error:', e);
    return res.status(500).json({ error: 'Failed to demote user' });
  }
});

/**
 * Update a user (generic)
 * PUT /users/:id
 */
router.put('/:id', async (req, res) => {
  try {
    const updatedUser = await prisma.users.update({
      where: { id: req.params.id },
      data: req.body,
    });
    return res.json(updatedUser);
  } catch (err) {
    console.error('Update user error:', err);
    return res.status(400).json({ error: 'Failed to update user' });
  }
});

/**
 * List all users
 * GET /users
 */
router.get('/', async (_req, res) => {
  try {
    const users = await prisma.users.findMany();
    return res.json(users);
  } catch (err) {
    console.error('❌ Failed to fetch users:', err);
    return res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * Get user by ID
 * GET /users/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const user = await prisma.users.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json(user);
  } catch (err) {
    console.error('❌ Failed to fetch user:', err);
    return res.status(500).json({ error: 'Failed to fetch user' });
  }
});

module.exports = router;
