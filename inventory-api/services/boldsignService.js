/**
 * BoldSign e-signature service — upload our own hire lease .docx and place a
 * Signature field using one of two strategies:
 *
 *   A) TEXT TAG (recommended when you can edit the Word template)
 *      Add the text  {{{{Signature:sign_lease_1}}}}  in your Word document at the
 *      exact spot where the signature box should appear (e.g. on the signature line).
 *      BoldSign detects that text and replaces it with the interactive widget.
 *      Enable with:  BOLDSIGN_USE_TEXT_TAGS=true
 *
 *   B) FIXED COORDINATES (default — no template change required)
 *      A Signature field is placed at the page + x/y position you configure.
 *      Tune with BOLDSIGN_SIGN_PAGE / _X / _Y / _WIDTH / _HEIGHT env vars.
 *
 * Uses the official `boldsign` Node.js SDK (v3+).
 *
 * Required env vars:
 *   BOLDSIGN_API_KEY          API key from BoldSign dashboard → Settings → API Keys
 *
 * Optional env vars:
 *   BOLDSIGN_BASE_URL         Override API base URL for non-US regions
 *                             Australia: https://api-au.boldsign.com
 *                             EU:        https://api-eu.boldsign.com
 *                             US default: https://api.boldsign.com
 *   BOLDSIGN_EMAIL_SUBJECT    Email subject line sent to signer
 *   BOLDSIGN_EMAIL_MESSAGE    Email body message sent to signer
 *   BOLDSIGN_WEBHOOK_SECRET   HMAC-SHA256 secret for webhook verification (skip in dev)
 *   HIRE_ADMIN_CC_EMAIL       Admin CC email (default: admin@engsurveys.com.au). "" = disabled.
 *   HIRE_ADMIN_CC_NAME        Admin CC display name
 *
 * Strategy A env vars:
 *   BOLDSIGN_USE_TEXT_TAGS    Set to "true" to use text-tag strategy.
 *                             Requires {{{{Signature:sign_lease_1}}}} in the Word template.
 *
 * Strategy B env vars (all optional — defaults place near bottom of page 1):
 *   BOLDSIGN_SIGN_PAGE        Page number (1-based) where signature goes. Default: 1
 *   BOLDSIGN_SIGN_X           X coordinate in PDF points. Default: 50
 *   BOLDSIGN_SIGN_Y           Y coordinate in PDF points. Default: 650
 *   BOLDSIGN_SIGN_WIDTH       Field width in PDF points. Default: 220
 *   BOLDSIGN_SIGN_HEIGHT      Field height in PDF points. Default: 55
 */

const {
  DocumentApi,
  DocumentSigner,
  SendForSign,
  FormField,
  Rectangle,
  TextTagDefinition,
  DocumentCC,
} = require('boldsign');
const crypto = require('crypto');

// ── Config helpers ────────────────────────────────────────────────────────────

function isConfigured() {
  return !!process.env.BOLDSIGN_API_KEY;
}

function getApiKey() {
  const key = process.env.BOLDSIGN_API_KEY;
  if (!key) throw new Error('BOLDSIGN_API_KEY is not configured on the server');
  return key.trim();
}

function getBaseUrl() {
  return (process.env.BOLDSIGN_BASE_URL || 'https://api.boldsign.com').replace(/\/$/, '');
}

function getAdminCcEmail() {
  const env = process.env.HIRE_ADMIN_CC_EMAIL;
  if (env === '') return null;
  return (env && String(env).trim()) || 'admin@engsurveys.com.au';
}

function makeDocumentApi() {
  const api = new DocumentApi(getBaseUrl());
  api.setApiKey(getApiKey());
  return api;
}

