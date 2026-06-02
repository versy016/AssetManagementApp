// components/AlertModal.js
// Lightweight, on-brand replacement for Alert.alert (which renders an ugly
// browser dialog on web). Shows a titled card with an icon and either a single
// message or a bulleted list of messages, plus a confirm button.

import React from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, Shadows, sf } from '../constants/uiTheme';

const TONES = {
  error: { icon: 'error-outline', fg: Colors.dangerFg, bg: Colors.dangerBg, border: '#FECACA' },
  warning: { icon: 'warning-amber', fg: '#B45309', bg: '#FFFBEB', border: '#FDE68A' },
  info: { icon: 'info-outline', fg: Colors.primary, bg: Colors.primaryLight, border: '#CBD5E1' },
  success: { icon: 'check-circle', fg: Colors.successFg, bg: Colors.successBg, border: '#99F6E4' },
};

export default function AlertModal({
  visible,
  title = 'Please check the form',
  message,
  items = [],
  tone = 'error',
  confirmLabel = 'Got it',
  onClose,
}) {
  const t = TONES[tone] || TONES.error;
  const list = Array.isArray(items) ? items.filter(Boolean) : [];

  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={s.card}>
          <View style={[s.iconWrap, { backgroundColor: t.bg, borderColor: t.border }]}>
            <MaterialIcons name={t.icon} size={26} color={t.fg} />
          </View>
          <Text style={s.title}>{title}</Text>

          {message ? <Text style={s.message}>{message}</Text> : null}

          {list.length > 0 ? (
            <ScrollView style={{ maxHeight: 220, width: '100%' }} contentContainerStyle={{ gap: 8 }}>
              {list.map((msg, i) => (
                <View key={i} style={s.bulletRow}>
                  <MaterialIcons name="chevron-right" size={16} color={t.fg} style={{ marginTop: 1 }} />
                  <Text style={s.bulletText}>{msg}</Text>
                </View>
              ))}
            </ScrollView>
          ) : null}

          <TouchableOpacity style={[s.confirmBtn, { backgroundColor: Colors.primary }]} onPress={onClose} activeOpacity={0.85}>
            <Text style={s.confirmText}>{confirmLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.line,
    padding: 20,
    alignItems: 'center',
    gap: 10,
    ...Shadows.card,
  },
  iconWrap: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: sf(18), fontWeight: '900', color: Colors.text, textAlign: 'center' },
  message: { fontSize: sf(14), color: Colors.sub, textAlign: 'center', lineHeight: sf(20) },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingHorizontal: 4 },
  bulletText: { flex: 1, fontSize: sf(14), color: Colors.text, lineHeight: sf(20), fontWeight: '600' },
  confirmBtn: { marginTop: 8, alignSelf: 'stretch', paddingVertical: 13, borderRadius: Radius.md, alignItems: 'center' },
  confirmText: { color: '#fff', fontWeight: '800', fontSize: sf(15) },
});
