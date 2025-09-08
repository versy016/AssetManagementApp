// inventory-api/routes/assetTypeFields.js
const express = require('express');
const router = express.Router({ mergeParams: true });
const { body } = require('express-validator');

const {
  listFields,
  createField,
  updateField,
  deleteField,
} = require('../controllers/assetTypeFields.controller.js');

// GET /:assetTypeId/fields
router.get('/:assetTypeId/fields', listFields);

// POST /:assetTypeId/fields
router.post(
  '/:assetTypeId/fields',
  [
    body('name').trim().notEmpty().withMessage('Field name is required'),
    body('field_type_id').isUUID().withMessage('Valid field type ID is required'),
    body('is_required').optional().isBoolean(),
    body('display_order').optional().isInt({ min: 0 }),
  ],
  createField
);

// PUT /:assetTypeId/fields/:fieldId
router.put(
  '/:assetTypeId/fields/:fieldId',
  [
    body('name').optional().trim().notEmpty().withMessage('Field name cannot be empty'),
    body('field_type_id').optional().isUUID().withMessage('Valid field type ID is required'),
    body('is_required').optional().isBoolean(),
    body('display_order').optional().isInt({ min: 0 }),
  ],
  updateField
);

// DELETE /:assetTypeId/fields/:fieldId
router.delete('/:assetTypeId/fields/:fieldId', deleteField);

module.exports = router;
