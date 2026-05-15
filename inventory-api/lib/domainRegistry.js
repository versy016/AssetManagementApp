/**
 * Resolve organisation display names from registered email domains.
 * Used for hire signing audit PDFs and other domain-scoped branding.
 */

const prisma = require('./prisma');

function normalizeDomain(d) {
  if (!d || typeof d !== 'string') return '';
  return d.trim().toLowerCase();
}

function domainFromUser(user) {
  if (!user) return '';
  const fromCol = normalizeDomain(user.domain);
  if (fromCol) return fromCol;
  const email = user.useremail || '';
  const at = email.indexOf('@');
  if (at === -1) return '';
  return normalizeDomain(email.slice(at + 1));
}

async function lookupRegisteredDisplayName(domain) {
  const d = normalizeDomain(domain);
  if (!d) return null;
  const row = await prisma.registered_domains.findUnique({
    where: { domain: d },
    select: { display_name: true },
  });
  const name = row?.display_name && String(row.display_name).trim();
  return name || null;
}

/**
 * @param {{ id?: string, performed_by?: string|null, data?: object|null }} action asset_actions row (partial ok)
 * @returns {Promise<string>}
 */
async function resolveSigningOperatingEntityName(action) {
  const data = action?.data && typeof action.data === 'object' ? action.data : {};
  if (data.signingOperatingEntityName && String(data.signingOperatingEntityName).trim()) {
    return String(data.signingOperatingEntityName).trim();
  }

  const envDefault = process.env.DEFAULT_SIGNING_OPERATING_ENTITY_NAME
    ? String(process.env.DEFAULT_SIGNING_OPERATING_ENTITY_NAME).trim()
    : '';

  let performerDomain = '';
  if (action?.performed_by) {
    const user = await prisma.users.findUnique({
      where: { id: action.performed_by },
      select: { domain: true, useremail: true },
    });
    performerDomain = domainFromUser(user);
  }

  const fromRegistry = await lookupRegisteredDisplayName(performerDomain);
  if (fromRegistry) return fromRegistry;
  if (envDefault) return envDefault;
  return 'Engineering Surveys';
}

module.exports = {
  normalizeDomain,
  domainFromUser,
  lookupRegisteredDisplayName,
  resolveSigningOperatingEntityName,
};
