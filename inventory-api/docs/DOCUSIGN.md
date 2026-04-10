# DocuSign eSignature (hire lease)

The inventory API can send the generated **Equipment hire lease** `.docx` to DocuSign for the lessee to sign. When the envelope completes, a **Connect webhook** marks the hire as **Signed** in the dashboard.

## 1. DocuSign developer setup

1. Create a [DocuSign developer account](https://developers.docusign.com/) (demo) or use production.
2. **Apps and Keys** → add an app → note **Integration Key** (Client ID).
3. Under the app, generate an **RSA key pair** → download the private key (keep secret).
   - Either save as a file and set `DOCUSIGN_RSA_PRIVATE_KEY_PATH`, **or** paste PEM into `DOCUSIGN_RSA_PRIVATE_KEY` (use `\n` for newlines in `.env`).
4. Add **Redirect URI** (any https URL is fine for JWT consent flow), e.g. `
5. **Grant consent** (one-time per https://localhost:3000/docusign/callback`.integration key + user): open this URL in a browser while logged in as the sending user (replace placeholders):

   `https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=	8b355e7b-6823-46a8-a863-55a68cdb639f&redirect_uri=https://localhost:3000/docusign/callback`

6. Copy **User ID** (API Username GUID) from **My Account → Apps and Keys**.
7. Copy **API Account ID** from the same page (or from an API “get user info” call).

## 2. Environment variables

Add to `inventory-api/.env`:

```env
# REST base (demo)
DOCUSIGN_BASE_PATH=https://demo.docusign.net/restapi
DOCUSIGN_OAUTH_BASE_PATH=account-d.docusign.com

# Production example:
# DOCUSIGN_BASE_PATH=https://na3.docusign.net/restapi
# DOCUSIGN_OAUTH_BASE_PATH=account.docusign.com

DOCUSIGN_INTEGRATION_KEY=your-integration-key-guid
DOCUSIGN_USER_ID=your-api-username-guid
DOCUSIGN_ACCOUNT_ID=your-account-id-guid

# Private key: file path OR inline PEM
DOCUSIGN_RSA_PRIVATE_KEY_PATH=C:\secrets\docusign_private.key
# DOCUSIGN_RSA_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"

# Optional

# Connect HMAC (recommended in production) — must match DocuSign Connect configuration
DOCUSIGN_CONNECT_HMAC_SECRET=your-connect-hmac-secret
```

## 3. Word template — signature anchor

DocuSign places a **Sign Here** tab on an **anchor string** in the document. The default anchor is **`/sign_lease/`** (override with `DOCUSIGN_SIGN_ANCHOR`).

1. Open `assets/Sheets/Equipment hire lease disclaimer.docx`.
2. At the **lessee signature** line, type the exact anchor text **`/sign_lease/`** (you may set font to white or very small so it is hidden on print if you prefer).
3. Save the template.

Without this string, envelope creation may succeed but the signer may not see a signature field in the expected place.

## 4. DocuSign Connect (webhook)

1. In DocuSign **Connect**, add a configuration:
   - **URL**: `https://YOUR_PUBLIC_API_HOST/hire-disclaimer/docusign/webhook`
   - **Include HMAC** → copy the secret into `DOCUSIGN_CONNECT_HMAC_SECRET`.
   - Format: **JSON** (SIM v2.1 style is fine).
   - Subscribe to **Envelope completed** (and optionally **Recipient completed** if you use multi-signer later).

2. Your API must be reachable from the internet (ngrok, etc. in dev).

If `DOCUSIGN_CONNECT_HMAC_SECRET` is **not** set, the webhook accepts any body (dev only — **do not use in production**).

## 5. API usage

- `GET /hire-disclaimer/docusign/status` — `{ enabled, signAnchor }`
- `POST /hire-disclaimer/hires/:actionId/docusign/send`
- **Hire form (web):** **Generate** saves the hire and opens a **PDF preview** (`GET .../hires/:id/preview.pdf`). The PDF is the same filled **Equipment hire lease** `.docx` converted with **LibreOffice** (see `docs/HIRE_PDF_PREVIEW.md`). **Share for signature (email)** calls `POST .../generate` with `respondWith: json` to obtain `hireId`, then `docusign/send` with `deliveryMethod: email` so DocuSign emails the lessee the signing link. Saving without a resolvable equipment ID uses `HIRE_STANDALONE_ASSET_ID` or an empty placeholder asset (see `.env.example`).

```json
{
  "deliveryMethod": "email",
  "signerEmail": "optional@override.com",
  "signerName": "Optional Lessee Name"
}
```

Embedded signing (open URL in new tab):

```json
{
  "deliveryMethod": "embedded",
  "returnUrl": "https://your-app.example.com/hire",
  "signerEmail": "lessee@example.com",
  "signerName": "Jane Doe"
}
```

Response: `{ ok, envelopeId, deliveryMethod, signingUrl }` — `signingUrl` is set only for `embedded`.

Lessee email defaults from the hire record if `signerEmail` is omitted.

## 6. Security

- Protect `PATCH /hire-disclaimer/hires/:id/signature-status` and the DocuSend routes in production (your app’s auth).
- Always enable **Connect HMAC** in production.
