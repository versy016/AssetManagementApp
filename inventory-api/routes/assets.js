// routes/assets.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('../generated/prisma');
const prisma = new PrismaClient();

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
  accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region:          process.env.AWS_REGION,
});

const safeS3Key = (folder, original) => {
  const base = path.basename(original || 'file');
  const clean = base.replace(/[^\w\-.]+/g, '_');
  return `${folder}/${Date.now()}-${Math.random().toString(36).slice(2,8)}-${clean}`;
};

const uploadToS3 = (file, folder) => {
  const Key = safeS3Key(folder, file.originalname);
  const params = {
    Bucket: process.env.S3_BUCKET,
    Key,
    Body: file.buffer,
    ContentType: file.mimetype || 'application/octet-stream',
    ACL: 'public-read',
  };
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
const MAX_DOC_BYTES   = 10 * 1024 * 1024;  // 10MB

const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  const isImageField = file.fieldname === 'image';
  const isDocField   = file.fieldname === 'document';

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
  // we’ll guard sizes manually based on field name
};

const upload = multer({ storage, fileFilter, limits }).fields([
  { name: 'image',    maxCount: 1 },
  { name: 'document', maxCount: 1 },
]);

const multerSingle = multer({ storage, fileFilter, limits });

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
const ALLOWED_STATUSES = new Set(['In Service', 'End of Life','Repair', 'Maintenance' ]);

// Encode/Decode dynamic values to/from DB text
const encodeValue = (codeOrSlug, val) => {
  const t = (codeOrSlug || '').toLowerCase();
  if (val === undefined || val === null) return null;
  switch (t) {
    case 'boolean':     return String(!!val);
    case 'number':
    case 'currency':    return String(val);
    case 'date':        return String(val); // expect "YYYY-MM-DD"
    case 'multiselect': return JSON.stringify(Array.isArray(val) ? val : []);
    default:            return String(val);
  }
};

const decodeValue = (codeOrSlug, raw) => {
  const t = (codeOrSlug || '').toLowerCase();
  if (raw === null || raw === undefined) return null;
  switch (t) {
    case 'boolean':     return String(raw).toLowerCase() === 'true';
    case 'number':
    case 'currency':    return Number(raw);
    case 'date':        return String(raw);
    case 'multiselect':
      try { return JSON.parse(raw); } catch { return []; }
    default:            return String(raw);
  }
};

