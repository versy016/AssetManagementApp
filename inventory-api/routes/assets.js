// routes/assets.js
const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { sendExpoPush } = require('../utils/push');
const { ASSET_STATUS, ACTION_DB_TYPE, ALLOWED_PATCH_STATUSES } = require('../lib/assetStatus');
const { validate, schemas } = require('../lib/validation');

const AWS = require('aws-sdk');
const multer = require('multer');
const path = require('path');

require('dotenv').config({ path: '../.env' });

// -----------------------------
// Small logger with req-scoped id
// -----------------------------
function rid() {
  // short request id
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
}
function log(reqId, level, msg, extra = {}) {
  const base = { reqId, at: new Date().toISOString(), lvl: level, msg };
  console.log(JSON.stringify({ ...base, ...extra }));
}
function errJson(res, status, message, extra = {}) {
  if (!res.headersSent) {
    res.status(status).json({ error: message, ...extra });
  }
}

// ---------------------------------
// AWS S3 (guard: required env vars)
// ---------------------------------
['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'S3_BUCKET'].forEach((k) => {
  if (!process.env[k]) {
    console.warn(`[WARN] ${k} missing in env (S3 operations may fail).`);
  }
});

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const safeS3Key = (folder, original) => {
  const base = path.basename(original || 'file');
  const clean = base.replace(/[^\w\-.]+/g, '_');
  return `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${clean}`;
};

const uploadToS3 = (file, folder) => {
  const Key = safeS3Key(folder, file.originalname);
  const params = {
    Bucket: process.env.S3_BUCKET,
    Key,
    Body: file.buffer,
    ContentType: file.mimetype || 'application/octet-stream',
  };
  // Some buckets have Object Ownership = Bucket owner enforced and disallow ACLs.
  // Make ACL usage optâ€'in via env to avoid AccessControlListNotSupported.
  if (String(process.env.S3_USE_ACL || '').toLowerCase() === 'true') {
    params.ACL = process.env.S3_ACL || 'public-read';
  }
  // Prefer inline viewing for PDFs
  if (folder === 'documents' && /^application\/pdf$/i.test(file.mimetype || '')) {
    params.ContentDisposition = 'inline';
  }
  return s3.upload(params).promise();
};

// ------------------------------------------------------
// Multer config with limits + field-aware file filtering
// ------------------------------------------------------
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;   // 5MB
const MAX_DOC_BYTES = 10 * 1024 * 1024;  // 10MB

const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  const isImageField = file.fieldname === 'image' || file.fieldname === 'images';
  const isDocField = file.fieldname === 'document';

  if (isImageField) {
    // allow common web image types
    if (/^image\/(png|jpe?g|webp)$/i.test(file.mimetype)) return cb(null, true);
    return cb(new Error('Invalid image type. Allowed: png, jpg, jpeg, webp'), false);
  }
  if (isDocField) {
    // allow common docs
    if (
      /^application\/pdf$/i.test(file.mimetype) ||
      /^application\/vnd.openxmlformats-officedocument\.wordprocessingml\.document$/i.test(file.mimetype) ||
      /^application\/msword$/i.test(file.mimetype)
    ) return cb(null, true);
    return cb(new Error('Invalid document type. Allowed: pdf, doc, docx'), false);
  }
  // unknown field
  return cb(new Error('Unknown upload field'), false);
};

const limits = {
  files: 2,
  // weâ€™ll guard sizes manually based on field name
};

const upload = multer({ storage, fileFilter, limits }).fields([
  { name: 'image', maxCount: 1 },
  { name: 'document', maxCount: 1 },
]);

const multerSingle = multer({ storage, fileFilter, limits });

// Dedicated uploader for multiple action images (service/repair)
const uploadActionImages = multer({
  storage,
  limits: { files: 10, fileSize: MAX_IMAGE_BYTES },
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|webp)$/i.test(file.mimetype || '')) return cb(null, true);
    return cb(new Error('Invalid image type. Allowed: png, jpg, jpeg, webp'), false);
  },
}).array('images', 10);

// Auth middleware (DB role)
const { authRequired, adminOnly, attachUserFromBearerIfPresent } = require('../middleware/auth');

// -----------------------------
// Helpers & validation guards
// -----------------------------
const toDateOrNull = (v) => (v ? new Date(v) : null);
const slugify = (s) =>
  (s || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

const isISODate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isUUID = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const isQRId = (s) => typeof s === 'string' && /^[A-Z0-9]{6,12}$/i.test(s); // your QR short-id style
const ALLOWED_STATUSES = ALLOWED_PATCH_STATUSES;
const ACTION_TYPES = new Set([
  'REPAIR', 'MAINTENANCE', 'HIRE', 'END_OF_LIFE', 'LOST', 'STOLEN', 'CHECK_IN', 'CHECK_OUT', 'TRANSFER', 'STATUS_CHANGE'
]);

/**
 * Strip HTML tags from a string to prevent stored XSS.
 * Applied to all free-text custom field values before persistence.
 * Boolean / number / date / multiselect types are not text and are handled by their own branches.
 */
const stripHtml = (str) => String(str).replace(/<[^>]*>/g, '').trim();

// Encode/Decode dynamic values to/from DB text
const encodeValue = (codeOrSlug, val) => {
  const t = (codeOrSlug || '').toLowerCase();
  if (val === undefined || val === null) return null;
  switch (t) {
    case 'boolean': return String(!!val);
    case 'number':
    case 'currency': return String(val);
    case 'date': return String(val); // expect "YYYY-MM-DD"
    case 'multiselect': return JSON.stringify(Array.isArray(val) ? val : []);
    default: return stripHtml(val); // sanitise free-text to prevent stored XSS
  }
};

const decodeValue = (codeOrSlug, raw) => {
  const t = (codeOrSlug || '').toLowerCase();
  if (raw === null || raw === undefined) return null;
  switch (t) {
    case 'boolean': return String(raw).toLowerCase() === 'true';
    case 'number':
    case 'currency': return Number(raw);
    case 'date': return String(raw);
    case 'multiselect':
      try { return JSON.parse(raw); } catch { return []; }
    default: return String(raw);
  }
};

// Compare values for activity / edit detection (Prisma Date vs ISO string, decimals, dynamic fields)
function activityComparableScalar(v) {
  if (v === undefined) return '__UNDEF__';
  if (v === null || v === '') return null;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isNaN(t) ? null : v.toISOString().slice(0, 10);
  }
  if (typeof v === 'object' && v !== null && typeof v.toDate === 'function') {
    const d = v.toDate();
    const t = d.getTime();
    return Number.isNaN(t) ? null : d.toISOString().slice(0, 10);
  }
  if (typeof v === 'object' && v !== null && typeof v.toNumber === 'function') {
    try {
      return String(v.toNumber());
    } catch {
      return String(v);
    }
  }
  if (typeof v === 'object' && v !== null && typeof v.toFixed === 'function') {
    return v.toString();
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return s;
  }
  return v;
}

function activityScalarEqual(a, b) {
  return activityComparableScalar(a) === activityComparableScalar(b);
}

function activityFieldValuesEqual(code, a, b) {
  const c = String(code || '').toLowerCase();
  if (c === 'multiselect') {
    const norm = (x) => JSON.stringify((Array.isArray(x) ? x.map(String) : []).slice().sort());
    return norm(a) === norm(b);
  }
  if (c === 'boolean') return !!a === !!b;
  if (c === 'number' || c === 'currency') {
    const na = a === null || a === undefined || a === '' ? NaN : Number(a);
    const nb = b === null || b === undefined || b === '' ? NaN : Number(b);
    if (!Number.isFinite(na) && !Number.isFinite(nb)) return true;
    return na === nb;
  }
  if (c === 'date') return activityScalarEqual(a, b);
  const sa = a === null || a === undefined ? '' : String(a).trim();
  const sb = b === null || b === undefined ? '' : String(b).trim();
  return sa === sb;
}

// --------------------------------------------------
// Action helpers
// --------------------------------------------------
function getActor(req) {
  // Prefer middleware-populated user id when available
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
    const existing = await prisma.users.findUnique({ where: { id: userId }, select: { id: true, name: true, useremail: true } });
    if (existing) {
      // Optionally backfill name/email if empty
      const patch = {};
      if (!existing.name && name) patch.name = name;
      if (!existing.useremail && email) patch.useremail = email;
      if (Object.keys(patch).length) {
        await prisma.users.update({ where: { id: userId }, data: patch });
      }
      return existing;
    }
    // Create minimal record if name/email supplied; otherwise create with id only
    const created = await prisma.users.create({
      data: {
        id: userId,
        name: name || userId,
        useremail: email || null,
        userassets: [],
      },
    });
    return created;
  } catch (e) {
    // Non-fatal; we still proceed
    return null;
  }
}

// Touch the asset audit fields
async function touchAsset(reqId, assetId, actor) {
  try {
    const data = { last_updated: new Date() };
    if (actor) data.last_changed_by = String(actor);
    await prisma.assets.update({ where: { id: assetId }, data });
    log(reqId, 'INFO', 'asset-touched', { assetId, actor: actor || null });
  } catch (e) {
    log(reqId, 'ERROR', 'asset-touch-failed', { assetId, message: e?.message || String(e) });
  }
}

async function recordAction(reqId, assetId, type, { note, data, from_user_id, to_user_id, performed_by, details } = {}) {
  try {
    const created = await prisma.asset_actions.create({
      data: {
        asset_id: assetId,
        type,
        note: note ? stripHtml(note) : null,
        data: data || undefined,
        from_user_id: from_user_id || null,
        to_user_id: to_user_id || null,
        performed_by: performed_by || null,
      },
    });
    // Optional structured details
    if (details && typeof details === 'object') {
      const d = normalizeDetails(type, details);
      await prisma.asset_action_details.create({
        data: {
          action_id: created.id,
          action_type: type,
          ...d,
        },
      });
    }
    // Human-readable trail
    const msg = `[${type}] ${note || ''}`.trim();
    await prisma.asset_logs.create({ data: { asset_id: assetId, user_id: performed_by || null, message: msg } });
    // Also reflect last change on the asset itself
    await touchAsset(reqId, assetId, performed_by || null);
    log(reqId, 'INFO', 'record-action-ok', { assetId, type, actionId: created.id });
    return created;
  } catch (e) {
    log(reqId, 'ERROR', 'record-action-failed', { assetId, type, message: e.message });
    throw e;
  }
}

function toDateOrUndef(v) {
  return v ? new Date(v) : undefined;
}

