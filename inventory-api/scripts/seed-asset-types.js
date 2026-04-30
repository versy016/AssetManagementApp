/*
  seed-asset-types.js — Upsert the canonical set of asset types.
  Usage:  node scripts/seed-asset-types.js
          npm run seed:types

  - Matching is case-insensitive (won't duplicate "GPS" and "gps").
  - Safe to re-run at any time; existing types are left unchanged.
  - TYPE_MAP in import-excel-assets.js maps any legacy GoCodes variant names
    (e.g. "gps topcon", "LEICA TARGETS") to these canonical names at import time.
*/

/* eslint-disable no-console */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { PrismaClient } = require('../generated/prisma');
const prisma = new PrismaClient();

// Canonical asset type names — one entry per physical equipment category.
// Keep alphabetical order for readability.
const TYPES = [
  'AED',
  'Controller',
  'Desktop Computer',
  'Diagonal Eyepiece',
  'Disto',
  'Dongle',
  'Drone',
  'Echosounder',
  'GPS',
  'GPS Base',
  'GPS Radio',
  'GPS Receiver',
  'iPad',
  'Key',
  'Labeller',
  'Laptop',
  'Laser',
  'Level',
  'Lidar Scanner',
  'Magnetic Mount',
  'Metal Detector',
  'Mobile Phone',
  'Mounting Bracket',
  'Office Equipment',
  'Plummet',
  'Power Tool',
  'Radio',
  'Satellite Phone',
  'Scanner',
  'Sonar',
  'Staff',
  'Stamps',
  'Target',
  'Torch',
  'Total Station',
  'UG Locating',
  'Vehicle',
];

async function main() {
  const created = [];
  const skipped = [];

  for (const rawName of TYPES) {
    const name = String(rawName || '').trim();
    if (!name) continue;
    try {
      const exists = await prisma.asset_types.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } },
        select: { id: true, name: true },
      });
      if (exists) {
        skipped.push(exists.name);
        continue;
      }
      const row = await prisma.asset_types.create({ data: { name } });
      created.push(row.name);
      console.log('✓ Created:', row.name);
    } catch (e) {
      console.error('✗ Failed for', name, '—', e?.message || e);
    }
  }

  console.log('\n── Summary ───────────────────────────');
  console.log('Created: ', created.length);
  console.log('Skipped: ', skipped.length, '(already existed)');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { try { await prisma.$disconnect(); } catch {} });
