import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors } from '../../constants/uiTheme';

/**
 * Centered empty-state display: icon circle, title, subtitle, optional hint.
 *
 * Props:
 *  icon       – MaterialIcons name (default 'folder-open')
 *  iconSize   – icon size (default 28)
 *  iconColor  – icon color (default Colors.sub2)
 *  iconBg     – icon circle background (default Colors.chip)
 *  title      – bold heading text (required)
 *  subtitle   – secondary description (optional)
 *  hint       – small tip line below subtitle (optional)
 *  style      – additional style for the outer container
 */
export default function EmptyState({
  icon = 'folder-open',
  iconSize = 28,
  iconColor = Colors.sub2,
  iconBg = Colors.chip,
  title,
  subtitle,
  hint,
  style,
}) {
  return (
    <View style={[styles.container, style]}>
      <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
        <MaterialIcons name={icon} size={iconSize} color={iconColor} />
      </View>
      {!!title && <Text style={styles.title}>{title}</Text>}
      {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      {!!hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 10,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: Colors.sub,
    textAlign: 'center',
    lineHeight: 19,
    marginHorizontal: 16,
  },
  hint: {
    fontSize: 11,
    color: Colors.sub2,
    textAlign: 'center',
    marginTop: 4,
  },
});
