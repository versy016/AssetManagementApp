// [type_id].js - Lists all assets of a specific asset type (enhanced)

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../firebaseConfig';
import ScreenHeader from '../../components/ui/ScreenHeader';
import StatusBadge, {
  STATUS_CONFIG,
  normalizeStatus,
} from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';

/* ---------------------------- main ---------------------------- */
export default function AssetsType() {
  const { type_id, type_name, returnTo } = useLocalSearchParams();
  const normalizedReturnTo = Array.isArray(returnTo) ? returnTo[0] : returnTo;
  const router = useRouter();
  const parseReturnTarget = (target) => {
    if (!target) return null;
    if (typeof target === 'object') return target;
    if (typeof target === 'string') {
      const [path, query = ''] = target.split('?');
      if (!path) return null;
      const params = {};
      if (query) {
        query.split('&').forEach((part) => {
          if (!part) return;
          const [rawKey, rawValue = ''] = part.split('=');
          const key = decodeURIComponent(rawKey || '');
          if (!key) return;
          params[key] = decodeURIComponent(rawValue || '');
        });
      }
      return { pathname: path, params };
    }
    return null;
  };
  const navigateToReturnTarget = (target) => {
    const parsed = parseReturnTarget(target);
    if (!parsed) return false;
    try {
      router.replace(parsed);
      return true;
    } catch {
      return false;
    }
  };

  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [deleteBlockedMessage, setDeleteBlockedMessage] = useState(null);

  // Determine admin via DB role
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      try {
        if (!u) { setIsAdmin(false); return; }
        const res = await fetch(`${API_BASE_URL}/users/${u.uid}`);
        const dbUser = res.ok ? await res.json() : null;
        setIsAdmin(dbUser?.role === 'ADMIN');
      } catch {
        setIsAdmin(false);
      }
    });
    return unsub;
  }, []);

  /* delete type (same logic, nicer feedback) */
  const doDeleteType = async () => {
    if (assets.length > 0) {
      setDeleteBlockedMessage(
        `This asset type has ${assets.length} asset(s). Delete or reassign all assets first, then you can delete the type.`
      );
      return;
    }

    const ok = await new Promise((resolve) => {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        return resolve(window.confirm('Delete this asset type? This cannot be undone.'));
      }
      Alert.alert('Delete asset type', 'This cannot be undone. Continue?', [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
      ]);
    });
    if (!ok) return;

    try {
      const headers = auth.currentUser?.uid ? { 'X-User-Id': auth.currentUser.uid } : {};
      const res = await fetch(`${API_BASE_URL}/asset-types/${type_id}`, { method: 'DELETE', headers });
      const responseText = await res.text();
      let body = {};
      try {
        if (responseText && responseText.trim()) body = JSON.parse(responseText);
      } catch {
        body = {};
      }
      if (!res.ok) {
        const msg = body?.message || body?.error || responseText?.trim() || 'Failed to delete';
        if (res.status === 400 && (msg.toLowerCase().includes('asset') || msg.toLowerCase().includes('existing'))) {
          setDeleteBlockedMessage(msg || 'This asset type has assets. Delete or reassign all assets first.');
          return;
        }
        throw new Error(msg);
      }
      if (Platform.OS !== 'web') Alert.alert('Deleted', 'Asset type removed.');
      router.replace({ pathname: '/Inventory', params: { tab: 'types' } });
    } catch (e) {
      Alert.alert('Error', e.message || 'Failed to delete asset type');
    }
  };

  const selfReturnTarget = `/type/${String(type_id || '')}${normalizedReturnTo ? `?returnTo=${encodeURIComponent(normalizedReturnTo)}` : ''}`;

  const goEditType = () => {
    router.push({
      pathname: '/type/edit',
      params: { id: type_id, name: type_name, returnTo: selfReturnTarget },
    });
  };

  const handleBack = () => {
    if (normalizedReturnTo && navigateToReturnTarget(normalizedReturnTo)) return;
    try {
      if (router.canGoBack()) {
        router.back();
        return;
      }
    } catch {}
    router.replace('/Inventory?tab=types');
  };

  /* fetch all assets (same endpoint), filter client-side by type_id */
  useEffect(() => {
    let alive = true;
    if (!type_id) return;
    setLoading(true);
    fetch(`${API_BASE_URL}/assets`)
      .then((r) => r.json())
      .then((all) => {
        if (!alive) return;
        const list = Array.isArray(all)
          ? all.filter(a => String(a.type_id) === String(type_id))
          : [];
        setAssets(list);
      })
      .catch((err) => console.error('Failed to fetch filtered assets:', err))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [type_id]);

  /* compute counts for this type (proper per-status buckets) */
  const counts = useMemo(() => {
    const c = {
      in_service: 0,
      on_hire: 0,
      repair: 0,
      maintenance: 0,
      end_of_life: 0,
    };
    for (const a of assets) {
      const k = normalizeStatus(a?.status);
      if (k in c) c[k] += 1;
    }
    return { ...c, total: assets.length };
  }, [assets]);

  /* small helper to render a color-coded chip from STATUS_CONFIG */
  const StatChip = ({ code, count }) => {
    const cfg = STATUS_CONFIG[code];
    if (!cfg) return null;
    return (
      <View style={[styles.metaChip, { backgroundColor: cfg.bg }]}>
        <MaterialIcons name={cfg.icon} size={16} color={cfg.fg} />
        <Text style={[styles.metaChipText, { color: cfg.fg }]}>
          {cfg.label}: {count}
        </Text>
      </View>
    );
  };

  /* row renderer */
  const renderItem = ({ item }) => {
    return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push({
        pathname: '/asset/[assetId]',
        params: { assetId: String(item.id), returnTo: selfReturnTarget },
      })}
    >
      <Image
        source={{ uri: (item.image_url || 'https://via.placeholder.com/80').trim() }}
        style={styles.image}
      />
      <View style={styles.details}>
        <View style={styles.titleRow}>
          <Text numberOfLines={1} style={styles.name}>{item.model || item.asset_types?.name || 'Asset'}</Text>
          <StatusBadge status={item.status} />
        </View>
        <Text style={styles.subtext}>SN: {item.serial_number || 'N/A'}</Text>
        {item.users?.name ? <Text style={styles.subtext}>Assignee: {item.users.name}</Text> : null}
        {item.location ? <Text numberOfLines={1} style={styles.subtext}>Loc: {item.location}</Text> : null}
      </View>
      <MaterialIcons name="chevron-right" size={24} color="#1E90FF" />
    </TouchableOpacity>
  );
  };

  // Group by QR assignment: QR‑assigned (non‑UUID id) first, then awaiting QR (UUID id)
  const isUUID = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
  const withQR = useMemo(() => assets.filter(a => !isUUID(String(a?.id || ''))), [assets]);
  const withoutQR = useMemo(() => assets.filter(a => isUUID(String(a?.id || ''))), [assets]);
  const grouped = useMemo(() => {
    const rows = [];
    rows.push(...withQR);
    if (withoutQR.length) rows.push({ __header: 'Awaiting QR' });
    rows.push(...withoutQR);
    return rows;
  }, [withQR, withoutQR]);

  const renderContent = () => (
      <View style={styles.container}>
        <View style={styles.contentWrap}>
          {/* stats chips (now color-coded by status config) */}
          <View style={styles.metaRow}>
            <StatChip code="in_service"  count={counts.in_service} />
            <StatChip code="on_hire"     count={counts.on_hire} />
            <StatChip code="repair"      count={counts.repair} />
            <StatChip code="maintenance" count={counts.maintenance} />
            <StatChip code="end_of_life" count={counts.end_of_life} />
            <View style={[styles.metaChip, { backgroundColor: '#f0f8ff' }]}>
              <MaterialIcons name="inventory-2" size={16} color="#1E90FF" />
              <Text style={[styles.metaChipText, { color: Colors.accent }]}>Total: {counts.total}</Text>
            </View>
          </View>

          {/* list / empty state */}
          {assets.length === 0 ? (
            <EmptyState
              icon="search-off"
              title="No assets found"
              subtitle="No assets have been assigned to this type yet."
            />
          ) : (
            <FlatList
              data={grouped}
              keyExtractor={(item, idx) => item?.__header ? `hdr-${item.__header}-${idx}` : String(item.id)}
              contentContainerStyle={{ padding: 20, ...(Platform.OS === 'web' ? { paddingBottom: 88 } : {}) }}
              renderItem={({ item }) => (
                item?.__header ? (
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionHeaderText}>{item.__header}</Text>
                  </View>
                ) : (
                  renderItem({ item })
                )
              )}
            />
          )}
        </View>
        <View style={[styles.actionsRow, Platform.OS === 'web' && styles.actionsRowSticky]}>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: Colors.accent }]} onPress={goEditType}>
            <Text style={styles.actionText}>✏️ Edit Type</Text>
          </TouchableOpacity>
          {isAdmin && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: Colors.dangerFg }]} onPress={doDeleteType}>
              <Text style={styles.actionText}>🗑 Delete Type</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScreenHeader
        title={type_name ? `${type_name} Assets` : 'Asset Type'}
        backLabel="Inventory"
        onBack={handleBack}
      />
      {loading ? (
        <View style={styles.centerWrap}>
          <ActivityIndicator size="large" color="#1E90FF" />
          <Text style={{ marginTop: 12, color: '#666' }}>Loading {type_name} assets…</Text>
        </View>
      ) : (
        renderContent()
      )}

      {/* Cannot delete asset type (has assets) */}
      <Modal transparent animationType="fade" visible={!!deleteBlockedMessage} onRequestClose={() => setDeleteBlockedMessage(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.15)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 20, width: '92%', maxWidth: 400, borderWidth: 1, borderColor: '#E6EDF3' }}>
            <Text style={{ fontSize: 18, fontWeight: '900', color: '#0F172A', marginBottom: 8 }}>Cannot delete asset type</Text>
            <Text style={{ fontSize: 15, color: '#374151', marginBottom: 20 }}>{deleteBlockedMessage}</Text>
            <TouchableOpacity
              style={{ alignSelf: 'flex-end', backgroundColor: '#1E90FF', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 }}
              onPress={() => setDeleteBlockedMessage(null)}
              activeOpacity={0.8}
            >
              <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* Colors and Radius */
