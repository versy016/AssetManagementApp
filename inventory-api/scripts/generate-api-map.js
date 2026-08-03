// scripts/generate-api-map.js
// Zero-dependency generator: parses server.js + routes/*.js and writes
//   public/api-map.data.json  — nodes/edges/routers for the API map UI
//   public/openapi.json       — OpenAPI 3.1 doc (import into Scalar, Bruno, Postman)
// Run with `npm run api:map`.
//
// Same contract as scripts/generate-erd.js: no dependencies, never throws, exits 0
// on a parse hiccup so it can't block a commit hook. Static analysis only — the
// server is never booted, so this is safe to run in CI.
//
// It is a parser, not an interpreter: guards are read from the middleware named on
// each route line. A guard applied by a router-level `router.use(...)` will not be
// seen. Nothing in inventory-api does that today; if that changes, teach
// collectRouterLevelGuards() about it rather than trusting the output.

const fs = require('fs');
const path = require('path');
// Shared with lib/metrics.js so generated node ids and live request labels match.
const { routerIdFromMount } = require('../lib/routeKey');

const API_ROOT = path.resolve(__dirname, '..');
const ROUTES_DIR = path.join(API_ROOT, 'routes');
const SERVER_PATH = path.join(API_ROOT, 'server.js');
const OUT_DIR = path.join(API_ROOT, 'public');
const DATA_OUT = path.join(OUT_DIR, 'api-map.data.json');
const OPENAPI_OUT = path.join(OUT_DIR, 'openapi.json');

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

// Middleware names that gate a route. Order matters for display: the strongest wins.
const GUARDS = [
  { token: 'adminOnly', level: 'admin' },
  { token: 'authRequired', level: 'auth' },
  // A route protected by something other than the shared auth middleware must name
  // its guard here, or it is reported as unprotected.
  { token: 'metricsTokenRequired', level: 'token' },
  { token: 'attachUserFromBearerIfPresent', level: 'optional' },
];

/** Guard levels that count as "this route verifies who is calling". */
const REAL_GUARDS = ['admin', 'auth', 'token'];

// Third-party / out-of-process dependencies, detected per route file by keyword.
// `test` runs against the file source; `id` must match a node in EXTERNALS.
const EXTERNAL_SIGNALS = [
  { id: 's3', test: /aws-sdk|new AWS\.S3|S3_BUCKET|s3\.upload|putObject/ },
  { id: 'boldsign', test: /boldsign/i },
  { id: 'docusign', test: /docusign/i },
  { id: 'smtp', test: /emailService|nodemailer|sendMail/ },
  { id: 'push', test: /sendExpoPush|expo\.host|exp\.host/ },
  { id: 'groq', test: /GROQ|groq/ },
  { id: 'gplaces', test: /GOOGLE_PLACES|places\.googleapis|maps\.googleapis/ },
  { id: 'fbauth', test: /firebase-admin|admin\.auth\(\)/ },
  { id: 'soffice', test: /LIBREOFFICE|SOFFICE|hireDocxToPdf|libreoffice/i },
];

const EXTERNALS = {
  s3: { title: 'AWS S3', sub: 'documents · images · QR · PDFs' },
  boldsign: { title: 'BoldSign', sub: 'hire agreement e-signing' },
  docusign: { title: 'DocuSign', sub: 'alternate signing provider' },
  smtp: { title: 'SMTP', sub: 'nodemailer · transactional mail' },
  push: { title: 'Expo Push', sub: 'task & booking notifications' },
  groq: { title: 'Groq Vision', sub: 'photo → asset fields' },
  gplaces: { title: 'Google Places', sub: 'autocomplete · geocoding' },
  fbauth: { title: 'Firebase Auth', sub: 'identity · invitations' },
  soffice: { title: 'LibreOffice', sub: 'docx → pdf subprocess' },
};

// ── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Read server.js and resolve `app.use('<mount>', <routerVar>)` back to the route
 * file each router variable was required from. A file mounted more than once
 * (assetDocuments is mounted at both /assets and /asset-documents) yields one
 * entry per mount.
 * @returns {Array<{ mount: string, file: string }>}
 */
function parseMounts(serverSrc) {
  const varToFile = {};
  const requireRe = /const\s+(\w+)\s*=\s*require\(\s*'\.\/(routes\/[\w-]+)'\s*\)/g;
  for (const m of serverSrc.matchAll(requireRe)) {
    varToFile[m[1]] = `${m[2]}.js`;
  }

  const mounts = [];
  // Only `app.use('<path>', <identifier>)` — static mounts and rate limiters pass
  // an expression or a non-router variable and are skipped by the identifier match.
  const useRe = /app\.use\(\s*'([^']+)'\s*,\s*(\w+)\s*\)/g;
  for (const m of serverSrc.matchAll(useRe)) {
    const [, mount, varName] = m;
    if (varToFile[varName]) mounts.push({ mount, file: varToFile[varName] });
  }
  return mounts;
}

/**
 * Extract every `router.<method>('<path>', ...guards, handler)` from one route
 * file. Guards are read from the text between the path literal and the handler,
 * which is where Express middleware is listed.
 * @returns {Array<{ method: string, routePath: string, guards: string[] }>}
 */
