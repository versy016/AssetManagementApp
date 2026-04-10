// scripts/generate-improvements.js
// Generates AssetManagementApp_Improvements.docx

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  AlignmentType, ShadingType, VerticalAlign,
} = require('docx');
const fs = require('fs');
const path = require('path');

// ─── Colour palette ───────────────────────────────────────────────────────────
const C = {
  brand:   '0B63CE',
  high:    'DC2626',
  med:     'D97706',
  low:     '047857',
  highBg:  'FEE2E2',
  medBg:   'FEF3C7',
  lowBg:   'ECFDF5',
  headerBg:'1E3A5F',
  rowAlt:  'EFF6FF',
  border:  'CBD5E1',
  white:   'FFFFFF',
  text:    '0F172A',
  sub:     '475569',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function bold(text, size = 22, color = C.text) {
  return new TextRun({ text, bold: true, size, color });
}
function normal(text, size = 20, color = C.text) {
  return new TextRun({ text, size, color });
}
function para(children, opts = {}) {
  return new Paragraph({ children: Array.isArray(children) ? children : [children], ...opts });
}
function spacer(lines = 1) {
  return Array.from({ length: lines }, () =>
    new Paragraph({ children: [new TextRun({ text: '' })] })
  );
}
function heading1(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 36, color: C.white })],
    heading: HeadingLevel.HEADING_1,
    shading: { type: ShadingType.CLEAR, fill: C.headerBg },
    spacing: { before: 240, after: 120 },
    indent: { left: 120 },
  });
}
function heading2(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 26, color: C.brand })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 320, after: 80 },
    border: { bottom: { color: C.brand, size: 6, style: BorderStyle.SINGLE } },
  });
}
function heading3(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 22, color: C.text })],
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 60 },
  });
}
function bullet(text, level = 0) {
  return new Paragraph({
    children: [normal(text, 20)],
    bullet: { level },
    spacing: { after: 60 },
  });
}
function codePara(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'Courier New', size: 18, color: '9A3412' })],
    shading: { type: ShadingType.CLEAR, fill: 'FFF7ED' },
    spacing: { before: 60, after: 60 },
    indent: { left: 360 },
  });
}

// ─── Severity badge cell ──────────────────────────────────────────────────────
function severityCell(label) {
  const map = {
    High:   { fill: C.highBg, color: C.high },
    Medium: { fill: C.medBg,  color: C.med  },
    Low:    { fill: C.lowBg,  color: C.low  },
  };
  const m = map[label] || map.Low;
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text: label, bold: true, size: 18, color: m.color })],
      alignment: AlignmentType.CENTER,
    })],
    shading: { type: ShadingType.CLEAR, fill: m.fill },
    verticalAlign: VerticalAlign.CENTER,
    width: { size: 12, type: WidthType.PERCENTAGE },
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
  });
}

function issueTable(rows) {
  const headerRow = new TableRow({
    children: [
      ['Severity', 12],
      ['Finding', 52],
      ['Fix', 36],
    ].map(([text, pct]) => new TableCell({
      children: [new Paragraph({
        children: [bold(text, 20, C.white)],
        alignment: AlignmentType.CENTER,
      })],
      shading: { type: ShadingType.CLEAR, fill: C.headerBg },
      width: { size: pct, type: WidthType.PERCENTAGE },
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
    })),
    tableHeader: true,
  });

  const dataRows = rows.map((r, i) => new TableRow({
    children: [
      severityCell(r.severity),
      new TableCell({
        children: [
          new Paragraph({ children: [bold(r.file, 18)], spacing: { after: 40 } }),
          new Paragraph({ children: [normal(r.finding, 18)], spacing: { after: 0 } }),
        ],
        shading: { type: ShadingType.CLEAR, fill: i % 2 === 0 ? C.white : C.rowAlt },
        width: { size: 52, type: WidthType.PERCENTAGE },
        margins: { top: 60, bottom: 60, left: 100, right: 60 },
      }),
      new TableCell({
        children: [new Paragraph({ children: [normal(r.fix, 18, C.sub)], spacing: { after: 0 } })],
        shading: { type: ShadingType.CLEAR, fill: i % 2 === 0 ? C.white : C.rowAlt },
        width: { size: 36, type: WidthType.PERCENTAGE },
        margins: { top: 60, bottom: 60, left: 60, right: 100 },
      }),
    ],
  }));

  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top:          { style: BorderStyle.SINGLE, size: 4, color: C.border },
      bottom:       { style: BorderStyle.SINGLE, size: 4, color: C.border },
      left:         { style: BorderStyle.SINGLE, size: 4, color: C.border },
      right:        { style: BorderStyle.SINGLE, size: 4, color: C.border },
      insideH:      { style: BorderStyle.SINGLE, size: 2, color: C.border },
      insideV:      { style: BorderStyle.SINGLE, size: 2, color: C.border },
    },
  });
}

