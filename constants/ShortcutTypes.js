// constants/ShortcutTypes.js
// Defines all available shortcut types with metadata

export const SHORTCUT_TYPES = {
    QUICK_TRANSFER: {
        id: 'quick_transfer',
        label: 'Quick Transfer',
        icon: 'swap-horiz',
        description: 'Scan asset to transfer to another user',
        requiresAdmin: false,
        color: '#0B63CE',
        bgColor: '#E7F3FF',
    },
    QUICK_TRANSFER_IN: {
        id: 'quick_transfer_in',
        label: 'Quick Transfer Office',
        icon: 'login',
        description: 'Scan asset to transfer into admin inventory',
        requiresAdmin: false,
        color: '#16A34A',
        bgColor: '#DCFCE7',
    },
    QUICK_TRANSFER_OUT: {
        id: 'quick_transfer_out',
        label: 'Transfer-To Me',
        icon: 'logout',
        description: 'Scan asset to transfer out to yourself',
        requiresAdmin: false,
        color: '#B45309',
        bgColor: '#FFEDD5',
    },
    QUICK_SERVICE: {
        id: 'quick_service',
        label: 'Quick Service',
        icon: 'build',
        description: 'Scan asset to mark for service',
        requiresAdmin: false,
        color: '#854D0E',
        bgColor: '#FEF9C3',
    },
    QUICK_REPAIR: {
        id: 'quick_repair',
        label: 'Quick Repair',
        icon: 'build-circle',
        description: 'Scan asset to mark for repair',
        requiresAdmin: false,
        color: '#9A3412',
        bgColor: '#FFEDD5',
    },
    QUICK_VIEW: {
        id: 'quick_view',
        label: 'Quick View',
        icon: 'visibility',
        description: 'Scan asset to view details',
        requiresAdmin: false,
        color: '#5B21B6',
        bgColor: '#EDE9FE',
    },
    QUICK_NOTE: {
        id: 'quick_note',
        label: 'Quick Note',
        icon: 'note-add',
        description: 'Scan asset to add a quick note',
        requiresAdmin: false,
        color: '#0D9488',
        bgColor: '#CCFBF1',
    },
    GENERATE_QR_SHEET: {
        id: 'generate_qr_sheet',
        label: 'Generate QR Sheet',
        icon: 'qr-code-2',
        description: 'Generate 1 page of QR codes',
        requiresAdmin: true,
        color: '#DC2626',
        bgColor: '#FEE2E2',
    },
    HIRE_DISCLAIMER: {
        id: 'hire_disclaimer',
        label: 'Hire disclaimer',
        icon: 'description',
        description: 'Equipment hire lease form & export',
        requiresAdmin: false,
        webOnly: true,
        color: '#0D9488',
        bgColor: '#CCFBF1',
    },
};

// Helper to get shortcut type by ID
export const getShortcutType = (id) => {
    return Object.values(SHORTCUT_TYPES).find((type) => type.id === id);
};

// Get all available shortcut types for a user
export const getAvailableShortcutTypes = (isAdmin = false, webOnly = false) => {
    return Object.values(SHORTCUT_TYPES).filter((type) => {
        if (type.requiresAdmin && !isAdmin) {
            return false;
        }
        if (type.webOnly && !webOnly) {
            return false;
        }
        return true;
    });
};

// Validate if a shortcut type exists and user has permission
export const canUseShortcut = (shortcutId, isAdmin = false) => {
    const shortcut = getShortcutType(shortcutId);
    if (!shortcut) return false;
    if (shortcut.requiresAdmin && !isAdmin) return false;
    return true;
};

// 5 curated colour palettes for shortcut cards.
// Each palette is derived from the app's existing semantic colour system.
export const SHORTCUT_COLOR_PALETTES = [
    {
        key: 'blue',
        name: 'Ocean Blue',
        fg: '#0B63CE',
        bg: '#E7F3FF',
        border: '#BFDBFE',
    },
    {
        key: 'emerald',
        name: 'Emerald',
        fg: '#047857',
        bg: '#ECFDF5',
        border: '#A7F3D0',
    },
    {
        key: 'violet',
        name: 'Violet',
        fg: '#5B21B6',
        bg: '#EDE9FE',
        border: '#C4B5FD',
    },
    {
        key: 'amber',
        name: 'Amber',
        fg: '#B45309',
        bg: '#FFFBEB',
        border: '#FDE68A',
    },
    {
        key: 'rose',
        name: 'Rose',
        fg: '#BE123C',
        bg: '#FFF1F2',
        border: '#FECDD3',
    },
];

// Helper to resolve a palette by key (falls back to blue)
export const getShortcutPalette = (key) =>
    SHORTCUT_COLOR_PALETTES.find((p) => p.key === key) || SHORTCUT_COLOR_PALETTES[0];

// Default shortcuts for new users
export const DEFAULT_SHORTCUTS = [
    SHORTCUT_TYPES.QUICK_VIEW.id,
    SHORTCUT_TYPES.QUICK_TRANSFER.id,
    SHORTCUT_TYPES.QUICK_TRANSFER_IN.id,
    SHORTCUT_TYPES.QUICK_TRANSFER_OUT.id,
];