/** Parse an integer env var, returning fallback if unset or invalid. */
function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Upload a hire lease document to BoldSign and send for signing.
 * A Signature field is placed at the coordinates configured via env vars
 * (defaulting to near the bottom of page 1).
 *
 * @param {object} opts
 * @param {Buffer}  opts.documentBuffer      .docx (or .pdf) bytes
 * @param {string}  opts.documentFileName    filename with extension
 * @param {string}  opts.signerEmail         lessee email
 * @param {string}  opts.signerName          lessee display name
 * @param {string}  opts.hireActionId        stored in Labels for webhook correlation
 * @param {'email'|'embedded'} opts.deliveryMethod
 * @param {string}  [opts.returnUrl]         required for embedded; redirect URL after signing
 *
 * @returns {Promise<{ documentId: string, signingUrl: string|null }>}
 */
async function createHireDocument(opts) {
  const {
    documentBuffer,
    documentFileName,
    signerEmail,
    signerName,
    hireActionId,
    deliveryMethod,
    returnUrl,
  } = opts;

  if (!signerEmail || !String(signerEmail).includes('@')) {
    throw new Error('Valid signerEmail is required');
  }
  if (!documentBuffer || !Buffer.isBuffer(documentBuffer)) {
    throw new Error('documentBuffer is required');
  }

  const isEmbedded = deliveryMethod === 'embedded';
  if (isEmbedded && !returnUrl) {
    throw new Error('embedded signing requires returnUrl');
  }

  // ── File attachment ─────────────────────────────────────────────────────────
  const fileName = documentFileName || 'Equipment hire lease.docx';
  const ext = (fileName.match(/\.([^.]+)$/i) || [])[1]?.toLowerCase() || 'docx';
  const contentType =
    ext === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  // The SDK's toFormData/isBufferDetailedFile expects this exact shape.
  const file = {
    value: documentBuffer,
    options: { filename: fileName, contentType },
  };

  const useTextTags = String(process.env.BOLDSIGN_USE_TEXT_TAGS || '').toLowerCase() === 'true';

  // ── Signer ──────────────────────────────────────────────────────────────────
  const signer = new DocumentSigner();
  signer.name         = String(signerName || signerEmail).trim();
  signer.emailAddress = String(signerEmail).trim();
  signer.signerOrder  = 1;
  signer.signerType   = DocumentSigner.SignerTypeEnum.Signer;

  // ── Signature & date field placement ────────────────────────────────────────
  //
  // TWO STRATEGIES — mutually exclusive:
  //
  // A) TEXT TAGS  (BOLDSIGN_USE_TEXT_TAGS=true)
  //    BoldSign scans the uploaded document for  {{{{Signature:sign_lease_1}}}}
  //    and  {{{{DateSigned:sign_date_1}}}}  and places interactive fields exactly
  //    where those tags appear in the template.  No coordinate env vars are used.
  //    ⚠  Do NOT also set signer.formFields in this mode — BoldSign will use the
  //       coordinate fields instead of the tags and the tags will render as plain text.
  //
  // B) FIXED COORDINATES (default — BOLDSIGN_USE_TEXT_TAGS unset or false)
  //    BoldSign places the signature box at the page + x/y position you configure.
  //    Units are PDF points (72 pt = 1 inch).  For a typical A4 page (595 × 842 pt):
  //      top-left is (0, 0); x goes right, y goes DOWN from the top.
  //    Tune placement with env vars (all optional):
  //      BOLDSIGN_SIGN_PAGE / _X / _Y / _WIDTH / _HEIGHT  — signature field
  //      BOLDSIGN_DATE_X   / _Y / _WIDTH / _HEIGHT        — date field (same page)

  if (!useTextTags) {
    const signPage = envInt('BOLDSIGN_SIGN_PAGE', 1);
    const signX    = envInt('BOLDSIGN_SIGN_X', 50);
    const signY    = envInt('BOLDSIGN_SIGN_Y', 650);
    const signW    = envInt('BOLDSIGN_SIGN_WIDTH', 220);
    const signH    = envInt('BOLDSIGN_SIGN_HEIGHT', 55);

    const sigBounds = new Rectangle();
    sigBounds.x      = signX;
    sigBounds.y      = signY;
    sigBounds.width  = signW;
    sigBounds.height = signH;

    const signatureField = new FormField();
    signatureField.fieldType  = FormField.FieldTypeEnum.Signature;
    signatureField.pageNumber = signPage;
    signatureField.bounds     = sigBounds;
    signatureField.isRequired = true;

    // Date field — defaults to the right of the signature on the same row
    const dateX = envInt('BOLDSIGN_DATE_X', signX + signW + 20);
    const dateY = envInt('BOLDSIGN_DATE_Y', signY);
    const dateW = envInt('BOLDSIGN_DATE_WIDTH', 150);
    const dateH = envInt('BOLDSIGN_DATE_HEIGHT', signH);

    const dateBounds = new Rectangle();
    dateBounds.x      = dateX;
    dateBounds.y      = dateY;
    dateBounds.width  = dateW;
    dateBounds.height = dateH;

    const dateField = new FormField();
    dateField.fieldType  = FormField.FieldTypeEnum.DateSigned;
    dateField.pageNumber = signPage;
    dateField.bounds     = dateBounds;
    dateField.isRequired = true;

    signer.formFields = [signatureField, dateField];
  }
  // Text-tag mode: formFields left empty — BoldSign locates the fields from tags in the document.

  // ── Send request ────────────────────────────────────────────────────────────
  const sendRequest = new SendForSign();
  sendRequest.files   = [file];
  sendRequest.title   =
    process.env.BOLDSIGN_EMAIL_SUBJECT || 'Please sign: Equipment hire lease';
  sendRequest.message =
    process.env.BOLDSIGN_EMAIL_MESSAGE ||
    'Please review the attached Equipment Hire Lease document. ' +
      'Read the disclaimer and liability terms carefully, then click "Sign" to add your signature. ' +
      'Once signed, you will receive a completed copy automatically.';
  sendRequest.signers = [signer];
  sendRequest.labels  = [`hireActionId:${hireActionId}`];

  if (useTextTags) {
    // Tell BoldSign to scan the document for text tags and create fields there.
    // The document must contain:
    //   {{{{Signature:sign_lease_1}}}}   ← signature box
    //   {{{{DateSigned:sign_date_1}}}}   ← auto-filled date when signer completes
    const sigTag = new TextTagDefinition();
    sigTag.definitionId = 'sign_lease_1';
    sigTag.type         = TextTagDefinition.TypeEnum.Signature;
    sigTag.signerIndex  = 1;
    sigTag.isRequired   = true;

    const dateTag = new TextTagDefinition();
    dateTag.definitionId = 'sign_date_1';
    dateTag.type         = TextTagDefinition.TypeEnum.DateSigned;
    dateTag.signerIndex  = 1;
    dateTag.isRequired   = true;

    sendRequest.useTextTags        = true;
    sendRequest.textTagDefinitions = [sigTag, dateTag];
  }

  // For embedded signing, suppress the outbound email
  if (isEmbedded) {
    sendRequest.disableEmails = true;
  }

  // ── Admin CC ─────────────────────────────────────────────────────────────────
  const adminCcEmail = getAdminCcEmail();
  if (adminCcEmail && !isEmbedded) {
    const cc = new DocumentCC();
    cc.emailAddress = adminCcEmail;
    sendRequest.cc = [cc];
  }

  // ── Diagnostic logging ───────────────────────────────────────────────────────
  const placementInfo = useTextTags
    ? {
        strategy: 'text-tag',
        signatureTag: '{{{{Signature:sign_lease_1}}}}',
        dateTag: '{{{{DateSigned:sign_date_1}}}}',
        note: 'formFields NOT set — BoldSign will locate fields from tags inside the document',
      }
    : {
        strategy: 'coordinates',
        page: envInt('BOLDSIGN_SIGN_PAGE', 1),
        x: envInt('BOLDSIGN_SIGN_X', 50),
        y: envInt('BOLDSIGN_SIGN_Y', 650),
        w: envInt('BOLDSIGN_SIGN_WIDTH', 220),
        h: envInt('BOLDSIGN_SIGN_HEIGHT', 55),
      };

  console.log('[boldsign] Sending document to BoldSign:', {
    baseUrl: getBaseUrl(),
    fileName,
    fileSize: documentBuffer.length,
    signerEmail: String(signerEmail).trim(),
    signerName:  String(signerName || signerEmail).trim(),
    hireActionId,
    deliveryMethod: isEmbedded ? 'embedded' : 'email',
    signaturePlacement: placementInfo,
    emailSubject: sendRequest.title,
    adminCc: adminCcEmail || '(none)',
  });

  // ── Send ─────────────────────────────────────────────────────────────────────
  const documentApi = makeDocumentApi();
  let result;
  try {
    result = await documentApi.sendDocument(sendRequest);
  } catch (err) {
    // SDK wraps most errors as HttpError (err.body = deserialized response body).
    // Raw axios errors have the body at err.response.data.
    const body = err?.body ?? err?.response?.data ?? err?.message;
    const detail = typeof body === 'object' ? JSON.stringify(body) : String(body ?? err);
    console.error('[boldsign] sendDocument failed:', detail);
    throw new Error(`BoldSign document send failed: ${detail}`);
  }

  console.log('[boldsign] BoldSign sendDocument response:', JSON.stringify(result));

  const documentId = result && result.documentId;
  if (!documentId) {
    throw new Error('BoldSign did not return documentId: ' + JSON.stringify(result));
  }

  console.log('[boldsign] Document created successfully. documentId:', documentId);

  // Best-effort: log the document status so we can confirm "WaitingForOthers".
  // Note: BoldSign trial/restricted API keys return 403 on GET endpoints —
  // if you see "403 / Forbidden" here, check document status in the dashboard:
  //   https://app-au.boldsign.com/documents  (AU region)
  //   https://app.boldsign.com/documents     (US/default region)
  try {
    const props = await documentApi.getProperties(documentId);
    const docStatus = props?.status ?? props?.documentStatus ?? 'unknown';
    const signerStatuses = (props?.signerDetails || []).map(
      (s) => `${s.signerEmail ?? s.email}: ${s.status}`
    );
    console.log('[boldsign] Document status after send:', docStatus,
      signerStatuses.length ? `| signers: ${signerStatuses.join(', ')}` : '');
    if (String(docStatus).toLowerCase() === 'draft') {
      if (useTextTags) {
        console.warn('[boldsign] WARNING: document is Draft — BoldSign could not find text tags in the document.',
          'Ensure the Word template contains {{{{Signature:sign_lease_1}}}} and {{{{DateSigned:sign_date_1}}}}',
          'as unbroken text (Word sometimes splits tags across XML runs; retype them in a fresh plain-text run).',
          'Alternatively disable BOLDSIGN_USE_TEXT_TAGS and use coordinate placement instead.');
      } else {
        console.warn('[boldsign] WARNING: document is Draft — no fields detected.',
          'Check BOLDSIGN_SIGN_PAGE / BOLDSIGN_SIGN_Y are within the document page bounds.');
      }
    }
  } catch (statusErr) {
    const errBody = statusErr?.body ?? statusErr?.response?.data ?? statusErr?.message ?? statusErr;
    const errDetail = typeof errBody === 'object' ? JSON.stringify(errBody) : String(errBody);
    if (errDetail.includes('403') || errDetail.toLowerCase().includes('forbidden')) {
      console.warn('[boldsign] getProperties returned 403 — API key may not have read scope.',
        'Verify document status manually in the BoldSign dashboard.',
        'documentId:', documentId);
    } else {
      console.warn('[boldsign] Could not fetch post-send document status:', errDetail);
    }
  }

  // ── Embedded sign URL ────────────────────────────────────────────────────────
  let signingUrl = null;
  if (isEmbedded) {
    signingUrl = await getEmbeddedSignUrl(documentId, String(signerEmail).trim(), returnUrl);
    console.log('[boldsign] Embedded signing URL obtained for', documentId);
  }

  return { documentId, signingUrl };
}