// ─── Data ─────────────────────────────────────────────────────────────────────
const critical = [
  {
    severity: 'High',
    file: 'middleware/auth.js — Dev auth bypass',
    finding: 'Accepts ?uid= query param or X-User-Id header as identity without any token verification. If NODE_ENV is not "production" on a reachable server (staging, misconfigured deploy), full impersonation of any user is possible.',
    fix: 'Remove the bypass entirely or restrict it to localhost only. Always verify Firebase ID tokens via admin.auth().verifyIdToken().',
  },
  {
    severity: 'High',
    file: 'routes/assets.js — Unauthenticated routes',
    finding: 'GET / (full asset list), PUT /:id, POST /:id/files, POST /:id/actions, and document/sign-off routes all have no authRequired middleware. Anyone who can reach the API can read or modify inventory.',
    fix: 'Add authRequired before every route handler. Pass Authorization: Bearer <Firebase ID token> from the frontend.',
  },
  {
    severity: 'High',
    file: 'routes/users.js — Mass assignment & open PII',
    finding: 'POST / creates users unauthenticated with attacker-chosen IDs. PUT /:id passes req.body directly to Prisma update (mass assignment). GET / and GET /:id expose emails, push tokens, and asset assignments to anyone.',
    fix: 'Add authRequired + admin check to mutating routes. Whitelist allowed fields for PUT. Restrict GET / to admins only.',
  },
  {
    severity: 'High',
    file: 'routes/activity.js — Open activity feed',
    finding: 'GET / returns the full operational feed including action notes, user emails, asset details, and hire/repair records with no authentication.',
    fix: 'Add authRequired. Optionally scope results to the authenticated user\'s assets unless they are an admin.',
  },
  {
    severity: 'High',
    file: 'routes/hireDisclaimer.js — Open hire data & mutations',
    finding: 'GET /hires exposes PII (emails, phones, client/project). DELETE /hires/:id deletes records. PATCH .../signature-status forges signature state. None require authentication.',
    fix: 'Add authRequired to all hire routes. PATCH signature-status should additionally verify the DocuSign webhook HMAC.',
  },
  {
    severity: 'High',
    file: 'routes/assetDocuments.js — Open uploads & document listing',
    finding: 'GET /documents returns all document metadata and S3 URLs. POST .../upload and POST .../documents allow unauthenticated S3 uploads and junk record creation.',
    fix: 'Add authRequired. For uploads, also validate file type and size server-side.',
  },
  {
    severity: 'High',
    file: 'routes/assets.js — adminOnly without authRequired',
    finding: 'POST /asset-types/:id/sync uses adminOnly middleware but req.user is never populated (no authRequired before it), so it is permanently 403 and unusable.',
    fix: 'Prepend authRequired before adminOnly on this route.',
  },
];

const performance = [
  {
    severity: 'High',
    file: 'utils/fetchTaskCount.js — Double .json() call',
    finding: 'Response body is consumed twice (lines 44–48). A Response body can only be read once; the second call throws silently, so the Tasks tab badge count is wrong or unstable.',
    fix: 'const raw = await res.json(); const list = Array.isArray(raw) ? raw : [];',
  },
  {
    severity: 'Medium',
    file: 'app/(tabs)/dashboard.js — N+1 activity fetch',
    finding: 'Recent activity loads /assets then fires up to 25 parallel GET /assets/:id/actions calls. Slow and hard on the API at scale.',
    fix: 'Add a single backend endpoint GET /activity?limit=25 that returns recent actions with asset stubs joined in one query.',
  },
  {
    severity: 'Medium',
    file: 'app/(tabs)/tasks.js — Sequential type fetches',
    finding: 'For each distinct type_id, the screen makes a sequential fetch for field definitions. O(types) round-trips; slow on large inventories.',
    fix: 'Batch into one endpoint GET /asset-types/fields?ids=... or cache type definitions client-side after first load.',
  },
  {
    severity: 'Medium',
    file: 'app/(tabs)/Inventory.js — Double asset fetch',
    finding: 'AssetTypesTab fetches /assets/asset-types-summary and then /assets again for fetchTypeCounts, doubling bandwidth unnecessarily.',
    fix: 'Derive type counts from the summary response already in hand, or pass the loaded data down as a prop.',
  },
  {
    severity: 'Medium',
    file: 'inventory-api/ — Multiple Prisma clients',
    finding: 'Each route file creates its own new PrismaClient(), resulting in multiple connection pools competing for DB connections.',
    fix: 'Export one shared instance from inventory-api/prismaClient.js and import it in all route files.',
  },
];

