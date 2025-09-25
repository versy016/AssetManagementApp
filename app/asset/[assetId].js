// app/(tabs)/asset/[assetId].js
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Linking,
  Alert,
  Platform,
  ActivityIndicator,
} from 'react-native';
import * as LinkingExpo from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import { differenceInCalendarDays, format, isValid, parseISO } from 'date-fns';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_BASE_URL } from '../../inventory-api/apiBase';

const DEFAULT_ADDRESS = '4/11 Ridley Street, Hindmarsh, South Australia';

const STATUS_CONFIG = {
  in_service:        { label: 'In Service',         bg: '#e0f2fe', fg: '#075985', icon: 'build-circle' },
  end_of_life:       { label: 'End of Life',        bg: '#ede9fe', fg: '#5b21b6', icon: 'block' },
  repair:      { label: 'Repair',       bg: '#ffedd5', fg: '#9a3412', icon: 'build' },
  maintenance: { label: 'Maintenance',  bg: '#fef9c3', fg: '#854d0e', icon: 'build' },
};
function normalizeStatus(s) {
  if (!s) return 'in_service';
  const key = String(s).toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');

  // Back-compat / synonyms mapping
  const alias = {
    // exact new set
    in_service: 'in_service',
    end_of_life: 'end_of_life',
    repair: 'repair',
    maintenance: 'maintenance',

    // legacy/common variants
    available: 'in_service',
    checked_out: 'repair', // or pick 'in_service' if you prefer
    rented: 'repair',
    reserved: 'in_service',
    lost: 'end_of_life',
    retired: 'end_of_life',
  };

  return alias[key] || 'in_service';
}

function StatusBadge({ status }) {
  const key = normalizeStatus(status);
  const cfg = STATUS_CONFIG[key] || STATUS_CONFIG.available;
  return (
    <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
      <MaterialIcons name={cfg.icon} size={16} color={cfg.fg} style={{ marginRight: 6 }} />
      <Text style={[styles.statusText, { color: cfg.fg }]}>{cfg.label}</Text>
    </View>
  );
}


/* ---------- Cross-platform clipboard ---------- */
async function copyText(text, successMsg = 'Copied to clipboard') {
  try {
    if (Platform.OS === 'web') {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // legacy fallback
        const el = document.createElement('textarea');
        el.value = text;
        el.setAttribute('readonly', '');
        el.style.position = 'absolute';
        el.style.left = '-9999px';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      window.alert(successMsg);
      return;
    }
    if (Clipboard?.setString) {
      Clipboard.setString(text);
      Alert.alert('Copied', successMsg);
      return;
    }
    throw new Error('Clipboard unavailable');
  } catch {
    Platform.OS === 'web'
      ? window.prompt('Copy this text:', text)
      : Alert.alert('Copy failed', 'Could not copy to clipboard.');
  }
}

/** Platform-aware map preview.
 * - Web: <iframe> Google Maps embed
 * - Native: dynamically require WebView to avoid web bundling error
 */
function MapPreview({ location }) {
  const url = `https://www.google.com/maps?q=${encodeURIComponent(location)}&z=16&output=embed`;

  if (Platform.OS === 'web') {
    // Render a raw iframe on web; RNW will pass it through to the DOM.
    return (
      <View style={styles.mapCard}>
        <div style={{ width: '100%', height: '100%' }}>
          <iframe
            title="map"
            src={url}
            style={{ border: 0, width: '100%', height: '100%', borderRadius: 10 }}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </View>
    );
  }

  // Native (iOS/Android): render an iframe inside WebView.
  // Google requires the embed URL to be used within an iframe; loading it directly in WebView triggers an error.
  const { WebView } = require('react-native-webview');
  const html = `<!doctype html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <style>html, body, .wrap { height: 100%; margin: 0; padding: 0; }</style>
      </head>
      <body>
        <div class="wrap">
          <iframe
            src="${url}"
            width="100%"
            height="100%"
            style="border:0;"
            allowfullscreen
            loading="lazy"
            referrerpolicy="no-referrer-when-downgrade"
          ></iframe>
        </div>
      </body>
    </html>`;
  return (
    <View style={styles.mapCard}>
      <WebView
        originWhitelist={["*"]}
        source={{ html, baseUrl: 'https://www.google.com' }}
        style={styles.map}
        automaticallyAdjustContentInsets={false}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
      />
    </View>
  );
}

