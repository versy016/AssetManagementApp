// components/ui/PageHeader.js
import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Colors } from '../../constants/uiTheme';

export default function PageHeader({ title, left = null, right = null, style }) {
  return (
    <View style={[styles.header, style]}>
      <View style={styles.headerSide}>{left}</View>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      <View style={[styles.headerSide, { justifyContent: 'flex-end' }]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: Colors.bg,
    ...(Platform.OS === 'web' ? { borderBottomWidth: 0 } : {}),
  },
  headerSide: {
    minWidth: 42, flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  title: { fontSize: 22, fontWeight: '800', color: Colors.text, flex: 1, textAlign: 'center' },
});

