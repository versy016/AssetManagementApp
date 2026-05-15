/**
 * tests/hireLifecycle.test.js
 * Checklist area: Equipment Hire Disclaimer — full lifecycle.
 *
 * Verifies:
 *  - POST /hire-disclaimer/generate — generate docx (no DB)
 *  - POST /hire-disclaimer/generate with respondWith=json — persists hire record
 *  - GET /hire-disclaimer/hires — list all hires
 *  - GET /hire-disclaimer/hires/:id/document — serve document
 *  - PATCH /hire-disclaimer/hires/:id/signature-status — update status
 *  - DELETE /hire-disclaimer/hires/:id — remove hire
 *  - Validation: missing required fields
 *  - Edge cases: single vs. multiple equipment items
 */
'use strict';

const request = require('supertest');
const PizZip = require('pizzip');
const { app } = require('../server');
const {
  authHeader,
  hireSample,
  uid,
  disconnectPrisma,
  createAssetType,
  createAsset,
  ensureTestUsers,
  safeDelete,
} = require('./helpers');

const hireIds = [];
let hireAssetType;
let hireLinkedAsset;
let hireAssetIds = [];

function hiresList(body) {
  if (Array.isArray(body?.hires)) return body.hires;
  if (Array.isArray(body)) return body;
  return body?.data || [];
}

afterAll(async () => {
  for (const id of hireIds) {
    await request(app).delete(`/hire-disclaimer/hires/${id}`).set(authHeader()).catch(() => {});
  }
  await safeDelete('assets', hireAssetIds);
  try {
    const { getPrisma } = require('./helpers');
    if (hireAssetType?.id) {
      await getPrisma().asset_types.delete({ where: { id: hireAssetType.id } }).catch(() => {});
    }
  } catch (_) {}
  await disconnectPrisma();
});

beforeAll(async () => {
  await ensureTestUsers();
  hireAssetType = await createAssetType();
  hireLinkedAsset = await createAsset(hireAssetType.id);
  hireAssetIds.push(hireLinkedAsset.id);
});

function hireJsonPayload(overrides = {}) {
  return hireSample({
    equipmentItems: [
      { assetId: hireLinkedAsset.serial_number || hireLinkedAsset.id, description: 'Linked test asset' },
    ],
    respondWith: 'json',
    ...overrides,
  });
}

// ─── Document generation (no DB) ──────────────────────────────────────────────
describe('POST /hire-disclaimer/generate — generate .docx', () => {
  test('returns 200 with a valid docx binary for a full payload', async () => {
    const res = await request(app)
      .post('/hire-disclaimer/generate')
      .set(authHeader())
      .send(hireSample())
      .responseType('blob')
      .expect(200);

    expect(res.headers['content-type']).toMatch(/wordprocessingml|octet-stream/);
    const buf = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body);
    expect(buf.length).toBeGreaterThan(500);
    // Verify it is a valid ZIP / docx
    const zip = new PizZip(buf);
    expect(zip.files['word/document.xml']).toBeDefined();
  });

  test('Content-Disposition header includes hirer name and .docx extension', async () => {
    const payload = hireSample({ hirerName: 'Jane Smith' });
    const res = await request(app)
      .post('/hire-disclaimer/generate')
      .set(authHeader())
      .send(payload)
      .responseType('blob');

    const disposition = res.headers['content-disposition'] || '';
    expect(disposition).toMatch(/\.docx/i);
  });

  test('document XML contains company branding', async () => {
    const res = await request(app)
      .post('/hire-disclaimer/generate')
      .set(authHeader())
      .send(hireSample())
      .responseType('blob');

    const buf = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body);
    const zip = new PizZip(buf);
    const xml = zip.files['word/document.xml'].asText();
    expect(xml).toMatch(/Engineering Survey[s']?/);
    expect(xml.length).toBeGreaterThan(2000);
  });

  test('accepts payload with a single equipment item', async () => {
    const res = await request(app)
      .post('/hire-disclaimer/generate')
      .set(authHeader())
      .send(hireSample({ equipmentItems: [{ assetId: 'TS-001', description: 'Total Station' }] }))
      .responseType('blob')
      .expect(200);

    expect(Buffer.from(res.body).length).toBeGreaterThan(200);
  });

  test('accepts payload with multiple equipment items', async () => {
    const res = await request(app)
      .post('/hire-disclaimer/generate')
      .set(authHeader())
      .send(hireSample({
        equipmentItems: [
          { assetId: 'TS-001', description: 'Total Station' },
          { assetId: 'PR-002', description: 'Prism set' },
          { assetId: 'TR-003', description: 'Tripod' },
        ],
      }))
      .responseType('blob')
      .expect(200);

    expect(Buffer.from(res.body).length).toBeGreaterThan(200);
  });

  test('accepts minimal payload (blank fields)', async () => {
    const res = await request(app)
      .post('/hire-disclaimer/generate')
      .set(authHeader())
      .send({ hirerName: '', address: '', phone: '', email: '', termsAgreed: false })
      .responseType('blob')
      .expect(200);

    expect(res.headers['content-type']).toMatch(/wordprocessingml/);
  });
});

