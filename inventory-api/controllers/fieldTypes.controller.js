const { PrismaClient } = require('../generated/prisma');
const prisma = new PrismaClient();
const slugify = require('../scripts/slugify');

function validatePayload(data) {
  const errors = [];
  const { name, slug, has_options, description, validation_rules } = data;

  if (!name || typeof name !== 'string' || !name.trim()) {
    errors.push('name is required');
  }
  if (slug !== undefined && (typeof slug !== 'string' || !slug.trim())) {
    errors.push('slug must be a non-empty string');
  }
  if (has_options !== undefined && typeof has_options !== 'boolean') {
    errors.push('has_options must be a boolean');
  }
  if (
    validation_rules !== undefined &&
    (typeof validation_rules !== 'object' || Array.isArray(validation_rules))
  ) {
    errors.push('validation_rules must be an object');
  }
  if (
    description !== undefined &&
    description !== null &&
    typeof description !== 'string'
  ) {
    errors.push('description must be a string');
  }

  return { valid: errors.length === 0, errors };
}

exports.list = async (_req, res, next) => {
  try {
    const rows = await prisma.field_types.findMany({ orderBy: { created_at: 'asc' } });
    res.json(rows);
  } catch (e) { next(e); }
};

exports.create = async (req, res, next) => {
  try {
    const {
      name,
      slug: providedSlug,
      description = null,
      has_options = false,
      validation_rules = null,
    } = req.body || {};

    const { valid, errors } = validatePayload({
      name,
      slug: providedSlug,
      has_options,
      description,
      validation_rules,
    });
    if (!valid) return res.status(400).json({ error: errors.join(', ') });

    const baseSlug = slugify(providedSlug || name);
    let finalSlug = baseSlug;
    let i = 1;
    while (true) {
      const exists = await prisma.field_types.findUnique({
        where: { slug: finalSlug },
        select: { id: true },
      });
      if (!exists) break;
      finalSlug = `${baseSlug}-${i++}`;
    }

    const row = await prisma.field_types.create({
      data: {
        name: name.trim(),
        slug: finalSlug,
        description,
        has_options: !!has_options,
        validation_rules,
      },
    });
    res.status(201).json(row);
  } catch (e) {
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
