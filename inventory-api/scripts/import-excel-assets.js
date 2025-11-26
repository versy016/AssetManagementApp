/*
  import-excel-assets.js — Import assets from an Excel workbook into the DB.

  Usage:
    node scripts/import-excel-assets.js [path/to/file.xlsx] [--types-only|--assets-only]

  Behavior:
  - Reads the first worksheet by default.
  - Populates ONLY common asset fields (top-level columns on `assets`).
  - Skips rows with an Asset Type equal to "Blank Asset" (case-insensitive).
  - Does NOT assign/override `id` (lets DB default UUID be generated).
  - Tries to map type by name (case-insensitive) to existing `asset_types`.
  - If asset type not found, auto-creates it (deduped) before inserting assets and
    attempts to attach a matching image from `assets/images`, ignoring case/spacing.
  - Flags:
      --types-only   run the asset-type phase only (imports no assets)
      --assets-only  skip the asset-type phase (expects all types to exist)
*/

/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
const AWS = require('aws-sdk');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const XLSX = require('xlsx');
const { PrismaClient } = require('../generated/prisma');
const prisma = new PrismaClient();

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const IMAGES_DIR = path.join(PROJECT_ROOT, 'assets', 'images');
const IMAGE_BASE_URL = (process.env.ASSET_TYPE_IMAGE_BASE_URL || '').trim().replace(/\/+$/, '');
const hasS3Config = Boolean(process.env.S3_BUCKET && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
const s3 = hasS3Config ? new AWS.S3({ region: process.env.AWS_REGION }) : null;
const S3_PREFIX = process.env.ASSET_TYPE_IMAGE_S3_PREFIX || 'asset-type-images';
const imageIndex = loadImageIndex();
const imageUrlCache = new Map();

function normalizeHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Best-effort Excel serial date -> JS Date
function fromExcelDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'number' && isFinite(v)) {
    // Excel epoch (Windows): 1899-12-30
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const ms = Math.round(v * 24 * 60 * 60 * 1000);
    return new Date(epoch.getTime() + ms);
  }
  if (typeof v === 'string') {
    const t = v.trim();
    // Accept YYYY-MM-DD or YYYY/MM/DD
    const iso = t.replace(/\//g, '-');
    const d = new Date(iso);
    if (!isNaN(d)) return d;
  }
  return null;
}

function toDateOnlyOrNull(v) {
  const d = fromExcelDate(v);
  if (!d) return null;
  // normalize to date-only (no time) by using local midnight
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  return new Date(y, m, day);
}

