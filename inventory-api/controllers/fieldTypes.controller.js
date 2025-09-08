const { PrismaClient } = require('../generated/prisma');
const prisma = new PrismaClient();

exports.list = async (_req, res, next) => {
  try {
    const rows = await prisma.field_types.findMany({ orderBy: { created_at: 'asc' } });
    res.json(rows);
  } catch (e) { next(e); }
};

exports.create = async (req, res, next) => {
  try {
    const { name, slug, description = null, has_options = false, validation_rules = null } = req.body || {};
    if (!name || !slug) return res.status(400).json({ error: 'name and slug are required' });

    const row = await prisma.field_types.create({
      data: { name, slug, description, has_options: !!has_options, validation_rules },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'slug must be unique' });
    next(e);
  }
};

exports.ensureDefaults = async (_req, res, next) => {
  try {
    const defaults = [
      { name: 'Text', slug: 'text', has_options: false, description: 'Single-line string' },
      { name: 'Email', slug: 'email', has_options: false },
      { name: 'Select', slug: 'select', has_options: true, description: 'One option from list' },
      { name: 'Number', slug: 'number', has_options: false, description: 'Integer/float' },
      { name: 'URL', slug: 'url', has_options: false },
      { name: 'Currency', slug: 'currency', has_options: false },
      { name: 'Multi-Select', slug: 'multiselect', has_options: true, description: 'Many options from list' },
      { name: 'Date', slug: 'date', has_options: false },
      { name: 'Textarea', slug: 'textarea', has_options: false, description: 'Multi-line text' },
      { name: 'Boolean', slug: 'boolean', has_options: false, description: 'True/False' },
      { name: 'Datetime', slug: 'datetime', has_options: false },
    ];

    for (const d of defaults) {
      await prisma.field_types.upsert({
        where: { slug: d.slug },
        update: { name: d.name, has_options: d.has_options, description: d.description ?? null },
        create: { ...d, validation_rules: null },
      });
    }
    const rows = await prisma.field_types.findMany({ orderBy: { created_at: 'asc' } });
    res.json(rows);
  } catch (e) { next(e); }
};
