// inventory-api/lib/routeKey.js
// Shared identity for a mounted router, used by two things that must agree:
//   scripts/generate-api-map.js  — builds the node ids in public/api-map.data.json
//   lib/metrics.js               — labels each request so live counts join to those nodes
// If these two ever disagree, the map renders with no traffic on it and looks broken
// rather than erroring, so keep the derivation here and nowhere else.

'use strict';

/**
 * Stable node id for a router mount, e.g. '/admin/users' → 'r_admin_users'.
 * @param {string} mount Express mount path
 * @returns {string}
 */
function routerIdFromMount(mount) {
  const slug = String(mount || '')
    .replace(/[^\w]+/g, '_')
    .replace(/^_|_$/g, '');
  return `r_${slug || 'root'}`;
}

module.exports = { routerIdFromMount };
