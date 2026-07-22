// components/bookings/BookingsCalendar.js
// Month calendar of bookings — "Spanning Timeline" style: multi-day bookings render
// as one continuous colour bar across the days they span, lane-stacked per week.
// Warm card, visible date borders. Tap a day to list its bookings below (with
// check-out / return / cancel).
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { sf } from '../../constants/uiTheme';
import BookingCard from './BookingCard';

const P = {
  ink: '#2A2320', muted: '#8A7E6B', faint: '#BCAF98',
  card: '#FBF6EE', cell: '#FCF8F1', wknd: '#F3EBDD',
  line: '#E1D5C0', lineStrong: '#D8C9AF',
  accent: '#EA580C', accentSoft: '#FCEBDD',
};
// Distinct, saturated colours so different assets read as different bars. Colour is
// stable per asset (hashed from its id), so the same asset is always the same colour.
const PALETTE = ['#4F46E5', '#0891B2', '#059669', '#CA8A04', '#DC2626', '#DB2777', '#7C3AED', '#EA580C', '#0D9488', '#65A30D', '#2563EB', '#9333EA'];
const colorForAsset = (id) => {
  let h = 0; const str = String(id || '');
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
};
const initialsOf = (name) => {
  const p = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?';
};
const HIDDEN_STATUSES = new Set(['CANCELLED', 'REJECTED']);
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TOPPAD = Platform.OS === 'web' ? 34 : 28; // space for the day number above bars
const LANE = 27; // bar height + gap

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const todayUtc = () => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); };

