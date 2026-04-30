// inventory-api/routes/adminUsers.js
// Admin User Management — all routes are domain-scoped.
// Business rule: an admin can ONLY manage users within their own email domain.
// Domain is always derived server-side from the DB — never trusted from the client.

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const logger = require('../lib/logger');
const { authRequired, adminOnly } = require('../middleware/auth');
const { sendInviteEmail } = require('../lib/emailService');

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Extract the domain portion from an email address. */
function getDomain(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return null;
  return email.split('@')[1].toLowerCase().trim();
}

/** Basic email format check. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Middleware ──────────────────────────────────────────────────────────────

/**
 * Load the requesting admin's full DB record and derive their domain.
 * Attaches req.adminUser = { id, name, useremail, role, domain }.
 * Always reads from DB so domain can never be spoofed from the client.
 */
async function loadAdminContext(req, res, next) {
  try {
    const admin = await prisma.users.findUnique({
      where: { id: req.user.uid },
      select: { id: true, name: true, useremail: true, role: true, domain: true, status: true },
    });

    if (!admin) {
      return res.status(403).json({ error: 'Admin account not found in database' });
    }
    if (admin.status === 'DISABLED') {
      return res.status(403).json({ error: 'Your account has been disabled' });
    }

    const domain = admin.domain || getDomain(admin.useremail);
    if (!domain) {
      return res.status(403).json({ error: 'Admin account has no associated email domain' });
    }

    req.adminUser = { ...admin, domain };
    return next();
  } catch (e) {
    logger.error('[adminUsers] loadAdminContext error:', e);
    return res.status(500).json({ error: 'Failed to verify admin context' });
  }
}

/**
 * Verify the target user (:id) belongs to the same domain as the requesting admin.
 * Attaches req.targetUser if check passes.
 * Must run after loadAdminContext.
 */
async function requireSameDomain(req, res, next) {
  try {
    const target = await prisma.users.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, useremail: true, domain: true, role: true, status: true },
    });

    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    const targetDomain = target.domain || getDomain(target.useremail);
    if (!targetDomain || targetDomain !== req.adminUser.domain) {
      return res.status(403).json({
        error: 'You can only manage users within your organisation domain',
      });
    }

    req.targetUser = { ...target, domain: targetDomain };
    return next();
  } catch (e) {
    logger.error('[adminUsers] requireSameDomain error:', e);
    return res.status(500).json({ error: 'Failed to verify domain access' });
  }
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /admin/users
 * List all users in the admin's domain.
 * Query params: search (string), role (ADMIN|USER), status (ACTIVE|INVITED|DISABLED)
 */