const bugs = [
  {
    severity: 'Medium',
    file: 'app/asset/[assetId].js — StatusBadge undefined fallback',
    finding: 'Falls back to STATUS_CONFIG.available which does not exist in the config. An unknown status can crash the render with "Cannot read properties of undefined".',
    fix: 'Change fallback to STATUS_CONFIG[\'in_service\'] which is always defined.',
  },
  {
    severity: 'Medium',
    file: 'app/search/index.js — Stale auth state',
    finding: 'Reads auth.currentUser once in a useEffect with empty deps. If auth state changes after mount, "only mine" and assignment filters use a stale user identity.',
    fix: 'Replace with onAuthStateChanged subscription and update the local me ref whenever auth changes.',
  },
  {
    severity: 'Medium',
    file: 'components/TaskCountLoader.js — Admin claim mismatch',
    finding: 'Uses only DB role field for admin detection, while dashboard.js combines DB role + Firebase custom claims. Admins granted via claims only get the wrong badge count.',
    fix: 'Align canAdmin logic: read Firebase ID token claims via user.getIdTokenResult() in addition to the DB role.',
  },
];

const quality = [
  {
    severity: 'Medium',
    file: 'server.js — CORS open to all origins',
    finding: 'cors() with no options allows any origin to call the API. Acceptable in development; a security risk in production.',
    fix: 'cors({ origin: [\'https://yourapp.com\', \'http://localhost:19006\'] })',
  },
  {
    severity: 'Low',
    file: 'server.js — Unauthenticated debug endpoint',
    finding: 'GET /__debug/qr-static exposes directory counts and metadata without authentication.',
    fix: 'Remove or gate behind authRequired + adminOnly, or disable when NODE_ENV === "production".',
  },
  {
    severity: 'Low',
    file: 'app/certs/index.js — Dead useEffect',
    finding: 'useEffect contains only setTimeout(..., 0) with no body. Misleading and does nothing.',
    fix: 'Remove the hook entirely or replace with real initialisation logic.',
  },
  {
    severity: 'Low',
    file: 'app/hire/index.js — Silent fetch failure',
    finding: 'On asset fetch failure the form loads blank with no error message shown to the user.',
    fix: 'Catch the error and render an inline error banner with a retry button.',
  },
  {
    severity: 'Low',
    file: 'app/activity/index.js — No pull-to-refresh or retry',
    finding: 'Activity feed is loaded once with no way to retry on failure or refresh on demand.',
    fix: 'Add a RefreshControl to the ScrollView and a retry handler in the error state.',
  },
  {
    severity: 'Low',
    file: 'config/algolia.js — API key in source',
    finding: 'The Algolia search-only key is committed to source control. If this is ever an admin/write key it can be exploited.',
    fix: 'Verify the key is search-only and restricted to specific indices in the Algolia dashboard. Move to an environment variable.',
  },
  {
    severity: 'Low',
    file: 'app/(tabs)/dashboard.js — console.log in production',
    finding: 'Tour measurement logs (measureAndScroll) are left in the build, adding noise to production logs.',
    fix: 'Wrap in __DEV__ check or remove.',
  },
  {
    severity: 'Low',
    file: 'components/ui/ — Inconsistent empty/loading states',
    finding: 'EmptyState and LoadingSpinner components exist but are only used in some screens. Others show blank on load or error.',
    fix: 'Audit each screen and replace ad-hoc loading/empty JSX with the shared components for consistent UX.',
  },
];

