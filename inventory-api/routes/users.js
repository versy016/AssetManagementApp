// routes/users.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const { PrismaClient } = require('../generated/prisma');
const prisma = new PrismaClient();
const apiConfig = require('../config');
const { authRequired, adminOnly, ensureAdminInit } = require('../middleware/auth');

// Note: Public exception for listing sheets is handled on the route itself

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

  // Public base for serving static QR images/sheets
  const apiBase =
    process.env.PUBLIC_API_BASE_URL ||
    req.get('X-External-Base-Url') ||
    `${req.protocol}://${req.get('host')}`;
  const STATIC_MOUNT = apiConfig.STATIC_MOUNT || '/qrcodes';

  // Output folders (project-root/utils/qrcodes and sheets)
  const QR_DIR = path.join(__dirname, '..', '..', 'utils', 'qrcodes');
  const SHEETS_DIR = path.join(QR_DIR, 'sheets');
  const ensureDir = (p) => { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); };
  ensureDir(QR_DIR);
  ensureDir(SHEETS_DIR);

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

      // Persist PNG for this code under utils/qrcodes/<id>.png
      try {
        const filePath = path.join(QR_DIR, `${id}.png`);
        await QRCode.toFile(filePath, url);
      } catch (e) {
        console.error('Failed to write QR PNG', id, e);
        return res.status(500).json({ error: 'Failed to write QR images' });
      }

      // Keep both check-in URL and static PNG URL
      const pngUrl = `${apiBase.replace(/\/+$/, '')}${STATIC_MOUNT}/${id}.png`;
      codes.push({ id, url, pngUrl });
    }
    // Build PDF sheets (65 per page)
    const perPage = 65;
    const pages = Math.ceil(codes.length / perPage);
    const a4 = { w: 595.28, h: 841.89 }; // points
    const margin = 24;
    const cols = 5;
    const rows = 13;
    const gridW = a4.w - margin * 2;
    const gridH = a4.h - margin * 2;
    const cellW = gridW / cols;
    const cellH = gridH / rows;
    const qrSize = Math.min(cellW, cellH) * 0.75;
    const fontSize = 8;

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '')
      .replace('T', '_')
      .slice(0, 15);

    const sheetUrls = [];
    for (let p = 0; p < pages; p += 1) {
      const batch = codes.slice(p * perPage, (p + 1) * perPage);
      const filename = `qr_sheet_${timestamp}_p${p + 1}.pdf`;
      const outPath = path.join(SHEETS_DIR, filename);
      const doc = new PDFDocument({ size: 'A4', margin });
      const stream = fs.createWriteStream(outPath);
      doc.pipe(stream);

      // Optional title/header
      doc.fontSize(10).text(`Asset QR Sheet (${batch.length} codes) — Page ${p + 1} of ${pages}`, { align: 'center' });
      doc.moveDown(0.3);

      for (let i = 0; i < batch.length; i += 1) {
        const id = batch[i].id;
        const row = Math.floor(i / cols);
        const col = i % cols;
        const x = margin + col * cellW + (cellW - qrSize) / 2;
        const y = margin + 14 + row * cellH + (cellH - qrSize) / 2 - 6;
        const pngPath = path.join(QR_DIR, `${id}.png`);
        doc.image(pngPath, x, y, { width: qrSize, height: qrSize });
        doc.fontSize(fontSize).text(id, x, y + qrSize + 2, { width: qrSize, align: 'center' });
      }

      doc.end();
      // wait for file write finish
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resFinish) => stream.on('finish', resFinish));
      const publicUrl = `${apiBase.replace(/\/+$/, '')}${STATIC_MOUNT}/sheets/${filename}`;
      sheetUrls.push(publicUrl);
    }

    // Response: normalize to expected payload
    const items = codes.map(({ id, pngUrl, url: checkInUrl }) => ({ id, url: pngUrl, checkInUrl }));
    const sheets = sheetUrls.map((url, i) => ({ index: i + 1, url }));
    return res.json({ count: items.length, codes: items, sheets });
  } catch (e) {
    console.error('QR generation failed:', e);
    return res.status(500).json({ error: 'QR generation failed' });
  }
});

/**
 * List all generated QR sheet PDFs from utils/qrcodes/sheets
 * GET /users/qr/sheets
 * Admin-only
 */
 router.get('/qr/sheets', async (req, res) => {
  try {
    const apiBase =
      process.env.PUBLIC_API_BASE_URL ||
      req.get('X-External-Base-Url') ||
      `${req.protocol}://${req.get('host')}`;
    const STATIC_MOUNT = apiConfig.STATIC_MOUNT || '/qrcodes';

    const QR_DIR = path.join(__dirname, '..', '..', 'utils', 'qrcodes');
    const SHEETS_DIR = path.join(QR_DIR, 'sheets');

    if (!fs.existsSync(SHEETS_DIR)) return res.json({ count: 0, sheets: [] });

    const files = fs.readdirSync(SHEETS_DIR).filter((f) => f.toLowerCase().endsWith('.pdf'));
    const items = files.map((name) => {
      const full = path.join(SHEETS_DIR, name);
      const st = fs.statSync(full);
      return {
        name,
        url: `${apiBase.replace(/\/+$/, '')}${STATIC_MOUNT}/sheets/${name}`,
        size: st.size,
        mtime: st.mtime.toISOString(),
      };
    });

    items.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
    return res.json({ count: items.length, sheets: items });
  } catch (e) {
    console.error('List sheets failed:', e);
    return res.status(500).json({ error: 'Failed to list sheets' });
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
