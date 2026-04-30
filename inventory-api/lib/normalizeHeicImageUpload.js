const path = require('path');

function isHeicLikeMime(mt) {
  const base = String(mt || '').trim().split(';')[0].trim().toLowerCase();
  return /^image\/(heic|heif)$/i.test(base);
}

/** True when the buffer should be converted for web/RN display. */
function isHeicLikeFile(file) {
  if (!file) return false;
  if (isHeicLikeMime(file.mimetype)) return true;
  const ext = path.extname(file.originalname || '').toLowerCase();
  return ext === '.heic' || ext === '.heif';
}

/**
 * Multer file shape: { fieldname, originalname, encoding, mimetype, buffer, size }
 * HEIC/HEIF is converted to JPEG so thumbnails and Image components work everywhere.
 */
async function normalizeMulterImageForWeb(file) {
  if (!file || !file.buffer) return file;
  if (!isHeicLikeFile(file)) return file;

  let out;
  let sharpErr = null;
  try {
    const sharp = require('sharp');
    out = await sharp(file.buffer, { animated: false }).rotate().jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  } catch (e) {
    sharpErr = e;
    try {
      const convert = require('heic-convert');
      const raw = await convert({
        buffer: file.buffer,
        format: 'JPEG',
        quality: 0.88,
      });
      out = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    } catch (heicErr) {
      const msg = heicErr?.message || sharpErr?.message || 'conversion failed';
      throw new Error(`Could not convert HEIC image (${msg}). Try JPEG or PNG.`);
    }
  }

  if (!out || !out.length) {
    throw new Error('Could not convert HEIC image (empty output). Try JPEG or PNG.');
  }

  const stem = path.basename(String(file.originalname || 'image'), path.extname(file.originalname || '')) || 'image';
  const safeStem = stem.replace(/[^\w\-.]+/g, '_').slice(0, 120) || 'image';

  return {
    ...file,
    buffer: out,
    size: out.length,
    mimetype: 'image/jpeg',
    originalname: `${safeStem}.jpg`,
  };
}

module.exports = { normalizeMulterImageForWeb, isHeicLikeFile };
