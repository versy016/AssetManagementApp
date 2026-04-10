/**
 * DocuSign eSignature (JWT) — create envelopes from hire lease .docx.
 * Env: see inventory-api/docs/DOCUSIGN.md
 */
const fs = require('fs');
const crypto = require('crypto');

/** Place this exact text in the Word lease (lessee signature area); DocuSign places Sign Here on it. */
const DEFAULT_SIGN_ANCHOR = '/sign_lease/';

function isConfigured() {
  const key =
    process.env.DOCUSIGN_RSA_PRIVATE_KEY ||
    (process.env.DOCUSIGN_RSA_PRIVATE_KEY_PATH &&
      fs.existsSync(process.env.DOCUSIGN_RSA_PRIVATE_KEY_PATH));
  return !!(
    process.env.DOCUSIGN_INTEGRATION_KEY &&
    process.env.DOCUSIGN_USER_ID &&
    process.env.DOCUSIGN_ACCOUNT_ID &&
    key
  );
}

function getPrivateKeyBuffer() {
  if (process.env.DOCUSIGN_RSA_PRIVATE_KEY) {
    const pem = process.env.DOCUSIGN_RSA_PRIVATE_KEY.replace(/\\n/g, '\n');
    return Buffer.from(pem, 'utf8');
  }
  const p = process.env.DOCUSIGN_RSA_PRIVATE_KEY_PATH;
  if (!p || !fs.existsSync(p)) {
    throw new Error('DOCUSIGN_RSA_PRIVATE_KEY or DOCUSIGN_RSA_PRIVATE_KEY_PATH is missing or invalid');
  }
  return fs.readFileSync(p);
}

/**
 * @returns {Promise<{ accessToken: string, apiClient: import('docusign-esign').ApiClient, accountId: string, basePath: string }>}
 */
async function getAuthenticatedClient() {
  const docusign = require('docusign-esign');
  const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY;
  const userId = process.env.DOCUSIGN_USER_ID;
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
  const basePath =
    process.env.DOCUSIGN_BASE_PATH || 'https://demo.docusign.net/restapi';
  const oauthBasePath =
    process.env.DOCUSIGN_OAUTH_BASE_PATH || 'account-d.docusign.com';

  const apiClient = new docusign.ApiClient();
  apiClient.setBasePath(basePath);
  apiClient.setOAuthBasePath(oauthBasePath);

  const privateKey = getPrivateKeyBuffer();
  const scopes = ['signature', 'impersonation'];
  const tokenResponse = await apiClient.requestJWTUserToken(
    integrationKey,
    userId,
    scopes,
    privateKey,
    3600
  );
  const accessToken = tokenResponse.body && tokenResponse.body.access_token;
  if (!accessToken) {
    const detail = tokenResponse.body
      ? JSON.stringify(tokenResponse.body)
      : '(empty response)';
    throw new Error(`DocuSign JWT: no access_token — ${detail}. Check consent, integration key, user id, and RSA key.`);
  }
  apiClient.addDefaultHeader('Authorization', `Bearer ${accessToken}`);
  return { accessToken, apiClient, accountId, basePath };
}

/**
 * The admin copy-to email: HIRE_ADMIN_CC_EMAIL env var, defaults to admin@engsurveys.com.au.
 * Set to empty string to disable the CC.
 */
function getAdminCcEmail() {
  const env = process.env.HIRE_ADMIN_CC_EMAIL;
  if (env === '') return null;
  return (env && String(env).trim()) || 'admin@engsurveys.com.au';
}

/**
 * @param {object} opts
 * @param {Buffer} opts.documentBuffer
 * @param {string} opts.documentFileName
 * @param {string} opts.signerEmail
 * @param {string} opts.signerName
 * @param {string} opts.hireActionId
 * @param {'email'|'embedded'} opts.deliveryMethod
 * @param {string} [opts.returnUrl] required for embedded (e.g. https://app.example.com/hire)
 * @param {string} [opts.clientUserId] required for embedded; stable id per session
 */