/**
 * Get an embedded signing URL for a document already sent for signing.
 *
 * @param {string} documentId
 * @param {string} signerEmail
 * @param {string} redirectUrl
 * @returns {Promise<string>}
 */
async function getEmbeddedSignUrl(documentId, signerEmail, redirectUrl) {
  const validTill = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  const documentApi = makeDocumentApi();

  console.log('[boldsign] Requesting embedded sign link for documentId:', documentId, 'signer:', signerEmail);

  let result;
  try {
    result = await documentApi.getEmbeddedSignLink(
      documentId,
      signerEmail,
      undefined, // countryCode
      undefined, // phoneNumber
      validTill, // must be a Date object
      redirectUrl
    );
  } catch (err) {
    const body = err?.body ?? err?.response?.data ?? err?.message;
    const detail = typeof body === 'object' ? JSON.stringify(body) : String(body ?? err);
    console.error('[boldsign] getEmbeddedSignLink failed:', detail);
    throw new Error(`BoldSign getEmbeddedSignLink failed: ${detail}`);
  }

  const url = result && result.signLink;
  if (!url) {
    throw new Error('BoldSign did not return a signing URL: ' + JSON.stringify(result));
  }
  return url;
}

/**
 * Fetch current document properties (status, etc.) from BoldSign.
 *
 * @param {string} documentId
 * @returns {Promise<object>}
 */
