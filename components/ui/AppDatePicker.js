// components/ui/AppDatePicker.js
// Cross-platform date picker tuned for picking dates months/years ahead.
//   • iOS     — native spinner wheels (spin the year directly) in a sheet.
//   • Android — native calendar dialog (tap the year for the year list).
//   • Web     — react-native-paper-dates calendar modal.
//
// Props:
//   visible     boolean
//   value       'YYYY-MM-DD' | null   (initial selection)
//   onConfirm   (iso: 'YYYY-MM-DD') => void
//   onDismiss   () => void
//   label       string (sheet title on iOS)

import React, { useEffect, useState } from 'react';
import { Platform, Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { DatePickerModal } from 'react-native-paper-dates';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Colors, Radius, sf } from '../../constants/uiTheme';

const toIso = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const fromValue = (value) => (value ? new Date(`${value}T00:00:00`) : new Date());

export default function AppDatePicker({ visible, value, onConfirm, onDismiss, label }) {
  const [temp, setTemp] = useState(() => fromValue(value));

  useEffect(() => { if (visible) setTemp(fromValue(value)); }, [visible, value]);

  // ── Web: paper-dates calendar modal (has a year selector in its header) ──
  if (Platform.OS === 'web') {
    return (
      <DatePickerModal
        locale="en"
        mode="single"
        visible={visible}
        date={fromValue(value)}
        onDismiss={onDismiss}
        onConfirm={({ date }) => { if (date && !isNaN(new Date(date).getTime())) onConfirm(toIso(new Date(date))); else onDismiss(); }}
      />
    );
  }

  // ── Android: native calendar dialog (year is one tap away) ──
  if (Platform.OS === 'android') {
    if (!visible) return null;
    return (
      <DateTimePicker
        value={fromValue(value)}
        mode="date"
        display="calendar"
        onChange={(event, date) => {
          if (event.type === 'set' && date) onConfirm(toIso(date));
          else onDismiss();
        }}
      />
    );
  }

  // ── iOS: spinner wheels in a bottom sheet (spin the year directly) ──
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <View style={s.backdrop}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onDismiss} />
        <View style={s.sheet}>
          <View style={s.bar}>
            <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={s.cancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={s.title} numberOfLines={1}>{label || 'Select date'}</Text>
            <TouchableOpacity onPress={() => onConfirm(toIso(temp))} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={s.done}>Done</Text>
            </TouchableOpacity>
          </View>
          <DateTimePicker
            value={temp}
            mode="date"
            display="spinner"
            themeVariant="light"
            textColor={Colors.text}
            onChange={(_e, date) => { if (date) setTemp(date); }}
            style={{ alignSelf: 'stretch', backgroundColor: Colors.bg }}
          />
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 24 },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.line,
  },
  title: { fontSize: sf(15), fontWeight: '800', color: Colors.text, flex: 1, textAlign: 'center' },
  cancel: { fontSize: sf(15), fontWeight: '700', color: Colors.sub2 },
  done: { fontSize: sf(15), fontWeight: '900', color: Colors.primary },
});