function toDecimalish(v) {
  if (v === null || v === undefined || v === '') return undefined;
  let raw = v;
  if (typeof raw === 'string') {
    // normalize common currency formats: "$1,234.56" or "1 234,56" -> 1234.56
    const s = raw.trim();
    // If string uses comma as decimal and dot/space as thousand: replace thousands, swap comma
    const looksCommaDecimal = /,\d{1,2}$/.test(s) && (s.includes('.') || s.includes(' '));
    if (looksCommaDecimal) {
      raw = s.replace(/[ .]/g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
    } else {
      raw = s.replace(/[^0-9.+-]/g, ''); // drop currency symbols/letters
    }
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  // Clamp to DECIMAL(10,2) safe range (< 1e8)
  const MAX = 99999999.99;
  const clamped = Math.sign(n) * Math.min(Math.abs(n), MAX);
  // Return as string with 2dp so Prisma Decimal stores reliably
  return clamped.toFixed(2);
}

function toPriorityEnum(p) {
  if (!p) return undefined;
  const m = String(p).toUpperCase();
  return ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'].includes(m) ? m : undefined;
}

function normalizeDetails(type, src = {}) {
  const t = String(type);
  const base = {
    date: toDateOrUndef(src.date),
    notes: src.notes || undefined,
  };
  if (t === 'REPAIR' || t === 'MAINTENANCE') {
    return {
      ...base,
      summary: src.summary || undefined,
      estimated_cost: toDecimalish(src.cost ?? src.estimated_cost),
      priority: toPriorityEnum(src.priority),
    };
  }
  if (t === 'HIRE') {
    return {
      ...base,
      hire_to: src.hireTo || src.hire_to || undefined,
      hire_start: toDateOrUndef(src.hireStart || src.hire_start),
      hire_end: toDateOrUndef(src.hireEnd || src.hire_end),
      hire_rate: toDecimalish(src.hireRate || src.hire_rate),
      hire_project: src.project || src.hire_project || undefined,
      hire_client: src.client || src.hire_client || undefined,
    };
  }
  if (t === 'END_OF_LIFE') {
    return { ...base, eol_reason: src.eolReason || src.eol_reason || undefined };
  }
  if (t === 'LOST' || t === 'STOLEN') {
    return {
      ...base,
      where_location: src.where || src.where_location || undefined,
      police_report: t === 'STOLEN' ? (src.policeReport || src.police_report || undefined) : undefined,
    };
  }
  return base;
}

// Validate the dynamic fields payload against the schema (presence + type + options)
// options.skipRequiredLinkedDocuments: when true, do not require linked document for date fields (e.g. for "logging" service; require on sign-off)
async function validateDynamicFields(reqId, typeId, fieldsObj, options = {}) {
  const skipRequiredLinkedDocuments = options.skipRequiredLinkedDocuments === true;
  const defs = await prisma.asset_type_fields.findMany({
    where: { asset_type_id: typeId },
    include: { field_type: true },
    orderBy: [{ display_order: 'asc' }, { created_at: 'asc' }],
  });

  const missing = [];
  const typeErrors = [];

  // Helpers to resolve a value from fieldsObj given a user-entered or stored label/slug
  const bySlug = Object.fromEntries(
    defs.map((d) => [(d.slug || slugify(d.name)), d])
  );
  function getDynamicValue(candidate) {
    const s = String(candidate || '').trim();
    const sNorm = slugify(s);
    if (fieldsObj && Object.prototype.hasOwnProperty.call(fieldsObj, s)) return fieldsObj[s];
    if (fieldsObj && Object.prototype.hasOwnProperty.call(fieldsObj, sNorm)) return fieldsObj[sNorm];
    // Try resolve via known definitions (e.g., user typed label, not slug)
    const def = bySlug[sNorm];
    if (def) {
      const key = def.slug || slugify(def.name);
      if (fieldsObj && Object.prototype.hasOwnProperty.call(fieldsObj, key)) return fieldsObj[key];
    }
    return undefined;
  }

  for (const def of defs) {
    const slug = def.slug || slugify(def.name);
    const code = (def.field_type?.slug || def.field_type?.name || '').toLowerCase();
    const val = fieldsObj?.[slug];

    // presence / required
    if (def.is_required) {
      const empty =
        code === 'multiselect' ? !(Array.isArray(val) && val.length) :
          code === 'boolean' ? false : // boolean false is valid
            val === undefined || val === null || String(val).trim() === '';
      if (empty) missing.push(def.name || slug);
    }

    // type & options guardrails (best-effort)
    if (val !== undefined && val !== null && String(val).length) {
      switch (code) {
        case 'date':
          if (!isISODate(String(val))) typeErrors.push(`${slug} must be YYYY-MM-DD`);
          // Optional coupling: a date can require a companion document field
          try {
            const vr = def.validation_rules && typeof def.validation_rules === 'object'
              ? def.validation_rules
              : (def.validation_rules && typeof def.validation_rules === 'string'
                ? JSON.parse(def.validation_rules)
                : null);
            const opts = def.options && typeof def.options === 'object' ? def.options : null;
            const linkSlug = (vr && (vr.requires_document_slug || vr.require_document_slug)) || (opts && (opts.requires_document_slug || opts.require_document_slug));
            // Allow optional document by flag; default to required (true) for back-compat
            const requireDocFlag = (() => {
              if (!vr) return true;
              const v = vr.requires_document_required ?? vr.require_document_required ?? vr.document_required ?? vr.require_document;
              if (typeof v === 'boolean') return v;
              if (typeof v === 'string') return v.toLowerCase() === 'true';
              return true;
            })();
            if (linkSlug && requireDocFlag && !skipRequiredLinkedDocuments) {
              const requiredSlugs = Array.isArray(linkSlug) ? linkSlug : [linkSlug];
              for (const s of requiredSlugs) {
                const docVal = getDynamicValue(s);
                const emptyDoc = docVal === undefined || docVal === null || String(docVal).trim() === '';
                if (emptyDoc) missing.push(`${def.name || slug} → document '${s}'`);
              }
            }
          } catch (_) { }
          break;
        case 'number':
        case 'currency':
          if (isNaN(Number(val))) typeErrors.push(`${slug} must be a number`);
          break;
        case 'multiselect': {
          if (!Array.isArray(val)) { typeErrors.push(`${slug} must be an array`); break; }
          const opts = Array.isArray(def.options) ? def.options : [];
          if (opts.length) {
            const allowed = new Set(opts.map(o => (typeof o === 'object' ? o.value ?? o.label : o)));
            for (const v of val) {
              if (!allowed.has(v)) typeErrors.push(`${slug} contains invalid option "${v}"`);
            }
          }
          break;
        }
        case 'select': {
          const opts = Array.isArray(def.options) ? def.options : [];
          if (opts.length) {
            const allowed = new Set(opts.map(o => (typeof o === 'object' ? o.value ?? o.label : o)));
            if (!allowed.has(val)) typeErrors.push(`${slug} must be a valid option`);
          }
          break;
        }
        default:
          // length guardrail (prevent megabyte strings into a text column)
          if (String(val).length > 2000) typeErrors.push(`${slug} is too long (max 2000 chars)`);
      }
    }
  }

  if (missing.length || typeErrors.length) {
    const msg = [
      missing.length ? `Missing required: ${missing.join(', ')}` : null,
      typeErrors.length ? `Invalid values: ${typeErrors.join('; ')}` : null
    ].filter(Boolean).join(' | ');
    log(reqId, 'WARN', 'dynamic-fields-validation-failed', { msg });
    const e = new Error(msg);
    e.status = 400;
    throw e;
  }
}

// Build {slug -> def} map
async function getTypeFieldDefsBySlug(typeId) {
  const defs = await prisma.asset_type_fields.findMany({
    where: { asset_type_id: typeId },
    include: { field_type: true },
  });
  const bySlug = {};
  for (const f of defs) {
    const slug = f.slug || slugify(f.name);
    bySlug[slug] = f;
  }
  return bySlug;
}

// -----------------------------
// GET /assets  (debug support)
// -----------------------------
router.get('/', async (req, res) => {
  const reqId = rid();
  const debug = String(req.query.debug || '').toLowerCase() === '1';
  try {
    log(reqId, 'INFO', 'list-assets-start');

    const assets = await prisma.assets.findMany({
      include: {
        asset_types: true,
        users: { select: { id: true, name: true, useremail: true } },
        field_values: {
          include: { asset_type_field: { include: { field_type: true } } },
        },
      },
    });

    // Resolve last_changed_by -> user name/email map
    const changerIds = Array.from(new Set((assets || []).map(a => a.last_changed_by).filter(Boolean)));
    let changerMap = {};
    if (changerIds.length) {
      const changers = await prisma.users.findMany({ where: { id: { in: changerIds } }, select: { id: true, name: true, useremail: true } });
      changerMap = Object.fromEntries(changers.map(u => [u.id, { name: u.name, email: u.useremail }]));
    }

    const shaped = assets.map(a => {
      const fields = {};
      for (const row of a.field_values) {
        const slug = row.asset_type_field.slug;
        const code = row.asset_type_field.field_type?.slug || row.asset_type_field.field_type?.name;
        fields[slug] = decodeValue(code, row.value);
      }
      const { field_values, ...rest } = a;
      const changer = a.last_changed_by ? changerMap[a.last_changed_by] : null;
      const extra = changer ? { last_changed_by_name: changer.name || changer.email || a.last_changed_by, last_changed_by_email: changer.email || null } : {};
      return debug ? { ...rest, ...extra, fields, __raw_field_values: field_values } : { ...rest, ...extra, fields };
    });

    log(reqId, 'INFO', 'list-assets-ok', { count: shaped.length });
    res.json(shaped);
  } catch (error) {
    log(reqId, 'ERROR', 'list-assets-failed', { message: error.message });
    errJson(res, 500, 'Failed to fetch assets', { message: error.message });
  }
});

// ---------------------------------------------------------------
// GET /assets/tasks/count
// Returns the number of overdue/due-soon tasks for the requesting
// user (or all assets if the user is ADMIN). Replaces the 132-line
// N+1 fetchTaskCount.js logic that ran entirely on the client.
// ---------------------------------------------------------------
router.get('/tasks/count', authRequired, async (req, res) => {
  const reqId = rid();
  try {
    const uid = req.user?.uid;
    if (!uid) return errJson(res, 401, 'Unauthorised');

    // Determine role from DB
    const dbUser = await prisma.users.findUnique({
      where: { id: uid },
      select: { role: true },
    });
    const isAdmin = dbUser?.role === 'ADMIN';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Date fields we treat as task triggers (mirrors TOP_DATE_LABELS in fetchTaskCount.js)
    const DATE_FIELDS = [
      'next_service_date', 'service_due', 'service_date',
      'maintenance_due', 'maintenance_date',
      'repair_due', 'repair_date',
      'certificate_expiry', 'cert_expiry',
      'calibration_due', 'calibration_date',
      'inspection_due', 'inspection_date',
      'expiry', 'expires_at',
    ];

    // Build asset filter -- admins see all, normal users see their assigned assets
    const assetWhere = isAdmin
      ? {}
      : {
          OR: [
            { assigned_to_id: uid },
            { assigned_to_id: null },
          ],
        };

    // Fetch all relevant assets in ONE query (no N+1)
    const assets = await prisma.assets.findMany({
      where: assetWhere,
      select: {
        id: true,
        type_id: true,
        description: true,
        field_values: true,
        ...Object.fromEntries(DATE_FIELDS.map((f) => [f, true])),
      },
    });

    // Fetch asset-type field definitions for reminder_lead_days in ONE query
    const typeIds = [...new Set(assets.map((a) => a.type_id).filter(Boolean))];
    const typeDefs = typeIds.length
      ? await prisma.asset_type_fields.findMany({
          where: { asset_type_id: { in: typeIds } },
          select: { asset_type_id: true, slug: true, validation_rules: true },
        })
      : [];

    // Build lead-days map: { typeId: { slug: leadDays } }
    const leadDaysMap = {};
    for (const def of typeDefs) {
      if (!leadDaysMap[def.asset_type_id]) leadDaysMap[def.asset_type_id] = {};
      try {
        const vr =
          def.validation_rules && typeof def.validation_rules === 'object'
            ? def.validation_rules
            : def.validation_rules
              ? JSON.parse(def.validation_rules)
              : null;
        const n = vr && (vr.reminder_lead_days || vr.reminderDays || vr.reminder_days);
        const v = Number(n);
        if (Number.isFinite(v) && v > 0) {
          leadDaysMap[def.asset_type_id][String(def.slug || '').toLowerCase()] = Math.floor(v);
        }
      } catch { /* ignore malformed */ }
    }

    // Count overdue / due-soon tasks across assets
    const seen = new Set();
    const isDateLike = (v) => {
      if (!v) return null;
      if (v instanceof Date) return v;
      const s = String(v).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00');
      const d = new Date(s);
      return Number.isNaN(+d) ? null : d;
    };
    const looksShortId = (id) => /^[A-Z0-9]{6,12}$/i.test(String(id || ''));

    for (const a of assets) {
      // Skip QR-reserved placeholder assets (same heuristic as frontend)
      if (!looksShortId(a.id)) continue;
      if (String(a.description || '').toLowerCase() === 'qr reserved asset') continue;

      const tId = a.type_id || null;
      const leadDays = leadDaysMap[tId] || {};

      // Top-level date columns
      for (const k of DATE_FIELDS) {
        const d = isDateLike(a[k]);
        if (!d) continue;
        if (d < today) seen.add(`${a.id}|top|${k}|${+d}`);
      }

      // Custom field values stored in the JSON `field_values` column
      const f = a.field_values && typeof a.field_values === 'object' ? a.field_values : null;
      if (f) {
        for (const [k, val] of Object.entries(f)) {
          if (!DATE_FIELDS.includes(k) && !/date|due|expiry|expires/i.test(k)) continue;
          const d = isDateLike(val);
          if (!d) continue;
          const daysLead = leadDays[String(k).toLowerCase()] || 0;
          if (d < today) {
            seen.add(`${a.id}|field|${k}|${+d}`);
          } else if (daysLead > 0) {
            const windowEnd = new Date(today.getTime() + daysLead * 24 * 60 * 60 * 1000);
            if (d <= windowEnd) seen.add(`${a.id}|field|${k}|soon|${+d}`);
          }
        }
      }
    }

    // Pending sign-off items
    const signoffWhere = isAdmin
      ? { status: 'pending' }
      : {
          status: 'pending',
          OR: [{ assigned_to_id: uid }, { assigned_to_id: null }],
        };

    let signoffCount = 0;
    try {
      signoffCount = await prisma.asset_actions.count({ where: signoffWhere });
    } catch { /* table may not exist in all envs */ }

    const total = seen.size + signoffCount;
    log(reqId, 'INFO', 'tasks-count', { uid, isAdmin, taskItems: seen.size, signoff: signoffCount, total });
    return res.json({ count: total });
  } catch (e) {
    log(reqId, 'ERROR', 'tasks-count-failed', { message: e?.message || String(e) });
    return errJson(res, 500, 'Failed to compute task count');
  }
});

// ---------------------------------------------------------------
// GET /assets/stats
// Returns a lightweight summary used by the dashboard:
//   - total: total asset count
//   - counts_by_status: { [status]: number }
//   - recent_activity: last 10 actions across all assets with
//     embedded asset name/id/status — replaces the 26-request
//     waterfall (GET /assets + 25× GET /assets/:id/actions).
// ---------------------------------------------------------------
router.get('/stats', async (req, res) => {
  const reqId = rid();
  try {
    const limit = Math.min(parseInt(req.query.limit || '10', 10), 50);

    const [statusGroups, recentActions, total] = await Promise.all([
      // Count assets grouped by status
      prisma.assets.groupBy({
        by: ['status'],
        _count: { status: true },
      }),

      // Last N actions with just enough asset info to render a feed item
      prisma.asset_actions.findMany({
        orderBy: { occurred_at: 'desc' },
        take: limit,
        select: {
          id: true,
          type: true,
          note: true,
          occurred_at: true,
          performed_by: true,
          asset: {
            select: {
              id: true,
              description: true,
              model: true,
              serial_number: true,
              other_id: true,
              status: true,
              image_url: true,
              asset_types: { select: { id: true, name: true } },
            },
          },
          performer: { select: { id: true, name: true, useremail: true } },
          from_user: { select: { id: true, name: true, useremail: true } },
          to_user: { select: { id: true, name: true, useremail: true } },
        },
      }),

      // Total asset count
      prisma.assets.count(),
    ]);

    const counts_by_status = Object.fromEntries(
      statusGroups.map((g) => [g.status, g._count.status])
    );

    const recent_activity = recentActions.map((a) => ({
      id: a.id,
      type: a.type,
      note: a.note,
      occurred_at: a.occurred_at,
      performed_by: a.performer
        ? { id: a.performer.id, name: a.performer.name, email: a.performer.useremail }
        : a.performed_by
          ? { id: a.performed_by }
          : null,
      from: a.from_user
        ? (a.from_user.name || a.from_user.useremail || a.from_user.id)
        : null,
      to: a.to_user ? (a.to_user.name || a.to_user.useremail || a.to_user.id) : null,
      from_user: a.from_user
        ? { id: a.from_user.id, name: a.from_user.name, useremail: a.from_user.useremail }
        : null,
      to_user: a.to_user
        ? { id: a.to_user.id, name: a.to_user.name, useremail: a.to_user.useremail }
        : null,
      asset: a.asset
        ? {
            id: a.asset.id,
            description: a.asset.description || null,
            model: a.asset.model || null,
            serial_number: a.asset.serial_number || null,
            other_id: a.asset.other_id || null,
            status: a.asset.status,
            image_url: a.asset.image_url || null,
            type: a.asset.asset_types ? { id: a.asset.asset_types.id, name: a.asset.asset_types.name } : null,
          }
        : null,
    }));

    log(reqId, 'INFO', 'assets-stats-ok', { total, actions: recent_activity.length });
    res.json({ total, counts_by_status, recent_activity });
  } catch (error) {
    log(reqId, 'ERROR', 'assets-stats-failed', { message: error.message });
    errJson(res, 500, 'Failed to fetch asset stats', { message: error.message });
  }
});

// -------------------------------------------------
// GET /assets/asset-options — dropdown + placeholders
// -------------------------------------------------
router.get('/asset-options', async (req, res) => {
  const reqId = rid();
  try {
    const assetTypes = await prisma.asset_types.findMany();
    const users = await prisma.users.findMany();
    const statuses = [ASSET_STATUS.IN_SERVICE, ASSET_STATUS.ON_HIRE, ASSET_STATUS.REPAIR, ASSET_STATUS.MAINTENANCE, ASSET_STATUS.END_OF_LIFE];

    const placeholders = await prisma.assets.findMany({
      where: {
        serial_number: null,
        model: null,
        assigned_to_id: null,
        type_id: null,
        documentation_url: null,
        image_url: null,
        field_values: { none: {} },
        // Only include placeholders that are In Service (unassigned/ready to use)
        status: { in: ['In Service', 'in service'] },
      },
      select: { id: true },
    });

    // normalize to plain string ids
    const assetIds = placeholders.map(p => p.id);
    log(reqId, 'INFO', 'asset-options', { types: assetTypes.length, users: users.length, placeholders: assetIds.length });
    res.json({ assetTypes, users, statuses, assetIds, models: [] });
  } catch (err) {
    log(rid(), 'ERROR', 'asset-options-failed', { message: err.message });
    errJson(res, 500, 'Failed to fetch dropdown options');
  }
});

// -----------------------------
// GET /assets/asset_types
// -----------------------------
router.get('/asset_types', async (_req, res) => {
  try {
    const types = await prisma.asset_types.findMany();
    res.json(types);
  } catch (err) {
    errJson(res, 500, 'Failed to fetch asset types');
  }
});

// --------------------------------------------------------
// GET /assets/asset-types-summary â€" counts by status/type
// --------------------------------------------------------
router.get('/asset-types-summary', async (_req, res) => {
  try {
    const assetTypes = await prisma.asset_types.findMany();
    const assets = await prisma.assets.findMany({ select: { type_id: true, status: true } });

    const summary = assetTypes.map(type => {
      const filtered = assets.filter(a => a.type_id === type.id);
      const lower = s => (s || '').toLowerCase();
      return {
        id: type.id,
        name: type.name,
        image_url: type.image_url,
        inService: filtered.filter(a => lower(a.status) === 'in service').length,
        endOfLife: filtered.filter(a => lower(a.status) === 'end of life').length,
        repair: filtered.filter(a => lower(a.status) === 'repair').length,
        maintenance: filtered.filter(a => lower(a.status) === 'maintenance').length,
        onHire: filtered.filter(a => lower(a.status) === 'on hire').length,
      };
    });

    res.json(summary);
  } catch (err) {
    errJson(res, 500, 'Failed to fetch asset type summary');
  }
});

// -------------------------------------------------------
// GET /assets/asset-types/:id/fields â€" fields for a type
// -------------------------------------------------------
router.get('/asset-types/:id/fields', async (req, res) => {
  try {
    const typeId = req.params.id;
    const fields = await prisma.asset_type_fields.findMany({
      where: { asset_type_id: typeId },
      orderBy: [{ display_order: 'asc' }, { created_at: 'asc' }],
      include: { field_type: true },
    });
    res.json(fields);
  } catch (err) {
    errJson(res, 500, 'Failed to fetch asset type fields');
  }
});

// -------------------------------------------------------------------
// POST /assets/asset-types/:id/fields â€" create field for a type
// Guardrails: slug uniqueness, cap fields per type, 409 on conflict
// -------------------------------------------------------------------
router.post('/asset-types/:id/fields', authRequired, adminOnly, async (req, res) => {
  const reqId = rid();
  try {
    const asset_type_id = req.params.id;
    const {
      name,
      field_type_id,
      is_required = false,
      options,
      display_order = 0,
      description,
      default_value,
      validation_rules
    } = req.body;

    if (!name || !field_type_id) {
      return errJson(res, 400, 'name and field_type_id are required');
    }

    if (Array.isArray(options) && new Set(options).size !== options.length) {
      return errJson(res, 400, 'Options must be unique');
    }

    const ft = await prisma.field_types.findUnique({ where: { id: field_type_id } });
    if (!ft) return errJson(res, 400, 'Invalid field_type_id');

    const slug = slugify(name);

    // Guard: max fields per type (eg. 200)
    const count = await prisma.asset_type_fields.count({ where: { asset_type_id } });
    if (count >= 200) return errJson(res, 400, 'Field limit reached for this asset type');

    // Guard: unique (asset_type_id, slug)
    const exists = await prisma.asset_type_fields.findFirst({ where: { asset_type_id, slug } });
    if (exists) return errJson(res, 409, `A field with slug "${slug}" already exists for this type`);

    const created = await prisma.asset_type_fields.create({
      data: {
        asset_type_id,
        name,
        slug,
        field_type_id,
        is_required: !!is_required,
        display_order: Number(display_order) || 0,
        ...(description ? { description } : {}),
        ...(default_value ? { default_value } : {}),
        ...(validation_rules ? { validation_rules } : {}),
        ...(Array.isArray(options) ? { options } : {}),
      },
      include: { field_type: true },
    });

    log(reqId, 'INFO', 'create-field-ok', { type: asset_type_id, slug });
    res.status(201).json(created);
  } catch (err) {
    log(reqId, 'ERROR', 'create-field-failed', { message: err.message });
    errJson(res, 500, 'Failed to create asset type field');
  }
});

// ---------------------------------------------
// POST /assets â€" create from placeholder + files
// ---------------------------------------------
router.post('/', authRequired, adminOnly, upload, validate(schemas.createAsset), async (req, res) => {
  const reqId = rid();
  try {
    // Per-file size limits (multer can't do per-field sizes by default)
    const img = req.files?.image?.[0];
    const doc = req.files?.document?.[0];
    if (img && img.size > MAX_IMAGE_BYTES) return errJson(res, 400, 'Image too large (max 5MB)');
    if (doc && doc.size > MAX_DOC_BYTES) return errJson(res, 400, 'Document too large (max 10MB)');

    const data = req.body;

    // Basic top-level guards
    if (!data.type_id) return errJson(res, 400, 'type_id is required');
    if (data.status && !ALLOWED_STATUSES.has(data.status)) {
      return errJson(res, 400, `Invalid status. Allowed: ${[...ALLOWED_STATUSES].join(', ')}`);
    }

    // Parse dynamic fields
    let dynamicFields = {};
    if (data.fields) {
      try {
        dynamicFields = JSON.parse(data.fields);
      } catch {
        return errJson(res, 400, 'Invalid JSON in "fields"');
      }
    }

    // FK checks
    const type = await prisma.asset_types.findUnique({ where: { id: data.type_id } });
    if (!type) return errJson(res, 400, 'Asset type ID does not exist');

    if (data.assigned_to_id) {
      const user = await prisma.users.findUnique({ where: { id: data.assigned_to_id } });
      if (!user) return errJson(res, 400, 'Assigned user ID does not exist');
    }

    // Defer dynamic field validation until after file uploads so URL fields can be auto-filled

    // Resolve placeholder id
    let targetId = data.id || null;
    let placeholder;

    if (targetId) {
      // accept QR or UUID
      if (!(isUUID(targetId) || isQRId(targetId))) {
        return errJson(res, 400, 'Provided asset id is not a valid UUID/QR id');
      }

      placeholder = await prisma.assets.findUnique({ where: { id: targetId } });
      if (!placeholder) return errJson(res, 400, `Provided asset id ${targetId} does not exist`);

      const hasAnyValues = await prisma.asset_field_values.findFirst({
        where: { asset_id: targetId },
        select: { id: true },
      });

      const isFree =
        !placeholder.serial_number &&
        !placeholder.model &&
        !placeholder.assigned_to_id &&
        !placeholder.type_id &&
        !placeholder.documentation_url &&
        !placeholder.image_url &&
        !hasAnyValues;

      if (!isFree) return errJson(res, 400, `Asset id ${targetId} is already in use`);
    } else {
      placeholder = await prisma.assets.findFirst({
        where: {
          serial_number: null,
          model: null,
          assigned_to_id: null,
          type_id: null,
          documentation_url: null,
          image_url: null,
          field_values: { none: {} },
          status: { in: ['In Service', 'in service'] },
        },
      });
      if (!placeholder) return errJson(res, 400, 'No available pre-generated asset IDs. Please generate more QR codes.');
      targetId = placeholder.id;
    }

    // Upload files if any
    const [imageUpload, docUpload] = await Promise.all([
      img ? uploadToS3(img, 'images') : null,
      doc ? uploadToS3(doc, 'documents') : null,
    ]);

    // Resolve field definitions for this type (used for both auto-fill and guards)
    const defsBySlug = await getTypeFieldDefsBySlug(data.type_id);
    const hasCustomNextService = (() => {
      try {
        const f = defsBySlug['next_service_date'];
        const t = String(f?.field_type?.slug || f?.field_type?.name || '').toLowerCase();
        return !!(f && t === 'date');
      } catch { return false; }
    })();

    // Update base record
    const actorInfo = getActorInfo(req);
    if (actorInfo.id) { try { await ensureUserKnown(actorInfo.id, actorInfo.name, actorInfo.email); } catch { } }
    const actor = actorInfo.id || null;
    const updated = await prisma.assets.update({
      where: { id: targetId },
      data: {
        type_id: data.type_id,
        serial_number: data.serial_number ? stripHtml(data.serial_number) : null,
        model: data.model ? stripHtml(data.model) : null,
        description: data.description ? stripHtml(data.description) : null,
        other_id: data.other_id ? stripHtml(data.other_id) : null,
        location: data.location ? stripHtml(data.location) : null,
        status: data.status || ASSET_STATUS.AVAILABLE,
        // If the type defines a dynamic next_service_date, do not write the top-level column
        next_service_date: hasCustomNextService ? null : (data.next_service_date ? new Date(data.next_service_date) : null),
        date_purchased: data.date_purchased ? new Date(data.date_purchased) : null,
        notes: data.notes ? stripHtml(data.notes) : null,

        assigned_to_id: data.assigned_to_id || null,
        documentation_url: docUpload?.Location || null,
        image_url: imageUpload?.Location || null,
        last_changed_by: actor,
        last_updated: new Date(),
      },
    });

    // Prepare dynamic fields: if a URL-type field is present and empty, and a document was uploaded,
    // auto-fill it with the S3 documentation_url so required URL fields pass validation.
    // Also fill any document field required by a date field (e.g. Calibration Certificate Expiry → Calibration Certificate).
    try {
      if (docUpload?.Location || doc) {
        let targets = [];
        try {
          if (req.body?.url_doc_slugs) {
            const arr = typeof req.body.url_doc_slugs === 'string' ? JSON.parse(req.body.url_doc_slugs) : req.body.url_doc_slugs;
            if (Array.isArray(arr)) targets = arr.filter(Boolean).map(String);
          }
        } catch { }

        // Add document slugs required by date fields so the uploaded doc satisfies validation
        for (const def of Object.values(defsBySlug || {})) {
          const code = (def.field_type?.slug || def.field_type?.name || '').toLowerCase();
          if (code !== 'date' && code !== 'datetime') continue;
          const val = dynamicFields?.[def.slug || slugify(def.name)];
          if (val == null || String(val).trim() === '') continue;
          try {
            const vr = def.validation_rules && typeof def.validation_rules === 'object'
              ? def.validation_rules
              : (def.validation_rules ? JSON.parse(def.validation_rules) : null);
            const opts = def.options && typeof def.options === 'object' ? def.options : null;
            const linkSlug = (vr && (vr.requires_document_slug || vr.require_document_slug)) || (opts && (opts.requires_document_slug || opts.require_document_slug));
            if (!linkSlug) continue;
            const requiredSlugs = Array.isArray(linkSlug) ? linkSlug : [linkSlug];
            for (const s of requiredSlugs) {
              const sStr = String(s || '').trim();
              if (!sStr) continue;
              const sNorm = slugify(sStr);
              if (!targets.includes(sNorm)) targets.push(sNorm);
              const docDef = defsBySlug[sNorm];
              if (docDef && (docDef.field_type?.slug || docDef.field_type?.name || '').toLowerCase() === 'url') {
                const key = docDef.slug || slugify(docDef.name);
                if (key && !targets.includes(key)) targets.push(key);
              }
            }
          } catch { }
        }

        const docValue = docUpload?.Location || 'attached';

        if (targets.length) {
          for (const slug of targets) {
            const def = defsBySlug[slug];
            const tslug = def ? (def.field_type?.slug || '').toLowerCase() : '';
            const val = dynamicFields?.[slug];
            const empty = val == null || String(val).trim() === '';
            if (empty) {
              if (!def) {
                dynamicFields[slug] = docValue;
              } else if (tslug === 'url') {
                dynamicFields[slug] = docValue;
              }
            }
          }
        } else {
          // Fallback: first empty URL field
          for (const [slug, def] of Object.entries(defsBySlug || {})) {
            const tslug = (def?.field_type?.slug || '').toLowerCase();
            const val = dynamicFields?.[slug];
            const empty = val == null || String(val).trim() === '';
            if (tslug === 'url' && empty) { dynamicFields[slug] = docValue; break; }
          }
        }
      }
    } catch { }

    // Validate dynamic fields now that we might have auto-filled URL field(s)
    await validateDynamicFields(reqId, data.type_id, dynamicFields);

    // Upsert dynamic values
    const upserts = [];
    for (const [slug, value] of Object.entries(dynamicFields || {})) {
      const def = defsBySlug[slug];
      if (!def) continue; // ignore unknown slug
      const encoded = encodeValue(def.field_type?.slug || def.field_type?.name, value);
      upserts.push(
        prisma.asset_field_values.upsert({
          where: { asset_id_asset_type_field_id: { asset_id: targetId, asset_type_field_id: def.id } },
          update: { value: encoded },
          create: { asset_id: targetId, asset_type_field_id: def.id, value: encoded },
        })
      );
    }
    if (upserts.length) await prisma.$transaction(upserts);

    // Maintain userassets
    if (data.assigned_to_id) {
      const assignedUser = await prisma.users.findUnique({ where: { id: data.assigned_to_id } });
      if (assignedUser) {
        const current = assignedUser.userassets || [];
        if (!current.includes(targetId)) {
          await prisma.users.update({
            where: { id: data.assigned_to_id },
            data: { userassets: { set: [...current, targetId] } },
          });
        }
      }
    }

    // Record creation activity (NEW_ASSET in feed)
    try {
      await recordAction(reqId, targetId, 'STATUS_CHANGE', {
        performed_by: actor,
        note: `New asset ${targetId} created`,
        data: { event: 'ASSET_CREATED' },
      });
    } catch (e) {
      log(reqId, 'ERROR', 'record-create-action-failed', { assetId: targetId, message: e?.message || String(e) });
    }

    log(reqId, 'INFO', 'create-asset-ok', { id: targetId, type_id: data.type_id, dynCount: upserts.length });
    res.status(201).json({ asset: updated });
  } catch (err) {
    log(reqId, 'ERROR', 'create-asset-failed', { message: err.message, stack: err.stack });
    errJson(res, err.status || 500, err.message || 'Error creating asset');
  }
});

// ---------------------------------------------------------------
// PUT /assets/asset-types/:id/fields/:fieldId -- update a type field
// Accepts: { name?, field_type_id?, is_required?, options?, display_order?, description?, default_value?, validation_rules? }
// ---------------------------------------------------------------
router.put('/asset-types/:id/fields/:fieldId', authRequired, adminOnly, async (req, res) => {
  const reqId = rid();
  try {
    const asset_type_id = req.params.id;
    const fieldId = req.params.fieldId;

    // Ensure field belongs to this type
    const existing = await prisma.asset_type_fields.findUnique({ where: { id: fieldId } });
    if (!existing || existing.asset_type_id !== asset_type_id) return errJson(res, 404, 'Field not found');

    const {
      name,
      field_type_id,
      is_required,
      options,
      display_order,
      description,
      default_value,
      validation_rules,
    } = req.body || {};

    const patch = {};
    if (name !== undefined) {
      patch.name = String(name).trim();
      // Keep slug stable unless FE explicitly manages slug separately; preserve existing slug
      // If you do want to recalc slug on rename, uncomment:
      // patch.slug = slugify(patch.name);
    }
    if (field_type_id) {
      const ft = await prisma.field_types.findUnique({ where: { id: field_type_id } });
      if (!ft) return errJson(res, 400, 'Invalid field_type_id');
      patch.field_type_id = field_type_id;
    }
    if (is_required !== undefined) patch.is_required = !!is_required;
    if (Array.isArray(options)) patch.options = options;
    if (display_order !== undefined) patch.display_order = Number(display_order) || 0;
    if (description !== undefined) patch.description = description || null;
    if (default_value !== undefined) patch.default_value = default_value === '' ? null : default_value;
    if (validation_rules !== undefined) {
      let vr = validation_rules;
      try { if (typeof vr === 'string') vr = JSON.parse(vr); } catch { }
      patch.validation_rules = vr;
    }

    if (!Object.keys(patch).length) return errJson(res, 400, 'No fields to update');
    const row = await prisma.asset_type_fields.update({ where: { id: fieldId }, data: patch, include: { field_type: true } });
    log(reqId, 'INFO', 'update-field-ok', { type: asset_type_id, fieldId });
    res.json(row);
  } catch (err) {
    log(reqId, 'ERROR', 'update-field-failed', { message: err.message });
    errJson(res, 500, 'Failed to update asset type field');
  }
});

// ---------------------------------------------------------------
// DELETE /assets/asset-types/:id/fields/:fieldId -- delete field when safe
// Refuse delete when any values exist to prevent orphaning
// ---------------------------------------------------------------
router.delete('/asset-types/:id/fields/:fieldId', authRequired, adminOnly, async (req, res) => {
  const reqId = rid();
  try {
    const asset_type_id = req.params.id;
    const fieldId = req.params.fieldId;
    const existing = await prisma.asset_type_fields.findUnique({ where: { id: fieldId } });
    if (!existing || existing.asset_type_id !== asset_type_id) return errJson(res, 404, 'Field not found');

    const count = await prisma.asset_field_values.count({ where: { asset_type_field_id: fieldId } });
    if (count > 0) return errJson(res, 409, 'Cannot delete: field has existing values');

    await prisma.asset_type_fields.delete({ where: { id: fieldId } });
    log(reqId, 'INFO', 'delete-field-ok', { type: asset_type_id, fieldId });
    res.json({ ok: true });
  } catch (err) {
    log(reqId, 'ERROR', 'delete-field-failed', { message: err.message });
    errJson(res, 500, 'Failed to delete asset type field');
  }
});
// -------------------------------------------------------------
// POST /assets/asset-types/:id/sync -- sync existing assets to latest type schema
// Body (optional): {
//   cleanup: boolean            // remove values for deleted fields
//   fillDefaults: boolean       // create missing values from field.default_value
//   optionValueMap: {           // rename option values for select/multiselect
//     [slug]: { from: string, to: string }
//   }
// }
// -------------------------------------------------------------
router.post('/asset-types/:id/sync', adminOnly, async (req, res) => {
  const reqId = rid();
  const typeId = req.params.id;
  const { cleanup = false, fillDefaults = true, optionValueMap = {} } = req.body || {};
  try {
    const type = await prisma.asset_types.findUnique({ where: { id: typeId } });
    if (!type) return errJson(res, 404, 'Asset type not found');

    const fields = await prisma.asset_type_fields.findMany({ where: { asset_type_id: typeId }, include: { field_type: true } });
    const fieldIds = fields.map(f => f.id);
    const bySlug = Object.fromEntries(fields.map(f => [f.slug || slugify(f.name), f]));

    const assets = await prisma.assets.findMany({ where: { type_id: typeId }, select: { id: true } });
    const assetIds = assets.map(a => a.id);

    // Optional cleanup: remove values for fields that no longer exist
    if (cleanup) {
      await prisma.asset_field_values.deleteMany({
        where: {
          asset_id: { in: assetIds },
          asset_type_field_id: { notIn: fieldIds },
        },
      });
    }

    // Fill defaults for missing values
    if (fillDefaults) {
      for (const f of fields) {
        if (!f.default_value) continue;
        const encodedDefault = encodeValue(f.field_type?.slug || f.field_type?.name, f.default_value);
        // For each asset, ensure a row exists
        for (const a of assets) {
          const exists = await prisma.asset_field_values.findFirst({ where: { asset_id: a.id, asset_type_field_id: f.id }, select: { id: true } });
          if (!exists) {
            try {
              await prisma.asset_field_values.create({ data: { asset_id: a.id, asset_type_field_id: f.id, value: encodedDefault } });
            } catch { }
          }
        }
      }
    }

    // Option value renames
    if (optionValueMap && typeof optionValueMap === 'object') {
      for (const [slug, map] of Object.entries(optionValueMap)) {
        const f = bySlug[slug];
        if (!f) continue;
        const code = String(f.field_type?.slug || f.field_type?.name || '').toLowerCase();
        if (!map || typeof map !== 'object') continue;
        const from = map.from;
        const to = map.to;
        if (!from || !to) continue;
        const rows = await prisma.asset_field_values.findMany({ where: { asset_type_field_id: f.id, asset_id: { in: assetIds } } });
        for (const row of rows) {
          const current = decodeValue(code, row.value);
          let next = current;
          if (code === 'select') {
            if (String(current) === String(from)) next = String(to);
          } else if (code === 'multiselect') {
            const arr = Array.isArray(current) ? current.slice() : [];
            let changed = false;
            for (let i = 0; i < arr.length; i += 1) {
              if (String(arr[i]) === String(from)) { arr[i] = String(to); changed = true; }
            }
            if (changed) next = arr;
          }
          if (next !== current) {
            const encoded = encodeValue(code, next);
            await prisma.asset_field_values.update({ where: { id: row.id }, data: { value: encoded } });
          }
        }
      }
    }

    log(reqId, 'INFO', 'asset-type-sync-ok', { typeId, assets: assetIds.length, fields: fields.length });
    res.json({ ok: true, assets: assetIds.length, fields: fields.length });
  } catch (e) {
    log(reqId, 'ERROR', 'asset-type-sync-failed', { message: e?.message || String(e) });
    errJson(res, 500, e?.message || 'Failed to sync assets for type');
  }
});

// -------------------------------------------------
// POST /assets/:id/files -- upload document only
// Returns { url }
// -------------------------------------------------
router.post('/:id/files', multerSingle.single('document'), async (req, res) => {
  const reqId = rid();
  try {
    const assetId = req.params.id;
    if (!isUUID(assetId) && !isQRId(assetId)) return errJson(res, 400, 'Invalid asset id');
    const doc = req.file;
    if (!doc) return errJson(res, 400, 'No document provided');
    // Size guard
    if (doc.size > MAX_DOC_BYTES) return errJson(res, 400, 'Document too large (max 10MB)');
    const up = await uploadToS3(doc, 'documents');
    return res.json({ url: up?.Location, key: up?.Key });
  } catch (e) {
    log(reqId, 'ERROR', 'upload-doc-failed', { message: e.message });
    return errJson(res, 500, 'Failed to upload document');
  }
});

// -------------------------------------------------
// PUT /assets/:id â€" update (incl. dynamic fields)
// -------------------------------------------------
router.put('/:id', attachUserFromBearerIfPresent, validate(schemas.updateAsset), async (req, res) => {
  const reqId = rid();
  const assetId = req.params.id;
  const { assigned_to_id, assign_to_admin = false, action_note, ...assetData } = req.body;

  try {
    if (!isUUID(assetId) && !isQRId(assetId)) {
      return errJson(res, 400, 'Invalid asset id');
    }

    // Resolve target assignee â€" change only when explicitly requested
    const hasAssignedProp = Object.prototype.hasOwnProperty.call(req.body, 'assigned_to_id');
    const unassignRequested = hasAssignedProp && req.body.assigned_to_id === null && (req.body.allow_unassign === true || req.body.allow_unassign === '1');
    const hasAssignedField = (hasAssignedProp && req.body.assigned_to_id !== null) || !!assign_to_admin || unassignRequested;
    let newUserId = undefined; // undefined means: do not change assignment
    if (hasAssignedField) {
      if (assign_to_admin) {
        const adminUser = await prisma.users.findUnique({ where: { useremail: 'admin@engsurveys.com.au' } });
        if (!adminUser) return errJson(res, 400, 'Admin user not found');
        newUserId = adminUser.id;
      } else if (unassignRequested) {
        newUserId = null;
      } else if (hasAssignedProp) {
        newUserId = assigned_to_id || null; // null only possible with allow_unassign
      }
    }

    const existingAsset = await prisma.assets.findUnique({
      where: { id: assetId },
      include: { asset_types: true },
    });
    if (!existingAsset) return errJson(res, 404, 'Asset not found');

    if (assetData.status && !ALLOWED_STATUSES.has(assetData.status)) {
      return errJson(res, 400, `Invalid status. Allowed: ${[...ALLOWED_STATUSES].join(', ')}`);
    }

    const prevUserId = existingAsset.assigned_to_id;
    const ops = [];

    // Update userassets arrays only when assignment change is requested
    if (hasAssignedField) {
      // userassets removal
      if (prevUserId && prevUserId !== newUserId) {
        const prevUser = await prisma.users.findUnique({ where: { id: prevUserId } });
        if (prevUser) {
          const filtered = (prevUser.userassets || []).filter(a => a !== assetId);
          ops.push(prisma.users.update({ where: { id: prevUserId }, data: { userassets: { set: filtered } } }));
        }
      }

      // userassets add
      if (newUserId) {
        const newUser = await prisma.users.findUnique({ where: { id: newUserId } });
        if (!newUser) return errJson(res, 400, 'Target user not found');
        if (!(newUser.userassets || []).includes(assetId)) {
          ops.push(prisma.users.update({ where: { id: newUserId }, data: { userassets: { push: assetId } } }));
        }
      }
    }

    // Normalize dynamic fields
    let fieldsPatch;
    if (typeof assetData.fields === 'string') {
      try { fieldsPatch = JSON.parse(assetData.fields); } catch { return errJson(res, 400, 'Invalid JSON in "fields"'); }
    } else if (assetData.fields && typeof assetData.fields === 'object') {
      fieldsPatch = assetData.fields;
    }

    const allowedKeys = new Set([
      'type_id',
      'serial_number',
      'model',
      'description',
      'other_id',
      'location',
      'status',
      'next_service_date',
      'date_purchased',
      'notes',
      'documentation_url',
      'image_url',
      // do NOT include `fields` here
    ]);

    const patch = {};
    if (hasAssignedField) patch.assigned_to_id = newUserId || null;
    for (const [k, v] of Object.entries(assetData)) {
      if (allowedKeys.has(k)) patch[k] = v;
    }

    // Date normalization
    if ('next_service_date' in patch) patch.next_service_date = toDateOrNull(patch.next_service_date);
    if ('date_purchased' in patch) patch.date_purchased = toDateOrNull(patch.date_purchased);

    // Serial number is sensitive; only DB admins may change it (status/assignment stay open for workflows).
    const actorForPriv = getActorInfo(req).id || null;
    let callerIsAdmin = false;
    if (actorForPriv) {
      try {
        const dbCaller = await prisma.users.findUnique({ where: { id: actorForPriv }, select: { role: true } });
        callerIsAdmin = String(dbCaller?.role || '').toUpperCase() === 'ADMIN';
      } catch { /* non-fatal */ }
    }
    const serialChanging =
      Object.prototype.hasOwnProperty.call(patch, 'serial_number') &&
      !activityScalarEqual(patch.serial_number, existingAsset.serial_number);
    if (serialChanging && !callerIsAdmin) {
      return errJson(res, 403, 'Only admins can change the asset serial number');
    }

    // âœ… Validate dynamic fields against the effective type
    const effectiveTypeId = patch.type_id || existingAsset.type_id;

    // Canonicalize dynamic field keys to match defined slugs (accept labels as keys)
    let canonicalFields = null;
    /** Slugs whose decoded values actually differ from the merged request (for activity feed). */
    let changedDynamicFieldSlugs = [];
    if (effectiveTypeId) {
      const defsBySlug = await getTypeFieldDefsBySlug(effectiveTypeId);
      const slugifyLocal = (s) => String(s || '').toLowerCase().trim().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');

      // Load existing field values so we validate the merged state (partial update must not require re-sending unchanged document)
      let existingFields = {};
      try {
        const rows = await prisma.asset_field_values.findMany({
          where: { asset_id: assetId },
          include: { asset_type_field: { include: { field_type: true } } },
        });
        for (const row of rows) {
          const slug = row.asset_type_field?.slug || slugifyLocal(row.asset_type_field?.name);
          const code = row.asset_type_field?.field_type?.slug || row.asset_type_field?.field_type?.name;
          if (slug) existingFields[slug] = decodeValue(code, row.value);
        }
      } catch (_) { /* non-fatal */ }

      if (fieldsPatch && typeof fieldsPatch === 'object') {
        const fromPatch = {};
        for (const [k, v] of Object.entries(fieldsPatch)) {
          const kNorm = slugifyLocal(k);
          if (defsBySlug[kNorm]) fromPatch[kNorm] = v; else fromPatch[k] = v;
        }
        const mergedForValidation = { ...existingFields, ...fromPatch };
        if (fromPatch.documentation_url && !patch.documentation_url) {
          patch.documentation_url = fromPatch.documentation_url;
        }
        // Skip required-linked-document check when: client asked to skip, or no actual field updates (status-only/logging).
        const noActualFieldUpdates = Object.keys(fromPatch).length === 0;
        const skipRequiredLinkedDocuments = noActualFieldUpdates
          || req.body.skip_required_documents === true
          || req.body.skip_required_documents === '1'
          || req.body.skip_required_documents === 'true';
        await validateDynamicFields(reqId, effectiveTypeId, mergedForValidation, { skipRequiredLinkedDocuments });
        canonicalFields = fromPatch;
      } else {
        // No fields in request (e.g. status-only update when logging): skip required-linked-document
        // validation so logging Repair/Maintenance does not require documents; enforce on sign-off when fields are sent.
        if (Object.keys(existingFields).length) {
          await validateDynamicFields(reqId, effectiveTypeId, existingFields, { skipRequiredLinkedDocuments: true });
        }
        canonicalFields = null;
      }

      if (canonicalFields && typeof canonicalFields === 'object') {
        for (const [slug, val] of Object.entries(canonicalFields)) {
          const def = defsBySlug[slug];
          if (!def) continue;
          const code = def.field_type?.slug || def.field_type?.name;
          const prev = existingFields[slug];
          if (!activityFieldValuesEqual(code, val, prev)) changedDynamicFieldSlugs.push(slug);
        }
      }
    }

    // Write top-level columns + audit
    const actorInfo = getActorInfo(req);
    if (actorInfo.id) { try { await ensureUserKnown(actorInfo.id, actorInfo.name, actorInfo.email); } catch { } }
    const actor = actorInfo.id || null;
    ops.push(prisma.assets.update({ where: { id: assetId }, data: { ...patch, last_changed_by: actor || undefined, last_updated: new Date() } }));

    // Upsert dynamic fields if provided
    if (canonicalFields && effectiveTypeId) {
      const defsBySlug = await getTypeFieldDefsBySlug(effectiveTypeId);
      for (const [slug, val] of Object.entries(canonicalFields)) {
        const def = defsBySlug[slug];
        if (!def) continue;
        const encoded = encodeValue(def.field_type?.slug || def.field_type?.name, val);
        ops.push(
          prisma.asset_field_values.upsert({
            where: { asset_id_asset_type_field_id: { asset_id: assetId, asset_type_field_id: def.id } },
            update: { value: encoded },
            create: { asset_id: assetId, asset_type_field_id: def.id, value: encoded },
          })
        );
      }
    }

    const result = await prisma.$transaction(ops);

    // After successful update, record actions for assignment/status changes
    const postOps = [];

    // Generic edit activity (exclude pure assignment/status-only changes)
    try {
      const IGNORE = new Set(['assigned_to_id', 'status', 'last_updated', 'last_changed_by']);
      const changedCols = Object.keys(patch || {}).filter(
        (k) => !IGNORE.has(k) && !activityScalarEqual(patch[k], existingAsset[k])
      );
      const changedFieldSlugs = changedDynamicFieldSlugs;
      if ((changedCols && changedCols.length) || (changedFieldSlugs && changedFieldSlugs.length)) {
        postOps.push(
          recordAction(reqId, assetId, 'STATUS_CHANGE', {
            performed_by: actor,
            note: 'Asset edited',
            data: { event: 'ASSET_EDIT', columns: changedCols, fields: changedFieldSlugs },
          })
        );
      }
    } catch (e) {
      // non-fatal
      log(reqId, 'WARN', 'edit-activity-eval-failed', { message: e?.message || String(e) });
    }

    if (hasAssignedField && prevUserId !== newUserId) {
      const noteFromClient = typeof action_note === 'string' && action_note.trim() ? action_note.trim() : null;
      let fromLabel = prevUserId || '';
      let toLabel = newUserId || '';
      try {
        if (prevUserId) {
          const u = await prisma.users.findUnique({ where: { id: prevUserId }, select: { name: true, useremail: true } });
          if (u) fromLabel = u.name || u.useremail || prevUserId;
        }
        if (newUserId) {
          const u2 = await prisma.users.findUnique({ where: { id: newUserId }, select: { name: true, useremail: true } });
          if (u2) toLabel = u2.name || u2.useremail || newUserId;
        }
      } catch { }

      if (assign_to_admin && prevUserId) {
        postOps.push(
          recordAction(reqId, assetId, 'CHECK_IN', {
            performed_by: actor,
            from_user_id: prevUserId,
            to_user_id: newUserId || null,
            note: noteFromClient || `Check-in ${assetId} from ${fromLabel}`,
            data: { prevUserId, newUserId, user_note_text: noteFromClient || undefined },
          })
        );
      } else if (prevUserId && newUserId && prevUserId !== newUserId) {
        postOps.push(
          recordAction(reqId, assetId, 'TRANSFER', {
            performed_by: actor,
            from_user_id: prevUserId,
            to_user_id: newUserId,
            note: noteFromClient || `Transfer ${assetId} from ${fromLabel} to ${toLabel}`,
            data: { prevUserId, newUserId, user_note_text: noteFromClient || undefined },
          })
        );
      } else if (prevUserId && !newUserId) {
        postOps.push(
          recordAction(reqId, assetId, 'CHECK_IN', {
            performed_by: actor,
            from_user_id: prevUserId,
            note: noteFromClient || `Check-in ${assetId} from ${fromLabel}`,
            data: { prevUserId, user_note_text: noteFromClient || undefined },
          })
        );
      } else if (!prevUserId && newUserId) {
        postOps.push(
          recordAction(reqId, assetId, 'CHECK_OUT', {
            performed_by: actor,
            to_user_id: newUserId,
            note: noteFromClient || `Check-out ${assetId} to ${toLabel}`,
            data: { newUserId, user_note_text: noteFromClient || undefined },
          })
        );
      }
    }

    if (assetData.status && assetData.status !== existingAsset.status) {
      postOps.push(
        recordAction(reqId, assetId, 'STATUS_CHANGE', {
          performed_by: actor,
          note: (typeof action_note === 'string' && action_note.trim()) ? action_note.trim() : ('Status: ' + existingAsset.status + ' -> ' + assetData.status),
          data: { prevStatus: existingAsset.status, newStatus: assetData.status, user_note_text: (typeof action_note === 'string' && action_note.trim()) ? action_note.trim() : undefined },
        })
      );
    }

    if (postOps.length) {
      try { await Promise.all(postOps); } catch (e) { /* already logged */ }
    }

    log(reqId, 'INFO', 'update-asset-ok', { id: assetId, ops: result.length });
    res.json({ success: true, updated: result });
  } catch (err) {
    log(reqId, 'ERROR', 'update-asset-failed', { message: err.message });
    errJson(res, 500, 'Failed to update asset', { details: err.message });
  }
});

// ---------------------------------------------
// GET /assets/:id/actions -- list structured actions
// ---------------------------------------------
router.get('/:id/actions', async (req, res) => {
  const assetId = req.params.id;
  try {
    if (!isUUID(assetId) && !isQRId(assetId)) return errJson(res, 400, 'Invalid asset id');
    const actions = await prisma.asset_actions.findMany({
      where: { asset_id: assetId },
      orderBy: { occurred_at: 'desc' },
      include: {
        details: true,
        performer: { select: { id: true, name: true, useremail: true } },
        from_user: { select: { id: true, name: true, useremail: true } },
        to_user: { select: { id: true, name: true, useremail: true } },
      },
    });
    res.json({ count: actions.length, actions });
  } catch (e) {
    errJson(res, 500, e.message || 'Failed to fetch actions');
  }
});

// ---------------------------------------------
// POST /assets/:id/actions -- record an action
// ---------------------------------------------
router.post('/:id/actions', validate(schemas.createAction), async (req, res) => {
  const reqId = rid();
  const assetId = req.params.id;
  try {
    if (!isUUID(assetId) && !isQRId(assetId)) return errJson(res, 400, 'Invalid asset id');
    const assetExists = await prisma.assets.findUnique({ where: { id: assetId }, select: { id: true } });
    if (!assetExists) return errJson(res, 404, 'Asset not found');
    const { type, note, data, performed_by, from_user_id, to_user_id, occurred_at, details } = req.body || {};
    if (!type || !ACTION_TYPES.has(String(type))) return errJson(res, 400, 'Invalid action type');
    const actorInfo = getActorInfo(req);
    const actor = performed_by || actorInfo.id || null;
    // Best-effort: ensure we know this user to resolve names in history
    if (actor) {
      await ensureUserKnown(actor, actorInfo.name, actorInfo.email);
    }
    // route-level occurred_at support: create then patch timestamp if provided
    const action = await recordAction(reqId, assetId, String(type), {
      note,
      data,
      from_user_id,
      to_user_id,
      performed_by: actor,
      details: details || undefined,
    });
    if (occurred_at) {
      try {
        await prisma.asset_actions.update({ where: { id: action.id }, data: { occurred_at: new Date(occurred_at) } });
      } catch { }
    }

    // Auto-assign END_OF_LIFE assets to designated admin
    if (String(type).toUpperCase() === 'END_OF_LIFE') {
      const eolAdminEmail = process.env.EOL_ADMIN_EMAIL;
      if (eolAdminEmail) {
        try {
          // Find admin user by email
          const adminUser = await prisma.users.findFirst({
            where: { useremail: eolAdminEmail }
          });

          if (adminUser) {
            // Get current assignment for transfer record
            const currentAsset = await prisma.assets.findUnique({
              where: { id: assetId },
              select: { assigned_to_id: true }
            });

            // Only reassign if not already assigned to admin
            if (currentAsset && currentAsset.assigned_to_id !== adminUser.id) {
              // Update asset assignment
              await prisma.assets.update({
                where: { id: assetId },
                data: {
                  assigned_to_id: adminUser.id,
                  last_changed_by: actor || undefined,
                  last_updated: new Date()
                }
              });

              // Record transfer action for audit trail
              await recordAction(reqId, assetId, 'TRANSFER', {
                note: 'Automatically assigned to admin due to End of Life status',
                from_user_id: currentAsset.assigned_to_id,
                to_user_id: adminUser.id,
                performed_by: actor,
              });

              log(reqId, 'INFO', 'eol-admin-assignment-ok', { assetId, adminUserId: adminUser.id });
            }
          } else {
            log(reqId, 'WARN', 'eol-admin-not-found', { email: eolAdminEmail });
          }
        } catch (e) {
          log(reqId, 'WARN', 'eol-admin-assignment-failed', { message: e.message });
          // Non-fatal: continue even if assignment fails
        }
      }
    }

    // Notify assigned user via push when a sign-off task is created (REPAIR / MAINTENANCE / HIRE)
    const isSignoff = (req.body?.data && (req.body.data.requires_signoff === true || req.body.data.requires_sign_off === true));
    if (isSignoff && ['REPAIR', 'MAINTENANCE', 'HIRE'].includes(String(type).toUpperCase())) {
      (async () => {
        try {
          const asset = await prisma.assets.findUnique({
            where: { id: assetId },
            select: { assigned_to_id: true },
          });
          const userId = asset?.assigned_to_id || null;
          if (!userId) return;
          const user = await prisma.users.findUnique({
            where: { id: userId },
            select: { expo_push_token: true },
          });
          const token = user?.expo_push_token;
          if (!token || typeof token !== 'string') return;
          const actionLabel = type === 'REPAIR' ? 'Repair' : type === 'MAINTENANCE' ? 'Service' : 'Hire';
          await sendExpoPush([{
            to: token,
            title: 'New task',
            body: `${actionLabel} sign-off required`,
            data: { screen: 'tasks', assetId },
          }]);
        } catch (e) {
          log(reqId, 'WARN', 'push-on-task-created-failed', { message: e?.message });
        }
      })();
    }

    log(reqId, 'INFO', 'create-action-ok', { assetId, type, actionId: action.id });
    res.status(201).json({ action });
  } catch (e) {
    log(reqId, 'ERROR', 'create-action-failed', { assetId, message: e.message });
    errJson(res, 500, e.message || 'Failed to create action');
  }
});

// -------------------------------------------------------
// POST /assets/:id/actions/upload -- with images (S3)
// Only for REPAIR / MAINTENANCE; saves image URLs in action.data.images
// -------------------------------------------------------
router.post('/:id/actions/upload', (req, res) => {
  const reqId = rid();
  uploadActionImages(req, res, async (err) => {
    if (err) {
      return errJson(res, 400, err.message || 'Invalid images');
    }
    const assetId = req.params.id;
    try {
      if (!isUUID(assetId) && !isQRId(assetId)) return errJson(res, 400, 'Invalid asset id');
      const { type, note, occurred_at } = req.body || {};
      let { details } = req.body || {};
      if (!type || !ACTION_TYPES.has(String(type))) return errJson(res, 400, 'Invalid action type');
      const t = String(type).toUpperCase();
      if (!(t === 'REPAIR' || t === 'MAINTENANCE')) return errJson(res, 400, 'Images allowed only for REPAIR or MAINTENANCE');

      // parse details if provided as JSON string
      if (typeof details === 'string') {
        try { details = JSON.parse(details); } catch (_) { details = undefined; }
      } else if (details && typeof details !== 'object') {
        details = undefined;
      }

      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) return errJson(res, 400, 'No images uploaded');

      // Upload all images in parallel to S3
      const uploads = await Promise.all(files.map((f) => uploadToS3(f, 'action-images')));
      const urls = uploads.filter(Boolean).map(u => u.Location).filter(Boolean);

      const actorInfo = getActorInfo(req);
      const actor = actorInfo.id || null;
      if (actor) await ensureUserKnown(actor, actorInfo.name, actorInfo.email);

      // build data payload with images + sign-off flags
      let extraData = undefined;
      try {
        extraData = req.body?.data ? JSON.parse(req.body.data) : undefined;
      } catch (_) { extraData = undefined; }
      const dataPayload = {
        images: urls,
        requires_signoff: true,
        completed: false,
        ...(extraData && typeof extraData === 'object' ? extraData : {}),
      };

      const action = await recordAction(reqId, assetId, t, {
        note: note || null,
        data: dataPayload,
        performed_by: actor,
        details: details || undefined,
      });
      if (occurred_at) {
        try { await prisma.asset_actions.update({ where: { id: action.id }, data: { occurred_at: new Date(occurred_at) } }); } catch { }
      }
      // Push notification for sign-off task (upload always creates requires_signoff)
      (async () => {
        try {
          const asset = await prisma.assets.findUnique({ where: { id: assetId }, select: { assigned_to_id: true } });
          const userId = asset?.assigned_to_id || null;
          if (!userId) return;
          const user = await prisma.users.findUnique({ where: { id: userId }, select: { expo_push_token: true } });
          const token = user?.expo_push_token;
          if (!token || typeof token !== 'string') return;
          const actionLabel = t === 'REPAIR' ? 'Repair' : 'Service';
          await sendExpoPush([{ to: token, title: 'New task', body: `${actionLabel} sign-off required`, data: { screen: 'tasks', assetId } }]);
        } catch (e) {
          log(reqId, 'WARN', 'push-on-task-upload-failed', { message: e?.message });
        }
      })();
      log(reqId, 'INFO', 'create-action-with-images-ok', { assetId, type: t, actionId: action.id, images: urls.length });
      res.status(201).json({ action });
    } catch (e) {
      log(reqId, 'ERROR', 'create-action-with-images-failed', { assetId, message: e.message });
      errJson(res, 500, e.message || 'Failed to create action with images');
    }
  });
});

// -----------------------------
// DELETE /assets/:id
// -----------------------------
router.delete('/:id', authRequired, adminOnly, async (req, res) => {
  const reqId = rid();
  const assetId = req.params.id;
  try {
    if (!isUUID(assetId) && !isQRId(assetId)) return errJson(res, 400, 'Invalid asset id');

    const asset = await prisma.assets.findUnique({
      where: { id: assetId },
      include: { asset_types: true },
    });
    if (!asset) return errJson(res, 404, 'Asset not found');

    // Record deletion snapshot for activity feed
    try {
      const actorInfo = getActorInfo(req);
      await prisma.asset_deletions.create({
        data: {
          asset_id: assetId,
          deleted_by: actorInfo?.id || null,
          asset_name: asset.model || asset.asset_types?.name || null,
          asset_type: asset.asset_types?.name || null,
          image_url: asset.image_url || null,
        },
      });
    } catch (e) {
      log(reqId, 'WARN', 'record-asset-deletion-failed', { id: assetId, message: e?.message || String(e) });
    }

    // Remove references from users.userassets arrays
    const usersWithAsset = await prisma.users.findMany({ where: { userassets: { has: assetId } }, select: { id: true, userassets: true } });
    const ops = [];
    for (const u of usersWithAsset) {
      const filtered = (u.userassets || []).filter((a) => a !== assetId);
      ops.push(prisma.users.update({ where: { id: u.id }, data: { userassets: { set: filtered } } }));
    }
    // Delete logs first (FK is NO ACTION)
    ops.push(prisma.asset_logs.deleteMany({ where: { asset_id: assetId } }));
    // Deleting the asset will cascade to field_values and actions per schema
    ops.push(prisma.assets.delete({ where: { id: assetId } }));

    await prisma.$transaction(ops);
    log(reqId, 'INFO', 'delete-asset-ok', { id: assetId, ops: ops.length });
    res.json({ success: true, id: assetId });
  } catch (err) {
    log(reqId, 'ERROR', 'delete-asset-failed', { id: req.params.id, message: err?.message });
    errJson(res, 400, err.message || 'Failed to delete asset');
  }
});

// ---------------------------------------------
// GET /assets/actions/pending-signoff -- open service/repair/hire needing sign-off
// ---------------------------------------------
router.get('/actions/pending-signoff', async (req, res) => {
  try {
    const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const actions = await prisma.asset_actions.findMany({
      where: {
        type: { in: ['REPAIR', 'MAINTENANCE', 'HIRE'] },
        occurred_at: { gte: since },
      },
      orderBy: { occurred_at: 'desc' },
      include: {
        asset: {
          include: { asset_types: { select: { name: true } } },
        },
        details: true,
      },
      take: 400,
    });
    const pending = actions.filter(a => {
      const d = a?.data || {};
      const need = d && (d.requires_signoff === true || d.requires_sign_off === true);
      const done = d && (d.completed === true || d.signed_off === true);
      return need && !done;
    }).map(a => ({
      actionId: a.id,
      assetId: a.asset_id,
      actionType: a.type,
      occurred_at: a.occurred_at,
      due: a.details?.date || a.occurred_at,
      title: `Sign Off ${a.type === 'MAINTENANCE' ? 'Maintenance' : (a.type === 'REPAIR' ? 'Repair' : 'Hire')}`,
      subtitle: a.asset?.model || a.asset?.description || a.asset?.id,
      model: a.asset?.model || a.asset?.description || null,
      assetTypeName: a.asset?.asset_types?.name || null,
      serialNumber: a.asset?.serial_number ?? null,
      imageUrl: a.asset?.image_url || null,
      typeId: a.asset?.type_id || null,
      assigned_to_id: a.asset?.assigned_to_id || null,
      kind: 'signoff',
      actionImages: Array.isArray(a.data?.images) ? a.data.images : [],
    }));
    res.json({ count: pending.length, items: pending });
  } catch (e) {
    errJson(res, 500, e.message || 'Failed to fetch sign-off tasks');
  }
});

// ---------------------------------------------
// POST /assets/:id/actions/:actionId/signoff -- mark complete and set status
// ---------------------------------------------
router.post('/:id/actions/:actionId/signoff', async (req, res) => {
  const reqId = rid();
  const assetId = req.params.id;
  const actionId = req.params.actionId;
  try {
    if (!isUUID(assetId) && !isQRId(assetId)) return errJson(res, 400, 'Invalid asset id');
    if (!isUUID(actionId)) return errJson(res, 400, 'Invalid action id');
    const { completed = true, note } = req.body || {};
    const actorInfo = getActorInfo(req);
    const action = await prisma.asset_actions.findUnique({ where: { id: actionId }, include: { asset: true } });
    if (!action || action.asset_id !== assetId) return errJson(res, 404, 'Action not found');

    // Merge JSON flags
    const nowIso = new Date().toISOString();
    const merged = {
      ...(action.data || {}),
      requires_signoff: true,
      completed: !!completed,
      signed_off_at: nowIso,
      signed_off_by: actorInfo.id || null,
      ...(note ? { signed_off_note: String(note) } : {}),
    };
    await prisma.asset_actions.update({ where: { id: actionId }, data: { data: merged } });

    // If completed: move asset to In Service
    if (completed === true) {
      await prisma.assets.update({ where: { id: assetId }, data: { status: ASSET_STATUS.IN_SERVICE, last_updated: new Date(), last_changed_by: actorInfo.id || null } });
      await prisma.asset_logs.create({ data: { asset_id: assetId, user_id: actorInfo.id || null, message: `Sign-off complete -> ${ASSET_STATUS.IN_SERVICE}` } });
    }

    log(reqId, 'INFO', 'signoff-ok', { assetId, actionId, completed: !!completed });
    res.json({ ok: true, completed: !!completed });
  } catch (e) {
    log(reqId, 'ERROR', 'signoff-failed', { assetId, actionId, message: e.message });
    errJson(res, 500, e.message || 'Failed to sign off');
  }
});

// ---------------------------------------------
// PUT /assets/:id/files â€" update image/document
// ---------------------------------------------
router.put('/:id/files', (req, res) => {
  upload(req, res, async (err) => {
    if (err) return errJson(res, 400, err.message || 'Upload failed');
    const assetId = req.params.id;
    if (!isUUID(assetId) && !isQRId(assetId)) return errJson(res, 400, 'Invalid asset id');

    const img = req.files?.image?.[0];
    const doc = req.files?.document?.[0];
    if (!img && !doc) return errJson(res, 400, 'No files uploaded');
    if (img && img.size > MAX_IMAGE_BYTES) return errJson(res, 400, 'Image too large (max 5MB)');
    if (doc && doc.size > MAX_DOC_BYTES) return errJson(res, 400, 'Document too large (max 10MB)');

    try {
      const [imgUp, docUp] = await Promise.all([
        img ? uploadToS3(img, 'images') : null,
        doc ? uploadToS3(doc, 'documents') : null,
      ]);

      const patch = {};
      if (imgUp) patch.image_url = imgUp.Location;
      if (docUp) patch.documentation_url = docUp.Location;

      const actorInfo = getActorInfo(req);
      if (actorInfo.id) { try { await ensureUserKnown(actorInfo.id, actorInfo.name, actorInfo.email); } catch { } }
      const actor = actorInfo.id || null;
      const updated = await prisma.assets.update({ where: { id: assetId }, data: { ...patch, last_changed_by: actor || undefined, last_updated: new Date() } });
      res.json({ success: true, asset: updated });
    } catch (e) {
      errJson(res, 500, e.message || 'Failed to update files');
    }
  });
});

// ------------------------------------------------------
// POST /assets/asset-types â€" create asset type (image)
// ------------------------------------------------------
router.post('/asset-types', authRequired, adminOnly, multerSingle.single('image'), async (req, res) => {
  try {
    const { name } = req.body;
    const imageFile = req.file;

    if (!name || !imageFile) return errJson(res, 400, 'Name and image are required');
    if (imageFile.size > MAX_IMAGE_BYTES) return errJson(res, 400, 'Image too large (max 5MB)');

    const uploadResult = await uploadToS3(imageFile, 'asset-type-images');

    const newType = await prisma.asset_types.create({
      data: { name, image_url: uploadResult.Location },
    });

    res.status(201).json({ assetType: newType });
  } catch (err) {
    errJson(res, 500, 'Failed to create asset type');
  }
});

// ------------------------------------------------------
// POST /assets/swap-qr â€" move an asset onto a new QR id (placeholder)
// Body: { from_id: existingAssetId, to_id: placeholderQrId }
// Moves core fields, field_values, actions, logs. Resets old record to placeholder.
// ------------------------------------------------------
router.post('/swap-qr', authRequired, async (req, res) => {
  const reqId = rid();
  const { from_id, to_id } = req.body || {};
  if (!from_id || !to_id) return errJson(res, 400, 'from_id and to_id are required');
  if (!(isUUID(from_id) || isQRId(from_id))) return errJson(res, 400, 'from_id invalid');
  if (!(isUUID(to_id) || isQRId(to_id))) return errJson(res, 400, 'to_id invalid');

  try {
    // Resolve actor for audit
    const actorInfo = getActorInfo(req);
    const actor = actorInfo?.id || null;
    if (actor) { try { await ensureUserKnown(actor, actorInfo?.name, actorInfo?.email); } catch { } }

    const result = await prisma.$transaction(async (tx) => {
      const from = await tx.assets.findUnique({ where: { id: from_id } });
      const to = await tx.assets.findUnique({ where: { id: to_id } });

      if (!from) throw new Error('Source asset not found');
      if (!to) throw new Error('Target placeholder not found');

      // Validate target is an empty placeholder (no details, no assignment) and status Available
      const toHasAnyValues = await tx.asset_field_values.findFirst({ where: { asset_id: to_id }, select: { id: true } });
      const toStatus = String(to.status || '').toLowerCase();
      const toIsEmpty = !to.serial_number && !to.model && !to.assigned_to_id && !to.type_id && !to.documentation_url && !to.image_url && !to.other_id && !toHasAnyValues;
      const toIsPlaceholder = toIsEmpty && (toStatus === 'available');
      if (!toIsPlaceholder) throw new Error('Target ID is not an empty placeholder');

      // Move field values
      await tx.asset_field_values.updateMany({ where: { asset_id: from_id }, data: { asset_id: to_id } });
      // Move logs and actions
      await tx.asset_logs.updateMany({ where: { asset_id: from_id }, data: { asset_id: to_id } });
      await tx.asset_actions.updateMany({ where: { asset_id: from_id }, data: { asset_id: to_id } });

      // Update target record with source core fields
      const updatedTo = await tx.assets.update({
        where: { id: to_id },
        data: {
          type_id: from.type_id,
          serial_number: from.serial_number,
          model: from.model,
          description: from.description,
          other_id: from.other_id,
          location: from.location,
          status: from.status,
          next_service_date: from.next_service_date,
          date_purchased: from.date_purchased,
          notes: from.notes,
          assigned_to_id: from.assigned_to_id,
          documentation_url: from.documentation_url,
          image_url: from.image_url,
          last_changed_by: from.last_changed_by,
        },
      });

      // Reset source record to End of Life so it cannot be reused as a placeholder
      await tx.asset_field_values.deleteMany({ where: { asset_id: from_id } });
      await tx.assets.update({
        where: { id: from_id },
        data: {
          type_id: null,
          serial_number: null,
          model: null,
              description: 'QR decommissioned',
          location: null,
          status: ASSET_STATUS.END_OF_LIFE,
          next_service_date: null,
          date_purchased: null,
          notes: null,
          assigned_to_id: null,
          documentation_url: null,
          image_url: null,
        },
      });

      // Update users.userassets arrays to replace from_id with to_id wherever present
      const carriers = await tx.users.findMany({
        where: { userassets: { has: from_id } },
        select: { id: true, userassets: true },
      });
      for (const u of carriers) {
        const next = (u.userassets || []).map((a) => (a === from_id ? to_id : a));
        await tx.users.update({ where: { id: u.id }, data: { userassets: { set: next } } });
      }

      // Audit trail
      await tx.asset_logs.create({ data: { asset_id: to_id, user_id: actor, message: `QR swap: ${from_id} -> ${to_id}` } });
      await tx.asset_logs.create({ data: { asset_id: from_id, user_id: actor, message: `QR swapped to ${to_id}` } });

      return updatedTo;
    });

    log(reqId, 'INFO', 'swap-qr-ok', { from_id, to_id });
    // Record an activity item on the new asset id so it shows in the feed
    try {
      await recordAction(reqId, to_id, 'STATUS_CHANGE', {
        performed_by: actorInfo?.id || null,
        note: 'Imported asset assigned to this QR',
        data: { event: 'QR_ASSIGN', from_id, to_id },
      });
    } catch (e) {
      log(reqId, 'WARN', 'swap-qr-action-record-failed', { message: e?.message || String(e) });
    }
    res.json({ ok: true, to: result, from_id, to_id });
  } catch (e) {
    log(reqId, 'ERROR', 'swap-qr-failed', { from_id, to_id, message: e.message });
    errJson(res, 400, e.message || 'Swap failed');
  }
});

// -------------------------------------------------------------
// GET /assets/:id -- single asset (decoded fields, debug toggle)
// -------------------------------------------------------------
router.get('/:id', async (req, res) => {
  const debug = String(req.query.debug || '').toLowerCase() === '1';
  try {
    const asset = await prisma.assets.findUnique({
      where: { id: req.params.id },
      include: {
        asset_types: true,
        users: true,
        field_values: {
          include: { asset_type_field: { include: { field_type: true } } },
        },
      },
    });
    if (!asset) return errJson(res, 404, 'Asset not found');

    let last_changed_by_name = null;
    let last_changed_by_email = null;
    if (asset.last_changed_by) {
      try {
        const u = await prisma.users.findUnique({ where: { id: asset.last_changed_by }, select: { name: true, useremail: true } });
        if (u) { last_changed_by_name = u.name || u.useremail || asset.last_changed_by; last_changed_by_email = u.useremail || null; }
      } catch { }
    }

    const fields = {};
    for (const row of asset.field_values) {
      const slug = row.asset_type_field.slug;
      const code = row.asset_type_field.field_type?.slug || row.asset_type_field.field_type?.name;
      fields[slug] = decodeValue(code, row.value);
    }

    const { field_values, ...rest } = asset;
    const extra = { last_changed_by_name, last_changed_by_email };
    res.json(debug ? { ...rest, ...extra, fields, __raw_field_values: field_values } : { ...rest, ...extra, fields });
  } catch (err) {
    errJson(res, 500, 'Failed to fetch asset');
  }
});

// -------------------------------------------------------------------
// GET /assets/assigned/:userId -- assets for a user (decoded fields)
// -------------------------------------------------------------------
router.get('/assigned/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;

    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (!user) return errJson(res, 404, 'User not found');

    const assets = await prisma.assets.findMany({
      where: { id: { in: user.userassets || [] } },
      include: {
        asset_types: true,
        users: true,
        field_values: {
          include: { asset_type_field: { include: { field_type: true } } },
        },
      },
    });

    const changerIds = Array.from(new Set((assets || []).map(a => a.last_changed_by).filter(Boolean)));
    let changerMap = {};
    if (changerIds.length) {
      const changers = await prisma.users.findMany({ where: { id: { in: changerIds } }, select: { id: true, name: true, useremail: true } });
      changerMap = Object.fromEntries(changers.map(u => [u.id, { name: u.name, email: u.useremail }]));
    }

    const shaped = assets.map(a => {
      const fields = {};
      for (const row of a.field_values) {
        const slug = row.asset_type_field.slug;
        const code = row.asset_type_field.field_type?.slug || row.asset_type_field.field_type?.name;
        fields[slug] = decodeValue(code, row.value);
      }
      const { field_values, ...rest } = a;
      const changer = a.last_changed_by ? changerMap[a.last_changed_by] : null;
      const extra = changer ? { last_changed_by_name: changer.name || changer.email || a.last_changed_by, last_changed_by_email: changer.email || null } : {};
      return { ...rest, ...extra, fields };
    });

    res.json(shaped);
  } catch (err) {
    errJson(res, 500, 'Failed to fetch assigned assets');
  }
});

module.exports = router;