function coerceString(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

// Normalize incoming status values from spreadsheets
// Rules requested:
// - "available" -> "In Service"
// - "retired"   -> "End of Life"
// Also accept common variants and map to title-cased labels used across the app.
function normalizeImportedStatus(raw) {
  const s = coerceString(raw);
  if (!s) return 'In Service';
  const t = s.toLowerCase().replace(/[\s_-]+/g, ' ').trim();

  // Map common variants to canonical labels used in the app
  if (t === 'available' || t === 'avail' || t === 'in use' || t === 'inuse') return 'In Service';
  if (t === 'retired' || t === 'end of life' || t === 'eol') return 'End of Life';
  if (t === 'in service') return 'In Service';
  if (t === 'end of life') return 'End of Life';

  // Leave others as-is (e.g., Repair, Maintenance, Lost, Stolen, In Use)
  return s;
}

function headerMapOf(keys) {
  const map = {};
  for (const k of keys) map[normalizeHeader(k)] = k;
  return map;
}

function parseArgs() {
  const input = process.argv.slice(2);
  const firstFileIdx = input.findIndex((arg) => !arg.startsWith('--'));
  const filePathArg = firstFileIdx >= 0 ? input[firstFileIdx] : null;
  const flags = new Set(input.filter((arg) => arg.startsWith('--')));

  const options = {
    typesOnly: flags.has('--types-only'),
    assetsOnly: flags.has('--assets-only'),
  };

  if (options.typesOnly && options.assetsOnly) {
    console.error('Cannot use --types-only and --assets-only together.');
    process.exit(1);
  }

  return { filePathArg, options };
}

function canonicalKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function loadImageIndex() {
  const map = new Map();
  try {
    if (!fs.existsSync(IMAGES_DIR)) return map;
    const entries = fs.readdirSync(IMAGES_DIR, { withFileTypes: true });
    entries.forEach((entry) => {
      if (!entry.isFile()) return;
      const base = path.parse(entry.name).name;
      const key = canonicalKey(base);
      if (!key) return;
      map.set(key, {
        fileName: entry.name,
        fullPath: path.join(IMAGES_DIR, entry.name),
      });
    });
    console.log(`[images] Indexed ${map.size} image(s) from ${IMAGES_DIR}`);
  } catch (err) {
    console.warn('[images] Unable to read images directory:', err?.message || err);
  }
  return map;
}

function guessContentType(fileName) {
  const ext = path.extname(fileName || '').toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

async function uploadImageToS3(match, slug) {
  if (!s3) return null;
  const buffer = fs.readFileSync(match.fullPath);
  const ext = path.extname(match.fileName) || '';
  const safeSlug = slug || canonicalKey(match.fileName) || String(Date.now());
  const key = `${S3_PREFIX}/${safeSlug}-${Date.now()}${ext}`;
  const params = {
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: guessContentType(match.fileName),
  };
  if (String(process.env.S3_USE_ACL || '').toLowerCase() === 'true') {
    params.ACL = process.env.S3_ACL || 'public-read';
  }
  const result = await s3.upload(params).promise();
  return result?.Location || null;
}

async function resolveImageUrlForType(typeName) {
  const slug = canonicalKey(typeName);
  if (!slug || !imageIndex.size) return null;
  if (imageUrlCache.has(slug)) return imageUrlCache.get(slug);

  const match = imageIndex.get(slug);
  if (!match) return null;

  let url = null;
  if (IMAGE_BASE_URL) {
    url = `${IMAGE_BASE_URL}/${encodeURIComponent(match.fileName)}`;
  } else if (s3) {
    url = await uploadImageToS3(match, slug);
  } else {
    console.warn(`[images] No ASSET_TYPE_IMAGE_BASE_URL or S3 config; skipping image for type "${typeName}"`);
  }

  if (url) imageUrlCache.set(slug, url);
  return url;
}

async function main() {
  const { filePathArg: argPath, options } = parseArgs();
  const defaultPath = path.join(__dirname, '..', '..', 'assets', 'Sheets', 'GoCodes.xlsx');
  const filePath = path.resolve(argPath || defaultPath);

  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    process.exit(1);
  }

  console.log('Reading workbook:', filePath);
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    console.error('No worksheet found in file');
    process.exit(1);
  }
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  console.log('Rows detected:', rows.length, 'Sheet:', sheetName);

  if (!rows.length) {
    console.log('No data to import.');
    return;
  }

  // Prepare header normalization and common header aliases
  const allHeaders = Object.keys(rows[0] || {});
  const lookup = headerMapOf(allHeaders);

  const hType = Object.keys(lookup).find((h) => ['asset type','type','category'].includes(h));
  const hModel = Object.keys(lookup).find((h) => ['model','asset model','item','name','asset name'].includes(h));
  const hSerial = Object.keys(lookup).find((h) => ['serial','serial number','serial no','sn','s/n'].includes(h));
  const hDesc = Object.keys(lookup).find((h) => ['description','desc','details'].includes(h));
  const hOtherId = Object.keys(lookup).find((h) => ['other id','asset id','barcode','tag','code','old id','internal id'].includes(h));
  const hStatus = Object.keys(lookup).find((h) => ['status','state'].includes(h));
  const hLocation = Object.keys(lookup).find((h) => ['location','site','office','where'].includes(h));
  const hPurchased = Object.keys(lookup).find((h) => ['date purchased','purchase date','purchased on','date of purchase'].includes(h));
  const hNextService = Object.keys(lookup).find((h) => ['next service date','service date','next service'].includes(h));

  const toYMD = (d) => {
    if (!d) return null;
    try {
      const dt = (d instanceof Date) ? d : new Date(d);
      if (isNaN(+dt)) return null;
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const day = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    } catch { return null; }
  };
  const hNotes = Object.keys(lookup).find((h) => ['notes','note','comment','comments'].includes(h));

  const normalizeTypeName = (value) => {
    const raw = coerceString(value);
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed || /^blank asset$/i.test(trimmed)) return null;
    return trimmed;
  };

  // Cache asset_type name -> id (lowercased)
  async function loadTypeMap() {
    const list = await prisma.asset_types.findMany({ select: { id: true, name: true } });
    return new Map(list.map((t) => [String(t.name || '').trim().toLowerCase(), t.id]));
  }

  async function ensureAssetTypes() {
    const seenKeys = new Set();
    const missing = [];

    for (const row of rows) {
      const typeName = normalizeTypeName(hType ? row[lookup[hType]] : null);
      if (!typeName) continue;
      const key = typeName.toLowerCase();
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      if (!typeByName.has(key)) {
        missing.push({ key, name: typeName });
      }
    }

    if (!missing.length) return;

    console.log(`Creating ${missing.length} new asset type(s) from spreadsheet...`);
    for (const item of missing) {
      let image_url = null;
      try {
        image_url = await resolveImageUrlForType(item.name);
      } catch (err) {
        console.warn(`[images] Failed to resolve image for "${item.name}":`, err?.message || err);
      }
      const created = await prisma.asset_types.create({
        data: {
          name: item.name,
          ...(image_url ? { image_url } : {}),
        },
      });
      typeByName.set(item.key, created.id);
      console.log(`  • ${item.name}${image_url ? ' (image attached)' : ''}`);
    }
  }

  const typeByName = await loadTypeMap();

  if (!options.assetsOnly) {
    await ensureAssetTypes();
  }
  if (options.typesOnly) {
    console.log('Types-only run complete.');
    return;
  }

  const results = { created: 0, skipped_blank_type: 0, skipped_missing_type: 0, skipped_unknown_type: 0, errors: 0 };
  const createdIds = [];

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    try {
      const rawType = hType ? row[lookup[hType]] : null;
      if (!rawType) {
        results.skipped_missing_type++;
        continue;
      }

      const typeName = normalizeTypeName(rawType);
      if (!typeName) {
        results.skipped_blank_type++;
        continue;
      }

      const typeId = typeByName.get(typeName.toLowerCase());
      if (!typeId) {
        results.skipped_unknown_type++;
        continue;
      }

      // Compute Next Service (date-only)
      const nextSvcDate = hNextService ? toDateOnlyOrNull(row[lookup[hNextService]]) : null;
      const nextSvcYMD = toYMD(nextSvcDate);

      // Determine whether this type defines a custom field named 'next_service_date'
      // If so, store Next Service in the dynamic field instead of the top-level column.
      const customNextField = await prisma.asset_type_fields.findFirst({
        where: { asset_type_id: typeId, slug: 'next_service_date' },
        include: { field_type: true },
      });
      const typeHasCustomNextService = !!(customNextField && ((customNextField.field_type?.slug || customNextField.field_type?.name || '').toLowerCase() === 'date'));

      // Prepare payload with only common fields
      const data = {
        type_id:           typeId,
        serial_number:     coerceString(hSerial ? row[lookup[hSerial]] : null),
        model:             coerceString(hModel ? row[lookup[hModel]] : null),
        description:       coerceString(hDesc ? row[lookup[hDesc]] : null),
        other_id:          coerceString(hOtherId ? row[lookup[hOtherId]] : null),
        assigned_to_id:    null,
        status:            normalizeImportedStatus(hStatus ? row[lookup[hStatus]] : null),
        // Only set top-level next_service_date when the type does NOT have a custom field for it
        next_service_date: typeHasCustomNextService ? null : (nextSvcDate || null),
        documentation_url: null,
        image_url:         null,
        last_changed_by:   null,
        location:          coerceString(hLocation ? row[lookup[hLocation]] : null),
        date_purchased:    hPurchased ? toDateOnlyOrNull(row[lookup[hPurchased]]) : null,
        notes:             coerceString(hNotes ? row[lookup[hNotes]] : null),
      };

      // Remove undefined to avoid Prisma complaining
      Object.keys(data).forEach((k) => {
        if (data[k] === undefined) delete data[k];
      });

      const created = await prisma.assets.create({ data });

      // If this type uses the custom Next Service dynamic field, upsert its value now
      if (typeHasCustomNextService && nextSvcYMD) {
        try {
          await prisma.asset_field_values.upsert({
            where: { asset_id_asset_type_field_id: { asset_id: created.id, asset_type_field_id: customNextField.id } },
            update: { value: String(nextSvcYMD) },
            create: { asset_id: created.id, asset_type_field_id: customNextField.id, value: String(nextSvcYMD) },
          });
        } catch (e) {
          console.warn(`Warning: failed to store dynamic next_service_date for ${created.id}:`, e?.message || e);
        }
      }
      results.created++;
      createdIds.push(created.id);
    } catch (e) {
      results.errors++;
      console.error(`Row ${idx + 1} failed:`, e?.message || e);
    }
  }

  console.log('\nImport summary:');
  console.log('  created:', results.created);
  console.log('  skipped_blank_type:', results.skipped_blank_type);
  console.log('  skipped_missing_type:', results.skipped_missing_type);
  console.log('  skipped_unknown_type:', results.skipped_unknown_type);
  console.log('  errors:', results.errors);
  if (createdIds.length) {
    console.log('Sample IDs:', createdIds.slice(0, 10).join(', '));
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { try { await prisma.$disconnect(); } catch {} });
