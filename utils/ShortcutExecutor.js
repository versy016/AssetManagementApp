// utils/ShortcutExecutor.js
// Handles shortcut execution logic after QR scan

import { API_BASE_URL } from '../inventory-api/apiBase';
import { SHORTCUT_TYPES, canUseShortcut } from '../constants/ShortcutTypes';
import { captureLastScannedLocation } from './location';
import logger from './logger';

/**
 * Execute a shortcut by navigating to QR scanner with context
 * @param {string} shortcutType - Shortcut type ID
 * @param {object} router - Expo router instance
 * @param {object} user - Current user object
 */
export const executeShortcut = (shortcutType, router, user, isAdmin = false) => {
    if (!canUseShortcut(shortcutType, isAdmin)) {
        return;
    }
    // Special case: Generate QR Sheet doesn't need scanning
    if (shortcutType === SHORTCUT_TYPES.GENERATE_QR_SHEET.id) {
        router.push('/admin/qr');
        return;
    }
    // Hire disclaimer: go to form (no scan)
    if (shortcutType === SHORTCUT_TYPES.HIRE_DISCLAIMER.id) {
        router.push('/hire');
        return;
    }
    // Office Gear: show all assets assigned to the office (no scan)
    if (shortcutType === SHORTCUT_TYPES.OFFICE_ASSETS.id) {
        router.push({ pathname: '/search', params: { preset: 'office' } });
        return;
    }

    // Navigate to QR scanner with shortcut context
    router.push({
        pathname: '/qr-scanner',
        params: {
            shortcutType,
            returnTo: '/(tabs)/dashboard',
        },
    });
};

/**
 * Process scanned asset based on shortcut type
 * @param {string} shortcutType - Shortcut type ID
 * @param {string} assetId - Scanned asset ID
 * @param {object} assetData - Asset data from API
 * @param {object} router - Expo router instance
 * @param {object} user - Current user object
 * @param {function} onSuccess - Success callback
 * @param {function} onError - Error callback
 */
export const processScannedAsset = async (
    shortcutType,
    assetId,
    assetData,
    router,
    user,
    onSuccess,
    onError,
    returnTarget = '/(tabs)/dashboard',
    isAdmin = false
) => {
    try {
        if (!canUseShortcut(shortcutType, isAdmin)) {
            onError?.('This shortcut requires an administrator account.');
            return;
        }
        switch (shortcutType) {
            case SHORTCUT_TYPES.QUICK_VIEW.id:
                await handleQuickView(assetId, router, onSuccess);
                break;

            case SHORTCUT_TYPES.QUICK_TRANSFER.id:
                await handleQuickTransfer(assetId, assetData, router, user, onSuccess, onError, returnTarget);
                break;
            case SHORTCUT_TYPES.QUICK_TRANSFER_IN.id:
                await handleQuickTransferIn(assetId, assetData, user, onSuccess, onError);
                break;

            case SHORTCUT_TYPES.QUICK_TRANSFER_OUT.id:
                await handleQuickTransferOut(assetId, assetData, user, onSuccess, onError);
                break;

            case SHORTCUT_TYPES.QUICK_SERVICE.id:
                await handleQuickService(assetId, assetData, router, user, onSuccess, onError, returnTarget);
                break;

            case SHORTCUT_TYPES.QUICK_REPAIR.id:
                await handleQuickRepair(assetId, assetData, router, user, onSuccess, onError, returnTarget);
                break;

            case SHORTCUT_TYPES.QUICK_NOTE.id:
                await handleQuickNote(assetId, assetData, router, user, onSuccess, onError, returnTarget);
                break;

            default:
                onError?.('Unknown shortcut type');
        }
    } catch (error) {
        logger.error('[ShortcutExecutor] Error processing asset:', error);
        onError?.(error.message || 'Failed to process shortcut');
    }
};

/**
 * Quick View - Navigate to asset detail
 */
const handleQuickView = async (assetId, router, onSuccess) => {
    router.push(`/asset/${assetId}`);
    onSuccess?.('Opening asset details...');
};

/**
 * User row that holds "office inventory" (transfer-in target, Office Gear filter).
 * Prefer admin@*, then any ADMIN with email, then a user whose name contains "office".
 * Do not use "first ADMIN in API order" — that often matches the logged-in admin incorrectly.
 */
export function pickOfficeInventoryAssignee(users) {
    if (!Array.isArray(users)) return null;
    return (
        users.find((u) => {
            const email = String(u?.useremail || u?.email || '').toLowerCase();
            return email.startsWith('admin@');
        }) ||
        users.find(
            (u) =>
                String(u?.role || '').toUpperCase() === 'ADMIN' &&
                (u?.useremail || u?.email)
        ) ||
        users.find((u) => String(u?.name || '').toLowerCase().includes('office')) ||
        null
    );
}

