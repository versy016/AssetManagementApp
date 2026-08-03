// components/bookings/BookingCard.js
// One booking in the Bookings list. Shows the asset, project, window, who booked
// it, and its status; the booker/admin can cancel from the ⋯ action.
import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, sf } from '../../constants/uiTheme';

const STATUS = {
  CONFIRMED: { label: 'Confirmed', icon: 'event-available', bg: Colors.infoBg, fg: Colors.infoFg, bd: Colors.infoBorder },
  REQUESTED: { label: 'Needs approval', icon: 'schedule', bg: Colors.warningBg, fg: Colors.warningFg, bd: Colors.warningBorder },
  ACTIVE: { label: 'Out', icon: 'play-arrow', bg: Colors.successBg, fg: Colors.successFg, bd: Colors.successFg },
  COMPLETED: { label: 'Completed', icon: 'check', bg: Colors.chip, fg: Colors.sub, bd: Colors.line },
  CANCELLED: { label: 'Cancelled', icon: 'block', bg: Colors.dangerBg, fg: Colors.dangerFg, bd: Colors.dangerBorder },
  REJECTED: { label: 'Rejected', icon: 'block', bg: Colors.dangerBg, fg: Colors.dangerFg, bd: Colors.dangerBorder },
};

const fmt = (ymd) => {
  if (!ymd) return '';
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(+d)) return ymd;
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
};
const initials = (s) => {
  const parts = String(s || '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
};

export default function BookingCard({ item, canManage, onCancel, onCheckout, onReturn, onEdit }) {
  const statusUpper = String(item.status || '').toUpperCase();
  const st = STATUS[statusUpper] || STATUS.CONFIRMED;
  const title = [item.assetTypeName || item.model || 'Asset', item.assetId].filter(Boolean).join(' · ');
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <View style={styles.thumbPlaceholder}><MaterialIcons name="inventory-2" size={20} color={Colors.primary} /></View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {item.serialNumber ? <Text style={styles.sub} numberOfLines={1}>SN: {item.serialNumber}</Text> : null}
        </View>
        <View style={[styles.badge, { backgroundColor: st.bg, borderColor: st.bd }]}>
          <MaterialIcons name={st.icon} size={12} color={st.fg} />
          <Text style={[styles.badgeText, { color: st.fg }]} numberOfLines={1}>{st.label}</Text>
        </View>
      </View>

      <View style={styles.projRow}>
        <MaterialIcons name="folder-open" size={13} color={Colors.sub} />
        <Text style={[styles.proj, !item.project && styles.projEmpty]} numberOfLines={1}>{item.project || 'No project'}</Text>
      </View>

      <View style={styles.foot}>
        <View style={styles.who}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{initials(item.bookedByName)}</Text></View>
          <Text style={styles.whoName} numberOfLines={1}>{item.bookedByName || 'Unknown'}</Text>
        </View>
        <View style={styles.dates}>
          <MaterialIcons name="event" size={13} color={Colors.text} />
          <Text style={styles.datesText}>{fmt(item.dateFrom)} – {fmt(item.dateTo)}</Text>
        </View>
      </View>

      {canManage ? (
        <View style={styles.actions}>
          {onEdit && statusUpper !== 'COMPLETED' ? (
            <TouchableOpacity style={styles.actBtn} onPress={() => onEdit(item)}>
              <MaterialIcons name="edit" size={15} color={Colors.sub} />
              <Text style={[styles.actText, { color: Colors.sub }]}>Edit</Text>
            </TouchableOpacity>
          ) : null}
          {statusUpper === 'CONFIRMED' && onCheckout ? (
            <TouchableOpacity style={styles.actBtn} onPress={() => onCheckout(item.id)}>
              <MaterialIcons name="logout" size={15} color={Colors.infoFg} />
              <Text style={[styles.actText, { color: Colors.infoFg }]}>Transfer to me</Text>
            </TouchableOpacity>
          ) : null}
          {statusUpper === 'ACTIVE' && onReturn ? (
            <TouchableOpacity style={styles.actBtn} onPress={() => onReturn(item.id)}>
              <MaterialIcons name="login" size={15} color={Colors.successFg} />
              <Text style={[styles.actText, { color: Colors.successFg }]}>Transfer to office</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.actBtn} onPress={() => onCancel?.(item.id)}>
            <MaterialIcons name="delete-outline" size={15} color={Colors.dangerFg} />
            <Text style={[styles.actText, { color: Colors.dangerFg }]}>Cancel booking</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.card, borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.lg, padding: 12 },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  thumb: { width: 42, height: 42, borderRadius: 10 },
  thumbPlaceholder: { width: 42, height: 42, borderRadius: 10, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: sf(14), fontWeight: '800', color: Colors.text },
  sub: { fontSize: sf(12), color: Colors.sub, marginTop: 1 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  badgeText: { fontSize: sf(11), fontWeight: '800' },
  projRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  proj: { fontSize: sf(12.5), color: Colors.sub, fontWeight: '600', flex: 1 },
  projEmpty: { fontStyle: 'italic', color: Colors.subtle, fontWeight: '500' },
  foot: { flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.line },
  who: { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 },
  avatar: { width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: sf(10), fontWeight: '800', color: '#fff' },
  whoName: { fontSize: sf(12.5), color: Colors.sub, fontWeight: '600', flexShrink: 1 },
  dates: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  datesText: { fontSize: sf(12.5), fontWeight: '800', color: Colors.text },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 10 },
  actBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actText: { fontSize: sf(12.5), fontWeight: '700' },
});
