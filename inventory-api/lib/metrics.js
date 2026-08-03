// inventory-api/lib/metrics.js
// Per-route request/error counters for the API map's live view.
//
// Why Postgres and not an in-memory counter: PM2 runs this API with
// `instances: 'max'` in cluster mode, so an in-process counter would only ever
// describe one worker, and a scrape would hit a different worker each time.
// Workers instead buffer locally and flush with an upserting INSERT, so the
// database does the aggregation across the whole cluster.
//
// Cost per request is one Map lookup and a few integer adds; the write is one
// batched statement every METRICS_FLUSH_MS (default 15s), sized to the number of
// distinct routes touched in that window — tens of rows, not thousands.
//
// Nothing here is allowed to affect a response: every failure path logs and
// returns. Set METRICS_ENABLED=false to disable collection entirely.

'use strict';

const prisma = require('./prisma');
const logger = require('./logger');
const { routerIdFromMount } = require('./routeKey');

const ENABLED = process.env.METRICS_ENABLED !== 'false';
const FLUSH_MS = Math.max(2000, Number(process.env.METRICS_FLUSH_MS || 15000));
const RETENTION_DAYS = Math.max(1, Number(process.env.METRICS_RETENTION_DAYS || 7));

/** key `${bucketIso}|${method}|${route}` → accumulating row */
const buffer = new Map();
let flushTimer = null;
let lastPruneAt = 0;

/** Start of the minute containing `d`, as a Date. */
function minuteBucket(d) {
  const t = new Date(d);
  t.setSeconds(0, 0);
  return t;
}

/**
 * The route template Express matched, e.g. '/bookings/:id' — NOT the concrete
 * URL, which would explode cardinality (one row per asset id). Unmatched
 * requests are bucketed together so a 404 storm is still visible.
 */
function templateFor(req) {
  const base = req.baseUrl || '';
  const routePath = req.route && req.route.path ? req.route.path : null;

  if (!routePath) {
    // No route matched, or the request died in middleware before routing — a
    // rate-limit rejection, a malformed body, a 404. Bucket by first path segment
    // rather than into one global bin: cardinality stays bounded by the number of
    // top-level mounts, and "/assets is throwing 429s" stays visible.
    const seg = String(req.path || '/').split('/')[1] || '';
    return { router: '(unmatched)', route: `${seg ? `/${seg}` : ''}/(unmatched)` };
  }

  const joined = `${base}${routePath === '/' ? '' : routePath}` || '/';
  return { router: routerIdFromMount(base || '/'), route: joined };
}

/**
 * Paths excluded from collection. The map polls /metrics/routes every 15s and
 * loads its assets from /docs, so counting them would make the two busiest routes
 * in any window the monitoring itself — burying the traffic worth looking at.
 */
const IGNORED = [/^\/metrics(\/|$)/, /^\/docs(\/|$)/];

function isIgnored(pathname) {
  return IGNORED.some((re) => re.test(pathname));
}

/** Express middleware. Mount once, above the rate limiters and body parsers. */
function middleware() {
  if (!ENABLED) return (_req, _res, next) => next();

  return function metricsMiddleware(req, res, next) {
    if (isIgnored(req.path || '')) return next();
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      try {
        const ms = Number((process.hrtime.bigint() - startedAt) / 1000n) / 1000;
        const { router, route } = templateFor(req);
        const bucket = minuteBucket(new Date());
        const key = `${bucket.toISOString()}|${req.method}|${route}`;

        let row = buffer.get(key);
        if (!row) {
          row = {
            bucket,
            router,
            method: req.method,
            route,
            requests: 0,
            clientErrors: 0,
            serverErrors: 0,
            totalMs: 0,
            maxMs: 0,
          };
          buffer.set(key, row);
        }

        row.requests += 1;
        if (res.statusCode >= 500) row.serverErrors += 1;
        else if (res.statusCode >= 400) row.clientErrors += 1;
        row.totalMs += ms;
        if (ms > row.maxMs) row.maxMs = ms;

        ensureTimer();
      } catch (e) {
        logger.warn('[metrics] record failed:', e && e.message ? e.message : e);
      }
    });

    next();
  };
}

function ensureTimer() {
  if (flushTimer || !ENABLED) return;
  flushTimer = setInterval(() => {
    flush().catch(() => {});
  }, FLUSH_MS);
  if (flushTimer.unref) flushTimer.unref();
}

/**
 * Write the buffer to Postgres. The ON CONFLICT clause is what makes cluster mode
 * work: several workers upsert the same (bucket, method, route) key and the row
 * accumulates instead of the last writer winning.
 * @returns {Promise<number>} rows written
 */
