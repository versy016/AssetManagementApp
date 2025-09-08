// tests/assetTypes.test.js
/**
 * Integration tests for /asset-types
 * Run with NODE_ENV=test and a test database.
 */
const request = require('supertest');
const { app, prisma } = require('../server');

describe('Asset Types API', () => {
  let createdId;

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    // Clean up any created test rows (ignore failures)
    if (createdId) {
      try {
        // Safe delete: only if no assets reference it.
        const counts = await prisma.assets.count({ where: { type_id: createdId } });
        if (counts === 0) {
          await prisma.asset_types.delete({ where: { id: createdId } });
        }
      } catch (_) {}
    }
    await prisma.$disconnect();
  });

  test('POST /asset-types should create a new asset type', async () => {
    const res = await request(app)
      .post('/asset-types')
      .send({ name: 'Test Type A', image_url: 'https://example.com/img.png' });

    expect(res.status).toBe(201);
    expect(res.body?.data?.id).toBeDefined();
    expect(res.body?.data?.name).toBe('Test Type A');
    createdId = res.body.data.id;
  });

  test('GET /asset-types should list asset types with pagination', async () => {
    const res = await request(app).get('/asset-types?page=1&pageSize=5&include=counts');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
    expect(Array.isArray(res.body.data)).toBe(true);
    // If include=counts was requested, returned rows should have _count
    if (res.body.data.length) {
      expect(res.body.data[0]).toHaveProperty('_count');
    }
  });

  test('GET /asset-types?q=fuzzy should work (case-insensitive search)', async () => {
    const res = await request(app).get('/asset-types?q=test type');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /asset-types/:id should return the created asset type', async () => {
    const res = await request(app).get(`/asset-types/${createdId}?include=fields,counts`);
    expect(res.status).toBe(200);
    expect(res.body?.data?.id).toBe(createdId);
    expect(res.body?.data).toHaveProperty('_count');
  });

  test('PUT /asset-types/:id should update name', async () => {
    const res = await request(app)
      .put(`/asset-types/${createdId}`)
      .send({ name: 'Test Type A (Updated)' });

    expect(res.status).toBe(200);
    expect(res.body?.data?.name).toBe('Test Type A (Updated)');
  });

  test('DELETE /asset-types/:id should delete when no assets reference it', async () => {
    // Create a disposable type to delete (avoid conflicts with `createdId` if later used)
    const toDelete = await prisma.asset_types.create({ data: { name: 'Disposable Type' } });

    const res = await request(app).delete(`/asset-types/${toDelete.id}`);
    expect(res.status).toBe(200);
    expect(res.body?.message).toMatch(/Deleted/i);
  });

  test('DELETE /asset-types/:id should fail if assets reference it', async () => {
    // Create a type and attach an asset to it
    const type = await prisma.asset_types.create({ data: { name: 'Linked Type' } });
    await prisma.assets.create({
      data: {
        id: undefined,            // DB default UUID
        type_id: type.id,
        status: 'active',
      },
    });

    const res = await request(app).delete(`/asset-types/${type.id}`);
    expect(res.status).toBe(400);
    expect(res.body?.message).toMatch(/Cannot delete asset type with existing assets/);

    // cleanup: remove asset then type
    await prisma.assets.deleteMany({ where: { type_id: type.id } });
    await prisma.asset_types.delete({ where: { id: type.id } });
  });

  test('GET /asset-types/:id returns 404 for unknown id', async () => {
    const res = await request(app).get('/asset-types/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });
});
