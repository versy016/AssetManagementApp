// app/search/index.js
// Blue-themed, powerful search page for AssetManager (now with richer per-item details)

import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, Platform, Image, Modal, Pressable
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MaterialIcons, Ionicons, Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import { auth } from '../../firebaseConfig';

const PAGE_SIZE = 20;
const FIRST_PAGE_BOOST = 120;
const RECENT_KEY = 'asset_search_recents_v1';

// 🔵 Brand palette
const COLORS = {
  primary: '#0B63CE',
  primaryDark: '#084AA0',
  primaryLight: '#E7F3FF',
  primaryPill: '#EAF1FF',
  text: '#111',
  sub: '#555',
  sub2: '#777',
  line: '#E5E7EB',
  bg: '#F7FAFF',
  card: '#FFFFFF',
  chip: '#F2F6FD',
  dangerBg: '#FFEBEE',
  dangerFg: '#D32F2F',
};

export default function SearchScreen() {
  const DEBUG = true;
  const log = (...args) => DEBUG && console.log('[Search]', ...args);
  const router = useRouter();
  const routeParams = useLocalSearchParams();
  const [me, setMe] = useState({ uid: null, email: null });

  // Query & filters
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({
    type: null,
    status: null,
    location: null,
    assignedTo: null,
    onlyMine: false,
    dueSoon: false,
  });
  const [sort, setSort] = useState({
    field: 'updated_at',
    dir: 'desc',
    nullsLast: true,
  });
  const [sortOpen, setSortOpen] = useState(false);

  // Data state
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [metrics, setMetrics] = useState({ total: 0, tookMs: 0 });

  // UX helpers
  const [recents, setRecents] = useState([]);
  const [expandedIds, setExpandedIds] = useState(() => new Set()); // 👈 expanded cards

  // Preload from deep-link params
  useEffect(() => {
    const u = auth?.currentUser || null;
    setMe({ uid: u?.uid ?? null, email: u?.email?.toLowerCase() ?? null });
    const q = (routeParams?.query || routeParams?.q || routeParams?.term || '').toString();
    const model = (routeParams?.model || '').toString();
    if (q || model) {
      const seed = q || model;
      setQuery(seed);
      setDebouncedQuery(seed);
      log('seed from route', seed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounce keyword input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  // Load recents on mount
  useEffect(() => {
    (async () => {
      try {
        const r = await AsyncStorage.getItem(RECENT_KEY);
        if (r) setRecents(JSON.parse(r));
      } catch {}
    })();
  }, []);

  // Trigger fetch when deps change
  useEffect(() => {
    setPage(1);
    setItems([]);
    setHasMore(true);
    fetchPage(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, filters, sort, me.uid, me.email]);

  // ---- helpers used in multiple places ----
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

  // buildQueryParams (unchanged signature)
  const buildQueryParams = useCallback((p, pageSize) => {
    const params = new URLSearchParams();

    // send owner hints when onlyMine is on
    if (filters.onlyMine) {
      if (me.uid) params.set('assigned_to_uid', me.uid);
      if (me.email) {
        params.set('assigned_to_email', me.email);
        params.set('assignedTo', me.email);
      }
    }

    // keyword(s)
    if (debouncedQuery) {
      params.set('q', debouncedQuery);
      params.set('query', debouncedQuery);
      params.set('search', debouncedQuery);
      params.set('term', debouncedQuery);
    }

    // other filters
    if (filters.type) {
      params.set('type', String(filters.type));
      params.set('asset_type', String(filters.type));
    }
    if (filters.status) params.set('status', String(filters.status));
    if (filters.location) params.set('location', String(filters.location));
    if (filters.assignedTo) {
      params.set('assignedTo', String(filters.assignedTo));
      params.set('assigned_to', String(filters.assignedTo));
    }
    if (filters.onlyMine) params.set('onlyMine', '1');
    if (filters.dueSoon) params.set('dueSoon', '1');

    // sort / paging
    params.set('page', String(p));
    params.set('pageSize', String(pageSize));
    params.set('limit', String(pageSize));
    params.set('per_page', String(pageSize));
    params.set('offset', String((p - 1) * pageSize));
    // Map virtual fields to real query fields where possible
    const primaryFieldForServer = sort.field === 'relevance' || sort.field === 'service_due'
      ? (sort.field === 'service_due' ? 'next_service_date' : 'updated_at')
      : sort.field;
    params.set('sort', `${primaryFieldForServer}:${sort.dir}`);
    params.set('order', `${primaryFieldForServer}:${sort.dir}`);
    params.set('sort_field', primaryFieldForServer);
    params.set('sort_dir', sort.dir);
    // single-field sorting only (server may still do its own tiebreakers)
    if (__DEV__) {
      const obj = {};
      for (const [k, v] of params.entries()) obj[k] = v;
      log('params', obj);
    }
    return params.toString();
  }, [debouncedQuery, filters, sort, me.uid, me.email]);

  const extractItems = (data) => {
    const arr = Array.isArray(data?.items)
      ? data.items
      : Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data)
      ? data
      : [];
    const total = typeof data?.total === 'number' ? data.total : arr.length;
    return { arr, total };
  };

  const activeFilterFlag =
    !!debouncedQuery ||
    !!filters.type ||
    !!filters.status ||
    !!filters.location ||
    !!filters.assignedTo ||
    !!filters.onlyMine ||
    !!filters.dueSoon;

  const clientFilterAndSort = (list) => {
    const tokens = debouncedQuery
      ? debouncedQuery.toLowerCase().split(/\s+/).filter(Boolean)
      : [];

    const isOverdue = (d) => {
      if (!d) return false;
      const dt = new Date(d);
      return !Number.isNaN(+dt) && dt < new Date();
    };
    const norm = (v) => (v == null ? '' : String(v).toLowerCase());

    let filtered = list.filter((it) => {
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
      const keywordOk = tokens.length === 0 || tokens.every((t) => hay.includes(t));

      const normStatus = (s) => {
        const t = String(s || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
        const map = {
          'in service': 'in service',
          available: 'in service',
          reserved: 'in service',

          'repair': 'repair',

          'maintenance': 'maintenance',

          'checked out': 'checked out',
          rented: 'rented',

          'end of life': 'end of life',
          lost: 'end of life',
          retired: 'end of life',
        };
        return map[t] || t;
      };

      const typeOk = !filters.type || norm(type) === norm(filters.type);
      const statusOk = !filters.status || normStatus(it?.status) === normStatus(filters.status);
      const locOk = !filters.location || norm(loc).includes(norm(filters.location));
      const assignedOk = !filters.assignedTo || norm(assigned).includes(norm(filters.assignedTo));
      const dueOk = !filters.dueSoon || isOverdue(it?.next_service_date ?? it?.fields?.next_service_date);

      const assignedUid =
        it?.assigned_to_uid ?? it?.assigned_to_user_id ?? it?.assigned_to_id ?? it?.fields?.assigned_to_uid;
      const assignedEmail = (
        it?.assigned_to_email ?? it?.users?.useremail ?? it?.users?.email ?? it?.fields?.assigned_to_email ?? ''
      ).toLowerCase();
      const onlyMineOk =
        !filters.onlyMine ||
        (me.email && assignedEmail && assignedEmail === me.email) ||
        (me.uid && assignedUid && assignedUid === me.uid);

      return keywordOk && typeOk && statusOk && locOk && assignedOk && dueOk && onlyMineOk;
    });

    // robust sort
    const getVal = (it, f) => {
      if (!f) return undefined;
      switch (f) {
        case 'updated_at': return it?.updated_at ?? it?.fields?.updated_at ?? '';
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
        return sort.nullsLast ? (aNull ? 1 : -1) : (aNull ? -1 : 1);
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
    // Custom comparators for virtual fields
    const computeRelevance = (it) => {
      if (!tokens.length) return 0;
      const name = (it?.name || it?.asset_name || '').toLowerCase();
      const id = String(it?.id || '').toLowerCase();
      const serial = String(it?.serial_number ?? it?.fields?.serial_number ?? '').toLowerCase();
      const model = String(it?.model ?? it?.fields?.model ?? '').toLowerCase();
      const loc = String(it?.location ?? it?.fields?.location ?? '').toLowerCase();
      const type = String(it?.asset_type ?? it?.type ?? it?.asset_types?.name ?? '').toLowerCase();
      let score = 0;
      // strong boosts
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
        // tie-breaker by name
        return cmpCore(a, b, 'name', 'asc');
      }
      if (field === 'service_due') {
        const ad = daysUntilService(a);
        const bd = daysUntilService(b);
        const aNull = ad === null;
        const bNull = bd === null;
        if (aNull || bNull) {
          if (aNull && bNull) return 0;
          return sort.nullsLast ? (aNull ? 1 : -1) : (aNull ? -1 : 1);
        }
        return dir === 'asc' ? ad - bd : bd - ad;
      }
      return cmpCore(a, b, field, dir);
    };

    filtered.sort((a, b) => {
      const p = cmp(a, b, sort.field, sort.dir);
      if (p !== 0) return p;
      // deterministic fallback by name
      return cmpCore(a, b, 'name', 'asc');
    });

    return filtered;
  };

  const saveRecent = useCallback(async () => {
    const labelParts = [];
    if (debouncedQuery) labelParts.push(`“${debouncedQuery}”`);
    if (filters.onlyMine) labelParts.push('My assets');
    if (filters.status) labelParts.push(`Status:${filters.status}`);
    if (filters.type) labelParts.push(`Type:${filters.type}`);
    if (filters.dueSoon) labelParts.push('Due soon');
    const label = labelParts.join(' · ');
    if (!label) return;
    const entry = { label, query: debouncedQuery, filters, sort, ts: Date.now() };
    const next = [entry, ...recents.filter(r => r.label !== label)].slice(0, 10);
    setRecents(next);
    try { await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
  }, [debouncedQuery, filters, sort, recents]);

  const fetchPage = useCallback(async (p, replace = false) => {
    if (loading || (!hasMore && !replace)) return;
    if (filters.onlyMine && !me.uid && !me.email) return;

    setLoading(true);
    setError(null);

    const start = Date.now();
    const effectiveSize = p === 1 ? Math.max(PAGE_SIZE, FIRST_PAGE_BOOST) : PAGE_SIZE;

    try {
      const qs = buildQueryParams(p, effectiveSize);

      const endpoints = [
        `${API_BASE_URL}/assets?${qs}`,
        `${API_BASE_URL}/assets/search?${qs}`,
      ];

      let data = null, ok = false, lastErr = null, usedUrl = null, lastStatus = null;

      for (const url of endpoints) {
        usedUrl = url;
        try {
          const res = await fetch(url);
          lastStatus = res.status;
          if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }
          data = await res.json();
          ok = true;
          break;
        } catch (e) {
          lastErr = e?.message || 'Network error';
        }
      }

      if (!ok) throw new Error(lastErr || 'Search failed');

      const { arr: rawItems, total: serverTotal } = extractItems(data);
      // Always apply client processing so selected sort is honored even without filters
      const processed = clientFilterAndSort(rawItems);
      const pageSlice = processed.slice(0, p * PAGE_SIZE);
      const newPageChunk = pageSlice.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);

      setItems(prev => (replace ? newPageChunk : [...prev, ...newPageChunk]));
      setHasMore(pageSlice.length > p * PAGE_SIZE - newPageChunk.length);
      setPage(p);

      const tookMs = Date.now() - start;
      setMetrics({ total: processed.length, tookMs });

      if (p === 1) saveRecent();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [
    buildQueryParams,
    hasMore,
    loading,
    activeFilterFlag,
    clientFilterAndSort,
    filters.onlyMine,
    me.uid,
    me.email,
    debouncedQuery,
    filters,
    sort,
    saveRecent
  ]);

  const onEndReached = () => {
    if (!loading && hasMore) fetchPage(page + 1);
  };

  const quickToggle = (key) => setFilters(f => ({ ...f, [key]: !f[key] }));

  // active filter count for badge
  const activeCount = [
    !!debouncedQuery,
    !!filters.type,
    !!filters.status,
    !!filters.location,
    !!filters.assignedTo,
    !!filters.onlyMine,
    !!filters.dueSoon,
  ].filter(Boolean).length;

  // ---------- Card ----------
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
      .filter(Boolean)
      .join(' • ');

    const statusColor = statusToColor(item?.status);
    const isExpanded = expandedIds.has(String(item.id));

    const toggleExpand = () => {
      setExpandedIds(prev => {
        const next = new Set(prev);
        const key = String(item.id);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
      });
    };

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.9}
        onPress={() => router.push({ pathname: '/asset/[assetId]', params: { assetId: String(item.id) } })}
        onLongPress={toggleExpand}
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
            <View style={[styles.badge, { backgroundColor: statusColor.bg, borderColor: statusColor.bd }]}>
              <Text style={[styles.badgeText, { color: statusColor.fg }]}>{prettyStatus(item?.status)}</Text>
            </View>
          </View>

          {!!subtitle && <Text style={styles.cardSubtitle} numberOfLines={1}>{subtitle}</Text>}

          {/* Primary meta chips */}
          <View style={styles.metaRow}>
            {assignedTo && (
              <MetaChip icon="user" text={truncate(String(assignedTo), 24)} />
            )}
            {loc && (
              <MetaChip icon="map-pin" text={truncate(String(loc), 18)} />
            )}
            {nextService && (
              <MetaChip icon="tool" text={`Service ${daysUntil(nextService)}`} />
            )}
          </View>

          {/* Expanded quick details */}
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

        <TouchableOpacity style={styles.cardRight} onPress={toggleExpand} hitSlop={8}>
          <MaterialIcons
            name={isExpanded ? 'expand-less' : 'expand-more'}
            size={24}
            color={COLORS.sub2}
          />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/(tabs)/dashboard'); // or wherever your home/tab is
              }
            }}
          >
            <Feather name="arrow-left" size={20} color={COLORS.primary} />
          </TouchableOpacity>

          <Text style={styles.title}>Search</Text>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => setFiltersOpen(true)}>
            <View style={{ position: 'relative' }}>
              <Feather name="sliders" size={20} color={COLORS.primary} />
              {activeCount > 0 && (
                <View style={styles.countDot}>
                  <Text style={styles.countDotText}>{Math.min(activeCount, 9)}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => fetchPage(1, true)}>
            <Feather name="refresh-ccw" size={20} color={COLORS.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search input */}
      <View style={styles.searchRow}>
        <Feather name="search" size={18} color={COLORS.sub2} style={{ marginRight: 8 }} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name, ID, serial, model, notes…"
          placeholderTextColor="#9AA6B2"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
          returnKeyType="search"
          onSubmitEditing={() => fetchPage(1, true)}
        />
        {query?.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Feather name="x" size={16} color={COLORS.sub2} />
          </TouchableOpacity>
        )}
      </View>

      {/* Quick filters */}
      <View style={styles.quickRow}>
        <QuickToggle label="My assets" active={filters.onlyMine} onPress={() => quickToggle('onlyMine')} icon="user" />
        <QuickToggle label="Needs service" active={filters.dueSoon} onPress={() => quickToggle('dueSoon')} icon="tool" />
        <QuickToggle
          label="In Service"
          active={filters.status === 'in service'}
          onPress={() => setFilters(f => ({ ...f, status: f.status === 'in service' ? null : 'in service' }))}
          icon="check-circle"
        />
      </View>

      {/* Metrics & sort */}
      <View style={styles.metaBar}>
        <Text style={styles.metaBarText}>
          {metrics.total} results {metrics.tookMs ? `· ${metrics.tookMs} ms` : ''}
        </Text>
        <TouchableOpacity style={styles.sortBtn} onPress={() => setSortOpen(true)}>
          <Feather name="arrow-up-down" size={14} color={COLORS.primary} />
          <Text style={styles.sortText}>{prettySortLabel(sort)}</Text>
        </TouchableOpacity>
      </View>

      {/* Recents */}
      {recents?.length > 0 && (
        <HorizontalChips
          title="Recent"
          items={recents.map(r => ({
            key: r.ts.toString(),
            label: r.label,
            onPress: () => { setQuery(r.query || ''); setFilters(r.filters || {}); setSort(r.sort || sort); },
          }))}
        />
      )}

      {/* Results list */}
      {error ? (
        <ErrorState message={error} onRetry={() => fetchPage(1, true)} />
      ) : items.length === 0 && !loading ? (
        <EmptyState />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item, idx) => String(item?.id ?? idx)}
          renderItem={({ item }) => <ResultCard item={item} />}
          onEndReachedThreshold={0.4}
          onEndReached={onEndReached}
          ListFooterComponent={loading ? <ListLoading /> : null}
          contentContainerStyle={{ paddingBottom: 28 }}
        />
      )}

      {/* Filters modal */}
      <FiltersModal
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        setFilters={setFilters}
        onApply={() => { setFiltersOpen(false); fetchPage(1, true); }}
      />
      <SortModal
        visible={sortOpen}
        onClose={() => setSortOpen(false)}
        sort={sort}
        setSort={setSort}
        onApply={() => { setSortOpen(false); fetchPage(1, true); }}
      />
    </SafeAreaView>
  );
}

