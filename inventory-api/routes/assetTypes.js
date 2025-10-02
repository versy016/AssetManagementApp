// inventory-api/routes/assetTypes.js
const express = require('express');
const router = express.Router();

const AWS = require('aws-sdk');
const multer = require('multer');

const ctrl = require('../controllers/assetTypes.controller');

// ---------- S3 + Multer ----------
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const storage = multer.memoryStorage();
const upload = multer({ storage });

// helper
function uploadToS3(file, folder) {
  const key = `${folder}/${Date.now()}-${file.originalname}`;
  return s3.upload({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
    ACL: 'public-read',
  }).promise();
}

// ---------- Routes ----------

// List, Get, Update, Delete (existing behavior)
router.get('/', ctrl.list);
router.get('/:id', ctrl.get);
const { authRequired, adminOnly } = require('../middleware/auth');
// Update (supports JSON or multipart with `image`)
router.put('/:id', authRequired, adminOnly, (req, res, next) => {
  const ct = String(req.headers['content-type'] || '');
  if (ct.includes('multipart/form-data')) {
    upload.single('image')(req, res, async (err) => {
      if (err) return next(err);
      try {
        // If a file was uploaded, push to S3 and then update with URL
        let image_url;
        if (req.file) {
          try {
            const result = await uploadToS3(req.file, 'asset-type-images');
            image_url = result?.Location;
          } catch (e) {
            console.error('[asset-types] S3 upload failed:', e?.message || e);
            return res.status(500).json({ status: 'error', message: 'Image upload failed', error: e?.message || String(e) });
          }
        }

        const { name } = req.body || {};
        const patch = {};
        if (name !== undefined) patch.name = String(name).trim();
        if (image_url !== undefined) patch.image_url = image_url || null;

        const { PrismaClient } = require('../generated/prisma');
        const prisma = new PrismaClient();
        if (!Object.keys(patch).length) {
          return res.status(400).json({ status: 'error', message: 'No fields to update' });
        }
        const row = await prisma.asset_types.update({ where: { id: req.params.id }, data: patch });
        return res.json({ status: 'success', data: row });
      } catch (e) { return next(e); }
    });
  } else {
    return ctrl.update(req, res, next);
  }
});
router.delete('/:id', authRequired, adminOnly, ctrl.remove);

// Create (supports BOTH JSON and multipart)
// - JSON: {name, image_url?} handled by ctrl.create
// - multipart/form-data with `image` handled by ctrl.createWithImage
router.post('/', authRequired, adminOnly, (req, res, next) => {
  const ct = req.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) {
    // Run multer, then upload to S3, then hand off to controller
    upload.single('image')(req, res, async (err) => {
      if (err) return next(err);
      if (!req.file) {
        // no file in multipart: just fall back to JSON create
        return ctrl.create(req, res, next);
      }
      try {
        const result = await uploadToS3(req.file, 'asset-type-images');
        req.uploadResult = result; // pass URL to controller
        return ctrl.createWithImage(req, res, next);
      } catch (e) { return next(e); }
    });
  } else {
    return ctrl.create(req, res, next);
  }
});

// Summary moved from routes/assets.js
router.get('/summary/list', ctrl.summary);

// (Optional) Back-compat legacy alias: GET /asset_types  -> same as list
// NOTE: Prefer /asset-types
router.get('/legacy/all', ctrl.list); // you can remove after FE migration

module.exports = router;
