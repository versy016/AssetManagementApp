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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import { TourTarget } from '../../components/TourGuide';
import { useTheme } from 'react-native-paper';
import ScreenWrapper from '../../components/ui/ScreenWrapper';
import SearchInput from '../../components/ui/SearchInput';

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
  in_service: { label: 'In Service', bg: '#E7F3FF', fg: '#084AA0', bd: '#D6E8FF', icon: 'build-circle' },
  end_of_life: { label: 'End of Life', bg: '#EDE9FE', fg: '#5B21B6', bd: '#E3D9FF', icon: 'block' },
  repair: { label: 'Repair', bg: '#FFEDD5', fg: '#9A3412', bd: '#FFD9B5', icon: 'build' },
  maintenance: { label: 'Maintenance', bg: '#FEF9C3', fg: '#854D0E', bd: '#FFF3B0', icon: 'build' },
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
    if (!d) return '—';
    let dt = null;
    if (typeof d === 'string') {
      const s = d.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const [y, m, day] = s.split('-').map(Number);
        dt = new Date(y, m - 1, day); // local date to avoid TZ shift
      } else {
        const t = new Date(s);
        dt = Number.isNaN(+t) ? null : t;
      }
    } else if (d instanceof Date) {
      dt = d;
    } else {
      const t = new Date(d);
      dt = Number.isNaN(+t) ? null : t;
    }
    if (!dt) return '—';
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    }).format(dt).replace(/\u00A0/g, ' ');
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
  const [typeSort, setTypeSort] = useState({ field: 'name', dir: 'asc' }); // 'name' | 'total'
  const TYPES_SORT_KEY = 'inventory_types_sort_v1';

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
      const isReserved = (a) => String(a?.description || '').toLowerCase() === 'qr reserved asset';
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

        // (unassigned preview removed)
      }
      setTypeCounts(acc);
    } catch (e) {
      console.error('Error building type counts:', e);
      setTypeCounts({});
    }
  }, []);

  // Load saved sort on mount
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(TYPES_SORT_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const field = (parsed?.field === 'total') ? 'total' : 'name';
        const dir = (parsed?.dir === 'desc') ? 'desc' : 'asc';
        setTypeSort({ field, dir });
      } catch { }
    })();
  }, []);

  // Persist sort when it changes
  useEffect(() => {
    (async () => {
      try { await AsyncStorage.setItem(TYPES_SORT_KEY, JSON.stringify(typeSort)); } catch { }
    })();
  }, [typeSort]);

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

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = typeSort.dir === 'asc' ? 1 : -1;
    if (typeSort.field === 'total') {
      arr.sort((a, b) => {
        const aId = String(a?.id ?? '');
        const bId = String(b?.id ?? '');
        const sumA = Number(a?.inService || 0) + Number(a?.endOfLife || 0) + Number(a?.repair || 0) + Number(a?.maintenance || 0);
        const sumB = Number(b?.inService || 0) + Number(b?.endOfLife || 0) + Number(b?.repair || 0) + Number(b?.maintenance || 0);
        const at = (typeCounts[aId]?.total ?? sumA) || 0;
        const bt = (typeCounts[bId]?.total ?? sumB) || 0;
        return (at - bt) * dir;
      });
    } else {
      arr.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }) * dir);
    }
    return arr;
  }, [filtered, typeSort, typeCounts]);

  const handleTypePress = (type) => {
    router.push({
      pathname: '/type/[type_id]',
      params: {
        type_id: String(type.id),
        type_name: type.name,
        returnTo: '/Inventory?tab=types',
      },
    });
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
    const inService = (c.in_service ?? Number(type?.inService ?? 0)) || 0;
    const endOfLife = (c.end_of_life ?? Number(type?.endOfLife ?? 0)) || 0;
    const repair = (c.repair ?? Number(type?.repair ?? 0)) || 0;
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

          {/* Unassigned preview removed by request */}

        </View>
      </View>
    );
  };


  return (
    <FlatList
      ListHeaderComponent={
        <View style={styles.sortBar}>
          <Text style={styles.sortLabel}>Sort:</Text>
          <TouchableOpacity
            style={[styles.sortChip, typeSort.field === 'name' && styles.sortChipActive]}
            onPress={() => setTypeSort((s) => ({ field: 'name', dir: s.field === 'name' && s.dir === 'asc' ? 'desc' : 'asc' }))}
          >
            <Feather name={typeSort.field === 'name' && typeSort.dir === 'desc' ? 'arrow-down' : 'arrow-up'} size={12} color={typeSort.field === 'name' ? COLORS.primary : COLORS.sub} />
            <Text style={[styles.sortText, typeSort.field === 'name' && styles.sortTextActive]}>Name</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sortChip, typeSort.field === 'total' && styles.sortChipActive]}
            onPress={() => setTypeSort((s) => ({ field: 'total', dir: s.field === 'total' && s.dir === 'asc' ? 'desc' : 'asc' }))}
          >
            <Feather name={typeSort.field === 'total' && typeSort.dir === 'desc' ? 'arrow-down' : 'arrow-up'} size={12} color={typeSort.field === 'total' ? COLORS.primary : COLORS.sub} />
            <Text style={[styles.sortText, typeSort.field === 'total' && styles.sortTextActive]}>Total</Text>
          </TouchableOpacity>
        </View>
      }
      data={sorted}
      keyExtractor={(item, idx) => String(item?.id ?? idx)}
      renderItem={({ item, index }) => (
        index === 0 ? (
          <TourTarget id="first-asset-type">
            <TypeCard type={item} />
          </TourTarget>
        ) : (
          <TypeCard type={item} />
        )
      )}
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
  const [assetSort, setAssetSort] = useState({ field: 'name', dir: 'asc' }); // 'name' | 'updated'
  const ALL_SORT_KEY = 'inventory_allassets_sort_v1';

  // Load saved sort on mount
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(ALL_SORT_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const field = (parsed?.field === 'updated') ? 'updated' : 'name';
        const dir = (parsed?.dir === 'desc') ? 'desc' : 'asc';
        setAssetSort({ field, dir });
      } catch { }
    })();
  }, []);

  // Persist sort when it changes
  useEffect(() => {
    (async () => {
      try { await AsyncStorage.setItem(ALL_SORT_KEY, JSON.stringify(assetSort)); } catch { }
    })();
  }, [assetSort]);

  useEffect(() => {
    const fetchAssets = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/assets`);
        const data = await res.json();
        const isUUID = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
        const filtered = (Array.isArray(data) ? data : [])
          // hide placeholders
          .filter(a => (a?.description || '').toLowerCase() !== 'qr reserved asset')
          // hide imported (UUID) until QR assigned
          .filter(a => !isUUID(String(a?.id || '')));
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

  const sortedAssets = useMemo(() => {
    const arr = [...filtered];
    const dir = assetSort.dir === 'asc' ? 1 : -1;
    const nameOf = (it) => String(it?.name || it?.asset_name || it?.model || it?.id || '').toLowerCase();
    if (assetSort.field === 'updated') {
      arr.sort((a, b) => {
        const av = new Date(a?.updated_at || a?.last_updated || 0).getTime();
        const bv = new Date(b?.updated_at || b?.last_updated || 0).getTime();
        return (av - bv) * dir;
      });
    } else {
      arr.sort((a, b) => nameOf(a).localeCompare(nameOf(b)) * dir);
    }
    return arr;
  }, [filtered, assetSort]);

  const toggleExpand = useCallback((id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      const key = String(id);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const ResultCard = ({ item, onOpen }) => {
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
        onPress={() => {
          if (onOpen) {
            onOpen(item.id);
            return;
          }
          router.push({
            pathname: '/asset/[assetId]',
            params: {
              assetId: String(item.id),
              returnTo: '/Inventory?tab=all',
            },
          });
        }}
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
            {(() => {
              const chips = [];
              if (assignedTo) chips.push({ icon: 'user', text: truncate(String(assignedTo), 24) });
              if (loc) chips.push({ icon: 'map-pin', text: truncate(String(loc), 18) });
              if (nextService) chips.push({ icon: 'tool', text: `Service ${daysUntil(nextService)}` });
              // Fallbacks to reach at least 3 chips
              if (chips.length < 3 && type) chips.push({ icon: 'tag', text: truncate(String(type), 18) });
              if (chips.length < 3 && model) chips.push({ icon: 'cpu', text: truncate(String(model), 18) });
              if (chips.length < 3 && datePurchased) chips.push({ icon: 'calendar', text: `Purchased ${prettyDate(datePurchased)}` });
              // Render first three
              return chips.slice(0, 3).map((c, idx) => (
                <MetaChip key={`chip-${idx}`} icon={c.icon} text={c.text} />
              ));
            })()}
          </View>

          {isExpanded && (
            <View style={styles.moreWrap}>
              <DetailRow icon="hash" label="ID" value={String(item.id)} />
              {model ? <DetailRow icon="cpu" label="Model" value={String(model)} /> : null}
              {datePurchased ? <DetailRow icon="calendar" label="Purchased" value={prettyDate(datePurchased)} /> : null}
              {nextService ? <DetailRow icon="tool" label="Next Service" value={prettyDate(nextService)} /> : null}
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
      ListHeaderComponent={
        <View style={styles.sortBar}>
          <Text style={styles.sortLabel}>Sort:</Text>
          <TouchableOpacity
            style={[styles.sortChip, assetSort.field === 'name' && styles.sortChipActive]}
            onPress={() => setAssetSort((s) => ({ field: 'name', dir: s.field === 'name' && s.dir === 'asc' ? 'desc' : 'asc' }))}
          >
            <Feather name={assetSort.field === 'name' && assetSort.dir === 'desc' ? 'arrow-down' : 'arrow-up'} size={12} color={assetSort.field === 'name' ? COLORS.primary : COLORS.sub} />
            <Text style={[styles.sortText, assetSort.field === 'name' && styles.sortTextActive]}>Name</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sortChip, assetSort.field === 'updated' && styles.sortChipActive]}
            onPress={() => setAssetSort((s) => ({ field: 'updated', dir: s.field === 'updated' && s.dir === 'asc' ? 'desc' : 'asc' }))}
          >
            <Feather name={assetSort.field === 'updated' && assetSort.dir === 'desc' ? 'arrow-down' : 'arrow-up'} size={12} color={assetSort.field === 'updated' ? COLORS.primary : COLORS.sub} />
            <Text style={[styles.sortText, assetSort.field === 'updated' && styles.sortTextActive]}>Updated</Text>
          </TouchableOpacity>
        </View>
      }
      data={sortedAssets}
      keyExtractor={(item, idx) => String(item?.id ?? idx)}
      renderItem={({ item, index }) => (
        index === 0 ? (
          <TourTarget id="first-asset">
            <ResultCard item={item} />
          </TourTarget>
        ) : (
          <ResultCard item={item} />
        )
      )}
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
  const theme = useTheme();
  const { tab } = useLocalSearchParams();
  const [index, setIndex] = useState(tab === 'all' ? 1 : 0);

  // Sync tab index with URL param
  useEffect(() => {
    if (tab === 'all') setIndex(1);
    else if (tab === 'types') setIndex(0);
  }, [tab]);

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
    if (route.key === 'all') return <AllAssetsTab query={headerQuery} />;
    return null;
  };

  const isTypesTab = index === 0;
  const headerPlaceholder = isTypesTab ? 'Search asset types' : 'Search assets';

  return (
    <ScreenWrapper style={styles.safeArea}>
      <View style={{ flex: 1 }}>
        {/* Header with live search */}
        <View style={[styles.header, { backgroundColor: theme.colors.background }]}>
          <View style={{ flex: 1, marginRight: 10 }}>
            <SearchInput
              placeholder={headerPlaceholder}
              value={headerQuery}
              onChangeText={setHeaderQuery}
              returnKeyType="search"
            />
          </View>
          <TouchableOpacity style={styles.iconButton}>
            <MaterialIcons name="filter-list" size={24} color={theme.colors.primary} />
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
            <View style={{ position: 'relative' }}>
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
              {/* TourTargets for tabs - positioned absolutely over the tabs */}
              {props.navigationState.routes.map((route, i) => {
                const tabId = route.key === 'types' ? 'tab-asset-types' : 'tab-all-assets';
                const isActive = props.navigationState.index === i;
                return (
                  <TourTarget
                    key={route.key}
                    id={tabId}
                    style={{
                      position: 'absolute',
                      left: `${(i / props.navigationState.routes.length) * 100}%`,
                      width: `${100 / props.navigationState.routes.length}%`,
                      height: 48,
                      top: 0,
                    }}
                  >
                    <View style={{ flex: 1 }} />
                  </TourTarget>
                );
              })}
            </View>
          )}
        />

        {/* FAB (admin only) */}
        {isAdmin && (
          <TourTarget
            id={index === 0 ? 'btn-manage-types' : 'btn-add-asset'}
            style={styles.fab}
          >
            <TouchableOpacity
              style={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}
              onPress={() => (index === 0 ? router.push('/type/new') : router.push('/asset/new'))}
            >
              <MaterialIcons name="add" size={28} color="#fff" />
            </TouchableOpacity>
          </TourTarget>
        )}
      </View>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
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
  // Sort bar (list header)
  sortBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8 },
  sortLabel: { color: COLORS.sub2, fontWeight: '800' },
  sortChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: COLORS.line, backgroundColor: '#F5F9FF' },
  sortChipActive: { borderColor: COLORS.primary, backgroundColor: '#E7F3FF' },
  sortText: { color: COLORS.sub, fontWeight: '800', fontSize: 12 },
  sortTextActive: { color: COLORS.primary },
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