/* ---------- Small reusable bits ---------- */
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

function QuickToggle({ label, active, onPress, icon }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.quick, active && styles.quickActive]}>
      <Feather name={icon} size={14} color={active ? COLORS.primaryDark : COLORS.sub} />
      <Text style={[styles.quickText, active && { color: COLORS.primaryDark }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function HorizontalChips({ title, items }) {
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <FlatList
        data={items}
        keyExtractor={(i) => i.key}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={item.onPress} style={styles.chip}>
            <Text style={styles.chipText} numberOfLines={1}>{item.label}</Text>
          </TouchableOpacity>
        )}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 4 }}
      />
    </View>
  );
}

function FiltersModal({ visible, onClose, filters, setFilters, onApply }) {
  const [nameForSave, setNameForSave] = useState('');
  const typeOptions = [
    { label: 'Any type', value: null },
    { label: 'Vehicle', value: 'vehicle' },
    { label: 'Drone', value: 'drone' },
    { label: 'Laptop', value: 'laptop' },
  ];
  const statusOptions = [
    { label: 'Any status', value: null },
    { label: 'In Service', value: 'in service' },
    { label: 'Repair', value: 'repair' },
    { label: 'Maintenance', value: 'maintenance' },
    { label: 'End of Life', value: 'end of life' },
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={styles.modalSheet}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Filters</Text>
          <TouchableOpacity onPress={onClose}><Feather name="x" size={20} color={COLORS.text} /></TouchableOpacity>
        </View>

        <View style={styles.formRow}>
          <Text style={styles.label}>Asset Type</Text>
          <ChipSelect value={filters.type} onChange={v => setFilters(f => ({ ...f, type: v }))} options={typeOptions} />
        </View>
        <View style={styles.formRow}>
          <Text style={styles.label}>Status</Text>
          <ChipSelect value={filters.status} onChange={v => setFilters(f => ({ ...f, status: v }))} options={statusOptions} />
        </View>
        <View style={styles.formRow}>
          <Text style={styles.label}>Assigned To (email)</Text>
          <TextInput
            placeholder="someone@company.com"
            value={filters.assignedTo || ''}
            onChangeText={t => setFilters(f => ({ ...f, assignedTo: t || null }))}
            style={styles.input}
            placeholderTextColor="#9AA6B2"
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </View>
        <View style={styles.formRow}>
          <Text style={styles.label}>Location</Text>
          <TextInput
            placeholder="Office / Site"
            value={filters.location || ''}
            onChangeText={t => setFilters(f => ({ ...f, location: t || null }))}
            style={styles.input}
            placeholderTextColor="#9AA6B2"
          />
        </View>

        <View style={styles.switchRow}>
          <Toggle label="Only my assets" value={!!filters.onlyMine} onChange={() => setFilters(f => ({ ...f, onlyMine: !f.onlyMine }))} />
          <Toggle label="Due soon (service)" value={!!filters.dueSoon} onChange={() => setFilters(f => ({ ...f, dueSoon: !f.dueSoon }))} />
        </View>

        <View style={styles.modalActions}>
          <TouchableOpacity style={[styles.modalBtn, styles.secondary]} onPress={onClose}>
            <Text style={styles.modalBtnTextSecondary}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.modalBtn, styles.primary]} onPress={onApply}>
            <Text style={styles.modalBtnTextPrimary}>Apply</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function SortModal({ visible, onClose, sort, setSort, onApply }) {
  const FIELDS = [
    { label: 'Relevance', value: 'relevance' },
    { label: 'Updated', value: 'updated_at' },
    { label: 'Name', value: 'name' },
    { label: 'Service Due', value: 'service_due' },
    { label: 'Status', value: 'status' },
    { label: 'Type', value: 'type' },
    { label: 'Location', value: 'location' },
    { label: 'Assigned To', value: 'assigned_to' },
    { label: 'ID', value: 'id' },
  ];
  const DIRS = [{ label: 'Ascending', value: 'asc' }, { label: 'Descending', value: 'desc' }];

  const Row = ({ label, children }) => (
    <View style={styles.formRow}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );

  const ChipRow = ({ value, onChange, options }) => (
    <View style={styles.chipSelectRow}>
      {options.map(o => (
        <TouchableOpacity
          key={o.value}
          style={[styles.choiceChip, value === o.value && styles.choiceChipActive]}
          onPress={() => onChange(o.value)}
        >
          <Text style={[styles.choiceChipText, value === o.value && styles.choiceChipTextActive]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  // no presets

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={styles.modalSheet}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Sort</Text>
          <TouchableOpacity onPress={onClose}><Feather name="x" size={20} color={COLORS.text} /></TouchableOpacity>
        </View>

        

        <Row label="Sort by">
          <ChipRow value={sort.field} onChange={v => setSort(s => ({ ...s, field: v }))} options={FIELDS} />
        </Row>
        <Row label="Order">
          <ChipRow value={sort.dir} onChange={v => setSort(s => ({ ...s, dir: v }))} options={DIRS} />
        </Row>

        <View style={styles.switchRow}>
          <Toggle label="Nulls last" value={!!sort.nullsLast} onChange={() => setSort(s => ({ ...s, nullsLast: !s.nullsLast }))} />
        </View>

        <View style={styles.modalActions}>
          <TouchableOpacity style={[styles.modalBtn, styles.secondary]} onPress={onClose}>
            <Text style={styles.modalBtnTextSecondary}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.modalBtn, styles.primary]} onPress={onApply}>
            <Text style={styles.modalBtnTextPrimary}>Apply</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function ChipSelect({ value, onChange, options }) {
  return (
    <View style={styles.chipSelectRow}>
      {options.map(o => (
        <TouchableOpacity
          key={String(o.value)}
          style={[styles.choiceChip, value === o.value && styles.choiceChipActive]}
          onPress={() => onChange(o.value)}
        >
          <Text style={[styles.choiceChipText, value === o.value && styles.choiceChipTextActive]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <TouchableOpacity onPress={onChange} style={styles.toggleRow}>
      <View style={[styles.toggleBox, value && styles.toggleBoxOn]}>
        <View style={[styles.toggleKnob, value && styles.toggleKnobOn]} />
      </View>
      <Text style={styles.toggleLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function ListLoading() {
  return (
    <View style={{ paddingVertical: 16 }}>
      <ActivityIndicator color={COLORS.primary} />
    </View>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <View style={styles.centerState}>
      <Feather name="alert-triangle" size={28} color={COLORS.dangerFg} />
      <Text style={styles.centerTitle}>Something went wrong</Text>
      <Text style={styles.centerSub}>{message}</Text>
      <TouchableOpacity style={[styles.modalBtn, styles.primary, { marginTop: 12 }]} onPress={onRetry}>
        <Text style={styles.modalBtnTextPrimary}>Try again</Text>
      </TouchableOpacity>
    </View>
  );
}

function EmptyState() {
  return (
    <View style={styles.centerState}>
      <Ionicons name="search-outline" size={28} color={COLORS.sub2} />
      <Text style={styles.centerTitle}>No results yet</Text>
      <Text style={styles.centerSub}>
        Try adjusting keywords or filters.
      </Text>
    </View>
  );
}

// ---- tiny helpers ----
const truncate = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
const prettyStatus = (s) => {
  if (!s) return '—';
  const t = String(s).toLowerCase().replace(/[_-]+/g, ' ').trim();
  switch (t) {
    case 'available':
    case 'in service':
    case 'reserved':
      return 'In Service';
    case 'repair':
      return 'Repair';
    case 'maintenance':
    case 'checked out':
    case 'rented':
    case 'end of life':
    case 'lost':
    case 'retired':
      return 'End of Life';
    default:
      return s.charAt(0).toUpperCase() + s.slice(1);
  }
};
const statusToColor = (s) => {
  const base = { bg: '#F0F4F8', fg: COLORS.sub, bd: '#E6EDF3' };
  if (!s) return { bg: COLORS.primaryLight, fg: COLORS.primaryDark, bd: '#D6E8FF' };
  const t = String(s).toLowerCase().replace(/[_-]+/g, ' ').trim();
  switch (t) {
    case 'available':
    case 'in service':
    case 'reserved':
      return { bg: COLORS.primaryLight, fg: COLORS.primaryDark, bd: '#D6E8FF' };
    case 'repair':
      return { bg: '#FFE5E7', fg: '#C62828', bd: '#F8B7BE' };
    case 'maintenance':
    case 'checked out':
    case 'rented':
      return { bg: '#FFF9C4', fg: '#8D6E00', bd: '#FFF59D' };
    case 'end of life':
    case 'lost':
    case 'retired':
      return { bg: COLORS.dangerBg, fg: COLORS.dangerFg, bd: '#F9C7CD' };
    default:
      return base;
  }
};
const prettySortLabel = (s) => {
  const labelFor = {
    relevance: 'Relevance',
    updated_at: 'Updated',
    name: 'Name',
    service_due: 'Service Due',
    status: 'Status',
    type: 'Type',
    location: 'Location',
    assigned_to: 'Assigned To',
    id: 'ID',
  };
  const primary = `${labelFor[s.field] || s.field} · ${s.dir.toUpperCase()}`;
  return primary + (s.nullsLast ? ' · nulls last' : '');
};

// ---- styles ----
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.text },
  actions: { flexDirection: 'row', gap: 10 },
  iconBtn: {
    width: 38, height: 38, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.primaryLight, borderWidth: 1, borderColor: '#D6E8FF'
  },
  countDot: {
    position: 'absolute', right: -6, top: -6, backgroundColor: COLORS.primary,
    width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center'
  },
  countDotText: { color: 'white', fontSize: 11, fontWeight: '800' },

  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'white',
    marginHorizontal: 16, paddingHorizontal: 12, borderRadius: 12, height: 46,
    borderWidth: 1, borderColor: '#D6E8FF'
  },
  searchInput: { flex: 1, fontSize: 16, color: COLORS.text },

  quickRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 },
  quick: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: '#D6E8FF', borderRadius: 999, backgroundColor: 'white'
  },
  quickActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
  quickText: { fontSize: 13, color: COLORS.sub },

  metaBar: {
    paddingHorizontal: 16, paddingVertical: 8,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  metaBarText: { color: COLORS.sub, fontSize: 13 },
  sortBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    backgroundColor: COLORS.primaryLight, borderWidth: 1, borderColor: '#D6E8FF'
  },
  sortText: { fontSize: 13, color: COLORS.primaryDark, fontWeight: '700' },

  sectionTitle: { marginLeft: 16, marginBottom: 6, color: COLORS.text, fontWeight: '700' },
  chip: {
    marginHorizontal: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    backgroundColor: COLORS.primaryLight, borderWidth: 1, borderColor: '#D6E8FF'
  },
  chipText: { color: COLORS.primaryDark, fontWeight: '600' },

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
    borderWidth: 1, borderColor: '#E2EEFF'
  },
  metaText: { fontSize: 12, color: COLORS.sub },

  moreWrap: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#EDF4FF',
    gap: 8
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailLabel: { color: COLORS.sub, fontWeight: '600' },
  detailValue: { color: COLORS.text, fontWeight: '600', flexShrink: 1, textAlign: 'right', marginLeft: 12 },

  notesRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: '#F7FBFF', borderWidth: 1, borderColor: '#E2EEFF',
    padding: 8, borderRadius: 8
  },
  notesText: { color: COLORS.sub, flex: 1, lineHeight: 18 },

  cardRight: { marginLeft: 6, paddingTop: 2 },

  centerState: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 36 },
  centerTitle: { fontSize: 16, fontWeight: '800', color: COLORS.text, marginTop: 8 },
  centerSub: { color: COLORS.sub, textAlign: 'center', marginTop: 6 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  modalSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16,
    borderTopWidth: 1, borderColor: '#D6E8FF'
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  formRow: { marginVertical: 8 },
  label: { marginBottom: 6, color: COLORS.sub, fontWeight: '600' },
  input: {
    borderWidth: 1, borderColor: '#D6E8FF', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: Platform.select({ ios: 12, android: 10, default: 10 }),
    fontSize: 15, color: COLORS.text, backgroundColor: '#fff'
  },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 4 },
  chipSelectRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choiceChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    borderWidth: 1, borderColor: '#D6E8FF', backgroundColor: 'white'
  },
  choiceChipActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
  choiceChipText: { color: COLORS.sub },
  choiceChipTextActive: { color: COLORS.primaryDark, fontWeight: '700' },

  modalActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: COLORS.primary },
  secondary: { backgroundColor: '#F3F6FB' },
  modalBtnTextPrimary: { color: '#fff', fontWeight: '800' },
  modalBtnTextSecondary: { color: COLORS.text, fontWeight: '800' },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  toggleBox: { width: 52, height: 30, borderRadius: 999, backgroundColor: '#E6EEFB', padding: 3, borderWidth: 1, borderColor: '#D6E8FF' },
  toggleBoxOn: { backgroundColor: COLORS.primaryLight, borderColor: COLORS.primary },
  toggleKnob: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff' },
  toggleKnobOn: { marginLeft: 20, backgroundColor: '#fff', shadowColor: COLORS.primary, shadowOpacity: 0.2, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  toggleLabel: { color: COLORS.text, fontWeight: '600' },
});
