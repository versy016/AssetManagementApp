// routes/bookings.js
// Internal asset bookings — reserve a bookable asset for a project + date window.
// Distinct from Hire (external clients); availability is checked against BOTH
// bookings and hires so an asset is never double-allocated.
//
// Rules (see docs/bookings-plan.md):
//   • start date at most 6 months ahead (hard block)
//   • duration <= 6 weeks auto-confirms; > 6 weeks needs admin approval
//   • no overlap with another live booking or an active hire
//   • blocked when the asset is End of Life / Lost / Stolen
// Visibility: admins see all bookings; users see their own. Availability windows
// for an asset are visible to everyone.
const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { sendExpoPush } = require('../utils/push');

const MAX_ADVANCE_MONTHS = 6;
const MAX_SELF_DAYS = 42; // 6 weeks; longer needs admin approval
const LIVE_STATUSES = ['REQUESTED', 'CONFIRMED', 'ACTIVE']; // hold a slot
const BLOCKED_ASSET_STATUSES = ['end of life', 'lost', 'stolen'];

// ── small helpers (match routes/tasks.js conventions) ──
function rid() {
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
}
function log(reqId, level, msg, extra = {}) {
  console.log(JSON.stringify({ reqId, at: new Date().toISOString(), lvl: level, msg, ...extra }));
}
function errJson(res, status, message, extra = {}) {
  if (!res.headersSent) res.status(status).json({ error: message, ...extra });
}
function getActor(req) {
  const uid = req?.user?.uid;
  if (uid) return String(uid);
  return req?.header?.('X-User-Id') || req?.header?.('x-user-id') || (req?.query ? req.query.uid : null) || null;
}
function getActorInfo(req) {
  return {
    id: getActor(req) || null,
    name: (req?.header?.('X-User-Name') || '').trim(),
    email: (req?.header?.('X-User-Email') || '').trim(),
  };
}
async function actorIsAdmin(actorId) {
  if (!actorId) return false;
  try {
    const u = await prisma.users.findUnique({ where: { id: actorId }, select: { role: true } });
    return String(u?.role || '').toUpperCase() === 'ADMIN';
  } catch { return false; }
}

// ── date helpers (bookings are date-level) ──
const DAY = 86400000;
function parseDate(s) {
  if (!s) return null;
  // Accept 'YYYY-MM-DD' (date-only) or a full ISO string; normalise to UTC midnight.
  const str = String(s);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(str) ? new Date(`${str}T00:00:00Z`) : new Date(str);
  return Number.isNaN(+d) ? null : d;
}
function todayUtc() {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}
function addMonths(date, m) {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + m);
  return d;
}
function durationDays(from, to) {
  return Math.round((+to - +from) / DAY) + 1; // inclusive of both ends
}
// Ranges overlap? `to === null` means open-ended (infinity). Inclusive of ends
// (turnaround buffer is 0 by default).
function overlaps(aFrom, aTo, bFrom, bTo) {
  const aEnd = aTo ? +new Date(aTo) : Infinity;
  const bEnd = bTo ? +new Date(bTo) : Infinity;
  return +new Date(aFrom) <= bEnd && +new Date(bFrom) <= aEnd;
}

const BOOKING_INCLUDE = {
  asset: {
    select: {
      id: true, type_id: true, model: true, serial_number: true, image_url: true,
      status: true, needs_repair: true, maintenance_due: true, next_service_date: true,
      assigned_to_id: true, asset_types: { select: { name: true } },
    },
  },
  booked_by: { select: { id: true, name: true, useremail: true } },
  approver: { select: { id: true, name: true, useremail: true } },
};

function shapeBooking(b) {
  if (!b) return b;
  const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
  return {
    id: b.id,
    assetId: b.asset_id,
    assetTypeName: b.asset?.asset_types?.name || null,
    model: b.asset?.model || null,
    serialNumber: b.asset?.serial_number || null,
    imageUrl: b.asset?.image_url || null,
    assetStatus: b.asset?.status || null,
    bookedById: b.booked_by_id,
    bookedByName: b.booked_by ? (b.booked_by.name || b.booked_by.useremail) : null,
    project: b.project || null,
    projectRef: b.project_ref || null,
    dateFrom: ymd(b.date_from),
    dateTo: ymd(b.date_to),
    status: b.status,
    needsApproval: !!b.needs_approval,
    approvedBy: b.approved_by || null,
    approverName: b.approver ? (b.approver.name || b.approver.useremail) : null,
    checkedOutAt: b.checked_out_at || null,
    returnedAt: b.returned_at || null,
    notes: b.notes || null,
    createdAt: b.created_at,
  };
}

