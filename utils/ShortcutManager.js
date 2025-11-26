// utils/ShortcutManager.js
// Manages user shortcuts with AsyncStorage persistence

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_SHORTCUTS, getShortcutType, canUseShortcut } from '../constants/ShortcutTypes';

const STORAGE_KEY_PREFIX = 'shortcuts_';
const MAX_SHORTCUTS = 6;

/**
 * Get storage key for a user
 */
const getStorageKey = (userId) => {
    return `${STORAGE_KEY_PREFIX}${userId}`;
};

/**
 * Load shortcuts for a user
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Array of shortcut objects
 */
export const loadShortcuts = async (userId, isAdmin = false) => {
    try {
        if (!userId) {
            console.warn('[ShortcutManager] No userId provided');
            return getDefaultShortcuts(isAdmin);
        }

        const key = getStorageKey(userId);
        const data = await AsyncStorage.getItem(key);

        if (!data) {
            // First time user - return defaults
            const defaults = getDefaultShortcuts(isAdmin);
            await saveShortcuts(userId, defaults);
            return defaults;
        }

        const parsed = JSON.parse(data);
        const shortcuts = parsed.shortcuts || [];

        // Validate and filter shortcuts
        return shortcuts.filter((shortcut) => {
            const type = getShortcutType(shortcut.type);
            return type !== undefined;
        });
    } catch (error) {
        console.error('[ShortcutManager] Error loading shortcuts:', error);
        return getDefaultShortcuts(isAdmin);
    }
};

/**
 * Save shortcuts for a user
 * @param {string} userId - User ID
 * @param {Array} shortcuts - Array of shortcut objects
 * @returns {Promise<boolean>} Success status
 */
export const saveShortcuts = async (userId, shortcuts) => {
    try {
        if (!userId) {
            console.warn('[ShortcutManager] No userId provided');
            return false;
        }

        const key = getStorageKey(userId);
        const data = {
            shortcuts: shortcuts.slice(0, MAX_SHORTCUTS), // Enforce max limit
            updatedAt: new Date().toISOString(),
        };

        await AsyncStorage.setItem(key, JSON.stringify(data));
        return true;
    } catch (error) {
        console.error('[ShortcutManager] Error saving shortcuts:', error);
        return false;
    }
};

/**
 * Add a shortcut for a user
 * @param {string} userId - User ID
 * @param {string} shortcutType - Shortcut type ID
 * @param {boolean} isAdmin - Whether user is admin
 * @returns {Promise<boolean>} Success status
 */
export const addShortcut = async (userId, shortcutType, isAdmin = false) => {
    try {
        // Validate permission
        if (!canUseShortcut(shortcutType, isAdmin)) {
            console.warn('[ShortcutManager] User does not have permission for this shortcut');
            return false;
        }

        const shortcuts = await loadShortcuts(userId);

        // Check if already exists
        if (shortcuts.some((s) => s.type === shortcutType)) {
            console.warn('[ShortcutManager] Shortcut already exists');
            return false;
        }

        // Check max limit
        if (shortcuts.length >= MAX_SHORTCUTS) {
            console.warn('[ShortcutManager] Maximum shortcuts reached');
            return false;
        }

        // Add new shortcut
        const newShortcut = {
            id: `${shortcutType}_${Date.now()}`,
            type: shortcutType,
            addedAt: new Date().toISOString(),
            order: shortcuts.length,
        };

        shortcuts.push(newShortcut);
        return await saveShortcuts(userId, shortcuts);
    } catch (error) {
        console.error('[ShortcutManager] Error adding shortcut:', error);
        return false;
    }
};

/**
 * Remove a shortcut for a user
 * @param {string} userId - User ID
 * @param {string} shortcutId - Shortcut ID to remove
 * @returns {Promise<boolean>} Success status
 */
export const removeShortcut = async (userId, shortcutId) => {
    try {
        const shortcuts = await loadShortcuts(userId);
        const filtered = shortcuts.filter((s) => s.id !== shortcutId);

        // Reorder remaining shortcuts
        const reordered = filtered.map((s, index) => ({
            ...s,
            order: index,
        }));

        return await saveShortcuts(userId, reordered);
    } catch (error) {
        console.error('[ShortcutManager] Error removing shortcut:', error);
        return false;
    }
};

/**
 * Reorder shortcuts for a user
 * @param {string} userId - User ID
 * @param {Array} shortcuts - Reordered array of shortcuts
 * @returns {Promise<boolean>} Success status
 */
export const reorderShortcuts = async (userId, shortcuts) => {
    try {
        const reordered = shortcuts.map((s, index) => ({
            ...s,
            order: index,
        }));

        return await saveShortcuts(userId, reordered);
    } catch (error) {
        console.error('[ShortcutManager] Error reordering shortcuts:', error);
        return false;
    }
};

/**
 * Get default shortcuts
 * @returns {Array} Array of default shortcut objects
 */
export const getDefaultShortcuts = (isAdmin = false) => {
    const baseTypes = [...DEFAULT_SHORTCUTS];
    return baseTypes.map((type, index) => ({
        id: `${type}_default_${index}`,
        type,
        addedAt: new Date().toISOString(),
        order: index,
    }));
};

/**
 * Clear all shortcuts for a user
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} Success status
 */
export const clearShortcuts = async (userId) => {
    try {
        if (!userId) return false;
        const key = getStorageKey(userId);
        await AsyncStorage.removeItem(key);
        return true;
    } catch (error) {
        console.error('[ShortcutManager] Error clearing shortcuts:', error);
        return false;
    }
};

/**
 * Check if user can add more shortcuts
 * @param {Array} shortcuts - Current shortcuts
 * @returns {boolean} Whether user can add more
 */
export const canAddMoreShortcuts = (shortcuts) => {
    return shortcuts.length < MAX_SHORTCUTS;
};

export default {
    loadShortcuts,
    saveShortcuts,
    addShortcut,
    removeShortcut,
    reorderShortcuts,
    getDefaultShortcuts,
    clearShortcuts,
    canAddMoreShortcuts,
    MAX_SHORTCUTS,
};
