// components/BookingsView.js
// Web dashboard "Bookings" view (rendered by dashboard.js at ?view=bookings).
// Shows the bookings list with an Upcoming/Past toggle, a create button, and — for
// admins — an "Awaiting approval" section for long (> 6 week) bookings.
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, sf } from '../constants/uiTheme';
import { useBookings } from '../hooks/useBookings';
import CreateBookingModal from './bookings/CreateBookingModal';
import BookingsCalendar from './bookings/BookingsCalendar';
import BookingsGantt from './bookings/BookingsGantt';
import ConfirmModal from './ui/ConfirmModal';
import EmptyState from './ui/EmptyState';

const fmt = (ymd) => {
  if (!ymd) return '';
  const d = new Date(`${ymd}T00:00:00`);
  return Number.isNaN(+d) ? ymd : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
};

export default function BookingsView() {
  const b = useBookings();
  const [createOpen, setCreateOpen] = useState(false);
  const [cancelId, setCancelId] = useState(null);
  const [editBooking, setEditBooking] = useState(null);
  const [viewMode, setViewMode] = useState('calendar'); // default to calendar

  const pending = useMemo(
    () => b.items.filter((x) => String(x.status).toUpperCase() === 'REQUESTED'),
    [b.items],
  );
  const rest = useMemo(
    () => (b.isAdmin ? b.items.filter((x) => String(x.status).toUpperCase() !== 'REQUESTED') : b.items),
    [b.items, b.isAdmin],
  );

  return (
    <View style={styles.wrap}>
      <View style={[styles.header, viewMode === 'gantt' && styles.headerWide]}>
        <Text style={styles.title}>Bookings</Text>
        <View style={styles.seg}>
          {[{ k: 'calendar', l: 'Calendar' }, { k: 'gantt', l: 'Gantt' }].map((vm) => (
            <TouchableOpacity key={vm.k} style={[styles.segBtn, viewMode === vm.k && styles.segBtnOn]} onPress={() => setViewMode(vm.k)}>
              <Text style={[styles.segText, viewMode === vm.k && styles.segTextOn]}>{vm.l}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {viewMode === 'gantt' ? (
          <View style={styles.seg}>
            {[{ k: 'upcoming', l: 'Upcoming' }, { k: 'past', l: 'Past' }].map((sc) => (
              <TouchableOpacity key={sc.k} style={[styles.segBtn, b.scope === sc.k && styles.segBtnOn]} onPress={() => b.setScope(sc.k)}>
                <Text style={[styles.segText, b.scope === sc.k && styles.segTextOn]}>{sc.l}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={styles.newBtn} onPress={() => setCreateOpen(true)}>
          <MaterialIcons name="add" size={18} color="#fff" />
          <Text style={styles.newBtnText}>New booking</Text>
        </TouchableOpacity>
      </View>

      {viewMode === 'calendar' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
          <View style={styles.centered}>
            <BookingsCalendar
              items={b.calItems}
              loadRange={b.loadRange}
              canManage
              onCancel={(id) => setCancelId(id)}
              onCheckout={b.checkoutBooking}
              onReturn={b.returnBooking}
              onEdit={setEditBooking}
            />
          </View>
        </ScrollView>
      ) : b.loading ? (
        <ActivityIndicator color={Colors.primary} size="large" style={{ marginTop: 48 }} />
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          <View style={styles.centeredWide}>
          {/* Admin approvals */}
          {b.isAdmin && pending.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Awaiting approval · {pending.length}</Text>
              {pending.map((item) => (
                <View key={item.id} style={styles.apRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.apTitle} numberOfLines={1}>
                      {[item.assetTypeName || item.model || 'Asset', item.assetId].filter(Boolean).join(' · ')}
                    </Text>
                    <Text style={styles.apSub} numberOfLines={1}>
                      {item.bookedByName || 'Unknown'} · {item.project || 'No project'} · {fmt(item.dateFrom)} → {fmt(item.dateTo)}
                    </Text>
                  </View>
                  <TouchableOpacity style={[styles.apBtn, styles.apApprove]} onPress={() => b.approveBooking(item.id)}>
                    <MaterialIcons name="check" size={15} color="#fff" />
                    <Text style={styles.apApproveText}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.apBtn, styles.apReject]} onPress={() => b.rejectBooking(item.id)}>
                    <Text style={styles.apRejectText}>Reject</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {b.items.length === 0 ? (
            <View style={{ marginTop: 24 }}>
              <EmptyState
                icon="event"
                iconColor={Colors.primary}
                iconBg={Colors.primaryLight}
                title={b.scope === 'past' ? 'No past bookings' : 'No upcoming bookings'}
                subtitle="Book a piece of gear for a project and dates."
              />
            </View>
          ) : (
            <BookingsGantt
              items={rest}
              canManage
              onCancel={(id) => setCancelId(id)}
              onCheckout={b.checkoutBooking}
              onReturn={b.returnBooking}
              onEdit={setEditBooking}
            />
          )}
          </View>
        </ScrollView>
      )}

      <CreateBookingModal
        visible={createOpen || !!editBooking}
        editBooking={editBooking}
        onClose={() => { setCreateOpen(false); setEditBooking(null); }}
        onCreate={b.createBooking}
        onUpdate={b.updateBooking}
        getAvailability={b.getAvailability}
      />
      <ConfirmModal
        visible={!!cancelId}
        title="Cancel booking?"
        message="This removes the booking."
        confirmLabel="Cancel booking"
        confirmTone="danger"
        cancelLabel="Keep"
        onConfirm={async () => { const id = cancelId; setCancelId(null); await b.cancelBooking(id); }}
        onCancel={() => setCancelId(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, width: '100%', paddingTop: 16 },
  centered: { width: '100%', maxWidth: 1200, alignSelf: 'center', paddingHorizontal: 20 },
  // The gantt earns more horizontal room than the calendar — more timeline per screen.
  centeredWide: { width: '100%', maxWidth: 1800, alignSelf: 'center', paddingHorizontal: 20 },
  headerWide: { maxWidth: 1800 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap', width: '100%', maxWidth: 1200, alignSelf: 'center', paddingHorizontal: 20 },
  title: { fontSize: sf(22), fontWeight: '900', color: Colors.text },
  seg: { flexDirection: 'row', borderWidth: 1, borderColor: Colors.line, borderRadius: 9, overflow: 'hidden' },
  segBtn: { paddingVertical: 7, paddingHorizontal: 14 },
  segBtnOn: { backgroundColor: Colors.chip },
  segText: { fontSize: sf(13), fontWeight: '700', color: Colors.sub },
  segTextOn: { color: Colors.text },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.accent, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 14 },
  newBtnText: { color: '#fff', fontWeight: '800', fontSize: sf(13) },
  list: { paddingBottom: 40 },
  section: { backgroundColor: Colors.warningBg, borderWidth: 1, borderColor: Colors.warningBorder, borderRadius: Radius.lg, padding: 14, marginBottom: 18 },
  sectionTitle: { fontSize: sf(13), fontWeight: '900', color: Colors.warningFg, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 },
  apRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: Colors.warningBorder },
  apTitle: { fontSize: sf(14), fontWeight: '800', color: Colors.text },
  apSub: { fontSize: sf(12.5), color: Colors.sub, marginTop: 1 },
  apBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  apApprove: { backgroundColor: Colors.successFg },
  apApproveText: { color: '#fff', fontWeight: '800', fontSize: sf(12.5) },
  apReject: { borderWidth: 1, borderColor: Colors.dangerBorder, backgroundColor: Colors.dangerBg },
  apRejectText: { color: Colors.dangerFg, fontWeight: '800', fontSize: sf(12.5) },
});
