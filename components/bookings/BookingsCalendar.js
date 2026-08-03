// components/bookings/BookingsCalendar.js
// Month calendar of bookings — "Spanning Timeline" style: multi-day bookings render
// as one continuous colour bar across the days they span, lane-stacked per week.
// Warm card, visible date borders. Hover a bar for a quick tooltip (web); tap/click
// any booking bar to open its detail card (transfer / cancel) in a modal.
// Sizing is responsive: phones get larger cells, taller bars and bigger touch targets.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { sf } from '../../constants/uiTheme';
import BookingDetailModal from './BookingDetailModal';
import { P, colorForAsset, initialsOf, STATUS_LABEL, HIDDEN_STATUSES, ymd, addDays, todayUtc, fmtD } from './bookingVisuals';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export default function BookingsCalendar({ items, loadRange, canManage, onCancel, onCheckout, onReturn, onEdit }) {
  const { width } = useWindowDimensions();
  const phone = Platform.OS !== 'web' || width < 600;

  // Responsive layout metrics — phones need room to read and to tap.
  const TOPPAD = phone ? 38 : 34; // space for the day number above the bars
  const LANE = phone ? 32 : 27;   // bar height + gap
  const BAR_H = phone ? 27 : 22;
  const GUT = phone ? 3 : 4;      // side gutter inside the bar track
  const CELL_PADH = phone ? 4 : 10;
  const ROW_MINH = phone ? 96 : (Platform.OS === 'web' ? 104 : 66);

  const [month, setMonth] = useState(() => { const t = todayUtc(); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)); });
  const [modalBooking, setModalBooking] = useState(null); // booking whose detail card is open
  const [tip, setTip] = useState(null); // { b, x, y } — web hover tooltip

  const gridDays = useMemo(() => {
    const firstWeekday = (month.getUTCDay() + 6) % 7;
    const start = addDays(month, -firstWeekday);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [month]);

  useEffect(() => {
    if (gridDays.length && loadRange) loadRange(ymd(gridDays[0]), ymd(gridDays[gridDays.length - 1]));
  }, [gridDays, loadRange]);

  // Per-week: day cells + lane-stacked spanning segments.
  const weeks = useMemo(() => {
    const out = [];
    for (let w = 0; w < 6; w++) {
      const days = gridDays.slice(w * 7, w * 7 + 7);
      const wStart = ymd(days[0]);
      const wEnd = ymd(days[6]);
      const segs = [];
      (items || []).forEach((b) => {
        if (!b.dateFrom || !b.dateTo) return;
        if (HIDDEN_STATUSES.has(String(b.status).toUpperCase())) return;
        const s = b.dateFrom > wStart ? b.dateFrom : wStart;
        const e = b.dateTo < wEnd ? b.dateTo : wEnd;
        if (s <= e) {
          const col = days.findIndex((d) => ymd(d) === s);
          const endCol = days.findIndex((d) => ymd(d) === e);
          segs.push({ b, col, span: endCol - col + 1, rl: b.dateFrom === s, rr: b.dateTo === e });
        }
      });
      segs.sort((a, b) => a.col - b.col || b.span - a.span);
      const lanes = [];
      segs.forEach((sg) => {
        let l = 0;
        while (lanes[l] && lanes[l].some((x) => !(sg.col > x.col + x.span - 1 || sg.col + sg.span - 1 < x.col))) l += 1;
        (lanes[l] = lanes[l] || []).push(sg);
        sg.lane = l;
      });
      out.push({ days, segs, laneCount: lanes.length });
    }
    return out;
  }, [gridDays, items]);

  const monthLabel = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1))
    .toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const shiftMonth = (delta) => setMonth((m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + delta, 1)));
  const todayY = ymd(todayUtc());

  const openTip = (b) => (e) => setTip({ b, x: e?.nativeEvent?.clientX ?? 0, y: e?.nativeEvent?.clientY ?? 0 });
  const moveTip = (b) => (e) => setTip((t) => (t && t.b.id === b.id ? { ...t, x: e?.nativeEvent?.clientX ?? t.x, y: e?.nativeEvent?.clientY ?? t.y } : t));
  const closeTip = () => setTip(null);

  const navSize = phone ? 42 : 34;

  return (
    <View>
      {/* Month nav */}
      <View style={s.navRow}>
        <TouchableOpacity style={[s.navBtn, { width: navSize, height: navSize, borderRadius: navSize / 2 }]} onPress={() => shiftMonth(-1)} activeOpacity={0.7}><MaterialIcons name="chevron-left" size={phone ? 26 : 22} color={P.ink} /></TouchableOpacity>
        <TouchableOpacity style={[s.navBtn, { width: navSize, height: navSize, borderRadius: navSize / 2 }]} onPress={() => shiftMonth(1)} activeOpacity={0.7}><MaterialIcons name="chevron-right" size={phone ? 26 : 22} color={P.ink} /></TouchableOpacity>
        <Text style={[s.monthLabel, phone && { fontSize: sf(17) }]} numberOfLines={1}>{monthLabel}</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          style={[s.todayBtn, phone && { paddingVertical: 9, paddingHorizontal: 16 }]}
          activeOpacity={0.7}
          onPress={() => { const t = todayUtc(); setMonth(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1))); }}
        >
          <Text style={s.todayText}>Today</Text>
        </TouchableOpacity>
      </View>

      {/* Calendar card */}
      <View style={s.card}>
        <View style={s.weekRow}>
          {(phone ? WEEKDAYS_SHORT : WEEKDAYS).map((w, i) => <Text key={`${w}${i}`} style={[s.weekday, { paddingHorizontal: CELL_PADH, textAlign: phone ? 'center' : 'left' }]}>{w}</Text>)}
        </View>
        {weeks.map((wk, wi) => {
          const minH = Math.max(ROW_MINH, TOPPAD + 6 + wk.laneCount * LANE);
          return (
            <View key={wi} style={[s.weekWrap, wi < 5 && s.weekBorderB]}>
              <View style={s.daynums}>
                {wk.days.map((d, di) => {
                  const dY = ymd(d);
                  const wknd = d.getUTCDay() === 0 || d.getUTCDay() === 6;
                  const isToday = dY === todayY;
                  return (
                    <View
                      key={dY}
                      style={[s.dcell, { minHeight: minH, paddingHorizontal: CELL_PADH, alignItems: phone ? 'center' : 'flex-start' }, wknd && s.dcellWknd, di < 6 && s.dcellBorderR]}
                    >
                      {isToday ? (
                        <View style={[s.todayPill, phone && { minWidth: 27, height: 27, borderRadius: 13.5 }]}><Text style={[s.todayNum, phone && { fontSize: sf(13.5) }]}>{d.getUTCDate()}</Text></View>
                      ) : (
                        <Text style={[s.dn, phone && { fontSize: sf(14) }, !(d.getUTCMonth() === month.getUTCMonth()) && s.dnOut]}>{d.getUTCDate()}</Text>
                      )}
                    </View>
                  );
                })}
              </View>
              <View style={[s.bars, { top: TOPPAD, left: GUT, right: GUT }]} pointerEvents="box-none">
                {wk.segs.map((sg) => {
                  const color = colorForAsset(sg.b.assetId);
                  const pending = String(sg.b.status).toUpperCase() === 'REQUESTED';
                  const hoverProps = Platform.OS === 'web'
                    ? { onMouseEnter: openTip(sg.b), onMouseMove: moveTip(sg.b), onMouseLeave: closeTip }
                    : {};
                  return (
                    <TouchableOpacity
                      key={`${sg.b.id}-${wi}`}
                      activeOpacity={0.85}
                      onPress={() => { closeTip(); setModalBooking(sg.b); }}
                      {...hoverProps}
                      style={[
                        s.bar,
                        { backgroundColor: color, height: BAR_H, left: `${(sg.col / 7) * 100}%`, width: `${(sg.span / 7) * 100}%`, top: sg.lane * LANE },
                        sg.rl && s.barRL,
                        sg.rr && s.barRR,
                        pending && s.barPending,
                      ]}
                    >
                      {sg.rl ? (
                        <>
                          <View style={[s.barAv, phone && { width: 19, height: 19, borderRadius: 9.5 }]}><Text style={[s.barAvText, phone && { fontSize: sf(9.5) }]}>{initialsOf(sg.b.bookedByName)}</Text></View>
                          <Text style={[s.barText, phone && { fontSize: sf(12) }]} numberOfLines={1}>{sg.b.assetTypeName || sg.b.model || 'Booked'}</Text>
                        </>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        })}
      </View>

      <Text style={s.hint}>
        {Platform.OS === 'web' ? 'Hover a booking for a quick look · click it for full details.' : 'Tap a booking to see its details.'}
      </Text>

      {/* Hover tooltip (web only) — follows the cursor, never intercepts clicks */}
      {tip && Platform.OS === 'web' ? (
        <View
          pointerEvents="none"
          style={[s.tip, { position: 'fixed', left: Math.round(tip.x) + 14, top: Math.round(tip.y) + 16, zIndex: 9999 }]}
        >
          <View style={[s.tipDot, { backgroundColor: colorForAsset(tip.b.assetId) }]} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.tipTitle} numberOfLines={1}>
              {[tip.b.assetTypeName || tip.b.model || 'Booking', tip.b.assetId].filter(Boolean).join(' · ')}
            </Text>
            <Text style={s.tipSub} numberOfLines={1}>{fmtD(tip.b.dateFrom)} – {fmtD(tip.b.dateTo)} · {tip.b.bookedByName || 'Unknown'}</Text>
            {tip.b.project ? <Text style={s.tipSub} numberOfLines={1}>{tip.b.project}</Text> : null}
            <Text style={s.tipStatus}>{STATUS_LABEL[String(tip.b.status).toUpperCase()] || String(tip.b.status || '')}</Text>
          </View>
        </View>
      ) : null}

      {/* Detail modal — opened by clicking/tapping any booking bar */}
      <BookingDetailModal
        booking={modalBooking}
        canManage={canManage}
        onClose={() => setModalBooking(null)}
        onCancel={onCancel}
        onCheckout={onCheckout}
        onReturn={onReturn}
        onEdit={onEdit}
      />
    </View>
  );
}

const s = StyleSheet.create({
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  navBtn: { alignItems: 'center', justifyContent: 'center', backgroundColor: P.card, borderWidth: 1, borderColor: P.line },
  monthLabel: { fontSize: sf(19), fontWeight: '800', color: P.ink, letterSpacing: -0.3, marginLeft: 6, flexShrink: 1 },
  todayBtn: { paddingVertical: 7, paddingHorizontal: 15, borderRadius: 999, backgroundColor: P.card, borderWidth: 1, borderColor: P.line },
  todayText: { fontSize: sf(12.5), fontWeight: '800', color: P.ink },

  card: { backgroundColor: P.card, borderRadius: 18, borderWidth: 1.5, borderColor: P.lineStrong, overflow: 'hidden', shadowColor: '#2A2320', shadowOpacity: 0.10, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  weekRow: { flexDirection: 'row', backgroundColor: P.wknd, borderBottomWidth: 1.5, borderBottomColor: P.lineStrong },
  weekday: { flex: 1, fontSize: sf(11), fontWeight: '800', color: P.muted, textTransform: 'uppercase', letterSpacing: 0.6, paddingVertical: 11 },

  weekWrap: { position: 'relative' },
  weekBorderB: { borderBottomWidth: 1.5, borderBottomColor: P.line },
  daynums: { flexDirection: 'row' },
  dcell: { flex: 1, paddingTop: 8, backgroundColor: P.cell },
  dcellWknd: { backgroundColor: P.wknd },
  dcellBorderR: { borderRightWidth: 1.5, borderRightColor: P.line },
  dn: { fontSize: sf(13), fontWeight: '800', color: P.ink },
  dnOut: { color: P.faint, fontWeight: '600' },
  todayPill: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7, backgroundColor: P.accent, alignItems: 'center', justifyContent: 'center' },
  todayNum: { fontSize: sf(12.5), fontWeight: '900', color: '#fff' },

  bars: { position: 'absolute', bottom: 2 },
  bar: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6, borderRadius: 3, overflow: 'hidden', shadowColor: '#2A2320', shadowOpacity: 0.18, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  barRL: { borderTopLeftRadius: 13, borderBottomLeftRadius: 13 },
  barRR: { borderTopRightRadius: 13, borderBottomRightRadius: 13 },
  barPending: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.9)', borderStyle: 'dashed' },
  barAv: { width: 16, height: 16, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.28)', alignItems: 'center', justifyContent: 'center' },
  barAvText: { fontSize: sf(8.5), fontWeight: '900', color: '#fff' },
  barText: { fontSize: sf(11), fontWeight: '800', color: '#fff', flexShrink: 1 },

  hint: { fontSize: sf(12.5), color: P.muted, marginTop: 12, textAlign: 'center' },

  tip: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', maxWidth: 260, backgroundColor: P.ink, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  tipDot: { width: 10, height: 10, borderRadius: 3, marginTop: 3 },
  tipTitle: { fontSize: sf(12.5), fontWeight: '800', color: '#fff' },
  tipSub: { fontSize: sf(11.5), color: '#E8DECF', marginTop: 2 },
  tipStatus: { fontSize: sf(10), fontWeight: '800', color: P.accent, marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.5 },
});
