/**
 * inventory-api/lib/assetStatus.js — Single source of truth for asset status strings (CJS).
 *
 * Import in API files:
 *   const { ASSET_STATUS, ACTION_DB_TYPE, ACTIVE_STATUSES } = require('../lib/assetStatus');
 *
 * Keep in sync with constants/assetStatus.js in the app.
 */
'use strict';

const ASSET_STATUS = Object.freeze({
  IN_SERVICE:  'In Service',
  AVAILABLE:   'Available',
  ON_HIRE:     'On Hire',
  MAINTENANCE: 'Maintenance',
  REPAIR:      'Repair',
  END_OF_LIFE: 'End of Life',
  LOST:        'Lost',
});

const ACTION_DB_TYPE = Object.freeze({
  CHECK_IN:    'CHECK_IN',
  CHECK_OUT:   'CHECK_OUT',
  SERVICE:     'SERVICE',
  REPAIR:      'REPAIR',
  HIRE:        'HIRE',
  END_OF_LIFE: 'END_OF_LIFE',
  TRANSFER:    'TRANSFER',
  LOST:        'LOST',
});

const ACTIVE_STATUSES   = Object.freeze([ASSET_STATUS.IN_SERVICE, ASSET_STATUS.AVAILABLE]);
const INACTIVE_STATUSES = Object.freeze([ASSET_STATUS.END_OF_LIFE, ASSET_STATUS.LOST]);
const ALL_STATUSES      = Object.freeze(Object.values(ASSET_STATUS));

// Allowed statuses for PATCH /assets/:id (keeps assets.js routes clean)
const ALLOWED_PATCH_STATUSES = Object.freeze(new Set([
  ASSET_STATUS.IN_SERVICE,
  ASSET_STATUS.END_OF_LIFE,
  ASSET_STATUS.REPAIR,
  ASSET_STATUS.MAINTENANCE,
  ASSET_STATUS.ON_HIRE,
]));

module.exports = {
  ASSET_STATUS,
  ACTION_DB_TYPE,
  ACTIVE_STATUSES,
  INACTIVE_STATUSES,
  ALL_STATUSES,
  ALLOWED_PATCH_STATUSES,
};
