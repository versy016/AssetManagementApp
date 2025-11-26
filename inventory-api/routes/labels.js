// routes/labels.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const AWS = require('aws-sdk');

const router = express.Router();

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function pickPythonBin() {
  return process.env.PYTHON_BIN || (process.platform === 'win32' ? 'py' : 'python3');
}

function resolveCheckinBase(req) {
  const explicit = (process.env.CHECKIN_WEB_BASE_URL || process.env.CHECKIN_BASE_URL || '').trim();
  const base = explicit || `${req.protocol}://${req.get('host')}`;
  const cleaned = base.replace(/\/+$/, '');
  return `${cleaned}/check-in`;
}

async function uploadToS3(buffer, key) {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET is not configured');
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  const s3 = new AWS.S3({ region });
  const res = await s3.upload({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: 'application/pdf',
    ACL: 'public-read',
    CacheControl: 'public, max-age=31536000, immutable',
  }).promise();
  return res.Location;
}

router.post('/l7651', async (req, res) => {
  try {
    const {
      ids = [],
      email = 'admin@engsurveys.com.au',
      phone = '+61 8 8340 4469',
      fontScale = 1.1,
      startIndex = 1,
      storage = undefined, // 's3' | 'local' | undefined (auto)
      fileName = undefined,
      showGrid = false,
    } = req.body || {};

    const scriptPath = path.join(__dirname, '..', 'scripts', 'generate_labels_L7651_v4.py');
    if (!fs.existsSync(scriptPath)) return res.status(500).json({ error: 'Label generator script not found' });

    const qrRoot = path.join(__dirname, '..', '..', 'utils', 'qrcodes');
    const sheetsDir = path.join(qrRoot, 'sheets');
    ensureDir(qrRoot); ensureDir(sheetsDir);

    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const baseName = (fileName && String(fileName).trim()) || `labels_l7651_${stamp}.pdf`;
    const outPath = path.join(sheetsDir, baseName);

    // Prepare ids file if provided
    let idsFile = null;
    if (Array.isArray(ids) && ids.length) {
      idsFile = path.join(sheetsDir, `ids-${stamp}.txt`);
      fs.writeFileSync(idsFile, ids.join('\n'), 'utf8');
    }

    const checkinBase = resolveCheckinBase(req);
    // Resolve logo path robustly relative to repo root (../.. from routes/)
    const logoCandidates = [
      path.join(__dirname, '..', '..', 'assets', 'ES_Logo.png'),
      path.join(__dirname, '..', '..', 'assets', 'ES_logo.png'),
      path.join(process.cwd(), 'assets', 'ES_Logo.png'),
      path.join(process.cwd(), 'assets', 'ES_logo.png'),
    ];
    const logoPath = logoCandidates.find((p) => fs.existsSync(p));

    const args = [
      scriptPath,
      ...(logoPath ? ['--logo', logoPath] : []),
      '--checkin-base', checkinBase,
      '--email', email,
      '--phone', phone,
      '--out', outPath,
      '--font-scale', String(fontScale),
      '--start-index', String(startIndex),
    ];
    if (idsFile) { args.push('--ids-file', idsFile); }
    if (showGrid) { args.push('--show-grid'); }

    const py = pickPythonBin();
    // If using Windows launcher 'py', prefer Python 3 explicitly
    const cmd = py;
    const cmdArgs = (py === 'py') ? ['-3', ...args] : args;
    await new Promise((resolve, reject) => {
      const cp = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = ''; let err = '';
      cp.stdout.on('data', (d) => { out += d.toString(); });
      cp.stderr.on('data', (d) => { err += d.toString(); });
      cp.on('error', (e) => {
        reject(new Error(`Failed to start '${cmd}': ${e.message}.\nSet PYTHON_BIN to your python.exe (e.g., C:\\Path\\to\\Python311\\python.exe) or ensure '${cmd}' is on PATH.`));
      });
      cp.on('close', (code) => {
        if (code === 0) return resolve();
        reject(new Error(`Generator failed (${code}) via '${cmd}': ${err || out}`));
      });
    });

    // Read the PDF
    const pdfBuf = fs.readFileSync(outPath);

    // Decide storage: prefer S3 if configured unless explicitly set to 'local'
    const wantS3 = storage === 's3';
    let s3Url = null;
    if (wantS3) {
      const key = `qrcodes/sheets/${baseName}`;
      s3Url = await uploadToS3(pdfBuf, key);
    }

    // Also expose local static URL when available
    const config = require('../config');
    const STATIC_MOUNT = (config && config.STATIC_MOUNT) || '/qrcodes';
    const apiBase = `${req.protocol}://${req.get('host')}`.replace(/\/+$/, '');
    const localUrl = `${apiBase}${STATIC_MOUNT}/sheets/${baseName}`;

    // Cleanup temp ids file
    if (idsFile && fs.existsSync(idsFile)) fs.unlink(idsFile, () => {});

    return res.json({
      status: 'ok',
      file: {
        name: baseName,
        bytes: pdfBuf.length,
        localUrl,
        ...(s3Url ? { s3Url } : {}),
      },
    });
  } catch (e) {
    console.error('[labels] error:', e);
    return res.status(500).json({ error: e.message || 'Failed to generate labels' });
  }
});

module.exports = router;

