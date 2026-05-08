/**
 * BoldSign webhook handler — marks hire as signed, downloads the signed PDF,
 * uploads it to S3, and stores the URL in asset_actions.data.
 *
 * Mount with express.raw({ type: () => true }) so HMAC verification works.
 *
 * BoldSign sends POST with body:
 *   {
 *     "event": { "type": "documentCompleted" },
 *     "document": {
 *       "documentId": "...",
 *       "documentStatus": "Completed",
 *       "labels": ["hireActionId:abc123"]
 *     }
 *   }
 */

const path = require('path');
const fs = require('fs');
const AWS = require('aws-sdk');
const prisma = require('../lib/prisma');
const logger = require('../lib/logger');
const { verifyWebhookSignature, downloadSignedDocument } = require('./boldsignService');

const SIGNATURE_SIGNED = 'signed';

// ── Local fallback directory ─────────────────────────────────────────────────
const SIGNED_DOCS_DIR = path.join(__dirname, '..', 'signed_docs');
if (!fs.existsSync(SIGNED_DOCS_DIR)) {
  try { fs.mkdirSync(SIGNED_DOCS_DIR, { recursive: true }); } catch { /* ignore */ }
}

function signedDocFilePath(actionId) {
  return path.join(SIGNED_DOCS_DIR, `hire_${actionId}_signed.pdf`);
}

// ── S3 client (lazy-initialised) ─────────────────────────────────────────────
function getS3() {
  const cfg = { region: process.env.AWS_REGION || 'ap-southeast-2' };
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    cfg.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    cfg.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  }
  return new AWS.S3(cfg);
}

async function uploadToS3(pdfBuffer, actionId) {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) return null;

  const key = `signed-leases/hire_${actionId}_signed_${Date.now()}.pdf`;
  const params = {
    Bucket: bucket,
    Key: key,
    Body: pdfBuffer,
    ContentType: 'application/pdf',
  };
  const useAcl = String(process.env.S3_USE_ACL || '').toLowerCase() === 'true';
  if (useAcl) params.ACL = process.env.S3_ACL || 'private';

  const s3 = getS3();
  const result = await s3.upload(params).promise();
  return result.Location;
}

// ── Payload parsing ──────────────────────────────────────────────────────────

/**
 * BoldSign puts event type in event.type (e.g. "documentCompleted").
 * Older / alternate shapes may differ; handle gracefully.
 */
function isCompletedEvent(payload) {
  if (!payload || typeof payload !== 'object') return false;

  // Primary: { event: { type: "documentCompleted" } }
  const evType = String(
    (payload.event && payload.event.type) ||
    payload.eventType ||
    payload.type ||
    ''
  ).toLowerCase();

  if (evType.includes('documentcompleted') || evType.includes('document.completed')) {
    return true;
  }

  // Fallback: check document status directly
  const docStatus = String(
    (payload.document && payload.document.documentStatus) ||
    payload.documentStatus ||
    ''
  ).toLowerCase();

  return docStatus === 'completed';
}

/**
 * Extract documentId from the webhook payload.
 */
function extractDocumentId(payload) {
  return (
    (payload.document && payload.document.documentId) ||
    payload.documentId ||
    null
  );
}

/**
 * Extract hireActionId from Labels array.
 * Labels are stored as ["hireActionId:abc123"].
 */
function extractHireActionId(payload) {
  const labels =
    (payload.document && Array.isArray(payload.document.labels) && payload.document.labels) ||
    (Array.isArray(payload.labels) && payload.labels) ||
    [];

  for (const label of labels) {
    const s = String(label || '').trim();
    if (s.startsWith('hireActionId:')) {
      const id = s.slice('hireActionId:'.length).trim();
      if (id) return id;
    }
  }
  return null;
}

// ── Main handler ─────────────────────────────────────────────────────────────

async function handleBoldsignWebhook(req, res) {
  // ── Signature verification ─────────────────────────────────────────────
  const sig =
    req.get('X-BoldSign-Signature') ||
    req.get('x-boldsign-signature') ||
    '';

  const raw = req.body;
  const rawBuf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw || ''), 'utf8');

  if (!verifyWebhookSignature(rawBuf, sig)) {
    logger.warn('[boldsign webhook] HMAC verification failed');
    return res.status(401).send('Unauthorized');
  }

  // ── Parse payload ──────────────────────────────────────────────────────
  // BoldSign sends an empty-body POST to verify the webhook URL on registration.
  // Return 200 immediately so the dashboard validation passes.
  const bodyStr = rawBuf.toString('utf8').trim();
  if (!bodyStr) return res.status(200).send('ok');

  let payload;
  try {
    payload = JSON.parse(bodyStr);
  } catch {
    return res.status(400).send('Invalid JSON');
  }

  // Acknowledge non-completed events immediately
  if (!isCompletedEvent(payload)) {
    return res.status(200).send('ok');
  }

  const documentId = extractDocumentId(payload);
  const hireActionId = extractHireActionId(payload);

  if (!hireActionId) {
    logger.warn('[boldsign webhook] documentCompleted but no hireActionId label found');
    return res.status(200).send('ok');
  }

  // ── Update DB ──────────────────────────────────────────────────────────
  try {
    const ex = await prisma.asset_actions.findFirst({
      where: { id: hireActionId, type: 'HIRE' },
    });
    if (!ex) {
      logger.warn('[boldsign webhook] hire not found:', hireActionId);
      return res.status(200).send('ok');
    }

    const prevData = ex.data && typeof ex.data === 'object' ? ex.data : {};
    const signedAt = new Date().toISOString();
    const merged = {
      ...prevData,
      signatureStatus: SIGNATURE_SIGNED,
      signedAt,
      signingCompletedAt: signedAt,
    };

    // ── Download signed PDF from BoldSign ──────────────────────────────
    const docId = documentId || prevData.boldsignDocumentId;
    if (docId) {
      try {
        const pdfBuf = await downloadSignedDocument(docId);

        // Save local fallback copy
        const localPath = signedDocFilePath(hireActionId);
        try {
          fs.writeFileSync(localPath, pdfBuf);
          merged.signedDocPath = localPath;
        } catch (writeErr) {
          logger.warn('[boldsign webhook] could not write local PDF:', writeErr?.message);
        }

        // Upload to S3
        try {
          const s3Url = await uploadToS3(pdfBuf, hireActionId);
          if (s3Url) {
            merged.signedFileUrl = s3Url;
            logger.log('[boldsign webhook] signed PDF uploaded to S3:', s3Url);
          }
        } catch (s3Err) {
          logger.warn('[boldsign webhook] S3 upload failed:', s3Err?.message);
        }
      } catch (dlErr) {
        logger.warn('[boldsign webhook] could not download signed PDF:', dlErr?.message || dlErr);
      }
    }

    await prisma.asset_actions.update({
      where: { id: hireActionId },
      data: { data: merged },
    });

    logger.log('[boldsign webhook] hire marked signed:', hireActionId);
  } catch (e) {
    logger.error('[boldsign webhook] db error:', e?.message || e);
    return res.status(500).send('error');
  }

  return res.status(200).send('ok');
}

module.exports = { handleBoldsignWebhook };
