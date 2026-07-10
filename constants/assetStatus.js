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

// ─── Base lifecycle statuses (mutually exclusive) ─────────────────────────────
// Needs Repair / Maintenance Due are NOT base statuses — they are overlay flags
// (assets.needs_repair / assets.maintenance_due) that can be true alongside any
// base status and each other. Manual status pickers offer only these three.
export const BASE_STATUSES = Object.freeze([
  ASSET_STATUS.IN_SERVICE,
  ASSET_STATUS.ON_HIRE,
  ASSET_STATUS.END_OF_LIFE,
]);

const BASE_KEY_BY_STATUS = {
  in_service: 'in_service',
  on_hire: 'on_hire',
  end_of_life: 'end_of_life',
};

/** Base STATUS_CONFIG key for a raw status string (legacy Repair/Maintenance → in_service). */
export function baseStatusKey(status) {
  const s = String(status || '').toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_').trim();
  return BASE_KEY_BY_STATUS[s] || 'in_service';
}

/** Overlay flags for an asset, tolerant of legacy rows whose status IS Repair/Maintenance. */
export function assetFlags(asset) {
  const s = String(asset?.status || '').toLowerCase().trim();
  return {
    needs_repair: !!asset?.needs_repair || s === 'repair',
    maintenance_due: !!asset?.maintenance_due || s === 'maintenance',
  };
}

/** Map any raw filter value ('Repair', 'Maintenance', 'In Service', config keys…) to a STATUS_CONFIG key. */
export function statusFilterKey(v) {
  if (!v) return null;
  const s = String(v).toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_').trim();
  if (s === 'repair' || s === 'needs_repair') return 'repair';
  if (s === 'maintenance' || s === 'maintenance_due') return 'maintenance';
  if (s === 'in_service') return 'in_service';
  if (s === 'on_hire') return 'on_hire';
  if (s === 'end_of_life') return 'end_of_life';
  return null;
}

/** Does an asset satisfy a status filter identified by STATUS_CONFIG key? Flags for repair/maintenance, base otherwise. */
export function assetHasStatusKey(asset, key) {
  if (!key) return true;
  const f = assetFlags(asset);
  if (key === 'repair') return f.needs_repair;
  if (key === 'maintenance') return f.maintenance_due;
  return baseStatusKey(asset?.status) === key;
}
