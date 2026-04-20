import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { Colors, sf } from '../../constants/uiTheme';

/**
 * Centered loading spinner with optional label.
 *
 * Props:
 *  size    – 'small' | 'large' (default 'large')
 *  color   – spinner color (default Colors.primary)
 *  label   – optional text beneath the spinner
 *  style   – additional style for the container
 *  flex    – if true, container uses flex: 1 to fill available space (default true)
 */
export default function LoadingSpinner({
  size = 'large',
  color = Colors.primary,
  label,
  style,
  flex = true,
}) {
  return (
    <View style={[styles.container, flex && styles.flex, style]}>
      <ActivityIndicator size={size} color={color} />
      {!!label && <Text style={styles.label}>{label}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
  flex: { flex: 1 },
  label: {
    marginTop: 12,
    fontSize: sf(14),
    color: Colors.sub,
  },
});
