/*
  import-excel-assets.js — Import GoCodes assets into the DB as QR-Awaiting records.

  Usage:
    node scripts/import-excel-assets.js [path/to/file.xlsx] [--types-only|--assets-only|--dry-run]

  What it does:
  - Skips retired assets and rows with no Asset ID.
  - Uses a UUID as the temporary asset id so the existing isAssetIdAwaitingQr()
    UUID check correctly identifies and hides these assets everywhere in the app.
    Once a real QR sticker is assigned via swap-qr the UUID is replaced by the
    8-char QR sticker ID.
  - Sets description = "QR Awaiting Assets" (the system sentinel for QR-Awaiting).
  - Stores the original GoCodes Asset ID in other_id for searchability.
  - Stores the original description in notes as "Original description: <text>"
    so it can be auto-restored when the QR is assigned.
  - Populates custom field values for: purchase_price, warranty, vehicle_accessories
    (only when the field exists on the asset type — skips silently if not).
  - Skips assets whose other_id already matches the GoCodes ID (safe to re-run).

  Flags:
    --types-only   run type-creation phase only, import no assets
    --assets-only  skip type-creation phase (expects all types to exist)
    --dry-run      parse + validate everything but write nothing to DB

  Default file path: <repo-root>/assets/Sheets/GoCodes.xlsx
  Override: node scripts/import-excel-assets.js path/to/GoCodes.xlsx
*/

/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const AWS = require('aws-sdk');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const XLSX = require('xlsx');
const { PrismaClient } = require('../generated/prisma');
const prisma = new PrismaClient();

