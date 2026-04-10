import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

/**
 * Canonical asset status configuration and helpers.
 * Import STATUS_CONFIG and normalizeStatus wherever you need to
 * display or filter by asset status — avoids duplicating these
 * across Inventory, type detail, search, and asset detail screens.
 */
export const STATUS_CONFIG = {
  in_service: {
    label: 'In Service',
    bg: '#E7F3FF',
    fg: '#084AA0',
    bd: '#D6E8FF',
    icon: 'build-circle',
  },
  end_of_life: {
    label: 'End of Life',
    bg: '#EDE9FE',
    fg: '#5B21B6',
    bd: '#E3D9FF',
    icon: 'block',
  },
  repair: {
    label: 'Repair',
    bg: '#FFEDD5',
    fg: '#9A3412',
    bd: '#FFD9B5',
    icon: 'build',
  },
  maintenance: {
    label: 'Maintenance',
    bg: '#FEF9C3',
    fg: '#854D0E',
    bd: '#FFF3B0',
    icon: 'build',
  },
  on_hire: {
    label: 'On Hire',
    bg: '#ECFDF5',
    fg: '#065F46',
    bd: '#A7F3D0',
    icon: 'assignment',
  },
};

const STATUS_ALIASES = {
  in_service: 'in_service',
  active: 'in_service',
  available: 'in_service',
  operational: 'in_service',
  end_of_life: 'end_of_life',
  eol: 'end_of_life',
  decommissioned: 'end_of_life',
  disposed: 'end_of_life',
  lost: 'end_of_life',
  retired: 'end_of_life',
  repair: 'repair',
  in_repair: 'repair',
  maintenance: 'maintenance',
  in_maintenance: 'maintenance',
  on_hire: 'on_hire',
  hire: 'on_hire',
  rented: 'on_hire',
  on_rent: 'on_hire',
};

/** Normalise any raw status string to a STATUS_CONFIG key. */
export function normalizeStatus(s) {
  if (!s) return 'in_service';
  const key = String(s).toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
  return STATUS_ALIASES[key] || 'in_service';
}

/** Human-readable label for any raw status. */
export function prettyStatus(s) {
  return STATUS_CONFIG[normalizeStatus(s)]?.label ?? '—';
}

/** Full config object for a raw status. */
export function statusToColor(s) {
  return STATUS_CONFIG[normalizeStatus(s)] ?? STATUS_CONFIG.in_service;
}

/**
 * Pill badge showing asset status.
 *
 * Props:
 *  status  – raw status string (normalised internally)
 *  size    – icon size (default 14)
 *  style   – additional style for the outer View
 */
export default function StatusBadge({ status, size = 14, style }) {
  const cfg = STATUS_CONFIG[normalizeStatus(status)] || STATUS_CONFIG.in_service;
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg, borderColor: cfg.bd || cfg.bg }, style]}>
      <MaterialIcons name={cfg.icon} size={size} color={cfg.fg} style={styles.icon} />
      <Text style={[styles.label, { color: cfg.fg }]}>{cfg.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  icon: { marginRight: 4 },
  label: { fontSize: 12, fontWeight: '600' },
});
