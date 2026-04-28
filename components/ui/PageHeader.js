// components/ui/PageHeader.js
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, FontWeights, sf } from '../../constants/uiTheme';

export default function PageHeader({ title, left = null, right = null, style }) {
  const showTitle = title != null && String(title).trim() !== '';
  return (
    <View style={[styles.header, style]}>
      <View style={styles.headerSide}>{left}</View>
      {showTitle ? (
        <Text style={styles.title} numberOfLines={1}>
          {String(title).toUpperCase()}
        </Text>
      ) : (
        <View style={styles.titleSpacer} />
      )}
      <View style={[styles.headerSide, { justifyContent: 'flex-end' }]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.bg,
    borderBottomWidth: 2,
    borderBottomColor: Colors.line,
  },
  headerSide: {
    minWidth: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontSize: sf(22),
    fontWeight: FontWeights.black,
    color: Colors.text,
    flex: 1,
    textAlign: 'center',
    letterSpacing: 0.5,
    fontFamily: 'Inter',
  },
  titleSpacer: {
    flex: 1,
  },
});

