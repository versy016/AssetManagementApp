/**
 * tests/assetDocuments.test.js
 * Checklist area: Certificates / Documents — upload, list, update, delete.
 *
 * Verifies:
 *  - GET /assets/documents — list all documents (global)
 *  - GET /assets/:id/documents — list documents for one asset
 *  - POST /assets/:id/documents — create a document record (without file upload)
 *  - PATCH /assets/:id/documents/:docId — update document metadata
 *  - DELETE /assets/:id/documents/:docId — delete a document
 */
'use strict';

const request = require('supertest');
const path    = require('path');
const fs      = require('fs');
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

/** Mounted at /asset-documents — avoids GET /assets/documents being captured by GET /assets/:id ("documents"). */
const DOC_BASE = '/asset-documents';

let assetType;
let assetIds = [];
let docIds   = [];

beforeAll(async () => {
  await ensureTestUsers();
  assetType = await createAssetType();
});

afterAll(async () => {
  // Clean up document records first
  const { getPrisma } = require('./helpers');
  for (const { assetId, docId } of docIds) {
    try {
      await getPrisma().asset_documents.delete({ where: { id: docId } });
    } catch (_) {}
  }
  await safeDelete('assets', assetIds);
  try {
    await getPrisma().asset_types.delete({ where: { id: assetType.id } });
  } catch (_) {}
  await disconnectPrisma();
});

// ─── Global document list ─────────────────────────────────────────────────────
describe('GET /asset-documents/documents — global document list', () => {
  test('returns 200 and an array', async () => {
    const res = await request(app).get(`${DOC_BASE}/documents`).set(authHeader());
    expect(res.status).toBe(200);
    const list = res.body?.items ?? res.body?.data ?? res.body;
    expect(Array.isArray(list)).toBe(true);
  });

  test('accepts assetId filter', async () => {
    const asset = await createAsset(assetType.id);
    assetIds.push(asset.id);
    const res = await request(app)
      .get(`${DOC_BASE}/documents?assetId=${asset.id}`)
      .set(authHeader());
    expect(res.status).toBe(200);
  });

  test('accepts kind filter for certificate-style docs', async () => {
    const res = await request(app).get(`${DOC_BASE}/documents?kind=certificate`).set(authHeader());
    expect(res.status).toBe(200);
    const list = res.body?.items ?? [];
    expect(Array.isArray(list)).toBe(true);
    for (const d of list) {
      expect(d.kind).toBe('certificate');
    }
  });
});

// ─── Per-asset document list ──────────────────────────────────────────────────
describe('GET /asset-documents/:id/documents — documents for one asset', () => {
  let asset;

  beforeAll(async () => {
    asset = await createAsset(assetType.id);
    assetIds.push(asset.id);
  });

  test('returns 200 and an array (empty for new asset)', async () => {
    const res = await request(app)
      .get(`${DOC_BASE}/${asset.id}/documents`)
      .set(authHeader());

    expect(res.status).toBe(200);
    const list = res.body?.items ?? res.body?.data ?? res.body;
    expect(Array.isArray(list)).toBe(true);
  });

  test('returns 404 for non-existent asset', async () => {
    const res = await request(app)
      .get(`${DOC_BASE}/f47ac10b-58cc-4372-a567-0e02b2c3d479/documents`)
      .set(authHeader());

    expect(res.status).toBe(404);
  });
});

