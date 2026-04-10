/**
 * tests/assets.test.js
 * Checklist areas: Asset creation, editing, deletion, status, actions, sign-off.
 *
 * Verifies:
 *  - GET /assets — list with filters
 *  - POST /assets — create with required fields
 *  - GET /assets/:id — individual record
 *  - PUT /assets/:id — update fields and status
 *  - DELETE /assets/:id — soft delete
 *  - GET /assets/:id/actions — action history
 *  - POST /assets/:id/actions — log a new action
 *  - POST /assets/:id/actions/:actionId/signoff — sign off a pending action
 *  - GET /assets/actions/pending-signoff — pending sign-off queue
 */
'use strict';

const request = require('supertest');
const { app } = require('../server');
const {
  authHeader,
  adminHeader,
  createAssetType,
  createAsset,
  createPlaceholderAsset,
  createUser,
  disconnectPrisma,
  ensureTestUsers,
  safeDelete,
  uid,
} = require('./helpers');

/** Valid v4-style UUID that does not exist (all-zero UUID fails isUUID() in the API). */
const NON_EXISTENT_ASSET_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

let assetType;
let assetIds = [];
let userIds  = [];

beforeAll(async () => {
  await ensureTestUsers();
  assetType = await createAssetType();
});

afterAll(async () => {
  await safeDelete('assets', assetIds);
  await safeDelete('users',  userIds);
  try {
    const { getPrisma } = require('./helpers');
    await getPrisma().asset_types.delete({ where: { id: assetType.id } });
  } catch (_) {}
  await disconnectPrisma();
});

// ─── Listing ──────────────────────────────────────────────────────────────────
describe('GET /assets — list', () => {
  test('returns 200 and an array', async () => {
    const res = await request(app).get('/assets');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body) || Array.isArray(res.body.data)).toBe(true);
  });

  test('accepts status filter without crashing', async () => {
    const res = await request(app).get('/assets?status=In+Service');
    expect([200, 400]).toContain(res.status);
  });

  test('accepts type_id filter without crashing', async () => {
    const res = await request(app).get(`/assets?type_id=${assetType.id}`);
    expect(res.status).toBe(200);
  });

  test('accepts search query without crashing', async () => {
    const res = await request(app).get('/assets?q=test');
    expect([200]).toContain(res.status);
  });
});

// ─── Create ───────────────────────────────────────────────────────────────────
describe('POST /assets — create', () => {
  test('creates an asset with valid payload', async () => {
    // POST / uses adminOnly + claims a pre-generated placeholder row
    const placeholder = await createPlaceholderAsset();
    assetIds.push(placeholder.id);

    const res = await request(app)
      .post('/assets')
      .set(adminHeader())
      .field('id', placeholder.id)
      .field('type_id', assetType.id)
      .field('status', 'In Service')
      .field('serial_number', `SN-${uid()}`);

    expect([200, 201]).toContain(res.status);
    const id = res.body?.asset?.id || res.body?.id || res.body?.data?.id;
    expect(id).toBeDefined();
    if (id && !assetIds.includes(id)) assetIds.push(id);
  });

  test('returns 400 when type_id is missing', async () => {
    const res = await request(app)
      .post('/assets')
      .set(adminHeader())
      .field('status', 'In Service');

    expect([400, 422]).toContain(res.status);
  });

  test('rejects an invalid status value', async () => {
    const placeholder = await createPlaceholderAsset();
    assetIds.push(placeholder.id);

    const res = await request(app)
      .post('/assets')
      .set(adminHeader())
      .field('id', placeholder.id)
      .field('type_id', assetType.id)
      .field('status', 'DEFINITELY_NOT_A_STATUS')
      .field('serial_number', `SN-${uid()}`);

    expect([400, 422]).toContain(res.status);
  });
});

// ─── Read ─────────────────────────────────────────────────────────────────────
describe('GET /assets/:id — individual asset', () => {
  let asset;

  beforeAll(async () => {
    asset = await createAsset(assetType.id);
    assetIds.push(asset.id);
  });

  test('returns the asset by id', async () => {
    const res = await request(app).get(`/assets/${asset.id}`);
    expect(res.status).toBe(200);
    const body = res.body?.data || res.body;
    expect(body.id).toBe(asset.id);
  });

  test('returns 404 for non-existent id', async () => {
    const res = await request(app).get(`/assets/${NON_EXISTENT_ASSET_ID}`);
    expect(res.status).toBe(404);
  });

  test('response includes status field', async () => {
    const res = await request(app).get(`/assets/${asset.id}`);
    const body = res.body?.data || res.body;
    expect(body.status).toBeDefined();
  });
});

