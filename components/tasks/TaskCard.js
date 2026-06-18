// components/tasks/TaskCard.js
// Renders a single task card in the Tasks list.

import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, Shadows, sf } from '../../constants/uiTheme';
import { prettyDate } from '../../hooks/useTasks';

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

// Manual (user-created) task card — Complete / Dismiss lifecycle.
function ManualTaskCard({ item, isOverdue, onComplete, onDismiss, onEdit }) {
  const hasDue = !!item.due;
  const dueText = hasDue ? prettyDate(new Date(item.due)) : 'No due date';
  const isHigh = String(item.priority || '').toUpperCase() === 'HIGH';
  const hasAsset = !!item.assetId;

  return (
    <View style={styles.taskCard}>
      <View style={[styles.taskCardAccent, { backgroundColor: isHigh ? Colors.dangerFg : Colors.primary }]} />

      {/* Header */}
      <View style={styles.taskCardHeaderRow}>
        <View style={[styles.statusChip, isOverdue
          ? { backgroundColor: Colors.dangerBg, borderColor: Colors.dangerBorder }
          : { backgroundColor: Colors.primaryLight, borderColor: Colors.line }]}>
          <MaterialIcons name={isOverdue ? 'error-outline' : 'check-circle-outline'} size={13} color={isOverdue ? Colors.dangerFg : Colors.primary} />
          <Text style={[styles.statusChipText, { color: isOverdue ? Colors.dangerFg : Colors.primary }]} numberOfLines={1}>
            {isOverdue ? 'Overdue' : 'Task'}
          </Text>
        </View>
        <View style={styles.manualHeaderRight}>
          {hasDue && (
            <View style={styles.duePill}>
              <MaterialIcons name="event" size={13} color={Colors.text} />
              <Text style={styles.duePillText} numberOfLines={1}>{dueText}</Text>
            </View>
          )}
          {onEdit && (
            <TouchableOpacity onPress={onEdit} style={styles.manualEditBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialIcons name="edit" size={16} color={Colors.sub} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Title + description */}
      <View style={styles.taskMainRow}>
        <View style={styles.taskAssetThumbPlaceholder}>
          <MaterialIcons name="task-alt" size={22} color={Colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.manualTitle} numberOfLines={2}>{item.title}</Text>
          {item.description ? (
            <Text style={styles.manualDesc} numberOfLines={2}>{item.description}</Text>
          ) : null}
          {hasAsset ? (
            <Text style={styles.manualAsset} numberOfLines={1}>
              <MaterialIcons name="link" size={12} color={Colors.sub} />
              {' '}{[item.assetTypeName || item.model || 'Asset', `ID: ${item.assetId}`].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Footer */}
      <View style={styles.taskFooterRow}>
        <View style={styles.taskTagRow}>
          <View style={[styles.smallTag, isHigh
            ? { backgroundColor: Colors.dangerBg, borderColor: Colors.dangerBorder }
            : { backgroundColor: Colors.chip, borderColor: Colors.line }]}>
            <MaterialIcons name="flag" size={11} color={isHigh ? Colors.dangerFg : Colors.sub} />
            <Text style={[styles.smallTagText, { color: isHigh ? Colors.dangerFg : Colors.sub }]}>{cap(item.priority)} priority</Text>
          </View>
          {item.category && item.category !== 'GENERAL' && (
            <View style={[styles.smallTag, { backgroundColor: Colors.infoBg, borderColor: Colors.infoBorder }]}>
              <Text style={[styles.smallTagText, { color: Colors.infoFg }]}>
                {cap(item.category)}{item.certType ? ` · ${item.certType}` : ''}
              </Text>
            </View>
          )}
          {item.assigneeName ? (
            <View style={[styles.smallTag, { backgroundColor: Colors.chip, borderColor: Colors.line }]}>
              <MaterialIcons name="person" size={11} color={Colors.sub} />
              <Text style={[styles.smallTagText, { color: Colors.sub }]}>{item.assigneeName}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.manualBtnRow}>
          <TouchableOpacity style={styles.completeBtn} onPress={onComplete}>
            <MaterialIcons name="check" size={15} color="#fff" />
            <Text style={styles.completeBtnText}>Complete</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

export default function TaskCard({ item, isOverdue, isReminder, isRepair, isService, isSignoff, onAction, onComplete, onDismiss, onEdit }) {
  if (item.kind === 'manual') {
    return <ManualTaskCard item={item} isOverdue={isOverdue} onComplete={onComplete} onDismiss={onDismiss} onEdit={onEdit} />;
  }
  const hasDue = !!item.due;

  let statusLabel    = 'Upcoming';
  let statusIcon     = 'event';
  let statusBg       = Colors.chip;
  let statusBorder   = Colors.line;
  let statusFg       = Colors.sub;
  let statusIconColor = Colors.sub;

  if (isSignoff) {
    statusLabel     = 'Sign-off pending';
    statusIcon      = 'assignment-turned-in';
    statusBg        = Colors.infoBg;
    statusBorder    = Colors.infoBorder;
    statusFg        = Colors.infoFg;
    statusIconColor = Colors.infoFg;
  } else if (isRepair) {
    statusLabel     = 'Repair';
    statusIcon      = 'build';
    statusBg        = Colors.warningBg;
    statusBorder    = Colors.warningBorder;
    statusFg        = Colors.warningFg;
    statusIconColor = Colors.warningFg;
  } else if (isOverdue) {
    statusLabel     = 'Overdue';
    statusIcon      = 'error-outline';
    statusBg        = Colors.dangerBg;
    statusBorder    = Colors.dangerBorder;
    statusFg        = Colors.dangerFg;
    statusIconColor = Colors.dangerFg;
  } else if (isReminder) {
    statusLabel     = 'Reminder';
    statusIcon      = 'notifications-active';
    statusBg        = Colors.accentLight;
    statusBorder    = Colors.accentMuted;
    statusFg        = Colors.accentDark;
    statusIconColor = Colors.accentDark;
  }

  const dueText = hasDue ? prettyDate(new Date(item.due)) : 'No due date';

  return (
    <View style={styles.taskCard}>
      <View style={styles.taskCardAccent} />

      {/* Header row */}
      <View style={styles.taskCardHeaderRow}>
        <View style={[styles.statusChip, { backgroundColor: statusBg, borderColor: statusBorder }]}>
          <MaterialIcons name={statusIcon} size={13} color={statusIconColor} />
          <Text style={[styles.statusChipText, { color: statusFg }]} numberOfLines={1}>
            {statusLabel}
          </Text>
        </View>
        {hasDue && (
          <View style={styles.duePill}>
            <MaterialIcons name="event" size={13} color={Colors.text} />
            <Text style={styles.duePillText} numberOfLines={1}>{dueText}</Text>
          </View>
        )}
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
            <MaterialIcons name="inventory" size={22} color={Colors.primary} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.taskAssetTitle} numberOfLines={1}>
            {[item.model, item.assetTypeName || 'Asset', `ID: ${item.assetId}`].filter(Boolean).join(' · ')}
          </Text>
          <Text style={styles.taskAssetSerial} numberOfLines={1}>
            SN: {item.serialNumber != null && String(item.serialNumber).trim() !== '' ? String(item.serialNumber) : 'N/A'}
          </Text>
          <Text style={styles.taskTitle} numberOfLines={2}>{item.title}</Text>
        </View>
      </View>

      {/* Footer */}
      <View style={styles.taskFooterRow}>
        <View style={styles.taskTagRow}>
          {isOverdue && (
            <View style={[styles.smallTag, { backgroundColor: Colors.dangerBg, borderColor: Colors.dangerBorder }]}>
              <MaterialIcons name="priority-high" size={11} color={Colors.dangerFg} />
              <Text style={[styles.smallTagText, { color: Colors.dangerFg }]}>High priority</Text>
            </View>
          )}
          {isService && (
            <View style={[styles.smallTag, { backgroundColor: Colors.infoBg, borderColor: Colors.infoBorder }]}>
              <MaterialIcons name="build-circle" size={11} color={Colors.infoFg} />
              <Text style={[styles.smallTagText, { color: Colors.infoFg }]}>Service</Text>
            </View>
          )}
          {isRepair && (
            <View style={[styles.smallTag, { backgroundColor: Colors.warningBg, borderColor: Colors.warningBorder }]}>
              <MaterialIcons name="build" size={11} color={Colors.warningFg} />
              <Text style={[styles.smallTagText, { color: Colors.warningFg }]}>Repair</Text>
            </View>
          )}
          {isReminder && !isOverdue && (
            <View style={[styles.smallTag, { backgroundColor: Colors.accentLight, borderColor: Colors.accentMuted }]}>
              <MaterialIcons name="notifications-active" size={11} color={Colors.accentDark} />
              <Text style={[styles.smallTagText, { color: Colors.accentDark }]}>Reminder</Text>
            </View>
          )}
        </View>
        <TouchableOpacity
          style={[styles.toDoButton, isSignoff && styles.toDoButtonSignoff]}
          onPress={onAction}
        >
          <Text style={styles.toDoButtonText}>
            {isSignoff ? 'Review & sign off' : 'Action'}
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
  toDoButtonSignoff: { backgroundColor: Colors.primary },
  toDoButtonText: { color: '#fff', fontWeight: '800', fontSize: sf(13) },

  // ── Manual task card ──────────────────────────────────────────────────────
  manualHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  manualEditBtn: {
    width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.line, backgroundColor: Colors.card,
  },
  manualTitle: { fontSize: sf(15), fontWeight: '800', color: Colors.text },
  manualDesc: { fontSize: sf(13), color: Colors.sub, marginTop: 3, lineHeight: sf(18) },
  manualAsset: { fontSize: sf(12), color: Colors.sub, marginTop: 5, fontWeight: '600' },
  manualBtnRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dismissBtn: {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: Radius.md,
    borderWidth: 2, borderColor: Colors.line, backgroundColor: Colors.card,
  },
  dismissBtnText: { color: Colors.sub2, fontWeight: '800', fontSize: sf(13) },
  completeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: Radius.md,
    backgroundColor: '#15803D',
  },
  completeBtnText: { color: '#fff', fontWeight: '800', fontSize: sf(13) },
});
