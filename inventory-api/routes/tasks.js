// routes/tasks.js
// User-created (manual) tasks — persisted CRUD with an explicit lifecycle.
// Distinct from the computed task list (overdue dates / pending sign-offs).
//
// Visibility (mirrors pending sign-off rules):
//   • Admins see every task.
//   • A user sees tasks that are unassigned (shared), assigned to them, or
//     created by them.
// Management (edit / complete / dismiss / delete):
//   • Admin, the creator, or the assignee.
const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { getLeadDays } = require('./settings');

// ── Unified task-feed helpers (server-computed; mirrors the old client logic) ──
// Human labels for date-based tasks (top-level column + dynamic date fields).
const TASK_DATE_LABELS = {
  next_service_date: 'Next Service', service_due: 'Service', service_date: 'Service',
  maintenance_due: 'Maintenance', maintenance_date: 'Maintenance',
  repair_due: 'Repair', repair_date: 'Repair',
  certificate_expiry: 'Certificate Expiry', cert_expiry: 'Certificate Expiry',
  calibration_due: 'Calibration', calibration_date: 'Calibration',
  inspection_due: 'Inspection', inspection_date: 'Inspection',
  expiry: 'Expiry', expires_at: 'Expiry',
};
const DATE_SLUG_SET = new Set(Object.keys(TASK_DATE_LABELS));
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const addDays = (base, n) => new Date(base.getTime() + n * 24 * 60 * 60 * 1000);
const looksShortId = (id) => /^[A-Z0-9]{6,12}$/i.test(String(id || ''));
function toDateOrNull(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(+v) ? null : v;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00');
  const d = new Date(s);
  return Number.isNaN(+d) ? null : d;
}
function labelForDateKey(k) {
  return TASK_DATE_LABELS[k] || String(k).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function rid() {
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
}
function log(reqId, level, msg, extra = {}) {
  console.log(JSON.stringify({ reqId, at: new Date().toISOString(), lvl: level, msg, ...extra }));
}
function errJson(res, status, message, extra = {}) {
  if (!res.headersSent) res.status(status).json({ error: message, ...extra });
}

const CATEGORIES = ['GENERAL', 'SERVICE', 'REPAIR', 'MAINTENANCE', 'INSPECTION', 'CERTIFICATE', 'OTHER'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];

// When a task is created against an asset, raise an OVERLAY FLAG on the asset
// (Needs Repair / Maintenance Due) — NOT the base status. Repair/Maintenance are no
// longer base statuses; they're flags that coexist with In Service/On Hire.
// Rule: ANY task raises Maintenance Due, EXCEPT a Repair task, which raises Needs
// Repair (repair logged via scan is the only exception). Completing the task clears
// whichever flag it raised.
const flagForCategory = (category) =>
  String(category || '').toUpperCase() === 'REPAIR' ? 'needs_repair' : 'maintenance_due';

// On completion, log the work to the asset's Maintenance history with this
// action type (so it appears in the Maintenance tab). Others stay plain notes.
const MAINTENANCE_ACTION_FOR_CATEGORY = {
  REPAIR: 'REPAIR',
  SERVICE: 'MAINTENANCE',
  MAINTENANCE: 'MAINTENANCE',
  INSPECTION: 'MAINTENANCE',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUUID = (s) => typeof s === 'string' && UUID_RE.test(s);

function getActor(req) {
  const uid = req?.user?.uid;
  if (uid) return String(uid);
  return (
    req?.header?.('X-User-Id') ||
    req?.header?.('x-user-id') ||
    (req?.query ? req.query.uid : null) ||
    null
  );
}
function getActorInfo(req) {
  const id = getActor(req) || null;
  const name = (req?.header?.('X-User-Name') || req?.header?.('x-user-name') || '').trim();
  const email = (req?.header?.('X-User-Email') || req?.header?.('x-user-email') || '').trim().toLowerCase();
  return { id, name: name || null, email: email || null };
}
async function ensureUserKnown(userId, name, email) {
  try {
    if (!userId) return null;
    const existing = await prisma.users.findUnique({ where: { id: userId }, select: { id: true } });
    if (existing) return existing;
    return await prisma.users.create({
      data: { id: userId, name: name || userId, useremail: email || null, userassets: [] },
    });
  } catch {
    return null;
  }
}
async function actorIsAdmin(actorId) {
  if (!actorId) return false;
  try {
    const u = await prisma.users.findUnique({ where: { id: actorId }, select: { role: true } });
    return String(u?.role || '').toUpperCase() === 'ADMIN';
  } catch { return false; }
}

const TASK_INCLUDE = {
  asset: {
    select: {
      id: true, type_id: true, model: true, serial_number: true, image_url: true,
      status: true, needs_repair: true, maintenance_due: true,
      asset_types: { select: { name: true } },
    },
  },
  assignee: { select: { id: true, name: true, useremail: true } },
  creator: { select: { id: true, name: true, useremail: true } },
};

function shapeTask(t) {
  return {
    id: t.id,
    title: t.title,
    description: t.description || null,
    category: t.category,
    cert_type: t.cert_type || null,
    priority: t.priority,
    status: t.status,
    due_date: t.due_date,
    asset_id: t.asset_id || null,
    assetTypeId: t.asset?.type_id || null,
    assetModel: t.asset?.model || null,
    assetSerial: t.asset?.serial_number || null,
    assetImageUrl: t.asset?.image_url || null,
    assetTypeName: t.asset?.asset_types?.name || null,
    assigned_to_id: t.assigned_to_id || null,
    assigneeName: t.assignee ? (t.assignee.name || t.assignee.useremail) : null,
    created_by: t.created_by || null,
    creatorName: t.creator ? (t.creator.name || t.creator.useremail) : null,
    completed_by: t.completed_by || null,
    completed_at: t.completed_at,
    completion_note: t.completion_note || null,
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
}

function parseDueDate(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00Z') : new Date(s);
  return Number.isNaN(+d) ? undefined : d; // undefined => invalid
}

function canManage(task, actorId, isAdmin) {
  if (isAdmin) return true;
  if (!actorId) return false;
  return String(task.created_by || '') === String(actorId)
    || String(task.assigned_to_id || '') === String(actorId);
}

// GET /tasks?status=OPEN — list tasks visible to the actor.
router.get('/', async (req, res) => {
  const reqId = rid();
  try {
    const status = String(req.query.status || 'OPEN').toUpperCase();
    const actorInfo = getActorInfo(req);
    const actorId = actorInfo.id || null;
    const isAdmin = await actorIsAdmin(actorId);

    const where = {};
    if (status && status !== 'ALL') where.status = status;
    // Non-admins see ONLY tasks assigned to them (strict). Admins see everything.
    if (!isAdmin) {
      where.assigned_to_id = actorId || '__no_user__';
    }

    const rows = await prisma.tasks.findMany({
      where,
      include: TASK_INCLUDE,
      orderBy: [{ due_date: 'asc' }, { created_at: 'desc' }],
      take: 500,
    });
    res.json({ items: rows.map(shapeTask) });
  } catch (e) {
    log(reqId, 'ERROR', 'tasks-list-failed', { message: e.message });
    errJson(res, 500, e.message || 'Failed to load tasks');
  }
});

// ---------------------------------------------------------------------------
// GET /tasks/feed — the UNIFIED task list, computed server-side. Merges:
//   • manual tasks (tasks table)
//   • overlay-flag tasks (assets.needs_repair / maintenance_due)
//   • date tasks (next_service_date + dynamic date fields; overdue OR in lead)
//   • pending sign-offs (asset_actions with requires_signoff)
// Visibility: non-admins see only items assigned to them. This replaces the
// old client-side merge (3 fetches + N+1) and the drift between it and the count.
// ---------------------------------------------------------------------------
router.get('/feed', async (req, res) => {
  const reqId = rid();
  try {
    const actorInfo = getActorInfo(req);
    const actorId = actorInfo.id || null;
    const isAdmin = await actorIsAdmin(actorId);
    const lead = await getLeadDays();
    const today = startOfToday();
    const NOMATCH = '__no_user__';
    const items = [];

    // ── 1) Manual tasks ──
    const manualWhere = { status: 'OPEN' };
    if (!isAdmin) manualWhere.assigned_to_id = actorId || NOMATCH;
    const manual = await prisma.tasks.findMany({
      where: manualWhere, include: TASK_INCLUDE,
      orderBy: [{ due_date: 'asc' }, { created_at: 'desc' }], take: 500,
    });
    // Assets already represented by an open manual Repair/Maintenance task — their
    // matching flag task is suppressed below so one manual task ≠ two rows.
    const coveredByManual = { needs_repair: new Set(), maintenance_due: new Set() };
    for (const t of manual) {
      const cat = String(t.category || '').toUpperCase();
      const actionType = cat === 'REPAIR' ? 'REPAIR' : (cat === 'SERVICE' || cat === 'MAINTENANCE' ? 'MAINTENANCE' : '');
      // A manual task raises Needs Repair (repair) or Maintenance Due (everything
      // else) on its asset — suppress the matching flag-derived card so one task ≠
      // two rows. Mirrors flagForCategory on the write side.
      if (t.asset_id) {
        if (cat === 'REPAIR') coveredByManual.needs_repair.add(t.asset_id);
        else coveredByManual.maintenance_due.add(t.asset_id);
      }
      items.push({
        kind: 'manual', taskId: t.id, key: `manual:${t.id}`,
        title: t.title, description: t.description || '',
        subtitle: t.asset?.asset_types?.name || t.asset?.model || null,
        model: t.asset?.model || null, assetTypeName: t.asset?.asset_types?.name || null,
        serialNumber: t.asset?.serial_number || null, imageUrl: t.asset?.image_url || null,
        assetId: t.asset_id || null, assetTypeId: t.asset?.type_id || null,
        due: t.due_date || null, priority: t.priority, category: t.category,
        certType: t.cert_type || null, actionType, taskStatus: t.status,
        // status/flags reflect the LINKED ASSET (for the status badge on the card).
        status: t.asset?.status || null,
        needs_repair: !!t.asset?.needs_repair, maintenance_due: !!t.asset?.maintenance_due,
        assignedToId: t.assigned_to_id || null,
        assigneeName: t.assignee ? (t.assignee.name || t.assignee.useremail) : null,
        creatorName: t.creator ? (t.creator.name || t.creator.useremail) : null,
        createdBy: t.created_by || null,
      });
    }

    // ── 2) Assets in scope → flag tasks + date tasks ──
    const assetWhere = isAdmin ? {} : { assigned_to_id: actorId || NOMATCH };
    const assets = await prisma.assets.findMany({
      where: assetWhere,
      select: {
        id: true, type_id: true, model: true, serial_number: true, description: true,
        image_url: true, status: true, needs_repair: true, maintenance_due: true,
        next_service_date: true, assigned_to_id: true,
        asset_types: { select: { name: true } },
        field_values: { select: { value: true, asset_type_field: { select: { slug: true } } } },
      },
    });
    // Per-type/field reminder_lead_days for dynamic date fields.
    const typeIds = [...new Set(assets.map((a) => a.type_id).filter(Boolean))];
    const leadDaysMap = {};
    if (typeIds.length) {
      const defs = await prisma.asset_type_fields.findMany({
        where: { asset_type_id: { in: typeIds } },
        select: { asset_type_id: true, slug: true, validation_rules: true },
      });
      for (const d of defs) {
        try {
          const vr = d.validation_rules && typeof d.validation_rules === 'object'
            ? d.validation_rules : (d.validation_rules ? JSON.parse(d.validation_rules) : null);
          const n = Number(vr && (vr.reminder_lead_days || vr.reminderDays || vr.reminder_days));
          if (Number.isFinite(n) && n > 0) {
            (leadDaysMap[d.asset_type_id] = leadDaysMap[d.asset_type_id] || {})[String(d.slug || '').toLowerCase()] = Math.floor(n);
          }
        } catch { /* ignore malformed */ }
      }
    }

    for (const a of assets) {
      if (!looksShortId(a.id)) continue;
      if (String(a.description || '').toLowerCase() === 'qr reserved asset') continue;
      const identity = {
        assetId: a.id,
        subtitle: a.model || a.asset_types?.name || a.id,
        model: a.model || null, assetTypeName: a.asset_types?.name || null,
        serialNumber: a.serial_number != null && String(a.serial_number).trim() !== '' ? String(a.serial_number) : null,
        imageUrl: a.image_url || null, typeId: a.type_id || null,
        assigned_to_id: a.assigned_to_id || null,
        status: a.status, needs_repair: !!a.needs_repair, maintenance_due: !!a.maintenance_due,
      };

      if (a.needs_repair === true && !coveredByManual.needs_repair.has(a.id)) {
        items.push({ ...identity, title: 'Needs repair', due: null, kind: 'flag', flag: 'needs_repair', type: 'REPAIR', key: `${a.id}|flag|needs_repair` });
      }
      if (a.maintenance_due === true && !coveredByManual.maintenance_due.has(a.id)) {
        items.push({ ...identity, title: 'Maintenance due', due: null, kind: 'flag', flag: 'maintenance_due', type: 'MAINTENANCE', key: `${a.id}|flag|maintenance_due` });
      }

      // Top-level next service date — overdue OR within the lead window.
      const topD = toDateOrNull(a.next_service_date);
      if (topD && a.maintenance_due !== true) {
        const overdue = topD < today;
        const soon = !overdue && topD <= addDays(today, lead);
        if (overdue || soon) {
          const label = labelForDateKey('next_service_date');
          items.push({
            ...identity, title: overdue ? `${label} Overdue` : `${label} due`, due: topD,
            fieldKey: 'next_service_date', scope: 'top', key: `${a.id}|top||`,
            maintenance_due: true, // this task IS the asset being due for maintenance
          });
        }
      }

      // Dynamic date fields (overdue, or due-soon when the field has a lead).
      for (const row of a.field_values || []) {
        const k = row.asset_type_field?.slug;
        if (!k) continue;
        const kl = String(k).toLowerCase();
        if (!DATE_SLUG_SET.has(kl) && !/date|due|expiry|expires/i.test(k)) continue;
        const d = toDateOrNull(row.value);
        if (!d) continue;
        const daysLead = (leadDaysMap[a.type_id] || {})[kl] || 0;
        const overdue = d < today;
        const soon = !overdue && daysLead > 0 && d <= addDays(today, daysLead);
        if (!overdue && !soon) continue;
        const label = labelForDateKey(k);
        items.push({
          ...identity, title: overdue ? `${label} Overdue` : label, due: d,
          fieldKey: k, scope: 'field', key: `${a.id}|field|${k}|${overdue ? '' : 'soon|'}${+d}`,
        });
      }
    }

    // ── 3) Pending sign-offs ──
    const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const actionWhere = { type: { in: ['REPAIR', 'MAINTENANCE', 'HIRE'] }, occurred_at: { gte: since } };
    if (!isAdmin) actionWhere.asset = { assigned_to_id: actorId || NOMATCH };
    const actions = await prisma.asset_actions.findMany({
      where: actionWhere,
      include: { asset: { include: { asset_types: { select: { name: true } } } }, details: true },
      orderBy: { occurred_at: 'desc' }, take: 400,
    });
    for (const act of actions) {
      const dta = act.data || {};
      const need = dta.requires_signoff === true || dta.requires_sign_off === true;
      const done = dta.completed === true || dta.signed_off === true;
      if (!need || done) continue;
      const asset = act.asset || {};
      items.push({
        kind: 'signoff', actionId: act.id, assetId: act.asset_id, actionType: act.type,
        occurred_at: act.occurred_at, due: act.details?.date || act.occurred_at,
        title: `Sign Off ${act.type === 'MAINTENANCE' ? 'Maintenance' : (act.type === 'REPAIR' ? 'Repair' : 'Hire')}`,
        subtitle: asset.model || asset.description || asset.id,
        model: asset.model || asset.description || null,
        assetTypeName: asset.asset_types?.name || null,
        serialNumber: asset.serial_number ?? null, imageUrl: asset.image_url || null,
        typeId: asset.type_id || null, assigned_to_id: asset.assigned_to_id || null,
        actionImages: Array.isArray(dta.images) ? dta.images : [],
        status: asset.status ?? null, needs_repair: !!asset.needs_repair, maintenance_due: !!asset.maintenance_due,
      });
    }

    // ── Dedup + sort (soonest due first; undated flags after) ──
    const seen = new Set();
    const deduped = items.filter((it) => {
      const key = it.actionId ? `action:${it.actionId}` : (it.key || `${it.assetId || ''}|${it.title || ''}|${it.due ? +new Date(it.due) : ''}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((x, y) => {
      const dx = x.due ? new Date(x.due).getTime() : Infinity;
      const dy = y.due ? new Date(y.due).getTime() : Infinity;
      return dx - dy;
    });

    log(reqId, 'INFO', 'tasks-feed-ok', { uid: actorId, isAdmin, count: deduped.length });
    res.json({ items: deduped, isAdmin });
  } catch (e) {
    log(reqId, 'ERROR', 'tasks-feed-failed', { message: e.message });
    errJson(res, 500, e.message || 'Failed to load task feed');
  }
});

// POST /tasks — create a manual task.
router.post('/', async (req, res) => {
  const reqId = rid();
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) return errJson(res, 400, 'Title is required');
    if (title.length > 200) return errJson(res, 400, 'Title is too long (max 200 characters)');

    const description = b.description != null ? String(b.description).trim().slice(0, 2000) : null;
    const category = CATEGORIES.includes(String(b.category || '').toUpperCase()) ? String(b.category).toUpperCase() : 'GENERAL';
    const priority = PRIORITIES.includes(String(b.priority || '').toUpperCase()) ? String(b.priority).toUpperCase() : 'MEDIUM';
    // Certificate sub-type only applies to the CERTIFICATE category.
    const certType = category === 'CERTIFICATE' && b.cert_type ? String(b.cert_type).trim().slice(0, 60) : null;

    const due = parseDueDate(b.due_date);
    if (due === undefined) return errJson(res, 400, 'Invalid due date');

    let assetId = b.asset_id ? String(b.asset_id) : null;
    if (assetId) {
      const a = await prisma.assets.findUnique({ where: { id: assetId }, select: { id: true } });
      if (!a) return errJson(res, 400, 'Linked asset not found');
    }

    const actorInfo = getActorInfo(req);
    const actorId = actorInfo.id || null;
    if (actorId) await ensureUserKnown(actorId, actorInfo.name, actorInfo.email);
    const creatorIsAdmin = await actorIsAdmin(actorId);

    // Non-admins can't pick an assignee, so their tasks default to themselves —
    // otherwise (with strict assigned-to-me visibility) they'd never see them.
    let assignedToId = b.assigned_to_id ? String(b.assigned_to_id) : null;
    if (!assignedToId && !creatorIsAdmin && actorId) assignedToId = actorId;
    if (assignedToId) {
      const u = await prisma.users.findUnique({ where: { id: assignedToId }, select: { id: true } });
      if (!u) return errJson(res, 400, 'Assigned user not found');
    }

    const created = await prisma.tasks.create({
      data: {
        title,
        description: description || null,
        category,
        cert_type: certType,
        priority,
        status: 'OPEN',
        due_date: due || null,
        asset_id: assetId,
        assigned_to_id: assignedToId,
        created_by: actorId,
      },
      include: TASK_INCLUDE,
    });

    // Raise the matching overlay flag on the linked asset (Needs Repair /
    // Maintenance Due) — base status is left untouched.
    const flagKey = assetId ? flagForCategory(category) : null;
    if (flagKey) {
      try {
        await prisma.assets.update({
          where: { id: assetId },
          data: { [flagKey]: true, last_updated: new Date(), last_changed_by: actorId || undefined },
        });
        const flagLabel = flagKey === 'needs_repair' ? 'Needs repair' : 'Maintenance due';
        await prisma.asset_actions.create({
          data: {
            asset_id: assetId,
            type: 'STATUS_CHANGE',
            note: `${flagLabel} set for task: ${title}`,
            data: { task_id: created.id, [flagKey]: true },
            performed_by: actorId,
          },
        });
      } catch (e) {
        log(reqId, 'WARN', 'task-flag-update-failed', { id: created.id, message: e.message });
      }
    }

    log(reqId, 'INFO', 'task-created', { id: created.id, flag: flagKey || undefined });
    res.status(201).json(shapeTask(created));
  } catch (e) {
    log(reqId, 'ERROR', 'task-create-failed', { message: e.message });
    errJson(res, 500, e.message || 'Failed to create task');
  }
});

// PATCH /tasks/:id — edit an open task's fields.
router.patch('/:id', async (req, res) => {
  const reqId = rid();
  const id = req.params.id;
  try {
    if (!isUUID(id)) return errJson(res, 400, 'Invalid task id');
    const task = await prisma.tasks.findUnique({ where: { id } });
    if (!task) return errJson(res, 404, 'Task not found');

    const actorInfo = getActorInfo(req);
    const actorId = actorInfo.id || null;
    const isAdmin = await actorIsAdmin(actorId);
    if (!canManage(task, actorId, isAdmin)) return errJson(res, 403, 'You cannot edit this task');

    const b = req.body || {};
    const data = {};
    if (b.title != null) {
      const t = String(b.title).trim();
      if (!t) return errJson(res, 400, 'Title is required');
      if (t.length > 200) return errJson(res, 400, 'Title is too long (max 200 characters)');
      data.title = t;
    }
    if (b.description !== undefined) data.description = b.description ? String(b.description).trim().slice(0, 2000) : null;
    if (b.category != null && CATEGORIES.includes(String(b.category).toUpperCase())) data.category = String(b.category).toUpperCase();
    if (b.priority != null && PRIORITIES.includes(String(b.priority).toUpperCase())) data.priority = String(b.priority).toUpperCase();
    // Certificate sub-type: keep in sync with category; clear when not a certificate.
    if (b.cert_type !== undefined || data.category !== undefined) {
      const newCategory = data.category || task.category;
      if (newCategory === 'CERTIFICATE') {
        if (b.cert_type !== undefined) data.cert_type = b.cert_type ? String(b.cert_type).trim().slice(0, 60) : null;
      } else {
        data.cert_type = null;
      }
    }
    if (b.due_date !== undefined) {
      const due = parseDueDate(b.due_date);
      if (due === undefined) return errJson(res, 400, 'Invalid due date');
      data.due_date = due || null;
    }
    if (b.asset_id !== undefined) {
      let assetId = b.asset_id ? String(b.asset_id) : null;
      if (assetId) {
        const a = await prisma.assets.findUnique({ where: { id: assetId }, select: { id: true } });
        if (!a) return errJson(res, 400, 'Linked asset not found');
      }
      data.asset_id = assetId;
    }
    if (b.assigned_to_id !== undefined) {
      const assignedToId = b.assigned_to_id ? String(b.assigned_to_id) : null;
      if (assignedToId) {
        const u = await prisma.users.findUnique({ where: { id: assignedToId }, select: { id: true } });
        if (!u) return errJson(res, 400, 'Assigned user not found');
      }
      data.assigned_to_id = assignedToId;
    }

    const updated = await prisma.tasks.update({ where: { id }, data, include: TASK_INCLUDE });
    log(reqId, 'INFO', 'task-updated', { id });
    res.json(shapeTask(updated));
  } catch (e) {
    log(reqId, 'ERROR', 'task-update-failed', { id, message: e.message });
    errJson(res, 500, e.message || 'Failed to update task');
  }
});

// Shared close handler (complete | dismiss).
async function closeTask(req, res, nextStatus) {
  const reqId = rid();
  const id = req.params.id;
  try {
    if (!isUUID(id)) return errJson(res, 400, 'Invalid task id');
    const task = await prisma.tasks.findUnique({ where: { id } });
    if (!task) return errJson(res, 404, 'Task not found');

    const actorInfo = getActorInfo(req);
    const actorId = actorInfo.id || null;
    const isAdmin = await actorIsAdmin(actorId);
    if (!canManage(task, actorId, isAdmin)) return errJson(res, 403, 'You cannot modify this task');
    if (actorId) await ensureUserKnown(actorId, actorInfo.name, actorInfo.email);

    // Completion requires a sign-off note describing the work done.
    const note = String(req.body?.note ?? '').trim().slice(0, 2000);
    if (nextStatus === 'COMPLETED' && !note) {
      return errJson(res, 400, 'Please provide completion details to sign off this task');
    }
    const imageUrl = req.body?.image_url ? String(req.body.image_url) : null;

    const updated = await prisma.tasks.update({
      where: { id },
      data: {
        status: nextStatus,
        completed_by: actorId,
        completed_at: new Date(),
        completion_note: note || null,
      },
      include: TASK_INCLUDE,
    });

    // On completion of an asset-linked task, log it to the asset's history.
    // Service/Maintenance/Repair/Inspection tasks log a MAINTENANCE/REPAIR work
    // entry (so they appear in the Maintenance tab, with the photo attached);
    // everything else logs a plain note.
    if (nextStatus === 'COMPLETED' && task.asset_id) {
      try {
        const noteTxt = `Task completed: ${task.title}${note ? ` — ${note}` : ''}`;
        const maintType = MAINTENANCE_ACTION_FOR_CATEGORY[task.category];
        if (maintType) {
          const action = await prisma.asset_actions.create({
            data: {
              asset_id: task.asset_id,
              type: maintType,
              note: noteTxt,
              data: {
                task_completed: true,
                task_id: id,
                images: imageUrl ? [imageUrl] : [],
                signed_off_at: new Date().toISOString(),
              },
              performed_by: actorId,
            },
          });
          await prisma.asset_action_details.create({
            data: {
              action_id: action.id,
              action_type: maintType,
              date: new Date(),
              summary: task.title,
              notes: note || null,
            },
          });
        } else {
          await prisma.asset_actions.create({
            data: {
              asset_id: task.asset_id,
              type: 'STATUS_CHANGE',
              note: noteTxt,
              data: { task_completed: true, task_id: id, user_note_text: noteTxt, note_only: true },
              performed_by: actorId,
            },
          });
        }
      } catch (e) {
        log(reqId, 'WARN', 'task-history-log-failed', { id, message: e.message });
      }
      // Clear the overlay flag the task raised (repair done / maintenance done).
      const clearFlag = flagForCategory(task.category);
      if (clearFlag) {
        try {
          await prisma.assets.update({
            where: { id: task.asset_id },
            data: { [clearFlag]: false, last_updated: new Date(), last_changed_by: actorId || undefined },
          });
        } catch (e) {
          log(reqId, 'WARN', 'task-flag-clear-failed', { id, message: e.message });
        }
      }
    }
    log(reqId, 'INFO', 'task-closed', { id, status: nextStatus });
    res.json(shapeTask(updated));
  } catch (e) {
    log(reqId, 'ERROR', 'task-close-failed', { id, status: nextStatus, message: e.message });
    errJson(res, 500, e.message || 'Failed to update task');
  }
}

// POST /tasks/:id/complete
router.post('/:id/complete', (req, res) => closeTask(req, res, 'COMPLETED'));
// POST /tasks/:id/dismiss
router.post('/:id/dismiss', (req, res) => closeTask(req, res, 'DISMISSED'));

// DELETE /tasks/:id — hard delete (admin or creator).
router.delete('/:id', async (req, res) => {
  const reqId = rid();
  const id = req.params.id;
  try {
    if (!isUUID(id)) return errJson(res, 400, 'Invalid task id');
    const task = await prisma.tasks.findUnique({ where: { id } });
    if (!task) return errJson(res, 404, 'Task not found');
    const actorInfo = getActorInfo(req);
    const actorId = actorInfo.id || null;
    const isAdmin = await actorIsAdmin(actorId);
    const isCreator = !!actorId && String(task.created_by || '') === String(actorId);
    if (!isAdmin && !isCreator) return errJson(res, 403, 'You cannot delete this task');
    await prisma.tasks.delete({ where: { id } });
    log(reqId, 'INFO', 'task-deleted', { id });
    res.json({ ok: true, id });
  } catch (e) {
    log(reqId, 'ERROR', 'task-delete-failed', { id, message: e.message });
    errJson(res, 500, e.message || 'Failed to delete task');
  }
});

module.exports = router;
