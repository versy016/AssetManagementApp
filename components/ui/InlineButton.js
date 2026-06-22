// components/ui/InlineButton.js
import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Colors, Radius } from '../../constants/uiTheme';

export default function InlineButton({ label, onPress, style, textStyle, disabled }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} style={[styles.btn, disabled && styles.btnDisabled, style]}>
      <Text style={[styles.text, disabled && styles.textDisabled, textStyle]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center',
    gap: 6, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: Radius.md, borderWidth: 2, borderColor: Colors.line,
    backgroundColor: Colors.accentLight,
  },
  text: { color: Colors.accent, fontWeight: '800' },
  btnDisabled: { opacity: 0.4 },
  textDisabled: { color: Colors.sub2 },
});