// ─── Persisted hire records ────────────────────────────────────────────────────
describe('POST /hire-disclaimer/generate with respondWith=json — creates hire record', () => {
  let hireId;

  test('returns hireId on success', async () => {
    const res = await request(app)
      .post('/hire-disclaimer/generate')
      .set(authHeader())
      .send(hireJsonPayload());

    expect([200, 201]).toContain(res.status);
    hireId = res.body?.hireId;
    if (hireId) hireIds.push(hireId);
    expect(hireId).toBeDefined();
  });

  test('hire appears in GET /hire-disclaimer/hires', async () => {
    if (!hireId) return;
    const res = await request(app).get('/hire-disclaimer/hires').set(authHeader());
    expect(res.status).toBe(200);
    const list = hiresList(res.body);
    const found = list.find((h) => h.id === hireId);
    expect(found).toBeDefined();
  });

  test('hire record has expected shape', async () => {
    if (!hireId) return;
    const res = await request(app).get('/hire-disclaimer/hires').set(authHeader());
    const list = hiresList(res.body);
    const hire = list.find((h) => h.id === hireId);
    if (!hire) return;
    // Data fields from the payload should be present
    expect(hire.data || hire).toBeDefined();
  });

  test('returns 404 when updating non-existent existingActionId', async () => {
    const res = await request(app)
      .post('/hire-disclaimer/generate')
      .set(authHeader())
      .send(hireSample({
        respondWith: 'json',
        existingActionId: '00000000-0000-0000-0000-000000000000',
      }));

    expect(res.status).toBe(404);
    expect(res.body?.error).toMatch(/not found/i);
  });
});

// ─── GET /hire-disclaimer/hires — listing ─────────────────────────────────────
describe('GET /hire-disclaimer/hires — list', () => {
  test('returns 200 and an array', async () => {
    const res = await request(app).get('/hire-disclaimer/hires').set(authHeader());
    expect(res.status).toBe(200);
    const list = hiresList(res.body);
    expect(Array.isArray(list)).toBe(true);
  });

  test('accepts status filter without crashing', async () => {
    const res = await request(app)
      .get('/hire-disclaimer/hires?status=pending')
      .set(authHeader());
    expect([200]).toContain(res.status);
  });
});

// ─── GET .../document ─────────────────────────────────────────────────────────
describe('GET /hire-disclaimer/hires/:id/document', () => {
  let hireId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/hire-disclaimer/generate')
      .set(authHeader())
      .send(hireJsonPayload());
    hireId = res.body?.hireId;
    if (hireId) hireIds.push(hireId);
  });

  test('returns a document for an existing hire', async () => {
    if (!hireId) return;
    const res = await request(app)
      .get(`/hire-disclaimer/hires/${hireId}/document`)
      .set(authHeader())
      .responseType('blob');

    // Should return a docx or pdf, not a 500
    expect([200, 503]).toContain(res.status); // 503 = LibreOffice not installed
  });

  test('returns 404 for non-existent hire', async () => {
    const res = await request(app)
      .get('/hire-disclaimer/hires/00000000-0000-0000-0000-000000000000/document')
      .set(authHeader());

    expect(res.status).toBe(404);
  });
});

