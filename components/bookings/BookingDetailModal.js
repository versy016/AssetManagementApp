// components/bookings/BookingDetailModal.js
// The booking detail card shown in a modal — opened by tapping a booking on the
// calendar or gantt. Colour accent + status match the bar that was clicked.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, sf } from '../../constants/uiTheme';
import { P, colorForAsset, initialsOf, STATUS_LABEL, STATUS_STYLE, fmtLong } from './bookingVisuals';

export default function BookingDetailModal({ booking, canManage, onClose, onCancel, onCheckout, onReturn, onEdit }) {
  const b = booking;
  const su = String(b?.status || '').toUpperCase();
  const st = STATUS_STYLE[su] || STATUS_STYLE.CONFIRMED;
  const color = colorForAsset(b?.assetId);
  const title = b ? [b.assetTypeName || b.model || 'Asset', b.assetId].filter(Boolean).join(' · ') : '';
  const act = (fn) => () => { onClose?.(); fn?.(); };

  return (
    <Modal visible={!!b} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.card} onPress={() => {}}>
          {b ? (
            <>
              <View style={[s.stripe, { backgroundColor: color }]} />
              <TouchableOpacity style={s.close} onPress={onClose} activeOpacity={0.8} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MaterialIcons name="close" size={18} color={P.ink} />
              </TouchableOpacity>

              <View style={s.body}>
                <View style={s.head}>
                  <View style={[s.thumb, { backgroundColor: `${color}22` }]}>
                    <MaterialIcons name="inventory-2" size={22} color={color} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.title} numberOfLines={2}>{title}</Text>
                    {b.serialNumber ? <Text style={s.sn} numberOfLines={1}>SN: {b.serialNumber}</Text> : null}
                    <View style={[s.badge, { backgroundColor: st.bg, borderColor: st.bd }]}>
                      <MaterialIcons name={st.icon} size={12} color={st.fg} />
                      <Text style={[s.badgeText, { color: st.fg }]}>{STATUS_LABEL[su] || su}</Text>
                    </View>
                  </View>
                </View>

                <View style={s.meta}>
                  <View style={s.metaRow}>
                    <MaterialIcons name="folder-open" size={16} color={P.muted} />
                    <Text style={s.metaText} numberOfLines={1}>{b.project || 'No project'}</Text>
                  </View>
                  <View style={s.metaRow}>
                    <View style={s.avatar}><Text style={s.avatarText}>{initialsOf(b.bookedByName)}</Text></View>
                    <Text style={s.metaText} numberOfLines={1}>{b.bookedByName || 'Unknown'}</Text>
                  </View>
                  <View style={s.metaRow}>
                    <MaterialIcons name="event" size={16} color={P.muted} />
                    <Text style={[s.metaText, s.metaDates]}>{fmtLong(b.dateFrom)} – {fmtLong(b.dateTo)}</Text>
                  </View>
                </View>

                {canManage ? (
                  <View style={s.actions}>
                    {onEdit && su !== 'COMPLETED' ? (
                      <TouchableOpacity style={s.ghost} activeOpacity={0.85} onPress={act(() => onEdit(b))}>
                        <MaterialIcons name="edit" size={16} color={P.ink} />
                        <Text style={s.ghostText}>Edit</Text>
                      </TouchableOpacity>
                    ) : null}
                    {su === 'CONFIRMED' && onCheckout ? (
                      <TouchableOpacity style={[s.primary, { backgroundColor: P.accent }]} activeOpacity={0.85} onPress={act(() => onCheckout(b.id))}>
                        <MaterialIcons name="logout" size={16} color="#fff" />
                        <Text style={s.primaryText}>Transfer to me</Text>
                      </TouchableOpacity>
                    ) : null}
                    {su === 'ACTIVE' && onReturn ? (
                      <TouchableOpacity style={[s.primary, { backgroundColor: Colors.successFg }]} activeOpacity={0.85} onPress={act(() => onReturn(b.id))}>
                        <MaterialIcons name="login" size={16} color="#fff" />
                        <Text style={s.primaryText}>Transfer to office</Text>
                      </TouchableOpacity>
                    ) : null}
                    {onCancel ? (
                      <TouchableOpacity style={s.danger} activeOpacity={0.85} onPress={act(() => onCancel(b.id))}>
                        <MaterialIcons name="delete-outline" size={16} color={Colors.dangerFg} />
                        <Text style={s.dangerText}>Cancel booking</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </>
          ) : null}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(42,35,32,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 400, backgroundColor: '#fff', borderRadius: 20, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 28, shadowOffset: { width: 0, height: 16 }, elevation: 12 },
  stripe: { height: 6, width: '100%' },
  close: { position: 'absolute', top: 14, right: 14, width: 30, height: 30, borderRadius: 15, backgroundColor: '#F1EBE1', alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  body: { padding: 18 },

  head: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingRight: 34 },
  thumb: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: sf(16), fontWeight: '900', color: P.ink, letterSpacing: -0.2 },
  sn: { fontSize: sf(12.5), color: P.muted, marginTop: 2 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  badgeText: { fontSize: sf(11), fontWeight: '800' },

  meta: { marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#EEE7DA', gap: 11 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  metaText: { fontSize: sf(13.5), color: P.ink, fontWeight: '600', flex: 1 },
  metaDates: { fontWeight: '800' },
  avatar: { width: 22, height: 22, borderRadius: 11, backgroundColor: P.ink, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: sf(10), fontWeight: '800', color: '#fff' },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#EEE7DA' },
  primary: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10 },
  primaryText: { fontSize: sf(13.5), fontWeight: '800', color: '#fff' },
  ghost: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: P.line, backgroundColor: P.card },
  ghostText: { fontSize: sf(13.5), fontWeight: '800', color: P.ink },
  danger: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: Colors.dangerBorder, backgroundColor: Colors.dangerBg },
  dangerText: { fontSize: sf(13.5), fontWeight: '800', color: Colors.dangerFg },
});
