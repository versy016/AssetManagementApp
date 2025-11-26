/*
  seed-asset-types.js — Create a set of asset types by name only.
  Usage:
    node scripts/seed-asset-types.js

  Notes:
  - Creates a type only if a case-insensitive match by name does not already exist.
  - Ignores extra fields; you can add custom fields later via the API/UI.
*/

/* eslint-disable no-console */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { PrismaClient } = require('../generated/prisma');
const prisma = new PrismaClient();

const TYPES = [
  'AED',
  'Controller',
  'Desktop computer',
  'Diagonal Eyepiece',
  'Disto',
  'Dongle',
  'Drill',
  'Drone',
  'Echosounder',
  'GPS',
  'GPS 750 Base',
  'GPS Base',
  'GPS Radio',
  'GPS Receiver',
  'GPS topcon',
  'Key',
  'LEICA TARGETS',
  'Labeller',
  'Laptop',
  'Laser',
  'Level',
  'Lidar Scanner',
  'Magnetic Mount',
  'Metal detector',
  'Mobile phone',
  'Mounting Bracket',
  'Office Equipment',
  'Office equipment',
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
  'Two drill set',
  'UG Locating',
  'Vehicle',
  'gps radio',
  'iPad',
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
        skipped.push(name);
        continue;
      }
      const row = await prisma.asset_types.create({ data: { name } });
      created.push(row.name);
      console.log('✓ Created asset type:', row.name);
    } catch (e) {
      console.error('✗ Failed for', name, e?.message || e);
    }
  }

  console.log('\nSummary');
  console.log('Created:', created.length);
  console.log('Skipped (already existed):', skipped.length);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { try { await prisma.$disconnect(); } catch {} });