// ── notifications ──
async function pushToUsers(userIds, title, body, data = {}) {
  try {
    const ids = [...new Set((userIds || []).filter(Boolean))];
    if (!ids.length) return;
    const users = await prisma.users.findMany({
      where: { id: { in: ids }, expo_push_token: { not: null } },
      select: { expo_push_token: true },
    });
    const messages = users
      .filter((u) => u.expo_push_token)
      .map((u) => ({ to: u.expo_push_token, title, body, data }));
    if (messages.length) await sendExpoPush(messages);
  } catch (e) {
    log('-', 'WARN', 'booking-push-failed', { message: e.message });
  }
}
async function adminIds() {
  try {
    const admins = await prisma.users.findMany({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
    return admins.map((a) => a.id);
  } catch { return []; }
}

// ── availability: busy windows from bookings + hires ──
async function bookingWindows(assetId, excludeId) {
  const rows = await prisma.bookings.findMany({
    where: {
      asset_id: assetId,
      status: { in: LIVE_STATUSES },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, date_from: true, date_to: true, status: true, booked_by: { select: { name: true, useremail: true } } },
  });
  return rows.map((r) => ({
    kind: 'booking', id: r.id, from: r.date_from, to: r.date_to, status: r.status,
    label: r.booked_by ? (r.booked_by.name || r.booked_by.useremail) : 'Booked',
  }));
}
// A hire's window comes from asset_action_details (hire_start/hire_end). An
// open-ended hire (no hire_end) is treated as ongoing. First-cut heuristic —
// refine once hire close-out is modelled explicitly.
async function hireWindows(assetId) {
  const acts = await prisma.asset_actions.findMany({
    where: { asset_id: assetId, type: 'HIRE' },
    select: { occurred_at: true, details: { select: { hire_start: true, hire_end: true } } },
  });
  const today = todayUtc();
  return acts
    .map((a) => {
      const from = a.details?.hire_start || a.occurred_at || null;
      const to = a.details?.hire_end || null;
      return from ? { kind: 'hire', from, to, label: 'On hire' } : null;
    })
    .filter(Boolean)
    // Drop hires that clearly ended in the past (won't affect future windows).
    .filter((w) => !w.to || +new Date(w.to) >= +today);
}
async function busyWindows(assetId, excludeBookingId) {
  const [b, h] = await Promise.all([bookingWindows(assetId, excludeBookingId), hireWindows(assetId)]);
  return [...b, ...h];
}

// Validate a requested window against rules + availability. Returns { error } or
// { needsApproval }.
async function validateWindow(asset, from, to, excludeBookingId) {
  if (!from || !to) return { error: 'Both a start and end date are required.' };
  if (+to < +from) return { error: 'End date must be on or after the start date.' };
  if (String(asset.status || '').toLowerCase() && BLOCKED_ASSET_STATUSES.includes(String(asset.status).toLowerCase())) {
    return { error: `This asset is ${asset.status} and can't be booked.` };
  }
  const horizon = addMonths(todayUtc(), MAX_ADVANCE_MONTHS);
  if (+from > +horizon) {
    return { error: `Bookings can start at most ${MAX_ADVANCE_MONTHS} months ahead.` };
  }
  const windows = await busyWindows(asset.id, excludeBookingId);
  const clash = windows.find((w) => overlaps(from, to, w.from, w.to));
  if (clash) {
    const cf = new Date(clash.from).toISOString().slice(0, 10);
    const ct = clash.to ? new Date(clash.to).toISOString().slice(0, 10) : 'open';
    return { error: `Clashes with an existing ${clash.kind} (${cf} → ${ct}).`, conflict: { kind: clash.kind, from: cf, to: ct } };
  }
  return { needsApproval: durationDays(from, to) > MAX_SELF_DAYS };
}

// Raise a shared admin task to approve a long booking (reuses the tasks system).
async function createApprovalTask(booking, asset, actorId) {
  try {
    const label = [asset.asset_types?.name || asset.model || 'Asset', asset.id].filter(Boolean).join(' · ');
    await prisma.tasks.create({
      data: {
        title: `Approve booking — ${label}`,
        description: `Booking longer than 6 weeks needs approval: ${new Date(booking.date_from).toISOString().slice(0, 10)} → ${new Date(booking.date_to).toISOString().slice(0, 10)}${booking.project ? ` (${booking.project})` : ''}.`,
        category: 'OTHER',
        priority: 'HIGH',
        asset_id: asset.id,
        created_by: actorId || null,
      },
    });
  } catch (e) {
    log('-', 'WARN', 'booking-approval-task-failed', { message: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /bookings — list. scope=upcoming|past|all (default upcoming). Admins see
// all; users see their own. Filter by status, asset_id, type.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const reqId = rid();
  try {
    const actorId = getActor(req);
    const isAdmin = await actorIsAdmin(actorId);
    const scope = String(req.query.scope || 'upcoming').toLowerCase();
    const today = todayUtc();

    const where = {};
    if (!isAdmin) where.booked_by_id = actorId || '__none__';
    if (req.query.asset_id) where.asset_id = String(req.query.asset_id);
    if (req.query.status) where.status = String(req.query.status).toUpperCase();
    if (req.query.booked_by) where.booked_by_id = String(req.query.booked_by);
    // Calendar passes an explicit from/to window; the list uses scope. Range wins.
    if (req.query.from || req.query.to) {
      if (req.query.from) where.date_to = { gte: parseDate(req.query.from) };
      if (req.query.to) where.date_from = { lte: parseDate(req.query.to) };
    } else if (scope === 'upcoming') {
      where.date_to = { gte: today };
    } else if (scope === 'past') {
      where.date_to = { lt: today };
    }

    const rows = await prisma.bookings.findMany({
      where,
      include: BOOKING_INCLUDE,
      orderBy: [{ date_from: scope === 'past' ? 'desc' : 'asc' }],
    });
    res.json({ items: rows.map(shapeBooking), isAdmin });
  } catch (e) {
    log(reqId, 'ERROR', 'bookings-list-failed', { message: e.message });
    errJson(res, 500, e.message || 'Failed to load bookings');
  }
});

// GET /bookings/availability?asset_id=&from=&to= — busy windows for an asset.
router.get('/availability', async (req, res) => {
  const reqId = rid();
  try {
    const assetId = String(req.query.asset_id || '');
    if (!assetId) return errJson(res, 400, 'asset_id is required');
    const windows = await busyWindows(assetId, null);
    const out = windows.map((w) => ({
      kind: w.kind,
      from: new Date(w.from).toISOString().slice(0, 10),
      to: w.to ? new Date(w.to).toISOString().slice(0, 10) : null,
      label: w.label || null,
      status: w.status || null,
    }));
    res.json({ windows: out });
  } catch (e) {
    log(reqId, 'ERROR', 'bookings-availability-failed', { message: e.message });
    errJson(res, 500, e.message || 'Failed to load availability');
  }
});

// GET /bookings/:id
router.get('/:id', async (req, res) => {
  const reqId = rid();
  try {
    const b = await prisma.bookings.findUnique({ where: { id: req.params.id }, include: BOOKING_INCLUDE });
    if (!b) return errJson(res, 404, 'Booking not found');
    const actorId = getActor(req);
    const isAdmin = await actorIsAdmin(actorId);
    if (!isAdmin && String(b.booked_by_id) !== String(actorId)) return errJson(res, 403, 'Not allowed');
    res.json(shapeBooking(b));
  } catch (e) {
    log(reqId, 'ERROR', 'bookings-get-failed', { message: e.message });
    errJson(res, 500, e.message || 'Failed to load booking');
  }
});

// POST /bookings — create.
router.post('/', async (req, res) => {
  const reqId = rid();
  try {
    const actorId = getActor(req);
    if (!actorId) return errJson(res, 401, 'Sign in to book');
    const { asset_id, project, project_ref, date_from, date_to, notes } = req.body || {};
    if (!asset_id) return errJson(res, 400, 'An asset is required');

    const asset = await prisma.assets.findUnique({
      where: { id: String(asset_id) },
      select: { id: true, status: true, assigned_to_id: true, model: true, type_id: true, asset_types: { select: { name: true, bookable: true } } },
    });
    if (!asset) return errJson(res, 404, 'Asset not found');
    if (!asset.asset_types?.bookable) return errJson(res, 400, "This asset's type isn't bookable.");

    const from = parseDate(date_from);
    const to = parseDate(date_to);
    const v = await validateWindow(asset, from, to, null);
    if (v.error) return errJson(res, 409, v.error, v.conflict ? { conflict: v.conflict } : {});

    const needsApproval = !!v.needsApproval;
    const created = await prisma.bookings.create({
      data: {
        asset_id: asset.id,
        booked_by_id: actorId,
        project: (project || '').trim() || null,
        project_ref: project_ref || null,
        date_from: from,
        date_to: to,
        status: needsApproval ? 'REQUESTED' : 'CONFIRMED',
        needs_approval: needsApproval,
        notes: (notes || '').trim() || null,
      },
      include: BOOKING_INCLUDE,
    });

    // Long booking → raise an admin approval task + notify admins.
    if (needsApproval) {
      await createApprovalTask(created, asset, actorId);
      const admins = await adminIds();
      await pushToUsers(admins, 'Booking needs approval',
        `${created.booked_by?.name || 'A user'} booked ${asset.asset_types?.name || asset.model || 'an asset'} for more than 6 weeks.`,
        { type: 'booking_approval', bookingId: created.id });
    }
    // Notify the current holder if the asset is assigned to someone else.
    if (asset.assigned_to_id && String(asset.assigned_to_id) !== String(actorId)) {
      await pushToUsers([asset.assigned_to_id], 'Asset booked',
        `${created.booked_by?.name || 'Someone'} booked ${asset.asset_types?.name || asset.model || 'an asset'} you hold (${shapeBooking(created).dateFrom}–${shapeBooking(created).dateTo}).`,
        { type: 'booking_created', bookingId: created.id });
    }

    log(reqId, 'INFO', 'booking-created', { id: created.id, needsApproval });
    res.status(201).json(shapeBooking(created));
  } catch (e) {
    log(reqId, 'ERROR', 'booking-create-failed', { message: e.message });
    errJson(res, 500, e.message || 'Failed to create booking');
  }
});

// Load a booking and enforce own-or-admin management rights.
async function loadManageable(req, res) {
  const b = await prisma.bookings.findUnique({ where: { id: req.params.id }, include: BOOKING_INCLUDE });
  if (!b) { errJson(res, 404, 'Booking not found'); return null; }
  const actorId = getActor(req);
  const isAdmin = await actorIsAdmin(actorId);
  if (!isAdmin && String(b.booked_by_id) !== String(actorId)) { errJson(res, 403, 'You can only manage your own bookings'); return null; }
  return { b, actorId, isAdmin };
}

// PATCH /bookings/:id — edit dates/project/notes (re-validated).
router.patch('/:id', async (req, res) => {
  const reqId = rid();
  try {
    const ctx = await loadManageable(req, res);
    if (!ctx) return;
    const { b } = ctx;
    const data = {};
    if ('project' in req.body) data.project = (req.body.project || '').trim() || null;
    if ('project_ref' in req.body) data.project_ref = req.body.project_ref || null;
    if ('notes' in req.body) data.notes = (req.body.notes || '').trim() || null;

    const from = 'date_from' in req.body ? parseDate(req.body.date_from) : b.date_from;
    const to = 'date_to' in req.body ? parseDate(req.body.date_to) : b.date_to;
    if (('date_from' in req.body) || ('date_to' in req.body)) {
      const v = await validateWindow({ id: b.asset_id, status: b.asset?.status, asset_types: b.asset?.asset_types }, from, to, b.id);
      if (v.error) return errJson(res, 409, v.error, v.conflict ? { conflict: v.conflict } : {});
      data.date_from = from;
      data.date_to = to;
      // Re-evaluate approval on duration change.
      const needsApproval = durationDays(from, to) > MAX_SELF_DAYS;
      data.needs_approval = needsApproval;
      if (needsApproval && b.status === 'CONFIRMED') data.status = 'REQUESTED';
    }
    const updated = await prisma.bookings.update({ where: { id: b.id }, data, include: BOOKING_INCLUDE });
    log(reqId, 'INFO', 'booking-updated', { id: b.id });
    res.json(shapeBooking(updated));
  } catch (e) {
    log(reqId, 'ERROR', 'booking-update-failed', { message: e.message });
    errJson(res, 500, e.message || 'Failed to update booking');
  }
});

// DELETE /bookings/:id — cancel (soft: status CANCELLED) then remove.
router.delete('/:id', async (req, res) => {
  const reqId = rid();
  try {
    const ctx = await loadManageable(req, res);
    if (!ctx) return;
    await prisma.bookings.delete({ where: { id: ctx.b.id } });
    log(reqId, 'INFO', 'booking-deleted', { id: ctx.b.id });
    res.json({ ok: true, id: ctx.b.id });
  } catch (e) {
    log(reqId, 'ERROR', 'booking-delete-failed', { message: e.message });
    errJson(res, 500, e.message || 'Failed to remove booking');
  }
});

// Admin: approve / reject a REQUESTED booking.
async function decide(req, res, decision) {
  const reqId = rid();
  try {
    const actorId = getActor(req);
    if (!(await actorIsAdmin(actorId))) return errJson(res, 403, 'Admins only');
    const b = await prisma.bookings.findUnique({ where: { id: req.params.id }, include: BOOKING_INCLUDE });
    if (!b) return errJson(res, 404, 'Booking not found');
    const updated = await prisma.bookings.update({
      where: { id: b.id },
      data: { status: decision === 'approve' ? 'CONFIRMED' : 'REJECTED', needs_approval: false, approved_by: actorId },
      include: BOOKING_INCLUDE,
    });
    await pushToUsers([b.booked_by_id],
      decision === 'approve' ? 'Booking approved' : 'Booking rejected',
      `Your booking of ${b.asset?.asset_types?.name || b.asset?.model || 'the asset'} was ${decision === 'approve' ? 'approved' : 'rejected'}.`,
      { type: 'booking_decision', bookingId: b.id });
    log(reqId, 'INFO', 'booking-decided', { id: b.id, decision });
    res.json(shapeBooking(updated));
  } catch (e) {
    log(reqId, 'ERROR', 'booking-decide-failed', { message: e.message });
    errJson(res, 500, e.message || 'Failed to update booking');
  }
}
router.post('/:id/approve', (req, res) => decide(req, res, 'approve'));
router.post('/:id/reject', (req, res) => decide(req, res, 'reject'));

// Check-out (collected) / return.
router.post('/:id/checkout', async (req, res) => {
  const reqId = rid();
  try {
    const ctx = await loadManageable(req, res);
    if (!ctx) return;
    const updated = await prisma.bookings.update({
      where: { id: ctx.b.id },
      data: { checked_out_at: new Date(), status: 'ACTIVE' },
      include: BOOKING_INCLUDE,
    });
    res.json(shapeBooking(updated));
  } catch (e) {
    log(reqId, 'ERROR', 'booking-checkout-failed', { message: e.message });
    errJson(res, 500, e.message || 'Failed to check out');
  }
});
router.post('/:id/return', async (req, res) => {
  const reqId = rid();
  try {
    const ctx = await loadManageable(req, res);
    if (!ctx) return;
    const updated = await prisma.bookings.update({
      where: { id: ctx.b.id },
      data: { returned_at: new Date(), status: 'COMPLETED' },
      include: BOOKING_INCLUDE,
    });
    res.json(shapeBooking(updated));
  } catch (e) {
    log(reqId, 'ERROR', 'booking-return-failed', { message: e.message });
    errJson(res, 500, e.message || 'Failed to record return');
  }
});

module.exports = router;
