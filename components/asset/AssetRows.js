// components/asset/AssetRows.js
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, sf } from '../../constants/uiTheme';

export function Row({ label, value, rightAlign = true }) {
  const isPrimitive = typeof value === 'string' || typeof value === 'number';

  // Non-primitive values (e.g. buttons/links/components)
  if (!isPrimitive) {
    if (!rightAlign) {
      return (
        <View style={styles.detailRowStack}>
          <Text style={styles.label}>{label}</Text>
          <View style={styles.valueBelow}>{value}</View>
        </View>
      );
    }
    return (
      <View style={styles.detailRow}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.valueContainer}>{value}</View>
      </View>
    );
  }

  const text = value == null ? 'N/A' : String(value);
  // Allow longer values (like locations) to stay in the right-hand column;
  // only stack when they are very long or explicitly requested.
  const shouldStack = !rightAlign || text.length > 60;

  if (shouldStack) {
    return (
      <View style={styles.detailRowStack}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.valueBelow}>
          <Text style={[styles.value, { textAlign: 'left', alignSelf: 'flex-start' }]}>
            {text}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.detailRow}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.valueContainer}>
        <Text style={styles.value}>{text}</Text>
      </View>
    </View>
  );
}

export function DetailsGrid({ rows = [] }) {
  return (
    <View style={styles.webGrid}>
      {rows.map((r, idx) => (
        <View key={`dg-${idx}`} style={styles.webGridRow}>
          <View style={styles.webGridLabel}>
            <Text style={styles.webGridLabelText}>{r.label}</Text>
          </View>
          <View style={styles.webGridValue}>
            {typeof r.value === 'string' || typeof r.value === 'number'
              ? <Text style={styles.webGridValueText}>{r.value ?? 'N/A'}</Text>
              : r.value}
          </View>
        </View>
      ))}
    </View>
  );
}

export function Shortcut({ icon, label, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.shortcut}>
      <MaterialIcons name={icon} size={16} color="#1E90FF" />
      <Text style={styles.shortcutText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: Colors.line,
    marginVertical: 0,
    gap: 8,
  },
  detailRowStack: {
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: Colors.line,
    marginVertical: 0,
    gap: 4,
  },
  label: {
    fontWeight: '700',
    color: Colors.sub2,
    fontSize: sf(12),
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  valueContainer: {
    flex: 1,
    alignItems: 'flex-end',
  },
  valueBelow: {
    marginTop: 4,
    width: '100%',
    alignItems: 'flex-start',
  },
  value: {
    color: Colors.text,
    fontSize: sf(15),
    fontWeight: '500',
    textAlign: 'right',
  },
  // Web grid (wider layout)
  webGrid: {
    borderWidth: 2,
    borderColor: Colors.line,
    borderRadius: Radius.md,
    overflow: 'hidden',
    marginTop: 4,
  },
  webGridRow: {
    flexDirection: 'row',
    borderBottomWidth: 2,
    borderBottomColor: Colors.line,
  },
  webGridLabel: {
    width: '32%',
    minWidth: 220,
    backgroundColor: Colors.chip,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRightWidth: 2,
    borderRightColor: Colors.line,
    justifyContent: 'center',
  },
  webGridLabelText: { color: Colors.sub, fontWeight: '800' },
  webGridValue: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  webGridValueText: { color: Colors.text, fontWeight: '600' },
  shortcut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: Colors.chip,
    borderRadius: Radius.lg,
    marginRight: 8,
    marginBottom: 8,
  },
  shortcutText: { color: Colors.accent, fontWeight: '600', fontSize: sf(12) },
});