function parseEndpoints(src) {
  const out = [];
  const re = new RegExp(
    `router\\.(${METHODS.join('|')})\\(\\s*(['"\`])([^'"\`]*)\\2`,
    'g'
  );

  for (const m of src.matchAll(re)) {
    const [full, method, , routePath] = m;
    const after = src.slice(m.index + full.length, m.index + full.length + 400);

    // Middleware sits between the path and the handler. The handler starts at the
    // first arrow-function/async signature, so cut there to avoid reading guard
    // names out of the handler body.
    const handlerAt = after.search(/async\s*\(|\(\s*_?req\b|\(\s*_req\b|function\s*\(/);
    const middleware = handlerAt === -1 ? after : after.slice(0, handlerAt);

    const guards = GUARDS.filter((g) => middleware.includes(g.token)).map((g) => g.level);
    if (/validate\s*\(/.test(middleware)) guards.push('validated');

    out.push({ method: method.toUpperCase(), routePath, guards });
  }
  return out;
}

/**
 * Concatenate a route file's source with that of the local modules it requires,
 * following `services/`, `lib/`, `utils/`, `middleware/` and `controllers/` up to
 * `depth` levels. Without this, a router that talks to S3 via `services/…` looks
 * like it has no external dependency at all.
 * @returns {string} combined source, for keyword scanning only
 */
function sourceWithLocalDeps(absFile, depth = 2, seen = new Set()) {
  const real = path.resolve(absFile);
  if (seen.has(real) || !fs.existsSync(real)) return '';
  seen.add(real);

  const src = fs.readFileSync(real, 'utf8');
  if (depth <= 0) return src;

  const dir = path.dirname(real);
  const localRe = /require\(\s*'(\.\.?\/[^']+)'\s*\)/g;
  let combined = src;

  for (const m of src.matchAll(localRe)) {
    const target = m[1];
    if (!/^\.\.?\/(services|lib|utils|middleware|controllers)\//.test(target)) continue;
    const resolved = path.resolve(dir, target.endsWith('.js') ? target : `${target}.js`);
    combined += `\n${sourceWithLocalDeps(resolved, depth - 1, seen)}`;
  }
  return combined;
}

/** Router-level guards (`router.use(authRequired)`). None today — see file header. */
function collectRouterLevelGuards(src) {
  const guards = [];
  for (const g of GUARDS) {
    if (new RegExp(`router\\.use\\([^)]*${g.token}`).test(src)) guards.push(g.level);
  }
  return guards;
}

/** Join a mount and a route path into one clean absolute path. */
function joinPath(mount, routePath) {
  const a = mount.replace(/\/+$/, '');
  const b = routePath === '/' ? '' : routePath;
  return (a + b) || '/';
}

/** Human label for a router node — the mount, minus slashes. */
function labelFor(mount, file) {
  if (mount === '/') return path.basename(file, '.js');
  return mount.replace(/^\//, '').replace(/\//g, ' / ');
}

// ── Build ───────────────────────────────────────────────────────────────────

function build() {
  const serverSrc = fs.readFileSync(SERVER_PATH, 'utf8');
  const mounts = parseMounts(serverSrc);

  const routers = [];
  const externalEdges = [];
  const seenExternals = new Set();

  for (const { mount, file } of mounts) {
    const abs = path.join(API_ROOT, file);
    if (!fs.existsSync(abs)) continue;

    const src = fs.readFileSync(abs, 'utf8');
    const routerGuards = collectRouterLevelGuards(src);
    const endpoints = parseEndpoints(src).map((e) => ({
      method: e.method,
      path: joinPath(mount, e.routePath),
      template: joinPath(mount, e.routePath),
      guards: [...new Set([...routerGuards, ...e.guards])],
    }));

    if (!endpoints.length) continue;

    const id = routerIdFromMount(mount);
    const guarded = endpoints.filter((e) => e.guards.some((g) => REAL_GUARDS.includes(g)));

    let posture;
    if (guarded.length === 0) posture = 'open';
    else if (guarded.length === endpoints.length) posture = 'locked';
    else posture = 'mixed';

    routers.push({
      id,
      mount,
      file,
      label: labelFor(mount, file),
      count: endpoints.length,
      guardedCount: guarded.length,
      posture,
      endpoints: endpoints.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)),
    });

    const depSrc = sourceWithLocalDeps(abs);
    for (const sig of EXTERNAL_SIGNALS) {
      if (sig.test.test(depSrc)) {
        externalEdges.push([id, sig.id]);
        seenExternals.add(sig.id);
      }
    }
  }

  // Merge routers that share a mount (none today, but assetDocuments-style double
  // mounts would otherwise collide on id).
  const merged = [];
  const byId = new Map();
  for (const r of routers) {
    if (byId.has(r.id)) {
      const prev = byId.get(r.id);
      const seen = new Set(prev.endpoints.map((e) => `${e.method} ${e.path}`));
      r.endpoints.forEach((e) => {
        if (!seen.has(`${e.method} ${e.path}`)) prev.endpoints.push(e);
      });
      prev.count = prev.endpoints.length;
      continue;
    }
    byId.set(r.id, r);
    merged.push(r);
  }

  merged.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const externals = [...seenExternals].sort().map((id) => ({
    id,
    kind: 'ext',
    title: EXTERNALS[id] ? EXTERNALS[id].title : id,
    sub: EXTERNALS[id] ? EXTERNALS[id].sub : '',
  }));

  return {
    generatedAt: new Date().toISOString(),
    generator: 'scripts/generate-api-map.js',
    totals: {
      routers: merged.length,
      endpoints: merged.reduce((n, r) => n + r.count, 0),
      unguardedRouters: merged.filter((r) => r.posture === 'open').length,
      externals: externals.length,
    },
    routers: merged,
    externals,
    externalEdges,
  };
}

// ── OpenAPI ─────────────────────────────────────────────────────────────────

function toOpenApi(map) {
  const paths = {};

  for (const r of map.routers) {
    for (const e of r.endpoints) {
      // Express `:id` → OpenAPI `{id}`
      const oaPath = e.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      const params = [...e.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => ({
        name: m[1],
        in: 'path',
        required: true,
        schema: { type: 'string' },
      }));

      if (!paths[oaPath]) paths[oaPath] = {};
      const needsBearer = e.guards.includes('auth') || e.guards.includes('admin');
      const needsToken = e.guards.includes('token');
      const needsAuth = needsBearer || needsToken;
      const security = [];
      if (needsBearer) security.push({ firebaseIdToken: [] });
      if (needsToken) security.push({ metricsToken: [] });

      paths[oaPath][e.method.toLowerCase()] = {
        tags: [r.label],
        summary: `${e.method} ${e.path}`,
        description: [
          `Source: \`${r.file}\``,
          e.guards.length ? `Guards: ${e.guards.join(', ')}` : 'Guards: none — unauthenticated',
        ].join('\n\n'),
        ...(params.length ? { parameters: params } : {}),
        // Only routes that actually verify the caller get a security requirement.
        security,
        responses: {
          200: { description: 'OK' },
          ...(needsBearer ? { 401: { description: 'Missing or invalid bearer token' } } : {}),
          ...(needsToken ? { 403: { description: 'Missing or invalid metrics token' } } : {}),
          ...(e.guards.includes('admin') ? { 403: { description: 'Admin privilege required' } } : {}),
          ...(e.guards.includes('validated') ? { 400: { description: 'Validation failed' } } : {}),
          500: { description: 'Server error' },
        },
      };
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'GearOps Inventory API',
      version: '1.0.0',
      description:
        'Generated from the Express route tree by `scripts/generate-api-map.js`. ' +
        'Request and response schemas are not inferred — only paths, methods and guards. ' +
        'Regenerate with `npm run api:map`.',
    },
    servers: [
      { url: 'http://localhost:3000', description: 'local' },
      { url: '{origin}', description: 'deployed', variables: { origin: { default: 'https://api.gearops.com.au' } } },
    ],
    tags: map.routers.map((r) => ({ name: r.label, description: `${r.count} routes · ${r.file}` })),
    components: {
      securitySchemes: {
        firebaseIdToken: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Firebase ID token, verified by `middleware/auth.js`.',
        },
        metricsToken: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Metrics-Token',
          description: 'Shared token from METRICS_TOKEN, checked by `routes/metrics.js`.',
        },
      },
    },
    paths,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

/** Everything except the timestamp, so an unchanged map compares equal. */
function withoutGeneratedAt(text) {
  return text.replace(/^\s*"generatedAt":.*$/m, '');
}

/**
 * Write only when the meaningful content changed. The commit hook regenerates on
 * every routes/*.js change, and rewriting solely to bump `generatedAt` would dirty
 * both files on every commit and turn them into recurring merge conflicts.
 * @returns {boolean} whether the file was written
 */
function writeIfChanged(file, contents) {
  try {
    const prev = fs.readFileSync(file, 'utf8');
    if (withoutGeneratedAt(prev) === withoutGeneratedAt(contents)) return false;
  } catch (_) {
    // No previous file — fall through and write.
  }
  fs.writeFileSync(file, contents);
  return true;
}

function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const map = build();
  const wroteData = writeIfChanged(DATA_OUT, `${JSON.stringify(map, null, 2)}\n`);
  const wroteApi = writeIfChanged(OPENAPI_OUT, `${JSON.stringify(toOpenApi(map), null, 2)}\n`);

  const rel = (p) => path.relative(process.cwd(), p);
  console.log(
    `API map ${wroteData ? 'written' : 'unchanged'}: ${rel(DATA_OUT)} (${map.totals.routers} routers, ` +
      `${map.totals.endpoints} endpoints, ${map.totals.unguardedRouters} with no auth guard)`
  );
  console.log(`OpenAPI ${wroteApi ? 'written' : 'unchanged'}: ${rel(OPENAPI_OUT)}`);
}

try {
  main();
} catch (e) {
  // Never block a commit hook over the map. Set API_MAP_DEBUG=1 to write the full
  // stack to scripts/api-map-error.log — the failure is otherwise easy to miss,
  // because a silent exit 0 leaves the previous JSON in place and looking fresh.
  console.warn('generate-api-map: skipped (', e && e.message ? e.message : e, ')');
  if (process.env.API_MAP_DEBUG) {
    try {
      fs.writeFileSync(path.join(__dirname, 'api-map-error.log'), String((e && e.stack) || e));
    } catch (_) {
      /* nothing more we can do */
    }
  }
  process.exit(0);
}
