// Inventory.js - Asset inventory screen with tab navigation for asset types and all assets
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  Dimensions,
  SafeAreaView,
  FlatList,
  Platform,
  RefreshControl,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Ionicons, Feather } from '@expo/vector-icons';
import { TabView, TabBar } from 'react-native-tab-view';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../firebaseConfig';
import { API_BASE_URL } from '../../inventory-api/apiBase';

const initialLayout = { width: Dimensions.get('window').width };

/** 🔵 Brand palette */
const COLORS = {
  primary: '#0B63CE',
  primaryDark: '#084AA0',
  primaryLight: '#E7F3FF',
  text: '#111',
  sub: '#555',
  sub2: '#777',
  bg: '#F7FAFF',
  card: '#FFFFFF',
  line: '#E2EEFF',
  dangerBg: '#FFEBEE',
  dangerFg: '#D32F2F',
};

/** ---------- New unified status config ---------- */
const STATUS_CONFIG = {
  in_service:        { label: 'In Service',         bg: '#E7F3FF', fg: '#084AA0', bd: '#D6E8FF', icon: 'build-circle' },
  end_of_life:       { label: 'End of Life',        bg: '#EDE9FE', fg: '#5B21B6', bd: '#E3D9FF', icon: 'block' },
  repair:      { label: 'Repair',       bg: '#FFEDD5', fg: '#9A3412', bd: '#FFD9B5', icon: 'build' },
  maintenance: { label: 'Maintenance',  bg: '#FEF9C3', fg: '#854D0E', bd: '#FFF3B0', icon: 'build' },
};
const normalizeStatus = (s) => {
  if (!s) return 'in_service';
  const key = String(s).toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
  const alias = {
    in_service: 'in_service',
    end_of_life: 'end_of_life',
    repair: 'repair',
    maintenance: 'maintenance',
    // legacy/common variants
    available: 'in_service',
    'in use': 'in_service',
    checked_out: 'repair',
    rented: 'repair',
    reserved: 'in_service',
    lost: 'end_of_life',
    retired: 'end_of_life',
  };
  return alias[key] || 'in_service';
};
const prettyStatus = (s) => STATUS_CONFIG[normalizeStatus(s)]?.label ?? '—';
const statusToColor = (s) => STATUS_CONFIG[normalizeStatus(s)] ?? STATUS_CONFIG.in_service;

/** ------- helpers -------- */
const truncate = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
const prettyDate = (d) => {
  try {
    const dt = new Date(d);
    if (Number.isNaN(+dt)) return '—';
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  } catch { return '—'; }
};
const daysUntil = (isoDate) => {
  try {
    const d = new Date(isoDate);
    const today = new Date();
    const diff = Math.ceil((d - today) / (1000 * 60 * 60 * 24));
    if (isNaN(diff)) return '—';
    if (diff < 0) return 'overdue';
    if (diff === 0) return 'today';
    if (diff === 1) return 'tomorrow';
    return `in ${diff}d`;
  } catch { return '—'; }
};

/** ------ tiny UI bits ------ */
function MetaChip({ icon, text }) {
  return (
    <View style={styles.metaChip}>
      <Feather name={icon} size={14} color={COLORS.sub} />
      <Text style={styles.metaText} numberOfLines={1}>{text}</Text>
    </View>
  );
}
function DetailRow({ icon, label, value }) {
  return (
    <View style={styles.detailRow}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Feather name={icon} size={14} color={COLORS.sub} />
        <Text style={styles.detailLabel}>{label}</Text>
      </View>
      <Text style={styles.detailValue} numberOfLines={1}>{value || '—'}</Text>
    </View>
  );
}

