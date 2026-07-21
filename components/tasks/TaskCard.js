// components/tasks/TaskCard.js
// Renders a single task card in the Tasks list.

import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, Shadows, sf } from '../../constants/uiTheme';
import { prettyDate } from '../../hooks/useTasks';
import { AssetStatusBadges } from '../ui/StatusBadge';

/**
 * Props:
 *   item            – task object from useTasks
 *   isOverdue       – boolean
 *   isReminder      – boolean
 *   isRepair        – boolean  (repair/maintenance action)
 *   isService       – boolean  (service, NOT repair)
 *   isSignoff       – boolean
 *   onAction        – () => void  — called when the Action / Review button is pressed
 */
const cap = (str) => (str ? str.charAt(0) + str.slice(1).toLowerCase() : str);

export default function TaskCard({ item, isOverdue, isReminder, isRepair, isService, isSignoff, onAction, onComplete, onDismiss, onEdit }) {
  const isManual = item.kind === 'manual';
  const hasDue = !!item.due;
  const isHigh = String(item.priority || '').toUpperCase() === 'HIGH';

  // Top chip: the JOB TYPE (Maintenance / Repair / Certificate / Hire / Task) so the
  // user can tell at a glance what kind of work a card is — identical for manual and
  // system-created tasks. Urgency (overdue) is conveyed by the due-date pill below.
  const mCat = String(item.category || '').toUpperCase();
  const signoffType = isSignoff ? String(item.actionType || '').toUpperCase() : '';
  let showStatusChip = true;
  let statusLabel, statusIcon, statusBg, statusBorder, statusFg, statusIconColor;
  if (isManual && mCat === 'CERTIFICATE') {
    statusLabel = item.certType || 'Certificate'; statusIcon = 'verified';
    statusBg = Colors.accentLight; statusBorder = Colors.accentMuted; statusFg = Colors.accentDark; statusIconColor = Colors.accentDark;
  } else if (isRepair) {
    statusLabel = 'Repair'; statusIcon = 'build';
    statusBg = Colors.warningBg; statusBorder = Colors.warningBorder; statusFg = Colors.warningFg; statusIconColor = Colors.warningFg;
  } else if (isService) {
    statusLabel = 'Maintenance'; statusIcon = 'build-circle';
    statusBg = Colors.infoBg; statusBorder = Colors.infoBorder; statusFg = Colors.infoFg; statusIconColor = Colors.infoFg;
  } else if (signoffType === 'HIRE') {
    statusLabel = 'Hire'; statusIcon = 'work-outline';
    statusBg = Colors.infoBg; statusBorder = Colors.infoBorder; statusFg = Colors.infoFg; statusIconColor = Colors.infoFg;
  } else {
    // Manual "Other" tasks, a plain sign-off, or an uncategorised item.
    statusLabel = isManual ? 'Other' : (isSignoff ? 'Sign-off' : 'Task'); statusIcon = 'check-circle-outline';
    statusBg = Colors.chip; statusBorder = Colors.line; statusFg = Colors.sub; statusIconColor = Colors.sub;
  }

  const dueText = hasDue ? prettyDate(new Date(item.due)) : 'No due date';

  return (
    <View style={styles.taskCard}>
      <View style={[styles.taskCardAccent, isManual && isHigh && { backgroundColor: Colors.dangerFg }]} />

      {/* Header row */}
      <View style={styles.taskCardHeaderRow}>
        {showStatusChip ? (
          <View style={[styles.statusChip, { backgroundColor: statusBg, borderColor: statusBorder }]}>
            <MaterialIcons name={statusIcon} size={13} color={statusIconColor} />
            <Text style={[styles.statusChipText, { color: statusFg }]} numberOfLines={1}>
              {statusLabel}
            </Text>
          </View>
        ) : <View />}
        <View style={styles.manualHeaderRight}>
          {hasDue && (
            <View style={[styles.duePill, isOverdue && { backgroundColor: Colors.dangerBg, borderColor: Colors.dangerBorder }]}>
              <MaterialIcons name={isOverdue ? 'event-busy' : 'event'} size={13} color={isOverdue ? Colors.dangerFg : Colors.text} />
              <Text style={[styles.duePillText, isOverdue && { color: Colors.dangerFg }]} numberOfLines={1}>
                {isOverdue ? `Overdue · ${dueText}` : dueText}
              </Text>
            </View>
          )}
          {isManual && onEdit ? (
            <TouchableOpacity onPress={onEdit} style={styles.manualEditBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialIcons name="edit" size={16} color={Colors.sub} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Main row */}
      <View style={styles.taskMainRow}>
        {(item.actionImages?.[0] || item.imageUrl) ? (
          <Image
            source={{ uri: item.actionImages?.[0] || item.imageUrl }}
            style={styles.taskAssetThumb}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.taskAssetThumbPlaceholder}>
            <MaterialIcons name={isManual ? 'task-alt' : 'inventory'} size={22} color={Colors.primary} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          {isManual ? (
            <>
              <Text style={styles.taskTitle} numberOfLines={2}>{item.title}</Text>
              {item.description ? (
                <Text style={styles.manualDesc} numberOfLines={2}>{item.description}</Text>
              ) : null}
              {item.assetId ? (
                <Text style={styles.manualAsset} numberOfLines={1}>
                  <MaterialIcons name="link" size={12} color={Colors.sub} />{' '}
                  {[item.assetTypeName || item.model || 'Asset', `ID: ${item.assetId}`].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
              {item.status ? (
                <AssetStatusBadges asset={item} size="sm" style={{ marginTop: 4 }} />
              ) : null}
            </>
          ) : (
            <>
              <Text style={styles.taskAssetTitle} numberOfLines={1}>
                {[item.model, item.assetTypeName || 'Asset', `ID: ${item.assetId}`].filter(Boolean).join(' · ')}
              </Text>
              <Text style={styles.taskAssetSerial} numberOfLines={1}>
                SN: {item.serialNumber != null && String(item.serialNumber).trim() !== '' ? String(item.serialNumber) : 'N/A'}
              </Text>
              {item.status ? (
                <AssetStatusBadges asset={item} size="sm" style={{ marginTop: 4 }} />
              ) : null}
              {/* Flag tasks' title just repeats the status badge — hide it. */}
              {item.kind !== 'flag' && item.title ? (
                <Text style={styles.taskTitle} numberOfLines={2}>{item.title}</Text>
              ) : null}
            </>
          )}
        </View>
      </View>

      {/* Footer */}
      <View style={styles.taskFooterRow}>
        <View style={styles.taskTagRow}>
          {isManual ? (
            <>
              <View style={[styles.smallTag, isHigh
                ? { backgroundColor: Colors.dangerBg, borderColor: Colors.dangerBorder }
                : { backgroundColor: Colors.chip, borderColor: Colors.line }]}>
                <MaterialIcons name="flag" size={11} color={isHigh ? Colors.dangerFg : Colors.sub} />
                <Text style={[styles.smallTagText, { color: isHigh ? Colors.dangerFg : Colors.sub }]}>{cap(item.priority)} priority</Text>
              </View>
              {item.assigneeName ? (
                <View style={[styles.smallTag, { backgroundColor: Colors.chip, borderColor: Colors.line }]}>
                  <MaterialIcons name="person" size={11} color={Colors.sub} />
                  <Text style={[styles.smallTagText, { color: Colors.sub }]}>{item.assigneeName}</Text>
                </View>
              ) : null}
            </>
          ) : (
            <>
              {isReminder && !isOverdue && (
                <View style={[styles.smallTag, { backgroundColor: Colors.accentLight, borderColor: Colors.accentMuted }]}>
                  <MaterialIcons name="notifications-active" size={11} color={Colors.accentDark} />
                  <Text style={[styles.smallTagText, { color: Colors.accentDark }]}>Reminder</Text>
                </View>
              )}
            </>
          )}
        </View>
        <TouchableOpacity
          style={[styles.toDoButton, !isManual && styles.toDoButtonSignoff]}
          onPress={onAction}
        >
          <Text style={styles.toDoButtonText}>
            {isManual ? 'Complete task' : 'Review & sign off'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  taskCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 2,
    borderColor: Colors.line,
    overflow: 'hidden',
    ...Shadows.card,
  },
  taskCardAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: Colors.primary,
  },
  taskCardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 10,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1.5,
    gap: 5,
  },
  statusChipText: { fontSize: sf(11), fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.3 },
  duePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: Colors.chip,
    borderWidth: 2,
    borderColor: Colors.line,
    gap: 5,
  },
  duePillText: { fontSize: sf(12), fontWeight: '600', color: Colors.text },
  taskMainRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4, marginBottom: 10 },
  taskAssetThumb: {
    width: 52,
    height: 52,
    borderRadius: Radius.md,
    borderWidth: 2,
    borderColor: Colors.line,
    backgroundColor: Colors.chip,
  },
  taskAssetThumbPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: Radius.md,
    borderWidth: 2,
    borderColor: Colors.line,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  taskAssetTitle: { fontSize: sf(15), fontWeight: '800', color: Colors.text },
  taskAssetSerial: { fontSize: sf(12), color: Colors.sub, marginTop: 2, fontWeight: '600' },
  taskTitle: { fontSize: sf(13), fontWeight: '700', color: Colors.accent, marginTop: 4 },
  taskFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 2,
    borderTopColor: Colors.line,
    paddingTop: 10,
    gap: 10,
  },
  taskTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, flex: 1 },
  smallTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1.5,
    gap: 4,
  },
  smallTagText: { fontSize: sf(11), fontWeight: '700' },
  toDoButton: {
    backgroundColor: Colors.accent,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: Radius.md,
    alignSelf: 'flex-start',
  },
  toDoButtonSignoff: { backgroundColor: Colors.infoFg },
  toDoButtonText: { color: '#fff', fontWeight: '800', fontSize: sf(13) },

  // ── Manual task card ──────────────────────────────────────────────────────
  manualHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  manualEditBtn: {
    width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.line, backgroundColor: Colors.card,
  },
  manualDesc: { fontSize: sf(13), color: Colors.sub, marginTop: 3, lineHeight: sf(18) },
  manualAsset: { fontSize: sf(12), color: Colors.sub, marginTop: 5, fontWeight: '600' },
});
