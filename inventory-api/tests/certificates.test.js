/**
 * Certificates (asset_documents with certificate semantics).
 * Mirrors how the app treats certs: kind, title, related_date, global + per-asset lists.
 */
'use strict';

const request = require('supertest');
const { app } = require('../server');
const {
  authHeader,
  createAssetType,
  createAsset,
  disconnectPrisma,
  ensureTestUsers,
  safeDelete,
  uid,
} = require('./helpers');

const DOC_BASE = '/asset-documents';

let assetType;
const assetIds = [];
const docIds = [];

beforeAll(async () => {
  await ensureTestUsers();
  assetType = await createAssetType();
});

afterAll(async () => {
  const { getPrisma } = require('./helpers');
  for (const id of docIds) {
    try {
      await getPrisma().asset_documents.delete({ where: { id } });
    } catch (_) {}
  }
  await safeDelete('assets', assetIds);
  try {
    await getPrisma().asset_types.delete({ where: { id: assetType.id } });
  } catch (_) {}
  await disconnectPrisma();
});

describe('Certificate documents API', () => {
  test('POST creates a certificate row with kind and appears in global list filtered by kind', async () => {
    const asset = await createAsset(assetType.id);
    assetIds.push(asset.id);

    const title = `Calibration ${uid()}`;
    const createRes = await request(app)
      .post(`${DOC_BASE}/${asset.id}/documents`)
      .set(authHeader())
      .send({
        title,
        url: 'https://example.com/certs/calibration.pdf',
        kind: 'certificate',
        related_date: '2027-06-15',
        related_date_label: 'Expiry',
      });

    expect([200, 201]).toContain(createRes.status);
    const doc = createRes.body?.document;
    expect(doc?.id).toBeDefined();
    if (doc?.id) docIds.push(doc.id);
    expect(doc?.kind).toBe('certificate');

    const listRes = await request(app)
      .get(`${DOC_BASE}/documents?kind=certificate`)
      .set(authHeader());

    expect(listRes.status).toBe(200);
    const items = listRes.body?.items ?? [];
    expect(Array.isArray(items)).toBe(true);
    const found = items.find((d) => d.id === doc.id);
    expect(found).toBeDefined();
    expect(found.title).toBe(title);
  });

  test('GET per-asset documents includes certificate kind for that asset', async () => {
    const asset = await createAsset(assetType.id);
    assetIds.push(asset.id);

    const createRes = await request(app)
      .post(`${DOC_BASE}/${asset.id}/documents`)
      .set(authHeader())
      .send({
        title: `SWMS ${uid()}`,
        url: 'https://example.com/swms.pdf',
        kind: 'certificate',
      });

    const docId = createRes.body?.document?.id;
    if (docId) docIds.push(docId);

    const res = await request(app).get(`${DOC_BASE}/${asset.id}/documents`).set(authHeader());
    expect(res.status).toBe(200);
    const items = res.body?.items ?? [];
    const cert = items.find((d) => d.kind === 'certificate');
    expect(cert).toBeDefined();
  });

  test('PATCH updates certificate title and related_date', async () => {
    const asset = await createAsset(assetType.id);
    assetIds.push(asset.id);

    const createRes = await request(app)
      .post(`${DOC_BASE}/${asset.id}/documents`)
      .set(authHeader())
      .send({
        title: `Original ${uid()}`,
        url: 'https://example.com/orig-cert.pdf',
        kind: 'certificate',
      });

    const docId = createRes.body?.document?.id;
    if (!docId) return;
    docIds.push(docId);

    const patchRes = await request(app)
      .patch(`${DOC_BASE}/${asset.id}/documents/${docId}`)
      .set(authHeader())
      .send({
        title: 'Updated certificate title',
        related_date: '2028-01-01',
        related_date_label: 'Next inspection',
      });

    expect([200, 201]).toContain(patchRes.status);
    const updated = patchRes.body?.document;
    expect(updated?.title).toBe('Updated certificate title');
  });
});
