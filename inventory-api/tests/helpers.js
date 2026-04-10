// tests/helpers.js
// Shared test utilities, fixture factories, and auth helpers.
'use strict';

const { PrismaClient } = require('../generated/prisma');

// ─── Auth ─────────────────────────────────────────────────────────────────────
// In test mode the server accepts X-User-Id as identity without token verification.
const TEST_USER_ID = 'test-user-uid-001';
const TEST_ADMIN_ID = 'test-admin-uid-001';

/**
 * Returns supertest request headers that satisfy the dev-mode auth bypass.
 */
const authHeader = (uid = TEST_USER_ID) => ({ 'X-User-Id': uid });
const adminHeader = () => authHeader(TEST_ADMIN_ID);

// ─── Prisma client ────────────────────────────────────────────────────────────
let _prisma = null;
const getPrisma = () => {
  if (!_prisma) _prisma = new PrismaClient();
  return _prisma;
};
const disconnectPrisma = async () => {
  if (_prisma) {
    await _prisma.$disconnect();
    _prisma = null;
  }
};

// ─── Fixture factories ────────────────────────────────────────────────────────
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Creates a minimal asset_types row and returns it.
 */
const createAssetType = async (overrides = {}) => {
  const prisma = getPrisma();
  return prisma.asset_types.create({
    data: { name: `Test Type ${uid()}`, ...overrides },
  });
};

/**
 * Creates a minimal assets row and returns it.
 * Note: the Prisma `assets` model has no `asset_id` column — use serial_number for a human id.
 */
const createAsset = async (typeId, overrides = {}) => {
  const prisma = getPrisma();
  return prisma.assets.create({
    data: {
      asset_types: typeId ? { connect: { id: typeId } } : undefined,
      status: 'In Service',
      serial_number: `SER-${uid()}`,
      ...overrides,
    },
  });
};

/**
 * Empty QR placeholder row — required by POST /assets (claims a pre-generated id).
 */
const createPlaceholderAsset = async () => {
  const prisma = getPrisma();
  return prisma.assets.create({
    data: { status: 'Available' },
  });
};

/**
 * Ensures fixed test UIDs exist with correct roles so adminOnly routes accept adminHeader().
 */
const ensureTestUsers = async () => {
  const prisma = getPrisma();
  await prisma.users.upsert({
    where: { id: TEST_ADMIN_ID },
    create: {
      id: TEST_ADMIN_ID,
      name: 'Test Admin',
      useremail: 'test-admin-fixture@local.test',
      role: 'ADMIN',
      userassets: [],
    },
    update: { role: 'ADMIN' },
  });
  await prisma.users.upsert({
    where: { id: TEST_USER_ID },
    create: {
      id: TEST_USER_ID,
      name: 'Test User',
      useremail: 'test-user-fixture@local.test',
      role: 'USER',
      userassets: [],
    },
    update: {},
  });
};

/**
 * Creates a user row (needed for some action endpoints).
 */
const createUser = async (overrides = {}) => {
  const prisma = getPrisma();
  return prisma.users.create({
    data: {
      id: uid(),
      name: 'Test Fixture User',
      useremail: `test-${uid()}@test.com`,
      role: 'USER',
      userassets: [],
      ...overrides,
    },
  });
};

/**
 * Deletes a list of prisma records by id, ignoring not-found errors.
 */
const safeDelete = async (model, ids) => {
  const prisma = getPrisma();
  for (const id of ids) {
    try {
      await prisma[model].delete({ where: { id } });
    } catch (_) {}
  }
};

/** Sample hire payload (mirrors what the frontend sends). */
const hireSample = (overrides = {}) => ({
  hirerName: `Tester ${uid()}`,
  companyEntity: 'Test Pty Ltd',
  project: 'Test Project',
  address: '1 Test St, Sydney NSW 2000',
  phone: '0400000000',
  email: `hire-${uid()}@example.com`,
  equipmentItems: [{ assetId: `SER-${uid()}`, description: 'Total station' }],
  hireStartDate: '2026-04-01',
  hireStartTime: '09:00',
  hireEndDate: '2026-04-05',
  hireEndTime: '17:00',
  rate: '200',
  ratePeriod: 'day',
  termsAgreed: true,
  signatureName: 'Test Signatory',
  signatureDate: '2026-04-01',
  ...overrides,
});

module.exports = {
  TEST_USER_ID,
  TEST_ADMIN_ID,
  authHeader,
  adminHeader,
  getPrisma,
  disconnectPrisma,
  createAssetType,
  createAsset,
  createPlaceholderAsset,
  ensureTestUsers,
  createUser,
  safeDelete,
  hireSample,
  uid,
};