// ─── Validation data ──────────────────────────────────────────────────────────
const validationCritical = [
  {
    severity: 'High',
    file: 'routes/users.js — PUT /:id mass assignment',
    finding: 'The entire req.body is passed directly into prisma.users.update() with no field whitelist. Any client can overwrite any column — including role, useremail, or id.',
    fix: "Whitelist allowed fields: const ALLOWED = ['username','useremail','avatar_url','phone']; const safeBody = Object.fromEntries(Object.entries(req.body).filter(([k]) => ALLOWED.includes(k)));",
  },
  {
    severity: 'High',
    file: 'routes/users.js — promote/demote undefined variable crash',
    finding: 'POST /users/:id/promote and /demote reference admin and adminInitialized which are never imported or declared in that file. Any call to these routes throws a ReferenceError at runtime.',
    fix: 'Import firebase-admin and its initialization flag at the top of users.js, or extract promote/demote into a dedicated controller that already has admin in scope.',
  },
  {
    severity: 'High',
    file: 'routes/assetDocuments.js — IDOR on PATCH',
    finding: 'PATCH /:assetId/documents/:docId queries by { where: { id: docId } } only. It never checks that the document actually belongs to assetId. Anyone who can guess a document UUID can overwrite another asset\'s metadata.',
    fix: 'const doc = await prisma.asset_documents.findFirst({ where: { id: docId, asset_id: assetId } }); if (!doc) return res.status(404).json({ error: "Not found" });',
  },
  {
    severity: 'High',
    file: 'components/HireDisclaimerForm.js — required fields not enforced',
    finding: 'The UI marks hirerName, hireStartDate, hireEndDate, and rate as required (asterisk). None of them are checked in validateForm(). The form can be submitted with all these blank, creating junk records in the database.',
    fix: "Add to validateForm: if (!form.hirerName?.trim()) errors.hirerName = 'Name is required'; if (!form.hireStartDate) errors.hireStartDate = 'Start date is required'; if (!form.hireEndDate) errors.hireEndDate = 'End date is required'; if (!form.rate?.trim()) errors.rate = 'Rate is required';",
  },
  {
    severity: 'High',
    file: 'app/asset/edit.js — almost no client-side validation',
    finding: 'app/asset/new.js has full required-field checking, date validation, and dynamic field validation. edit.js only checks typeId. Edits with invalid or missing required fields silently reach the API; server errors then surface as generic alerts with no inline hints.',
    fix: 'Port the validate() function from new.js into a shared helper and call it from both screens before submission.',
  },
];

const validationBackend = [
  {
    severity: 'High',
    file: 'routes/assets.js — POST /:id/actions unauthenticated',
    finding: 'No authRequired. Anyone can log a transfer, service, or repair action for any asset. The performed_by field can be freely spoofed.',
    fix: 'Add authRequired; derive performed_by from req.user.uid rather than accepting it from the client.',
  },
  {
    severity: 'High',
    file: 'routes/assets.js — POST /:id/actions/:actionId/signoff',
    finding: 'No authRequired. Anyone can sign off a pending action and change asset status without being authenticated.',
    fix: 'Add authRequired and verify the caller is the assigned user or an admin.',
  },
  {
    severity: 'High',
    file: 'routes/hireDisclaimer.js — POST /generate no server-side required fields',
    finding: 'parseHireDisclaimerBody normalises strings but does not enforce required fields. Empty hirerName, dates, and rate are accepted and persisted.',
    fix: 'Add server-side validation: return 400 if hirerName, hireStartDate, or hireEndDate are empty when respondWith=json (i.e., when persisting to DB).',
  },
  {
    severity: 'Medium',
    file: 'routes/users.js — POST / no email format check',
    finding: 'Email is lowercased but not validated for format. An invalid string like "notanemail" is accepted and stored.',
    fix: "Add: if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(useremail)) return res.status(400).json({ error: 'Invalid email' });",
  },
  {
    severity: 'Medium',
    file: 'routes/assetDocuments.js — POST /:id/documents no URL validation',
    finding: 'The url field accepts any string. No URL format check means malformed or internal (SSRF-risk) URLs can be stored and later fetched.',
    fix: "Use URL constructor: try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }",
  },
  {
    severity: 'Medium',
    file: 'routes/assets.js — search query no max-length',
    finding: 'GET /assets?q= has no cap on query string length. A very long q value triggers an expensive DB LIKE query on every request.',
    fix: 'if (q && q.length > 200) return res.status(400).json({ error: "Query too long" });',
  },
  {
    severity: 'Medium',
    file: 'routes/assets.js — serial_number / model / notes unbounded',
    finding: 'POST and PUT /assets accept serial_number, model, and notes as free strings with no length limit. These are stored directly in the DB.',
    fix: 'Add length checks: if (serial_number?.length > 100) return 400; same for model (100) and notes (2000).',
  },
  {
    severity: 'Medium',
    file: 'routes/users.js — push token format not validated',
    finding: 'POST /users/push-token accepts any string as expo_push_token. An invalid token will silently fail when push notifications are sent.',
    fix: "Validate format: if (!/^ExponentPushToken\\[.+\\]$/.test(token)) return res.status(400).json({ error: 'Invalid push token format' });",
  },
  {
    severity: 'Low',
    file: 'routes/assetTypeFields.js — options array items uncapped',
    finding: 'The options array is checked with Array.isArray() and unique-string validation, but individual option values have no maximum length.',
    fix: 'Add: if (options.some(o => o.length > 200)) return res.status(400).json({ error: "Option value too long" });',
  },
  {
    severity: 'Low',
    file: 'inventory-api/validators/ — directory is empty',
    finding: 'The validators/ folder exists but contains no shared validator functions. Validation logic is duplicated inline across every route file, making it hard to maintain consistently.',
    fix: 'Create validators/common.js with shared helpers (isUUID, isEmail, isURL, isNonEmpty, maxLength) and import them in route files.',
  },
];

