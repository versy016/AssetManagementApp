// inventory-api/controllers/assetTypeFieldsController.js
const { PrismaClient } = require('../generated/prisma');
const prisma = new PrismaClient();
const slugify = require('../scripts/slugify');
const { validationResult } = require('express-validator');

/** shared */
async function validateFieldPayload(data, fieldType) {
  const errors = [];
  const {
    name,
    field_type_id,
    options,
    validation_rules,
    is_required,
    default_value,
    display_order,
  } = data;

  if (!name || typeof name !== 'string' || !name.trim()) {
    errors.push('Field name is required');
  }
  if (!field_type_id || typeof field_type_id !== 'string') {
    errors.push('Field type ID is required');
  }
  if (is_required !== undefined && typeof is_required !== 'boolean') {
    errors.push('is_required must be a boolean');
  }
  if (
    display_order !== undefined &&
    (!Number.isInteger(display_order) || display_order < 0)
  ) {
    errors.push('display_order must be a non-negative integer');
  }

  if (options !== undefined) {
    if (!Array.isArray(options)) {
      errors.push('Options must be an array');
    } else {
      const invalid = options.some(
        (opt) => typeof opt !== 'string' || !opt.trim()
      );
      if (invalid) errors.push('Each option must be a non-empty string');
      if (new Set(options).size !== options.length) {
        errors.push('Options must be unique');
      }
    }
  }

  if (
    fieldType?.has_options &&
    (!options || !Array.isArray(options) || options.length === 0)
  ) {
    errors.push('Options are required for this field type');
  }
  if (
    fieldType?.has_options &&
    default_value !== undefined &&
    default_value !== null &&
    (!options || !options.includes(default_value))
  ) {
    errors.push('Default value must be one of the provided options');
  }

  if (
    validation_rules !== undefined &&
    (typeof validation_rules !== 'object' || Array.isArray(validation_rules))
  ) {
    errors.push('Validation rules must be an object');
  }

  return { valid: errors.length === 0, errors };
}

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return true;
  }
  return false;
}

exports.listFields = async (req, res) => {
  const { assetTypeId } = req.params;
  try {
    const assetType = await prisma.asset_types.findUnique({ where: { id: assetTypeId } });
    if (!assetType) return res.status(404).json({ error: 'Asset type not found' });

    const fields = await prisma.asset_type_fields.findMany({
      where: { asset_type_id: assetTypeId },
      include: {
        field_type: { select: { id: true, name: true, slug: true, has_options: true, description: true } },
      },
      orderBy: [{ display_order: 'asc' }, { created_at: 'asc' }],
    });

    res.json(fields);
  } catch (err) {
    console.error('List asset type fields error:', err);
    res.status(500).json({ error: 'Failed to list asset type fields' });
  }
};

exports.createField = async (req, res) => {
  if (handleValidation(req, res)) return;
  const { assetTypeId } = req.params;

  const {
    name,
    field_type_id,
    slug: providedSlug,
    description = null,
    is_required = false,
    default_value = null,
    options = null,
    validation_rules = null,
    display_order = 0,
  } = req.body;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const assetType = await tx.asset_types.findUnique({ where: { id: assetTypeId }, select: { id: true } });
      if (!assetType) throw { status: 404, message: 'Asset type not found' };

      const fieldType = await tx.field_types.findUnique({
        where: { id: field_type_id },
        select: { id: true, has_options: true },
      });
      if (!fieldType) throw { status: 400, message: 'Invalid field type' };

      const validation = await validateFieldPayload(
        { ...req.body, display_order: Number(display_order) },
        fieldType
      );
      if (!validation.valid) throw { status: 400, message: validation.errors.join(', ') };

      // unique slug within asset type
      const baseSlug = providedSlug || slugify(name);
      let finalSlug = baseSlug;
      let i = 1;
      while (true) {
        const exists = await tx.asset_type_fields.findFirst({
          where: { asset_type_id: assetTypeId, slug: finalSlug },
          select: { id: true },
        });
        if (!exists) break;
        finalSlug = `${baseSlug}-${i++}`;
      }

      return tx.asset_type_fields.create({
        data: {
          asset_type_id: assetTypeId,
          field_type_id,
          name,
          slug: finalSlug,
          description,
          is_required: !!is_required,
          default_value,
          options: options || null,
          validation_rules: validation_rules || null,
          display_order: Number(display_order) || 0,
        },
        include: {
          field_type: { select: { id: true, name: true, slug: true, has_options: true } },
        },
      });
    });

    res.status(201).json(created);
  } catch (err) {
    console.error('Create asset type field error:', err);
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === 'P2002') return res.status(409).json({ error: 'A field with this slug already exists' });
    if (err.code === 'P2003') return res.status(400).json({ error: 'Invalid foreign key' });
    res.status(500).json({ error: 'Failed to create asset type field' });
  }
};

