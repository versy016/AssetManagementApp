// components/bookings/BookingsGantt.js
// Gantt / timeline view of bookings for the web dashboard. One row per asset; each
// booking is a colour bar on a fixed day-width axis that scrolls horizontally, with
// a Day / Week / Month zoom. The asset label column stays pinned on the left. Two-tier
// header (period + tick), weekend shading, week gridlines and a "today" marker give
// time context. Hover a bar for a tooltip; click it for the full detail modal.
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { sf } from '../../constants/uiTheme';
import BookingDetailModal from './BookingDetailModal';
import {
  P, colorForAsset, initialsOf, STATUS_LABEL, HIDDEN_STATUSES,
  ymd, addDays, todayUtc, parseYmd, dayDiff, fmtD,
} from './bookingVisuals';

// Zoom levels: px-per-day plus how much calendar padding to show around the bookings.
const ZOOM = {
  day:   { key: 'day',   label: 'Day',   dayW: 38, padDays: 7,  minSpan: 21 },
  week:  { key: 'week',  label: 'Week',  dayW: 14, padDays: 14, minSpan: 56 },
  month: { key: 'month', label: 'Month', dayW: 4.6, padDays: 31, minSpan: 180 },
};
const HH_TOP = 28;  // period band (month, or year in month-zoom)
const HH_TICK = 26; // tick labels (days / week-starts / months)
const HH = HH_TOP + HH_TICK;
const RH = 64;      // row height — roomy enough for a 2-line label + tall bar
const BAR_H = 36;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const startOfMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

