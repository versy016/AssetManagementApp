import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors } from '../../constants/uiTheme';

export default function ScreenHeader({
  title = '',
  onBack,
  backLabel = 'Back',
  right = null,
  style,
}) {
  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.row}>
        {onBack ? (
          <TouchableOpacity style={styles.backBtn} onPress={onBack}>
            <MaterialIcons name="arrow-back" size={18} color={Colors.text} />
            <Text style={styles.backText}>{backLabel}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.stub} />
        )}
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        {right ? (
          <View style={styles.right}>{right}</View>
        ) : (
          <View style={[styles.stub, { opacity: 0 }]} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 8 : 6,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  backText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
  },
  stub: {
    minWidth: 112,
    height: 32,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
  },
  right: {
    minWidth: 112,
    alignItems: 'flex-end',
  },
});

