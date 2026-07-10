// routes/settings.js
// Global, admin-editable app settings (key/value). Currently:
//   • maintenance_due_lead_days — how many days before next_service_date an asset
//     auto-flags as Maintenance Due.
//
// Also exports refreshMaintenanceDue(), the sweep that auto-sets the
// maintenance_due flag from next_service_date + the configured lead time.
const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authRequired, adminOnly } = require('../middleware/auth');

const DEFAULTS = {
  maintenance_due_lead_days: '28', // 4 weeks
};

// Whitelist of editable keys with light validation/coercion.
const EDITABLE = {
  maintenance_due_lead_days: {
    parse: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 365) return null;
      return String(Math.round(n));
    },
  },
};

async function getSetting(key) {
  try {
    const row = await prisma.app_settings.findUnique({ where: { key } });
    if (row && typeof row.value === 'string') return row.value;
  } catch { /* table may not exist yet */ }
  return DEFAULTS[key];
}

async function getLeadDays() {
  const raw = await getSetting('maintenance_due_lead_days');
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 28;
}

/**
 * Auto-set maintenance_due=true for assets whose next_service_date falls within
 * the lead window and aren't already flagged or decommissioned. Manual clears
 * are re-applied only once the service date is pushed out (via Log Maintenance),
 * which is the intended workflow. Never auto-clears — clearing is explicit.
 */
async function refreshMaintenanceDue() {
  try {
    const lead = await getLeadDays();
    const cutoff = new Date();
    cutoff.setHours(23, 59, 59, 999);
    cutoff.setDate(cutoff.getDate() + lead);
    const result = await prisma.assets.updateMany({
      where: {
        maintenance_due: false,
        status: { not: 'End of Life' },
        next_service_date: { not: null, lte: cutoff },
      },
      data: { maintenance_due: true },
    });
    return result.count || 0;
  } catch (e) {
    console.log(JSON.stringify({ at: new Date().toISOString(), lvl: 'WARN', msg: 'refresh-maintenance-due-failed', message: e?.message || String(e) }));
    return 0;
  }
}

// GET /settings — all settings (merged over defaults). Auth required.
router.get('/', authRequired, async (_req, res) => {
  const out = { ...DEFAULTS };
  try {
    const rows = await prisma.app_settings.findMany();
    for (const r of rows) out[r.key] = r.value;
  } catch { /* fall back to defaults */ }
  res.json({ settings: out });
});

// PUT /settings/:key — admin only.
router.put('/:key', authRequired, adminOnly, async (req, res) => {
  const key = String(req.params.key || '');
  const spec = EDITABLE[key];
  if (!spec) return res.status(400).json({ error: `Unknown or read-only setting: ${key}` });
  const parsed = spec.parse(req.body?.value);
  if (parsed === null || parsed === undefined) {
    return res.status(400).json({ error: `Invalid value for ${key}` });
  }
  const actor = req.user?.id || req.headers['x-user-id'] || null;
  try {
    const row = await prisma.app_settings.upsert({
      where: { key },
      update: { value: parsed, updated_by: actor || undefined },
      create: { key, value: parsed, updated_by: actor || undefined },
    });
    // A shorter lead time can newly qualify assets — refresh right away.
    if (key === 'maintenance_due_lead_days') { refreshMaintenanceDue().catch(() => {}); }
    res.json({ key: row.key, value: row.value });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Failed to save setting' });
  }
});

module.exports = router;
module.exports.getSetting = getSetting;
module.exports.getLeadDays = getLeadDays;
module.exports.refreshMaintenanceDue = refreshMaintenanceDue;
