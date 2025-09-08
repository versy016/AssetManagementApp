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
  }).promise();
}

// ---------- Routes ----------

// List, Get, Update, Delete (existing behavior)
router.get('/', ctrl.list);
router.get('/:id', ctrl.get);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

// Create (supports BOTH JSON and multipart)
// - JSON: {name, image_url?} handled by ctrl.create
// - multipart/form-data with `image` handled by ctrl.createWithImage
router.post('/', (req, res, next) => {
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
