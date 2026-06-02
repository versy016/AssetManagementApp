// utils/validateCustomField.js
// Shared validation for adding/editing a custom field on an asset type.
// Mirrors the backend slug rules so client-side checks match what the API
// (inventory-api/routes/assets.js) will accept — catching problems (duplicate
// slug, missing options) before the network round-trip.

// Same transform the backend uses for asset_type_fields.slug.
export function slugifyFieldName(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

const FIELD_NAME_MAX = 50;

/**
 * Validate one custom field definition.
 *
 * @param {object} opts
 * @param {string}  opts.name           Field name as typed.
 * @param {boolean} opts.hasFieldType   Whether a field type has been selected.
 * @param {boolean} [opts.hasOptions]   Whether the chosen field type needs options (select/multiselect).
 * @param {string}  [opts.optionsCsv]   Comma-separated options string.
 * @param {string[]} [opts.existingSlugs] Slugs already used on this type (defaults, presets, other custom fields).
 * @returns {string[]} Human-readable error messages (empty = valid).
 */
export function validateCustomField({ name, hasFieldType, hasOptions = false, optionsCsv = '', existingSlugs = [] }) {
  const errors = [];
  const trimmed = String(name || '').trim();

  if (!trimmed) {
    errors.push('Enter a field name.');
  } else if (trimmed.length > FIELD_NAME_MAX) {
    errors.push(`Field name must be ${FIELD_NAME_MAX} characters or fewer.`);
  }

  if (!hasFieldType) {
    errors.push('Choose a field type.');
  }

  const slug = slugifyFieldName(trimmed);
  if (trimmed && !slug) {
    errors.push('Field name must include at least one letter or number.');
  }

  if (slug && Array.isArray(existingSlugs) && existingSlugs.includes(slug)) {
    errors.push(`A field named “${trimmed}” already exists on this type. Pick a different name.`);
  }

  if (hasOptions) {
    const opts = String(optionsCsv || '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    if (opts.length < 2) {
      errors.push('Add at least two comma-separated options (e.g. “Low, High”).');
    } else {
      const lower = opts.map((o) => o.toLowerCase());
      if (new Set(lower).size !== lower.length) {
        errors.push('Options must be unique — remove the duplicate(s).');
      }
    }
  }

  return errors;
}
