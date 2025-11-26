// components/ui/Chip.js
import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors } from '../../constants/uiTheme';

export default function Chip({ label, active, onPress, icon, style, textStyle, tone = 'default' }) {
  const palette = makePalette(tone, active);
  return (
    <TouchableOpacity onPress={onPress} style={[styles.chip, palette.container, style]}>
      {icon ? (
        <Feather
          name={icon}
          size={14}
          color={palette.icon}
          style={{ marginRight: 6 }}
        />
      ) : null}
      <Text style={[styles.text, { color: palette.text }, textStyle]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 999, borderWidth: 1, borderColor: '#D6E8FF',
    backgroundColor: '#FFFFFF', marginRight: 6,
  },
  text: { color: '#374151', fontWeight: '700' },
});

function makePalette(tone, active) {
  if (!active) {
    // inactive
    return {
      container: { backgroundColor: '#FFFFFF', borderColor: '#D6E8FF' },
      text: '#374151',
      icon: '#374151',
    };
  }
  switch (tone) {
    case 'warning':
      return {
        container: { backgroundColor: Colors.warningLight, borderColor: Colors.warningLight },
        text: Colors.warningFg,
        icon: Colors.warningFg,
      };
    case 'success':
      return {
        container: { backgroundColor: Colors.successLight, borderColor: Colors.successLight },
        text: Colors.successFg,
        icon: Colors.successFg,
      };
    case 'danger':
      return {
        container: { backgroundColor: Colors.dangerLight, borderColor: Colors.dangerLight },
        text: Colors.dangerFg,
        icon: Colors.dangerFg,
      };
    case 'info':
      return {
        container: { backgroundColor: Colors.infoLight, borderColor: Colors.infoLight },
        text: Colors.infoFg,
        icon: Colors.infoFg,
      };
    default:
      return {
        container: { backgroundColor: Colors.primaryLight, borderColor: '#D6E8FF' },
        text: Colors.primary,
        icon: Colors.primary,
      };
  }
}
