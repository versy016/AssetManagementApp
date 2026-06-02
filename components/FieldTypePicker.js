// components/FieldTypePicker.js
// On-brand replacement for the react-native-dropdown-picker MODAL used to pick
// a custom field's type. Renders a styled trigger + a themed modal with
// icon/label/description rows, instead of the library's bare full-screen list.

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  Platform,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, Shadows, sf } from '../constants/uiTheme';

// Per field-type metadata (icon + one-line description), keyed by field_types.slug.
// Falls back to a neutral icon for any unknown slug.
const TYPE_META = {
  text: { icon: 'short-text', desc: 'Single line of text' },
  textarea: { icon: 'notes', desc: 'Multiple lines of text' },
  email: { icon: 'alternate-email', desc: 'Email address' },
  number: { icon: 'pin', desc: 'Numeric value' },
  currency: { icon: 'attach-money', desc: 'Money amount' },
  select: { icon: 'arrow-drop-down-circle', desc: 'Pick one from a list' },
  multiselect: { icon: 'checklist', desc: 'Pick several from a list' },
  date: { icon: 'event', desc: 'Calendar date' },
  datetime: { icon: 'schedule', desc: 'Date and time' },
  boolean: { icon: 'toggle-on', desc: 'Yes / no toggle' },
  url: { icon: 'description', desc: 'File / document upload' },
};
const metaForSlug = (slug) => TYPE_META[String(slug || '').toLowerCase()] || { icon: 'label', desc: 'Custom field' };

export default function FieldTypePicker({ value, items = [], onChange, placeholder = 'Select a field type', disabled = false }) {
  const [open, setOpen] = useState(false);
  const { width } = useWindowDimensions();
  const isWebWide = Platform.OS === 'web' && (width || 0) >= 640;

  const selected = useMemo(() => items.find((it) => it.value === value) || null, [items, value]);

  const close = () => setOpen(false);
  const pick = (val) => { onChange?.(val); close(); };

  return (
    <>
      {/* Trigger */}
      <TouchableOpacity
        style={[s.trigger, disabled && { opacity: 0.6 }]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Select field type"
      >
        {selected ? (
          <View style={s.triggerLeft}>
            <View style={s.triggerIcon}>
              <MaterialIcons name={metaForSlug(selected.slug).icon} size={16} color={Colors.accent} />
            </View>
            <Text style={s.triggerLabel} numberOfLines={1}>{selected.label}</Text>
          </View>
        ) : (
          <Text style={s.triggerPlaceholder}>{placeholder}</Text>
        )}
        <MaterialIcons name="expand-more" size={22} color={Colors.sub} />
      </TouchableOpacity>

      {/* Picker modal */}
      <Modal visible={open} transparent animationType={isWebWide ? 'fade' : 'slide'} onRequestClose={close}>
        <View style={[s.backdrop, isWebWide ? s.backdropCenter : s.backdropBottom]}>
          {/* tap-out to dismiss */}
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={close} />
          <View style={[s.sheet, isWebWide ? s.sheetWeb : s.sheetMobile]}>
            <View style={s.header}>
              <Text style={s.title}>Choose a field type</Text>
              <TouchableOpacity onPress={close} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="Close">
                <MaterialIcons name="close" size={22} color={Colors.sub} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: isWebWide ? 460 : '100%' }} contentContainerStyle={{ paddingVertical: 6 }}>
              {items.map((it) => {
                const meta = metaForSlug(it.slug);
                const active = it.value === value;
                return (
                  <TouchableOpacity
                    key={String(it.value)}
                    style={[s.row, active && s.rowActive]}
                    onPress={() => pick(it.value)}
                    activeOpacity={0.85}
                  >
                    <View style={[s.rowIcon, active && s.rowIconActive]}>
                      <MaterialIcons name={meta.icon} size={20} color={active ? '#fff' : Colors.accent} />
                    </View>
                    <View style={s.rowText}>
                      <Text style={[s.rowLabel, active && s.rowLabelActive]} numberOfLines={1}>{it.label}</Text>
                      <Text style={s.rowDesc} numberOfLines={1}>{meta.desc}</Text>
                    </View>
                    {active ? (
                      <MaterialIcons name="check-circle" size={20} color={Colors.accent} />
                    ) : (
                      <MaterialIcons name="chevron-right" size={20} color={Colors.sub2} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  // Trigger — mirrors the form input styling
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 2,
    borderColor: Colors.line,
    borderRadius: Radius.md,
    backgroundColor: Colors.card,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginTop: 4,
    gap: 8,
  },
  triggerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  triggerIcon: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: Colors.accentMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  triggerLabel: { fontSize: sf(15), fontWeight: '700', color: Colors.text, flex: 1 },
  triggerPlaceholder: { fontSize: sf(15), color: Colors.muted, flex: 1 },

  // Modal scaffolding
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)' },
  backdropCenter: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  backdropBottom: { justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.bg,
    borderWidth: 2,
    borderColor: Colors.line,
    overflow: 'hidden',
    ...Shadows.card,
  },
  sheetWeb: { width: '100%', maxWidth: 460, borderRadius: Radius.lg },
  sheetMobile: { width: '100%', borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg, paddingBottom: 8 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
    backgroundColor: Colors.card,
  },
  title: { fontSize: sf(17), fontWeight: '900', color: Colors.text, letterSpacing: 0.2 },

  // Rows
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  rowActive: { backgroundColor: Colors.accentMuted },
  rowIcon: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: Colors.card,
    borderWidth: 1.5, borderColor: Colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  rowIconActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: sf(15), fontWeight: '800', color: Colors.text },
  rowLabelActive: { color: Colors.accentDark || Colors.text },
  rowDesc: { fontSize: sf(12), color: Colors.sub },
});
