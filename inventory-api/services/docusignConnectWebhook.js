/**
 * DocuSign Connect webhook -- marks hire as signed and downloads the signed PDF.
 * Mount with express.raw({ type: 'application/json' }) so HMAC verification works.
 */
const path = require('path');
const fs = require('fs');
const prisma = require('../lib/prisma');
const logger = require('../lib/logger');
const { verifyConnectHmac, downloadSignedDocument } = require('./docusignService');

const SIGNATURE_SIGNED = 'signed';

const SIGNED_DOCS_DIR = path.join(__dirname, '..', 'signed_docs');
if (!fs.existsSync(SIGNED_DOCS_DIR)) {
  try { fs.mkdirSync(SIGNED_DOCS_DIR, { recursive: true }); } catch { /* ignore */ }
}

function signedDocFilePath(actionId) {
  return path.join(SIGNED_DOCS_DIR, `hire_${actionId}_signed.pdf`);
}

function readHireIdFromCustomFields(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const text = obj.customFields && obj.customFields.textCustomFields;
  if (!Array.isArray(text)) return null;
  const row = text.find((f) => f && f.name === 'hireActionId');
  return row && row.value ? String(row.value).trim() : null;
}

function extractHireActionId(payload) {
  if (!payload || typeof payload !== 'object') return null;
  let id = readHireIdFromCustomFields(payload);
  if (id) return id;
  const d = payload.data;
  if (d && typeof d === 'object') {
    id = readHireIdFromCustomFields(d);
    if (id) return id;
    if (d.envelopeSummary) {
      id = readHireIdFromCustomFields(d.envelopeSummary);
      if (id) return id;
    }
  }
  return null;
}

function isCompletedEvent(payload) {
  const ev = String((payload && (payload.event || payload.Event)) || '').toLowerCase();
  if (ev.includes('envelope-completed') || ev.includes('recipient-completed')) return true;
  const summary = payload && payload.data && payload.data.envelopeSummary;
  const st = summary && summary.status && String(summary.status).toLowerCase();
  return st === 'completed';
}

async function handleDocusignConnectWebhook(req, res) {
  const sig =
    req.get('X-DocuSign-Signature-1') ||
    req.get('x-docusign-signature-1') ||
    '';

  const raw = req.body;
  const rawBuf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw || ''), 'utf8');

  if (!verifyConnectHmac(rawBuf, sig)) {
    console.warn('[docusign webhook] HMAC verification failed');
    return res.status(401).send('Unauthorized');
  }

  let payload;
  try {
    payload = JSON.parse(rawBuf.toString('utf8'));
  } catch {
    return res.status(400).send('Invalid JSON');
  }

  if (!isCompletedEvent(payload)) {
    return res.status(200).send('ok');
  }

  const hireActionId = extractHireActionId(payload);
  if (!hireActionId) {
    console.warn('[docusign webhook] envelope-completed but no hireActionId custom field');
    return res.status(200).send('ok');
  }

  try {
    const ex = await prisma.asset_actions.findFirst({
      where: { id: hireActionId, type: 'HIRE' },
    });
    if (!ex) {
      console.warn('[docusign webhook] hire not found', hireActionId);
      return res.status(200).send('ok');
    }
    const prevData = ex.data && typeof ex.data === 'object' ? ex.data : {};
    const signedAt = new Date().toISOString();
    const merged = {
      ...prevData,
      signatureStatus: SIGNATURE_SIGNED,
      signedAt,
      docusignCompletedAt: signedAt,
    };

    // Try to download signed PDF from DocuSign and cache it locally
    const envelopeId = prevData.docusignEnvelopeId;
    if (envelopeId) {
      try {
        const pdfBuf = await downloadSignedDocument(envelopeId);
        const filePath = signedDocFilePath(hireActionId);
        fs.writeFileSync(filePath, pdfBuf);
        merged.signedDocPath = filePath;
        logger.log('[docusign webhook] signed PDF saved', filePath);
      } catch (dlErr) {
        console.warn('[docusign webhook] could not download signed PDF:', dlErr?.message || dlErr);
      }
    }

    await prisma.asset_actions.update({
      where: { id: hireActionId },
      data: { data: merged },
    });
    logger.log('[docusign webhook] hire marked signed', hireActionId);
  } catch (e) {
    console.error('[docusign webhook] db error:', e?.message || e);
    return res.status(500).send('error');
  }

  return res.status(200).send('ok');
}

module.exports = { handleDocusignConnectWebhook };