/** ================== TAB: Asset Types (live filtered + full status chips) ================== */
const AssetTypesTab = ({ query }) => {
  const router = useRouter();
  const [assetTypes, setAssetTypes] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Per-type status counts derived from /assets
  const [typeCounts, setTypeCounts] = useState({}); // { [typeId]: {in_service, end_of_life, needs_repair, ... , total} }

  const fetchTypes = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/assets/asset-types-summary`);
      const data = await res.json();
      setAssetTypes(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching asset types:', err);
      setAssetTypes([]);
    } finally {
      setRefreshing(false);
      setLoaded(true);
    }
  }, []);

  // Build per-type counts by scanning all assets once
  const fetchTypeCounts = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/assets`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      const acc = {};
      for (const a of list) {
        const tid = String(a?.type_id ?? a?.asset_types?.id ?? a?.asset_type_id ?? a?.typeId ?? '');
        if (!tid) continue;
        const k = normalizeStatus(a?.status);
        if (!acc[tid]) {
          acc[tid] = {
            in_service: 0, end_of_life: 0,
            repair: 0, maintenance: 0,
            total: 0,
          };
        }
        if (k in acc[tid]) acc[tid][k] += 1;
        acc[tid].total += 1;
      }
      setTypeCounts(acc);
    } catch (e) {
      console.error('Error building type counts:', e);
      setTypeCounts({});
    }
  }, []);

  useEffect(() => { fetchTypes(); fetchTypeCounts(); }, [fetchTypes, fetchTypeCounts]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Promise.all([fetchTypes(), fetchTypeCounts()]).finally(() => setRefreshing(false));
  }, [fetchTypes, fetchTypeCounts]);

  const filtered = useMemo(() => {
    const t = (query || '').trim().toLowerCase();
    if (!t) return assetTypes;
    return assetTypes.filter(x => String(x?.name || '').toLowerCase().includes(t));
  }, [assetTypes, query]);

  const handleTypePress = (type) => {
    router.push({ pathname: '/type/' + type.id, params: { type_name: type.name } });
  };

  const TypeChip = ({ cfg, icon, label, value }) => (
    <View style={[styles.typeChip, { backgroundColor: cfg.bg, borderColor: cfg.bd }]}>
      <MaterialIcons name={icon} size={14} color={cfg.fg} />
      <Text style={[styles.typeChipText, { color: cfg.fg }]}>{label}: {value}</Text>
    </View>
  );

 const TypeCard = ({ type }) => {
  const [showExtras, setShowExtras] = useState(false);

  const id = String(type?.id ?? '');
  const c = typeCounts[id] || {};

  // prefer computed counts; fall back to API fields if present
  const inService        = (c.in_service        ?? Number(type?.inService ?? 0)) || 0;
  const endOfLife        = (c.end_of_life       ?? Number(type?.endOfLife ?? 0)) || 0;
  const repair      = (c.repair      ?? Number(type?.repair ?? 0)) || 0;
  const maintenance = (c.maintenance ?? Number(type?.maintenance ?? 0)) || 0;

  const extrasTotal = repair + maintenance;
  const total = (c.total ?? Number(type?.total ?? type?.count ?? (
    inService + endOfLife + extrasTotal
  ))) || 0;

  return (
    // Make the whole card non-pressable so the "More" chip doesn't navigate.
    // Only the header row navigates to the type screen.
    <View style={styles.typeCard}>
      {type?.image_url ? (
        <Image source={{ uri: String(type.image_url).trim() }} style={styles.typeCover} />
      ) : (
        <View style={[styles.typeCover, styles.typeCoverPlaceholder]}>
          <MaterialIcons name="category" size={24} color={COLORS.sub2} />
        </View>
      )}

      <View style={styles.typeBody}>
        {/* Header row -> navigates */}
        <TouchableOpacity
          style={styles.typeTitleRow}
          activeOpacity={0.7}
          onPress={() => handleTypePress(type)}
        >
          <Text style={styles.typeTitle} numberOfLines={1}>{type?.name || 'Asset Type'}</Text>
          <MaterialIcons name="chevron-right" size={22} color={COLORS.sub2} />
        </TouchableOpacity>

        {/* Primary chips (always visible) */}
        <View style={styles.typeChipsRow}>
          <TypeChip
            cfg={STATUS_CONFIG.in_service}
            icon={STATUS_CONFIG.in_service.icon}
            label="In Service"
            value={inService}
          />
          <TypeChip
            cfg={STATUS_CONFIG.end_of_life}
            icon={STATUS_CONFIG.end_of_life.icon}
            label="End of Life"
            value={endOfLife}
          />
          <View style={[styles.typeChip, { backgroundColor: '#F5F9FF', borderColor: COLORS.line }]}>
            <MaterialIcons name="inventory-2" size={14} color={COLORS.sub} />
            <Text style={[styles.typeChipText, { color: COLORS.sub }]}>Total: {total}</Text>
          </View>

          {/* More toggle */}
          <TouchableOpacity
            onPress={() => setShowExtras(v => !v)}
            style={[styles.typeChip, { backgroundColor: '#F5F9FF', borderColor: COLORS.line }]}
            activeOpacity={0.7}
          >
            <MaterialIcons name={showExtras ? 'expand-less' : 'expand-more'} size={14} color={COLORS.sub} />
            <Text style={[styles.typeChipText, { color: COLORS.sub }]}>
              More{extrasTotal ? ` • ${extrasTotal}` : ''}
            </Text>
          </TouchableOpacity>
        </View>

       {/* Extras dropdown */}
        {showExtras && (
          <View style={styles.extrasWrap}>
            <TypeChip
              cfg={STATUS_CONFIG.repair}
              icon={STATUS_CONFIG.repair.icon}
              label="Repair"
              value={repair}           // will show 0 if zero
            />
            <TypeChip
              cfg={STATUS_CONFIG.maintenance}
              icon={STATUS_CONFIG.maintenance.icon}
              label="Maintenance"
              value={maintenance}      // will show 0 if zero
            />
          </View>
        )}

      </View>
    </View>
  );
};


  return (
    <FlatList
      data={filtered}
      keyExtractor={(item, idx) => String(item?.id ?? idx)}
      renderItem={({ item }) => <TypeCard type={item} />}
      contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24, paddingTop: 8 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      ListEmptyComponent={
        <View style={{ alignItems: 'center', paddingVertical: 30 }}>
          <Ionicons name="folder-open-outline" size={24} color={COLORS.sub2} />
          <Text style={{ color: COLORS.sub2, marginTop: 6 }}>
            {loaded ? 'No asset types found' : 'Loading…'}
          </Text>
        </View>
      }
    />
  );
};

