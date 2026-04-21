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
  Modal,
  ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Ionicons, Feather } from '@expo/vector-icons';
import { TabView, TabBar } from 'react-native-tab-view';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../firebaseConfig';
import logger from '../../utils/logger';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import { TourTarget } from '../../components/TourGuide';
import { useTheme } from 'react-native-paper';
import ScreenWrapper from '../../components/ui/ScreenWrapper';
import SearchInput from '../../components/ui/SearchInput';
import EmptyState from '../../components/ui/EmptyState';
import {
  STATUS_CONFIG,
  normalizeStatus,
  prettyStatus,
  statusToColor,
} from '../../components/ui/StatusBadge';
import { Colors, Radius, Spacing, Shadows, sf } from '../../constants/uiTheme';

const initialLayout = { width: Dimensions.get('window').width };

// Colors imported from constants/uiTheme

// STATUS_CONFIG, normalizeStatus, prettyStatus, statusToColor imported from components/ui/StatusBadge

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
      <Feather name={icon} size={14} color={Colors.text} />
      <Text style={styles.metaText} numberOfLines={1}>{text}</Text>
    </View>
  );
}
function DetailRow({ icon, label, value }) {
  return (
    <View style={styles.detailRow}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Feather name={icon} size={14} color={Colors.text} />
        <Text style={styles.detailLabel}>{label}</Text>
      </View>
      <Text style={styles.detailValue} numberOfLines={1}>{value || '—'}</Text>
    </View>
  );
}

/** ================== TAB: Asset Types (live filtered + full status chips) ================== */
const AssetTypesTab = ({ query, filters }) => {
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
      logger.error('Error fetching asset types:', err);
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
      logger.error('Error building type counts:', e);
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
    let arr = assetTypes;
    const t = (query || '').trim().toLowerCase();
    if (t) arr = arr.filter(x => String(x?.name || '').toLowerCase().includes(t));
    const statusFilter = filters?.status;
    if (statusFilter && typeCounts) {
      const statusKey = normalizeStatus(statusFilter);
      arr = arr.filter(x => {
        const id = String(x?.id ?? '');
        const c = typeCounts[id] || {};
        return (c[statusKey] ?? 0) > 0;
      });
    }
    return arr;
  }, [assetTypes, query, filters?.status, typeCounts]);

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
            <MaterialIcons name="category" size={24} color={Colors.sub2} />
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
            <MaterialIcons name="chevron-right" size={22} color={Colors.sub2} />
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
            <View style={[styles.typeChip, { backgroundColor: Colors.chip, borderColor: Colors.line }]}>
              <MaterialIcons name="inventory-2" size={14} color={Colors.sub} />
              <Text style={[styles.typeChipText, { color: Colors.sub }]}>Total: {total}</Text>
            </View>

            {/* More toggle */}
            <TouchableOpacity
              onPress={() => setShowExtras(v => !v)}
              style={[styles.typeChip, { backgroundColor: Colors.chip, borderColor: Colors.line }]}
              activeOpacity={0.7}
            >
              <MaterialIcons name={showExtras ? 'expand-less' : 'expand-more'} size={14} color={Colors.sub} />
              <Text style={[styles.typeChipText, { color: Colors.sub }]}>
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
            <Feather name={typeSort.field === 'name' && typeSort.dir === 'desc' ? 'arrow-down' : 'arrow-up'} size={12} color={typeSort.field === 'name' ? Colors.accent : Colors.sub} />
            <Text style={[styles.sortText, typeSort.field === 'name' && styles.sortTextActive]}>Name</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sortChip, typeSort.field === 'total' && styles.sortChipActive]}
            onPress={() => setTypeSort((s) => ({ field: 'total', dir: s.field === 'total' && s.dir === 'asc' ? 'desc' : 'asc' }))}
          >
            <Feather name={typeSort.field === 'total' && typeSort.dir === 'desc' ? 'arrow-down' : 'arrow-up'} size={12} color={typeSort.field === 'total' ? Colors.accent : Colors.sub} />
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
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
      ListEmptyComponent={
        <EmptyState
          icon={loaded ? 'folder-open' : 'hourglass-empty'}
          title={loaded ? 'No asset types found' : 'Loading…'}
        />
      }
    />
  );
};

