// inventory-api/routes/metrics.js
// Read side of lib/metrics.js — feeds the live view of the API map.
//
// Access: this endpoint describes which parts of the API are failing, which is
// not something to publish. Set METRICS_TOKEN in the server's .env and pass it as
// `X-Metrics-Token` or `?key=`. With no token configured the route serves only
// outside production, so a deploy can never expose it by omission.

'use strict';

const express = require('express');
const metrics = require('../lib/metrics');
const logger = require('../lib/logger');

const router = express.Router();

const NODE_ENV = process.env.NODE_ENV || 'development';

function tokenOk(req) {
  const expected = process.env.METRICS_TOKEN;
  if (!expected) return NODE_ENV !== 'production';
  const given = req.get('X-Metrics-Token') || req.query.key;
  return typeof given === 'string' && given.length > 0 && given === expected;
}

// Named so scripts/generate-api-map.js can recognise it as a guard — the parser
// reads middleware by name, and an anonymous `guard` would read as unprotected.
function metricsTokenRequired(req, res, next) {
  if (tokenOk(req)) return next();
  return res.status(403).json({
    error: 'Metrics are not available',
    hint: process.env.METRICS_TOKEN
      ? 'Pass the configured token as X-Metrics-Token or ?key='
      : 'Set METRICS_TOKEN in the server environment to enable this endpoint in production.',
  });
}

/**
 * GET /metrics/routes?minutes=60
 * Aggregated request counts, error counts and latency per route template.
 */
router.get('/routes', metricsTokenRequired, async (req, res) => {
  if (!metrics.ENABLED) {
    return res.status(503).json({ error: 'Metrics collection is disabled (METRICS_ENABLED=false)' });
  }
  try {
    const minutes = Number(req.query.minutes || 60);
    const data = await metrics.summary(Number.isFinite(minutes) ? minutes : 60);
    res.set('Cache-Control', 'no-store');
    return res.json(data);
  } catch (e) {
    logger.error('[metrics] summary failed:', e && e.message ? e.message : e);
    // A missing table is the likely cause on a server that hasn't migrated yet —
    // say so rather than returning a bare 500.
    const missingTable = /api_route_metrics/.test(String(e && e.message)) && /does not exist|relation/i.test(String(e && e.message));
    return res.status(missingTable ? 503 : 500).json({
      error: missingTable
        ? 'Metrics table not found — run `npx prisma migrate deploy` on this server.'
        : 'Failed to read metrics',
    });
  }
});

module.exports = router;