router.get('/', authRequired, adminOnly, loadAdminContext, async (req, res) => {
  try {
    const { search, role, status } = req.query;
    const d = req.adminUser.domain;

    // Match users by domain field OR by email suffix for existing records
    // that pre-date the domain column (domain IS NULL but email matches).
    const domainClause = {
      OR: [
        { domain: d },
        { domain: null, useremail: { endsWith: `@${d}`, mode: 'insensitive' } },
      ],
    };

    const where = {
      AND: [
        domainClause,
        ...(role && ['USER', 'ADMIN'].includes(role) ? [{ role }] : []),
        ...(status && ['ACTIVE', 'INVITED', 'DISABLED'].includes(status) ? [{ status }] : []),
        ...(search
          ? [{
              OR: [
                { useremail: { contains: search.trim(), mode: 'insensitive' } },
                { name: { contains: search.trim(), mode: 'insensitive' } },
              ],
            }]
          : []),
      ],
    };

    const users = await prisma.users.findMany({
      where,
      select: {
        id: true,
        name: true,
        useremail: true,
        role: true,
        status: true,
        domain: true,
        created_at: true,
        invitedBy: { select: { name: true, useremail: true } },
      },
      orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
    });

    // Summary counts — also use the OR fallback for domain matching
    const allStatuses = await prisma.users.findMany({
      where: domainClause,
      select: { status: true },
    });

    const counts = { ACTIVE: 0, INVITED: 0, DISABLED: 0, total: 0 };
    allStatuses.forEach(({ status: s }) => {
      if (s && counts[s] !== undefined) counts[s]++;
      counts.total++;
    });

    return res.json({ users, counts });
  } catch (e) {
    logger.error('[adminUsers] GET / error:', e);
    return res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * POST /admin/users/invite
 * Invite a new user. Creates DB record with status=INVITED and sends invite email.
 * Body: { email: string, name?: string, role?: 'USER'|'ADMIN' }
 */
router.post('/invite', authRequired, adminOnly, loadAdminContext, async (req, res) => {
  try {
    const { email, name, role = 'USER' } = req.body || {};

    // ── Validate inputs ──────────────────────────────────────────────────────
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'email is required' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    if (!['USER', 'ADMIN'].includes(role)) {
      return res.status(400).json({ error: 'role must be USER or ADMIN' });
    }

    // ── Domain enforcement (backend — never trust client) ─────────────────────
    const targetDomain = getDomain(normalizedEmail);
    if (targetDomain !== req.adminUser.domain) {
      return res.status(403).json({
        error: `You can only invite users from your organisation domain (@${req.adminUser.domain})`,
      });
    }

    // ── Duplicate check ──────────────────────────────────────────────────────
    const existing = await prisma.users.findUnique({ where: { useremail: normalizedEmail } });
    if (existing) {
      if (existing.status === 'INVITED') {
        return res.status(409).json({
          error: 'An invitation for this email address is already pending.',
        });
      }
      if (existing.status === 'DISABLED') {
        return res.status(409).json({
          error: 'A disabled account exists for this email. Re-enable it from the user list instead.',
        });
      }
      return res.status(409).json({ error: 'A user with this email address already exists.' });
    }

    // ── Create INVITED record ────────────────────────────────────────────────
    // id is a temp UUID (uuid_generate_v4 default). Replaced with Firebase UID on registration.
    const displayName = name?.trim() || normalizedEmail.split('@')[0];
    const invited = await prisma.users.create({
      data: {
        name: displayName,
        useremail: normalizedEmail,
        domain: targetDomain,
        role,
        status: 'INVITED',
        userassets: [],
        invitedById: req.adminUser.id,
      },
    });

    // ── Send invite email (non-blocking — don't fail if SMTP unconfigured) ────
    try {
      await sendInviteEmail({
        toEmail: normalizedEmail,
        toName: displayName,
        invitedByName: req.adminUser.name || req.adminUser.useremail,
        domain: targetDomain,
      });
    } catch (emailErr) {
      logger.warn('[adminUsers] Invite email failed (non-fatal):', emailErr?.message);
    }

    logger.log(`[adminUsers] Invited ${normalizedEmail} (role=${role}) by ${req.adminUser.useremail}`);

    return res.status(201).json({
      user: {
        id: invited.id,
        name: invited.name,
        useremail: invited.useremail,
        role: invited.role,
        status: invited.status,
        created_at: invited.created_at,
      },
      message: 'Invitation sent. The user has been emailed instructions to register.',
    });
  } catch (e) {
    logger.error('[adminUsers] POST /invite error:', e);
    return res.status(500).json({ error: 'Failed to create invitation' });
  }
});

/**
 * PATCH /admin/users/:id/role
 * Promote (USER → ADMIN) or demote (ADMIN → USER).
 * Body: { role: 'USER'|'ADMIN' }
 */
router.patch('/:id/role', authRequired, adminOnly, loadAdminContext, requireSameDomain, async (req, res) => {
  try {
    const { role } = req.body || {};

    if (!['USER', 'ADMIN'].includes(role)) {
      return res.status(400).json({ error: 'role must be USER or ADMIN' });
    }

    // Prevent self-role-change (mandatory — admin cannot remove own privileges)
    if (req.params.id === req.adminUser.id) {
      return res.status(403).json({ error: 'You cannot change your own role' });
    }

    // Cannot promote/demote a disabled account
    if (req.targetUser.status === 'DISABLED') {
      return res.status(400).json({ error: 'Re-enable the user account before changing their role' });
    }

    const updated = await prisma.users.update({
      where: { id: req.params.id },
      data: { role },
      select: { id: true, name: true, useremail: true, role: true, status: true },
    });

    const action = role === 'ADMIN' ? 'promoted to ADMIN' : 'demoted to USER';
    logger.log(`[adminUsers] ${req.targetUser.useremail} ${action} by ${req.adminUser.useremail}`);

    return res.json({ user: updated, message: `User ${action} successfully` });
  } catch (e) {
    logger.error('[adminUsers] PATCH /:id/role error:', e);
    return res.status(500).json({ error: 'Failed to update role' });
  }
});

/**
 * PATCH /admin/users/:id/status
 * Enable (ACTIVE) or disable (DISABLED) a user account.
 * Body: { status: 'ACTIVE'|'DISABLED' }
 */
router.patch('/:id/status', authRequired, adminOnly, loadAdminContext, requireSameDomain, async (req, res) => {
  try {
    const { status } = req.body || {};

    if (!['ACTIVE', 'DISABLED'].includes(status)) {
      return res.status(400).json({ error: 'status must be ACTIVE or DISABLED' });
    }

    // Cannot disable self
    if (req.params.id === req.adminUser.id) {
      return res.status(403).json({ error: 'You cannot change your own account status' });
    }

    const updated = await prisma.users.update({
      where: { id: req.params.id },
      data: { status },
      select: { id: true, name: true, useremail: true, role: true, status: true },
    });

    const action = status === 'DISABLED' ? 'disabled' : 're-enabled';
    logger.log(`[adminUsers] ${req.targetUser.useremail} ${action} by ${req.adminUser.useremail}`);

    return res.json({ user: updated, message: `User account ${action} successfully` });
  } catch (e) {
    logger.error('[adminUsers] PATCH /:id/status error:', e);
    return res.status(500).json({ error: 'Failed to update status' });
  }
});

/**
 * DELETE /admin/users/:id
 * Soft delete — sets status to DISABLED. Data is retained for audit trail.
 */
router.delete('/:id', authRequired, adminOnly, loadAdminContext, requireSameDomain, async (req, res) => {
  try {
    // Cannot remove self
    if (req.params.id === req.adminUser.id) {
      return res.status(403).json({ error: 'You cannot remove your own account' });
    }

    await prisma.users.update({
      where: { id: req.params.id },
      data: { status: 'DISABLED' },
    });

    logger.log(`[adminUsers] Soft-deleted ${req.targetUser.useremail} by ${req.adminUser.useremail}`);

    return res.json({ message: 'User has been disabled and removed from the active roster' });
  } catch (e) {
    logger.error('[adminUsers] DELETE /:id error:', e);
    return res.status(500).json({ error: 'Failed to remove user' });
  }
});

module.exports = router;
