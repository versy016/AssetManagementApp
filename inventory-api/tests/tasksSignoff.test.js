/**
 * Tasks queue = GET /assets/actions/pending-signoff (repair / maintenance / hire needing sign-off).
 * Completion = POST /assets/:id/actions/:actionId/signoff
 */
'use strict';

const request = require('supertest');
const { app } = require('../server');
const {
  TEST_USER_ID,
  authHeader,
  createAssetType,
  createAsset,
  disconnectPrisma,
  ensureTestUsers,
  safeDelete,
} = require('./helpers');

const NON_ACTION = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

let assetType;
const assetIds = [];

beforeAll(async () => {
  await ensureTestUsers();
  assetType = await createAssetType();
});

afterAll(async () => {
  await safeDelete('assets', assetIds);
  try {
    const { getPrisma } = require('./helpers');
    await getPrisma().asset_types.delete({ where: { id: assetType.id } });
  } catch (_) {}
  await disconnectPrisma();
});

function pendingItems(body) {
  return body?.items ?? body?.data ?? [];
}

describe('Sign-off tasks (pending queue + complete)', () => {
  test('REPAIR with requires_signoff appears in pending-signoff then disappears after signoff', async () => {
    const asset = await createAsset(assetType.id);
    assetIds.push(asset.id);

    const assignRes = await request(app)
      .put(`/assets/${asset.id}`)
      .set(authHeader())
      .send({ assigned_to_id: TEST_USER_ID });
    expect([200, 201]).toContain(assignRes.status);

    const createRes = await request(app)
      .post(`/assets/${asset.id}/actions`)
      .set(authHeader())
      .send({
        type: 'REPAIR',
        note: 'Needs supervisor sign-off',
        data: { requires_signoff: true },
      });

    expect(createRes.status).toBe(201);
    const actionId = createRes.body?.action?.id;
    expect(actionId).toBeDefined();

    const pending1 = await request(app).get('/assets/actions/pending-signoff').set(authHeader());
    expect(pending1.status).toBe(200);
    const items1 = pendingItems(pending1.body);
    expect(items1.some((t) => t.actionId === actionId)).toBe(true);

    const signRes = await request(app)
      .post(`/assets/${asset.id}/actions/${actionId}/signoff`)
      .set(authHeader())
      .send({ completed: true, note: 'Approved' });

    expect(signRes.status).toBe(200);
    expect(signRes.body?.ok).toBe(true);

    const pending2 = await request(app).get('/assets/actions/pending-signoff').set(authHeader());
    const items2 = pendingItems(pending2.body);
    expect(items2.some((t) => t.actionId === actionId)).toBe(false);

    const getRes = await request(app).get(`/assets/${asset.id}`).set(authHeader());
    expect(getRes.status).toBe(200);
    const status = getRes.body?.status ?? getRes.body?.data?.status;
    expect(status).toBe('In Service');
  });

  test('MAINTENANCE sign-off task has expected list item shape', async () => {
    const asset = await createAsset(assetType.id);
    assetIds.push(asset.id);

    const createRes = await request(app)
      .post(`/assets/${asset.id}/actions`)
      .set(authHeader())
      .send({
        type: 'MAINTENANCE',
        note: 'Annual service',
        data: { requires_signoff: true },
      });

    const actionId = createRes.body?.action?.id;
    expect(actionId).toBeDefined();

    const pending = await request(app).get('/assets/actions/pending-signoff').set(authHeader());
    const row = pendingItems(pending.body).find((t) => t.actionId === actionId);
    expect(row).toBeDefined();
    expect(row.kind).toBe('signoff');
    expect(row.actionType).toBe('MAINTENANCE');
    expect(row.assetId).toBe(asset.id);
    expect(row.title).toMatch(/Maintenance/i);
  });

  test('POST signoff returns 404 for unknown action id', async () => {
    const asset = await createAsset(assetType.id);
    assetIds.push(asset.id);

    const res = await request(app)
      .post(`/assets/${asset.id}/actions/${NON_ACTION}/signoff`)
      .set(authHeader())
      .send({ completed: true });

    expect(res.status).toBe(404);
  });
});
