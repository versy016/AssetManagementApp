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

// List documents for an asset
router.get('/:assetId/documents', async (req, res) => {
  try {
    const assetId = String(req.params.assetId);
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
      const { title, kind, related_date_label, related_date, asset_type_field_id } = req.body || {};
      const put = await uploadBufferToS3(req.file);

      const doc = await prisma.asset_documents.create({
        data: {
          asset_id: assetId,
          title: title || null,
          kind: kind || null,
          related_date_label: related_date_label || null,
          related_date: related_date ? new Date(related_date) : null,
          s3_key: put.key,
          url: put.url,
          content_type: req.file.mimetype || null,
          size_bytes: req.file.size || null,
          uploaded_by: (req.header('X-User-Id') || req.header('x-user-id') || null),
          asset_type_field_id: asset_type_field_id || null,
        },
      });
      res.status(201).json({ document: doc });
    } catch (e) {
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
    const { title, kind, related_date_label, related_date, metadata } = req.body || {};
    const doc = await prisma.asset_documents.update({
      where: { id: String(docId) },
      data: {
        title: title !== undefined ? title : undefined,
        kind: kind !== undefined ? kind : undefined,
        related_date_label: related_date_label !== undefined ? related_date_label : undefined,
        related_date: related_date !== undefined ? (related_date ? new Date(related_date) : null) : undefined,
        metadata: metadata !== undefined ? metadata : undefined,
      },
    });
    res.json({ document: doc });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to update document' });
  }
});

// Soft delete a document
router.delete('/:assetId/documents/:docId', async (req, res) => {
  try {
    const { docId } = req.params;
    const doc = await prisma.asset_documents.update({
      where: { id: String(docId) },
      data: { deleted_at: new Date() },
    });
    res.json({ document: doc });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to delete document' });
  }
});

// Optional: list documents across assets (admin/reporting)
router.get('/documents', async (req, res) => {
  try {
    const assetId = req.query.assetId ? String(req.query.assetId) : null;
    const where = { deleted_at: null, ...(assetId ? { asset_id: assetId } : {}) };
    const docs = await prisma.asset_documents.findMany({ where, orderBy: { created_at: 'desc' } });
    res.json({ items: docs });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to list documents' });
  }
});

module.exports = router;

