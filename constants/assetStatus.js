/**
 * constants/assetStatus.js — Single source of truth for all asset status strings.
 *
 * Import in app files:
 *   import { ASSET_STATUS, ACTION_TYPE, ACTION_DB_TYPE } from '../../constants/assetStatus';
 *
 * These must exactly match the strings stored in the database and used by the API.
 * If a status string ever changes, update it here and nowhere else.
 */

// ─── Asset status values (stored in assets.status column) ────────────────────
export const ASSET_STATUS = Object.freeze({
  IN_SERVICE:       'In Service',
  ON_HIRE:          'On Hire',
  MAINTENANCE:      'Maintenance',
  REPAIR:           'Repair',
  END_OF_LIFE:      'End of Life',
});

// ─── Action type labels (shown in UI / sent in request bodies) ────────────────
export const ACTION_TYPE = Object.freeze({
  CHECK_IN:         'Transfer to office',
  CHECK_OUT:        'Transfer out of office',
  SERVICE:          'Service',
  REPAIR:           'Repair',
  HIRE:             'Hire',
  END_OF_LIFE:      'End of Life',
  TRANSFER:         'Transfer',
  LOST:             'Lost',
});

// ─── Action DB types (stored in asset_actions.type column) ───────────────────
export const ACTION_DB_TYPE = Object.freeze({
  CHECK_IN:         'CHECK_IN',
  CHECK_OUT:        'CHECK_OUT',
  SERVICE:          'SERVICE',
  REPAIR:           'REPAIR',
  HIRE:             'HIRE',
  END_OF_LIFE:      'END_OF_LIFE',
  TRANSFER:         'TRANSFER',
  LOST:             'LOST',
});

// ─── Statuses that represent an asset being actively used / available ─────────
export const ACTIVE_STATUSES = Object.freeze([
  ASSET_STATUS.IN_SERVICE,
]);

// ─── Statuses that mean the asset is out of normal circulation ────────────────
export const INACTIVE_STATUSES = Object.freeze([
  ASSET_STATUS.END_OF_LIFE,
]);

// ─── All valid statuses as an array (useful for dropdowns / validation) ───────
export const ALL_STATUSES = Object.freeze(Object.values(ASSET_STATUS));
