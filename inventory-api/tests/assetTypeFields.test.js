/**
 * Integration tests for /assets/asset-types/:id/fields (handled by routes/assets.js).
 */
const request = require('supertest');
const { app, prisma } = require('../server');
const { adminHeader, ensureTestUsers } = require('./helpers');

const BASE = (assetTypeId) => `/assets/asset-types/${assetTypeId}/fields`;
const UNKNOWN_FIELD_TYPE_ID = '00000000-0000-0000-0000-000000000099';
const MISSING_FIELD_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

let testAssetType;
let testFieldType;
const extraFieldTypeIds = [];

beforeAll(async () => {
  await prisma.$connect();
  await ensureTestUsers();

  testAssetType = await prisma.asset_types.create({
    data: { name: 'Test Asset Type Fields API', image_url: 'test-image.jpg' },
  });

  testFieldType = await prisma.field_types.create({
    data: {
      name: 'Text',
      slug: `text-atf-${Date.now()}`,
      description: 'Text input field',
      has_options: false,
    },
  });
  extraFieldTypeIds.push(testFieldType.id);
});

afterAll(async () => {
  try {
    await prisma.asset_type_fields.deleteMany({ where: { asset_type_id: testAssetType.id } });
    if (extraFieldTypeIds.length) {
      await prisma.field_types.deleteMany({ where: { id: { in: extraFieldTypeIds } } });
    }
    await prisma.asset_types.delete({ where: { id: testAssetType.id } });
  } finally {
    await prisma.$disconnect();
  }
});

describe('Asset Type Fields API', () => {
  describe('POST /asset-types/:assetTypeId/fields', () => {
    it('should create a new asset type field', async () => {
      const slug = `test-field-${Date.now()}`;
      const res = await request(app)
        .post(BASE(testAssetType.id))
        .set(adminHeader())
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
        .post(BASE(testAssetType.id))
        .set(adminHeader())
        .send({
          name: 'Invalid Field',
          slug: `invalid-${Date.now()}`,
          field_type_id: UNKNOWN_FIELD_TYPE_ID,
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
      extraFieldTypeIds.push(selectType.id);

      const res = await request(app)
        .post(BASE(testAssetType.id))
        .set(adminHeader())
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

      const res = await request(app).get(BASE(testAssetType.id));

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
        .put(`${BASE(testAssetType.id)}/${field.id}`)
        .set(adminHeader())
        .send({ name: 'Updated Test Field', display_order: 2 });

      expect(res.statusCode).toEqual(200);
      expect(res.body.name).toBe('Updated Test Field');
    });

    it('should return 404 for non-existent field', async () => {
      const res = await request(app)
        .put(`${BASE(testAssetType.id)}/${MISSING_FIELD_ID}`)
        .set(adminHeader())
        .send({ name: 'Non-existent Field' });

      expect(res.statusCode).toEqual(404);
    });
  });

  describe('DELETE /:assetTypeId/fields/:fieldId', () => {
    it('should delete an asset type field', async () => {
      const slug = `del-field-${Date.now()}`;
      const field = await prisma.asset_type_fields.create({
        data: {
          name: 'Field to Delete',
          slug,
          asset_type_id: testAssetType.id,
          field_type_id: testFieldType.id,
          description: 'Field to be deleted',
          is_required: false,
          display_order: 1,
        },
      });

      const res = await request(app)
        .delete(`${BASE(testAssetType.id)}/${field.id}`)
        .set(adminHeader());

      expect(res.statusCode).toEqual(200);
      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 404 when deleting non-existent field', async () => {
      const res = await request(app)
        .delete(`${BASE(testAssetType.id)}/${MISSING_FIELD_ID}`)
        .set(adminHeader());

      expect(res.statusCode).toEqual(404);
    });
  });
});