async function createHireEnvelope(opts) {
  const docusign = require('docusign-esign');
  const {
    documentBuffer,
    documentFileName,
    signerEmail,
    signerName,
    hireActionId,
    deliveryMethod,
    returnUrl,
    clientUserId,
  } = opts;

  if (!signerEmail || !String(signerEmail).includes('@')) {
    throw new Error('Valid signerEmail is required');
  }
  if (deliveryMethod === 'embedded') {
    if (!returnUrl || !clientUserId) {
      throw new Error('embedded signing requires returnUrl and clientUserId');
    }
  }

  const anchorString =
    process.env.DOCUSIGN_SIGN_ANCHOR || DEFAULT_SIGN_ANCHOR;

  const { apiClient, accountId } = await getAuthenticatedClient();
  const envelopesApi = new docusign.EnvelopesApi(apiClient);

  const docB64 = documentBuffer.toString('base64');
  const extMatch = (documentFileName || 'lease.docx').match(/\.([^.]+)$/i);
  const fileExtension = (extMatch && extMatch[1]) || 'docx';

  const signHere = {
    documentId: '1',
    anchorString,
    anchorUnits: 'pixels',
    anchorYOffset: '10',
    anchorXOffset: '0',
  };

  const signer = {
    email: String(signerEmail).trim(),
    name: String(signerName || signerEmail).trim(),
    recipientId: '1',
    routingOrder: '1',
    tabs: {
      signHereTabs: [signHere],
    },
  };
  if (deliveryMethod === 'embedded') {
    signer.clientUserId = String(clientUserId);
  }

  const adminCcEmail = getAdminCcEmail();
  const carbonCopies = adminCcEmail
    ? [
        {
          email: adminCcEmail,
          name: process.env.HIRE_ADMIN_CC_NAME || 'Engineering Surveys Admin',
          recipientId: '2',
          routingOrder: '2',
        },
      ]
    : [];

  const emailBlurb =
    process.env.DOCUSIGN_EMAIL_BLURB ||
    'Please review the attached Equipment Hire Lease document. ' +
      'Read the disclaimer and liability terms carefully, then click "Sign" to add your signature. ' +
      'Once signed, you will receive a completed copy automatically, and a copy will be sent to our office.';

  const envelopeDefinition = {
    emailSubject:
      process.env.DOCUSIGN_EMAIL_SUBJECT ||
      'Please sign: Equipment hire lease',
    emailBlurb,
    status: 'sent',
    documents: [
      {
        documentBase64: docB64,
        name: documentFileName || 'Equipment hire lease.docx',
        fileExtension,
        documentId: '1',
      },
    ],
    recipients: {
      signers: [signer],
      ...(carbonCopies.length > 0 ? { carbonCopies } : {}),
    },
    customFields: {
      textCustomFields: [
        {
          name: 'hireActionId',
          value: String(hireActionId),
          show: 'false',
          required: 'false',
        },
      ],
    },
  };

  const result = await envelopesApi.createEnvelope(accountId, {
    envelopeDefinition,
  });
  const envelopeId = result && result.envelopeId;
  if (!envelopeId) {
    throw new Error('DocuSign did not return envelopeId');
  }

  let signingUrl = null;
  if (deliveryMethod === 'embedded') {
    const viewRequest = {
      returnUrl: String(returnUrl),
      authenticationMethod: 'none',
      email: signer.email,
      userName: signer.name,
      recipientId: '1',
      clientUserId: String(clientUserId),
    };
    const viewResult = await envelopesApi.createRecipientView(accountId, envelopeId, {
      recipientViewRequest: viewRequest,
    });
    signingUrl = viewResult && viewResult.url;
  }

  return { envelopeId, signingUrl };
}

/**
 * Verify DocuSign Connect HMAC (optional).
 * @param {Buffer|string} rawBody
 * @param {string|undefined} signatureHeader X-DocuSign-Signature-1
 */
function verifyConnectHmac(rawBody, signatureHeader) {
  const secret = process.env.DOCUSIGN_CONNECT_HMAC_SECRET;
  if (!secret) return true;
  if (!signatureHeader) return false;
  const bodyBuf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  const hash = crypto.createHmac('sha256', secret).update(bodyBuf).digest('base64');
  const a = Buffer.from(hash, 'utf8');
  const b = Buffer.from(String(signatureHeader).trim(), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Download the completed signed PDF for an envelope.
 * Uses the "combined" document endpoint which merges all docs + certificate of completion.
 * @param {string} envelopeId
 * @returns {Promise<Buffer>} PDF bytes
 */
async function downloadSignedDocument(envelopeId) {
  const docusign = require('docusign-esign');
  const { apiClient, accountId } = await getAuthenticatedClient();
  const envelopesApi = new docusign.EnvelopesApi(apiClient);
  // 'combined' = all documents merged into one PDF
  const result = await envelopesApi.getDocument(accountId, envelopeId, 'combined');
  if (!result) throw new Error('DocuSign returned empty document for envelope ' + envelopeId);
  if (Buffer.isBuffer(result)) return result;
  // SDK may return binary string in some versions
  return Buffer.from(result, 'binary');
}

module.exports = {
  isConfigured,
  getAuthenticatedClient,
  createHireEnvelope,
  downloadSignedDocument,
  verifyConnectHmac,
  DEFAULT_SIGN_ANCHOR,
};
