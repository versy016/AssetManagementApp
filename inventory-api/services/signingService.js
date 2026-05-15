/**
 * signingService.js
 *
 * Self-hosted hire agreement signing workflow.
 *
 * Responsibilities:
 *  1. createSigningSession()   — generates a signing token, stores unsigned PDF
 *                                on S3, saves all signing metadata into
 *                                asset_actions.data.
 *  2. getSessionByToken()      — validates a signing token and returns the hire
 *                                action record (or throws if invalid/expired).
 *  3. completeSession()        — stamps the signature image onto the PDF,
 *                                uploads the signed PDF to S3, updates
 *                                asset_actions.data to SIGNED.
 *  4. declineSession()         — marks the session as DECLINED.
 *  5. expireSession()          — marks the session as EXPIRED (called by cron
 *                                or on-access check after deadline passes).
 *
 * All signing session state lives in asset_actions.data. Organisation display names for audit PDFs
 * are resolved from the registered_domains table (see lib/domainRegistry.js).
 *
 * Signing data shape stored in asset_actions.data:
 * {
 *   ...existingHireFields,
 *   signatureStatus:   'PENDING_SIGNATURE' | 'SIGNED' | 'DECLINED' | 'EXPIRED',
 *   signingToken:      '<64-char hex>',
 *   signingTokenExpiry: '<ISO timestamp>',
 *   signingDelivery:   'email' | 'embedded',
 *   signingCreatedAt:  '<ISO timestamp>',
 *   unsignedFileUrl:   '<S3 URL>',
 *   unsignedDocPath:   '<S3 key>',
 *   signedAt:          '<ISO timestamp>',         // set on SIGNED
 *   signedFileUrl:     '<S3 URL>',                // set on SIGNED
 *   signedDocPath:     '<S3 key>',                // set on SIGNED
 *   signerIp:          '<IP address>',            // set on SIGNED
 *   signerUserAgent:   '<UA string>',             // set on SIGNED
 *   declinedAt:        '<ISO timestamp>',         // set on DECLINED
 *   declineReason:     '<string>',                // set on DECLINED (optional)
 *   expiredAt:         '<ISO timestamp>',         // set on EXPIRED
 *   signingOperatingEntityName: '<string>',      // set on SIGNED — display name from registered_domains
 * }
 */

const crypto  = require('crypto');
const AWS     = require('aws-sdk');
const prisma  = require('../lib/prisma');
const { resolveSigningOperatingEntityName } = require('../lib/domainRegistry');
const { stampSignature, appendAuditTrailToPdf } = require('./signedPdfService');
const { sendHireSigningEmail, sendSignedCopyEmail, sendAdminSignedNotification } = require('../lib/emailService');

// ── S3 client ─────────────────────────────────────────────────────────────────
function getS3() {
  const cfg = { region: process.env.AWS_REGION || 'ap-southeast-2' };
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    cfg.accessKeyId     = process.env.AWS_ACCESS_KEY_ID;
    cfg.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  }
  return new AWS.S3(cfg);
}

// ── Config ────────────────────────────────────────────────────────────────────

const TOKEN_TTL_HOURS = parseInt(process.env.SIGNING_TOKEN_TTL_HOURS || '72', 10);
const S3_BUCKET       = process.env.AWS_S3_BUCKET || process.env.S3_BUCKET || '';
const BASE_URL        = (process.env.API_BASE_URL || '').replace(/\/$/, '');

// ── Internal helpers ──────────────────────────────────────────────────────────

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function tokenExpiry() {
  const d = new Date();
  d.setHours(d.getHours() + TOKEN_TTL_HOURS);
  return d.toISOString();
}

/**
 * Upload a document buffer to S3 and return { url, key }.
 */
async function uploadDocument(buffer, s3Key, contentType) {
  if (!S3_BUCKET) throw new Error('AWS_S3_BUCKET / S3_BUCKET not configured');

  await getS3().putObject({
    Bucket:      S3_BUCKET,
    Key:         s3Key,
    Body:        buffer,
    ContentType: contentType,
  }).promise();

  // Build URL — respects custom S3_ENDPOINT (e.g. for local dev), otherwise standard AWS
  const endpoint = process.env.S3_ENDPOINT
    ? `${process.env.S3_ENDPOINT.replace(/\/$/, '')}/${S3_BUCKET}`
    : `https://${S3_BUCKET}.s3.${process.env.AWS_REGION || 'ap-southeast-2'}.amazonaws.com`;

  const url = `${endpoint}/${s3Key}`;
  return { url, key: s3Key };
}