// Validate the dynamic fields payload against the schema (presence + type + options)
async function validateDynamicFields(reqId, typeId, fieldsObj) {
  const defs = await prisma.asset_type_fields.findMany({
    where:   { asset_type_id: typeId },
    include: { field_type: true },
    orderBy: [{ display_order: 'asc' }, { created_at: 'asc' }],
  });

  const missing = [];
  const typeErrors = [];

  for (const def of defs) {
    const slug = def.slug || slugify(def.name);
    const code = (def.field_type?.slug || def.field_type?.name || '').toLowerCase();
    const val  = fieldsObj?.[slug];

    // presence / required
    if (def.is_required) {
      const empty =
        code === 'multiselect' ? !(Array.isArray(val) && val.length) :
        code === 'boolean'     ? false : // boolean false is valid
        val === undefined || val === null || String(val).trim() === '';
      if (empty) missing.push(def.name || slug);
    }

    // type & options guardrails (best-effort)
    if (val !== undefined && val !== null && String(val).length) {
      switch (code) {
        case 'date':
          if (!isISODate(String(val))) typeErrors.push(`${slug} must be YYYY-MM-DD`);
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

    const shaped = assets.map(a => {
      const fields = {};
      for (const row of a.field_values) {
        const slug = row.asset_type_field.slug;
        const code = row.asset_type_field.field_type?.slug || row.asset_type_field.field_type?.name;
        fields[slug] = decodeValue(code, row.value);
      }
      const { field_values, ...rest } = a;
      return debug ? { ...rest, fields, __raw_field_values: field_values } : { ...rest, fields };
    });

    log(reqId, 'INFO', 'list-assets-ok', { count: shaped.length });
    res.json(shaped);
  } catch (error) {
    log(reqId, 'ERROR', 'list-assets-failed', { message: error.message });
    errJson(res, 500, 'Failed to fetch assets', { message: error.message });
  }
});

// -------------------------------------------------
// GET /assets/asset-options — dropdown + placeholders
// -------------------------------------------------
router.get('/asset-options', async (req, res) => {
  const reqId = rid();
  try {
    const assetTypes = await prisma.asset_types.findMany();
    const users      = await prisma.users.findMany();
    const statuses   = ['In Service', 'End of Life','Repair', 'Maintenance' ];

    const placeholders = await prisma.assets.findMany({
      where: {
        serial_number: null,
        model:         null,
        assigned_to_id:null,
        type_id:       null,
        documentation_url: null,
        image_url:        null,
        field_values: { none: {} },
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
// GET /assets/asset-types-summary — counts by status/type
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
      };
    });

    res.json(summary);
  } catch (err) {
    errJson(res, 500, 'Failed to fetch asset type summary');
  }
});

// -------------------------------------------------------
// GET /assets/asset-types/:id/fields — fields for a type
// -------------------------------------------------------
router.get('/asset-types/:id/fields', async (req, res) => {
  try {
    const typeId = req.params.id;
    const fields = await prisma.asset_type_fields.findMany({
      where:   { asset_type_id: typeId },
      orderBy: [{ display_order: 'asc' }, { created_at: 'asc' }],
      include: { field_type: true },
    });
    res.json(fields);
  } catch (err) {
    errJson(res, 500, 'Failed to fetch asset type fields');
  }
});

// -------------------------------------------------------------------
// POST /assets/asset-types/:id/fields — create field for a type
// Guardrails: slug uniqueness, cap fields per type, 409 on conflict
// -------------------------------------------------------------------
router.post('/asset-types/:id/fields', async (req, res) => {
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
// POST /assets — create from placeholder + files
// ---------------------------------------------
router.post('/', upload, async (req, res) => {
  const reqId = rid();
  try {
    // Per-file size limits (multer can't do per-field sizes by default)
    const img = req.files?.image?.[0];
    const doc = req.files?.document?.[0];
    if (img && img.size > MAX_IMAGE_BYTES) return errJson(res, 400, 'Image too large (max 5MB)');
    if (doc && doc.size > MAX_DOC_BYTES)   return errJson(res, 400, 'Document too large (max 10MB)');

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

    // Validate dynamic fields
    await validateDynamicFields(reqId, data.type_id, dynamicFields);

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
          model:         null,
          assigned_to_id:null,
          type_id:       null,
          documentation_url: null,
          image_url:        null,
          field_values: { none: {} },
        },
      });
      if (!placeholder) return errJson(res, 400, 'No available pre-generated asset IDs. Please generate more QR codes.');
      targetId = placeholder.id;
    }

    // Upload files if any
    const [imageUpload, docUpload] = await Promise.all([
      img ? uploadToS3(img, 'images')     : null,
      doc ? uploadToS3(doc, 'documents')  : null,
    ]);

    // Update base record
    const updated = await prisma.assets.update({
      where: { id: targetId },
      data: {
        type_id:           data.type_id,
        serial_number:     data.serial_number || null,
        model:             data.model || null,
        description:       data.description || null,
        location:          data.location || null,
        status:            data.status || 'Available',
        next_service_date: data.next_service_date ? new Date(data.next_service_date) : null,
        date_purchased:    data.date_purchased ? new Date(data.date_purchased) : null,
        notes:             data.notes || null,

        assigned_to_id:    data.assigned_to_id || null,
        documentation_url: docUpload?.Location || null,
        image_url:         imageUpload?.Location || null,
      },
    });

    // Upsert dynamic values
    const defsBySlug = await getTypeFieldDefsBySlug(data.type_id);
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
            data:  { userassets: { set: [...current, targetId] } },
          });
        }
      }
    }

    log(reqId, 'INFO', 'create-asset-ok', { id: targetId, type_id: data.type_id, dynCount: upserts.length });
    res.status(201).json({ asset: updated });
  } catch (err) {
    log(reqId, 'ERROR', 'create-asset-failed', { message: err.message, stack: err.stack });
    errJson(res, err.status || 500, err.message || 'Error creating asset');
  }
});

