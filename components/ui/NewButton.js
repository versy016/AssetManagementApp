// components/ui/NewButton.js
// Standard "+ New X" creation button used across the app (assets, tasks, hire,
// certificates, asset types, etc.). Matches the canonical "+ New Asset" design:
// orange accent, white add icon, compact rounded button.

import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, sf } from '../../constants/uiTheme';

export default function NewButton({
  label,
  onPress,
  icon = 'add',
  iconSize = 18,
  disabled = false,
  style,
  textStyle,
  activeOpacity = 0.9,
  testID,
}) {
  return (
    <TouchableOpacity
      testID={testID}
      style={[s.btn, disabled && s.disabled, style]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={activeOpacity}
    >
      <MaterialIcons name={icon} size={iconSize} color="#fff" />
      {label ? <Text style={[s.text, textStyle]}>{label}</Text> : null}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: Radius.md,
    backgroundColor: Colors.accent,
  },
  text: { fontSize: sf(13), fontWeight: '800', color: '#fff' },
  disabled: { opacity: 0.6 },
});