export default function BookingsCalendar({ items, loadRange, canManage, onCancel, onCheckout, onReturn }) {
  const [month, setMonth] = useState(() => { const t = todayUtc(); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)); });
  const [selected, setSelected] = useState(() => ymd(todayUtc()));

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

  const bookingsOn = (dY) => (items || []).filter((b) => b.dateFrom && b.dateTo && b.dateFrom <= dY && dY <= b.dateTo);
  const selectedBookings = useMemo(
    () => bookingsOn(selected).slice().sort((a, b) => String(a.dateFrom).localeCompare(b.dateFrom)),
    [items, selected],
  );

  const monthLabel = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1))
    .toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const shiftMonth = (delta) => setMonth((m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + delta, 1)));
  const todayY = ymd(todayUtc());
  const prettyDay = new Date(`${selected}T00:00:00Z`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

  return (
    <View>
      {/* Month nav */}
      <View style={s.navRow}>
        <TouchableOpacity style={s.navBtn} onPress={() => shiftMonth(-1)} activeOpacity={0.7}><MaterialIcons name="chevron-left" size={22} color={P.ink} /></TouchableOpacity>
        <TouchableOpacity style={s.navBtn} onPress={() => shiftMonth(1)} activeOpacity={0.7}><MaterialIcons name="chevron-right" size={22} color={P.ink} /></TouchableOpacity>
        <Text style={s.monthLabel}>{monthLabel}</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          style={s.todayBtn}
          activeOpacity={0.7}
          onPress={() => { const t = todayUtc(); setMonth(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1))); setSelected(ymd(t)); }}
        >
          <Text style={s.todayText}>Today</Text>
        </TouchableOpacity>
      </View>

      {/* Calendar card */}
      <View style={s.card}>
        <View style={s.weekRow}>
          {WEEKDAYS.map((w) => <Text key={w} style={s.weekday}>{w}</Text>)}
        </View>
        {weeks.map((wk, wi) => {
          const minH = Math.max(Platform.OS === 'web' ? 104 : 66, TOPPAD + 4 + wk.laneCount * LANE);
          return (
            <View key={wi} style={[s.weekWrap, wi < 5 && s.weekBorderB]}>
              <View style={s.daynums}>
                {wk.days.map((d, di) => {
                  const dY = ymd(d);
                  const wknd = d.getUTCDay() === 0 || d.getUTCDay() === 6;
                  const isToday = dY === todayY;
                  const isSel = dY === selected;
                  return (
                    <TouchableOpacity
                      key={dY}
                      activeOpacity={0.75}
                      onPress={() => setSelected(dY)}
                      style={[s.dcell, { minHeight: minH }, wknd && s.dcellWknd, di < 6 && s.dcellBorderR, isSel && s.dcellSel]}
                    >
                      {isToday ? (
                        <View style={s.todayPill}><Text style={s.todayNum}>{d.getUTCDate()}</Text></View>
                      ) : (
                        <Text style={[s.dn, !(d.getUTCMonth() === month.getUTCMonth()) && s.dnOut]}>{d.getUTCDate()}</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={s.bars} pointerEvents="none">
                {wk.segs.map((sg) => {
                  const color = colorForAsset(sg.b.assetId);
                  const pending = String(sg.b.status).toUpperCase() === 'REQUESTED';
                  return (
                    <View
                      key={`${sg.b.id}-${wi}`}
                      style={[
                        s.bar,
                        { backgroundColor: color, left: `${(sg.col / 7) * 100}%`, width: `${(sg.span / 7) * 100}%`, top: sg.lane * LANE },
                        sg.rl && s.barRL,
                        sg.rr && s.barRR,
                        pending && s.barPending,
                      ]}
                    >
                      {sg.rl ? (
                        <>
                          <View style={s.barAv}><Text style={s.barAvText}>{initialsOf(sg.b.bookedByName)}</Text></View>
                          <Text style={s.barText} numberOfLines={1}>{sg.b.assetTypeName || sg.b.model || 'Booked'}</Text>
                        </>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}
      </View>

      {/* Selected day */}
      <View style={s.dayHeaderRow}>
        <View style={s.dayDot} />
        <Text style={s.dayHeader}>{prettyDay}</Text>
        {selectedBookings.length ? <View style={s.dayCount}><Text style={s.dayCountText}>{selectedBookings.length}</Text></View> : null}
      </View>
      {selectedBookings.length === 0 ? (
        <Text style={s.empty}>No bookings on this day.</Text>
      ) : (
        <View style={{ gap: 10, paddingBottom: 8 }}>
          {selectedBookings.map((b) => (
            <BookingCard key={b.id} item={b} canManage={canManage} onCancel={onCancel} onCheckout={onCheckout} onReturn={onReturn} />
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  navBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: P.card, borderWidth: 1, borderColor: P.line },
  monthLabel: { fontSize: sf(19), fontWeight: '800', color: P.ink, letterSpacing: -0.3, marginLeft: 6 },
  todayBtn: { paddingVertical: 7, paddingHorizontal: 15, borderRadius: 999, backgroundColor: P.card, borderWidth: 1, borderColor: P.line },
  todayText: { fontSize: sf(12.5), fontWeight: '800', color: P.ink },

  card: { backgroundColor: P.card, borderRadius: 18, borderWidth: 1.5, borderColor: P.lineStrong, overflow: 'hidden', shadowColor: '#2A2320', shadowOpacity: 0.10, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  weekRow: { flexDirection: 'row', backgroundColor: P.wknd, borderBottomWidth: 1.5, borderBottomColor: P.lineStrong },
  weekday: { flex: 1, fontSize: sf(11), fontWeight: '800', color: P.muted, textTransform: 'uppercase', letterSpacing: 0.6, paddingVertical: 11, paddingHorizontal: 12 },

  weekWrap: { position: 'relative' },
  weekBorderB: { borderBottomWidth: 1.5, borderBottomColor: P.line },
  daynums: { flexDirection: 'row' },
  dcell: { flex: 1, paddingHorizontal: 10, paddingTop: 8, backgroundColor: P.cell },
  dcellWknd: { backgroundColor: P.wknd },
  dcellBorderR: { borderRightWidth: 1.5, borderRightColor: P.line },
  dcellSel: { backgroundColor: P.accentSoft },
  dn: { fontSize: sf(13), fontWeight: '800', color: P.ink },
  dnOut: { color: P.faint, fontWeight: '600' },
  todayPill: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7, backgroundColor: P.accent, alignItems: 'center', justifyContent: 'center' },
  todayNum: { fontSize: sf(12.5), fontWeight: '900', color: '#fff' },

  bars: { position: 'absolute', top: TOPPAD, left: 4, right: 4, bottom: 2 },
  bar: { position: 'absolute', height: 22, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6, borderRadius: 3, overflow: 'hidden', shadowColor: '#2A2320', shadowOpacity: 0.18, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  barRL: { borderTopLeftRadius: 11, borderBottomLeftRadius: 11 },
  barRR: { borderTopRightRadius: 11, borderBottomRightRadius: 11 },
  barPending: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.9)', borderStyle: 'dashed' },
  barAv: { width: 16, height: 16, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.28)', alignItems: 'center', justifyContent: 'center' },
  barAvText: { fontSize: sf(8.5), fontWeight: '900', color: '#fff' },
  barText: { fontSize: sf(11), fontWeight: '800', color: '#fff', flexShrink: 1 },

  dayHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 20, marginBottom: 12 },
  dayDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: P.accent },
  dayHeader: { fontSize: sf(15), fontWeight: '800', color: P.ink, letterSpacing: -0.2 },
  dayCount: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: P.accentSoft, alignItems: 'center', justifyContent: 'center' },
  dayCountText: { fontSize: sf(11), fontWeight: '900', color: P.accent },
  empty: { fontSize: sf(13.5), color: P.muted, paddingVertical: 6 },
});
