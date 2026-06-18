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

// When a task is created against an asset, reflect the work on the asset's
// status where the category maps to one. Categories not listed leave it alone.
const STATUS_FOR_CATEGORY = {
  REPAIR: 'Repair',
  SERVICE: 'Maintenance',
  MAINTENANCE: 'Maintenance',
  INSPECTION: 'Maintenance',
};

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
    if (!isAdmin) {
      where.OR = [
        { assigned_to_id: null },
        ...(actorId ? [{ assigned_to_id: actorId }, { created_by: actorId }] : []),
      ];
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

    const assignedToId = b.assigned_to_id ? String(b.assigned_to_id) : null;
    if (assignedToId) {
      const u = await prisma.users.findUnique({ where: { id: assignedToId }, select: { id: true } });
      if (!u) return errJson(res, 400, 'Assigned user not found');
    }

    const actorInfo = getActorInfo(req);
    const actorId = actorInfo.id || null;
    if (actorId) await ensureUserKnown(actorId, actorInfo.name, actorInfo.email);

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

    // Reflect the task on the linked asset's status (and log it to history).
    const newStatus = assetId ? STATUS_FOR_CATEGORY[category] : null;
    if (newStatus) {
      try {
        await prisma.assets.update({
          where: { id: assetId },
          data: { status: newStatus, last_updated: new Date(), last_changed_by: actorId || undefined },
        });
        await prisma.asset_actions.create({
          data: {
            asset_id: assetId,
            type: 'STATUS_CHANGE',
            note: `Status set to ${newStatus} for task: ${title}`,
            data: { task_id: created.id, status: newStatus },
            performed_by: actorId,
          },
        });
      } catch (e) {
        log(reqId, 'WARN', 'task-status-update-failed', { id: created.id, message: e.message });
      }
    }

    log(reqId, 'INFO', 'task-created', { id: created.id, status: newStatus || undefined });
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
