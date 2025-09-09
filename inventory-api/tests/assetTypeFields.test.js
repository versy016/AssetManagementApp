const request = require('supertest');
const { PrismaClient } = require('../generated/prisma');
const {app} = require('../server'); // <-- require the app module above

const prisma = new PrismaClient();

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  try {
    await prisma.asset_field_values.deleteMany({});
    await prisma.asset_type_fields.deleteMany({});
    await prisma.assets.deleteMany({});
    await prisma.asset_types.deleteMany({});
    await prisma.field_types.deleteMany({});
  } finally {
    await prisma.$disconnect();
  }
});

describe('Asset Type Fields API', () => {
  let testAssetType;
  let testFieldType;
  const authToken = 'test-token';

  beforeAll(async () => {
    testAssetType = await prisma.asset_types.create({
      data: { name: 'Test Asset Type', image_url: 'test-image.jpg' },
    });

    testFieldType = await prisma.field_types.create({
      data: {
        name: 'Text',
        slug: 'text',
        description: 'Text input field',
        has_options: false,
      },
    });
  });

  describe('POST /asset-types/:assetTypeId/fields', () => {
    it('should create a new asset type field', async () => {
      const slug = `test-field-${Date.now()}`; // unique per test
      const res = await request(app)
        .post(`/assets/asset-types/${testAssetType.id}/fields`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Test Field',
          slug,
          field_type_id: testFieldType.id,
          description: 'Test description',
          is_required: false,
          display_order: 1,
        });

      expect(res.statusCode).toEqual(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe('Test Field');
    });

    it('should return 400 for invalid field type', async () => {
      const res = await request(app)
        .post(`/assets/asset-types/${testAssetType.id}/fields`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Invalid Field',
          slug: `invalid-${Date.now()}`,
          field_type_id: 'invalid-uuid',
          is_required: true,
          display_order: 1,
        });

      expect(res.statusCode).toEqual(400);
    });

    it('should return 400 if options contain duplicates', async () => {
      const selectType = await prisma.field_types.create({
        data: {
          name: 'Select With Options',
          slug: `select-${Date.now()}`,
          has_options: true,
        },
      });

      const res = await request(app)
        .post(`/assets/asset-types/${testAssetType.id}/fields`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Bad Options Field',
          field_type_id: selectType.id,
          options: ['A', 'A'],
        });

      expect(res.statusCode).toEqual(400);
    });
  });

  describe('GET /:assetTypeId/fields', () => {
    it('should return all fields for an asset type', async () => {
      const slug = `get-field-${Date.now()}`;
      await prisma.asset_type_fields.create({
        data: {
          asset_type_id: testAssetType.id,
          field_type_id: testFieldType.id,
          name: 'Get Field',
          slug,
          description: 'Test description',
          is_required: false,
          display_order: 1,
        },
      });

      const res = await request(app)
        .get(`/assets/asset-types/${testAssetType.id}/fields`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.statusCode).toEqual(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });
  });

  describe('PUT /:assetTypeId/fields/:fieldId', () => {
    it('should update an asset type field', async () => {
      const slug = `put-field-${Date.now()}`;
      const field = await prisma.asset_type_fields.create({
        data: {
          asset_type_id: testAssetType.id,
          field_type_id: testFieldType.id,
          name: 'Put Field',
          slug,
          description: 'Test description',
          is_required: false,
          display_order: 1,
        },
      });

      const res = await request(app)
        .put(`/assets/asset-types/${testAssetType.id}/fields/${field.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Updated Test Field', display_order: 2 });

      expect(res.statusCode).toEqual(200);
      expect(res.body.name).toBe('Updated Test Field');
    });

    it('should return 404 for non-existent field', async () => {
      const res = await request(app)
        .put(`/assets/asset-types/${testAssetType.id}/fields/non-existent-id`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Non-existent Field' });

      expect(res.statusCode).toEqual(404);
    });
  });

  describe('DELETE /:assetTypeId/fields/:fieldId', () => {
    it('should delete an asset type field', async () => {
      const slug = `del-field-${Date.now()}`;
      const field = await prisma.asset_type_fields.create({
        data: {
          name: `Field to Delete`,
          slug,
          asset_type_id: testAssetType.id,
          field_type_id: testFieldType.id,
          description: 'Field to be deleted',
          is_required: false,
          display_order: 1,
        },
      });

      const res = await request(app)
        .delete(`/assets/asset-types/${testAssetType.id}/fields/${field.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.statusCode).toEqual(200);
      expect(res.body).toHaveProperty('success', true);
    });

    it('should return 404 when deleting non-existent field', async () => {
      const res = await request(app)
        .delete(`/assets/asset-types/${testAssetType.id}/fields/non-existent-id`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.statusCode).toEqual(404);
    });
  });
});
