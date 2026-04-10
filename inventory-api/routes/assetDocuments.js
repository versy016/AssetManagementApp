// routes/assetDocuments.js - Nested routes under /assets for attachments
const express = require('express');
const router = express.Router({ mergeParams: true });
const { PrismaClient } = require('../generated/prisma');
const prisma = new PrismaClient();
const multer = require('multer');
const AWS = require('aws-sdk');
const path = require('path');

const storage = multer.memoryStorage();
const uploadSingle = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    // allow common docs and images; you can tighten as needed
    const ok = /^(application\/(pdf|msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation))|image\/(png|jpe?g|webp))$/i.test(file.mimetype || '');
    if (ok) return cb(null, true);
    return cb(new Error('Unsupported file type'), false);
  },
}).single('file');

// AWS S3 client
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

function safeKey(original) {
  const base = path.basename(original || 'file');
  const clean = base.replace(/[^\w\-.]+/g, '_');
  return `assets/documents/${Date.now()}-${Math.random().toString(36).slice(2,8)}-${clean}`;
}

async function uploadBufferToS3(file) {
  const Key = safeKey(file.originalname);
  const params = {
    Bucket: process.env.S3_BUCKET,
    Key,
    Body: file.buffer,
    ContentType: file.mimetype || 'application/octet-stream',
  };
  if (String(process.env.S3_USE_ACL || '').toLowerCase() === 'true') {
    params.ACL = process.env.S3_ACL || 'private';
  }
  if (/^application\/pdf$/i.test(file.mimetype || '')) {
    params.ContentDisposition = 'inline';
  }
  const res = await s3.upload(params).promise();
  return { key: Key, url: res.Location };
}

// Sync document related_date to the asset's date field value so the date shows everywhere (certs list, asset detail, tasks).
async function syncDocumentDateToAssetField(assetId, asset_type_field_id, related_date, related_date_label) {
  if (!assetId || !related_date) return;
  const dateVal = related_date instanceof Date ? related_date : new Date(related_date);
  if (Number.isNaN(dateVal.getTime())) return;
  const ymd = dateVal.toISOString().slice(0, 10);

  const asset = await prisma.assets.findUnique({ where: { id: assetId }, select: { type_id: true } });
  if (!asset?.type_id) return;

  const dateFields = await prisma.asset_type_fields.findMany({
    where: {
      asset_type_id: asset.type_id,
      field_type: { slug: 'date' },
    },
    include: { field_type: true },
  });
  if (!dateFields.length) return;

  let targetField = null;
  const labelNorm = String(related_date_label || '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  if (labelNorm) {
    targetField = dateFields.find(
      (f) =>
        (f.name && String(f.name).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') === labelNorm) ||
        (f.slug && String(f.slug).toLowerCase() === labelNorm)
    );
  }
  if (!targetField) targetField = dateFields[0];

  await prisma.asset_field_values.upsert({
    where: {
      asset_id_asset_type_field_id: { asset_id: assetId, asset_type_field_id: targetField.id },
    },
    update: { value: ymd },
    create: { asset_id: assetId, asset_type_field_id: targetField.id, value: ymd },
  });
}

// List documents across assets (must be before /:assetId/documents so "/documents" is not captured as assetId)
router.get('/documents', async (req, res) => {
  try {
    const assetId = req.query.assetId ? String(req.query.assetId) : null;
    const kind = req.query.kind != null && String(req.query.kind).trim() !== '' ? String(req.query.kind).trim() : null;
    const where = {
      deleted_at: null,
      ...(assetId ? { asset_id: assetId } : {}),
      ...(kind ? { kind } : {}),
    };
    const docs = await prisma.asset_documents.findMany({ where, orderBy: { created_at: 'desc' } });
    res.json({ items: docs });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to list documents' });
  }
});

// List documents for an asset
router.get('/:assetId/documents', async (req, res) => {
  try {
    const assetId = String(req.params.assetId);
    const assetOk = await prisma.assets.findUnique({ where: { id: assetId }, select: { id: true } });
    if (!assetOk) return res.status(404).json({ error: 'Asset not found' });
    const docs = await prisma.asset_documents.findMany({
      where: { asset_id: assetId, deleted_at: null },
      orderBy: { created_at: 'desc' },
    });
    res.json({ items: docs });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to list documents' });
  }
});

// Upload a new document (multipart) and create record
router.post('/:assetId/documents/upload', (req, res) => {
  uploadSingle(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    try {
      if (!req.file) return res.status(400).json({ error: 'No file provided (field name: file)' });
      const assetId = String(req.params.assetId);

      // Fail fast with a clear message if S3 is not configured
      const hasS3 = !!(
        process.env.S3_BUCKET &&
        process.env.AWS_ACCESS_KEY_ID &&
        process.env.AWS_SECRET_ACCESS_KEY &&
        process.env.AWS_REGION
      );
      if (!hasS3) {
        return res.status(503).json({
          error: 'File storage (S3) is not configured. Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, and S3_BUCKET in the server environment.',
        });
      }

      // Ensure the asset exists (avoids foreign key error and gives a clearer response)
      const asset = await prisma.assets.findUnique({ where: { id: assetId }, select: { id: true } });
      if (!asset) {
        return res.status(404).json({ error: `Asset not found: ${assetId}` });
      }

      const { title, kind, related_date_label, related_date, asset_type_field_id } = req.body || {};
      let put;
      try {
        put = await uploadBufferToS3(req.file);
      } catch (s3Err) {
        console.error('[assetDocuments] S3 upload failed:', s3Err.message || s3Err);
        return res.status(502).json({
          error: 'File storage upload failed. Check server logs and S3 configuration (bucket, credentials, region).',
          detail: process.env.NODE_ENV === 'development' ? (s3Err.message || String(s3Err)) : undefined,
        });
      }

      const relatedDateParsed = related_date && String(related_date).trim() ? new Date(related_date) : null;
      const doc = await prisma.asset_documents.create({
        data: {
          asset_id: assetId,
          title: title || null,
          kind: kind || null,
          related_date_label: related_date_label || null,
          related_date: (relatedDateParsed && !Number.isNaN(relatedDateParsed.getTime())) ? relatedDateParsed : null,
          s3_key: put.key,
          url: put.url,
          content_type: req.file.mimetype || null,
          size_bytes: req.file.size || null,
          uploaded_by: (req.header('X-User-Id') || req.header('x-user-id') || null),
          asset_type_field_id: asset_type_field_id || null,
        },
      });
      if (doc.related_date && (asset_type_field_id || doc.asset_type_field_id)) {
        try {
          await syncDocumentDateToAssetField(assetId, asset_type_field_id || doc.asset_type_field_id, doc.related_date, related_date_label || doc.related_date_label);
        } catch (e) {
          // non-fatal: document is saved, only sync to asset field failed
        }
      }
      res.status(201).json({ document: doc });
    } catch (e) {
      console.error('[assetDocuments] Document upload error:', e.message || e);
      res.status(500).json({ error: e.message || 'Failed to save document' });
    }
  });
});

