// components/tasks/HireCard.js
// Renders a single hire record card in the Hire sub-tab.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, Shadows, sf } from '../../constants/uiTheme';
import { fmtDate } from '../../hooks/useTasks';

/**
 * Props:
 *   item – hire record object from the API
 */
export default function HireCard({ item: h }) {
  const signed = h.signatureStatus === 'signed';

  return (
    <View style={styles.hireCard}>
      {/* Equipment row */}
      <View style={styles.hireCardTopRow}>
        <View style={styles.hireCardIconWrap}>
          <MaterialIcons name="construction" size={18} color={Colors.primary} />
        </View>
        <View style={styles.hireCardEquipCol}>
          <Text style={styles.hireCardEquip} numberOfLines={1}>{h.assetType || 'Equipment'}</Text>
          {h.serial ? <Text style={styles.hireCardSerial}>SN: {h.serial}</Text> : null}
        </View>
        <View style={[styles.hireStatusBadge, signed ? styles.hireStatusSigned : styles.hireStatusPending]}>
          <MaterialIcons name={signed ? 'verified' : 'pending'} size={11} color={signed ? Colors.successFg : Colors.warningFg} />
          <Text style={[styles.hireStatusText, { color: signed ? Colors.successFg : Colors.warningFg }]}>
            {signed ? 'Signed' : 'Pending'}
          </Text>
        </View>
      </View>

      <View style={styles.hireCardDivider} />

      {/* Contact */}
      <View style={styles.hireCardRow}>
        <MaterialIcons name="person" size={14} color={Colors.text} style={styles.hireCardRowIcon} />
        <Text style={styles.hireCardValue} numberOfLines={1}>{h.contactName || '—'}</Text>
      </View>
      {h.phone && h.phone !== '—' ? (
        <View style={styles.hireCardRow}>
          <MaterialIcons name="phone" size={14} color={Colors.text} style={styles.hireCardRowIcon} />
          <Text style={styles.hireCardValue}>{h.phone}</Text>
        </View>
      ) : null}
      {h.email ? (
        <View style={styles.hireCardRow}>
          <MaterialIcons name="email" size={14} color={Colors.text} style={styles.hireCardRowIcon} />
          <Text style={styles.hireCardValue} numberOfLines={1}>{h.email}</Text>
        </View>
      ) : null}

      {/* Dates */}
      <View style={styles.hireCardDivider} />
      <View style={styles.hireDatesRow}>
        <View style={styles.hireDateBlock}>
          <Text style={styles.hireDateLabel}>FROM</Text>
          <Text style={styles.hireDateValue}>{fmtDate(h.fromDate)}</Text>
        </View>
        <MaterialIcons name="arrow-forward" size={16} color={Colors.sub2} />
        <View style={[styles.hireDateBlock, { alignItems: 'flex-end' }]}>
          <Text style={styles.hireDateLabel}>TO</Text>
          <Text style={styles.hireDateValue}>{fmtDate(h.toDate)}</Text>
        </View>
      </View>

      {(h.project || h.client) ? (
        <View style={styles.hireCardTagRow}>
          <MaterialIcons name="work" size={13} color={Colors.text} style={styles.hireCardRowIcon} />
          <Text style={styles.hireCardTag} numberOfLines={1}>{h.project || h.client}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hireCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.line,
    padding: 14,
    ...Shadows.card,
  },
  hireCardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hireCardIconWrap: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryLight,
    borderWidth: 2,
    borderColor: Colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hireCardEquipCol: { flex: 1 },
  hireCardEquip: { fontSize: sf(15), fontWeight: '800', color: Colors.text },
  hireCardSerial: { fontSize: sf(12), color: Colors.sub, marginTop: 2, fontWeight: '600' },
  hireStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  hireStatusSigned: { backgroundColor: Colors.successBg, borderColor: Colors.successBorder },
  hireStatusPending: { backgroundColor: Colors.warningBg, borderColor: Colors.warningBorder },
  hireStatusText: { fontSize: sf(11), fontWeight: '800' },
  hireCardDivider: { height: 2, backgroundColor: Colors.line, marginVertical: 10 },
  hireCardRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
  hireCardRowIcon: { marginRight: 8 },
  hireCardValue: { fontSize: sf(13), color: Colors.text, fontWeight: '600', flex: 1 },
  hireDatesRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hireDateBlock: { flex: 1 },
  hireDateLabel: {
    fontSize: sf(10),
    fontWeight: '800',
    color: Colors.sub2,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  hireDateValue: { fontSize: sf(14), fontWeight: '700', color: Colors.text },
  hireCardTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 2,
    borderTopColor: Colors.line,
  },
  hireCardTag: { fontSize: sf(12), color: Colors.sub, fontWeight: '600', flex: 1 },
});
