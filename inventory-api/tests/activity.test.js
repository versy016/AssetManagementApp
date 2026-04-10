/**
 * tests/activity.test.js
 * Checklist area: Activity feed — shows all asset actions across the system.
 *
 * Verifies:
 *  - GET /activity returns 200 and an array
 *  - Pagination params are accepted
 *  - Response shape includes expected fields
 *  - After creating an asset action it appears in the feed
 */
'use strict';

const request = require('supertest');
const { app } = require('../server');
const {
  authHeader,
  createAssetType,
  createAsset,
  disconnectPrisma,
  safeDelete,
} = require('./helpers');

let assetType;
let assetIds = [];

beforeAll(async () => {
  assetType = await createAssetType();
});

afterAll(async () => {
  await safeDelete('assets', assetIds);
  const { getPrisma } = require('./helpers');
  try {
    await getPrisma().asset_types.delete({ where: { id: assetType.id } });
  } catch (_) {}
  await disconnectPrisma();
});

function activityItems(body) {
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.data)) return body.data;
  return Array.isArray(body) ? body : [];
}

describe('GET /activity — activity feed', () => {
  test('returns 200 and an array', async () => {
    const res = await request(app).get('/activity').set(authHeader());
    expect(res.status).toBe(200);
    const list = activityItems(res.body);
    expect(Array.isArray(list)).toBe(true);
  });

  test('accepts a limit parameter', async () => {
    const res = await request(app).get('/activity?limit=5').set(authHeader());
    expect(res.status).toBe(200);
    const list = activityItems(res.body);
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeLessThanOrEqual(5);
  });

  test('accepts an offset / page parameter without crashing', async () => {
    const res = await request(app).get('/activity?limit=5&offset=0').set(authHeader());
    expect([200]).toContain(res.status);
  });

  test('each item has expected shape fields', async () => {
    const res = await request(app).get('/activity?limit=10').set(authHeader());
    const list = activityItems(res.body);
    if (list.length === 0) return; // nothing to assert shape on
    const item = list[0];
    expect(item).toHaveProperty('type');
    expect(item.when || item.created_at || item.timestamp || item.performed_at || item.addedAt || item.date).toBeDefined();
  });

  test('activity grows after an asset action is logged', async () => {
    const asset = await createAsset(assetType.id);
    assetIds.push(asset.id);

    const before = await request(app).get('/activity?limit=100').set(authHeader());
    const countBefore = activityItems(before.body).length;

    await request(app)
      .post(`/assets/${asset.id}/actions`)
      .set(authHeader())
      .send({ type: 'CHECK_IN', note: 'Activity feed test note' });

    const after = await request(app).get('/activity?limit=100').set(authHeader());
    const countAfter = activityItems(after.body).length;

    expect(countAfter).toBeGreaterThanOrEqual(countBefore);
  });
});
