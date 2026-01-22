import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
  Image,
  Modal,
  SafeAreaView,
  useWindowDimensions,
  Switch,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather, MaterialIcons, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import QRCode from 'react-native-qrcode-svg';

import { API_BASE_URL } from '../../inventory-api/apiBase';
import { auth } from '../../firebaseConfig';
import SearchInput from '../../components/ui/SearchInput';
import ScreenHeader from '../../components/ui/ScreenHeader';
import Chip from '../../components/ui/Chip';
import InlineButton from '../../components/ui/InlineButton';
import { Colors as COLORS } from '../../constants/uiTheme';
import { Colors } from '../../constants/uiTheme';

const RECENT_KEY = 'search_recents_v2';
const ASSET_TYPE_OPTIONS = [
  'iPad', 'Vehicle', 'UG Locating', 'Two drill set', 'Total Station',
  'Torch', 'Target', 'Stamps', 'Staff', 'Sonar', 'Scanner', 'Satellite Phone',
  'Radio', 'Power Tool', 'Plummet', 'Office Equipment', 'Mounting Bracket',
  'Mobile phone', 'Metal detector', 'Magnetic Mount', 'Laptop', 'Camera',
  'Survey Gear', 'Generator', 'Computer', 'Server Rack', 'Tablet',
  'Handheld GPS', 'Excavator', 'Bulldozer', 'Truck', 'Trailer', 'Forklift',
];
const SORT_OPTIONS = [
  { label: 'Relevance', field: 'relevance' },
  { label: 'Last Updated', field: 'updated_at' },
  { label: 'Name', field: 'name' },
  { label: 'Service Due', field: 'service_due' },
  { label: 'Status', field: 'status' },
  { label: 'Asset Type', field: 'type' },
  { label: 'Location', field: 'location' },
  { label: 'Assigned To', field: 'assigned_to' },
  { label: 'Asset ID', field: 'id' },
];
const PAGE_SIZE_OPTIONS = [25, 50, 100, 'all'];

// Helper to extract items from API response
const extractItems = (data) => {
  if (Array.isArray(data)) return { arr: data, total: data.length };
  if (data && Array.isArray(data.assets)) return { arr: data.assets, total: data.total || data.assets.length };
  if (data && Array.isArray(data.data)) return { arr: data.data, total: data.total || data.data.length };
  return { arr: [], total: 0 };
};

const isUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export default function SearchScreen(props = {}) {
  const { embed } = props;
  const router = useRouter();
  const params = useLocalSearchParams();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isCompact = windowWidth < 768;

  // State
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [items, setItems] = useState([]);
  const [rawItems, setRawItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Modals
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [sortModalOpen, setSortModalOpen] = useState(false);
  const [qrModalItem, setQrModalItem] = useState(null);

  const [recents, setRecents] = useState([]);
  const [metrics, setMetrics] = useState({ total: 0, tookMs: 0 });
  const [hoverRowId, setHoverRowId] = useState(null);

  // View Mode: 'list' (Table) or 'grid' (Cards). Default to list on desktop, grid on mobile.
  const [viewMode, setViewMode] = useState(isCompact ? 'grid' : 'list');

  useEffect(() => {
    if (isCompact && viewMode !== 'grid') {
      setViewMode('grid');
    }
  }, [isCompact, viewMode]);

  // Pagination State
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Filters
  const [filters, setFilters] = useState({
    type: null,
    status: null,
    location: null,
    assignedTo: null,
    onlyMine: false,
    dueSoon: false,
    includeQRReserved: false,
    onlyUnassigned: false,
    awaitingQROnly: false,
  });

  // Sort
  const [sort, setSort] = useState({ field: 'updated_at', dir: 'desc' });

  // Dynamic type-specific columns
  const [typeFieldDefs, setTypeFieldDefs] = useState([]);
  const [typeFieldLoading, setTypeFieldLoading] = useState(false);
  const [typeFieldError, setTypeFieldError] = useState(null);
  const [activeTypeId, setActiveTypeId] = useState(null);
  const [showAllTypes, setShowAllTypes] = useState(false);

  // User
  const [me, setMe] = useState({ uid: null, email: null });


  // Load User
  useEffect(() => {
    const u = auth.currentUser;
    if (u) setMe({ uid: u.uid, email: u.email });
  }, []);

  // Debounce Query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Load Recents
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(RECENT_KEY);
        if (raw) setRecents(JSON.parse(raw));
      } catch { }
    })();
  }, []);

  // Initial Fetch
  useEffect(() => {
    fetchAll();
  }, [me.uid]); // Re-fetch when user loads

  // Build Query Params
  const buildQueryParams = useCallback((p = 1, limit = 10000) => {
    const params = new URLSearchParams();
    params.append('page', p.toString());
    params.append('limit', limit.toString());
    return params.toString();
  }, []);

  // Client-side Filter & Sort
  const getMaxPage = useCallback((length, size) => {
    if (size === 'all') return 1;
    const safeSize = typeof size === 'number' && size > 0 ? size : 1;
    return Math.max(1, Math.ceil(Math.max(length, 1) / safeSize));
  }, []);

  const clientFilterAndSort = useCallback((raw) => {
    const source = Array.isArray(raw) ? [...raw] : [];
    let filtered = source.filter(it => {
      // Keyword
      const q = debouncedQuery.toLowerCase();
      const keywordOk = !q || [
        it.name, it.asset_name, it.id, it.model, it.serial_number,
        it.asset_type, it.type, it.location, it.notes
      ].some(v => String(v || '').toLowerCase().includes(q));

      // Filters
      const typeOk = !filters.type || (it.asset_type === filters.type || it.type === filters.type || it.asset_types?.name === filters.type);
      const statusOk = !filters.status || (it.status === filters.status);
      const locOk = !filters.location || String(it.location || '').toLowerCase().includes(filters.location.toLowerCase());

      const assigned = it.assigned_to || it.users?.name || it.users?.useremail || it.users?.email;
      const assignedUid = it.assigned_to_id || it.assigned_to_uid || it.assigned_to_user_id;
      const assignedOk = !filters.assignedTo || String(assigned || '').toLowerCase().includes(filters.assignedTo.toLowerCase());

      const dueOk = !filters.dueSoon || (it.next_service_date && new Date(it.next_service_date) <= new Date(Date.now() + 7 * 86400000));

      const isMine = (me.uid && (assignedUid === me.uid)) || (me.email && String(assigned || '').toLowerCase().includes(me.email.toLowerCase()));
      const onlyMineOk = !filters.onlyMine || isMine;

      const desc = it.description || it.fields?.description || '';
      const isQRReserved = String(desc).trim().toLowerCase() === 'qr reserved asset';
      const reservedOk = !!filters.includeQRReserved || !isQRReserved;
      const unassignedOk = !(String(assigned).trim()) && !assignedUid;

      const awaitingQR = isUUID(String(it.id || ''));
      const awaitingOk = filters.awaitingQROnly ? awaitingQR : !awaitingQR;

      const baseOk = keywordOk && typeOk && statusOk && locOk && assignedOk && dueOk && onlyMineOk && reservedOk && awaitingOk;
      return filters.onlyUnassigned ? (baseOk && unassignedOk) : baseOk;
    });

    // robust sort
    const getVal = (it, f) => {
      if (!f) return undefined;
      switch (f) {
        case 'updated_at':
          return (
            it?.last_updated ??
            it?.updated_at ??
            it?.fields?.last_updated ??
            it?.fields?.updated_at ??
            ''
          );
        case 'name': return it?.name ?? it?.asset_name ?? '';
        case 'type': return it?.asset_type ?? it?.type ?? it?.asset_types?.name ?? '';
        case 'location': return it?.location ?? it?.fields?.location ?? '';
        case 'assigned_to': return it?.assigned_to ?? it?.users?.name ?? it?.users?.email ?? '';
        case 'next_service_date': return it?.next_service_date ?? it?.fields?.next_service_date ?? '';
        case 'id': return it?.id ?? it?.fields?.id ?? '';
        default: return it?.[f] ?? it?.fields?.[f];
      }
    };
    const isISODate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
    const cmpCore = (a, b, field, dir) => {
      const avRaw = getVal(a, field);
      const bvRaw = getVal(b, field);
      const aNull = avRaw == null || avRaw === '';
      const bNull = bvRaw == null || bvRaw === '';
      if (aNull || bNull) {
        if (aNull && bNull) return 0;
        return aNull ? -1 : 1;
      }

      let av = avRaw, bv = bvRaw;
      if (isISODate(av) && isISODate(bv)) {
        av = new Date(av).getTime();
        bv = new Date(bv).getTime();
      } else if (typeof av === 'string' && typeof bv === 'string') {
        av = av.toLowerCase();
        bv = bv.toLowerCase();
      } else if (!isNaN(Number(av)) && !isNaN(Number(bv))) {
        av = Number(av); bv = Number(bv);
      }
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    };
    // Custom comparators
    const computeRelevance = (it) => {
      const tokens = debouncedQuery.toLowerCase().split(/\s+/).filter(Boolean);
      if (!tokens.length) return 0;
      const name = (it?.name || it?.asset_name || '').toLowerCase();
      const id = String(it?.id || '').toLowerCase();
      const serial = String(it?.serial_number ?? it?.fields?.serial_number ?? '').toLowerCase();
      const model = String(it?.model ?? it?.fields?.model ?? '').toLowerCase();
      const loc = String(it?.location ?? it?.fields?.location ?? '').toLowerCase();
      const type = String(it?.asset_type ?? it?.type ?? it?.asset_types?.name ?? '').toLowerCase();
      let score = 0;
      if (tokens.includes(id)) score += 1000;
      tokens.forEach(t => {
        if (name.startsWith(t)) score += 300;
        if (name.includes(t)) score += 150;
        if (serial.includes(t)) score += 120;
        if (model.includes(t)) score += 90;
        if (type.includes(t)) score += 60;
        if (loc.includes(t)) score += 40;
      });
      return score;
    };

    const daysUntilService = (it) => {
      const iso = it?.next_service_date ?? it?.fields?.next_service_date;
      if (!iso) return null;
      const d = new Date(iso);
      if (Number.isNaN(+d)) return null;
      const today = new Date();
      return Math.ceil((d - today) / (1000 * 60 * 60 * 24));
    };

    const cmp = (a, b, field, dir) => {
      if (!field) return 0;
      if (field === 'relevance') {
        const av = computeRelevance(a);
        const bv = computeRelevance(b);
        if (av !== bv) return dir === 'asc' ? av - bv : bv - av;
        return cmpCore(a, b, 'name', 'asc');
      }
      if (field === 'service_due') {
        const ad = daysUntilService(a);
        const bd = daysUntilService(b);
        const aNull = ad === null;
        const bNull = bd === null;
        if (aNull || bNull) {
          if (aNull && bNull) return 0;
          return aNull ? -1 : 1;
        }
        return dir === 'asc' ? ad - bd : bd - ad;
      }
      return cmpCore(a, b, field, dir);
    };

    // Assigned-first weighting
    const isAssigned = (it) => {
      const uid = it?.assigned_to_id || it?.assigned_to_uid || it?.assigned_to_user_id;
      const name = it?.assigned_to || it?.users?.name || it?.users?.useremail || it?.users?.email;
      return !!(uid || name);
    };

    filtered.sort((a, b) => {
      const aAss = isAssigned(a);
      const bAss = isAssigned(b);
      if (aAss !== bAss) return aAss ? -1 : 1; // assigned first
      const p = cmp(a, b, sort.field, sort.dir);
      if (p !== 0) return p;
      return cmpCore(a, b, 'name', 'asc');
    });

    return filtered;
  }, [debouncedQuery, filters, me.email, me.uid, sort]);

  useEffect(() => {
    const processed = clientFilterAndSort(rawItems);
    setItems(processed);
    setMetrics((prev) => ({ ...prev, total: processed.length }));
    setPage((prev) => Math.min(prev, getMaxPage(processed.length, pageSize)));
  }, [rawItems, clientFilterAndSort, pageSize, getMaxPage]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQuery, filters]);

  const selectedTypeInfo = useMemo(() => {
    if (!filters.type) return null;
    const target = String(filters.type).toLowerCase();
    const pool = rawItems.length ? rawItems : items;
    const match = pool.find((it) => {
      const typeName = (it?.asset_type || it?.type || it?.asset_types?.name || '').toLowerCase();
      return typeName === target;
    });
    if (!match) return { name: filters.type, id: null };
    return {
      name: filters.type,
      id: match?.type_id || match?.asset_types?.id || null,
    };
  }, [filters.type, rawItems, items]);

  useEffect(() => {
    let cancelled = false;
    if (!filters.type) {
      setTypeFieldDefs([]);
      setActiveTypeId(null);
      setTypeFieldLoading(false);
      setTypeFieldError(null);
      return () => { cancelled = true; };
    }
    const typeId = selectedTypeInfo?.id;
    if (!typeId) {
      setTypeFieldDefs([]);
      setActiveTypeId(null);
      setTypeFieldLoading(false);
      setTypeFieldError(null);
      return () => { cancelled = true; };
    }
    if (activeTypeId === typeId && typeFieldDefs.length) return () => { cancelled = true; };
    setTypeFieldLoading(true);
    setTypeFieldError(null);
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/assets/asset-types/${typeId}/fields`);
        if (!res.ok) throw new Error('Failed to load fields');
        const defs = await res.json();
        if (cancelled) return;
        const arr = Array.isArray(defs) ? defs : [];
        setTypeFieldDefs(arr);
        setActiveTypeId(typeId);
      } catch (err) {
        if (cancelled) return;
        setTypeFieldDefs([]);
        setActiveTypeId(null);
        setTypeFieldError(err?.message || 'Failed to load fields');
      } finally {
        if (!cancelled) setTypeFieldLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filters.type, selectedTypeInfo?.id, activeTypeId, typeFieldDefs.length]);

  const saveRecent = useCallback(async () => {
    const labelParts = [];
    if (debouncedQuery) labelParts.push(`“${debouncedQuery}”`);
    if (filters.onlyMine) labelParts.push('My assets');
    if (filters.status) labelParts.push(`Status:${filters.status}`);
    if (filters.type) labelParts.push(`Type:${filters.type}`);
    if (filters.dueSoon) labelParts.push('Due soon');
    if (filters.awaitingQROnly) labelParts.push('QR awaiting');
    const label = labelParts.join(' · ');
    if (!label) return;
    const entry = { label, query: debouncedQuery, filters, sort, ts: Date.now() };
    const next = [entry, ...recents.filter(r => r.label !== label)].slice(0, 10);
    setRecents(next);
    try { await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { }
  }, [debouncedQuery, filters, sort, recents]);

  const fetchAll = useCallback(async () => {
    if (loading) return;
    if (filters.onlyMine && !me.uid && !me.email) return;

    setLoading(true);
    setError(null);

    const perfNow = () => (typeof performance !== 'undefined' && performance?.now ? performance.now() : Date.now());
    const t0 = perfNow();

    try {
      const qs = buildQueryParams(1, 10000);

      const endpoints = [
        `${API_BASE_URL}/assets?${qs}`,
        `${API_BASE_URL}/assets/search?${qs}`,
      ];

      let data = null, ok = false, lastErr = null;
      for (const url of endpoints) {
        try {
          const res = await fetch(url);
          if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }
          data = await res.json();
          ok = true; break;
        } catch (e) { lastErr = e?.message || 'Network error'; }
      }
      if (!ok) throw new Error(lastErr || 'Search failed');

      const { arr: rawItems } = extractItems(data);
      setRawItems(rawItems);
      const processed = clientFilterAndSort(rawItems);
      setItems(processed);

      const tookMs = Math.max(0, Math.round(perfNow() - t0));
      setMetrics({ total: processed.length, tookMs });
      saveRecent();
    } catch (e) {
      setError(e.message);
      setRawItems([]);
      setItems([]);
      setMetrics({ total: 0, tookMs: 0 });
    } finally {
      setLoading(false);
    }
  }, [loading, filters.onlyMine, me.uid, me.email, buildQueryParams, clientFilterAndSort, saveRecent]);

  const quickToggle = (key) => setFilters(f => ({ ...f, [key]: !f[key] }));
  const clearFilters = () => {
    setQuery('');
    setDebouncedQuery('');
    setFilters({
      type: null,
      status: null,
      location: null,
      assignedTo: null,
      onlyMine: false,
      dueSoon: false,
      includeQRReserved: false,
      onlyUnassigned: false,
      awaitingQROnly: false,
    });
  };

  // active filter count for badge
  const activeCount = [
    !!debouncedQuery,
    !!filters.type,
    !!filters.status,
    !!filters.location,
    !!filters.assignedTo,
    !!filters.onlyMine,
    !!filters.dueSoon,
    !!filters.awaitingQROnly,
  ].filter(Boolean).length;

  const hideHeader = !!embed;
  const computeReturnTarget = useCallback(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        const current = `${window.location.pathname}${window.location.search || ''}`;
        if (current) return current;
      } catch {}
    }
    return embed ? '/(tabs)/dashboard?view=dashboard' : '/search';
  }, [embed]);

  const goToAsset = useCallback((id) => {
    if (!id) return;
    try {
      const returnTo = computeReturnTarget();
      router.push({ pathname: '/asset/[assetId]', params: { assetId: String(id), returnTo } });
    } catch (err) {
      console.warn('Navigation error:', err);
    }
  }, [router, computeReturnTarget]);

  const actionsNode = (
    <>
      {/* Filter Button */}
      <TouchableOpacity style={styles.iconBtn} onPress={() => setFilterModalOpen(true)}>
        <View style={{ position: 'relative' }}>
          <Feather name="sliders" size={18} color={COLORS.primary} />
          {activeCount > 0 && (
            <View style={styles.countDot}>
              <Text style={styles.countDotText}>{Math.min(activeCount, 9)}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>

      <TouchableOpacity style={styles.iconBtn} onPress={() => { setPage(1); fetchAll(); }}>
        <Feather name="refresh-ccw" size={18} color={COLORS.primary} />
      </TouchableOpacity>
    </>
  );
  const Container = embed ? View : SafeAreaView;

  // --- Table Columns ---
  const normalizeFieldKey = (key) => String(key || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const formatFieldLabel = (raw) => {
    const cleaned = String(raw || '').replace(/[_-]+/g, ' ').trim();
    if (!cleaned) return '';
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  };

  const baseColumns = useMemo(() => ([
      { key: 'qr', label: '', width: 50 },
    { key: 'image', label: '', width: 80 },
      { key: 'id', label: 'Asset Id', width: 100 },
    { key: 'other_id', label: 'Other Id', width: 110 },
      { key: 'type', label: 'Asset type', width: 120 },
    { key: 'serial', label: 'SERIAL NUMBER', width: 140 },
    { key: 'description', label: 'Description', flex: 0.45, minWidth: 60 },
    { key: 'model', label: 'Model', flex: 0.375, minWidth: 53 },
    { key: 'assigned', label: 'Assigned To', flex: 0.3, minWidth: 46 },
    { key: 'status', label: 'Status', width: 105 },
    { key: 'purchased', label: 'Date Purchased', width: 125 },
      { key: 'updated', label: 'Last Updated', width: 140 },
    { key: 'updated_by', label: 'Last updated By', width: 145 },
  ]), []);

  const dynamicColumns = useMemo(() => {
    if (!filters.type || !Array.isArray(typeFieldDefs) || !typeFieldDefs.length) return [];
    return typeFieldDefs.map((def) => ({
      key: `dyn_${def.id || def.slug}`,
      label: def.name || formatFieldLabel(def.slug),
      minWidth: 160,
      flex: 1,
      isDynamic: true,
      field: def,
    }));
  }, [filters.type, typeFieldDefs]);

  const columns = useMemo(() => [...baseColumns, ...dynamicColumns], [baseColumns, dynamicColumns]);

  const columnMap = useMemo(() => {
    const map = {};
    columns.forEach((col) => {
      map[col.key] = col;
    });
    return map;
  }, [columns]);

  const lastColumnKey = useMemo(() => (columns.length ? columns[columns.length - 1].key : null), [columns]);

  const columnStyle = useCallback((key) => {
    const col = columnMap[key];
    if (!col) return {};
    const size = col.width ? { width: col.width } : { flex: col.flex || 1, minWidth: col.minWidth || 120 };
    return size;
  }, [columnMap, lastColumnKey]);

  const tableMinWidth = useMemo(() => {
    return columns.reduce((sum, col) => {
      if (col.width) return sum + col.width;
      return sum + (col.minWidth || 140);
    }, 0);
  }, [columns]);

  const visibleAssetTypes = useMemo(() => {
    if (showAllTypes) return ASSET_TYPE_OPTIONS;
    return ASSET_TYPE_OPTIONS.slice(0, 8);
  }, [showAllTypes]);

  const filterScrollMaxHeight = useMemo(() => {
    const h = windowHeight || 800;
    return Math.min(Math.max(h - 260, 420), 720);
  }, [windowHeight]);

  const currentSortLabel = useMemo(() => {
    const opt = SORT_OPTIONS.find((o) => o.field === sort.field);
    if (opt) return opt.label;
    if (!sort.field) return 'Relevance';
    return formatFieldLabel(sort.field);
  }, [sort.field]);

  const getDynamicFieldValue = (asset, def) => {
    if (!asset || !def) return null;
    const fields = asset.fields && typeof asset.fields === 'object' ? asset.fields : null;
    if (!fields) return null;
    const slug = def.slug ? normalizeFieldKey(def.slug) : null;
    const label = def.name ? normalizeFieldKey(def.name) : null;
    const candidates = new Set();
    if (slug) candidates.add(slug);
    if (label) candidates.add(label);
    for (const key of Object.keys(fields)) {
      const normKey = normalizeFieldKey(key);
      if (candidates.has(normKey)) return fields[key];
    }
    if (slug && Object.prototype.hasOwnProperty.call(fields, slug)) return fields[slug];
    if (label && Object.prototype.hasOwnProperty.call(fields, label)) return fields[label];
    return null;
  };

  const formatDynamicValue = (def, value) => {
    if (value === null || value === undefined || value === '') return '—';
    const fieldType = String(def?.field_type?.slug || def?.field_type?.name || '').toLowerCase();
    if (Array.isArray(value)) {
      return value.length ? value.map((v) => String(v)).join(', ') : '—';
    }
    if (fieldType === 'boolean') {
      if (typeof value === 'boolean') return value ? 'Yes' : 'No';
      const lowered = String(value).toLowerCase();
      if (['true', 'yes', '1'].includes(lowered)) return 'Yes';
      if (['false', 'no', '0'].includes(lowered)) return 'No';
    }
    if (fieldType === 'date') {
      try {
        const d = new Date(value);
        if (!Number.isNaN(+d)) {
          return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        }
      } catch { }
    }
    if (['number', 'decimal', 'currency'].includes(fieldType)) {
      const num = Number(value);
      if (!Number.isNaN(num)) return num.toLocaleString();
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  };

  // --- Render Helpers ---
  const statusToColor = (s) => {
    const t = String(s || '').toLowerCase();
    if (['available', 'in service', 'reserved'].includes(t)) return { bg: '#DCFCE7', fg: '#166534', bd: '#BBF7D0' };
    if (['maintenance', 'repair'].includes(t)) return { bg: '#FEF9C3', fg: '#854D0E', bd: '#FEF08A' };
    if (['checked out', 'rented'].includes(t)) return { bg: '#DBEAFE', fg: '#1E40AF', bd: '#BFDBFE' };
    if (['end of life', 'lost', 'retired'].includes(t)) return { bg: '#FEE2E2', fg: '#991B1B', bd: '#FECACA' };
    return { bg: '#F3F4F6', fg: '#374151', bd: '#E5E7EB' };
  };

  const prettyStatus = (s) => {
    if (!s) return 'Unknown';
    return s.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  };

  const formatDaysUntil = (iso) => {
    try {
      if (!iso) return '—';
      const d = new Date(iso);
      if (Number.isNaN(+d)) return '—';
      const today = new Date();
      const diff = Math.ceil((d - today) / (1000 * 60 * 60 * 24));
      if (diff === 0) return 'due today';
      if (diff < 0) return `${Math.abs(diff)}d overdue`;
      return `${diff}d`;
    } catch {
      return '—';
    }
  };

  // Pagination Logic
  const paginatedItems = useMemo(() => {
    if (pageSize === 'all') return items;
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(Math.max(items.length, 1) / pageSize));
  const pageRangeStart = pageSize === 'all'
    ? (items.length ? 1 : 0)
    : (items.length ? ((page - 1) * pageSize) + 1 : 0);
  const pageRangeEnd = pageSize === 'all'
    ? items.length
    : Math.min(page * pageSize, items.length);

  return (
    <Container style={embed ? styles.embedContainer : styles.container}>
      {!hideHeader && (
        <ScreenHeader
          title="Search"
          backLabel="Dashboard"
          onBack={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace('/(tabs)/dashboard');
                }
              }}
        />
      )}

      {/* Search input */}
      <View style={styles.toolbarSurface}>
        <SearchInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name, ID, serial, model, notes…"
          style={[hideHeader && styles.searchRowCompact]}
          inputStyle={{ fontSize: 16 }}
          autoCapitalize="none"
          autoCorrect={false}
          right={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {actionsNode}
            </View>
          }
        />
        {/* Quick filters */}
        <View style={styles.quickRow}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Chip label="My assets" icon="user" active={filters.onlyMine} onPress={() => quickToggle('onlyMine')} />
            <Chip label="Needs service" icon="tool" active={filters.dueSoon} onPress={() => quickToggle('dueSoon')} />
            <Chip label="In Service" icon="check-circle" active={filters.status === 'In Service'} onPress={() => setFilters(f => ({ ...f, status: f.status === 'In Service' ? null : 'In Service' }))} />
            <Chip label="QR awaiting" icon="alert-circle" active={filters.awaitingQROnly} onPress={() => setFilters(f => ({ ...f, awaitingQROnly: !f.awaitingQROnly }))} />
          </View>

          <View style={{ flexDirection: 'row', gap: 8 }}>
            {/* Sort Button */}
            <TouchableOpacity style={[styles.iconBtn, styles.actionBtn, { marginRight: 0, height: 32, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' }]} onPress={() => setSortModalOpen(true)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MaterialIcons name="sort" size={18} color={COLORS.primary} />
                <Text style={styles.actionBtnText}>
                  {`${currentSortLabel} · ${(sort.dir || 'desc').toUpperCase()}`}
                </Text>
              </View>
            </TouchableOpacity>

            {!isCompact && (
              <View style={styles.viewToggleGroup}>
                <TouchableOpacity
                  style={[styles.viewToggleBtn, viewMode === 'grid' && styles.viewToggleBtnActive]}
                  onPress={() => setViewMode('grid')}
                >
                  <Feather name="grid" size={18} color={viewMode === 'grid' ? COLORS.primary : '#64748B'} />
                  <Text style={[styles.viewToggleText, viewMode === 'grid' && styles.viewToggleTextActive]}>Grid</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.viewToggleBtn, viewMode === 'list' && styles.viewToggleBtnActive]}
                  onPress={() => setViewMode('list')}
                >
                  <Feather name="list" size={18} color={viewMode === 'list' ? COLORS.primary : '#64748B'} />
                  <Text style={[styles.viewToggleText, viewMode === 'list' && styles.viewToggleTextActive]}>Table</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Content Area */}
    {filters.type && typeFieldLoading && (
      <View style={[styles.inlineAlert, { marginHorizontal: 12 }]}>
        <ActivityIndicator size="small" color={COLORS.primary} />
        <Text style={[styles.inlineAlertText, { marginLeft: 8 }]}>Loading {filters.type} fields…</Text>
      </View>
    )}
    {filters.type && typeFieldError && (
      <View style={[styles.inlineAlert, { marginHorizontal: 12, backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]}>
        <MaterialIcons name="error-outline" size={16} color="#B91C1C" />
        <Text style={[styles.inlineAlertText, { marginLeft: 6, color: '#B91C1C' }]}>{typeFieldError}</Text>
      </View>
    )}

      {/* Inline Filters REMOVED per user request */}

      {loading && !items.length ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={{ marginTop: 12, color: COLORS.sub }}>Searching...</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <MaterialIcons name="error-outline" size={48} color={COLORS.dangerFg} />
          <Text style={{ marginTop: 12, color: COLORS.dangerFg }}>{error}</Text>
          <TouchableOpacity style={[styles.btn, { marginTop: 16 }]} onPress={fetchAll}>
            <Text style={styles.btnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <MaterialIcons name="search-off" size={48} color="#CBD5E1" />
          <Text style={{ marginTop: 12, color: COLORS.sub, fontSize: 16, fontWeight: '600' }}>No assets found</Text>
          <Text style={{ marginTop: 4, color: COLORS.sub2 }}>Try adjusting your search or filters</Text>
        </View>
      ) : (
        /* Responsive View Switch */
        (viewMode === 'grid') ? (
          /* Mobile/Grid Card View */
          <ScrollView style={styles.mobileScroll} contentContainerStyle={styles.mobileScrollContent}>
            <Text style={styles.metaText}>{metrics.total} assets found • {metrics.tookMs} ms</Text>
            <View style={styles.gridContainer}>
            {paginatedItems.map((item) => {
              const statusColor = statusToColor(item?.status);
              const assignedTo = item?.assigned_to ?? item?.users?.name ?? item?.users?.useremail ?? item?.users?.email;
              const loc = item?.location ?? item?.fields?.location;
              const model = item?.model ?? item?.fields?.model;
              const nextService = item?.next_service_date ?? item?.fields?.next_service_date;

              return (
                <TouchableOpacity
                  key={item.id}
                    style={[styles.mobileCard, !isCompact && styles.desktopGridCard]}
                  activeOpacity={0.8}
                    onPress={() => goToAsset(item.id)}
                >
                  <View style={styles.mobileCardHeader}>
                    <View style={{ flexDirection: 'row', gap: 12, flex: 1 }}>
                      {item?.image_url ? (
                        <Image source={{ uri: item.image_url }} style={styles.mobileThumb} />
                      ) : (
                        <View style={[styles.mobileThumb, styles.mobileThumbPlaceholder]}>
                          <Ionicons name="image-outline" size={20} color={COLORS.sub2} />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.mobileCardTitle} numberOfLines={1}>{item?.name || item?.asset_name || 'Unnamed Asset'}</Text>
                        <Text style={styles.mobileCardSubtitle} numberOfLines={1}>
                          {item?.id} • {item?.asset_type ?? item?.type ?? item?.asset_types?.name ?? 'Unknown Type'}
                        </Text>
                      </View>
                    </View>
                    <View style={[styles.mobileStatusBadge, { backgroundColor: statusColor.bg, borderColor: statusColor.bd }]}>
                      <Text style={[styles.mobileStatusText, { color: statusColor.fg }]}>{prettyStatus(item?.status)}</Text>
                    </View>
                  </View>

                  <View style={styles.mobileCardDetails}>
                    {model ? (
                      <View style={styles.mobileDetailRow}>
                        <Feather name="cpu" size={14} color="#64748B" />
                        <Text style={styles.mobileDetailLabel}>Model:</Text>
                        <Text style={styles.mobileDetailValue} numberOfLines={1}>{model}</Text>
                      </View>
                    ) : null}
                    {assignedTo ? (
                      <View style={styles.mobileDetailRow}>
                        <Feather name="user" size={14} color="#64748B" />
                        <Text style={styles.mobileDetailLabel}>Assigned:</Text>
                        <Text style={styles.mobileDetailValue} numberOfLines={1}>{assignedTo}</Text>
                      </View>
                    ) : null}
                    {loc ? (
                      <View style={styles.mobileDetailRow}>
                        <Feather name="map-pin" size={14} color="#64748B" />
                        <Text style={styles.mobileDetailLabel}>Location:</Text>
                        <Text style={styles.mobileDetailValue} numberOfLines={1}>{loc}</Text>
                      </View>
                    ) : null}
                    {nextService ? (
                      <View style={styles.mobileDetailRow}>
                        <Feather name="tool" size={14} color="#64748B" />
                        <Text style={styles.mobileDetailLabel}>Service:</Text>
                        <Text style={[styles.mobileDetailValue, { color: '#B45309', fontWeight: '700' }]} numberOfLines={1}>
                            {formatDaysUntil(nextService)}
                        </Text>
                      </View>
                    ) : null}
                      {filters.type && typeFieldDefs.map((def) => {
                        const val = getDynamicFieldValue(item, def);
                        if (val === null || val === undefined || val === '') return null;
                        return (
                          <View key={`mobile-${item.id}-${def.id}`} style={styles.mobileDetailRow}>
                            <Text style={styles.mobileDetailLabel}>{formatFieldLabel(def.name || def.slug)}:</Text>
                            <Text style={styles.mobileDetailValue} numberOfLines={1}>{formatDynamicValue(def, val)}</Text>
                          </View>
                        );
                      })}
                  </View>

                  <View style={styles.mobileCardActions}>
                    <View style={[styles.mobileActionBtn, styles.mobileActionBtnPrimary]}>
                      <Text style={styles.mobileActionBtnText}>View Details</Text>
                      <Feather name="arrow-right" size={16} color="#fff" />
                    </View>
                  </View>
                </TouchableOpacity>
              );

            })}
            </View>

            {/* Mobile Pagination  */}

            {items.length > 0 && (
              <View style={styles.paginationRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, justifyContent: 'center' }}>
                  <TouchableOpacity disabled={page <= 1} onPress={() => setPage(p => p - 1)} style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]}>
                    <MaterialIcons name="chevron-left" size={24} color={page <= 1 ? '#CBD5E1' : '#0F172A'} />
                  </TouchableOpacity>
                  <Text style={styles.pageText}>{page} of {totalPages}</Text>
                  <TouchableOpacity disabled={page >= totalPages} onPress={() => setPage(p => p + 1)} style={[styles.pageBtn, page >= totalPages && styles.pageBtnDisabled]}>
                    <MaterialIcons name="chevron-right" size={24} color={page >= totalPages ? '#CBD5E1' : '#0F172A'} />
                  </TouchableOpacity>
                </View>
              </View>

            )}
          </ScrollView>
        ) : (
          /* Desktop Table View */
          <View style={styles.tableContainer}>
          <View style={styles.tableWrap}>
            <View style={styles.tableScrollWrapper}>
            <ScrollView
              horizontal
                showsHorizontalScrollIndicator
                contentContainerStyle={{ flexGrow: 1 }}
            >
                <View style={[styles.tableContent, { minWidth: Math.max(tableMinWidth, (windowWidth || tableMinWidth) - 48) }]}>
                <View style={styles.tableHeader}>
                  {columns.map((c) => (
                    <View key={c.key} style={[styles.th, columnStyle(c.key)]}>
                      <Text style={styles.thText} numberOfLines={1} ellipsizeMode="tail">{c.label}</Text>
                    </View>
                  ))}
                </View>
                <ScrollView style={styles.tableBodyScroll} showsVerticalScrollIndicator={false}>
                  {paginatedItems.map((item, idx) => {
                    const statusColor = statusToColor(item?.status);
                    const assignedTo = item?.assigned_to ?? item?.users?.name ?? item?.users?.useremail ?? item?.users?.email;
                    const model = item?.model ?? item?.fields?.model;
                    const serial = item?.serial_number ?? item?.fields?.serial_number;
                    const description = item?.notes ?? item?.description ?? item?.fields?.description ?? item?.fields?.notes;
                    const purchased = item?.date_purchased ?? item?.purchase_date ?? item?.fields?.date_purchased ?? item?.fields?.purchase_date;
                    const updated = item?.last_updated ?? item?.updated_at;
                    const updatedBy = item?.last_changed_by_name ?? item?.last_changed_by_email ?? '—';
                    const otherId = item?.other_id ?? item?.asset_tag ?? item?.asset_name ?? item?.name ?? '—';
                    const imageUrl = item?.image_url ?? item?.image ?? item?.fields?.image_url ?? item?.fields?.image ?? null;

                    // Date formatters
                    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
                    const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { hour: 'numeric', minute: 'numeric', hour12: true, day: 'numeric', month: 'short' }) : '—';

                    return (
                      <View
                        key={item.id}
                        style={[styles.tr, idx % 2 === 1 && styles.rowAlt, (hoverRowId === item.id) && styles.rowHover]}
                        onMouseEnter={() => setHoverRowId(item.id)}
                        onMouseLeave={() => setHoverRowId(null)}
                      >
                        {/* QR Code */}
                    <View style={[styles.td, columnStyle('qr')]}>
                          <TouchableOpacity onPress={() => setQrModalItem(item)} style={{ padding: 4 }}>
                            <MaterialCommunityIcons name="qrcode-scan" size={20} color={COLORS.primary} />
                          </TouchableOpacity>
                        </View>
                    {/* Image */}
                    <View style={[styles.td, columnStyle('image')]}>
                      {imageUrl ? (
                        <Image source={{ uri: imageUrl }} style={styles.tableThumb} resizeMode="cover" />
                      ) : (
                        <View style={[styles.tableThumb, styles.tableThumbPlaceholder]}>
                          <Ionicons name="image-outline" size={16} color="#94A3B8" />
                        </View>
                      )}
                    </View>
                        {/* Asset Id */}
                    <View style={[styles.td, columnStyle('id')]}>
                      {isUUID(String(item.id || '')) ? (
                        <View style={styles.awaitingIdWrap}>
                          <Text style={[styles.tdText, styles.awaitingIdLabel]} numberOfLines={1}>
                            {(otherId && otherId !== '—') ? otherId : 'QR awaiting'}
                          </Text>
                          <Text style={styles.awaitingIdSub}>Awaiting QR</Text>
                        </View>
                      ) : (
                        <TouchableOpacity onPress={() => goToAsset(item.id)} activeOpacity={0.7} style={styles.assetLink}>
                          <Text style={[styles.tdText, styles.linkText]} numberOfLines={1}>{item.id}</Text>
                        </TouchableOpacity>
                      )}
                        </View>
                        {/* Other Id */}
                    <View style={[styles.td, columnStyle('other_id')]}>
                      <Text style={styles.tdText} numberOfLines={1}>{otherId}</Text>
                        </View>
                        {/* Type */}
                    <View style={[styles.td, columnStyle('type')]}>
                          <Text style={styles.tdText} numberOfLines={1}>{item?.asset_type ?? item?.type ?? item?.asset_types?.name ?? '—'}</Text>
                        </View>
                        {/* Serial */}
                    <View style={[styles.td, columnStyle('serial')]}>
                          <Text style={styles.tdText} numberOfLines={1}>{serial || '—'}</Text>
                        </View>
                        {/* Description */}
                    <View style={[styles.td, styles.tdTall, columnStyle('description')]}>
                      <Text style={[styles.tdText, styles.tdTextSmall]} numberOfLines={3}>
                        {description || '—'}
                      </Text>
                        </View>
                        {/* Model */}
                    <View style={[styles.td, styles.tdTall, columnStyle('model')]}>
                      <Text style={styles.tdText} numberOfLines={2}>{model || '—'}</Text>
                        </View>
                        {/* Assigned To */}
                    <View style={[styles.td, columnStyle('assigned')]}>
                          <Text style={styles.tdText} numberOfLines={1}>{assignedTo || '—'}</Text>
                        </View>
                        {/* Status */}
                    <View style={[styles.td, columnStyle('status')]}>
                          <View style={[styles.badge, { backgroundColor: statusColor.bg, borderColor: statusColor.bd }]}>
                            <Text style={[styles.badgeText, { color: statusColor.fg }]}>{prettyStatus(item?.status)}</Text>
                          </View>
                        </View>
                        {/* Date Purchased */}
                    <View style={[styles.td, columnStyle('purchased')]}>
                          <Text style={styles.tdText} numberOfLines={1}>{fmtDate(purchased)}</Text>
                        </View>
                        {/* Last Updated */}
                    <View style={[styles.td, columnStyle('updated')]}>
                          <Text style={styles.tdText} numberOfLines={1}>{fmtDateTime(updated)}</Text>
                        </View>
                        {/* Last Updated By */}
                    <View style={[styles.td, columnStyle('updated_by')]}>
                          <Text style={styles.tdText} numberOfLines={1}>{updatedBy}</Text>
                        </View>
                        {/* Dynamic Fields */}
                        {dynamicColumns.map((col) => {
                          const val = formatDynamicValue(col.field, getDynamicFieldValue(item, col.field));
                          return (
                            <View key={`${item.id}-${col.key}`} style={[styles.td, columnStyle(col.key)]}>
                              <Text style={styles.tdText} numberOfLines={1}>{val}</Text>
                            </View>
                          );
                        })}
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            </ScrollView>
            </View>

            {/* Desktop Pagination Controls */}
            {items.length > 0 && (
              <View style={styles.paginationRow}>
                <View style={styles.paginationLeft}>
                  <Text style={styles.pageText}>Rows per page:</Text>
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    {PAGE_SIZE_OPTIONS.map((sz) => {
                      const active = pageSize === sz;
                      const label = sz === 'all' ? 'All' : sz;
                      return (
                        <TouchableOpacity
                          key={label}
                          onPress={() => setPageSize(sz === 'all' ? 'all' : sz)}
                          style={[styles.pageSizeBtn, active && styles.pageSizeBtnActive]}
                        >
                          <Text style={[styles.pageSizeText, active && styles.pageSizeTextActive]}>{label}</Text>
                      </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
                <View style={styles.paginationCenter}>
                  <Text style={styles.pageText}>
                    {pageSize === 'all'
                      ? `All ${items.length} assets`
                      : `${pageRangeStart}-${pageRangeEnd} of ${items.length}`}
                  </Text>
                  <Text style={styles.pageNumberText}>
                    {pageSize === 'all' ? 'Viewing all assets' : `Page ${page} of ${totalPages}`}
                  </Text>
                </View>
                <View style={styles.paginationRight}>
                  <TouchableOpacity
                    disabled={page <= 1 || pageSize === 'all'}
                    onPress={() => setPage(p => Math.max(1, p - 1))}
                    style={[styles.pageBtn, (page <= 1 || pageSize === 'all') && styles.pageBtnDisabled]}
                  >
                    <MaterialIcons name="chevron-left" size={20} color={(page <= 1 || pageSize === 'all') ? '#CBD5E1' : '#0F172A'} />
                    </TouchableOpacity>
                  <TouchableOpacity
                    disabled={page >= totalPages || pageSize === 'all'}
                    onPress={() => setPage(p => Math.min(totalPages, p + 1))}
                    style={[styles.pageBtn, (page >= totalPages || pageSize === 'all') && styles.pageBtnDisabled]}
                  >
                    <MaterialIcons name="chevron-right" size={20} color={(page >= totalPages || pageSize === 'all') ? '#CBD5E1' : '#0F172A'} />
                    </TouchableOpacity>
                </View>
              </View>
            )}
            </View>
          </View>
        )
      )}

      {/* Advanced Filter Modal */}
      <Modal visible={filterModalOpen} transparent animationType="fade" onRequestClose={() => setFilterModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={{ flex: 1, width: '100%' }} activeOpacity={1} onPress={() => setFilterModalOpen(false)} />
          <View style={styles.filterSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.modalTitle}>Filters</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {activeCount > 0 && (
                  <TouchableOpacity onPress={clearFilters} style={styles.clearAllBtn}>
                    <Text style={styles.clearAllText}>Clear all</Text>
                  </TouchableOpacity>
                )}
              <TouchableOpacity onPress={() => setFilterModalOpen(false)} style={[styles.inlineIconBtn, { backgroundColor: '#F3F6FB' }]}>
                <Feather name="x" size={16} color={COLORS.primary} />
              </TouchableOpacity>
            </View>
            </View>
            <ScrollView style={{ maxHeight: filterScrollMaxHeight }}>
              <View style={{ gap: 16 }}>
                {/* Asset Type */}
                <View>
                  <Text style={styles.groupTitle}>Asset Type</Text>
                  <View style={[styles.filterMenuRow, styles.chipsRow, styles.typeChipWrap]}>
                    <Chip label="Any type" active={!filters.type} onPress={() => setFilters(f => ({ ...f, type: null }))} />
                    {visibleAssetTypes.map(t => (
                      <Chip key={t} label={t} active={filters.type === t} onPress={() => setFilters(f => ({ ...f, type: t }))} />
                    ))}
                  </View>
                  {ASSET_TYPE_OPTIONS.length > 8 && (
                    <TouchableOpacity onPress={() => setShowAllTypes(v => !v)} style={styles.showMoreBtn}>
                      <Text style={styles.showMoreText}>{showAllTypes ? 'Show less' : 'Show more'}</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Status */}
                <View>
                  <Text style={styles.groupTitle}>Status</Text>
                  <View style={[styles.filterMenuRow, styles.chipsRow]}>
                    <Chip label="Any status" active={!filters.status} onPress={() => setFilters(f => ({ ...f, status: null }))} />
                    {['In Service', 'Repair', 'Maintenance', 'End of Life'].map(s => (
                      <Chip key={s} label={s} active={filters.status === s} onPress={() => setFilters(f => ({ ...f, status: s }))} />
                    ))}
                  </View>
                </View>

                {/* Assigned To */}
                <View>
                  <Text style={styles.groupTitle}>Assigned To (email)</Text>
                  <TextInput
                    style={styles.filterInput}
                    placeholder="someone@company.com"
                    value={filters.assignedTo || ''}
                    onChangeText={(t) => setFilters(f => ({ ...f, assignedTo: t || null }))}
                  />
                </View>

                {/* Location */}
                <View>
                  <Text style={styles.groupTitle}>Location</Text>
                  <TextInput
                    style={styles.filterInput}
                    placeholder="Office / Site"
                    value={filters.location || ''}
                    onChangeText={(t) => setFilters(f => ({ ...f, location: t || null }))}
                  />
                </View>

                {/* Switches */}
                <View style={{ gap: 12 }}>
                  <View style={styles.switchRow}>
                    <Text style={styles.switchLabel}>Only my assets</Text>
                    <Switch value={filters.onlyMine} onValueChange={(v) => setFilters(f => ({ ...f, onlyMine: v }))} trackColor={{ false: '#E2E8F0', true: COLORS.primary }} />
                  </View>
                  <View style={styles.switchRow}>
                    <Text style={styles.switchLabel}>Only unassigned</Text>
                    <Switch value={filters.onlyUnassigned} onValueChange={(v) => setFilters(f => ({ ...f, onlyUnassigned: v }))} trackColor={{ false: '#E2E8F0', true: COLORS.primary }} />
                  </View>
                  <View style={styles.switchRow}>
                    <Text style={styles.switchLabel}>Due soon (service)</Text>
                    <Switch value={filters.dueSoon} onValueChange={(v) => setFilters(f => ({ ...f, dueSoon: v }))} trackColor={{ false: '#E2E8F0', true: COLORS.primary }} />
                  </View>
                  <View style={styles.switchRow}>
                    <Text style={styles.switchLabel}>Include QR reserved assets</Text>
                    <Switch value={filters.includeQRReserved} onValueChange={(v) => setFilters(f => ({ ...f, includeQRReserved: v }))} trackColor={{ false: '#E2E8F0', true: COLORS.primary }} />
                  </View>
                  <View style={styles.switchRow}>
                    <Text style={styles.switchLabel}>Only QR awaiting assets</Text>
                    <Switch value={filters.awaitingQROnly} onValueChange={(v) => setFilters(f => ({ ...f, awaitingQROnly: v }))} trackColor={{ false: '#E2E8F0', true: COLORS.primary }} />
                  </View>
                </View>
              </View>
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
              <TouchableOpacity style={[styles.btnGhost, { flex: 1 }]} onPress={() => {
                setFilters({ type: null, status: null, location: null, assignedTo: null, onlyMine: false, dueSoon: false, includeQRReserved: false, onlyUnassigned: false, awaitingQROnly: false });
                setFilterModalOpen(false);
              }}>
                <Text style={[styles.btnText, { color: COLORS.primary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, { flex: 1 }]} onPress={() => setFilterModalOpen(false)}>
                <Text style={styles.btnText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Sort Modal */}
      <Modal visible={sortModalOpen} transparent animationType="fade" onRequestClose={() => setSortModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={{ flex: 1, width: '100%' }} activeOpacity={1} onPress={() => setSortModalOpen(false)} />
          <View style={styles.filterSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.modalTitle}>Sort</Text>
              <TouchableOpacity onPress={() => setSortModalOpen(false)} style={[styles.inlineIconBtn, { backgroundColor: '#F3F6FB' }]}>
                <Feather name="x" size={16} color={COLORS.primary} />
              </TouchableOpacity>
            </View>
            <View style={{ gap: 16 }}>
              <View>
                <Text style={styles.groupTitle}>Sort by</Text>
                <View style={[styles.filterMenuRow, styles.chipsRow]}>
                  {['Relevance', 'Updated', 'Name', 'Service Due', 'Status', 'Type', 'Location', 'Assigned To', 'ID'].map(f => {
                    const key = f.toLowerCase().replace(' ', '_');
                    const active = sort.field === key || (key === 'relevance' && !sort.field);
                    return (
                      <Chip key={f} label={f} active={active} onPress={() => setSort(s => ({ ...s, field: key }))} />
                    );
                  })}
                </View>
              </View>
              <View>
                <Text style={styles.groupTitle}>Order</Text>
                <View style={[styles.filterMenuRow, styles.chipsRow]}>
                  <Chip label="Ascending" active={sort.dir === 'asc'} onPress={() => setSort(s => ({ ...s, dir: 'asc' }))} />
                  <Chip label="Descending" active={sort.dir === 'desc'} onPress={() => setSort(s => ({ ...s, dir: 'desc' }))} />
                </View>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
              <TouchableOpacity style={[styles.btnGhost, { flex: 1 }]} onPress={() => setSortModalOpen(false)}>
                <Text style={[styles.btnText, { color: COLORS.primary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, { flex: 1 }]} onPress={() => setSortModalOpen(false)}>
                <Text style={styles.btnText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* QR Modal - Centered Dialog Style */}
      <Modal visible={!!qrModalItem} transparent animationType="fade" onRequestClose={() => setQrModalItem(null)}>
        <View style={[styles.modalBackdrop, { justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
          <TouchableOpacity style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} activeOpacity={1} onPress={() => setQrModalItem(null)} />
          <View style={[styles.filterSheet, { width: 'auto', maxWidth: 400, borderRadius: 24, padding: 32, alignItems: 'center' }]}>
            <Text style={[styles.modalTitle, { marginBottom: 24, fontSize: 24 }]}>{qrModalItem?.id}</Text>
            <View style={{ padding: 16, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0' }}>
              {qrModalItem && (
                <QRCode
                  value={`${String(API_BASE_URL).replace(/\/+$/, '')}/check-in/${qrModalItem.id}`}
                  size={220}
                />
              )}
            </View>
            <Text style={{ marginTop: 24, textAlign: 'center', color: '#64748B', fontSize: 15, lineHeight: 22 }}>
              Scan this QR code to instantly open the asset details and perform actions.
            </Text>
            <TouchableOpacity style={[styles.btn, { marginTop: 32, width: '100%', height: 48 }]} onPress={() => setQrModalItem(null)}>
              <Text style={[styles.btnText, { fontSize: 16 }]}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </Container>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7FAFF' },
  embedContainer: { flex: 1, backgroundColor: '#F7FAFF', padding: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  iconBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#EFF6FF' },
  actionBtn: { width: 'auto', paddingHorizontal: 12 },
  actionBtnText: { color: COLORS.primary, fontWeight: '600', fontSize: 13 },
  countDot: { position: 'absolute', top: -2, right: -2, backgroundColor: '#D32F2F', borderRadius: 6, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  countDotText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  toolbarSurface: { marginBottom: 8 },
  searchRowCompact: { marginBottom: 8, marginHorizontal: 12, marginTop: 8 },
  quickRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', paddingHorizontal: 12, marginBottom: 12, marginTop: 8, justifyContent: 'space-between', alignItems: 'center' },
  metaText: { fontSize: 13, color: '#64748B', fontWeight: '600', marginHorizontal: 16, marginBottom: 8 },

  // Table Styles (Desktop)
  tableContainer: {
    flex: 1,
    position: 'relative',
    marginLeft: 12,
    marginRight: 12,
  },
  tableWrap: {
    flex: 1,
    alignSelf: 'stretch',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  tableScrollWrapper: { flex: 1 },
  tableHeader: { flexDirection: 'row', backgroundColor: '#F8FAFC', alignItems: 'stretch' },
  tableContent: { flex: 1 },
  th: { paddingVertical: 10, paddingHorizontal: 6, justifyContent: 'center', alignItems: 'center' },
  thText: { fontSize: 12, fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' },
  tableBodyScroll: { flex: 1 },
  tableBodyContent: { paddingRight: 0 },
  tr: { flexDirection: 'row', backgroundColor: '#fff', alignItems: 'stretch' },
  rowAlt: { backgroundColor: '#FAFAFA' },
  rowHover: { backgroundColor: '#F0F9FF' },
  td: { paddingVertical: 10, paddingHorizontal: 6, justifyContent: 'center', alignItems: 'center' },
  tdText: { fontSize: 14, color: '#334155', fontWeight: '600', textAlign: 'center' },
  tdTextSmall: { fontSize: 13, lineHeight: 18 },
  tdTall: { minHeight: 72, justifyContent: 'center' },
  assetLink: { paddingVertical: 4, paddingHorizontal: 4 },
  linkText: { color: COLORS.primary, fontWeight: '700', textDecorationLine: 'underline' },
  tableThumb: { width: 44, height: 44, borderRadius: 10, backgroundColor: '#F1F5F9', overflow: 'hidden' },
  tableThumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  awaitingIdWrap: { alignItems: 'center', justifyContent: 'center' },
  awaitingIdLabel: { color: '#0F172A', fontWeight: '700' },
  awaitingIdSub: { fontSize: 11, color: '#94A3B8', fontWeight: '600', marginTop: 2 },

  // Mobile Card Styles
  mobileScroll: { flex: 1 },
  mobileScrollContent: { paddingHorizontal: 12, paddingBottom: 24 },
  gridContainer: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -8 },
  mobileCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E9F1FF',
    shadowColor: '#0B63CE',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
    width: '100%',
  },
  desktopGridCard: {
    width: '32%', // 3 columns on desktop
    minWidth: 300,
    marginHorizontal: 8,
    marginBottom: 16,
  },
  mobileCardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12, gap: 8 },
  mobileThumb: { width: 48, height: 48, borderRadius: 8, backgroundColor: '#F1F5F9' },
  mobileThumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  mobileCardTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A', marginBottom: 2 },
  mobileCardSubtitle: { fontSize: 13, color: '#64748B', fontWeight: '600' },
  mobileStatusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1, alignSelf: 'flex-start' },
  mobileStatusText: { fontSize: 11, fontWeight: '800' },
  mobileCardDetails: { gap: 8, marginBottom: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F0F4F8' },
  mobileDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mobileDetailLabel: { fontSize: 13, color: '#64748B', fontWeight: '700', minWidth: 70 },
  mobileDetailValue: { fontSize: 13, color: '#0F172A', fontWeight: '600', flex: 1 },
  mobileCardActions: { flexDirection: 'row', gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F0F4F8' },
  mobileActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10 },
  mobileActionBtnPrimary: { backgroundColor: '#0B63CE' },
  mobileActionBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },

  // Shared / Utils
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1, alignSelf: 'center' },
  badgeText: { fontSize: 11, fontWeight: '700' },
  btn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, backgroundColor: '#0B63CE', alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
  btnGhost: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, borderWidth: 1, borderColor: '#0B63CE', alignItems: 'center' },
  btnIcon: { width: 32, height: 32, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: '#0B63CE' },

  // Modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  filterSheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '90%', width: '100%' },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#1E293B' },
  inlineIconBtn: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  groupTitle: { fontSize: 14, fontWeight: '800', color: '#1E293B', marginBottom: 8, textTransform: 'uppercase' },
  filterMenuRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  chipsRow: { flexWrap: 'wrap' },
  typeChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  switchLabel: { fontSize: 14, color: '#334155', fontWeight: '600' },
  clearAllBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: '#EFF6FF' },
  clearAllText: { color: COLORS.primary, fontWeight: '700', fontSize: 12 },
  showMoreBtn: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, backgroundColor: '#FFFFFF' },
  showMoreText: { color: COLORS.primary, fontWeight: '700', fontSize: 12 },
  inlineAlert: { flexDirection: 'row', alignItems: 'center', padding: 8, borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#F8FAFF' },
  inlineAlertText: { fontSize: 12, color: '#0F172A', fontWeight: '600' },

  // Pagination
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderTopWidth: 1, borderTopColor: '#E2E8F0', backgroundColor: '#F8FAFC' },
  paginationLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  paginationCenter: { alignItems: 'center', flex: 1 },
  paginationRight: { flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'flex-end', flex: 1 },
  pageText: { fontSize: 13, color: '#64748B', fontWeight: '600' },
  pageNumberText: { fontSize: 12, color: '#94A3B8', fontWeight: '600', marginTop: 2 },
  pageSizeBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#fff' },
  pageSizeBtnActive: { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' },
  pageSizeText: { fontSize: 12, color: '#64748B', fontWeight: '600' },
  pageSizeTextActive: { color: '#2563EB' },
  pageBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 4, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#fff' },
  pageBtnDisabled: { opacity: 0.5, backgroundColor: '#F1F5F9' },

  // Inline Filters
  inlineFilterBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingHorizontal: 16, paddingBottom: 16, flexWrap: 'wrap', backgroundColor: '#F7FAFF' },
  filterInputGroup: { width: 140 },
  filterLabel: { fontSize: 12, fontWeight: '600', color: '#64748B', marginBottom: 4 },
  filterInput: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: '#0F172A' },

  // View Toggle
  viewToggleGroup: { flexDirection: 'row', backgroundColor: '#EFF6FF', borderRadius: 8, padding: 2 },
  viewToggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  viewToggleBtnActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  viewToggleText: { fontSize: 12, fontWeight: '600', color: '#64748B' },
  viewToggleTextActive: { color: COLORS.primary },
});