/** ================== TAB: All Assets (live filtered) ================== */
const AllAssetsTab = ({ query }) => {
  const router = useRouter();
  const [assets, setAssets] = useState([]);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const fetchAssets = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/assets`);
        const data = await res.json();
        const filtered = (Array.isArray(data) ? data : []).filter(
          a => (a?.description || '').toLowerCase() !== 'qr reserved asset'
        );
        setAssets(filtered);
      } catch (err) {
        console.error('Failed to fetch assets:', err);
        setAssets([]);
      } finally {
        setLoaded(true);
      }
    };
    fetchAssets();
  }, []);

  const filtered = useMemo(() => {
    const t = (query || '').trim().toLowerCase();
    if (!t) return assets;
    const tokens = t.split(/\s+/).filter(Boolean);
    return assets.filter((it) => {
      const name = it?.name ?? it?.asset_name ?? '';
      const id = it?.id ?? '';
      const serial = it?.serial_number ?? it?.fields?.serial_number ?? '';
      const model = it?.model ?? it?.fields?.model ?? '';
      const notes = it?.notes ?? '';
      const desc = it?.description ?? '';
      const loc = it?.location ?? it?.fields?.location ?? '';
      const type = it?.asset_type ?? it?.type ?? it?.asset_types?.name ?? '';
      const assigned =
        it?.assigned_to ?? it?.users?.email ?? it?.users?.name ?? '';
      const hay = `${name} ${id} ${serial} ${model} ${notes} ${desc} ${loc} ${type} ${assigned}`.toLowerCase();
      return tokens.every(tok => hay.includes(tok));
    });
  }, [assets, query]);

  const toggleExpand = useCallback((id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      const key = String(id);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const ResultCard = ({ item }) => {
    const name = item?.name || item?.asset_name || item?.id;
    const serial = item?.serial_number ?? item?.fields?.serial_number;
    const model = item?.model ?? item?.fields?.model;
    const loc = item?.location ?? item?.fields?.location;
    const type = item?.asset_type ?? item?.type ?? item?.asset_types?.name;
    const assignedTo = item?.assigned_to ?? item?.users?.name ?? item?.users?.useremail ?? item?.users?.email;

    const datePurchased = item?.date_purchased ?? item?.fields?.date_purchased;
    const nextService = item?.next_service_date ?? item?.fields?.next_service_date;
    const updatedAt = item?.updated_at ?? item?.fields?.updated_at;
    const notes = item?.notes ?? item?.fields?.notes ?? item?.description ?? '';

    const subtitle = [type ? String(type) : null, serial ? `SN ${serial}` : null, model || null]
      .filter(Boolean).join(' • ');

    const s = statusToColor(item?.status);
    const isExpanded = expandedIds.has(String(item.id));

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.9}
        onPress={() => router.push({ pathname: '/asset/[assetId]', params: { assetId: String(item.id), returnTo: '/Inventory?tab=all' } })}
        onLongPress={() => toggleExpand(item.id)}
      >
        <View style={styles.cardLeft}>
          {item?.image_url ? (
            <Image source={{ uri: item.image_url }} style={styles.cardImage} resizeMode="cover" />
          ) : (
            <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
              <Ionicons name="qr-code-outline" size={22} color={COLORS.sub2} />
            </View>
          )}
        </View>

        <View style={styles.cardBody}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle} numberOfLines={1}>{name}</Text>
            <View style={[styles.badge, { backgroundColor: s.bg, borderColor: s.bd }]}>
              <Text style={[styles.badgeText, { color: s.fg }]}>{prettyStatus(item?.status)}</Text>
            </View>
          </View>

          {!!subtitle && <Text style={styles.cardSubtitle} numberOfLines={1}>{subtitle}</Text>}

          <View style={styles.metaRow}>
            {assignedTo ? <MetaChip icon="user" text={truncate(String(assignedTo), 24)} /> : null}
            {loc ? <MetaChip icon="map-pin" text={truncate(String(loc), 18)} /> : null}
            {nextService ? <MetaChip icon="tool" text={`Service ${daysUntil(nextService)}`} /> : null}
          </View>

          {isExpanded && (
            <View style={styles.moreWrap}>
              <DetailRow icon="fingerprint" label="ID" value={String(item.id)} />
              {model ? <DetailRow icon="cpu" label="Model" value={String(model)} /> : null}
              {datePurchased ? <DetailRow icon="calendar" label="Purchased" value={prettyDate(datePurchased)} /> : null}
              {nextService ? <DetailRow icon="wrench" label="Next Service" value={prettyDate(nextService)} /> : null}
              {updatedAt ? <DetailRow icon="clock" label="Updated" value={prettyDate(updatedAt)} /> : null}
              {loc ? <DetailRow icon="map" label="Location" value={String(loc)} /> : null}
              {notes ? (
                <View style={styles.notesRow}>
                  <Feather name="file-text" size={14} color={COLORS.sub} />
                  <Text style={styles.notesText} numberOfLines={2}>{String(notes)}</Text>
                </View>
              ) : null}
            </View>
          )}
        </View>

        <TouchableOpacity style={styles.cardRight} onPress={() => toggleExpand(item.id)} hitSlop={8}>
          <MaterialIcons name={isExpanded ? 'expand-less' : 'expand-more'} size={24} color={COLORS.sub2} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <FlatList
      data={filtered}
      keyExtractor={(item, idx) => String(item?.id ?? idx)}
      renderItem={({ item }) => <ResultCard item={item} />}
      contentContainerStyle={{ paddingBottom: 28, paddingTop: 10 }}
      ListEmptyComponent={
        <View style={{ alignItems: 'center', paddingVertical: 30 }}>
          <Ionicons name="folder-open-outline" size={24} color={COLORS.sub2} />
          <Text style={{ color: COLORS.sub2, marginTop: 6 }}>
            {loaded ? 'No assets found' : 'Loading…'}
          </Text>
        </View>
      }
    />
  );
};

/** -------------- Main -------------- */
const Inventory = () => {
  const router = useRouter();
  const { tab } = useLocalSearchParams();
  const [index, setIndex] = useState(tab === 'all' ? 1 : 0);
  const [headerQuery, setHeaderQuery] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  const [routes] = useState([
    { key: 'types', title: 'Asset Types' },
    { key: 'all', title: 'All Assets' },
  ]);

  // Determine admin from DB role (users.role === 'ADMIN')
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

  // renderScene with props so we can pass the live query down
  const renderScene = ({ route }) => {
    if (route.key === 'types') return <AssetTypesTab query={headerQuery} />;
    if (route.key === 'all')   return <AllAssetsTab  query={headerQuery} />;
    return null;
  };

  const isTypesTab = index === 0;
  const headerPlaceholder = isTypesTab ? 'Search asset types' : 'Search assets';

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={{ flex: 1 }}>
        {/* Header with live search */}
        <View style={styles.header}>
          <TextInput
            style={styles.searchInput}
            placeholder={headerPlaceholder}
            placeholderTextColor="#888"
            value={headerQuery}
            onChangeText={setHeaderQuery}
            returnKeyType="search"
          />
          <TouchableOpacity style={styles.iconButton}>
            <MaterialIcons name="filter-list" size={24} color={COLORS.primary} />
          </TouchableOpacity>
          {/* No search icon / navigation */}
        </View>

        {/* Tabs */}
        <TabView
          navigationState={{ index, routes }}
          renderScene={renderScene}
          onIndexChange={setIndex}
          initialLayout={initialLayout}
          renderTabBar={props => (
            <TabBar
              {...props}
              indicatorStyle={{ backgroundColor: COLORS.primary }}
              style={{ backgroundColor: '#fff' }}
              activeColor="#000"
              inactiveColor="#555"
              labelStyle={{ fontWeight: 'bold' }}
              renderLabel={({ route, focused }) => (
                <Text
                  style={{
                    color: focused ? '#000' : '#555',
                    fontWeight: focused ? 'bold' : 'normal',
                    fontSize: 14,
                  }}
                >
                  {route.title}
                </Text>
              )}
            />
          )}
        />

        {/* FAB (admin only) */}
        {isAdmin && (
          <TouchableOpacity
            style={styles.fab}
            onPress={() => (index === 0 ? router.push('/type/new') : router.push('/asset/new'))}
          >
            <MaterialIcons name="add" size={28} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
};

/** -------------- Styles -------------- */
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },

  header: { flexDirection: 'row', padding: 10, backgroundColor: '#fff' },
  searchInput: {
    flex: 1, backgroundColor: '#f5f5f5', padding: 10, borderRadius: 5,
    marginRight: 10, borderColor: '#ddd', borderWidth: 1, color: '#111',
  },
  iconButton: { padding: 10 },
  extrasWrap: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  /** FAB */
  fab: {
    position: 'absolute', right: 20, bottom: 30, backgroundColor: COLORS.primary,
    width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', elevation: 5,
  },

  /** ---- All Assets card UI ---- */
  card: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 12,
    marginHorizontal: 10, marginVertical: 6, borderRadius: 14, backgroundColor: COLORS.card,
    borderWidth: 1, borderColor: '#E9F1FF',
    shadowColor: '#0B63CE', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
    elevation: 1
  },
  cardLeft: { marginRight: 12 },
  cardImage: { width: 52, height: 52, borderRadius: 10, backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#D6E8FF' },
  cardImagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: '800', color: COLORS.text },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  badgeText: { fontSize: 11, fontWeight: '800' },
  cardSubtitle: { color: COLORS.sub2, marginTop: 2 },
  metaRow: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#F5F9FF', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: COLORS.line
  },
  metaText: { fontSize: 12, color: COLORS.sub },
  moreWrap: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#EDF4FF', gap: 8 },
  detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailLabel: { color: COLORS.sub, fontWeight: '600' },
  detailValue: { color: COLORS.text, fontWeight: '600', flexShrink: 1, textAlign: 'right', marginLeft: 12 },
  notesRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: '#F7FBFF', borderWidth: 1, borderColor: COLORS.line,
    padding: 8, borderRadius: 8
  },
  notesText: { color: COLORS.sub, flex: 1, lineHeight: 18 },
  cardRight: { marginLeft: 6, paddingTop: 2 },

  /** ---- Asset Types refined UI ---- */
  typeCard: {
    flexDirection: 'row', borderRadius: 14, backgroundColor: COLORS.card,
    borderWidth: 1, borderColor: '#E9F1FF', marginVertical: 6, marginHorizontal: 8,
    padding: 10, shadowColor: '#0B63CE', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
    elevation: 1
  },
  typeCover: { width: 56, height: 56, borderRadius: 10, marginRight: 12, backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: COLORS.line },
  typeCoverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  typeBody: { flex: 1 },
  typeTitleRow: { flexDirection: 'row', alignItems: 'center' },
  typeTitle: { flex: 1, fontSize: 16, fontWeight: '800', color: COLORS.text },
  typeChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  typeChipText: { fontSize: 12, fontWeight: '700' },
});

export default Inventory;
