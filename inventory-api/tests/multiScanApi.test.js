/**
 * Multi-scan list screen loads each asset via GET /assets/:id and applies bulk PUT assignment.
 * These tests cover that API contract without the React client.
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
  uid,
} = require('./helpers');

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

describe('Multi-scan style bulk asset API', () => {
  test('parallel GET /assets/:id returns 200 for each scanned id', async () => {
    const a1 = await createAsset(assetType.id, { serial_number: `MS-${uid()}` });
    const a2 = await createAsset(assetType.id, { serial_number: `MS-${uid()}` });
    const a3 = await createAsset(assetType.id, { serial_number: `MS-${uid()}` });
    assetIds.push(a1.id, a2.id, a3.id);

    const results = await Promise.all(
      [a1.id, a2.id, a3.id].map((id) => request(app).get(`/assets/${id}`).set(authHeader()))
    );

    for (const res of results) {
      expect(res.status).toBe(200);
      expect(res.body?.id || res.body?.data?.id).toBeDefined();
    }
  });

  test('bulk transfer-to-me: PUT each selected asset with assigned_to_id', async () => {
    const a1 = await createAsset(assetType.id);
    const a2 = await createAsset(assetType.id);
    assetIds.push(a1.id, a2.id);

    for (const id of [a1.id, a2.id]) {
      const res = await request(app)
        .put(`/assets/${id}`)
        .set(authHeader())
        .send({ assigned_to_id: TEST_USER_ID });

      expect([200, 201]).toContain(res.status);
    }

    const g1 = await request(app).get(`/assets/${a1.id}`).set(authHeader());
    const g2 = await request(app).get(`/assets/${a2.id}`).set(authHeader());
    const u1 = g1.body?.assigned_to_id ?? g1.body?.data?.assigned_to_id;
    const u2 = g2.body?.assigned_to_id ?? g2.body?.data?.assigned_to_id;
    expect(u1).toBe(TEST_USER_ID);
    expect(u2).toBe(TEST_USER_ID);
  });

  test('bulk CHECK_IN action: POST /actions for each asset in a batch', async () => {
    const a1 = await createAsset(assetType.id);
    const a2 = await createAsset(assetType.id);
    assetIds.push(a1.id, a2.id);
    const note = `Bulk scan batch ${uid()}`;

    for (const id of [a1.id, a2.id]) {
      const res = await request(app)
        .post(`/assets/${id}/actions`)
        .set(authHeader())
        .send({ type: 'CHECK_IN', note });

      expect(res.status).toBe(201);
    }

    const h1 = await request(app).get(`/assets/${a1.id}/actions`).set(authHeader());
    const actions = h1.body?.actions ?? [];
    expect(actions.some((a) => a.type === 'CHECK_IN' && (a.note || '').includes('Bulk scan batch'))).toBe(true);
  });
});