/** ================== TAB: All Assets (live filtered) ================== */
const AllAssetsTab = ({ query, filters }) => {
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
        logger.error('Failed to fetch assets:', err);
        setAssets([]);
      } finally {
        setLoaded(true);
      }
    };
    fetchAssets();
  }, []);

  const filtered = useMemo(() => {
    let arr = assets;
    const t = (query || '').trim().toLowerCase();
    if (t) {
      const tokens = t.split(/\s+/).filter(Boolean);
      arr = arr.filter((it) => {
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
    }
    const statusFilter = filters?.status;
    if (statusFilter) {
      const statusKey = normalizeStatus(statusFilter);
      arr = arr.filter(it => normalizeStatus(it?.status) === statusKey);
    }
    const typeFilters = filters?.assetTypes;
    if (typeFilters && typeFilters.length > 0) {
      const set = new Set(typeFilters.map(t => String(t).toLowerCase()));
      arr = arr.filter(it => {
        const type = it?.asset_type ?? it?.type ?? it?.asset_types?.name ?? '';
        return set.has(String(type).toLowerCase());
      });
    }
    return arr;
  }, [assets, query, filters?.status, filters?.assetTypes]);

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
    const updatedAt = item?.updated_at ?? item?.fields?.updated_at;
    const notes = item?.notes ?? item?.fields?.notes ?? item?.description ?? '';

    const subtitle = [serial ? `SN ${serial}` : null, model || null].filter(Boolean).join(' · ');

    const s = statusToColor(item?.status);
    const isExpanded = expandedIds.has(String(item.id));

    // Relative time for last updated
    const timeAgo = (iso) => {
      if (!iso) return null;
      const diff = Date.now() - new Date(iso).getTime();
      const m = Math.floor(diff / 60000);
      if (m < 1) return 'just now';
      if (m < 60) return `${m}m ago`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h}h ago`;
      const d = Math.floor(h / 24);
      if (d < 30) return `${d}d ago`;
      return prettyDate(iso);
    };
    const updatedLabel = timeAgo(updatedAt);

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.88}
        onPress={() => {
          if (onOpen) { onOpen(item.id); return; }
          router.push({ pathname: '/asset/[assetId]', params: { assetId: String(item.id), returnTo: '/Inventory?tab=all' } });
        }}
        onLongPress={() => toggleExpand(item.id)}
      >
        {/* Coloured status accent bar on the left edge */}
        <View style={[styles.cardAccent, { backgroundColor: Colors.primary }]} />

        <View style={styles.cardLeft}>
          {item?.image_url ? (
            <Image source={{ uri: item.image_url }} style={styles.cardImage} resizeMode="cover" />
          ) : (
            <View style={[styles.cardImage, styles.cardImagePlaceholder, { backgroundColor: Colors.primaryLight, borderColor: Colors.line }]}>
              <Feather name="package" size={20} color={Colors.primary} />
            </View>
          )}
        </View>

        <View style={styles.cardBody}>
          {/* Title row with type label + status badge */}
          <View style={styles.cardHeaderRow}>
            <View style={{ flex: 1, marginRight: 6 }}>
              <Text style={styles.cardTitle} numberOfLines={1}>{name}</Text>
              {!!type && <Text style={styles.cardTypeLabel} numberOfLines={1}>{type}</Text>}
            </View>
            <View style={[styles.badge, { backgroundColor: s.bg, borderColor: s.bd }]}>
              <Text style={[styles.badgeText, { color: s.fg }]}>{prettyStatus(item?.status)}</Text>
            </View>
          </View>

          {/* Subtitle: serial / model / updated */}
          <View style={styles.cardMeta}>
            {!!subtitle && <Text style={styles.cardSubtitle} numberOfLines={1}>{subtitle}</Text>}
            {!!updatedLabel && (
              <View style={styles.updatedPill}>
                <Feather name="clock" size={10} color={Colors.sub2} />
                <Text style={styles.updatedPillText}>{updatedLabel}</Text>
              </View>
            )}
          </View>

          {/* Chips */}
          <View style={styles.metaRow}>
            {(() => {
              const chips = [];
              if (assignedTo) chips.push({ icon: 'user', text: truncate(String(assignedTo), 22) });
              if (loc) chips.push({ icon: 'map-pin', text: truncate(String(loc), 18) });
              if (chips.length < 2 && model) chips.push({ icon: 'cpu', text: truncate(String(model), 18) });
              if (chips.length < 2 && datePurchased) chips.push({ icon: 'calendar', text: prettyDate(datePurchased) });
              return chips.slice(0, 2).map((c, idx) => (
                <MetaChip key={`chip-${idx}`} icon={c.icon} text={c.text} />
              ));
            })()}
            {/* Asset ID chip */}
            <View style={styles.idChip}>
              <Text style={styles.idChipText} numberOfLines={1}>#{item.id}</Text>
            </View>
          </View>

          {/* Expanded detail panel */}
          {isExpanded && (
            <View style={styles.moreWrap}>
              <DetailRow icon="hash" label="ID" value={String(item.id)} />
              {model ? <DetailRow icon="cpu" label="Model" value={String(model)} /> : null}
              {serial ? <DetailRow icon="bar-chart-2" label="Serial" value={String(serial)} /> : null}
              {datePurchased ? <DetailRow icon="calendar" label="Purchased" value={prettyDate(datePurchased)} /> : null}
              {updatedAt ? <DetailRow icon="clock" label="Updated" value={prettyDate(updatedAt)} /> : null}
              {loc ? <DetailRow icon="map-pin" label="Location" value={String(loc)} /> : null}
              {notes ? (
                <View style={styles.notesRow}>
                  <Feather name="file-text" size={13} color={Colors.primary} />
                  <Text style={styles.notesText} numberOfLines={3}>{String(notes)}</Text>
                </View>
              ) : null}
            </View>
          )}
        </View>

        <TouchableOpacity style={styles.cardRight} onPress={() => toggleExpand(item.id)} hitSlop={8}>
          <View style={[styles.expandBtn, isExpanded && styles.expandBtnActive]}>
            <MaterialIcons name={isExpanded ? 'expand-less' : 'expand-more'} size={20} color={isExpanded ? Colors.accent : Colors.sub2} />
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <FlatList
      ListHeaderComponent={
        <View style={styles.sortBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sortCountText}>{sortedAssets.length} assets</Text>
          </View>
          <Text style={styles.sortLabel}>Sort:</Text>
          <TouchableOpacity
            style={[styles.sortChip, assetSort.field === 'name' && styles.sortChipActive]}
            onPress={() => setAssetSort((s) => ({ field: 'name', dir: s.field === 'name' && s.dir === 'asc' ? 'desc' : 'asc' }))}
          >
            <Feather name={assetSort.field === 'name' && assetSort.dir === 'desc' ? 'arrow-down' : 'arrow-up'} size={12} color={assetSort.field === 'name' ? Colors.accent : Colors.sub} />
            <Text style={[styles.sortText, assetSort.field === 'name' && styles.sortTextActive]}>Name</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sortChip, assetSort.field === 'updated' && styles.sortChipActive]}
            onPress={() => setAssetSort((s) => ({ field: 'updated', dir: s.field === 'updated' && s.dir === 'asc' ? 'desc' : 'asc' }))}
          >
            <Feather name={assetSort.field === 'updated' && assetSort.dir === 'desc' ? 'arrow-down' : 'arrow-up'} size={12} color={assetSort.field === 'updated' ? Colors.accent : Colors.sub} />
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
        <EmptyState
          icon={loaded ? 'search-off' : 'hourglass-empty'}
          title={loaded ? 'No assets found' : 'Loading…'}
          subtitle={loaded ? 'Try adjusting your search or filters.' : undefined}
        />
      }
    />
  );
};

/** -------------- Main -------------- */
const Inventory = () => {
  const router = useRouter();
  const theme = useTheme();
  const { tab } = useLocalSearchParams();
  const [index, setIndex] = useState(tab === 'types' ? 1 : 0);

  // Sync tab index with URL param
  useEffect(() => {
    if (tab === 'all') setIndex(0);
    else if (tab === 'types') setIndex(1);
  }, [tab]);

  const [headerQuery, setHeaderQuery] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [filters, setFilters] = useState({ status: null, assetTypes: [] });
  const [filterAssetTypes, setFilterAssetTypes] = useState([]);
  const [typeSearch, setTypeSearch] = useState('');

  const [routes] = useState([
    { key: 'all', title: 'All Assets' },
    { key: 'types', title: 'Asset Types' },
  ]);

  // Fetch asset types for filter dropdown
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/assets/asset-types-summary`);
        const data = await res.json();
        if (!ignore && Array.isArray(data)) {
          setFilterAssetTypes(data.map(t => t.name).filter(Boolean));
        }
      } catch { if (!ignore) setFilterAssetTypes([]); }
    })();
    return () => { ignore = true; };
  }, []);

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

  // renderScene with props so we can pass the live query and filters down
  const renderScene = ({ route }) => {
    if (route.key === 'types') return <AssetTypesTab query={headerQuery} filters={filters} />;
    if (route.key === 'all') return <AllAssetsTab query={headerQuery} filters={filters} />;
    return null;
  };

  const activeFilterCount = [filters.status, ...(filters.assetTypes || [])].filter(Boolean).length;

  const isTypesTab = index === 1;
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
          {!isTypesTab && (
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => setFilterModalOpen(true)}
            >
              <View style={{ position: 'relative' }}>
                <Feather name="sliders" size={22} color={Colors.accent} />
                {activeFilterCount > 0 && (
                  <View style={styles.filterBadge}>
                    <Text style={styles.filterBadgeText}>{Math.min(activeFilterCount, 9)}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          )}
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
                indicatorStyle={{ backgroundColor: Colors.accent }}
                style={{ backgroundColor: Colors.card }}
                activeColor={Colors.text}
                inactiveColor={Colors.sub2}
                labelStyle={{ fontWeight: '800' }}
                renderLabel={({ route, focused }) => (
                  <Text
                    style={{
                      color: focused ? Colors.text : Colors.sub2,
                      fontWeight: focused ? '800' : 'normal',
                      fontSize: sf(14),
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

        {/* Filter Modal */}
        <Modal visible={filterModalOpen} transparent animationType="fade">
          <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
            <TouchableOpacity style={styles.modalBackdropTouch} activeOpacity={1} onPress={() => { setFilterModalOpen(false); setTypeSearch(''); }} />
            <View style={styles.filterSheet}>
              <View style={styles.filterSheetHeader}>
                <Text style={styles.filterSheetTitle}>FILTERS</Text>
                <TouchableOpacity onPress={() => { setFilterModalOpen(false); setTypeSearch(''); }}>
                  <MaterialIcons name="close" size={24} color={Colors.sub} />
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.filterSheetScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={styles.filterGroupTitle}>Status</Text>
                <View style={styles.filterChipsRow}>
                  <TouchableOpacity
                    style={[styles.filterChip, !filters.status && styles.filterChipActive]}
                    onPress={() => setFilters(f => ({ ...f, status: null }))}
                  >
                    <Text style={[styles.filterChipText, !filters.status && styles.filterChipTextActive]}>Any</Text>
                  </TouchableOpacity>
                  {['In Service', 'On Hire', 'Repair', 'Maintenance', 'End of Life'].map(s => (
                    <TouchableOpacity
                      key={s}
                      style={[styles.filterChip, filters.status === s && { ...styles.filterChipActive, backgroundColor: Colors.accent }]}
                      onPress={() => setFilters(f => ({ ...f, status: f.status === s ? null : s }))}
                    >
                      <Text style={[styles.filterChipText, filters.status === s && { ...styles.filterChipTextActive, color: '#fff' }]}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={[styles.filterGroupTitle, { marginTop: 16 }]}>Asset Type</Text>
                {(filters.assetTypes || []).length > 0 && (
                  <View style={styles.filterSelectedTypesWrap}>
                    {(filters.assetTypes || []).map(t => (
                      <View key={t} style={styles.filterSelectedChip}>
                        <Text style={styles.filterSelectedChipText} numberOfLines={1}>{t}</Text>
                        <TouchableOpacity onPress={() => setFilters(f => ({ ...f, assetTypes: (f.assetTypes || []).filter(x => x !== t) }))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Feather name="x" size={14} color={Colors.accent} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
                <TextInput
                  style={styles.filterTypeInput}
                  placeholder="Search and select asset types…"
                  placeholderTextColor="#94A3B8"
                  value={typeSearch}
                  onChangeText={setTypeSearch}
                />
                {typeSearch.trim().length > 0 && (
                  <ScrollView style={styles.filterTypeList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                    {filterAssetTypes
                      .filter(t => String(t).toLowerCase().includes(typeSearch.trim().toLowerCase()) && !(filters.assetTypes || []).includes(t))
                      .map(t => (
                        <TouchableOpacity
                          key={t}
                          style={styles.filterTypeItem}
                          onPress={() => { setFilters(f => ({ ...f, assetTypes: [...(f.assetTypes || []), t] })); setTypeSearch(''); }}
                        >
                          <Text style={styles.filterTypeItemText} numberOfLines={1}>{t}</Text>
                        </TouchableOpacity>
                      ))}
                  </ScrollView>
                )}
              </ScrollView>
              {activeFilterCount > 0 && (
                <TouchableOpacity
                  style={styles.filterClearBtn}
                  onPress={() => { setFilters({ status: null, assetTypes: [] }); setTypeSearch(''); setFilterModalOpen(false); }}
                >
                  <Text style={styles.filterClearText}>Clear all</Text>
                </TouchableOpacity>
              )}
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* FAB (admin only) */}
        {isAdmin && (
          <TourTarget
            id={index === 1 ? 'btn-manage-types' : 'btn-add-asset'}
            style={[styles.fab, { backgroundColor: Colors.accent }]}
          >
            <TouchableOpacity
              style={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}
              onPress={() => (index === 1 ? router.push('/type/new') : router.push('/asset/new'))}
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
  header: { flexDirection: 'row', padding: 10, backgroundColor: Colors.card },
  searchInput: {
    flex: 1, backgroundColor: '#f5f5f5', padding: 10, borderRadius: 5,
    marginRight: 10, borderColor: '#ddd', borderWidth: 1, color: '#111',
  },
  iconButton: { padding: 10 },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: Colors.accent,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  filterBadgeText: { color: '#fff', fontSize: sf(10), fontWeight: '700' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalBackdropTouch: { flex: 1, width: '100%' },
  filterSheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    padding: 20,
    maxHeight: '70%',
  },
  filterSheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  filterSheetTitle: { fontSize: sf(18), fontWeight: '900', color: Colors.text, textTransform: 'uppercase' },
  filterSheetScroll: { maxHeight: 320 },
  filterGroupTitle: { fontSize: sf(12), fontWeight: '700', color: Colors.sub, marginBottom: 8, textTransform: 'uppercase' },
  filterChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.card,
  },
  filterChipActive: { backgroundColor: Colors.accentLight, borderColor: Colors.accent },
  filterChipText: { fontSize: sf(13), fontWeight: '600', color: Colors.sub },
  filterChipTextActive: { color: Colors.accent, fontWeight: '700' },
  filterClearBtn: {
    marginTop: 16,
    paddingVertical: 10,
    alignItems: 'center',
    borderTopWidth: 2,
    borderTopColor: Colors.line,
  },
  filterClearText: { color: Colors.accent, fontWeight: '800', fontSize: sf(14), textTransform: 'uppercase' },
  filterSelectedTypesWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  filterSelectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.accentLight,
    borderWidth: 2,
    borderColor: Colors.accent,
    borderRadius: Radius.sm,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 6,
  },
  filterSelectedChipText: { fontSize: sf(13), fontWeight: '700', color: Colors.accent, maxWidth: 140 },
  filterTypeInput: {
    backgroundColor: Colors.card,
    borderWidth: 2,
    borderColor: Colors.line,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: sf(14),
    color: Colors.text,
    marginBottom: 8,
  },
  filterTypeList: { maxHeight: 180 },
  filterTypeItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  filterTypeItemActive: { backgroundColor: Colors.accentLight },
  filterTypeItemText: { fontSize: sf(14), color: Colors.text, fontWeight: '500' },
  filterTypeItemTextActive: { color: Colors.accent, fontWeight: '700' },
  extrasWrap: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 2,
    borderTopColor: Colors.line,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  /** FAB */
  fab: {
    position: 'absolute', right: 20, bottom: 30, backgroundColor: Colors.accent,
    width: 60, height: 60, borderRadius: Radius.lg, justifyContent: 'center', alignItems: 'center',
    ...Shadows.md,
  },

  /** ---- All Assets card UI ---- */
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 10,
    marginVertical: 5,
    borderRadius: Radius.lg,
    backgroundColor: Colors.card,
    borderWidth: 2,
    borderColor: Colors.line,
    overflow: 'hidden',
    ...Shadows.card,
  },
  cardAccent: {
    width: 4,
    alignSelf: 'stretch',
    minHeight: 72,
  },
  cardLeft: { marginLeft: 10, marginRight: 10, paddingVertical: 12 },
  cardImage: { width: 50, height: 50, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.line },
  cardImagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, paddingVertical: 10, paddingRight: 4 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'flex-start' },
  cardTitle: { fontSize: sf(15), fontWeight: '800', color: Colors.text, lineHeight: 20 },
  cardTypeLabel: { fontSize: sf(11), fontWeight: '700', color: Colors.sub2, textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 1 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 2 },
  cardSubtitle: { fontSize: sf(12), color: Colors.sub, fontWeight: '600', flex: 1 },
  updatedPill: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  updatedPillText: { fontSize: sf(11), color: Colors.sub2, fontWeight: '600' },
  badge: { paddingHorizontal: 11, paddingVertical: 4, borderRadius: Radius.sm, borderWidth: 1.5 },
  badgeText: { fontSize: sf(11), fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  metaRow: { flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.chip, paddingHorizontal: 7, paddingVertical: 4, borderRadius: Radius.sm,
    borderWidth: 1.5, borderColor: Colors.line,
  },
  metaText: { fontSize: sf(12), color: Colors.text, fontWeight: '600' },
  idChip: {
    paddingHorizontal: 7, paddingVertical: 4, borderRadius: Radius.sm,
    backgroundColor: Colors.primary, borderWidth: 0,
  },
  idChipText: { fontSize: sf(11), color: '#fff', fontWeight: '700', letterSpacing: 0.2 },
  moreWrap: { marginTop: 8, paddingTop: 10, borderTopWidth: 2, borderTopColor: Colors.line, gap: 7 },
  detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailLabel: { color: Colors.text, fontWeight: '600', fontSize: sf(13) },
  detailValue: { color: Colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right', marginLeft: 12, fontSize: sf(13) },
  // Sort bar (list header)
  sortBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 2, borderBottomColor: Colors.line,
    backgroundColor: Colors.card, marginHorizontal: 10, marginTop: 6,
    borderRadius: Radius.md, ...Shadows.card,
  },
  sortCountText: { fontSize: sf(12), color: Colors.sub, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.3 },
  sortLabel: { color: Colors.sub2, fontWeight: '800', fontSize: sf(11), textTransform: 'uppercase', letterSpacing: 0.3 },
  sortChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: Colors.line, backgroundColor: Colors.chip },
  sortChipActive: { borderColor: Colors.accent, backgroundColor: Colors.accentLight },
  sortText: { color: Colors.sub, fontWeight: '800', fontSize: sf(12) },
  sortTextActive: { color: Colors.accent },
  notesRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: Colors.accentLight, borderWidth: 1.5, borderColor: Colors.accentMuted,
    padding: 8, borderRadius: Radius.sm,
  },
  notesText: { color: Colors.text, flex: 1, lineHeight: 18, fontSize: sf(13) },
  cardRight: { paddingTop: 10, paddingRight: 10 },
  expandBtn: { width: 28, height: 28, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: Colors.line, backgroundColor: Colors.chip, alignItems: 'center', justifyContent: 'center' },
  expandBtnActive: { borderColor: Colors.accent, backgroundColor: Colors.accentLight },

  /** ---- Asset Types refined UI ---- */
  typeCard: {
    flexDirection: 'row', borderRadius: Radius.lg, backgroundColor: Colors.card,
    borderWidth: 2, borderColor: Colors.line, marginVertical: 6, marginHorizontal: 8,
    padding: 10, ...Shadows.card,
  },
  typeCover: { width: 56, height: 56, borderRadius: Radius.md, marginRight: 12, backgroundColor: Colors.chip, borderWidth: 1.5, borderColor: Colors.line },
  typeCoverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  typeBody: { flex: 1 },
  typeTitleRow: { flexDirection: 'row', alignItems: 'center' },
  typeTitle: { flex: 1, fontSize: sf(16), fontWeight: '800', color: Colors.text },
  typeChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 6, borderRadius: Radius.sm, borderWidth: 1.5 },
  typeChipText: { fontSize: sf(12), fontWeight: '700' },
});

export default Inventory;