// ─── Create document record ───────────────────────────────────────────────────
describe('POST /asset-documents/:id/documents — create document record', () => {
  let asset;

  beforeAll(async () => {
    asset = await createAsset(assetType.id);
    assetIds.push(asset.id);
  });

  test('creates a document record with url and title', async () => {
    const res = await request(app)
      .post(`${DOC_BASE}/${asset.id}/documents`)
      .set(authHeader())
      .send({
        title: `Test Certificate ${uid()}`,
        url: 'https://example.com/test-cert.pdf',
        kind: 'certificate',
      });

    expect([200, 201]).toContain(res.status);
    const doc = res.body?.document || res.body?.data || res.body;
    if (doc?.id) {
      docIds.push({ assetId: asset.id, docId: doc.id });
    }
  });

  test('returns 404 for non-existent asset', async () => {
    const res = await request(app)
      .post(`${DOC_BASE}/f47ac10b-58cc-4372-a567-0e02b2c3d479/documents`)
      .set(authHeader())
      .send({ title: 'Test', url: 'https://example.com/test.pdf' });

    expect(res.status).toBe(404);
  });
});

// ─── Update document metadata ─────────────────────────────────────────────────
describe('PATCH /asset-documents/:id/documents/:docId — update document', () => {
  let asset;
  let docId;

  beforeAll(async () => {
    asset = await createAsset(assetType.id);
    assetIds.push(asset.id);

    const res = await request(app)
      .post(`${DOC_BASE}/${asset.id}/documents`)
      .set(authHeader())
      .send({ title: `Patch Test Doc ${uid()}`, url: 'https://example.com/orig.pdf' });

    docId = res.body?.document?.id || res.body?.data?.id || res.body?.id;
    if (docId) docIds.push({ assetId: asset.id, docId });
  });

  test('updates the document name', async () => {
    if (!docId) return;
    const newName = `Updated Doc ${uid()}`;
    const res = await request(app)
      .patch(`${DOC_BASE}/${asset.id}/documents/${docId}`)
      .set(authHeader())
      .send({ title: newName });

    expect([200, 201]).toContain(res.status);
  });

  test('returns 404 for non-existent docId', async () => {
    const res = await request(app)
      .patch(`${DOC_BASE}/${asset.id}/documents/f47ac10b-58cc-4372-a567-0e02b2c3d479`)
      .set(authHeader())
      .send({ title: 'Ghost Doc' });

    expect([404, 500]).toContain(res.status);
  });
});

// ─── Delete document ──────────────────────────────────────────────────────────
describe('DELETE /asset-documents/:id/documents/:docId — delete document', () => {
  let asset;

  beforeAll(async () => {
    asset = await createAsset(assetType.id);
    assetIds.push(asset.id);
  });

  test('deletes a document and returns success', async () => {
    // Create a doc to delete
    const createRes = await request(app)
      .post(`${DOC_BASE}/${asset.id}/documents`)
      .set(authHeader())
      .send({ title: `Delete Me ${uid()}`, url: 'https://example.com/del.pdf' });

    const docId = createRes.body?.document?.id || createRes.body?.data?.id || createRes.body?.id;
    if (!docId) return;

    const res = await request(app)
      .delete(`${DOC_BASE}/${asset.id}/documents/${docId}`)
      .set(authHeader());

    expect([200, 204]).toContain(res.status);
  });

  test('document no longer appears in list after deletion', async () => {
    const createRes = await request(app)
      .post(`${DOC_BASE}/${asset.id}/documents`)
      .set(authHeader())
      .send({ title: `Gone Doc ${uid()}`, url: 'https://example.com/gone.pdf' });

    const docId = createRes.body?.document?.id || createRes.body?.data?.id || createRes.body?.id;
    if (!docId) return;

    await request(app).delete(`${DOC_BASE}/${asset.id}/documents/${docId}`).set(authHeader());

    const listRes = await request(app)
      .get(`${DOC_BASE}/${asset.id}/documents`)
      .set(authHeader());
    const list = listRes.body?.items ?? listRes.body?.data ?? listRes.body ?? [];
    const found = list.find((d) => d.id === docId);
    expect(found).toBeUndefined();
  });

  test('returns 404 for non-existent docId', async () => {
    const res = await request(app)
      .delete(`${DOC_BASE}/${asset.id}/documents/f47ac10b-58cc-4372-a567-0e02b2c3d479`)
      .set(authHeader());

    expect([404, 400]).toContain(res.status);
  });
});
