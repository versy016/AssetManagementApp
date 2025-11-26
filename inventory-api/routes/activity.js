// routes/activity.js – Aggregated activity feed
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('../generated/prisma');
const prisma = new PrismaClient();

// GET /activity?limit=50
router.get('/', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 200);
  try {
    const [actions, types, deletions] = await Promise.all([
      prisma.asset_actions.findMany({
        orderBy: { occurred_at: 'desc' },
        take: limit,
        include: {
          performer: { select: { id: true, name: true, useremail: true } },
          from_user: { select: { id: true, name: true, useremail: true } },
          to_user:   { select: { id: true, name: true, useremail: true } },
          asset:     { select: { id: true, model: true, image_url: true, asset_types: { select: { name: true } } } },
          details:   true,
        },
      }),
      prisma.asset_types.findMany({ orderBy: { created_at: 'desc' }, take: Math.min(limit, 50) }),
      prisma.asset_deletions.findMany({ orderBy: { deleted_at: 'desc' }, take: limit }),
    ]);

    // Resolve actor names/emails for deletions
    const actorIds = Array.from(new Set((deletions || []).map(d => d.deleted_by).filter(Boolean)));
    let actorMap = {};
    if (actorIds.length) {
      try {
        const users = await prisma.users.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true, useremail: true },
        });
        actorMap = Object.fromEntries(users.map(u => [u.id, u]));
      } catch {}
    }

    const mapAction = (a) => {
      // Coerce select STATUS_CHANGE events into virtual types for FE filtering
      let type = a.type;
      if (String(a.type).toUpperCase() === 'STATUS_CHANGE' && a?.data) {
        if (a.data.event === 'ASSET_CREATED') type = 'NEW_ASSET';
        else if (a.data.event === 'ASSET_EDIT') type = 'ASSET_EDIT';
      }
      return ({
        kind: 'ASSET_ACTION',
        id: a.id,
        when: a.occurred_at,
        type,
        note: a.note || null,
        data: a.data || null,
        actor: a.performer ? (a.performer.name || a.performer.useremail || a.performer.id) : null,
        from: a.from_user ? (a.from_user.name || a.from_user.useremail || a.from_user.id) : null,
        to:   a.to_user ? (a.to_user.name || a.to_user.useremail || a.to_user.id) : null,
        asset: a.asset ? {
          id: a.asset.id,
          name: a.asset.model || a.asset.asset_types?.name || a.asset.id,
          image_url: a.asset.image_url || null,
          type: a.asset.asset_types?.name || null,
        } : null,
      });
    };

    const mapType = (t) => ({
      kind: 'ASSET_TYPE_CREATED',
      id: t.id,
      when: t.created_at,
      type: 'ASSET_TYPE',
      name: t.name,
      image_url: t.image_url || null,
    });

    const mapDeletion = (d) => {
      const u = d.deleted_by ? actorMap[d.deleted_by] : null;
      const actor = u ? (u.name || u.useremail || d.deleted_by) : (d.deleted_by || null);
      return ({
        kind: 'ASSET_DELETED',
        id: d.id,
        when: d.deleted_at,
        type: 'ASSET_DELETED',
        note: 'Asset deleted',
        data: null,
        actor,
        from: null,
        to: null,
        asset: {
          id: d.asset_id,
          name: d.asset_name || d.asset_type || d.asset_id,
          image_url: d.image_url || null,
          type: d.asset_type || null,
        },
      });
    };

    const feed = [
      ...actions.map(mapAction),
      ...types.map(mapType),
      ...deletions.map(mapDeletion),
    ].sort((a, b) => new Date(b.when) - new Date(a.when)).slice(0, limit);

    res.json({ items: feed, count: feed.length });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to load activity' });
  }
});

module.exports = router;