// Add a document record for an already uploaded URL (e.g., external or presigned workflow)
router.post('/:assetId/documents', async (req, res) => {
  try {
    const assetId = String(req.params.assetId);
    const { url, s3_key, title, kind, related_date_label, related_date, content_type, size_bytes, asset_type_field_id } = req.body || {};
    if (!url && !s3_key) return res.status(400).json({ error: 'url or s3_key required' });
    const assetOk = await prisma.assets.findUnique({ where: { id: assetId }, select: { id: true } });
    if (!assetOk) return res.status(404).json({ error: 'Asset not found' });
    const doc = await prisma.asset_documents.create({
      data: {
        asset_id: assetId,
        title: title || null,
        kind: kind || null,
        related_date_label: related_date_label || null,
        related_date: related_date ? new Date(related_date) : null,
        s3_key: s3_key || '',
        url: url || '',
        content_type: content_type || null,
        size_bytes: size_bytes ? Number(size_bytes) : null,
        uploaded_by: (req.header('X-User-Id') || req.header('x-user-id') || null),
        asset_type_field_id: asset_type_field_id || null,
      },
    });
    res.status(201).json({ document: doc });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to create document' });
  }
});

// Update document metadata
router.patch('/:assetId/documents/:docId', async (req, res) => {
  try {
    const { assetId, docId } = req.params;
    const { title, kind, related_date_label, related_date, metadata, asset_type_field_id } = req.body || {};
    const data = {
      title: title !== undefined ? title : undefined,
      kind: kind !== undefined ? kind : undefined,
      related_date_label: related_date_label !== undefined ? related_date_label : undefined,
      related_date: related_date !== undefined ? (related_date ? new Date(related_date) : null) : undefined,
      metadata: metadata !== undefined ? metadata : undefined,
    };
    if (asset_type_field_id !== undefined) data.asset_type_field_id = asset_type_field_id || null;
    const doc = await prisma.asset_documents.update({
      where: { id: String(docId) },
      data,
    });
    if (doc.related_date && (doc.asset_type_field_id || asset_type_field_id !== undefined)) {
      try {
        await syncDocumentDateToAssetField(
          String(assetId),
          doc.asset_type_field_id,
          doc.related_date,
          doc.related_date_label || related_date_label
        );
      } catch (e) {
        // non-fatal
      }
    }
    res.json({ document: doc });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to update document' });
  }
});

// Soft delete a document
router.delete('/:assetId/documents/:docId', async (req, res) => {
  try {
    const { assetId, docId } = req.params;
    const doc = await prisma.asset_documents.findUnique({
      where: { id: String(docId) },
      select: { id: true, asset_id: true, title: true, kind: true },
    });
    if (!doc || doc.asset_id !== assetId) {
      return res.status(404).json({ error: 'Document not found' });
    }
    const updated = await prisma.asset_documents.update({
      where: { id: String(docId) },
      data: { deleted_at: new Date() },
    });
    // Record activity so document/image deletion is visible in activity feed
    try {
      const userId = (req.headers['x-user-id'] || req.headers['X-User-Id'] || '').toString().trim() || null;
      let performedBy = null;
      if (userId) {
        const user = await prisma.users.findUnique({ where: { id: userId }, select: { id: true } });
        if (user) performedBy = user.id;
      }
      const documentLabel = doc.title || doc.kind || 'Document';
      await prisma.asset_actions.create({
        data: {
          asset_id: String(assetId),
          type: 'STATUS_CHANGE',
          note: `Document deleted: ${documentLabel}`,
          data: {
            event: 'DOCUMENT_DELETED',
            document_id: doc.id,
            document_title: doc.title || null,
            document_kind: doc.kind || null,
          },
          performed_by: performedBy,
        },
      });
    } catch (e) {
      console.error('[assetDocuments] Failed to record document-delete action:', e?.message || e);
      // Non-fatal: deletion succeeded, activity recording failed
    }
    res.json({ document: updated });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to delete document' });
  }
});

module.exports = router;