const findFirstAdminUser = async (token) => {
    try {
        const res = await fetch(`${API_BASE_URL}/users`, {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) throw new Error('Failed to fetch users');
        const users = await res.json();
        if (!Array.isArray(users)) return null;
        return pickOfficeInventoryAssignee(users);
    } catch (e) {
        console.error('[ShortcutExecutor] admin lookup failed', e);
        return null;
    }
};

/**
 * Quick Transfer-In - assign asset to admin account
 */
const handleQuickTransferIn = async (assetId, assetData, user, onSuccess, onError) => {
    try {
        const token = await user.getIdToken();
        const adminUser = await findFirstAdminUser(token);
        if (!adminUser) {
            throw new Error('No admin user found to receive transfer');
        }

        if (assetData?.assigned_to_id) {
            const currentAssignee = String(assetData.assigned_to_id);
            if (currentAssignee === adminUser.id) {
                throw new Error('Asset already assigned to office');
            }
        }

        const location = await captureLastScannedLocation();
        const payload = {
            assigned_to_id: adminUser.id,
            status: 'In Service',
        };
        if (location) {
            payload.location = location;
        }
        const response = await fetch(`${API_BASE_URL}/assets/${assetId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error('Failed to transfer asset in');
        }

        await fetch(`${API_BASE_URL}/assets/${assetId}/actions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                type: 'TRANSFER',
                note: 'Quick transfer-in via shortcut',
                performed_by: user.uid,
                from_user_id: user.uid,
                to_user_id: adminUser.id,
            }),
        });

        const id = assetData?.id || assetId;
        const sn = assetData?.serial_number;
        const type = assetData?.asset_type || assetData?.type || assetData?.asset_types?.name;
        const adminLabel = adminUser.name || adminUser.useremail || 'admin';
        const parts = [id, sn, type].filter(Boolean);
        onSuccess?.(`✓ Transferred in — ${parts.join(' · ')} → ${adminLabel}`);
    } catch (error) {
        onError?.(error.message || 'Failed to transfer in');
    }
};

/**
 * Quick Transfer-Out - assign asset to current user
 */
const handleQuickTransferOut = async (assetId, assetData, user, onSuccess, onError) => {
    try {
        const token = await user.getIdToken();

        if (assetData?.assigned_to_id && String(assetData.assigned_to_id) === user.uid) {
            throw new Error('Asset already assigned to you');
        }

        const location = await captureLastScannedLocation();
        const payload = {
            assigned_to_id: user.uid,
        };
        if (location) {
            payload.location = location;
        }
        const response = await fetch(`${API_BASE_URL}/assets/${assetId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error('Failed to transfer asset out');
        }

        await fetch(`${API_BASE_URL}/assets/${assetId}/actions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                type: 'TRANSFER',
                note: 'Quick transfer-out via shortcut',
                performed_by: user.uid,
                from_user_id: user.uid,
                to_user_id: user.uid,
            }),
        });

        const id = assetData?.id || assetId;
        const sn = assetData?.serial_number;
        const type = assetData?.asset_type || assetData?.type || assetData?.asset_types?.name;
        const parts = [id, sn, type].filter(Boolean);
        onSuccess?.(`✓ Transferred out — ${parts.join(' · ')} → you`);
    } catch (error) {
        onError?.(error.message || 'Failed to transfer out');
    }
};

/**
 * Quick Transfer - Navigate to asset detail with transfer action
 */
const handleQuickTransfer = async (assetId, assetData, router, user, onSuccess, onError, returnTarget = '/(tabs)/dashboard') => {
    router.push({
        pathname: '/transfer/[assetId]',
        params: {
            assetId: String(assetId),
            shortcut: 'true',
            returnTo: returnTarget,
        },
    });
    const id = assetData?.id || assetId;
    const sn = assetData?.serial_number;
    const type = assetData?.asset_type || assetData?.type || assetData?.asset_types?.name;
    const parts = [id, sn, type].filter(Boolean);
    onSuccess?.(`Select a user — ${parts.join(' · ')}`);
};

/**
 * Quick Service - Mark asset for service
 */
const handleQuickService = async (assetId, assetData, router, user, onSuccess, onError, returnTarget = '/(tabs)/dashboard') => {
    router.push({
        pathname: '/quick-action/[assetId]',
        params: {
            assetId: String(assetId),
            action: 'maintenance',
            returnTo: returnTarget,
        },
    });
    onSuccess?.('Log the service details');
};

/**
 * Quick Repair - Mark asset for repair
 */
const handleQuickRepair = async (assetId, assetData, router, user, onSuccess, onError, returnTarget = '/(tabs)/dashboard') => {
    router.push({
        pathname: '/quick-action/[assetId]',
        params: {
            assetId: String(assetId),
            action: 'repair',
            returnTo: returnTarget,
        },
    });
    onSuccess?.('Log the repair details');
};

/**
 * Quick Note - Add a note to an asset
 */
const handleQuickNote = async (assetId, assetData, router, user, onSuccess, onError, returnTarget = '/(tabs)/dashboard') => {
    router.push({
        pathname: '/quick-note/[assetId]',
        params: {
            assetId: String(assetId),
            returnTo: returnTarget,
        },
    });
    onSuccess?.('Add your note');
};

export default {
    executeShortcut,
    processScannedAsset,
};