// ─── Build document ───────────────────────────────────────────────────────────
const doc = new Document({
  creator: 'Asset Management App — Code Audit',
  title: 'Asset Management App — Issues & Improvements',
  description: 'Full codebase audit findings with severity ratings and recommended fixes.',
  styles: {
    default: {
      document: {
        run: { font: 'Calibri', size: 20, color: C.text },
      },
    },
  },
  sections: [{
    properties: {
      page: {
        margin: { top: 720, bottom: 720, left: 900, right: 900 },
      },
    },
    children: [
      // ── Cover ──────────────────────────────────────────────────────────────
      new Paragraph({
        children: [new TextRun({ text: '', break: 2 })],
      }),
      new Paragraph({
        children: [bold('Asset Management App', 52, C.brand)],
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
      }),
      new Paragraph({
        children: [bold('Code Audit — Issues & Improvements', 36, C.headerBg)],
        alignment: AlignmentType.CENTER,
        spacing: { after: 160 },
      }),
      new Paragraph({
        children: [normal(`Generated: ${new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}`, 22, C.sub)],
        alignment: AlignmentType.CENTER,
        spacing: { after: 600 },
      }),

      // Summary box
      new Paragraph({
        children: [bold('Audit Summary', 24, C.white)],
        shading: { type: ShadingType.CLEAR, fill: C.headerBg },
        spacing: { before: 120, after: 60 },
        indent: { left: 180 },
      }),
      para([normal('This document contains all issues found during a full codebase review of the ', 20), bold('Asset Management App', 20), normal('. Findings are grouped by category and ranked by severity.', 20)], {
        shading: { type: ShadingType.CLEAR, fill: C.rowAlt },
        spacing: { before: 60, after: 60 },
        indent: { left: 180, right: 180 },
      }),
      ...['Critical — 7 issues (authentication & data exposure)',
          'Performance — 5 issues (N+1 fetches, double json(), multiple DB clients)',
          'Bugs — 3 issues (status crash, stale auth, badge mismatch)',
          'Code Quality & UX — 8 issues (CORS, dead code, missing error states)',
          'Input Validation — 15 issues (mass assignment, IDOR, missing required fields, format checks)',
      ].map(t => new Paragraph({
        children: [new TextRun({ text: '• ' }), normal(t, 20)],
        shading: { type: ShadingType.CLEAR, fill: C.rowAlt },
        spacing: { before: 40, after: 40 },
        indent: { left: 300, right: 180 },
      })),
      ...spacer(2),

      // ── Section 1: Critical ───────────────────────────────────────────────
      heading1('1. Critical — Security & Authentication'),
      para([normal('These issues mean the backend API is effectively public. Anyone who knows your API base URL can read all inventory, user PII, hire records, and signed documents — and can also modify or delete data. Fix these before any production deployment.', 20, C.sub)]),
      ...spacer(1),
      issueTable(critical),
      ...spacer(1),

      heading3('Recommended fix pattern for all routes'),
      codePara("const { authRequired } = require('../middleware/auth');"),
      codePara("router.get('/', authRequired, async (req, res) => { ... });"),
      para([normal('And from the frontend, pass the token on every call:', 20, C.sub)]),
      codePara("const token = await auth.currentUser.getIdToken();"),
      codePara("fetch(url, { headers: { Authorization: `Bearer ${token}` } });"),
      ...spacer(2),

      // ── Section 2: Performance ────────────────────────────────────────────
      heading1('2. Performance'),
      para([normal('These issues affect app speed and server load, particularly at scale. The double .json() bug also causes incorrect data silently.', 20, C.sub)]),
      ...spacer(1),
      issueTable(performance),
      ...spacer(1),

      heading3('Fix for fetchTaskCount.js double .json()'),
      codePara('// Before (broken)'),
      codePara('const data = assetsRes.json(); // consumed'),
      codePara('const list = await assetsRes.json(); // throws'),
      codePara(''),
      codePara('// After'),
      codePara('const raw = await assetsRes.json();'),
      codePara('const list = Array.isArray(raw) ? raw : [];'),
      ...spacer(1),

      heading3('Shared Prisma client'),
      codePara('// inventory-api/prismaClient.js'),
      codePara("const { PrismaClient } = require('@prisma/client');"),
      codePara('const prisma = new PrismaClient();'),
      codePara('module.exports = prisma;'),
      codePara(''),
      codePara('// In every route file'),
      codePara("const prisma = require('../prismaClient');"),
      ...spacer(2),

      // ── Section 3: Bugs ───────────────────────────────────────────────────
      heading1('3. Bugs'),
      para([normal('These are logic errors that produce wrong output or can crash specific screens.', 20, C.sub)]),
      ...spacer(1),
      issueTable(bugs),
      ...spacer(1),

      heading3('StatusBadge fallback fix — app/asset/[assetId].js'),
      codePara("// Before"),
      codePara("const cfg = STATUS_CONFIG[key] || STATUS_CONFIG.available; // undefined!"),
      codePara("// After"),
      codePara("const cfg = STATUS_CONFIG[key] || STATUS_CONFIG['in_service'];"),
      ...spacer(2),

      // ── Section 4: Code Quality & UX ──────────────────────────────────────
      heading1('4. Code Quality & UX'),
      para([normal('Lower severity but worth addressing to reduce maintenance risk and improve user experience.', 20, C.sub)]),
      ...spacer(1),
      issueTable(quality),
      ...spacer(2),

      // ── Section 5: Input Validation ───────────────────────────────────────
      heading1('5. Input Validation'),
      para([normal('This section covers every place where user-supplied input is accepted but insufficiently validated or sanitised — covering both the backend API and the frontend forms.', 20, C.sub)]),
      ...spacer(1),

      heading2('5.1 Critical — backend bugs & data integrity'),
      issueTable(validationCritical),
      ...spacer(1),

      heading3('Fix: field whitelist for PUT /users/:id'),
      codePara("const ALLOWED = ['username', 'useremail', 'avatar_url', 'phone'];"),
      codePara('const safeBody = Object.fromEntries('),
      codePara("  Object.entries(req.body).filter(([k]) => ALLOWED.includes(k))"),
      codePara(');'),
      codePara('await prisma.users.update({ where: { id }, data: safeBody });'),
      ...spacer(1),

      heading3('Fix: tie PATCH documents to assetId (prevent IDOR)'),
      codePara('const doc = await prisma.asset_documents.findFirst({'),
      codePara('  where: { id: docId, asset_id: assetId },'),
      codePara('});'),
      codePara("if (!doc) return res.status(404).json({ error: 'Not found' });"),
      ...spacer(1),

      heading3('Fix: HireDisclaimerForm required-field validation'),
      codePara("if (!form.hirerName?.trim())   errors.hirerName   = 'Name is required';"),
      codePara("if (!form.hireStartDate)        errors.hireStartDate = 'Start date is required';"),
      codePara("if (!form.hireEndDate)          errors.hireEndDate   = 'End date is required';"),
      codePara("if (!form.rate?.trim())         errors.rate          = 'Rate is required';"),
      ...spacer(2),

      heading2('5.2 Medium & Low — format and length gaps'),
      issueTable(validationBackend),
      ...spacer(1),

      heading3('Fix: shared validators/common.js'),
      codePara('// inventory-api/validators/common.js'),
      codePara("const isEmail = (v) => /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(v);"),
      codePara("const isURL   = (v) => { try { new URL(v); return true; } catch { return false; } };"),
      codePara("const maxLen  = (v, n) => typeof v === 'string' && v.length <= n;"),
      codePara("const isPushToken = (v) => /^ExponentPushToken\\[.+\\]$/.test(v);"),
      codePara('module.exports = { isEmail, isURL, maxLen, isPushToken };'),
      ...spacer(2),

      // ── Section 6: Priority order ─────────────────────────────────────────
      heading1('6. Recommended Fix Order'),
      ...spacer(1),
      ...[
        ['1',  'High',   'Lock down the API',                          'Add authRequired to all routes; pass Bearer tokens from the frontend; remove or harden the dev auth bypass in middleware/auth.js.'],
        ['2',  'High',   'Fix PUT /users/:id mass assignment',          'Whitelist allowed fields before the Prisma update — prevents privilege escalation via role overwrite.'],
        ['3',  'High',   'Fix promote/demote undefined variable crash', 'Import firebase-admin in users.js; routes currently throw ReferenceError at runtime.'],
        ['4',  'High',   'Fix PATCH /documents IDOR',                  'Verify docId belongs to assetId before updating — prevents cross-asset document tampering.'],
        ['5',  'High',   'Enforce required fields in HireDisclaimerForm', 'Add hirerName, hireStartDate, hireEndDate, rate checks to validateForm() on the frontend, and return 400 on the backend when persisting.'],
        ['6',  'High',   'Port edit.js validation from new.js',         'Share the validate() helper across new and edit asset screens to prevent silent partial updates.'],
        ['7',  'High',   'Fix fetchTaskCount.js double .json()',         'One-line fix that corrects the Tasks badge for all users.'],
        ['8',  'High',   'Fix adminOnly sync route',                    'Prepend authRequired before adminOnly on POST /asset-types/:id/sync.'],
        ['9',  'High',   'Protect hire, activity, documents & users',   'Add auth to the remaining four unprotected route groups.'],
        ['10', 'Medium', 'Add email + URL format validation',           'Validate email on POST /users and URL on POST /:id/documents to prevent junk data and SSRF.'],
        ['11', 'Medium', 'Add push token format validation',            'Reject tokens that do not match ExponentPushToken[...] pattern before storing.'],
        ['12', 'Medium', 'Cap unbounded string fields',                 'Enforce max lengths on serial_number (100), model (100), notes (2000), and search q (200).'],
        ['13', 'Medium', 'Centralise Prisma client',                    'Prevents connection pool exhaustion under load.'],
        ['14', 'Medium', 'Reduce N+1 fetches',                         'Add aggregated endpoints for dashboard recent activity and tasks field definitions.'],
        ['15', 'Medium', 'Fix StatusBadge fallback',                    'Prevents potential crash on unknown asset status.'],
        ['16', 'Medium', 'Align canAdmin admin detection',              'Fixes badge mismatch for Firebase-claim-only admins.'],
        ['17', 'Low',    'Create validators/common.js',                 'Centralise isEmail, isURL, maxLen, isPushToken helpers to eliminate duplicate inline validation.'],
        ['18', 'Low',    'CORS, console.log, dead hooks, empty states', 'Tidy-up pass across remaining low-severity items.'],
      ].map(([num, sev, title, desc], i) =>
        new Paragraph({
          children: [
            new TextRun({ text: `${num}.  `, bold: true, size: 20, color: C.brand }),
            new TextRun({ text: `[${sev}]  `, bold: true, size: 20, color: sev === 'High' ? C.high : sev === 'Medium' ? C.med : C.low }),
            new TextRun({ text: `${title} — `, bold: true, size: 20 }),
            new TextRun({ text: desc, size: 20, color: C.sub }),
          ],
          spacing: { after: 120 },
          shading: i % 2 === 0 ? undefined : { type: ShadingType.CLEAR, fill: C.rowAlt },
          indent: { left: 120 },
        })
      ),
    ],
  }],
});

const outPath = path.join(__dirname, '..', 'AssetManagementApp_Improvements.docx');
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(outPath, buf);
  console.log('Written:', outPath);
});