// -------------------------------------------------
// PUT /assets/:id — update (incl. dynamic fields)
// -------------------------------------------------
router.put('/:id', async (req, res) => {
  const reqId = rid();
  const assetId = req.params.id;
  const { assigned_to_id, assign_to_admin = false, ...assetData } = req.body;

  try {
    if (!isUUID(assetId) && !isQRId(assetId)) {
      return errJson(res, 400, 'Invalid asset id');
    }

    // Resolve target assignee
    let newUserId = assigned_to_id || null;
    if (assign_to_admin) {
      const adminUser = await prisma.users.findUnique({ where: { useremail: 'admin@engsurveys.com.au' } });
      if (!adminUser) return errJson(res, 400, 'Admin user not found');
      newUserId = adminUser.id;
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
      'location',
      'status',
      'next_service_date',
      'date_purchased',
      'notes',
      'documentation_url',
      'image_url',
      // do NOT include `fields` here
    ]);

      const patch = { assigned_to_id: newUserId || null };
      for (const [k, v] of Object.entries(assetData)) {
        if (allowedKeys.has(k)) patch[k] = v;
      }

      // Date normalization
      if ('next_service_date' in patch) patch.next_service_date = toDateOrNull(patch.next_service_date);
      if ('date_purchased'   in patch) patch.date_purchased    = toDateOrNull(patch.date_purchased);

      // ✅ Validate dynamic fields against the effective type
      const effectiveTypeId = patch.type_id || existingAsset.type_id;
      if (effectiveTypeId && fieldsPatch) {
        await validateDynamicFields(reqId, effectiveTypeId, fieldsPatch);
      }

      // Write top-level columns
      ops.push(prisma.assets.update({ where: { id: assetId }, data: patch }));

      // Upsert dynamic fields if provided
      if (fieldsPatch && effectiveTypeId) {
        const defsBySlug = await getTypeFieldDefsBySlug(effectiveTypeId);
        for (const [slug, val] of Object.entries(fieldsPatch)) {
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
    log(reqId, 'INFO', 'update-asset-ok', { id: assetId, ops: result.length });
    res.json({ success: true, updated: result });
  } catch (err) {
    log(reqId, 'ERROR', 'update-asset-failed', { message: err.message });
    errJson(res, 500, 'Failed to update asset', { details: err.message });
  }
});

// -----------------------------
// DELETE /assets/:id
// -----------------------------
router.delete('/:id', async (req, res) => {
  try {
    await prisma.assets.delete({ where: { id: req.params.id } });
    res.json({ message: 'Asset deleted' });
  } catch (err) {
    errJson(res, 400, err.message);
  }
});

// ---------------------------------------------
// PUT /assets/:id/files — update image/document
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
    if (doc && doc.size > MAX_DOC_BYTES)   return errJson(res, 400, 'Document too large (max 10MB)');

    try {
      const [imgUp, docUp] = await Promise.all([
        img ? uploadToS3(img, 'images') : null,
        doc ? uploadToS3(doc, 'documents') : null,
      ]);

      const patch = {};
      if (imgUp) patch.image_url = imgUp.Location;
      if (docUp) patch.documentation_url = docUp.Location;

      const updated = await prisma.assets.update({ where: { id: assetId }, data: patch });
      res.json({ success: true, asset: updated });
    } catch (e) {
      errJson(res, 500, e.message || 'Failed to update files');
    }
  });
});

// ------------------------------------------------------
// POST /assets/asset-types — create asset type (image)
// ------------------------------------------------------
router.post('/asset-types', multerSingle.single('image'), async (req, res) => {
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

// -------------------------------------------------------------
// GET /assets/:id — single asset (decoded fields, debug toggle)
// -------------------------------------------------------------
router.get('/:id', async (req, res) => {
  const debug = String(req.query.debug || '').toLowerCase() === '1';
  try {
    const asset = await prisma.assets.findUnique({
      where:  { id: req.params.id },
      include:{
        asset_types: true,
        users: true,
        field_values: {
          include: { asset_type_field: { include: { field_type: true } } },
        },
      },
    });
    if (!asset) return errJson(res, 404, 'Asset not found');

    const fields = {};
    for (const row of asset.field_values) {
      const slug = row.asset_type_field.slug;
      const code = row.asset_type_field.field_type?.slug || row.asset_type_field.field_type?.name;
      fields[slug] = decodeValue(code, row.value);
    }

    const { field_values, ...rest } = asset;
    res.json(debug ? { ...rest, fields, __raw_field_values: field_values } : { ...rest, fields });
  } catch (err) {
    errJson(res, 500, 'Failed to fetch asset');
  }
});

// -------------------------------------------------------------------
// GET /assets/assigned/:userId — assets for a user (decoded fields)
// -------------------------------------------------------------------
router.get('/assigned/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;

    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (!user) return errJson(res, 404, 'User not found');

    const assets = await prisma.assets.findMany({
      where:   { id: { in: user.userassets || [] } },
      include: {
        asset_types: true,
        users: true,
        field_values: {
          include: { asset_type_field: { include: { field_type: true } } },
        },
      },
    });

    const shaped = assets.map(a => {
      const fields = {};
      for (const row of a.field_values) {
        const slug = row.asset_type_field.slug;
        const code = row.asset_type_field.field_type?.slug || row.asset_type_field.field_type?.name;
        fields[slug] = decodeValue(code, row.value);
      }
      const { field_values, ...rest } = a;
      return { ...rest, fields };
    });

    res.json(shaped);
  } catch (err) {
    errJson(res, 500, 'Failed to fetch assigned assets');
  }
});

module.exports = router;

