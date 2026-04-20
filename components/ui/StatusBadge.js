// components/ui/StatusBadge.js — Bold Industrial Status Badges
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Radius, sf } from '../../constants/uiTheme';

/**
 * Canonical asset status configuration — Bold Industrial palette.
 * Squared-off badges with uppercase text and thick borders.
 */
export const STATUS_CONFIG = {
  in_service: {
    label: 'In Service',
    bg: '#F0FDFA',
    fg: '#0D9488',
    bd: '#99F6E4',
    icon: 'build-circle',
  },
  end_of_life: {
    label: 'End of Life',
    bg: '#F5F5F4',
    fg: '#78716C',
    bd: '#D6D3D1',
    icon: 'block',
  },
  repair: {
    label: 'Repair',
    bg: '#FEF2F2',
    fg: '#DC2626',
    bd: '#FECACA',
    icon: 'build',
  },
  maintenance: {
    label: 'Maintenance',
    bg: '#FFFBEB',
    fg: '#D97706',
    bd: '#FDE68A',
    icon: 'build',
  },
  on_hire: {
    label: 'On Hire',
    bg: '#EEF2FF',
    fg: '#4F46E5',
    bd: '#C7D2FE',
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
 * Bold Industrial status badge — squared corners, uppercase text, thick border.
 *
 * Props:
 *  status  – raw status string (normalised internally)
 *  size    – 'sm' | 'md' (default 'md')
 *  style   – additional style for the outer View
 */
export default function StatusBadge({ status, size = 'md', style }) {
  const cfg = STATUS_CONFIG[normalizeStatus(status)] || STATUS_CONFIG.in_service;
  const isSmall = size === 'sm' || (typeof size === 'number' && size < 14);

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: cfg.bg, borderColor: cfg.bd || cfg.bg },
        isSmall && styles.badgeSm,
        style,
      ]}
    >
      <Text
        style={[
          styles.label,
          { color: cfg.fg },
          isSmall && styles.labelSm,
        ]}
        numberOfLines={1}
      >
        {cfg.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    alignSelf: 'flex-start',
  },
  badgeSm: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
  },
  label: {
    fontSize: sf(11),
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  labelSm: {
    fontSize: sf(10),
  },
});