// ─── Update ───────────────────────────────────────────────────────────────────
describe('PUT /assets/:id — update', () => {
  let asset;

  beforeAll(async () => {
    asset = await createAsset(assetType.id);
    assetIds.push(asset.id);
  });

  test('updates the serial number', async () => {
    const serial = `SN-${uid()}`;
    const res = await request(app)
      .put(`/assets/${asset.id}`)
      .set(authHeader())
      .send({ serial_number: serial });

    expect([200, 201]).toContain(res.status);
    expect(res.body?.success).toBe(true);
    const getRes = await request(app).get(`/assets/${asset.id}`);
    const body = getRes.body?.data || getRes.body;
    expect(body.serial_number).toBe(serial);
  });

  test('can change status to a valid value', async () => {
    const res = await request(app)
      .put(`/assets/${asset.id}`)
      .set(authHeader())
      .send({ status: 'Repair' });

    expect([200, 201]).toContain(res.status);
    expect(res.body?.success).toBe(true);
    const getRes = await request(app).get(`/assets/${asset.id}`);
    const body = getRes.body?.data || getRes.body;
    expect(body.status).toBe('Repair');
  });

  test('rejects invalid status on update', async () => {
    const res = await request(app)
      .put(`/assets/${asset.id}`)
      .set(authHeader())
      .send({ status: 'BANANA' });

    expect([400, 422]).toContain(res.status);
  });

  test('returns 404 for non-existent id', async () => {
    const res = await request(app)
      .put(`/assets/${NON_EXISTENT_ASSET_ID}`)
      .set(authHeader())
      .send({ status: 'In Service' });

    expect(res.status).toBe(404);
  });
});

// ─── Actions ──────────────────────────────────────────────────────────────────
describe('GET /assets/:id/actions — action history', () => {
  let asset;

  beforeAll(async () => {
    asset = await createAsset(assetType.id);
    assetIds.push(asset.id);
  });

  test('returns 200 and an array', async () => {
    const res = await request(app).get(`/assets/${asset.id}/actions`);
    expect(res.status).toBe(200);
    const list = res.body?.actions ?? res.body?.data ?? res.body;
    expect(Array.isArray(list)).toBe(true);
  });
});

describe('POST /assets/:id/actions — log action', () => {
  let asset;
  let actionIds = [];

  beforeAll(async () => {
    asset = await createAsset(assetType.id);
    assetIds.push(asset.id);
  });

  test('logs a service action', async () => {
    const res = await request(app)
      .post(`/assets/${asset.id}/actions`)
      .set(authHeader())
      .send({
        type: 'MAINTENANCE',
        note: 'Routine maintenance check',
        performed_by: 'Test User',
      });

    expect([200, 201]).toContain(res.status);
    const body = res.body?.action || res.body?.data || res.body;
    expect(body.id).toBeDefined();
    if (body.id) actionIds.push(body.id);
  });

  test('logs a note action', async () => {
    const res = await request(app)
      .post(`/assets/${asset.id}/actions`)
      .set(authHeader())
      .send({
        type: 'CHECK_IN',
        note: 'Asset inspected and in good condition',
      });

    expect([200, 201]).toContain(res.status);
  });

  test('logs a transfer action with target user', async () => {
    const user = await createUser();
    userIds.push(user.id);

    const res = await request(app)
      .post(`/assets/${asset.id}/actions`)
      .set(authHeader())
      .send({
        type: 'TRANSFER',
        note: 'Transferred to field team',
        to_user_id: user.id,
      });

    expect([200, 201]).toContain(res.status);
  });

  test('returns 404 for non-existent asset', async () => {
    const res = await request(app)
      .post(`/assets/${NON_EXISTENT_ASSET_ID}/actions`)
      .set(authHeader())
      .send({ type: 'CHECK_IN', note: 'Does not exist' });

    expect(res.status).toBe(404);
  });
});

// ─── Sign-off ─────────────────────────────────────────────────────────────────
describe('GET /assets/actions/pending-signoff', () => {
  test('returns 200 and an array', async () => {
    const res = await request(app)
      .get('/assets/actions/pending-signoff')
      .set(authHeader());

    expect(res.status).toBe(200);
    const list = res.body?.items ?? res.body?.data ?? res.body;
    expect(Array.isArray(list)).toBe(true);
  });
});

// ─── Delete ───────────────────────────────────────────────────────────────────
describe('DELETE /assets/:id', () => {
  test('soft-deletes an asset', async () => {
    const asset = await createAsset(assetType.id);
    assetIds.push(asset.id);

    const res = await request(app)
      .delete(`/assets/${asset.id}`)
      .set(adminHeader());

    expect([200, 204]).toContain(res.status);
  });

  test('returns 404 for non-existent id', async () => {
    const res = await request(app)
      .delete(`/assets/${NON_EXISTENT_ASSET_ID}`)
      .set(adminHeader());

    expect(res.status).toBe(404);
  });
});