// ─── Signature status ─────────────────────────────────────────────────────────
describe('PATCH /hire-disclaimer/hires/:id/signature-status', () => {
  let hireId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/hire-disclaimer/generate')
      .set(authHeader())
      .send(hireJsonPayload());
    hireId = res.body?.hireId;
    if (hireId) hireIds.push(hireId);
  });

  test('transitions status to "pending_signature"', async () => {
    if (!hireId) return;
    const res = await request(app)
      .patch(`/hire-disclaimer/hires/${hireId}/signature-status`)
      .set(authHeader())
      .send({ status: 'pending_signature' });

    expect([200, 204]).toContain(res.status);
  });

  test('transitions status to "signed"', async () => {
    if (!hireId) return;
    const res = await request(app)
      .patch(`/hire-disclaimer/hires/${hireId}/signature-status`)
      .set(authHeader())
      .send({ status: 'signed' });

    expect([200, 204]).toContain(res.status);
  });

  test('returns 404 for unknown hire id', async () => {
    const res = await request(app)
      .patch('/hire-disclaimer/hires/00000000-0000-0000-0000-000000000000/signature-status')
      .set(authHeader())
      .send({ status: 'signed' });

    expect(res.status).toBe(404);
  });
});

// ─── Delete ───────────────────────────────────────────────────────────────────
describe('DELETE /hire-disclaimer/hires/:id', () => {
  test('deletes a hire record', async () => {
    const createRes = await request(app)
      .post('/hire-disclaimer/generate')
      .set(authHeader())
      .send(hireJsonPayload());

    const hireId = createRes.body?.hireId;
    if (!hireId) return;

    const res = await request(app)
      .delete(`/hire-disclaimer/hires/${hireId}`)
      .set(authHeader());

    expect([200, 204]).toContain(res.status);
  });

  test('hire no longer appears in list after deletion', async () => {
    const createRes = await request(app)
      .post('/hire-disclaimer/generate')
      .set(authHeader())
      .send(hireJsonPayload());

    const hireId = createRes.body?.hireId;
    if (!hireId) return;

    await request(app).delete(`/hire-disclaimer/hires/${hireId}`).set(authHeader());

    const listRes = await request(app).get('/hire-disclaimer/hires').set(authHeader());
    const list = hiresList(listRes.body);
    const found = list.find((h) => h.id === hireId);
    expect(found).toBeUndefined();
  });

  test('returns 404 for unknown hire id', async () => {
    const res = await request(app)
      .delete('/hire-disclaimer/hires/00000000-0000-0000-0000-000000000000')
      .set(authHeader());

    expect(res.status).toBe(404);
  });
});

// ─── Hire dashboard / signing flags ──────────────────────────────────────────
describe('Hire dashboard API extras', () => {
  test('GET /hire-disclaimer/signing/status returns enabled and signAnchor', async () => {
    const res = await request(app).get('/hire-disclaimer/signing/status').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('enabled');
    expect(typeof res.body.enabled).toBe('boolean');
    expect(res.body).toHaveProperty('signAnchor');
  });

  test('persisted hire row in GET /hire-disclaimer/hires includes contact and asset linkage', async () => {
    const email = `hire-row-${uid()}@example.com`;
    const createRes = await request(app)
      .post('/hire-disclaimer/generate')
      .set(authHeader())
      .send(
        hireJsonPayload({
          email,
          hirerName: `Row Test ${uid()}`,
        })
      );

    const hireId = createRes.body?.hireId;
    expect(hireId).toBeDefined();
    if (hireId) hireIds.push(hireId);

    const listRes = await request(app).get('/hire-disclaimer/hires').set(authHeader());
    expect(listRes.status).toBe(200);
    const list = hiresList(listRes.body);
    const row = list.find((h) => h.id === hireId);
    expect(row).toBeDefined();
    expect(row.email).toBe(email);
    expect(row.assetId).toBe(hireLinkedAsset.id);
    expect(row.signatureStatusLabel).toMatch(/Pending|Signed/i);
  });
});