async function uploadPdf(buffer, s3Key) {
  return uploadDocument(buffer, s3Key, 'application/pdf');
}

async function uploadDocx(buffer, s3Key) {
  return uploadDocument(
    buffer,
    s3Key,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
}

/**
 * Convert an asset_actions row + embedded JSON data into the signing-session
 * shape used by the signing page and route handlers.
 */
function toSession(action) {
  if (!action) return null;
  const d = action.data || {};
  return {
    actionId:        action.id,
    assetId:         action.asset_id,
    status:          d.signatureStatus || 'PENDING_SIGNATURE',
    token:           d.signingToken,
    tokenExpiry:     d.signingTokenExpiry,
    delivery:        d.signingDelivery,
    createdAt:       d.signingCreatedAt,
    unsignedFileUrl: d.unsignedFileUrl,
    unsignedDocPath: d.unsignedDocPath,
    signedFileUrl:   d.signedFileUrl    || null,
    signedDocPath:   d.signedDocPath    || null,
    signedAt:        d.signedAt         || null,
    declinedAt:      d.declinedAt       || null,
    expiredAt:       d.expiredAt        || null,
    hireData:        d,
    action,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a signing session for an existing hire action.
 *
 * Generates PDF → uploads to S3 → mints token → persists into action.data.
 *
 * @param {string} actionId      asset_actions.id
 * @param {'email'|'embedded'} delivery
 * @returns {Promise<{ session, signingUrl, token }>}
 */
async function createSigningSession(actionId, delivery = 'email', generatedDocument = null) {
  // Load the hire action
  const action = await prisma.asset_actions.findUnique({ where: { id: actionId } });
  if (!action) throw new Error(`Hire action ${actionId} not found`);

  const hireData = action.data || {};

  if (!generatedDocument || !Buffer.isBuffer(generatedDocument.pdfBuffer)) {
    throw new Error('Signing document PDF was not generated');
  }

  const pdfBuffer = generatedDocument.pdfBuffer;
  const docxBuffer = generatedDocument.docxBuffer;
  const sourceFilename = generatedDocument.filename || 'Equipment hire lease.docx';

  // Upload unsigned PDF to S3
  const ts     = Date.now();
  const s3Key  = `hire-agreements/unsigned/${actionId}_${ts}.pdf`;
  const { url: unsignedFileUrl, key: unsignedDocPath } = await uploadPdf(pdfBuffer, s3Key);

  let unsignedDocxFileUrl = null;
  let unsignedDocxPath = null;
  if (Buffer.isBuffer(docxBuffer)) {
    const docxKey = `hire-agreements/unsigned/${actionId}_${ts}.docx`;
    const uploadedDocx = await uploadDocx(docxBuffer, docxKey);
    unsignedDocxFileUrl = uploadedDocx.url;
    unsignedDocxPath = uploadedDocx.key;
  }

  // Mint signing token
  const token       = generateToken();
  const tokenExpiry_= tokenExpiry();

  // Persist into action.data.
  const updatedData = {
    ...hireData,
    signatureStatus:    'PENDING_SIGNATURE',
    signingToken:       token,
    signingTokenExpiry: tokenExpiry_,
    signingDelivery:    delivery,
    signingCreatedAt:   new Date().toISOString(),
    unsignedFileUrl,
    unsignedDocPath,
    unsignedDocxFileUrl,
    unsignedDocxPath,
    unsignedSourceFilename: sourceFilename,
  };

  await prisma.asset_actions.update({
    where: { id: actionId },
    data:  { data: updatedData },
  });

  const signingUrl = `${BASE_URL}/hire-disclaimer/signing/${token}`;

  const session = toSession({ ...action, data: updatedData });

  // If email delivery, send the signing email
  if (delivery === 'email') {
    const signerEmail = hireData.email || hireData.hirerEmail;
    const signerName  = hireData.hirerName || hireData.contactName || 'Hirer';
    if (signerEmail) {
      try {
        await sendHireSigningEmail({
          to:          signerEmail,
          name:        signerName,
          signingUrl,
          expiresAt:   tokenExpiry_,
          hireData,
        });
      } catch (emailErr) {
        // Log but don't fail the session creation — session already saved
        console.error('[signingService] Failed to send signing email:', emailErr.message);
      }
    }
  }

  return { session, signingUrl, token };
}

/**
 * Look up a signing session by token.
 * Automatically marks the session EXPIRED if the token TTL has passed.
 *
 * @param {string} token
 * @returns {Promise<object>} session object
 * @throws if token is invalid, not found, or already SIGNED/DECLINED
 */
async function getSessionByToken(token) {
  if (!token || token.length !== 64) throw new Error('Invalid signing token');

  // Query via JSON path — Prisma raw query for portability
  // Prisma doesn't support JSON path filtering in findFirst cleanly across all versions,
  // so we fetch recent signing actions and filter in JS (safe: token is 64-char hex, unguessable)
  const actions = await prisma.asset_actions.findMany({
    where: {
      type: 'HIRE',
    },
    orderBy: { occurred_at: 'desc' },
    take: 2000,  // reasonable upper bound; signed agreements expire so active set is small
  });

  const action = actions.find(
    (a) => a.data && a.data.signingToken === token
  );

  if (!action) throw new Error('Signing session not found');

  const d = action.data || {};
  const status = d.signatureStatus;

  // Already terminal
  if (status === 'SIGNED')    throw new Object({ code: 'ALREADY_SIGNED',    session: toSession(action) });
  if (status === 'DECLINED')  throw new Object({ code: 'ALREADY_DECLINED',  session: toSession(action) });

  // Check expiry
  if (d.signingTokenExpiry && new Date(d.signingTokenExpiry) < new Date()) {
    // Auto-expire if not already marked
    if (status !== 'EXPIRED') {
      await prisma.asset_actions.update({
        where: { id: action.id },
        data:  { data: { ...d, signatureStatus: 'EXPIRED', expiredAt: new Date().toISOString() } },
      });
    }
    throw new Object({ code: 'EXPIRED', session: toSession(action) });
  }

  return toSession(action);
}

/**
 * Complete a signing session — stamp signature, upload signed PDF, update status.
 *
 * @param {string} token            Signing token
 * @param {object} signingPayload
 *   @param {string} signingPayload.signatureDataUrl   PNG data URL
 *   @param {string} signingPayload.signerIp           Request IP
 *   @param {string} signingPayload.userAgent          Browser UA
 * @returns {Promise<{ session, signedFileUrl }>}
 */
async function completeSession(token, signingPayload) {
  const session = await getSessionByToken(token);
  const { action, hireData } = session;

  const {
    signatureDataUrl,
    signerIp = '—',
    userAgent = '',
    signedAt: suppliedSignedAt,
    signedDate,
    lesseeSigDate,
    signedDocument,
  } = signingPayload || {};

  if (!signatureDataUrl && !signedDocument?.pdfBuffer) throw new Error('Signature image is required');

  const signedAt = suppliedSignedAt || new Date().toISOString();
  const operatingEntityName = await resolveSigningOperatingEntityName(action);
  const signingInfo = {
    signatureDataUrl,
    signerName:   hireData.hirerName || hireData.contactName || '—',
    signerEmail:  hireData.email     || hireData.hirerEmail  || '—',
    signerIp,
    signedAt,
    userAgent,
    hireActionId: action.id,
    operatingEntityName,
  };

  let signedPdfBuffer;
  if (signedDocument && Buffer.isBuffer(signedDocument.pdfBuffer)) {
    signedPdfBuffer = await appendAuditTrailToPdf(signedDocument.pdfBuffer, signingInfo);
  } else {
    // Legacy fallback for sessions created before DOCX-template signing.
    let unsignedPdfBuffer;
    try {
      const s3Obj = await getS3().getObject({
        Bucket: S3_BUCKET,
        Key:    hireData.unsignedDocPath,
      }).promise();
      unsignedPdfBuffer = s3Obj.Body;
    } catch (err) {
      console.warn('[signingService] Could not fetch unsigned PDF from S3:', err.message);
      throw new Error('Unsigned signing PDF is no longer available');
    }

    signedPdfBuffer = await stampSignature(
      unsignedPdfBuffer,
      signingInfo,
      hireData.sigBox || null,
    );
  }

  // Upload signed PDF to S3
  const ts      = Date.now();
  const s3Key   = `hire-agreements/signed/${action.id}_${ts}_signed.pdf`;
  const { url: signedFileUrl, key: signedDocPath } = await uploadPdf(signedPdfBuffer, s3Key);

  let signedDocxFileUrl = null;
  let signedDocxPath = null;
  if (signedDocument && Buffer.isBuffer(signedDocument.docxBuffer)) {
    const docxKey = `hire-agreements/signed/${action.id}_${ts}_signed.docx`;
    const uploadedDocx = await uploadDocx(signedDocument.docxBuffer, docxKey);
    signedDocxFileUrl = uploadedDocx.url;
    signedDocxPath = uploadedDocx.key;
  }

  // Persist update
  const updatedData = {
    ...hireData,
    signatureStatus: 'SIGNED',
    signedAt,
    signedFileUrl,
    signedDocPath,
    signedDocxFileUrl,
    signedDocxPath,
    signedDate: signedDate || null,
    lesseeSigDate: lesseeSigDate || null,
    signerIp,
    signerUserAgent: userAgent,
    signingOperatingEntityName: operatingEntityName,
  };

  await prisma.asset_actions.update({
    where: { id: action.id },
    data:  { data: updatedData },
  });

  const completedSession = toSession({ ...action, data: updatedData });

  // Send copies by email (best-effort)
  const signerEmail = hireData.email || hireData.hirerEmail;
  const signerName  = hireData.hirerName || hireData.contactName || 'Hirer';
  try {
    if (signerEmail) {
      await sendSignedCopyEmail({
        to:         signerEmail,
        name:       signerName,
        pdfBuffer:  signedPdfBuffer,
        hireData,
      });
    }
  } catch (e) {
    console.error('[signingService] Failed to send signed copy to hirer:', e.message);
  }
  try {
    await sendAdminSignedNotification({
      hireData,
      actionId:     action.id,
      signerName,
      signerEmail:  signerEmail || '—',
      signedAt,
      signedFileUrl,
    });
  } catch (e) {
    console.error('[signingService] Failed to send admin notification:', e.message);
  }

  return { session: completedSession, signedFileUrl };
}

/**
 * Decline a signing session.
 *
 * @param {string} token
 * @param {string} [reason]   Optional decline reason
 */
async function declineSession(token, reason = '') {
  const session = await getSessionByToken(token);
  const { action, hireData } = session;

  const updatedData = {
    ...hireData,
    signatureStatus: 'DECLINED',
    declinedAt:      new Date().toISOString(),
    declineReason:   reason || '',
  };

  await prisma.asset_actions.update({
    where: { id: action.id },
    data:  { data: updatedData },
  });

  return toSession({ ...action, data: updatedData });
}

/**
 * Get the unsigned PDF buffer for a session (for serving to the signing page).
 *
 * @param {string} token
 * @returns {Promise<{ pdfBuffer, filename, session }>}
 */
async function getUnsignedPdf(token) {
  const session = await getSessionByToken(token);
  const { hireData } = session;

  let pdfBuffer;
  if (hireData.unsignedDocPath && S3_BUCKET) {
    try {
      const s3Obj = await getS3().getObject({
        Bucket: S3_BUCKET,
        Key:    hireData.unsignedDocPath,
      }).promise();
      pdfBuffer = s3Obj.Body;
    } catch {}
  }

  if (!pdfBuffer) throw new Error('Unsigned signing PDF is no longer available');

  const hirerName = (hireData.hirerName || hireData.contactName || 'hire').replace(/\s+/g, '_');
  const filename  = `hire_agreement_${hirerName}.pdf`;

  return { pdfBuffer, filename, session };
}

module.exports = {
  createSigningSession,
  getSessionByToken,
  completeSession,
  declineSession,
  getUnsignedPdf,
};
