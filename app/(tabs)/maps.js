// app/(tabs)/maps.js — All assets with a location on Google Maps; bottom detail only when a pin is selected
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  ActivityIndicator,
  TextInput,
  TouchableOpacity,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenHeader from '../../components/ui/ScreenHeader';
import ScreenWrapper from '../../components/ui/ScreenWrapper';
import ScreenState from '../../components/ui/ScreenState';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import { getAuthHeaders } from '../../utils/authHeaders';
import { Colors, Radius, Shadows, sf } from '../../constants/uiTheme';

const MAX_GEOCODE = 180;
const DEFAULT_CENTER = { lat: -27.5, lng: 133.5 };
const looksShortId = (id) => /^[A-Z0-9]{6,12}$/i.test(String(id || ''));
const isQrReserved = (a) => String(a?.description || '').toLowerCase() === 'qr reserved asset';

/** Maps JavaScript API key (browser). From app.config.js → extra (inventory-api/.env locally). */
function getGoogleMapsWebKey() {
  const fromExtra = Constants.expoConfig?.extra?.googleMapsWebKey;
  if (fromExtra != null && String(fromExtra).trim() !== '') return String(fromExtra).trim();
  return (process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim();
}

let googleMapsWebLoadPromise = null;

function loadGoogleMapsScriptOnce(key) {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.google && window.google.maps) return Promise.resolve();
  if (googleMapsWebLoadPromise) return googleMapsWebLoadPromise;
  googleMapsWebLoadPromise = new Promise((resolve, reject) => {
    const cbName = '__gearOpsMapsInit';
    window[cbName] = () => {
      try {
        delete window[cbName];
      } catch {
        /* ignore */
      }
      googleMapsWebLoadPromise = null;
      resolve();
    };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&callback=${cbName}`;
    s.async = true;
    s.defer = true;
    s.onerror = () => {
      googleMapsWebLoadPromise = null;
      reject(new Error('Google Maps script failed to load'));
    };
    document.head.appendChild(s);
  });
  return googleMapsWebLoadPromise;
}

function pickTitle(a) {
  const m = (a?.model && String(a.model).trim()) || '';
  const d = (a?.description && String(a.description).trim()) || '';
  return m || d || String(a?.id || 'Asset');
}

function pickSubtitle(a) {
  const parts = [a?.id, a?.asset_types?.name, a?.status].filter(Boolean).map(String);
  return parts.join(' · ');
}

export default function MapsTabScreen() {
  const router = useRouter();
  const mapsKey = useMemo(() => getGoogleMapsWebKey(), []);
  const mapDivRef = useRef(null);
  const googleMapRef = useRef(null);
  const googleMarkersRef = useRef([]);
  const selectMarkerRef = useRef(null);
  const [rawAssets, setRawAssets] = useState([]);
  const [markers, setMarkers] = useState([]);
  const [selectedMarker, setSelectedMarker] = useState(null);
  const [loadingList, setLoadingList] = useState(true);
  const [geocoding, setGeocoding] = useState(false);
  const [geoFail, setGeoFail] = useState(0);
  const [geoDisabled, setGeoDisabled] = useState(false);
  const [mapLoadError, setMapLoadError] = useState('');
  const [query, setQuery] = useState('');
  const cacheRef = useRef(new Map());

  selectMarkerRef.current = (m) => setSelectedMarker(m);

  const loadAssets = useCallback(async () => {
    setLoadingList(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE_URL}/assets`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRawAssets(Array.isArray(data) ? data : []);
    } catch {
      setRawAssets([]);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  const withLocation = useMemo(() => {
    return (rawAssets || []).filter((a) => {
      if (!looksShortId(a?.id) || isQrReserved(a)) return false;
      const loc = a?.location != null ? String(a.location).trim() : '';
      return !!loc;
    });
  }, [rawAssets]);

  const filteredForGeocode = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = withLocation;
    if (q) {
      list = list.filter((a) => {
        const blob = [pickTitle(a), pickSubtitle(a), a?.id, a?.status, a?.location]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return blob.includes(q);
      });
    }
    return list.slice(0, MAX_GEOCODE);
  }, [withLocation, query]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!filteredForGeocode.length) {
        setMarkers([]);
        setGeocoding(false);
        return;
      }
      setGeocoding(true);
      setGeoFail(0);
      setGeoDisabled(false);
      const out = [];
      let fails = 0;
      for (const a of filteredForGeocode) {
        if (cancelled) return;
        const addr = String(a.location || '').trim();
        if (!addr) continue;
        let hit = cacheRef.current.get(addr);
        if (!hit) {
          try {
            const enc = encodeURIComponent(addr);
            const res = await fetch(`${API_BASE_URL}/places/geocode?address=${enc}`);
            const j = await res.json().catch(() => ({}));
            if (res.status === 400 && String(j?.error || '').includes('GOOGLE')) {
              setGeoDisabled(true);
              setGeocoding(false);
              cancelled = true;
              break;
            }
            if (!res.ok || j.lat == null || j.lng == null) {
              fails += 1;
              continue;
            }
            hit = { lat: j.lat, lng: j.lng, formatted: j.formatted_address || addr };
            cacheRef.current.set(addr, hit);
          } catch {
            fails += 1;
            continue;
          }
        }
        out.push({
          id: a.id,
          lat: hit.lat,
          lng: hit.lng,
          title: pickTitle(a),
          subtitle: pickSubtitle(a),
          status: a.status || '',
          address: addr,
          formatted: hit.formatted || addr,
          image_url: a.image_url || '',
        });
      }
      if (!cancelled) {
        setMarkers(out);
        setGeoFail(fails);
        setGeocoding(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filteredForGeocode]);

  useEffect(() => {
    setSelectedMarker((prev) => {
      if (!prev) return null;
      const n = markers.find((x) => x.id === prev.id);
      return n || null;
    });
  }, [markers]);

  // Web: Google Maps
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !mapsKey) return undefined;
    let cancelled = false;

    (async () => {
      setMapLoadError('');
      try {
        await loadGoogleMapsScriptOnce(mapsKey);
      } catch (e) {
        if (!cancelled) setMapLoadError(e?.message || 'Could not load Google Maps');
        return;
      }
      if (cancelled) return;
      const el = mapDivRef.current;
      if (!el || !window.google?.maps) return;

      if (!googleMapRef.current) {
        googleMapRef.current = new window.google.maps.Map(el, {
          center: DEFAULT_CENTER,
          zoom: 4,
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: true,
        });
        window.google.maps.event.addListener(googleMapRef.current, 'click', () => {
          selectMarkerRef.current?.(null);
        });
      }
      const map = googleMapRef.current;
      googleMarkersRef.current.forEach((mk) => mk.setMap(null));
      googleMarkersRef.current = [];

      const bounds = new window.google.maps.LatLngBounds();
      markers.forEach((m) => {
        const marker = new window.google.maps.Marker({
          position: { lat: m.lat, lng: m.lng },
          map,
          title: m.title,
        });
        marker.addListener('click', () => {
          selectMarkerRef.current?.(m);
        });
        googleMarkersRef.current.push(marker);
        bounds.extend(marker.getPosition());
      });

      if (markers.length) {
        map.fitBounds(bounds, { top: 48, right: 48, bottom: 200, left: 48 });
      } else {
        map.setCenter(DEFAULT_CENTER);
        map.setZoom(4);
      }
    })();

    return () => {
      cancelled = true;
      googleMarkersRef.current.forEach((mk) => mk.setMap(null));
      googleMarkersRef.current = [];
    };
  }, [markers, mapsKey]);

  const webViewHtml = useMemo(() => {
    if (!mapsKey) {
      return '<!DOCTYPE html><html><body style="font-family:system-ui;padding:16px">Missing maps key</body></html>';
    }
    const payload = JSON.stringify(markers).replace(/</g, '\\u003c');
    const key = encodeURIComponent(mapsKey);
    return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
<style>html,body,#map{height:100%;width:100%;margin:0;padding:0;}</style>
</head><body>
<div id="map"></div>
<script>
  var MARKERS = ${payload};
  function initMap() {
    var map = new google.maps.Map(document.getElementById('map'), {
      center: { lat: ${DEFAULT_CENTER.lat}, lng: ${DEFAULT_CENTER.lng} },
      zoom: 4,
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: true
    });
    map.addListener('click', function () {
      try {
        if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'clear' }));
      } catch (e) {}
    });
    var bounds = new google.maps.LatLngBounds();
    MARKERS.forEach(function (m) {
      if (m.lat == null || m.lng == null) return;
      var marker = new google.maps.Marker({
        position: { lat: m.lat, lng: m.lng },
        map: map,
        title: m.title || ''
      });
      marker.addListener('click', function () {
        try {
          if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'select', marker: m }));
        } catch (e) {}
      });
      bounds.extend(marker.getPosition());
    });
    if (MARKERS.length) map.fitBounds(bounds);
  }