export default function AssetDetailPage() {
  const { assetId } = useLocalSearchParams();
  const [asset, setAsset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const router = useRouter();
  const navigation = useNavigation();

  const load = useCallback(async () => {
    if (!assetId) return;
    setLoading(true);
    setErr('');
    try {
      const res = await fetch(`${API_BASE_URL}/assets/${assetId}`);
      if (!res.ok) throw new Error(`Failed to load asset (${res.status})`);
      const data = await res.json();
      setAsset(data);
    } catch (e) {
      setErr(e.message || 'Failed to load asset');
    } finally {
      setLoading(false);
    }
  }, [assetId]);

  useEffect(() => { load(); }, [load]);

  const customFieldEntries = useMemo(() => {
    if (!asset?.fields || typeof asset.fields !== 'object') return [];
    return Object.entries(asset.fields);
  }, [asset]);

  const linkedAssetIds = useMemo(() => {
    if (!asset?.fields || typeof asset.fields !== 'object') return [];
    const f = asset.fields;
    const candidates = new Set();
    ['linked_asset_id','related_asset_id','related_assets','parent_asset_id','child_asset_ids','paired_with']
      .forEach((k) => {
        const v = f[k];
        if (!v) return;
        if (Array.isArray(v)) v.forEach((x) => typeof x === 'string' && x !== asset?.id && candidates.add(x));
        else if (typeof v === 'string' && v !== asset?.id) candidates.add(v);
      });
    return Array.from(candidates);
  }, [asset]);

  const renderValue = (v) => {
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    return v ?? 'N/A';
  };

  const handleBack = () => {
    if (navigation?.canGoBack?.()) {
      router.back();
    } else {
      router.replace({ pathname: '/Inventory', params: { tab: 'all' } });
    }
  };

  const confirmDelete = async () => {
    if (Platform.OS === 'web') {
      return window.confirm('Delete this asset? This cannot be undone.');
    }
    return new Promise((resolve) => {
      Alert.alert('Delete asset', 'This cannot be undone. Continue?', [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
      ]);
    });
  };

  const handleDelete = async () => {
    const ok = await confirmDelete();
    if (!ok) return;
    try {
      const res = await fetch(`${API_BASE_URL}/assets/${asset.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || 'Failed to delete');
      }
      if (Platform.OS !== 'web') Alert.alert('Deleted', 'Asset removed.');
      router.replace({ pathname: '/Inventory', params: { tab: 'all' } });
    } catch (e) {
      Alert.alert('Error', e.message || 'Failed to delete asset');
    }
  };

  const copyId = () => copyText(asset?.id || assetId, 'Asset ID copied');
  const copyDeepLink = () => {
    const _app = LinkingExpo.createURL(`check-in/${asset?.id || assetId}`);
    const web = `https://ec2-3-25-81-127.ap-southeast-2.compute.amazonaws.com/check-in/${asset?.id || assetId}`;
    copyText(web, 'Shareable link copied');
  };

  const displayLocation = (asset?.location && String(asset.location).trim()) || DEFAULT_ADDRESS;

  const openMaps = () => {
    const q = encodeURIComponent(displayLocation);
    const url = Platform.select({
      ios: `http://maps.apple.com/?q=${q}`,
      android: `geo:0,0?q=${q}`,
      default: `https://www.google.com/maps/search/?api=1&query=${q}`,
    });
    Linking.openURL(url).catch(() => Alert.alert('Could not open maps'));
  };

  const statusKey = normalizeStatus(asset?.status);
  const nextService = (() => {
    const raw = asset?.next_service_date;
    if (!raw) return null;
    const d = typeof raw === 'string' ? parseISO(raw) : new Date(raw);
    return isValid(d) ? d : null;
  })();
  const overdueDays = nextService ? differenceInCalendarDays(new Date(), nextService) : 0;
  const isOverdue = nextService ? overdueDays > 0 : false;

  if (loading) {
    return (
      <SafeAreaView style={styles.centerWrap}>
        <ActivityIndicator size="large" color="#1E90FF" />
        <Text style={{ marginTop: 12, color: '#666' }}>Loading asset…</Text>
      </SafeAreaView>
    );
  }

  if (err) {
    return (
      <SafeAreaView style={styles.centerWrap}>
        <Text style={{ color: '#b00020', marginBottom: 12 }}>{err}</Text>
        <TouchableOpacity onPress={load} style={[styles.actionBtn, { backgroundColor: '#1E90FF', paddingHorizontal: 22 }]}>
          <Text style={styles.actionText}>Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (!asset) {
    return (
      <SafeAreaView style={styles.centerWrap}>
        <Text>No asset found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack}>
            <MaterialIcons name="arrow-back" size={24} color="#1E90FF" />
          </TouchableOpacity>
          <Text style={styles.title}>Asset Details</Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={styles.detailCard}>
          {/* Title Row — status badge removed to avoid duplication */}
          <View style={styles.titleRow}>
            <Text style={styles.assetName}>
              {asset.asset_types?.name || 'Asset'} · SN: {asset.serial_number || 'N/A'}
            </Text>
          </View>

          {/* Meta chips */}
          <View style={styles.metaRow}>
            <TouchableOpacity onPress={copyId} style={styles.metaChip}>
              <MaterialIcons name="fingerprint" size={16} color="#1E90FF" />
              <Text style={styles.metaChipText}>ID: {asset.id}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={copyDeepLink} style={styles.metaChip}>
              <MaterialIcons name="link" size={16} color="#1E90FF" />
              <Text style={styles.metaChipText}>Copy Link</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={openMaps} style={styles.metaChip}>
              <MaterialIcons name="place" size={16} color="#1E90FF" />
              <Text style={styles.metaChipText}>Maps</Text>
            </TouchableOpacity>
          </View>

          <Image
            source={{ uri: asset.image_url || 'https://via.placeholder.com/150' }}
            style={styles.image}
          />

          {/* Core fields */}
          <Row label="Status" value={<StatusBadge status={asset.status} />} />
          <Row label="Assigned To" value={asset.users?.name || 'N/A'} />
          <Row label="Location" value={displayLocation} />
          <Row label="Model" value={asset.model || 'N/A'} />
          <Row
            label="Date Purchased"
            value={asset.date_purchased ? String(asset.date_purchased).split('T')[0] : 'N/A'}
          />
          <Row
            label="Next Service"
            value={
              nextService ? (
                <Text style={{ color: isOverdue ? '#b00020' : '#065f46', fontWeight: '600' }}>
                  {format(nextService, 'yyyy-MM-dd')}
                  {isOverdue ? `  • ${overdueDays}d overdue` : ''}
                </Text>
              ) : (
                'N/A'
              )
            }
            rightAlign={false}
          />
          <Row label="Description" value={asset.description || 'No description'} rightAlign={false} />
          <Row label="Notes" value={asset.notes || '—'} rightAlign={false} />

          {/* Dynamic fields */}
          {customFieldEntries.length > 0 && (
            <>
              <Text style={[styles.sectionH, { marginTop: 16 }]}>Additional Fields</Text>
              {customFieldEntries.map(([slug, value]) => (
                <Row
                  key={slug}
                  label={slug.replace(/_/g, ' ')}
                  value={renderValue(value)}
                  rightAlign={false}
                />
              ))}
            </>
          )}

          {/* Linked assets */}
          {linkedAssetIds.length > 0 && (
            <>
              <Text style={[styles.sectionH, { marginTop: 18 }]}>Linked Assets</Text>
              <View style={styles.linkedWrap}>
                {linkedAssetIds.map((id) => (
                  <TouchableOpacity
                    key={id}
                    style={styles.linkedChip}
                    onPress={() =>
                      router.push({ pathname: '/(tabs)/asset/[assetId]', params: { assetId: id } })
                    }
                  >
                    <MaterialIcons name="link" size={16} color="#1E90FF" />
                    <Text style={styles.linkedChipText}>{id}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {/* Docs */}
          {asset.documentation_url && (
            <TouchableOpacity
              onPress={() => {
                Linking.openURL(asset.documentation_url).catch((err) => {
                  console.error('Error opening URL:', err);
                  Alert.alert('Could not open the document');
                });
              }}
              style={styles.documentButton}
            >
              <Text style={styles.documentText}>📄 View Attached Document</Text>
            </TouchableOpacity>
          )}
          {/* Map (works on all platforms) */}
          <MapPreview location={displayLocation} />
          {/* Smart actions */}
          <View style={styles.actionsRow}>
            {normalizeStatus(asset?.status) === 'available' ? (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#16a34a' }]}
                onPress={() =>
                  router.push({ pathname: '/qr-scanner', params: { intent: 'check-out', assetId: asset.id } })
                }
              >
                <Text style={styles.actionText}>✔︎ Check Out</Text>
              </TouchableOpacity>
            ) : normalizeStatus(asset?.status) === 'rented' ? (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#1E90FF' }]}
                onPress={() => router.push(`/check-in/${asset.id}`)}
              >
                <Text style={styles.actionText}>↩︎ Check In</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#1E90FF' }]}
                onPress={() => {
                  router.push({
                    pathname: '/asset/new',
                    params: { fromAssetId: asset.id }, // Pass asset ID to NewAsset page
                  });
                }}
              >
                <Text style={{ color: 'white', fontWeight: 'bold' }}>📋 Copy Asset</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: '#FFA500' }]}
              onPress={() =>
                router.push({ pathname: '/asset/edit', params: { assetId: asset.id } })
              }
            >
              <Text style={styles.actionText}>✏️ Edit</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: '#b00020' }]}
              onPress={handleDelete}
            >
              <Text style={styles.actionText}>🗑 Delete</Text>
            </TouchableOpacity>
          </View>

          {/* Helpful shortcuts
          <View style={{ marginTop: 12, flexDirection: 'row', flexWrap: 'wrap' }}>
            <Shortcut
              icon="search"
              label="Search with this ID"
              onPress={() => router.push({ pathname: '/search', params: { query: asset.id } })}
            />
            {asset.model ? (
              <Shortcut
                icon="tune"
                label="Find same model"
                onPress={() => router.push({ pathname: '/search', params: { model: asset.model } })}
              />
            ) : null}
          </View> */}
          
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, rightAlign = true }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.label}>{label}:</Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text style={[styles.value, rightAlign ? { textAlign: 'right' } : null]}>{value ?? 'N/A'}</Text>
      ) : (
        <View style={{ flex: 1, alignItems: rightAlign ? 'flex-end' : 'flex-start' }}>{value}</View>
      )}
    </View>
  );
}

function Shortcut({ icon, label, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.shortcut}>
      <MaterialIcons name={icon} size={16} color="#1E90FF" />
      <Text style={styles.shortcutText}>{label}</Text>
    </TouchableOpacity>
  );
}

/* ----------------- styles ----------------- */
const styles = StyleSheet.create({
  centerWrap: {
    flex: 1,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderBottomColor: '#ddd',
    borderBottomWidth: 1,
    paddingBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginLeft: 12,
    color: '#1E90FF',
  },
  detailCard: {
    backgroundColor: '#fff',
    padding: 10,
    margin: 16,
    borderRadius: 10,
    elevation: 2,
  },
  image: { 
    height: 200,
    borderRadius: 10,
    marginBottom: 14,
    resizeMode: 'contain',
    backgroundColor: '#eee',
  },
  mapCard: {
    height: 220,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#eee',
    marginTop: 16,
    marginBottom: 16,
  },
  map: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 8,
  },
  assetName: {
    flex: 1,
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginRight: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
  },
  statusText: { fontWeight: '700', fontSize: 12 },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#f0f8ff',
    borderRadius: 14,
  },
  metaChipText: { color: '#1E90FF', fontWeight: '600', fontSize: 12 },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginVertical: 8,
    gap: 12,
  },
  label: {
    fontWeight: '700',
    color: '#555',
    width: '40%',
  },
  value: {
    color: '#111',
    width: '60%',
    textAlign: 'right',
  },
  sectionH: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  linkedWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  linkedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#eef6ff',
    borderRadius: 14,
  },
  linkedChipText: { color: '#1E90FF', fontWeight: '600', fontSize: 12 },

  documentButton: {
    marginTop: 16,
    marginBottom: 16,
    padding: 2,
    backgroundColor: '#f0f8ff',
    borderRadius: 8,
    alignItems: 'center',
  },
  documentText: {
    color: '#1E90FF',
    fontWeight: 'bold',
  },
  actionsRow: {
    flexDirection: 'row', justifyContent: 'center', gap: 8,
    padding: 16, borderTopColor: '#ddd', borderTopWidth: 1, backgroundColor: '#fff',
  },
  actionBtn: {
    flex: 1,
    minHeight: 50,
    minWidth: 120,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 3, height: 3 } },
      android: { elevation: 3 },
      default: {},
    }),
  },
  actionText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  shortcut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#eef6ff',
    borderRadius: 14,
    marginRight: 8,
    marginBottom: 8,
  },
  shortcutText: { color: '#1E90FF', fontWeight: '600', fontSize: 12 },
});