async function getDocumentProperties(documentId) {
  const documentApi = makeDocumentApi();
  try {
    const props = await documentApi.getProperties(documentId);
    console.log('[boldsign] getDocumentProperties:', documentId, '→ status:', props?.status ?? props?.documentStatus);
    return props;
  } catch (err) {
    const body = err?.body ?? err?.response?.data ?? err?.message;
    const detail = typeof body === 'object' ? JSON.stringify(body) : String(body ?? err);
    throw new Error(`BoldSign getDocumentProperties failed: ${detail}`);
  }
}

/**
 * Download the signed PDF for a completed document.
 *
 * @param {string} documentId
 * @returns {Promise<Buffer>}
 */
async function downloadSignedDocument(documentId) {
  const documentApi = makeDocumentApi();
  try {
    console.log('[boldsign] Downloading signed document:', documentId);
    const response = await documentApi.downloadDocument(documentId);
    const buf = Buffer.isBuffer(response) ? response : Buffer.from(response);
    console.log('[boldsign] Downloaded signed document:', documentId, 'size:', buf.length, 'bytes');
    return buf;
  } catch (err) {
    const body = err?.body ?? err?.response?.data ?? err?.message;
    const detail = typeof body === 'object' ? JSON.stringify(body) : String(body ?? err);
    throw new Error(`BoldSign download failed: ${detail}`);
  }
}

/**
 * Verify the X-BoldSign-Signature HMAC from an incoming webhook.
 * Returns true if BOLDSIGN_WEBHOOK_SECRET is not set (dev mode) or if HMAC matches.
 *
 * @param {Buffer|string} rawBody
 * @param {string|undefined} signatureHeader
 */
function verifyWebhookSignature(rawBody, signatureHeader) {
  const secret = process.env.BOLDSIGN_WEBHOOK_SECRET;
  if (!secret) return true; // not configured — allow all (dev)
  if (!signatureHeader) return false;
  const bodyBuf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  const hash = crypto.createHmac('sha256', secret).update(bodyBuf).digest('base64');
  const a = Buffer.from(hash, 'utf8');
  const b = Buffer.from(String(signatureHeader).trim(), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  isConfigured,
  createHireDocument,
  getEmbeddedSignUrl,
  getDocumentProperties,
  downloadSignedDocument,
  verifyWebhookSignature,
};