</script>
<script async defer src="https://maps.googleapis.com/maps/api/js?key=${key}&v=weekly&callback=initMap"></script>
</body></html>`;
  }, [markers, mapsKey]);

  const onWebViewMessage = useCallback((event) => {
    try {
      const raw = event?.nativeEvent?.data;
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.type === 'select' && d.marker) setSelectedMarker(d.marker);
      if (d.type === 'clear') setSelectedMarker(null);
    } catch {
      /* ignore */
    }
  }, []);

  const mapKeyMissing = !mapsKey;

  return (
    <ScreenWrapper style={styles.wrap} edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader title="Asset map" onBack={() => router.push('/(tabs)/dashboard')} backLabel="Back" />
      <View style={styles.toolbar}>
        <View style={styles.statRow}>
          <MaterialIcons name="place" size={18} color={Colors.accent} />
          <Text style={styles.statText}>
            {markers.length} on map
            {withLocation.length ? ` · ${withLocation.length} with address` : ''}
            {geocoding ? ' · Geocoding…' : ''}
            {!geocoding && geoFail > 0 ? ` · ${geoFail} not found` : ''}
          </Text>
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={loadAssets} disabled={loadingList || geocoding}>
          <MaterialIcons name="refresh" size={20} color={Colors.accent} />
        </TouchableOpacity>
      </View>

      {mapKeyMissing ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Set GOOGLE_MAPS_WEB_KEY (or reuse GOOGLE_MAPS_API_KEY / GOOGLE_PLACES_API_KEY) in inventory-api/.env, then restart Expo. Enable Maps JavaScript API for that key. Geocoding still uses your GearOps API.
          </Text>
        </View>
      ) : null}

      {geoDisabled ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Geocoding is not configured on the server. Set GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY on the API.
          </Text>
        </View>
      ) : null}

      {mapLoadError ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{mapLoadError}</Text>
        </View>
      ) : null}

      <View style={styles.searchWrap}>
        <MaterialIcons name="search" size={18} color={Colors.sub} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Filter by name, ID, status, address…"
          placeholderTextColor={Colors.sub2}
          value={query}
          onChangeText={setQuery}
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={12}>
            <MaterialIcons name="close" size={18} color={Colors.sub} />
          </TouchableOpacity>
        ) : null}
      </View>

      {loadingList ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.accent} />
        </View>
      ) : !withLocation.length ? (
        <ScreenState empty icon="place" title="No locations yet" subtitle="Add a location on each asset to see it here." />
      ) : mapKeyMissing ? (
        <View style={[styles.mapShell, styles.center]}>
          <MaterialIcons name="map" size={48} color={Colors.line} />
          <Text style={styles.missingMapHint}>Google Maps will appear here after you add a browser Maps API key.</Text>
        </View>
      ) : (
        <View style={styles.mapShell}>
          {Platform.OS === 'web' ? (
            <div ref={mapDivRef} style={{ flex: 1, width: '100%', minHeight: 420, borderRadius: Radius.lg }} />
          ) : (
            <NativeAssetMapWebView html={webViewHtml} onMessage={onWebViewMessage} />
          )}
          {geocoding ? (
            <View style={styles.mapOverlay}>
              <ActivityIndicator color="#fff" size="large" />
              <Text style={styles.mapOverlayText}>Plotting pins…</Text>
            </View>
          ) : null}
        </View>
      )}

      {selectedMarker ? (
        <View style={styles.detailPanel}>
          <View style={styles.detailPanelHeader}>
            <Text style={styles.detailTitle} numberOfLines={2}>
              {selectedMarker.title}
            </Text>
            <TouchableOpacity onPress={() => setSelectedMarker(null)} hitSlop={12} style={styles.detailClose}>
              <MaterialIcons name="close" size={22} color={Colors.sub} />
            </TouchableOpacity>
          </View>
          {selectedMarker.image_url ? (
            <Image source={{ uri: selectedMarker.image_url }} style={styles.detailThumb} />
          ) : null}
          <Text style={styles.detailSub} numberOfLines={2}>
            {selectedMarker.subtitle}
          </Text>
          {selectedMarker.status ? (
            <Text style={styles.detailStatus}>
              Status: <Text style={styles.detailStatusVal}>{selectedMarker.status}</Text>
            </Text>
          ) : null}
          <Text style={styles.detailAddr} numberOfLines={3}>
            {selectedMarker.formatted || selectedMarker.address}
          </Text>
          <View style={styles.detailActions}>
            <TouchableOpacity style={styles.detailBtn} onPress={() => router.push({ pathname: '/asset/[assetId]', params: { assetId: selectedMarker.id } })}>
              <MaterialIcons name="open-in-new" size={18} color={Colors.card} />
              <Text style={styles.detailBtnText}>Open asset</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.footerHint}>
          <Text style={styles.footerHintText}>Tap a pin on the map to see asset details here.</Text>
        </View>
      )}
    </ScreenWrapper>
  );
}

function NativeAssetMapWebView({ html, onMessage }) {
  const { WebView } = require('react-native-webview');
  return (
    <WebView
      originWhitelist={['*']}
      source={{ html, baseUrl: 'https://maps.google.com' }}
      style={styles.webView}
      automaticallyAdjustContentInsets={false}
      javaScriptEnabled
      domStorageEnabled
      onMessage={onMessage}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: Colors.bg, minHeight: 0 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.line,
  },
  statRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  statText: { flex: 1, fontSize: sf(12), fontWeight: '700', color: Colors.text },
  refreshBtn: { padding: 8, borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.line },
  banner: {
    marginHorizontal: 14,
    marginTop: 8,
    padding: 10,
    borderRadius: Radius.md,
    backgroundColor: Colors.warningBg,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  bannerText: { fontSize: sf(12), color: Colors.warningFg, fontWeight: '600' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 14,
    marginVertical: 8,
    paddingHorizontal: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.card,
  },
  searchIcon: { marginRight: 6 },
  searchInput: { flex: 1, paddingVertical: Platform.OS === 'ios' ? 10 : 8, fontSize: sf(14), color: Colors.text },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  mapShell: {
    flex: 1,
    minHeight: 320,
    marginHorizontal: 14,
    marginBottom: 8,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.chip,
  },
  missingMapHint: { marginTop: 12, textAlign: 'center', paddingHorizontal: 24, color: Colors.sub, fontSize: sf(14), fontWeight: '600' },
  webView: { flex: 1, minHeight: 320 },
  mapOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  mapOverlayText: { color: '#fff', fontWeight: '800', fontSize: sf(13) },
  footerHint: { paddingHorizontal: 16, paddingBottom: 14, paddingTop: 4 },
  footerHintText: { fontSize: sf(12), color: Colors.sub, textAlign: 'center' },
  detailPanel: {
    marginHorizontal: 12,
    marginBottom: Platform.OS === 'ios' ? 20 : 12,
    padding: 14,
    borderRadius: Radius.lg,
    backgroundColor: Colors.card,
    borderWidth: 2,
    borderColor: Colors.line,
    ...Shadows.card,
  },
  detailPanelHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  detailTitle: { flex: 1, fontSize: sf(17), fontWeight: '800', color: Colors.text },
  detailClose: { padding: 4 },
  detailThumb: { width: 72, height: 72, borderRadius: Radius.md, marginTop: 10, backgroundColor: Colors.chip },
  detailSub: { marginTop: 8, fontSize: sf(13), color: Colors.sub, fontWeight: '600' },
  detailStatus: { marginTop: 6, fontSize: sf(12), color: Colors.sub2, fontWeight: '700' },
  detailStatusVal: { color: Colors.text },
  detailAddr: { marginTop: 8, fontSize: sf(13), color: Colors.text, lineHeight: 20 },
  detailActions: { marginTop: 14, flexDirection: 'row', gap: 10 },
  detailBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: Radius.md,
    backgroundColor: Colors.accent,
  },
  detailBtnText: { color: Colors.card, fontWeight: '800', fontSize: sf(14) },
});