exports.updateField = async (req, res) => {
  if (handleValidation(req, res)) return;
  const { assetTypeId, fieldId } = req.params;

  const {
    name,
    field_type_id,
    description,
    is_required,
    default_value,
    options,
    validation_rules,
    display_order,
  } = req.body;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.asset_type_fields.findUnique({
        where: { id: fieldId },
        include: { field_type: { select: { id: true, has_options: true } } },
      });

      if (!existing || existing.asset_type_id !== assetTypeId) {
        throw { status: 404, message: 'Field not found for this asset type' };
      }

      let fieldTypeToUse = existing.field_type;
      if (field_type_id && field_type_id !== existing.field_type_id) {
        fieldTypeToUse = await tx.field_types.findUnique({
          where: { id: field_type_id },
          select: { id: true, has_options: true },
        });
        if (!fieldTypeToUse) throw { status: 400, message: 'Invalid field type' };
      }

      const validation = await validateFieldPayload(
        {
          name: name ?? existing.name,
          field_type_id: field_type_id ?? existing.field_type_id,
          options: options ?? existing.options,
          validation_rules: validation_rules ?? existing.validation_rules,
          is_required: is_required ?? existing.is_required,
          default_value: default_value ?? existing.default_value,
          display_order:
            display_order !== undefined
              ? Number(display_order)
              : existing.display_order,
        },
        fieldTypeToUse
      );
      if (!validation.valid)
        throw { status: 400, message: validation.errors.join(', ') };

      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (field_type_id !== undefined) updateData.field_type_id = field_type_id;
      if (description !== undefined) updateData.description = description;
      if (is_required !== undefined) updateData.is_required = is_required;
      if (default_value !== undefined) updateData.default_value = default_value;
      if (options !== undefined) updateData.options = options;
      if (validation_rules !== undefined) updateData.validation_rules = validation_rules;
      if (display_order !== undefined) updateData.display_order = Number(display_order);

      // Rename ⇒ ensure unique slug
      if (name && name !== existing.name) {
        const baseSlug = slugify(name);
        let newSlug = baseSlug;
        let i = 1;
        while (true) {
          const exists = await tx.asset_type_fields.findFirst({
            where: { asset_type_id: assetTypeId, slug: newSlug, NOT: { id: fieldId } },
            select: { id: true },
          });
          if (!exists) break;
          newSlug = `${baseSlug}-${i++}`;
        }
        updateData.slug = newSlug;
      }

      return tx.asset_type_fields.update({
        where: { id: fieldId },
        data: updateData,
        include: {
          field_type: { select: { id: true, name: true, slug: true, has_options: true } },
        },
      });
    });

    res.json(updated);
  } catch (err) {
    console.error('Update asset type field error:', err);
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === 'P2002') return res.status(409).json({ error: 'A field with this slug already exists' });
    if (err.code === 'P2003') return res.status(400).json({ error: 'Invalid foreign key' });
    res.status(500).json({ error: 'Failed to update asset type field' });
  }
};

exports.deleteField = async (req, res) => {
  const { assetTypeId, fieldId } = req.params;
  try {
    const field = await prisma.asset_type_fields.findUnique({
      where: { id: fieldId },
      include: { field_values: { select: { id: true } }, field_type: { select: { name: true } } },
    });

    if (!field) return res.status(404).json({ error: 'Field not found' });
    if (field.asset_type_id !== assetTypeId) {
      return res.status(404).json({ error: 'Field not found for this asset type' });
    }
    if (field.field_values?.length) {
      return res.status(400).json({
        error: 'Cannot delete field that has values assigned',
        details: { values_count: field.field_values.length, field_id: fieldId },
      });
    }

    await prisma.asset_type_fields.delete({ where: { id: fieldId } });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete asset type field error:', err);
    if (err.code === 'P2025') return res.status(404).json({ error: 'Field not found or already deleted' });
    res.status(500).json({ error: 'Failed to delete asset type field' });
  }
};