async function flush() {
  if (!ENABLED || buffer.size === 0) return 0;

  const rows = [...buffer.values()];
  buffer.clear();

  try {
    await prisma.$transaction(
      rows.map(
        (r) => prisma.$executeRaw`
          INSERT INTO api_route_metrics
            (id, bucket, router, method, route, requests, client_errors, server_errors, total_ms, max_ms)
          VALUES
            (uuid_generate_v4(), ${r.bucket}, ${r.router}, ${r.method}, ${r.route},
             ${r.requests}, ${r.clientErrors}, ${r.serverErrors},
             ${Math.round(r.totalMs)}, ${Math.round(r.maxMs)})
          ON CONFLICT (bucket, method, route) DO UPDATE SET
            requests      = api_route_metrics.requests      + EXCLUDED.requests,
            client_errors = api_route_metrics.client_errors + EXCLUDED.client_errors,
            server_errors = api_route_metrics.server_errors + EXCLUDED.server_errors,
            total_ms      = api_route_metrics.total_ms      + EXCLUDED.total_ms,
            max_ms        = GREATEST(api_route_metrics.max_ms, EXCLUDED.max_ms)
        `
      )
    );
  } catch (e) {
    // Losing a window of metrics is strictly better than failing requests, so the
    // buffered rows are dropped rather than retried into an unbounded queue.
    logger.warn('[metrics] flush failed, dropping', rows.length, 'row(s):', e && e.message ? e.message : e);
    return 0;
  }

  await pruneOccasionally();
  return rows.length;
}

/** Drop rows past the retention window. Runs at most hourly, per worker. */
async function pruneOccasionally() {
  const now = Date.now();
  if (now - lastPruneAt < 60 * 60 * 1000) return;
  lastPruneAt = now;
  try {
    // The cutoff is computed here rather than in SQL: Prisma binds parameters as
    // untyped, and Postgres cannot resolve `make_interval(days => $1)` from an
    // untyped parameter. Binding a Date sidesteps the function entirely.
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await prisma.$executeRaw`
      DELETE FROM api_route_metrics
      WHERE bucket < ${cutoff}
    `;
  } catch (e) {
    logger.warn('[metrics] prune failed:', e && e.message ? e.message : e);
  }
}

/**
 * Aggregated traffic for the last `minutes`, grouped by route and by router.
 * @param {number} minutes
 */
async function summary(minutes = 60) {
  const mins = Math.min(60 * 24 * 7, Math.max(1, Math.floor(minutes)));
  // See pruneOccasionally(): the window start is bound as a timestamp rather than
  // built with make_interval(), which Postgres cannot resolve from an untyped
  // Prisma parameter.
  const since = new Date(Date.now() - mins * 60 * 1000);

  const rows = await prisma.$queryRaw`
    SELECT router,
           method,
           route,
           SUM(requests)::int      AS requests,
           SUM(client_errors)::int AS client_errors,
           SUM(server_errors)::int AS server_errors,
           SUM(total_ms)::int      AS total_ms,
           MAX(max_ms)::int        AS max_ms
    FROM api_route_metrics
    WHERE bucket >= ${since}
    GROUP BY router, method, route
    ORDER BY SUM(server_errors) DESC, SUM(requests) DESC
  `;

  const routes = rows.map((r) => ({
    router: r.router,
    method: r.method,
    route: r.route,
    requests: r.requests,
    clientErrors: r.client_errors,
    serverErrors: r.server_errors,
    avgMs: r.requests ? Math.round(r.total_ms / r.requests) : 0,
    maxMs: r.max_ms,
  }));

  const byRouter = {};
  for (const r of routes) {
    const agg = byRouter[r.router] || (byRouter[r.router] = {
      requests: 0, clientErrors: 0, serverErrors: 0, totalMs: 0, maxMs: 0,
    });
    agg.requests += r.requests;
    agg.clientErrors += r.clientErrors;
    agg.serverErrors += r.serverErrors;
    agg.totalMs += r.avgMs * r.requests;
    if (r.maxMs > agg.maxMs) agg.maxMs = r.maxMs;
  }
  Object.values(byRouter).forEach((a) => {
    a.avgMs = a.requests ? Math.round(a.totalMs / a.requests) : 0;
    delete a.totalMs;
  });

  return { windowMinutes: mins, generatedAt: new Date().toISOString(), byRouter, routes };
}

module.exports = { middleware, flush, summary, ENABLED };
