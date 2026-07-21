// components/bookings/AssetBookingBanner.js
// Shows the asset's next upcoming (or active) internal booking as a banner on the
// asset detail screen, so anyone viewing the asset sees it's reserved. Renders
// nothing when there's no relevant booking. Self-contained fetch.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, sf } from '../../constants/uiTheme';
import { API_BASE_URL } from '../../inventory-api/apiBase';

const fmt = (ymd) => {
  if (!ymd) return '';
  const d = new Date(`${ymd}T00:00:00`);
  return Number.isNaN(+d) ? ymd : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
};
const todayYmd = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

export default function AssetBookingBanner({ assetId, style }) {
  const [booking, setBooking] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!assetId) { setBooking(null); return undefined; }
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/bookings/availability?asset_id=${encodeURIComponent(assetId)}`);
        const json = await res.json().catch(() => ({}));
        const today = todayYmd();
        const upcoming = (Array.isArray(json.windows) ? json.windows : [])
          .filter((w) => w.kind === 'booking' && w.to && w.to >= today)
          .sort((a, b) => String(a.from).localeCompare(String(b.from)));
        if (!cancelled) setBooking(upcoming[0] || null);
      } catch {
        if (!cancelled) setBooking(null);
      }
    })();
    return () => { cancelled = true; };
  }, [assetId]);

  if (!booking) return null;
  const active = booking.from <= todayYmd();
  const pending = String(booking.status || '').toUpperCase() === 'REQUESTED';
  return (
    <View style={[styles.banner, style]}>
      <View style={styles.icon}><MaterialIcons name="event" size={18} color="#fff" /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>
          {active ? 'Out on booking' : 'Booked'}
          {booking.label ? ` · ${booking.label}` : ''}
        </Text>
        <Text style={styles.sub}>
          {fmt(booking.from)} → {booking.to ? fmt(booking.to) : 'open'}{pending ? ' · pending approval' : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: Colors.infoBg, borderWidth: 1, borderColor: Colors.infoBorder, borderRadius: Radius.md, padding: 11 },
  icon: { width: 30, height: 30, borderRadius: 8, backgroundColor: Colors.infoFg, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: sf(13.5), fontWeight: '800', color: Colors.text },
  sub: { fontSize: sf(12.5), color: Colors.sub, marginTop: 1 },
});