const Colors = {
  primary: '#1E293B',
  primaryDark: '#0F172A',
  primaryLight: '#E2E8F0',
  accent: '#EA580C',
  accentDark: '#C2410C',
  accentLight: '#FFF7ED',
  accentMuted: '#FFEDD5',
  text: '#1C1917',
  sub: '#57534E',
  sub2: '#A8A29E',
  line: '#D6D3D1',
  bg: '#F5F3F0',
  card: '#FFFFFF',
  chip: '#EDEAE6',
  dangerFg: '#DC2626',
  dangerBg: '#FEF2F2',
  successFg: '#0D9488',
  successBg: '#F0FDFA',
};

const Radius = { sm: 6, md: 10, lg: 14 };
const CardShadow = { shadowColor: '#1C1917', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 };

/* ----------------- styles ----------------- */
const styles = StyleSheet.create({
  centerWrap: {
    flex: 1, backgroundColor: Colors.bg, justifyContent: 'center', alignItems: 'center',
  },
  container: { flex: 1, backgroundColor: Colors.bg },
  contentWrap: { flex: 1, minHeight: 0 },
  /* meta chips row (counts) */
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: Radius.lg, borderWidth: 2, borderColor: Colors.line,
  },
  metaChipText: { color: Colors.accent, fontWeight: '700', fontSize: 12 },

  /* list cards */
  card: {
    flexDirection: 'row', backgroundColor: Colors.card,
    borderRadius: Radius.lg, marginBottom: 15, alignItems: 'center', padding: 10, borderWidth: 2, borderColor: Colors.line, ...CardShadow,
  },
  image: {
    width: 60, height: 60, borderRadius: Radius.md, marginRight: 12, backgroundColor: Colors.chip,
  },
  details: { flex: 1 },
  name: { fontWeight: '900', fontSize: 16, marginBottom: 4, color: Colors.text, flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 },
  subtext: { fontSize: 13, color: Colors.sub, fontWeight: '600' },

  /* status badge */
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 8, borderRadius: Radius.lg, flexShrink: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  statusText: { fontWeight: '800', fontSize: 12 },

  /* empty state */
  noData: { textAlign: 'center', marginTop: 50, fontSize: 16, color: Colors.sub2, fontWeight: '600' },

  /* footer actions styled like asset page; sticky on web */
  actionsRow: {
    flexDirection: 'row', justifyContent: 'space-between', gap: 8,
    padding: 16, borderTopColor: Colors.line, borderTopWidth: 2, backgroundColor: Colors.card,
  },
  actionsRowSticky: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  actionBtn: {
    flex: 1, paddingVertical: 14, borderRadius: Radius.lg, alignItems: 'center', elevation: 2, ...CardShadow,
  },
  actionText: { color: Colors.card, fontWeight: '800', fontSize: 15 },

  /* section headers */
  sectionHeader: { paddingVertical: 6, paddingHorizontal: 6 },
  sectionHeaderText: { fontSize: 13, fontWeight: '900', color: Colors.accent },
});
