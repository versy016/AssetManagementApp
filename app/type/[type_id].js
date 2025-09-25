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
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_BASE_URL } from '../../inventory-api/apiBase';

/* ---- status mapping & badge (aligned with assetId screen) ---- */
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
    rented: 'rented',

    // legacy/common variants
    lost: 'end_of_life',
    retired: 'end_of_life',
  };

  return alias[key] || 'in_service';
}

function StatusBadge({ status }) {
  const k = normalizeStatus(status);
  const cfg = STATUS_CONFIG[k] || STATUS_CONFIG.in_service;
  return (
    <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
      <MaterialIcons name={cfg.icon} size={16} color={cfg.fg} style={{ marginRight: 6 }} />
      <Text style={[styles.statusText, { color: cfg.fg }]}>{cfg.label}</Text>
    </View>
  );
}

/* ---------------------------- main ---------------------------- */
export default function AssetsType() {
  const { type_id, type_name } = useLocalSearchParams();
  const router = useRouter();

  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);

  /* delete type (same logic, nicer feedback) */
  const doDeleteType = async () => {
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
      const res = await fetch(`${API_BASE_URL}/asset-types/${type_id}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || body?.error || 'Failed to delete');
      if (Platform.OS !== 'web') Alert.alert('Deleted', 'Asset type removed.');
      router.replace({ pathname: '/Inventory', params: { tab: 'types' } });
    } catch (e) {
      Alert.alert('Error', e.message || 'Failed to delete asset type');
    }
  };

  const goEditType = () => {
    router.push({ pathname: '/type/edit', params: { id: type_id, name: type_name } });
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
        const list = Array.isArray(all) ? all.filter(a => String(a.type_id) === String(type_id)) : [];
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
      end_of_life: 0,
      repair: 0,
      maintenance: 0,
      rented: 0,
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
  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push({ pathname: '/asset/[assetId]', params: { assetId: String(item.id) } })}
    >
      <Image
        source={{ uri: (item.image_url || 'https://via.placeholder.com/80').trim() }}
        style={styles.image}
      />
      <View style={styles.details}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
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

  if (loading) {
    return (
      <SafeAreaView style={styles.centerWrap}>
        <ActivityIndicator size="large" color="#1E90FF" />
        <Text style={{ marginTop: 12, color: '#666' }}>Loading {type_name} assets…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={styles.container}>
        {/* header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.push({ pathname: '/Inventory', params: { tab: 'types' } })}
          >
            <MaterialIcons name="arrow-back" size={24} color="#1E90FF" />
          </TouchableOpacity>
          <Text style={styles.title}>{type_name} Assets</Text>
        </View>

        {/* stats chips (now color-coded by status config) */}
        <View style={styles.metaRow}>
          <StatChip code="in_service"        count={counts.in_service} />
          <StatChip code="repair"            count={counts.repair} />
          <StatChip code="maintenance"       count={counts.maintenance} />
          <StatChip code="rented"            count={counts.rented} />
          <StatChip code="end_of_life"       count={counts.end_of_life} />
          <View style={[styles.metaChip, { backgroundColor: '#f0f8ff' }]}>
            <MaterialIcons name="inventory-2" size={16} color="#1E90FF" />
            <Text style={[styles.metaChipText, { color: '#1E90FF' }]}>Total: {counts.total}</Text>
          </View>
        </View>

        {/* list / empty state */}
        {assets.length === 0 ? (
          <Text style={styles.noData}>No assets found for this type.</Text>
        ) : (
          <FlatList
            data={assets}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ padding: 20 }}
            renderItem={renderItem}
          />
        )}
      </View>

      {/* actions (styled like assetId’s buttons) */}
      <View style={styles.actionsRow}>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#FFA500' }]} onPress={goEditType}>
          <Text style={styles.actionText}>✏️ Edit Type</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#b00020' }]} onPress={doDeleteType}>
          <Text style={styles.actionText}>🗑 Delete Type</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

/* ----------------- styles ----------------- */
const styles = StyleSheet.create({
  centerWrap: {
    flex: 1, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center',
  },
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row', alignItems: 'center', padding: 16,
    borderBottomColor: '#ddd', borderBottomWidth: 1,
  },
  title: { fontSize: 18, fontWeight: 'bold', marginLeft: 12, color: '#1E90FF' },

  /* meta chips row (counts) */
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 14,
  },
  metaChipText: { color: '#1E90FF', fontWeight: '600', fontSize: 12 },

  /* list cards */
  card: {
    flexDirection: 'row', backgroundColor: '#f9f9f9',
    borderRadius: 10, marginBottom: 15, alignItems: 'center', padding: 10,
  },
  image: {
    width: 60, height: 60, borderRadius: 8, marginRight: 12, backgroundColor: '#eee',
  },
  details: { flex: 1 },
  name: { fontWeight: 'bold', fontSize: 16, marginBottom: 4, color: '#333' },
  subtext: { fontSize: 13, color: '#666' },

  /* status badge */
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 16 },
  statusText: { fontWeight: '700', fontSize: 12 },

  /* empty state */
  noData: { textAlign: 'center', marginTop: 50, fontSize: 16, color: '#777' },

  /* footer actions styled like asset page */
  actionsRow: {
    flexDirection: 'row', justifyContent: 'space-between', gap: 8,
    padding: 16, borderTopColor: '#ddd', borderTopWidth: 1, backgroundColor: '#fff',
  },
  actionBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center', elevation: 2,
  },
  actionText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
});