export default function BookingsGantt({ items, canManage, onCancel, onCheckout, onReturn, onEdit }) {
  const { width: winW } = useWindowDimensions();
  const LW = winW < 680 ? 120 : 200; // pinned label column width
  const [zoom, setZoom] = useState('day');
  const [modalBooking, setModalBooking] = useState(null);
  const [tip, setTip] = useState(null); // { b, x, y } — web hover tooltip

  const Z = ZOOM[zoom];

  const model = useMemo(() => {
    const visible = (items || []).filter(
      (b) => b.dateFrom && b.dateTo && !HIDDEN_STATUSES.has(String(b.status).toUpperCase()),
    );
    if (!visible.length) return null;

    let min = null; let max = null;
    visible.forEach((b) => {
      if (!min || b.dateFrom < min) min = b.dateFrom;
      if (!max || b.dateTo > max) max = b.dateTo;
    });
    // Snap the axis to whole weeks (Mon–Sun) around the booking span, padded by zoom.
    const minD = parseYmd(min); const maxD = parseYmd(max);
    const start = addDays(minD, -((minD.getUTCDay() + 6) % 7) - Z.padDays);
    let end = addDays(maxD, (6 - ((maxD.getUTCDay() + 6) % 7)) + Z.padDays);
    if (dayDiff(ymd(end), ymd(start)) + 1 < Z.minSpan) end = addDays(start, Z.minSpan - 1);
    const startY = ymd(start);
    const total = dayDiff(ymd(end), startY) + 1;

    // One lane per asset (an asset can't be double-booked), sorted by name.
    const groups = new Map();
    visible.forEach((b) => {
      const key = b.assetId || b.id;
      if (!groups.has(key)) {
        groups.set(key, { key, assetId: b.assetId, name: b.assetTypeName || b.model || 'Asset', bookings: [] });
      }
      groups.get(key).bookings.push(b);
    });
    const rows = Array.from(groups.values()).sort((a, b) => String(a.name).localeCompare(String(b.name)));

    // Weekend shading + week rules only make sense when days are wide enough to see.
    const showWeekends = Z.dayW >= 10;
    const showWeekLines = Z.dayW >= 6;
    const days = [];
    if (showWeekends) {
      for (let i = 0; i < total; i += 1) {
        const dow = addDays(start, i).getUTCDay();
        if (dow === 0 || dow === 6) days.push(i);
      }
    }
    const weekLines = [];
    if (showWeekLines) for (let i = 7; i < total; i += 7) weekLines.push(i);

    // Month segments — the period band in day/week zoom, and the ticks in month zoom.
    const months = [];
    let m = startOfMonth(start);
    while (m <= end) {
      const next = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
      const segStart = m < start ? start : m;
      const segEnd = addDays(next, -1) > end ? end : addDays(next, -1);
      months.push({
        left: dayDiff(ymd(segStart), startY) * Z.dayW,
        width: (dayDiff(ymd(segEnd), ymd(segStart)) + 1) * Z.dayW,
        short: m.toLocaleDateString('en-AU', { month: 'short', timeZone: 'UTC' }),
        long: m.toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
        year: String(m.getUTCFullYear()),
      });
      m = next;
    }

    // Top band + tick row depend on the zoom.
    let bands = []; let ticks = [];
    if (zoom === 'day') {
      bands = months.map((mo) => ({ left: mo.left, width: mo.width, label: mo.long }));
      for (let i = 0; i < total; i += 1) {
        const d = addDays(start, i);
        const dow = d.getUTCDay();
        ticks.push({ left: i * Z.dayW, width: Z.dayW, label: String(d.getUTCDate()), muted: dow === 0 || dow === 6, center: true });
      }
    } else if (zoom === 'week') {
      bands = months.map((mo) => ({ left: mo.left, width: mo.width, label: mo.long }));
      for (let i = 0; i < total; i += 7) {
        ticks.push({ left: i * Z.dayW, width: 7 * Z.dayW, label: fmtD(ymd(addDays(start, i))), center: true });
      }
    } else {
      // Month zoom: years on top, month initials as ticks.
      const byYear = new Map();
      months.forEach((mo) => {
        const cur = byYear.get(mo.year);
        if (!cur) byYear.set(mo.year, { left: mo.left, right: mo.left + mo.width, label: mo.year });
        else cur.right = mo.left + mo.width;
      });
      bands = Array.from(byYear.values()).map((y) => ({ left: y.left, width: y.right - y.left, label: y.label }));
      ticks = months.map((mo) => ({ left: mo.left, width: mo.width, label: mo.short, center: true }));
    }

    const todayY = ymd(todayUtc());
    const todayX = todayY >= startY && todayY <= ymd(end) ? dayDiff(todayY, startY) * Z.dayW : null;

    return {
      rows, total, startY, endY: ymd(end),
      days, weekLines, months, bands, ticks, todayX,
      totalW: total * Z.dayW, dayW: Z.dayW,
    };
  }, [items, zoom, Z]);

  if (!model) {
    return (
      <View style={s.empty}>
        <Text style={s.emptyText}>No bookings to plot on the timeline.</Text>
      </View>
    );
  }

  const contentH = HH + model.rows.length * RH;

  const barFor = (b) => {
    const from = b.dateFrom < model.startY ? model.startY : b.dateFrom;
    const to = b.dateTo > model.endY ? model.endY : b.dateTo;
    const offset = clamp(dayDiff(from, model.startY), 0, model.total);
    const dur = clamp(dayDiff(to, from) + 1, 1, model.total - offset);
    return { left: offset * model.dayW, width: Math.max(model.dayW, dur * model.dayW) };
  };

  const openTip = (b) => (e) => setTip({ b, x: e?.nativeEvent?.clientX ?? 0, y: e?.nativeEvent?.clientY ?? 0 });
  const moveTip = (b) => (e) => setTip((t) => (t && t.b.id === b.id ? { ...t, x: e?.nativeEvent?.clientX ?? t.x, y: e?.nativeEvent?.clientY ?? t.y } : t));
  const closeTip = () => setTip(null);

  return (
    <View>
      {/* Zoom switch */}
      <View style={s.toolbar}>
        <View style={s.seg}>
          {Object.values(ZOOM).map((z) => (
            <TouchableOpacity
              key={z.key}
              style={[s.segBtn, zoom === z.key && s.segBtnOn]}
              onPress={() => { closeTip(); setZoom(z.key); }}
              activeOpacity={0.8}
            >
              <Text style={[s.segText, zoom === z.key && s.segTextOn]}>{z.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={{ flex: 1 }} />
        <Text style={s.rangeText}>{fmtD(model.startY)} – {fmtD(model.endY)}</Text>
      </View>

      <View style={s.card}>
        <View style={[s.outer, { height: contentH }]}>
          {/* Pinned asset column */}
          <View style={[s.leftCol, { width: LW }]}>
            <View style={[s.leftHead, { height: HH }]}><Text style={s.headLabel}>Asset</Text></View>
            {model.rows.map((row, ri) => (
              <View key={row.key} style={[s.leftCell, { height: RH }, ri < model.rows.length - 1 && s.cellBorder]}>
                <View style={s.leftNameRow}>
                  <View style={[s.swatch, { backgroundColor: colorForAsset(row.assetId) }]} />
                  <Text style={s.rowName} numberOfLines={1}>{row.name}</Text>
                </View>
                {row.assetId ? <Text style={s.rowId} numberOfLines={1}>{row.assetId}</Text> : null}
              </View>
            ))}
          </View>

          {/* Scrollable timeline */}
          <View style={{ flex: 1 }}>
            <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator style={{ height: contentH }}>
              <View style={{ width: model.totalW, height: contentH }}>
                {/* Background: weekend shading + gridlines + today (full height) */}
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                  {model.days.map((i) => (
                    <View key={`wd${i}`} style={[s.weekendCol, { left: i * model.dayW, width: model.dayW }]} />
                  ))}
                  {model.months.map((mo, i) => (
                    i > 0 ? <View key={`ml${i}`} style={[s.monthLine, { left: mo.left }]} /> : null
                  ))}
                  {model.weekLines.map((i) => (
                    <View key={`wl${i}`} style={[s.weekLine, { left: i * model.dayW }]} />
                  ))}
                  {model.todayX != null ? <View style={[s.todayLine, { left: model.todayX }]} /> : null}
                </View>

                {/* Two-tier header: period band + ticks */}
                <View style={[s.headBand, { height: HH_TOP }]}>
                  {model.bands.map((bd, i) => (
                    <View key={`b${i}`} style={[s.bandLabelWrap, { left: bd.left, width: bd.width }]}>
                      <Text style={s.bandLabel} numberOfLines={1}>{bd.label}</Text>
                    </View>
                  ))}
                </View>
                <View style={[s.headTicks, { top: HH_TOP, height: HH_TICK }]}>
                  {model.ticks.map((tk, i) => (
                    <View key={`t${i}`} style={[s.tickWrap, { left: tk.left, width: tk.width }]}>
                      <Text style={[s.tickLabel, tk.muted && s.tickMuted]} numberOfLines={1}>{tk.label}</Text>
                    </View>
                  ))}
                </View>

                {/* Rows with bars */}
                <View style={{ marginTop: HH }}>
                  {model.rows.map((row, ri) => (
                    <View key={row.key} style={[s.row, { height: RH }, ri < model.rows.length - 1 && s.cellBorder]}>
                      {row.bookings.map((b) => {
                        const pos = barFor(b);
                        const color = colorForAsset(b.assetId);
                        const pending = String(b.status).toUpperCase() === 'REQUESTED';
                        const hoverProps = Platform.OS === 'web'
                          ? { onMouseEnter: openTip(b), onMouseMove: moveTip(b), onMouseLeave: closeTip }
                          : {};
                        const showAvatar = pos.width >= 58;
                        const showLabel = pos.width >= 96;
                        return (
                          <TouchableOpacity
                            key={b.id}
                            activeOpacity={0.85}
                            onPress={() => { closeTip(); setModalBooking(b); }}
                            {...hoverProps}
                            style={[s.bar, { backgroundColor: color, left: pos.left, width: pos.width }, pending && s.barPending]}
                          >
                            {showAvatar ? (
                              <View style={s.barAv}><Text style={s.barAvText}>{initialsOf(b.bookedByName)}</Text></View>
                            ) : null}
                            {showLabel ? (
                              <View style={{ flexShrink: 1, minWidth: 0 }}>
                                <Text style={s.barText} numberOfLines={1}>{fmtD(b.dateFrom)} – {fmtD(b.dateTo)}</Text>
                                {b.project && pos.width >= 190 ? (
                                  <Text style={s.barSub} numberOfLines={1}>{b.project}</Text>
                                ) : null}
                              </View>
                            ) : null}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ))}
                </View>
              </View>
            </ScrollView>
          </View>
        </View>

        <Text style={s.hint}>
          {Platform.OS === 'web'
            ? 'Scroll sideways to move through time · hover a booking for a quick look · click for details.'
            : 'Scroll sideways to move through time · tap a booking for details.'}
        </Text>
      </View>

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
            {tip.b.serialNumber ? <Text style={s.tipSub} numberOfLines={1}>SN: {tip.b.serialNumber}</Text> : null}
            <Text style={s.tipSub} numberOfLines={1}>{fmtD(tip.b.dateFrom)} – {fmtD(tip.b.dateTo)}</Text>
            <Text style={s.tipSub} numberOfLines={1}>{tip.b.bookedByName || 'Unknown'}</Text>
            {tip.b.project ? <Text style={s.tipSub} numberOfLines={1}>{tip.b.project}</Text> : null}
            <Text style={s.tipStatus}>{STATUS_LABEL[String(tip.b.status).toUpperCase()] || String(tip.b.status || '')}</Text>
          </View>
        </View>
      ) : null}

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
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  seg: { flexDirection: 'row', borderWidth: 1, borderColor: P.line, borderRadius: 10, overflow: 'hidden', backgroundColor: P.card },
  segBtn: { paddingVertical: 7, paddingHorizontal: 16 },
  segBtnOn: { backgroundColor: P.accent },
  segText: { fontSize: sf(13), fontWeight: '800', color: P.muted },
  segTextOn: { color: '#fff' },
  rangeText: { fontSize: sf(12.5), fontWeight: '700', color: P.muted },

  card: { backgroundColor: P.card, borderRadius: 18, borderWidth: 1.5, borderColor: P.lineStrong, overflow: 'hidden', shadowColor: '#2A2320', shadowOpacity: 0.10, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  outer: { flexDirection: 'row' },

  leftCol: { borderRightWidth: 1.5, borderRightColor: P.lineStrong, backgroundColor: P.card, zIndex: 2 },
  leftHead: { justifyContent: 'flex-end', paddingHorizontal: 12, paddingBottom: 6, backgroundColor: P.wknd, borderBottomWidth: 1.5, borderBottomColor: P.lineStrong },
  leftCell: { justifyContent: 'center', paddingHorizontal: 12 },
  leftNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  headLabel: { fontSize: sf(11), fontWeight: '800', color: P.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  rowName: { fontSize: sf(13.5), fontWeight: '800', color: P.ink, flexShrink: 1 },
  rowId: { fontSize: sf(11), color: P.muted, marginTop: 2, marginLeft: 18 },
  cellBorder: { borderBottomWidth: 1, borderBottomColor: P.line },

  weekendCol: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(226,213,192,0.30)' },
  monthLine: { position: 'absolute', top: 0, bottom: 0, width: 1.5, backgroundColor: P.lineStrong },
  weekLine: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(216,201,175,0.5)' },
  todayLine: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: P.accent, opacity: 0.9 },

  headBand: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: 'rgba(243,235,221,0.75)', borderBottomWidth: 1, borderBottomColor: P.line },
  bandLabelWrap: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center', paddingLeft: 9 },
  bandLabel: { fontSize: sf(12), fontWeight: '800', color: P.ink, letterSpacing: 0.2 },
  headTicks: { position: 'absolute', left: 0, right: 0, backgroundColor: 'rgba(243,235,221,0.45)', borderBottomWidth: 1.5, borderBottomColor: P.lineStrong },
  tickWrap: { position: 'absolute', top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  tickLabel: { fontSize: sf(10.5), fontWeight: '700', color: P.muted },
  tickMuted: { color: P.faint },

  row: { position: 'relative', justifyContent: 'center' },
  bar: { position: 'absolute', top: (RH - BAR_H) / 2, height: BAR_H, minWidth: 8, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, borderRadius: 10, overflow: 'hidden', shadowColor: '#2A2320', shadowOpacity: 0.18, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  barPending: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.9)', borderStyle: 'dashed' },
  barAv: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.28)', alignItems: 'center', justifyContent: 'center' },
  barAvText: { fontSize: sf(9.5), fontWeight: '900', color: '#fff' },
  barText: { fontSize: sf(11.5), fontWeight: '800', color: '#fff' },
  barSub: { fontSize: sf(10), fontWeight: '600', color: 'rgba(255,255,255,0.85)', marginTop: 1 },

  hint: { fontSize: sf(12.5), color: P.muted, textAlign: 'center', paddingVertical: 12 },

  tip: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', maxWidth: 280, backgroundColor: P.ink, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 11, shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  tipDot: { width: 10, height: 10, borderRadius: 3, marginTop: 3 },
  tipTitle: { fontSize: sf(12.5), fontWeight: '800', color: '#fff' },
  tipSub: { fontSize: sf(11.5), color: '#E8DECF', marginTop: 2 },
  tipStatus: { fontSize: sf(10), fontWeight: '800', color: P.accent, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 },

  empty: { padding: 40, alignItems: 'center', backgroundColor: P.card, borderRadius: 18, borderWidth: 1.5, borderColor: P.lineStrong },
  emptyText: { fontSize: sf(14), color: P.muted, fontWeight: '600' },
});