// ── S3 / image config ────────────────────────────────────────────────────────
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const IMAGES_DIR = path.join(PROJECT_ROOT, 'assets', 'images');
const IMAGE_BASE_URL = (process.env.ASSET_TYPE_IMAGE_BASE_URL || '').trim().replace(/\/+$/, '');
const hasS3Config = Boolean(process.env.S3_BUCKET && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
const s3 = hasS3Config ? new AWS.S3({ region: process.env.AWS_REGION }) : null;
const S3_PREFIX = process.env.ASSET_TYPE_IMAGE_S3_PREFIX || 'asset-type-images';
const imageIndex = loadImageIndex();
const imageUrlCache = new Map();

// ── GoCodes type normalisation ────────────────────────────────────────────────
// Maps raw Excel type names (lower-cased) → canonical DB type names.
// Only entries that differ from the canonical form need to be listed here.
const TYPE_MAP = {
  'gps radio':        'GPS Radio',
  'office equipment': 'Office Equipment',
  'mobile phone':     'Mobile Phone',
  'two drill set':    'Power Tool',
  'drill':            'Power Tool',
  'gps 750 base':     'GPS Base',
  'gps topcon':       'GPS',
  'leica targets':    'Target',
  'desktop computer': 'Desktop Computer',
};

// ── Custom field slugs we populate from the spreadsheet ──────────────────────
const CF_PURCHASE_PRICE   = 'purchase_price';
const CF_WARRANTY         = 'warranty';
const CF_VEHICLE_ACC      = 'vehicle_accessories';

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function headerMapOf(keys) {
  const map = {};
  for (const k of keys) map[normalizeHeader(k)] = k;
  return map;
}

function canonicalKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function coerceString(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function coerceCost(v) {
  if (v === undefined || v === null) return null;
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return isFinite(n) ? String(n) : null;
}

/** Excel serial date or Date object or parseable string → JS Date | null */
function fromExcelDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'number' && isFinite(v)) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + Math.round(v * 86400000));
  }
  if (typeof v === 'string') {
    const d = new Date(v.trim().replace(/\//g, '-'));
    if (!isNaN(d)) return d;
  }
  return null;
}

function toDateOnlyOrNull(v) {
  const d = fromExcelDate(v);
  if (!d) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseArgs() {
  const input = process.argv.slice(2);
  const firstFileIdx = input.findIndex((a) => !a.startsWith('--'));
  const filePathArg = firstFileIdx >= 0 ? input[firstFileIdx] : null;
  const flags = new Set(input.filter((a) => a.startsWith('--')));
  const options = {
    typesOnly: flags.has('--types-only'),
    assetsOnly: flags.has('--assets-only'),
    dryRun: flags.has('--dry-run'),
  };
  if (options.typesOnly && options.assetsOnly) {
    console.error('Cannot use --types-only and --assets-only together.');
    process.exit(1);
  }
  return { filePathArg, options };
}

// ── Image handling (unchanged from original) ──────────────────────────────────

function loadImageIndex() {
  const map = new Map();
  try {
    if (!fs.existsSync(IMAGES_DIR)) return map;
    fs.readdirSync(IMAGES_DIR, { withFileTypes: true }).forEach((entry) => {
      if (!entry.isFile()) return;
      const base = path.parse(entry.name).name;
      const key = canonicalKey(base);
      if (key) map.set(key, { fileName: entry.name, fullPath: path.join(IMAGES_DIR, entry.name) });
    });
    console.log(`[images] Indexed ${map.size} image(s)`);
  } catch (err) {
    console.warn('[images] Could not read images dir:', err?.message || err);
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
  const key = `${S3_PREFIX}/${slug || canonicalKey(match.fileName)}-${Date.now()}${ext}`;
  const params = {
    Bucket: process.env.S3_BUCKET, Key: key, Body: buffer,
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
  }
  if (url) imageUrlCache.set(slug, url);
  return url;
}

// ── Custom field helpers ──────────────────────────────────────────────────────

/** typeId → { slug: fieldId } — cached per run */
const typeFieldsCache = new Map();

async function getTypeFields(typeId) {
  if (typeFieldsCache.has(typeId)) return typeFieldsCache.get(typeId);
  const fields = await prisma.asset_type_fields.findMany({
    where: { asset_type_id: typeId },
    select: { id: true, slug: true },
  });
  const map = {};
  for (const f of fields) map[f.slug] = f.id;
  typeFieldsCache.set(typeId, map);
  return map;
}

async function upsertFieldValue(assetId, fieldId, value, dryRun) {
  if (dryRun) return;
  await prisma.asset_field_values.upsert({
    where: { asset_id_asset_type_field_id: { asset_id: assetId, asset_type_field_id: fieldId } },
    update: { value },
    create: { asset_id: assetId, asset_type_field_id: fieldId, value },
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { filePathArg, options } = parseArgs();
  const defaultPath = path.join(__dirname, '..', '..', 'assets', 'Sheets', 'GoCodes.xlsx');
  const filePath = path.resolve(filePathArg || defaultPath);

  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    console.error('Pass the path as an argument: node scripts/import-excel-assets.js path/to/GoCodes.xlsx');
    process.exit(1);
  }

  if (options.dryRun) console.log('⚠  DRY RUN — no data will be written to the DB');
  console.log('Reading workbook:', filePath);

  const wb = XLSX.readFile(filePath, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) { console.error('No worksheet found'); process.exit(1); }

  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  console.log(`Rows detected: ${rows.length}`);
  if (!rows.length) { console.log('Nothing to import.'); return; }

  // ── Resolve column headers (normalised, case-insensitive) ────────────────
  const allHeaders = Object.keys(rows[0] || {});
  const lookup = headerMapOf(allHeaders);

  const col = (...candidates) =>
    Object.keys(lookup).find((h) => candidates.includes(h));

  const hAssetId  = col('asset id');                                          // GoCodes ID → stored in assets.other_id
  const hOtherId  = col('other id');                                          // → not used (GoCodes ID occupies other_id slot)
  const hType     = col('asset type', 'type', 'category');                   // → asset_types
  const hSerial   = col('serial number', 'serial', 'serial no', 'sn');       // → assets.serial_number
  const hModel    = col('model', 'asset model', 'item', 'name');             // → assets.model
  const hDesc     = col('description', 'desc', 'details');                   // → assets.notes (as "Original description: ...")
  const hStatus   = col('status', 'state');                                  // used only for skip-retired check
  const hPurchased = col('date purchased', 'purchase date', 'purchased on'); // → assets.date_purchased
  const hCost     = col('original cost', 'cost', 'purchase price', 'price'); // → custom field: purchase_price
  const hWarranty = col('warranty terms', 'warranty');                        // → custom field: warranty
  const hVehicleAcc = col('vehicle accessories', 'accessories');              // → custom field: vehicle_accessories

  // ── Type name normalisation ───────────────────────────────────────────────
  function resolveTypeName(raw) {
    const s = coerceString(raw);
    if (!s || /^blank asset$/i.test(s)) return null;
    return TYPE_MAP[s.toLowerCase()] || s.trim();
  }

  // ── Phase 1: ensure all asset types exist ────────────────────────────────
  async function loadTypeMap() {
    const list = await prisma.asset_types.findMany({ select: { id: true, name: true } });
    return new Map(list.map((t) => [String(t.name || '').trim().toLowerCase(), t.id]));
  }

  const typeByName = await loadTypeMap();

  if (!options.assetsOnly) {
    const seenKeys = new Set();
    const toCreate = [];
    for (const row of rows) {
      const typeName = resolveTypeName(hType ? row[lookup[hType]] : null);
      if (!typeName) continue;
      const key = typeName.toLowerCase();
      if (!seenKeys.has(key) && !typeByName.has(key)) {
        seenKeys.add(key);
        toCreate.push({ key, name: typeName });
      }
    }
    if (toCreate.length) {
      console.log(`\nCreating ${toCreate.length} new asset type(s)...`);
      for (const item of toCreate) {
        const image_url = await resolveImageUrlForType(item.name).catch(() => null);
        if (!options.dryRun) {
          const created = await prisma.asset_types.create({
            data: { name: item.name, ...(image_url ? { image_url } : {}) },
          });
          typeByName.set(item.key, created.id);
        }
        console.log(`  • ${item.name}${image_url ? ' (image attached)' : ''}`);
      }
    } else {
      console.log('All asset types already exist.');
    }
  }

  if (options.typesOnly) {
    console.log('\nTypes-only run complete.');
    return;
  }

  // ── Phase 2: import assets ────────────────────────────────────────────────
  const results = {
    created: 0,
    skipped_retired: 0,
    skipped_no_id: 0,
    skipped_no_type: 0,
    skipped_exists: 0,
    field_values_set: 0,
    errors: 0,
  };

  console.log('\nImporting assets...');

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    try {
      // ── Skip retired ────────────────────────────────────────────────────
      const rawStatus = coerceString(hStatus ? row[lookup[hStatus]] : null);
      if (rawStatus && rawStatus.toLowerCase() === 'retired') {
        results.skipped_retired++;
        continue;
      }

      // ── Require an Asset ID ─────────────────────────────────────────────
      const tempId = coerceString(hAssetId ? row[lookup[hAssetId]] : null);
      if (!tempId) {
        results.skipped_no_id++;
        continue;
      }

      // ── Resolve asset type ───────────────────────────────────────────────
      const typeName = resolveTypeName(hType ? row[lookup[hType]] : null);
      if (!typeName) {
        results.skipped_no_type++;
        console.warn(`  Row ${idx + 1} (${tempId}): no asset type — skipped`);
        continue;
      }
      const typeId = typeByName.get(typeName.toLowerCase());
      if (!typeId) {
        results.skipped_no_type++;
        console.warn(`  Row ${idx + 1} (${tempId}): type "${typeName}" not found in DB — skipped`);
        continue;
      }

      // ── Skip if already imported (keyed on other_id = gocodesId) ──────────
      const existing = await prisma.assets.findFirst({ where: { other_id: tempId }, select: { id: true } });
      if (existing) {
        results.skipped_exists++;
        continue;
      }

      // ── Preserve original description in notes ───────────────────────────
      const originalDesc = coerceString(hDesc ? row[lookup[hDesc]] : null);
      const notesVal = originalDesc ? `Original description: ${originalDesc}` : null;

      // ── Build asset record ───────────────────────────────────────────────
      const data = {
        id:              randomUUID(),                                                    // UUID temp id — caught by isAssetIdAwaitingQr() everywhere in the app
        type_id:         typeId,
        serial_number:   coerceString(hSerial ? row[lookup[hSerial]] : null),
        model:           coerceString(hModel ? row[lookup[hModel]] : null),
        other_id:        tempId,                                                          // GoCodes ID stored here for searchability
        description:     'QR Awaiting Assets',                                           // QR-Awaiting sentinel
        notes:           notesVal,
        status:          'In Service',
        date_purchased:  hPurchased ? toDateOnlyOrNull(row[lookup[hPurchased]]) : null,
        assigned_to_id:  null,
        next_service_date: null,
        documentation_url: null,
        image_url:       null,
        last_changed_by: null,
        location:        null,
      };

      // Remove nulls that would cause Prisma to complain
      Object.keys(data).forEach((k) => { if (data[k] === undefined) delete data[k]; });

      if (!options.dryRun) {
        await prisma.assets.create({ data });
      }
      results.created++;

      // ── Populate custom field values ─────────────────────────────────────
      if (!options.dryRun) {
        const typeFields = await getTypeFields(typeId);

        // Purchase Price (number)
        const costVal = coerceCost(hCost ? row[lookup[hCost]] : null);
        if (costVal && typeFields[CF_PURCHASE_PRICE]) {
          await upsertFieldValue(data.id, typeFields[CF_PURCHASE_PRICE], costVal, false);
          results.field_values_set++;
        }

        // Warranty (text)
        const warrantyVal = coerceString(hWarranty ? row[lookup[hWarranty]] : null);
        if (warrantyVal && typeFields[CF_WARRANTY]) {
          await upsertFieldValue(data.id, typeFields[CF_WARRANTY], warrantyVal, false);
          results.field_values_set++;
        }

        // Vehicle Accessories (textarea)
        const vehAccVal = coerceString(hVehicleAcc ? row[lookup[hVehicleAcc]] : null);
        if (vehAccVal && typeFields[CF_VEHICLE_ACC]) {
          await upsertFieldValue(data.id, typeFields[CF_VEHICLE_ACC], vehAccVal, false);
          results.field_values_set++;
        }
      }

      if (results.created <= 10 || results.created % 50 === 0) {
        console.log(`  [${results.created}] ${tempId} — ${typeName}`);
      }
    } catch (e) {
      results.errors++;
      console.error(`  Row ${idx + 1} failed:`, e?.message || e);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n─── Import summary ───────────────────────────────────');
  console.log(`  Assets created:          ${results.created}`);
  console.log(`  Custom field values set: ${results.field_values_set}`);
  console.log(`  Skipped — retired:       ${results.skipped_retired}`);
  console.log(`  Skipped — no asset ID:   ${results.skipped_no_id}`);
  console.log(`  Skipped — no type:       ${results.skipped_no_type}`);
  console.log(`  Skipped — already exist: ${results.skipped_exists}`);
  console.log(`  Errors:                  ${results.errors}`);
  if (options.dryRun) console.log('\n  (DRY RUN — nothing was written)');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { try { await prisma.$disconnect(); } catch {} });
