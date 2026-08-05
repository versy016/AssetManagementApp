// inventory-api/lib/actorContext.js
// Attaches "who was making this request" to Sentry events, so an issue reads
// "affects 3 users — Shivam Verma, ..." instead of an anonymous stack trace.
//
// PRIVACY: this sends staff names (and the uid) to Sentry. That is a deliberate
// choice, not the SDK default — `sendDefaultPii` stays off, so request bodies,
// headers, cookies and IP addresses are still never transmitted. Asset locations,
// customer emails and hire documents remain out of Sentry entirely.
//
// The name is read from the users table rather than the X-User-Name header where
// possible: the header is whatever the client chose to send, while the database
// row is what the organisation actually knows. The header is only a fallback for
// unauthenticated routers whose caller is not in the table.

'use strict';

const prisma = require('./prisma');
const sentry = require('./sentry');

// Names change rarely and staff count is small, so a short TTL cache keeps this
// to roughly one indexed lookup per user per window rather than one per request.
const TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // uid -> { name, at }

/**
 * Display name for a uid, from cache or the users table.
 * @param {string} uid
 * @returns {Promise<string|null>}
 */
async function lookupName(uid) {
  const hit = cache.get(uid);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.name;

  try {
    const u = await prisma.users.findUnique({
      where: { id: uid },
      select: { name: true, useremail: true },
    });
    const name = u ? u.name || u.useremail || null : null;
    cache.set(uid, { name, at: Date.now() });
    return name;
  } catch (_) {
    // A lookup failure must never break the request; fall back to any stale
    // cached value rather than retrying on the hot path.
    return hit ? hit.name : null;
  }
}

/**
 * Set the Sentry user for the current request scope.
 * @param {string} uid
 * @param {object} [opts]
 * @param {boolean} [opts.verified] True when the uid came from a verified token
 *   rather than a client-supplied header — recorded so a spoofed X-User-Id is
 *   never mistaken for proof of identity during triage.
 * @param {string} [opts.fallbackName] Used only when the uid is not in the table.
 */
async function attach(uid, opts = {}) {
  if (!uid || !sentry.isEnabled()) return;
  const id = String(uid);
  const name = (await lookupName(id)) || opts.fallbackName || null;

  sentry.setUser({
    id,
    ...(name ? { username: name } : {}),
    verified: Boolean(opts.verified),
  });
}

/**
 * App-level middleware for the client-asserted actor. Most routers here have no
 * auth middleware and identify the caller by header or query param, so this is
 * the only signal available for them. Routes that do verify a token overwrite
 * this from middleware/auth.js with verified: true.
 */
function middleware() {
  return function actorContextMiddleware(req, _res, next) {
    // Never block the request on this: it is diagnostic context, not behaviour.
    try {
      const uid =
        (req.user && req.user.uid) ||
        req.header('X-User-Id') ||
        req.header('x-user-id') ||
        (req.query ? req.query.uid : null);

      if (uid) {
        const headerName = (req.header('X-User-Name') || req.header('x-user-name') || '').trim();
        attach(uid, {
          verified: Boolean(req.user && req.user.uid),
          fallbackName: headerName || undefined,
        }).catch(() => {});
      }
    } catch (_) {
      /* diagnostic only */
    }
    next();
  };
}

/** Drop a cached name — call after a user is renamed. */
function invalidate(uid) {
  cache.delete(String(uid));
}

module.exports = { middleware, attach, lookupName, invalidate };
