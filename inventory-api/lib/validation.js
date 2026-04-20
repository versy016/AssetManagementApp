/**
 * inventory-api/lib/validation.js — Zod schemas for API request bodies.
 *
 * Usage in a route:
 *   const { validate, schemas } = require('../lib/validation');
 *
 *   router.post('/', validate(schemas.createAsset), async (req, res) => {
 *     // req.body is now typed and safe
 *   });
 *
 * Install Zod if not already present:
 *   cd inventory-api && npm install zod
 */
'use strict';

const { z } = require('zod');
const { ALL_STATUSES, ACTION_DB_TYPE } = require('./assetStatus');

// ─── Middleware factory ───────────────────────────────────────────────────────
/**
 * Returns an Express middleware that validates req.body against a Zod schema.
 * On failure responds 400 with a structured errors array.
 * On success calls next() — req.body is replaced with the parsed (coerced) value.
 */
function validate(schema) {
  return (req, res, next) => {
    // Parse against an empty object if body is absent (e.g. multipart before multer runs)
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      // Zod v3 uses .issues; .errors is an alias — guard both to be safe
      const issues = result.error?.issues ?? result.error?.errors ?? [];
      const errors = issues.map((e) => ({
        field:   e.path.join('.') || 'body',
        message: e.message,
      }));
      return res.status(400).json({ error: 'Validation failed', errors });
    }
    req.body = result.data;
    return next();
  };
}

// ─── Reusable field definitions ───────────────────────────────────────────────
const optionalString   = z.string().trim().optional();
const optionalEmail    = z.string().trim().email('Must be a valid email').optional();
const optionalISODate  = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format').optional();
const optionalUrl      = z.string().trim().url('Must be a valid URL').optional().or(z.literal(''));

// ─── Asset schemas ────────────────────────────────────────────────────────────
const createAsset = z.object({
  type_id:           z.string().min(1, 'type_id is required'),
  serial_number:     optionalString,
  name:              optionalString,
  model:             optionalString,
  description:       optionalString,
  location:          optionalString,
  notes:             optionalString,
  other_id:          optionalString,
  status:            z.enum(ALL_STATUSES, { errorMap: () => ({ message: `status must be one of: ${ALL_STATUSES.join(', ')}` }) }).optional(),
  next_service_date: optionalISODate,
  date_purchased:    optionalISODate,
  fields:            z.string().optional(), // JSON string for dynamic fields (multipart)
}).passthrough(); // allow file fields added by multer

const updateAsset = z.object({
  serial_number:     optionalString,
  name:              optionalString,
  model:             optionalString,
  description:       optionalString,
  location:          optionalString,
  notes:             optionalString,
  other_id:          optionalString,
  status:            z.enum(ALL_STATUSES, { errorMap: () => ({ message: `status must be one of: ${ALL_STATUSES.join(', ')}` }) }).optional(),
  next_service_date: optionalISODate,
  date_purchased:    optionalISODate,
  assigned_to_id:    optionalString,
  assign_to_admin:   z.boolean().optional(),
  action_note:       optionalString,
  fields:            z.string().optional(),
}).passthrough();

// All action types accepted by the route (superset of ACTION_DB_TYPE)
const ALL_ACTION_TYPES = [...new Set([
  ...Object.values(ACTION_DB_TYPE),
  'MAINTENANCE', 'STOLEN', 'STATUS_CHANGE',
])];

const createAction = z.object({
  type: z.enum(ALL_ACTION_TYPES, {
    errorMap: () => ({ message: `type must be one of: ${ALL_ACTION_TYPES.join(', ')}` }),
  }),
  note:         optionalString,
  data:         z.record(z.unknown()).optional(),
  performed_by: optionalString,
  from_user_id: optionalString,
  to_user_id:   optionalString,
  occurred_at:  z.string().datetime({ offset: true }).optional(),
  details:      z.record(z.unknown()).optional(),
});

// ─── User schemas ─────────────────────────────────────────────────────────────
const createUser = z.object({
  id:         z.string().min(1, 'id is required'),
  name:       z.string().min(1, 'name is required').trim(),
  useremail:  optionalEmail,
  role:       z.enum(['USER', 'ADMIN']).optional(),
  userassets: z.array(z.string()).optional(),
});

const updateUser = z.object({
  name:       z.string().min(1).trim().optional(),
  useremail:  optionalEmail,
  role:       z.enum(['USER', 'ADMIN']).optional(),
  userassets: z.array(z.string()).optional(),
  push_token: optionalString,
}).passthrough();

// ─── Asset type schemas ───────────────────────────────────────────────────────
const createAssetType = z.object({
  name: z.string().min(1, 'name is required').trim(),
}).passthrough(); // image handled by multer

const updateAssetType = z.object({
  name: z.string().min(1).trim().optional(),
}).passthrough();

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  validate,
  schemas: {
    createAsset,
    updateAsset,
    createAction,
    createUser,
    updateUser,
    createAssetType,
    updateAssetType,
  },
};
