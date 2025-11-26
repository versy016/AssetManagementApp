// utils/ShortcutExecutor.js
// Handles shortcut execution logic after QR scan

import { API_BASE_URL } from '../inventory-api/apiBase';
import { SHORTCUT_TYPES } from '../constants/ShortcutTypes';
import { captureLastScannedLocation } from './location';

/**
 * Execute a shortcut by navigating to QR scanner with context
 * @param {string} shortcutType - Shortcut type ID
 * @param {object} router - Expo router instance
 * @param {object} user - Current user object
 */
export const executeShortcut = (shortcutType, router, user) => {
    // Special case: Generate QR Sheet doesn't need scanning
    if (shortcutType === SHORTCUT_TYPES.GENERATE_QR_SHEET.id) {
        router.push('/admin?tab=qr');
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
    returnTarget = '/(tabs)/dashboard'
) => {
    try {
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

            case SHORTCUT_TYPES.QUICK_TRANSFER.id:
                await handleQuickTransfer(assetId, assetData, router, user, onSuccess, onError, returnTarget);
                break;

            case SHORTCUT_TYPES.QUICK_SERVICE.id:
                await handleQuickService(assetId, assetData, router, user, onSuccess, onError, returnTarget);
                break;

            case SHORTCUT_TYPES.QUICK_REPAIR.id:
                await handleQuickRepair(assetId, assetData, router, user, onSuccess, onError, returnTarget);
                break;

            default:
                onError?.('Unknown shortcut type');
        }
    } catch (error) {
        console.error('[ShortcutExecutor] Error processing asset:', error);
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

const findFirstAdminUser = async (token) => {
    try {
        const res = await fetch(`${API_BASE_URL}/users`, {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) throw new Error('Failed to fetch users');
        const users = await res.json();
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
            )
        );
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
                throw new Error('Asset already assigned to admin');
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

        const assetName = assetData?.id || assetId;
        const adminLabel = adminUser.useremail || adminUser.name || 'admin';
        onSuccess?.(`✓ ${assetName} transferred to ${adminLabel}`);
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

        const assetName = assetData?.id || assetId;
        onSuccess?.(`✓ ${assetName} assigned to you`);
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
    onSuccess?.('Select a user to transfer this asset');
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

export default {
    executeShortcut,
    processScannedAsset,
};
