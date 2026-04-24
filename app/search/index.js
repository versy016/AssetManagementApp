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
  KeyboardAvoidingView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather, MaterialIcons, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import QRCode from 'react-native-qrcode-svg';

import { API_BASE_URL } from '../../inventory-api/apiBase';
import { fetchFields } from '../../hooks/useAssetTypeFields';
import { auth } from '../../firebaseConfig';
import logger from '../../utils/logger';
import { pickOfficeInventoryAssignee } from '../../utils/ShortcutExecutor';
import SearchInput from '../../components/ui/SearchInput';
import ScreenHeader from '../../components/ui/ScreenHeader';
import Chip from '../../components/ui/Chip';
import InlineButton from '../../components/ui/InlineButton';
import EmptyState from '../../components/ui/EmptyState';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { Colors, Radius, Shadows, sf } from '../../constants/uiTheme';
import { TourTarget } from '../../components/TourGuide';
import TablePagination from '../../components/ui/TablePagination';
import StatusBadge from '../../components/ui/StatusBadge';

const RECENT_KEY = 'search_recents_v2';
const ASSET_TYPE_OPTIONS = [
  'iPad', 'Vehicle', 'UG Locating', 'Two drill set', 'Total Station',
  'Torch', 'Target', 'Stamps', 'Sonar', 'Scanner', 'Satellite Phone',
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

  // desktopViewMode: the user's explicit choice when on a wide screen (persists through resize cycles).
  // viewMode: the active view — forced to 'grid' on compact (mobile), otherwise follows desktopViewMode.
  const [desktopViewMode, setDesktopViewMode] = useState('list');
  const viewMode = isCompact ? 'grid' : desktopViewMode;

  // Helper used by the Grid / Table toggle buttons — updates the desktop preference.
  const setViewMode = (mode) => setDesktopViewMode(mode);

  // Pagination State
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Filters
  const [filters, setFilters] = useState({
    types: [],
    status: null,
    assignedTo: null,
    assignedToUserIds: [],
    onlyMine: false,
    dueSoon: false,
    includeQRReserved: false,
    onlyUnassigned: false,
    awaitingQROnly: false,
  });

  // Users from DB (for Assigned To filter)
  const [filterUsers, setFilterUsers] = useState([]);
  const [userSearch, setUserSearch] = useState('');

  // Sort
  const [sort, setSort] = useState({ field: 'updated_at', dir: 'desc' });

  // Dynamic type-specific columns
  const [typeFieldDefs, setTypeFieldDefs] = useState([]);
  const [typeFieldLoading, setTypeFieldLoading] = useState(false);
  const [typeFieldError, setTypeFieldError] = useState(null);
  const [activeTypeId, setActiveTypeId] = useState(null);
  const [showAllTypes, setShowAllTypes] = useState(false);
  const [typeSearch, setTypeSearch] = useState('');

  // User
  const [me, setMe] = useState({ uid: null, email: null });


  // Load User
  useEffect(() => {
    const u = auth.currentUser;
    if (u) setMe({ uid: u.uid, email: u.email });
  }, []);

  // Load users from DB for filter dropdown
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/users`);
        if (!res.ok) return;
        const data = await res.json();
        if (!ignore && Array.isArray(data)) {
          const mapped = data.map((u) => ({
            id: u.id,
            name: u.name || '',
            useremail: u.useremail || u.email || '',
            role: u.role,
          }));
          setFilterUsers(mapped);
        }
      } catch {
        if (!ignore) setFilterUsers([]);
      }
    })();
    return () => { ignore = true; };
  }, []);

  const presetKey = Array.isArray(params?.preset) ? params.preset[0] : params?.preset;

  // Apply URL presets whenever users load or preset changes (matches transfer-in "office" user).
  useEffect(() => {
    if (!filterUsers.length) return;
    if (presetKey === 'office') {
      const officeUser = pickOfficeInventoryAssignee(filterUsers);
      setFilters((f) => ({
        ...f,
        onlyMine: false,
        assignedToUserIds: officeUser?.id ? [String(officeUser.id)] : [],
      }));
    } else if (presetKey === 'mine') {
      setFilters((f) => ({
        ...f,
        onlyMine: true,
        assignedToUserIds: [],
      }));
    }
  }, [presetKey, filterUsers]);

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
      // Keyword: token-based so "user model" matches items that have both somewhere
      const q = (debouncedQuery || '').trim().toLowerCase();
      const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
      const keywordOk = (() => {
        if (!tokens.length) return true;
        const name = String(it?.name ?? it?.asset_name ?? '').toLowerCase();
        const id = String(it?.id ?? '').toLowerCase();
        const serial = String(it?.serial_number ?? it?.fields?.serial_number ?? '').toLowerCase();
        const model = String(it?.model ?? it?.fields?.model ?? '').toLowerCase();
        const assetType = String(it?.asset_type ?? it?.type ?? it?.asset_types?.name ?? '').toLowerCase();
        const location = String(it?.location ?? it?.fields?.location ?? '').toLowerCase();
        const notes = String(it?.notes ?? it?.fields?.notes ?? '').toLowerCase();
        const descriptionText = String(it?.description ?? it?.fields?.description ?? '').toLowerCase();
        const assigned = it.assigned_to || it.users?.name || it.users?.useremail || it.users?.email || '';
        const assignedStr = String(assigned || '').toLowerCase();
        const haystack = `${name} ${id} ${serial} ${model} ${assetType} ${location} ${descriptionText} ${notes} ${assignedStr}`;
        return tokens.every(tok => haystack.includes(tok));
      })();

      // Filters
      const types = filters.types;
      const typeOk = !types || types.length === 0 || types.some(t => it.asset_type === t || it.type === t || it.asset_types?.name === t);
      const statusOk = !filters.status || (it.status === filters.status);

      const assigned = it.assigned_to || it.users?.name || it.users?.useremail || it.users?.email;
      const assignedUid = it.assigned_to_id || it.assigned_to_uid || it.assigned_to_user_id;
      const assignedOk = filters.assignedToUserIds?.length > 0
        ? filters.assignedToUserIds.some((uid) => String(assignedUid || '') === String(uid))
        : (!filters.assignedTo || String(assigned || '').toLowerCase().includes(filters.assignedTo.toLowerCase()));

      const dueOk = !filters.dueSoon || (it.next_service_date && new Date(it.next_service_date) <= new Date(Date.now() + 7 * 86400000));

      const isMine = (me.uid && (assignedUid === me.uid)) || (me.email && String(assigned || '').toLowerCase().includes(me.email.toLowerCase()));
      const onlyMineOk = !filters.onlyMine || isMine;

      const desc = it.description || it.fields?.description || '';
      const isQRReserved = String(desc).trim().toLowerCase() === 'qr reserved asset';
      const reservedOk = !!filters.includeQRReserved || !isQRReserved;
      const unassignedOk = !(String(assigned).trim()) && !assignedUid;

      const awaitingQR = isUUID(String(it.id || ''));
      const awaitingOk = filters.awaitingQROnly ? awaitingQR : !awaitingQR;

      const baseOk = keywordOk && typeOk && statusOk && assignedOk && dueOk && onlyMineOk && reservedOk && awaitingOk;
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
        case 'serial_number': return it?.serial_number ?? it?.fields?.serial_number ?? '';
        case 'model': return it?.model ?? it?.fields?.model ?? '';
        case 'description': return it?.description ?? it?.fields?.description ?? '';
        case 'other_id': return it?.other_id ?? it?.asset_tag ?? it?.asset_name ?? it?.name ?? '';
        case 'date_purchased': return it?.date_purchased ?? it?.purchase_date ?? it?.fields?.date_purchased ?? it?.fields?.purchase_date ?? '';
        case 'updated_by': return it?.last_changed_by_name ?? it?.last_changed_by_email ?? '';
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
    const types = filters.types;
    if (!types || types.length === 0) return null;
    const target = String(types[0]).toLowerCase();
    const pool = rawItems.length ? rawItems : items;
    const match = pool.find((it) => {
      const typeName = (it?.asset_type || it?.type || it?.asset_types?.name || '').toLowerCase();
      return typeName === target;
    });
    if (!match) return { name: types[0], id: null };
    return {
      name: types[0],
      id: match?.type_id || match?.asset_types?.id || null,
    };
  }, [filters.types, rawItems, items]);

  useEffect(() => {
    let cancelled = false;
    if (!filters.types || filters.types.length === 0) {
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
        const arr = await fetchFields(typeId);
        if (cancelled) return;
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
  }, [filters.types, selectedTypeInfo?.id, activeTypeId, typeFieldDefs.length]);

  const saveRecent = useCallback(async () => {
    const labelParts = [];
    if (debouncedQuery) labelParts.push(`"${debouncedQuery}"`);
    if (filters.onlyMine) labelParts.push('My assets');
    if (filters.status) labelParts.push(`Status:${filters.status}`);
    if (filters.types && filters.types.length > 0) labelParts.push(`Type:${filters.types.join(', ')}`);
    if (filters.assignedToUserIds?.length > 0) {
      const names = filters.assignedToUserIds.map((uid) => {
        const u = filterUsers.find((x) => String(x.id) === String(uid));
        return u ? (u.name || u.useremail || u.id) : uid;
      });
      labelParts.push(`User: ${names.join(', ')}`);
    }
    if (filters.dueSoon) labelParts.push('Due soon');
    if (filters.awaitingQROnly) labelParts.push('QR awaiting');
    const label = labelParts.join(' · ');
    if (!label) return;
    const entry = { label, query: debouncedQuery, filters, sort, ts: Date.now() };
    const next = [entry, ...recents.filter(r => r.label !== label)].slice(0, 10);
    setRecents(next);
    try { await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { }
  }, [debouncedQuery, filters, sort, recents, filterUsers]);

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
  const closeFilterModal = () => {
    setFilterModalOpen(false);
    setTypeSearch('');
    setUserSearch('');
  };

  const clearFilters = () => {
    setQuery('');
    setDebouncedQuery('');
    setTypeSearch('');
    setFilters({
      types: [],
      status: null,
      assignedTo: null,
      assignedToUserIds: [],
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
    !!(filters.types && filters.types.length > 0),
    !!filters.status,
    !!filters.assignedTo,
    !!(filters.assignedToUserIds?.length > 0),
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
      logger.warn('Navigation error:', err);
    }
  }, [router, computeReturnTarget]);

  const actionsNode = (
    <>
      {/* Filter Button */}
      <TourTarget id="web-search-filter-btn">
        <TouchableOpacity style={styles.iconBtn} onPress={() => setFilterModalOpen(true)}>
          <View style={{ position: 'relative' }}>
            <Feather name="sliders" size={18} color={Colors.accent} />
            {activeCount > 0 && (
              <View style={styles.countDot}>
                <Text style={styles.countDotText}>{Math.min(activeCount, 9)}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </TourTarget>

      <TouchableOpacity style={styles.iconBtn} onPress={() => { setPage(1); fetchAll(); }}>
        <Feather name="refresh-ccw" size={18} color={Colors.accent} />
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
    { key: 'qr',         label: '',               width: 44 },              // fixed – icon only
    { key: 'image',      label: '',               width: 64 },              // fixed – image only
    { key: 'id',         label: 'Asset Id',       minWidth: 88,  flex: 0.8 },
    { key: 'other_id',   label: 'Other Id',       minWidth: 88,  flex: 0.8 },
    { key: 'type',       label: 'Asset Type',     minWidth: 108, flex: 1   },
    { key: 'serial',     label: 'Serial Number',  minWidth: 128, flex: 1.1 },
    { key: 'description',label: 'Description',   minWidth: 180, flex: 2.5 },
    { key: 'model',      label: 'Model',          minWidth: 88,  flex: 0.9 },
    { key: 'assigned',   label: 'Assigned To',   minWidth: 116, flex: 1.1 },
    { key: 'status',     label: 'Status',         minWidth: 100, flex: 0.9 },
    { key: 'purchased',  label: 'Date Purchased', minWidth: 136, flex: 1.1 },
    { key: 'updated',    label: 'Last Updated',   minWidth: 128, flex: 1.1 },
    { key: 'updated_by', label: 'Last Updated By',minWidth: 144, flex: 1.2 },
  ]), []);

  const dynamicColumns = useMemo(() => {
    if (!filters.types?.length || !Array.isArray(typeFieldDefs) || !typeFieldDefs.length) return [];
    return typeFieldDefs.map((def) => ({
      key: `dyn_${def.id || def.slug}`,
      label: def.name || formatFieldLabel(def.slug),
      minWidth: 124,
      flex: 1,
      isDynamic: true,
      field: def,
    }));
  }, [filters.types, typeFieldDefs]);

  const columns = useMemo(() => [...baseColumns, ...dynamicColumns], [baseColumns, dynamicColumns]);

  const columnMap = useMemo(() => {
    const map = {};
    columns.forEach((col) => {
      map[col.key] = col;
    });
    return map;
  }, [columns]);

  // Map table column key -> sort field for header sorting (web list view)
  const columnKeyToSortField = useMemo(() => ({
    id: 'id',
    other_id: 'other_id',
    type: 'type',
    serial: 'serial_number',
    description: 'description',
    model: 'model',
    assigned: 'assigned_to',
    status: 'status',
    purchased: 'date_purchased',
    updated: 'updated_at',
    updated_by: 'updated_by',
  }), []);

  const lastColumnKey = useMemo(() => (columns.length ? columns[columns.length - 1].key : null), [columns]);

  const columnStyle = useCallback((key) => {
    const col = columnMap[key];
    if (!col) return {};
    const size = col.width ? { width: col.width } : { flex: col.flex || 1, minWidth: col.minWidth || 92 };
    return size;
  }, [columnMap, lastColumnKey]);

  const tableMinWidth = useMemo(() => {
    return columns.reduce((sum, col) => {
      if (col.width) return sum + col.width;
      return sum + (col.minWidth || 108);
    }, 0);
  }, [columns]);

  const visibleAssetTypes = useMemo(() => {
    if (showAllTypes) return ASSET_TYPE_OPTIONS;
    return ASSET_TYPE_OPTIONS.slice(0, 8);
  }, [showAllTypes]);

  const assetTypesForFilter = useMemo(() => {
    const fromData = new Set();
    (rawItems || []).forEach((it) => {
      const t = it?.asset_type ?? it?.type ?? it?.asset_types?.name;
      if (t && String(t).trim()) fromData.add(String(t).trim());
    });
    const combined = Array.from(fromData).length ? Array.from(fromData).sort() : ASSET_TYPE_OPTIONS;
    return combined;
  }, [rawItems]);

  const filteredAssetTypes = useMemo(() => {
    const q = (typeSearch || '').trim().toLowerCase();
    if (!q) return [];
    const selected = new Set(filters.types || []);
    return assetTypesForFilter.filter((t) => String(t).toLowerCase().includes(q) && !selected.has(t));
  }, [assetTypesForFilter, typeSearch, filters.types]);

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
    if (value === null || value === undefined || value === '') return '--';
    const fieldType = String(def?.field_type?.slug || def?.field_type?.name || '').toLowerCase();
    if (Array.isArray(value)) {
      return value.length ? value.map((v) => String(v)).join(', ') : '--';
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
  const formatDaysUntil = (iso) => {
    try {
      if (!iso) return '--';
      const d = new Date(iso);
      if (Number.isNaN(+d)) return '--';
      const today = new Date();
      const diff = Math.ceil((d - today) / (1000 * 60 * 60 * 24));
      if (diff === 0) return 'due today';
      if (diff < 0) return `${Math.abs(diff)}d overdue`;
      return `${diff}d`;
    } catch {
      return '--';
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
      {!hideHeader && presetKey !== 'mine' && (
        <ScreenHeader
          title={presetKey === 'office' ? 'Office Gear' : presetKey === 'mine' ? 'My Assets' : 'Search'}
          backLabel="Dashboard"
          onBack={Platform.OS === 'web' ? undefined : () => router.replace('/(tabs)/dashboard')}
        />
      )}

      {/* Search input */}
      <View style={styles.toolbarSurface}>
        <TourTarget id="web-search-input">
          <SearchInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name, ID, serial, model, notes…"
            style={[hideHeader && styles.searchRowCompact]}
            inputStyle={{ fontSize: sf(16) }}
            autoCapitalize="none"
            autoCorrect={false}
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {actionsNode}
              </View>
            }
          />
        </TourTarget>
        {/* Quick filters -- hidden in office/mine preset mode */}
        <View style={styles.quickRow}>
          {presetKey !== 'office' && presetKey !== 'mine' && (
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Chip label="My assets" icon="user" active={filters.onlyMine} onPress={() => quickToggle('onlyMine')} />
              <Chip label="Needs service" icon="tool" active={filters.dueSoon} onPress={() => quickToggle('dueSoon')} />
            </View>
          )}
          {(presetKey === 'office' || presetKey === 'mine') && <View />}

          <View style={{ flexDirection: 'row', gap: 8 }}>
            {/* Sort button: only in grid view; list view uses column header arrows */}
            {(viewMode === 'grid' || isCompact) && (
            <TourTarget id="web-search-sort-btn">
              <TouchableOpacity style={[styles.iconBtn, styles.actionBtn, { marginRight: 0, height: 32 }]} onPress={() => setSortModalOpen(true)}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <MaterialIcons name="sort" size={18} color={Colors.accent} />
                  <Text style={styles.actionBtnText}>
                    {`${currentSortLabel} · ${(sort.dir || 'desc').toUpperCase()}`}
                  </Text>
                </View>
              </TouchableOpacity>
            </TourTarget>
            )}

            {!isCompact && (
              <TourTarget id="web-search-view-mode">
                <View style={styles.viewToggleGroup}>
                  <TouchableOpacity
                    style={[styles.viewToggleBtn, viewMode === 'grid' && styles.viewToggleBtnActive]}
                    onPress={() => setViewMode('grid')}
                  >
                    <Feather name="grid" size={18} color={viewMode === 'grid' ? Colors.primary : Colors.sub2} />
                    <Text style={[styles.viewToggleText, viewMode === 'grid' && styles.viewToggleTextActive]}>Grid</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.viewToggleBtn, viewMode === 'list' && styles.viewToggleBtnActive]}
                    onPress={() => setViewMode('list')}
                  >
                    <Feather name="list" size={18} color={viewMode === 'list' ? Colors.primary : Colors.sub2} />
                    <Text style={[styles.viewToggleText, viewMode === 'list' && styles.viewToggleTextActive]}>Table</Text>
                  </TouchableOpacity>
                </View>
              </TourTarget>
            )}
          </View>
        </View>
      </View>

      {/* Preset banners */}
      {presetKey === 'office' && (
        <View style={styles.presetBanner}>
          <MaterialIcons name="business" size={16} color="#1D4ED8" />
          <Text style={styles.presetBannerText}>Showing assets assigned to the office</Text>
        </View>
      )}
      {presetKey === 'mine' && (
        <View style={styles.presetBanner}>
          <MaterialIcons name="person" size={16} color="#1D4ED8" />
          <Text style={styles.presetBannerText}>Showing assets assigned to you</Text>
          <TouchableOpacity onPress={() => setFilters((f) => ({ ...f, onlyMine: false }))} style={styles.presetBannerClear}>
            <MaterialIcons name="close" size={14} color="#1D4ED8" />
          </TouchableOpacity>
        </View>
      )}

      {/* Content Area */}
    {filters.types?.length > 0 && typeFieldLoading && (
      <View style={[styles.inlineAlert, { marginHorizontal: 12 }]}>
        <ActivityIndicator size="small" color={Colors.primary} />
        <Text style={[styles.inlineAlertText, { marginLeft: 8 }]}>Loading {filters.types?.[0]} fields…</Text>
      </View>
    )}
    {filters.types?.length > 0 && typeFieldError && (
      <View style={[styles.inlineAlert, { marginHorizontal: 12, backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]}>
        <MaterialIcons name="error-outline" size={16} color="#B91C1C" />
        <Text style={[styles.inlineAlertText, { marginLeft: 6, color: '#B91C1C' }]}>{typeFieldError}</Text>
      </View>
    )}

      {/* Inline Filters REMOVED per user request */}

      {loading && !items.length ? (
        <LoadingSpinner label="Searching…" style={styles.center} />
      ) : error ? (
        <View style={styles.center}>
          <MaterialIcons name="error-outline" size={48} color={Colors.dangerFg} />
          <Text style={{ marginTop: 12, color: Colors.dangerFg }}>{error}</Text>
          <TouchableOpacity style={[styles.btn, { marginTop: 16 }]} onPress={fetchAll}>
            <Text style={styles.btnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : items.length === 0 ? (
        <EmptyState
          icon="search-off"
          iconSize={40}
          iconColor="#CBD5E1"
          iconBg="#F1F5F9"
          title="No assets found"
          subtitle="Try adjusting your search or filters."
          style={styles.center}
        />
      ) : (
        /* Responsive View Switch */
        (viewMode === 'grid') ? (
          /* Mobile/Grid Card View */
          <ScrollView style={styles.mobileScroll} contentContainerStyle={styles.mobileScrollContent}>
            <Text style={styles.metaText}>{metrics.total} assets found • {metrics.tookMs} ms</Text>
            <View style={styles.gridContainer}>
            {paginatedItems.map((item) => {
              const assignedTo = item?.assigned_to ?? item?.users?.name ?? item?.users?.useremail ?? item?.users?.email;
              const desc = item?.description ?? item?.fields?.description ?? '';
              const model = item?.model ?? item?.fields?.model;
              const serial = item?.serial_number ?? item?.fields?.serial_number;
              const assetType = item?.asset_type ?? item?.type ?? item?.asset_types?.name ?? 'Unknown Type';
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
                          <Ionicons name="image-outline" size={20} color={Colors.sub2} />
                        </View>
                      )}
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={styles.mobileTitleRow}>
                          <Text style={styles.mobileAssetId} numberOfLines={1} ellipsizeMode="tail">
                            {item?.id}
                          </Text>
                          <Text style={styles.mobileCardTitleSuffix} numberOfLines={1}>
                            {' · '}{assetType}
                          </Text>
                        </View>
                        <Text style={styles.mobileCardSubtitle} numberOfLines={1}>
                          SN: {serial || 'N/A'}
                        </Text>
                      </View>
                    </View>
                    <StatusBadge status={item?.status} size="sm" />
                  </View>

                  <View style={styles.mobileCardDetails}>
                    {model ? (
                      <View style={[styles.mobileDetailRow, assignedTo && styles.mobileModelAssignedTight]}>
                        <Feather name="cpu" size={14} color={Colors.sub} />
                        <Text style={styles.mobileDetailLabel}>Model:</Text>
                        <Text style={styles.mobileDetailValue} numberOfLines={1}>{model}</Text>
                      </View>
                    ) : null}
                    {assignedTo ? (
                      <View style={styles.mobileDetailRow}>
                        <Feather name="user" size={14} color={Colors.sub} />
                        <Text style={styles.mobileDetailLabel}>Assigned:</Text>
                        <Text style={styles.mobileDetailValue} numberOfLines={1}>{assignedTo}</Text>
                      </View>
                    ) : null}
                    {desc ? (
                      <View style={styles.mobileDetailRow}>
                        <Feather name="file-text" size={14} color={Colors.sub} />
                        <Text style={styles.mobileDetailLabel}>Description:</Text>
                        <Text style={styles.mobileDetailValue} numberOfLines={1}>{desc}</Text>
                      </View>
                    ) : null}
                    {nextService ? (
                      <View style={styles.mobileDetailRow}>
                        <Feather name="tool" size={14} color={Colors.accent} />
                        <Text style={styles.mobileDetailLabel}>Service:</Text>
                        <Text style={[styles.mobileDetailValue, { color: '#B45309', fontWeight: '700' }]} numberOfLines={1}>
                            {formatDaysUntil(nextService)}
                        </Text>
                      </View>
                    ) : null}
                      {filters.types?.length > 0 && typeFieldDefs.map((def) => {
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
              <TourTarget id="web-search-pagination">
                <View style={styles.paginationRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, justifyContent: 'center' }}>
                    <TouchableOpacity disabled={page <= 1} onPress={() => setPage(p => p - 1)} style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]}>
                      <MaterialIcons name="chevron-left" size={20} color={page <= 1 ? Colors.sub2 : Colors.primaryDark} />
                    </TouchableOpacity>
                    <Text style={styles.pageText}>{page} of {totalPages}</Text>
                    <TouchableOpacity disabled={page >= totalPages} onPress={() => setPage(p => p + 1)} style={[styles.pageBtn, page >= totalPages && styles.pageBtnDisabled]}>
                      <MaterialIcons name="chevron-right" size={20} color={page >= totalPages ? Colors.sub2 : Colors.primaryDark} />
                    </TouchableOpacity>
                  </View>
                </View>
              </TourTarget>

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
                contentContainerStyle={styles.tableScrollContent}
            >
                <View style={[styles.tableContent, { minWidth: tableMinWidth }]}>
                <View style={styles.tableHeader}>
                  {columns.map((c) => {
                    const sortField = columnKeyToSortField[c.key];
                    const isSortable = !!sortField;
                    const isActive = sort.field === sortField;
                    const handleSort = () => {
                      if (!isSortable) return;
                      if (isActive) {
                        setSort((s) => ({ ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' }));
                      } else {
                        const defaultDir = (sortField === 'updated_at' || sortField === 'date_purchased') ? 'desc' : 'asc';
                        setSort({ field: sortField, dir: defaultDir });
                      }
                    };
                    const content = (
                      <>
                        <Text style={[styles.thText, isActive && { color: Colors.accent }]} numberOfLines={2}>{c.label}</Text>
                        {isSortable && (
                          <View style={{ marginLeft: 4 }}>
                            {isActive ? (
                              sort.dir === 'asc' ? (
                                <Feather name="chevron-up" size={14} color={Colors.accent} />
                              ) : (
                                <Feather name="chevron-down" size={14} color={Colors.accent} />
                              )
                            ) : (
                              <Feather name="chevron-down" size={12} color="rgba(255,255,255,0.45)" />
                            )}
                          </View>
                        )}
                      </>
                    );
                    return (
                      <View
                        key={c.key}
                        style={[
                          styles.th,
                          (c.key === 'qr' || c.key === 'image' || c.key === 'status') && styles.thCellIcon,
                          columnStyle(c.key),
                          c.key === 'model' && styles.thModelAssignedTightRight,
                          c.key === 'assigned' && styles.thModelAssignedTightLeft,
                        ]}
                      >
                        {isSortable ? (
                          <TouchableOpacity onPress={handleSort} style={[styles.thSortTouch, c.key === 'status' && { justifyContent: 'center' }]} activeOpacity={0.7}>
                            {content}
                          </TouchableOpacity>
                        ) : (
                          content
                        )}
                      </View>
                    );
                  })}
                </View>
                <ScrollView style={styles.tableBodyScroll} showsVerticalScrollIndicator={false}>
                  {paginatedItems.map((item, idx) => {
                    const assignedTo = item?.assigned_to ?? item?.users?.name ?? item?.users?.useremail ?? item?.users?.email;
                    const model = item?.model ?? item?.fields?.model;
                    const serial = item?.serial_number ?? item?.fields?.serial_number;
                    const description = item?.description ?? item?.fields?.description ?? '';
                    const purchased = item?.date_purchased ?? item?.purchase_date ?? item?.fields?.date_purchased ?? item?.fields?.purchase_date;
                    const updated = item?.last_updated ?? item?.updated_at;
                    const updatedBy = item?.last_changed_by_name ?? item?.last_changed_by_email ?? '--';
                    const otherId = item?.other_id ?? item?.asset_tag ?? item?.asset_name ?? item?.name ?? '--';
                    const imageUrl = item?.image_url ?? item?.image ?? item?.fields?.image_url ?? item?.fields?.image ?? null;

                    // Date formatters
                    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '--';
                    const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { hour: 'numeric', minute: 'numeric', hour12: true, day: 'numeric', month: 'short' }) : '--';

                    return (
                      <View
                        key={item.id}
                        style={[styles.tr, idx % 2 === 1 && styles.rowAlt, (hoverRowId === item.id) && styles.rowHover]}
                        onMouseEnter={() => setHoverRowId(item.id)}
                        onMouseLeave={() => setHoverRowId(null)}
                      >
                        {/* QR Code */}
                    <View style={[styles.td, styles.tdCellIcon, columnStyle('qr')]}>
                          <TouchableOpacity onPress={() => setQrModalItem(item)} style={{ padding: 2 }}>
                            <MaterialCommunityIcons name="qrcode-scan" size={18} color={Colors.primary} />
                          </TouchableOpacity>
                        </View>
                    {/* Image */}
                    <View style={[styles.td, styles.tdCellIcon, columnStyle('image')]}>
                      {imageUrl ? (
                        <Image source={{ uri: imageUrl }} style={styles.tableThumb} resizeMode="cover" />
                      ) : (
                        <View style={[styles.tableThumb, styles.tableThumbPlaceholder]}>
                          <Ionicons name="image-outline" size={16} color={Colors.sub2} />
                        </View>
                      )}
                    </View>
                        {/* Asset Id */}
                    <View style={[styles.td, columnStyle('id')]}>
                      {isUUID(String(item.id || '')) ? (
                        <View style={styles.awaitingIdWrap}>
                          <Text style={styles.tdText} numberOfLines={1}>
                            {(otherId && otherId !== '--') ? otherId : 'QR awaiting'}
                          </Text>
                          <Text style={styles.awaitingIdSub}>Awaiting QR</Text>
                        </View>
                      ) : (
                        <TouchableOpacity
                          onPress={() => goToAsset(item.id)}
                          activeOpacity={0.7}
                          style={[styles.assetLink, styles.tdTapStretch]}
                        >
                          <Text style={[styles.tdText, styles.assetIdLink]} numberOfLines={1} selectable={false}>
                            {item.id}
                          </Text>
                        </TouchableOpacity>
                      )}
                        </View>
                        {/* Other Id */}
                    <View style={[styles.td, columnStyle('other_id')]}>
                      <Text style={styles.tdText} numberOfLines={1}>{otherId}</Text>
                        </View>
                        {/* Type */}
                    <View style={[styles.td, columnStyle('type')]}>
                          <Text style={styles.tdText} numberOfLines={1}>{item?.asset_type ?? item?.type ?? item?.asset_types?.name ?? '--'}</Text>
                        </View>
                        {/* Serial */}
                    <View style={[styles.td, columnStyle('serial')]}>
                          <Text style={[styles.tdText, serial && styles.serialText]} numberOfLines={1}>{serial || '--'}</Text>
                        </View>
                        {/* Description */}
                    <View style={[styles.td, styles.tdTall, columnStyle('description')]}>
                      <Text style={[styles.tdText, styles.tdTextSmall, styles.tdTextLeading]} numberOfLines={3}>
                        {description || '--'}
                      </Text>
                        </View>
                        {/* Model */}
                    <View style={[styles.td, styles.tdTall, columnStyle('model'), styles.tdModelAssignedTightRight]}>
                      <Text style={[styles.tdText, styles.tdTextLeading]} numberOfLines={2}>{model || '--'}</Text>
                        </View>
                        {/* Assigned To */}
                    <View style={[styles.td, columnStyle('assigned'), styles.tdModelAssignedTightLeft]}>
                          <Text style={[styles.tdText, styles.tdTextLeading]} numberOfLines={1}>{assignedTo || '--'}</Text>
                        </View>
                        {/* Status */}
                    <View style={[styles.td, styles.tdCellIcon, columnStyle('status')]}>
                          <StatusBadge status={item?.status} size="sm" style={{ alignSelf: 'center' }} />
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
              <TourTarget id="web-search-pagination">
                <TablePagination
                  page={page}
                  pageSize={pageSize === 'all' ? 'All' : pageSize}
                  total={items.length}
                  pageSizes={[25, 50, 100, 'All']}
                  onPageChange={setPage}
                  onPageSizeChange={(sz) => { setPage(1); setPageSize(sz === 'All' ? 'all' : sz); }}
                />
              </TourTarget>
            )}
            </View>
          </View>
        )
      )}

      {/* Advanced Filter Modal */}
      <Modal visible={filterModalOpen} transparent animationType="fade" onRequestClose={closeFilterModal}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
          <TouchableOpacity style={{ flex: 1, width: '100%' }} activeOpacity={1} onPress={closeFilterModal} />
          <View style={styles.filterSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.modalTitle}>Filters</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {activeCount > 0 && (
                  <TouchableOpacity onPress={clearFilters} style={styles.clearAllBtn}>
                    <Text style={styles.clearAllText}>Clear all</Text>
                  </TouchableOpacity>
                )}
              <TouchableOpacity onPress={closeFilterModal} style={[styles.inlineIconBtn, { backgroundColor: '#F3F6FB' }]}>
                <Feather name="x" size={16} color={Colors.primary} />
              </TouchableOpacity>
            </View>
            </View>
            <ScrollView style={{ maxHeight: filterScrollMaxHeight }} keyboardShouldPersistTaps="handled">
              <View style={{ gap: 16 }}>
                {/* Asset Type */}
                <View>
                  <Text style={styles.groupTitle}>Asset Type</Text>

                  {/* Selected type chips */}
                  {filters.types?.length > 0 && (
                    <View style={styles.selectedTypesRow}>
                      {filters.types.map((t) => (
                        <TouchableOpacity
                          key={t}
                          style={styles.selectedTypeChip}
                          onPress={() => setFilters((f) => ({ ...f, types: f.types.filter((x) => x !== t) }))}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.selectedTypeChipText} numberOfLines={1}>{t}</Text>
                          <Feather name="x" size={12} color={Colors.accent} />
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  {/* Search input */}
                  <TextInput
                    style={styles.filterInput}
                    placeholder="Search asset types…"
                    placeholderTextColor="#94A3B8"
                    value={typeSearch}
                    onChangeText={setTypeSearch}
                  />

                  {/* Available types as chips (matches status design) */}
                  <View style={[styles.filterMenuRow, styles.chipsRow, { marginTop: 10 }]}>
                    <Chip
                      label="Any type"
                      active={!filters.types || filters.types.length === 0}
                      onPress={() => { setFilters((f) => ({ ...f, types: [] })); setTypeSearch(''); }}
                    />
                    {filteredAssetTypes.map((t) => (
                      <Chip
                        key={t}
                        label={t}
                        active={false}
                        onPress={() => {
                          setFilters((f) => ({ ...f, types: [...(f.types || []), t] }));
                          setTypeSearch('');
                        }}
                      />
                    ))}
                  </View>
                </View>

                {/* Status */}
                <View>
                  <Text style={styles.groupTitle}>Status</Text>
                  <View style={[styles.filterMenuRow, styles.chipsRow]}>
                    <Chip label="Any status" active={!filters.status} onPress={() => setFilters(f => ({ ...f, status: null }))} />
                    {['In Service', 'On Hire', 'Repair', 'Maintenance', 'End of Life'].map(s => (
                      <Chip key={s} label={s} active={filters.status === s} onPress={() => setFilters(f => ({ ...f, status: s }))} />
                    ))}
                  </View>
                </View>

                {/* Users (assigned to) */}
                <View>
                  <Text style={styles.groupTitle}>Users</Text>

                  {/* Selected user chips */}
                  {filters.assignedToUserIds?.length > 0 && (
                    <View style={styles.selectedTypesRow}>
                      {filters.assignedToUserIds.map((uid) => {
                        const u = filterUsers.find((x) => String(x.id) === String(uid));
                        const label = u ? (u.name || u.useremail || uid) : uid;
                        return (
                          <TouchableOpacity
                            key={uid}
                            style={styles.selectedTypeChip}
                            onPress={() => setFilters((f) => ({ ...f, assignedToUserIds: f.assignedToUserIds.filter((x) => x !== uid) }))}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.selectedTypeChipText} numberOfLines={1}>{label}</Text>
                            <Feather name="x" size={12} color={Colors.accent} />
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}

                  {/* Search input */}
                  <TextInput
                    style={[styles.filterInput, { marginBottom: 10 }]}
                    placeholder="Search by name or email…"
                    placeholderTextColor="#94A3B8"
                    value={userSearch}
                    onChangeText={setUserSearch}
                  />

                  {/* Any user chip always shown; results only appear after typing */}
                  <View style={[styles.filterMenuRow, styles.chipsRow]}>
                    <Chip
                      label="Any user"
                      active={!filters.assignedToUserIds || filters.assignedToUserIds.length === 0}
                      onPress={() => { setFilters((f) => ({ ...f, assignedToUserIds: [] })); setUserSearch(''); }}
                    />
                    {userSearch.trim().length > 0 && filterUsers
                      .filter((u) => {
                        if (filters.assignedToUserIds?.includes(String(u.id))) return false;
                        const term = userSearch.trim().toLowerCase();
                        const name = String(u.name || '').toLowerCase();
                        const email = String(u.useremail || '').toLowerCase();
                        return name.includes(term) || email.includes(term);
                      })
                      .map((u) => {
                        const label = u.name || u.useremail || u.id;
                        return (
                          <Chip
                            key={u.id}
                            label={label}
                            active={false}
                            onPress={() => {
                              setFilters((f) => ({ ...f, assignedToUserIds: [...(f.assignedToUserIds || []), String(u.id)] }));
                              setUserSearch('');
                            }}
                          />
                        );
                      })}
                  </View>
                  {userSearch.trim().length > 0 && filterUsers.filter((u) => {
                    if (filters.assignedToUserIds?.includes(String(u.id))) return false;
                    const term = userSearch.trim().toLowerCase();
                    return String(u.name || '').toLowerCase().includes(term) || String(u.useremail || '').toLowerCase().includes(term);
                  }).length === 0 && (
                    <Text style={{ fontSize: sf(13), color: Colors.sub2, fontStyle: 'italic', marginTop: 6 }}>No users match "{userSearch}"</Text>
                  )}
                </View>

                {/* Switches */}
                <View style={{ gap: 12 }}>
                  <View style={styles.switchRow}>
                    <Text style={styles.switchLabel}>Only my assets</Text>
                    <Switch value={filters.onlyMine} onValueChange={(v) => setFilters(f => ({ ...f, onlyMine: v }))} trackColor={{ false: '#E2E8F0', true: Colors.accent }} />
                  </View>
                  <View style={styles.switchRow}>
                    <Text style={styles.switchLabel}>Only unassigned</Text>
                    <Switch value={filters.onlyUnassigned} onValueChange={(v) => setFilters(f => ({ ...f, onlyUnassigned: v }))} trackColor={{ false: '#E2E8F0', true: Colors.accent }} />
                  </View>
                  <View style={styles.switchRow}>
                    <Text style={styles.switchLabel}>Due soon (service)</Text>
                    <Switch value={filters.dueSoon} onValueChange={(v) => setFilters(f => ({ ...f, dueSoon: v }))} trackColor={{ false: '#E2E8F0', true: Colors.accent }} />
                  </View>
                  <View style={styles.switchRow}>
                    <Text style={styles.switchLabel}>Include QR reserved assets</Text>
                    <Switch value={filters.includeQRReserved} onValueChange={(v) => setFilters(f => ({ ...f, includeQRReserved: v }))} trackColor={{ false: '#E2E8F0', true: Colors.accent }} />
                  </View>
                  <View style={styles.switchRow}>
                    <Text style={styles.switchLabel}>Only QR awaiting assets</Text>
                    <Switch value={filters.awaitingQROnly} onValueChange={(v) => setFilters(f => ({ ...f, awaitingQROnly: v }))} trackColor={{ false: '#E2E8F0', true: Colors.accent }} />
                  </View>
                </View>
              </View>
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
              <TouchableOpacity style={[styles.btnGhost, { flex: 1 }]} onPress={() => {
                setFilters({ types: [], status: null, assignedTo: null, assignedToUserIds: [], onlyMine: false, dueSoon: false, includeQRReserved: false, onlyUnassigned: false, awaitingQROnly: false });
                closeFilterModal();
              }}>
                <Text style={[styles.btnText, { color: Colors.primary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, { flex: 1 }]} onPress={closeFilterModal}>
                <Text style={styles.btnText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Sort Modal */}
      <Modal visible={sortModalOpen} transparent animationType="fade" onRequestClose={() => setSortModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={{ flex: 1, width: '100%' }} activeOpacity={1} onPress={() => setSortModalOpen(false)} />
          <View style={styles.filterSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.modalTitle}>Sort</Text>
              <TouchableOpacity onPress={() => setSortModalOpen(false)} style={[styles.inlineIconBtn, { backgroundColor: '#F3F6FB' }]}>
                <Feather name="x" size={16} color={Colors.primary} />
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
                <Text style={[styles.btnText, { color: Colors.primary }]}>Cancel</Text>
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
          <View style={[styles.filterSheet, { width: 'auto', maxWidth: 400, borderRadius: Radius.xl, padding: 32, alignItems: 'center' }]}>
            <Text style={[styles.modalTitle, { marginBottom: 24, fontSize: sf(22) }]}>{qrModalItem?.id}</Text>
            <View style={{ padding: 16, backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 2, borderColor: Colors.line }}>
              {qrModalItem && (
                <QRCode
                  value={`${String(API_BASE_URL).replace(/\/+$/, '')}/check-in/${qrModalItem.id}`}
                  size={220}
                />
              )}
            </View>
            <Text style={{ marginTop: 24, textAlign: 'center', color: Colors.sub, fontSize: sf(15), lineHeight: 22 }}>
              Scan this QR code to instantly open the asset details and perform actions.
            </Text>
            <TouchableOpacity style={[styles.btn, { marginTop: 32, width: '100%', height: 48 }]} onPress={() => setQrModalItem(null)}>
              <Text style={[styles.btnText, { fontSize: sf(16) }]}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </Container>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  embedContainer: { flex: 1, backgroundColor: Colors.bg, padding: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },

  // Toolbar
  iconBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, backgroundColor: Colors.chip, borderWidth: 1.5, borderColor: Colors.line },
  actionBtn: { width: 'auto', paddingHorizontal: 12 },
  actionBtnText: { color: Colors.primary, fontWeight: '700', fontSize: sf(13) },
  countDot: { position: 'absolute', top: -4, right: -4, backgroundColor: Colors.accent, borderRadius: 6, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  countDotText: { color: '#fff', fontSize: sf(10), fontWeight: '800' },
  toolbarSurface: { backgroundColor: Colors.card, borderBottomWidth: 2, borderBottomColor: Colors.line, marginBottom: 8, paddingTop: 10 },
  searchRowCompact: { marginBottom: 8, marginHorizontal: 12, marginTop: 8 },
  quickRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', paddingHorizontal: 12, paddingBottom: 12, marginTop: 4, justifyContent: 'space-between', alignItems: 'center' },
  metaText: { fontSize: sf(12), color: Colors.sub, fontWeight: '700', marginHorizontal: 14, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.3 },

  // Table Styles (Desktop)
  tableContainer: { flex: 1, position: 'relative', marginHorizontal: 8 },
  tableWrap: {
    flex: 1,
    alignSelf: 'stretch',
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    ...Shadows.md,
  },
  tableScrollWrapper: { flex: 1 },
  tableScrollContent: { flexGrow: 1 },
  tableHeader: { flexDirection: 'row', backgroundColor: Colors.primary, alignItems: 'stretch' },
  /** flex: 1 so flex columns fill available viewport width; minWidth (applied inline) sets the horizontal-scroll floor. */
  tableContent: { flex: 1 },
  th: { paddingVertical: 13, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'stretch', borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.1)' },
  thCellIcon: { alignItems: 'center' },
  /** Tighten gutter between Model and Assigned To (inner padding well below default 8+8). */
  thModelAssignedTightRight: { paddingRight: 2 },
  thModelAssignedTightLeft: { paddingLeft: 2 },
  thSortTouch: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flex: 1 },
  thText: { fontSize: sf(12), fontWeight: '800', color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' },
  tableBodyScroll: { flex: 1 },
  tableBodyContent: { paddingRight: 0 },
  tr: { flexDirection: 'row', backgroundColor: '#FFFFFF', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: Colors.line },
  rowAlt: { backgroundColor: '#F8FAFC' },
  rowHover: { backgroundColor: Colors.accentLight },
  td: { paddingVertical: 8, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'stretch' },
  tdCellIcon: { alignItems: 'center' },
  tdTapStretch: { alignSelf: 'stretch' },
  tdModelAssignedTightRight: { paddingRight: 2 },
  tdModelAssignedTightLeft: { paddingLeft: 2 },
  tdText: { fontSize: sf(13), color: Colors.text, fontWeight: '500', textAlign: 'center' },
  /** Left-align long / short text in wide columns (stretch parent makes this use full width). */
  tdTextLeading: { textAlign: 'center' },
  tdTextSmall: { fontSize: sf(11), lineHeight: 15 },
  tdTall: { minHeight: 56, justifyContent: 'center' },
  assetLink: { paddingVertical: 4, paddingHorizontal: 4 },
  assetIdLink: {
    fontSize: sf(13),
    color: Colors.primary,
    fontWeight: '700',
    textDecorationLine: 'underline',
    textDecorationColor: Colors.primary,
  },
  serialText: { fontSize: sf(13), color: Colors.warningFg, fontWeight: '700', letterSpacing: 0.5 },
  tableThumb: { width: 40, height: 40, borderRadius: Radius.sm, backgroundColor: Colors.chip, overflow: 'hidden', borderWidth: 1.5, borderColor: Colors.line },
  tableThumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  awaitingIdWrap: { alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  awaitingIdSub: { fontSize: sf(11), color: Colors.sub2, fontWeight: '600', marginTop: 2 },

  // Mobile Card Styles
  mobileScroll: { flex: 1 },
  mobileScrollContent: { paddingHorizontal: 12, paddingBottom: 24 },
  gridContainer: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  mobileCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: 14,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: Colors.line,
    ...Shadows.card,
    width: '100%',
  },
  desktopGridCard: {
    width: '32%',
    minWidth: 300,
    marginHorizontal: 6,
    marginBottom: 14,
  },
  mobileCardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10, gap: 8 },
  mobileThumb: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.chip, borderWidth: 1.5, borderColor: Colors.line },
  mobileThumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  mobileTitleRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'nowrap', marginBottom: 2, flex: 1, minWidth: 0 },
  mobileAssetId: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: sf(13),
    fontWeight: '800',
    color: Colors.primary,
    textDecorationLine: 'underline',
    textDecorationColor: Colors.primary,
  },
  mobileCardTitleSuffix: { fontSize: sf(15), fontWeight: '800', color: Colors.text, flexShrink: 0 },
  mobileCardTitle: { fontSize: sf(15), fontWeight: '800', color: Colors.text, marginBottom: 2 },
  mobileCardSubtitle: { fontSize: sf(12), color: Colors.sub, fontWeight: '700' },
  mobileStatusBadge: { paddingHorizontal: 11, paddingVertical: 4, borderRadius: Radius.sm, borderWidth: 1.5, alignSelf: 'flex-start' },
  mobileStatusText: { fontSize: sf(11), fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  mobileCardDetails: { gap: 7, marginBottom: 12, paddingTop: 10, borderTopWidth: 2, borderTopColor: Colors.line },
  mobileDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  /** Pull Assigned row closer to Model when both show (40% of card details `gap: 7`). */
  mobileModelAssignedTight: { marginBottom: -2.8 },
  mobileDetailLabel: { fontSize: sf(12), color: Colors.sub, fontWeight: '700', minWidth: 68 },
  mobileDetailValue: { fontSize: sf(13), color: Colors.text, fontWeight: '600', flex: 1 },
  mobileCardActions: { flexDirection: 'row', gap: 8, paddingTop: 10, borderTopWidth: 2, borderTopColor: Colors.line },
  mobileActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: Radius.md },
  mobileActionBtnPrimary: { backgroundColor: Colors.primary },
  mobileActionBtnText: { color: '#FFFFFF', fontSize: sf(14), fontWeight: '800' },

  // Shared / Utils
  badge: { paddingHorizontal: 11, paddingVertical: 4, borderRadius: Radius.sm, borderWidth: 1.5, alignSelf: 'center' },
  badgeText: { fontSize: sf(11), fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  btn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: Radius.md, backgroundColor: Colors.accent, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '800' },
  btnGhost: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: Radius.md, borderWidth: 2, borderColor: Colors.line, alignItems: 'center' },
  btnIcon: { width: 32, height: 32, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: Colors.accent },

  // Modal / Sheet
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  filterSheet: { backgroundColor: Colors.card, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: 20, maxHeight: '90%', width: '100%', borderTopWidth: 2, borderColor: Colors.line },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: sf(20), fontWeight: '900', color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.4 },
  inlineIconBtn: { width: 36, height: 36, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.chip, borderWidth: 1.5, borderColor: Colors.line },
  groupTitle: { fontSize: sf(12), fontWeight: '800', color: Colors.sub, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 },
  filterMenuRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  chipsRow: { flexWrap: 'wrap' },
  typeChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.line },
  switchLabel: { fontSize: sf(14), color: Colors.text, fontWeight: '600' },
  clearAllBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: Colors.accentLight, borderWidth: 1.5, borderColor: Colors.accentMuted },
  clearAllText: { color: Colors.accentDark, fontWeight: '800', fontSize: sf(12) },
  showMoreBtn: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.sm, backgroundColor: Colors.chip },
  showMoreText: { color: Colors.accent, fontWeight: '700', fontSize: sf(12) },
  inlineAlert: { flexDirection: 'row', alignItems: 'center', padding: 8, borderRadius: Radius.md, borderWidth: 2, borderColor: Colors.line, backgroundColor: Colors.chip },
  inlineAlertText: { fontSize: sf(12), color: Colors.text, fontWeight: '600' },

  // Pagination
  // Mobile-only simple pagination (prev/next + page number)
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 2, borderTopColor: Colors.line, backgroundColor: Colors.bg },
  pageText: { fontSize: sf(13), color: Colors.text, fontWeight: '900' },
  pageBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.sm, borderWidth: 2, borderColor: Colors.line, backgroundColor: Colors.card },
  pageBtnDisabled: { opacity: 0.4, backgroundColor: Colors.bg },

  // Filter inputs / type list
  inlineFilterBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingHorizontal: 16, paddingBottom: 16, flexWrap: 'wrap', backgroundColor: Colors.bg },
  filterInputGroup: { width: 140 },
  filterLabel: { fontSize: sf(12), fontWeight: '700', color: Colors.sub, marginBottom: 4 },
  filterInput: { backgroundColor: Colors.card, borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 8, fontSize: sf(13), color: Colors.text },
  filterTypeList: { maxHeight: 180, marginBottom: 8, borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.sm, overflow: 'hidden' },
  filterTypeItem: { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: Colors.line },
  filterTypeItemActive: { backgroundColor: Colors.accentLight },
  filterTypeItemText: { fontSize: sf(14), color: Colors.text, fontWeight: '500' },
  filterTypeItemTextActive: { color: Colors.accentDark, fontWeight: '800' },
  selectedTypesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  selectedTypeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accentLight,
    borderWidth: 1.5,
    borderColor: Colors.accent,
  },
  selectedTypeChipText: { fontSize: sf(13), fontWeight: '700', color: Colors.accentDark, flexShrink: 1 },

  // View Toggle
  viewToggleGroup: { flexDirection: 'row', backgroundColor: Colors.chip, borderRadius: Radius.sm, padding: 2, borderWidth: 2, borderColor: Colors.line },
  viewToggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.sm - 2 },
  viewToggleBtnActive: { backgroundColor: Colors.card, ...Shadows.card },
  viewToggleText: { fontSize: sf(12), fontWeight: '700', color: Colors.sub2 },
  viewToggleTextActive: { color: Colors.primary },

  // Office preset banner
  presetBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 12, marginBottom: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: '#EFF6FF', borderWidth: 2, borderColor: '#BFDBFE', borderRadius: Radius.md,
  },
  presetBannerText: { flex: 1, fontSize: sf(13), color: '#1D4ED8', fontWeight: '700' },
  presetBannerClear: { padding: 2 },
});