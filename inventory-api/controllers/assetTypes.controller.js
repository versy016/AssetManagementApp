// controllers/assetTypes.controller.js
const { PrismaClient } = require('../generated/prisma');
const prisma = new PrismaClient();
const SERVICE_STATUSES = new Set(['In Service', 'Available', 'available', 'in service']);
const EOL_STATUSES     = new Set(['End of Life', 'end of life', 'eol', 'retired', 'maintenance']);

// Small utility so we don’t repeat pagination math
function getPagination({ page = 1, pageSize = 20 }) {
  const p = Math.max(1, parseInt(page, 10));
  const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10)));
  return { page: p, pageSize: ps, skip: (p - 1) * ps, take: ps };

}

async function buildStatusCountsByType(prisma) {
  const grouped = await prisma.assets.groupBy({
    by: ['type_id', 'status'],
    _count: { _all: true },
  });

  const map = new Map();
  for (const row of grouped) {
    const id = row.type_id;
    const status = String(row.status || '');
    const count = row._count._all;

    const acc = map.get(id) || { inService: 0, endOfLife: 0 };
    if (SERVICE_STATUSES.has(status)) acc.inService += count;
    if (EOL_STATUSES.has(status))     acc.endOfLife += count;
    map.set(id, acc);
  }
  return map;
}

exports.list = async (req, res, next) => {
  try {
    const { q = '', include = '', page, pageSize } = req.query;
    const { skip, take, page: p, pageSize: ps } = getPagination({ page, pageSize });
    const flags = include.split(',').map(s => s.trim().toLowerCase());
    const includeFields = flags.includes('fields');
    const includeCounts = flags.includes('counts');            // your _count (total)
    const includeStatus = flags.includes('statuscounts')       // NEW: per-status counts
                      || flags.includes('countsbystatus');

    const where = q ? { name: { contains: q, mode: 'insensitive' } } : undefined;

    const [total, data, statusMap] = await Promise.all([
      prisma.asset_types.count({ where }),
      prisma.asset_types.findMany({
        where, skip, take,
        orderBy: { created_at: 'desc' },
        include: {
          ...(includeFields && { fields: { orderBy: { display_order: 'asc' } } }),
          ...(includeCounts && { _count: { select: { assets: true, fields: true } } }),
        },
      }),
      includeStatus ? buildStatusCountsByType(prisma) : null,
    ]);

    const shaped = includeStatus
      ? data.map(t => {
          const counts = statusMap.get(t.id) || { inService: 0, endOfLife: 0 };
          return { ...t, ...counts };
        })
      : data;

    res.json({ status: 'success', total, page: p, pageSize: ps, data: shaped });
  } catch (err) { next(err); }
};


exports.get = async (req, res, next) => {
  try {
    const { include = '' } = req.query;
    const flags = include.split(',').map(s => s.trim().toLowerCase());
    const includeFields = flags.includes('fields');
    const includeCounts = flags.includes('counts');

    const row = await prisma.asset_types.findUnique({
      where: { id: req.params.id },
      include: {
        ...(includeFields && { fields: { orderBy: { display_order: 'asc' } } }),
        ...(includeCounts && { _count: { select: { assets: true, fields: true } } }),
      },
    });

    if (!row) return res.status(404).json({ status: 'error', message: 'Asset type not found' });
    res.json({ status: 'success', data: row });
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const { name, image_url } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ status: 'error', message: 'name is required' });
    }
    const created = await prisma.asset_types.create({
      data: { name: name.trim(), image_url: image_url || null },
    });
    res.status(201).json({ status: 'success', data: created });
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const { name, image_url } = req.body;
    const existing = await prisma.asset_types.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ status: 'error', message: 'Asset type not found' });

    const updated = await prisma.asset_types.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined ? { name: name?.trim() } : {}),
        ...(image_url !== undefined ? { image_url } : {}),
      },
    });
    res.json({ status: 'success', data: updated });
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const id = req.params.id;
    const row = await prisma.asset_types.findUnique({
      where: { id },
      include: { _count: { select: { assets: true } } },
    });
    if (!row) return res.status(404).json({ status: 'error', message: 'Asset type not found' });

    if (row._count.assets > 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot delete asset type with existing assets. Reassign or remove assets first.',
        meta: { assetsCount: row._count.assets },
      });
    }

    await prisma.asset_types.delete({ where: { id } });
    res.json({ status: 'success', message: 'Deleted' });
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    // Supports JSON body (no file)
    const { name, image_url } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ status: 'error', message: 'name is required' });
    }

    const created = await prisma.asset_types.create({
      data: { name: name.trim(), image_url: image_url || null },
    });

    res.status(201).json({ status: 'success', data: created });
  } catch (err) { next(err); }
};

// Called when route detected multipart + upload.single('image') already ran
exports.createWithImage = async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name || !req.file) {
      return res.status(400).json({ status: 'error', message: 'name and image are required' });
    }

    const s3Url = req.uploadResult?.Location || null; // injected by route after S3 upload
    if (!s3Url) return res.status(500).json({ status: 'error', message: 'Image upload failed' });

    const created = await prisma.asset_types.create({
      data: { name: name.trim(), image_url: s3Url },
    });

    res.status(201).json({ status: 'success', data: created });
  } catch (err) { next(err); }
};

// Optional convenience summaries
exports.summary = async (_req, res, next) => {
  try {
    const [types, statusMap] = await Promise.all([
      prisma.asset_types.findMany({ orderBy: { name: 'asc' } }),
      buildStatusCountsByType(prisma),
    ]);

    const out = types.map(t => {
      const counts = statusMap.get(t.id) || { inService: 0, endOfLife: 0 };
      return {
        id: t.id,
        name: t.name,
        image_url: t.image_url,
        inService: counts.inService,
        endOfLife: counts.endOfLife,
      };
    });

    res.json({ status: 'success', data: out });
  } catch (err) { next(err); }
};
