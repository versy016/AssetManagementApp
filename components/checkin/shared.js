// components/checkin/shared.js
// Shared mini-components and helpers used across check-in sub-components.

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Radius, sf } from '../../constants/uiTheme';

// ── Status badge colour ──────────────────────────────────────────────────────

export const badgeTone = (status) => {
  const s = String(status || '').toLowerCase();
  if (s.includes('repair'))       return { bg: Colors.warningBg,  fg: Colors.warningFg  };
  if (s.includes('maintenance'))  return { bg: Colors.infoBg,     fg: Colors.infoFg     };
  if (s.includes('end of life'))  return { bg: Colors.dangerBg,   fg: Colors.dangerFg   };
  if (s.includes('in service'))   return { bg: Colors.successBg,  fg: Colors.successFg  };
  return { bg: Colors.chip, fg: Colors.sub };
};

// ── Status chip ──────────────────────────────────────────────────────────────

export function Chip({ label, tone }) {
  return (
    <View style={[sharedStyles.chip, { backgroundColor: tone?.bg, borderColor: Colors.line }]}>
      <Text style={[sharedStyles.chipText, { color: tone?.fg }]}>{label}</Text>
    </View>
  );
}

// ── Avatar initials circle ───────────────────────────────────────────────────

export function AvatarCircle({ name, email }) {
  const initials = useMemo(() => {
    const source = name || email || '?';
    const matches = source
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((x) => x[0]?.toUpperCase())
      .join('');
    return matches || '?';
  }, [name, email]);

  return (
    <View style={sharedStyles.avatar}>
      <Text style={{ color: Colors.text, fontWeight: '700' }}>{initials}</Text>
    </View>
  );
}

// ── Shared styles used by multiple sub-components ────────────────────────────

export const sharedStyles = StyleSheet.create({
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: sf(12), fontWeight: '800', letterSpacing: 0.4 },

  avatar: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    backgroundColor: Colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.line,
  },

  // Sheet / modal chrome
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    maxHeight: '80%',
  },
  sheetHandle: {
    width: 44,
    height: 5,
    backgroundColor: Colors.border,
    borderRadius: 999,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  modalTitle: { color: Colors.text, fontSize: sf(16), fontWeight: '800' },

  // Inputs
  input: {
    borderWidth: 2,
    borderColor: Colors.line,
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: Colors.text,
  },

  // Buttons
  btnPrimary: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingVertical: 10, paddingHorizontal: 14,
  },
  btnPrimaryText: { color: '#fff', fontWeight: '800' },
  btnGhost: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.md,
    paddingVertical: 10, paddingHorizontal: 14,
  },
  btnGhostText: { color: Colors.primary, fontWeight: '800' },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 8 },

  // Option card (used in swap/assign sheets)
  optionCard: {
    backgroundColor: Colors.card,
    borderWidth: 2,
    borderColor: Colors.line,
    borderRadius: Radius.lg,
    padding: 14,
  },
  optionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  optionTitle: { color: Colors.text, fontWeight: '800', fontSize: sf(14) },
  optionDesc: { color: Colors.subtle, marginBottom: 8 },
  fieldLabel: { color: Colors.subtle, fontSize: sf(12), marginTop: 6, marginBottom: 4, letterSpacing: 0.3 },
  fieldHint: { color: Colors.subtle, fontSize: sf(12), marginTop: 6 },
});
