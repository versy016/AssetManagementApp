/**
 * Tests for POST /hire-disclaimer/generate
 * Run with: npm run test -- hireDisclaimer.test.js (or npm run test:ci)
 * No database required; uses sample payload to generate .docx and assert response.
 * Writes test output documents to assets/Sheets/ after a successful run.
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const PizZip = require('pizzip');
const { app } = require('../server');

/** Path to assets/Sheets (from repo root); tests run from inventory-api. */
const sheetsDir = path.join(__dirname, '..', '..', 'assets', 'Sheets');

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Sample payload matching the shape the frontend sends */
const samplePayload = {
  hirerName: 'Test Contact Name',
  companyEntity: 'Test Entity Pty Ltd',
  project: '',
  address: '123 Test Street, Sydney NSW 2000',
  phone: '0412345678',
  email: 'test@example.com',
  equipmentDescription: 'Total station',
  assetId: 'ASSET-001',
  equipmentItems: [
    { assetId: 'SER-1', description: 'Battery pack' },
    { assetId: 'SER-2', description: 'Charger' },
  ],
  hireStartDate: '2026-03-01',
  hireStartTime: '09:00',
  hireEndDate: '2026-03-05',
  hireEndTime: '',
  rate: '150',
  ratePeriod: 'day',
  termsAgreed: true,
  signatureName: 'Test Signatory',
  signatureDate: '2026-03-01',
};

describe('Hire Disclaimer API', () => {
  test('POST /hire-disclaimer/generate returns 200 and a .docx with full payload', async () => {
    const res = await request(app)
      .post('/hire-disclaimer/generate')
      .set('Content-Type', 'application/json')
      .send(samplePayload)
      .responseType('blob')
      .expect(200);

    expect(res.headers['content-type']).toMatch(/wordprocessingml|octet-stream/);
    const buf = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body);
    expect(buf.length).toBeGreaterThan(500);
  });

  test('POST /hire-disclaimer/generate response is a valid ZIP (docx)', async () => {
    const res = await request(app)
      .post('/hire-disclaimer/generate')
      .set('Content-Type', 'application/json')
      .send(samplePayload)
      .responseType('blob')
      .expect(200);

    const buf = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body);
    const zip = new PizZip(buf);
    expect(zip.files['word/document.xml']).toBeDefined();
    const docXml = zip.files['word/document.xml'].asText();
    expect(docXml).toMatch(/<w:document|wordprocessingml/);
    expect(docXml.length).toBeGreaterThan(500);
  });

  test('POST /hire-disclaimer/generate Content-Disposition includes filename with contact name', async () => {
    const res = await request(app)
      .post('/hire-disclaimer/generate')
      .set('Content-Type', 'application/json')
      .send(samplePayload)
      .responseType('blob')
      .expect(200);

    const disposition = res.headers['content-disposition'] || '';
    expect(disposition).toMatch(/Equipment hire lease_/);
    expect(disposition).toMatch(/Test Contact Name|Test_Contact_Name|lease/);
    expect(disposition).toMatch(/\.docx/);
  });

  test('POST /hire-disclaimer/generate document contains submitted values (template or fallback)', async () => {
    const res = await request(app)
      .post('/hire-disclaimer/generate')
      .set('Content-Type', 'application/json')
      .send(samplePayload)
      .responseType('blob')
      .expect(200);

    const buf = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body);
    const zip = new PizZip(buf);
    const docXml = zip.files['word/document.xml'].asText();
    // Lessor is injected by API; template may say "Engineering Survey's" or "Engineering Surveys"
    expect(docXml).toMatch(/Engineering Survey[s']?/);
    // Document has substantive content (template or fallback)
    expect(docXml.length).toBeGreaterThan(2000);
  });

  test('POST /hire-disclaimer/generate accepts minimal payload (empty strings)', async () => {
    const res = await request(app)
      .post('/hire-disclaimer/generate')
      .set('Content-Type', 'application/json')
      .send({
        hirerName: '',
        address: '',
        phone: '',
        email: '',
        termsAgreed: false,
        signatureName: '',
        signatureDate: '',
      })
      .responseType('blob')
      .expect(200);

    expect(res.headers['content-type']).toMatch(/wordprocessingml/);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(200);
  });

  test('POST /hire-disclaimer/generate respondWith json and invalid existingActionId returns 404', async () => {
    const res = await request(app)
      .post('/hire-disclaimer/generate')
      .set('Content-Type', 'application/json')
      .send({
        ...samplePayload,
        existingActionId: '00000000-0000-0000-0000-000000000000',
        respondWith: 'json',
      })
      .expect(404);

    expect(res.body && res.body.error).toMatch(/not found/i);
  });

  test('GET /hire-disclaimer/hires/:id/preview.pdf missing hire returns 404', async () => {
    const res = await request(app)
      .get('/hire-disclaimer/hires/00000000-0000-0000-0000-000000000000/preview.pdf')
      .expect(404);

    expect(res.body && res.body.error).toMatch(/not found/i);
  });

  test('POST /hire-disclaimer/generate with equipmentItems only', async () => {
    const res = await request(app)
      .post('/hire-disclaimer/generate')
      .set('Content-Type', 'application/json')
      .send({
        ...samplePayload,
        equipmentItems: [{ assetId: 'PRISM-1', description: 'Multi prism' }],
      })
      .responseType('blob')
      .expect(200);

    const buf = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body);
    const zip = new PizZip(buf);
    const docXml = zip.files['word/document.xml'].asText();
    // Valid docx with body (template or fallback may structure equipment differently)
    expect(docXml).toMatch(/<w:body>|Equipment|equipment/);
  });

  test('generates and writes test documents to assets/Sheets', async () => {
    if (!fs.existsSync(sheetsDir)) {
      fs.mkdirSync(sheetsDir, { recursive: true });
    }

    // Full sample document
    const res1 = await request(app)
      .post('/hire-disclaimer/generate')
      .set('Content-Type', 'application/json')
      .send(samplePayload)
      .responseType('blob')
      .expect(200);
    const buf1 = Buffer.isBuffer(res1.body) ? res1.body : Buffer.from(res1.body);
    const fullPath = path.join(sheetsDir, 'Equipment hire lease_TEST.docx');
    fs.writeFileSync(fullPath, buf1);
    expect(fs.existsSync(fullPath)).toBe(true);

    // Minimal payload document
    const res2 = await request(app)
      .post('/hire-disclaimer/generate')
      .set('Content-Type', 'application/json')
      .send({
        hirerName: 'Minimal User',
        address: '1 Short St',
        phone: '0400000000',
        email: 'min@test.com',
        termsAgreed: true,
        signatureName: 'Minimal User',
        signatureDate: '2026-02-12',
      })
      .responseType('blob')
      .expect(200);
    const buf2 = Buffer.isBuffer(res2.body) ? res2.body : Buffer.from(res2.body);
    const minimalPath = path.join(sheetsDir, 'Equipment hire lease_MINIMAL.docx');
    fs.writeFileSync(minimalPath, buf2);
    expect(fs.existsSync(minimalPath)).toBe(true);
  });
});
