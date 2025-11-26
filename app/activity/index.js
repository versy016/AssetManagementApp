// app/activity/index.js - Unified activity feed
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Image, ActivityIndicator, TouchableOpacity, Platform, Modal, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import ScreenHeader from '../../components/ui/ScreenHeader';
import { Colors } from '../../constants/uiTheme';

export default function ActivityScreen() {
  const [rawItems, setRawItems] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [filters, setFilters] = useState({
    types: [], // e.g. ['TRANSFER','CHECK_IN'] (no CHECK_OUT/STATUS_CHANGE here)
    assetTypes: [], // e.g. ['Laptop','Camera']
    status: null, // 'in_service'|'repair'|'maintenance'|'end_of_life'
    dateRange: 'all', // 'all'|'24h'|'7d'|'30d'|'custom'
    dateFrom: '', // YYYY-MM-DD when dateRange==='custom'
    dateTo: '',   // YYYY-MM-DD when dateRange==='custom'
  });
  const [assetTypeOptions, setAssetTypeOptions] = useState([]); // [{id,name}]
  const [sort, setSort] = useState({ field: 'when', dir: 'desc' });
  const router = useRouter();

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE_URL}/activity?limit=100`);
        const j = await res.json();
        const arr = Array.isArray(j?.items) ? j.items : [];
        if (!cancel) { setRawItems(arr); }
      } catch {
        if (!cancel) { setRawItems([]); }
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, []);

  // Load asset types for filter chips
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/asset-types`);
        const j = await res.json();
        const list = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : Array.isArray(j?.items) ? j.items : [];
        if (!cancel) setAssetTypeOptions(list.map(t => ({ id: t.id, name: t.name })));
      } catch {
        if (!cancel) setAssetTypeOptions([]);
      }
    })();
    return () => { cancel = true; };
  }, []);

  // ---------- filtering & sorting ----------
  const activeFilterCount = useMemo(() => {
    return [
      filters.types && filters.types.length > 0,
      filters.assetTypes && filters.assetTypes.length > 0,
      !!filters.status,
      filters.dateRange && (filters.dateRange !== 'all'),
    ].filter(Boolean).length;
  }, [filters]);

  const normStatus = (s) => {
    const t = String(s || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
    const map = {
      'in service': 'in_service',
      available: 'in_service',
      reserved: 'in_service',
      'repair': 'repair',
      'maintenance': 'maintenance',
      'checked out': 'repair',
      rented: 'repair',
      'end of life': 'end_of_life',
      lost: 'end_of_life',
      retired: 'end_of_life',
    };
    return map[t] || t.replace(/\s+/g, '_');
  };

  const parseDateLike = (s) => {
    if (!s) return null;
    const str = String(s).trim();
    // DD/MM/YYYY
    const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) {
      const dd = Number(m[1]);
      const mm = Number(m[2]);
      const yy = Number(m[3]);
      const d = new Date(yy, mm - 1, dd);
      return Number.isNaN(+d) ? null : d;
    }
    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      const [y, m2, d2] = str.split('-').map(Number);
      const d = new Date(y, m2 - 1, d2);
      return Number.isNaN(+d) ? null : d;
    }
    const t = new Date(str);
    return Number.isNaN(+t) ? null : t;
  };

  const withinDateRange = (iso, range, from, to) => {
    if (!iso || !range || range === 'all') return true;
    try {
      const t = new Date(iso).getTime();
      if (Number.isNaN(t)) return true;
      if (range === 'custom') {
        let ok = true;
        if (from) {
          const fd = parseDateLike(from);
          const ft = fd ? fd.getTime() : NaN;
          if (!Number.isNaN(ft)) ok = ok && t >= ft;
        }
        if (to) {
          // include whole day for 'to'
          const dd = parseDateLike(to) || new Date(to);
          const dt = dd instanceof Date ? dd : new Date(dd);
          const et = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59, 999).getTime();
          if (!Number.isNaN(et)) ok = ok && t <= et;
        }
        return ok;
      }
      const now = Date.now();
      const day = 24 * 60 * 60 * 1000;
      const bounds = { '24h': now - day, '7d': now - 7 * day, '30d': now - 30 * day };
      const since = bounds[range];
      if (!since) return true;
      return t >= since;
    } catch { return true; }
  };

  const applyFilterSort = useMemo(() => {
    const typeSet = new Set((filters.types || []).map(String).map((v) => v.toUpperCase()));
    const assetTypeSet = new Set((filters.assetTypes || []).map((v) => String(v).toLowerCase()));
    return (list) => {
      let out = list.filter((it) => {
        // type filter (applies to action entries only)
        if (typeSet.size > 0) {
          const t = String(it.type || '').toUpperCase();
          if (!typeSet.has(t)) return false;
        }

        // asset type filter (by asset type name)
        if (assetTypeSet.size > 0) {
          const at = String(it?.asset?.type || '').toLowerCase();
          if (!at || !assetTypeSet.has(at)) return false;
        }

        // status filter (only meaningful for STATUS_CHANGE)
        if (filters.status) {
          if (String(it.type || '').toUpperCase() !== 'STATUS_CHANGE') return false;
          const newS = it?.data?.newStatus || it?.data?.status || it?.note || '';
          if (normStatus(newS) !== normStatus(filters.status)) return false;
        }

        // date range
        if (!withinDateRange(it.when, filters.dateRange, filters.dateFrom, filters.dateTo)) return false;

        return true;
      });

      // sorting
      const cmp = (a, b) => {
        const dir = sort.dir === 'asc' ? 1 : -1;
        const field = String(sort.field || 'when');
        const val = (x) => {
          switch (field) {
            case 'when': return new Date(x.when).getTime();
            case 'type': return String(x.type || '').toLowerCase();
            case 'assetType': return String(x?.asset?.type || '').toLowerCase();
            case 'actor': return String(x.actor || '').toLowerCase();
            default: return new Date(x.when).getTime();
          }
        };
        const av = val(a); const bv = val(b);
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        // tie-break by time desc
        const ad = new Date(a.when).getTime();
        const bd = new Date(b.when).getTime();
        if (ad < bd) return 1; if (ad > bd) return -1; return 0;
      };
      out.sort(cmp);
      return out;
    };
  }, [filters, sort]);

  useEffect(() => {
    setItems(applyFilterSort(rawItems));
  }, [rawItems, applyFilterSort]);

  const iconFor = (kind, type) => {
    if (kind === 'ASSET_TYPE_CREATED') return 'category';
    switch (String(type || '').toUpperCase()) {
      case 'ASSET_DELETED': return 'delete';
      case 'ASSET_EDIT': return 'edit';
      case 'NEW_ASSET': return 'add-circle-outline';
      case 'TRANSFER': return 'swap-horiz';
      case 'CHECK_IN': return 'assignment-turned-in';
      case 'CHECK_OUT': return 'assignment-return';
      case 'STATUS_CHANGE': return 'sync';
      case 'REPAIR': return 'build';
      case 'MAINTENANCE': return 'build-circle';
      case 'HIRE': return 'work-outline';
      case 'END_OF_LIFE': return 'block';
      case 'SERVICE_COMPLETE': return 'build-circle';
      case 'LOST': return 'help-outline';
      case 'STOLEN': return 'report';
      default: return 'event-note';
    }
  };

  const colorFor = (kind, type) => {
    if (kind === 'ASSET_TYPE_CREATED') return '#7C3AED';
    switch (String(type || '').toUpperCase()) {
      case 'ASSET_DELETED': return '#DC2626';
      case 'ASSET_EDIT': return '#0EA5E9';
      case 'NEW_ASSET': return '#10B981';
      case 'TRANSFER': return '#0B63CE';
      case 'CHECK_IN': return '#16A34A';
      case 'CHECK_OUT': return '#7C3AED';
      case 'STATUS_CHANGE': return '#EA580C';
      case 'REPAIR': return '#B45309';
      case 'MAINTENANCE': return '#6D28D9';
      case 'HIRE': return '#0369A1';
      case 'END_OF_LIFE': return '#7C3AED';
      case 'SERVICE_COMPLETE': return '#16A34A';
      case 'LOST': return '#9CA3AF';
      case 'STOLEN': return '#B91C1C';
      default: return '#64748B';
    }
  };

  const prettyWhen = (iso) => {
    try {
      const d = new Date(iso);
      if (Number.isNaN(+d)) return '';
      return new Intl.DateTimeFormat('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
      }).format(d).replace(/\u00A0/g, ' ').replace(',', '');
    } catch { return ''; }
  };

  const renderItem = ({ item }) => {
    const isEditNextService =
      item.kind === 'ASSET_ACTION' &&
      String(item.type || '').toUpperCase() === 'ASSET_EDIT' &&
      item.data &&
      Array.isArray(item.data.fields) &&
      item.data.fields.some((f) => String(f || '').toLowerCase().includes('next_service'));
    const effectiveType = isEditNextService ? 'SERVICE_COMPLETE' : item.type;

    const icon = iconFor(item.kind, effectiveType);
    const stroke = colorFor(item.kind, effectiveType);
    const thumb = item.asset?.image_url || item.image_url || null;
    const isAction = item.kind === 'ASSET_ACTION';
    const rawNoteText =
      (item?.data && item.data.user_note_text)
        ? item.data.user_note_text
        : (item.note || null);
    const noteText = isEditNextService
      ? 'Service completed; status set to In Service'
      : rawNoteText;

    const safeUser = (s) => {
      if (!s) return null;
      const str = String(s);
      const looksUid = /^(?:[A-Za-z0-9_-]{20,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(str);
      if (looksUid) return null;
      return str;
    };
    const fromName = safeUser(item.from) || 'Unassigned';
    const toName = safeUser(item.to) || 'Unassigned';

  const prettyTitle = (() => {
    const t = String(effectiveType || '').toUpperCase();
    if (item.kind === 'ASSET_TYPE_CREATED') return 'NEW ASSET TYPE';
    if (t === 'ASSET_DELETED') return 'DELETED';
    if (t === 'SERVICE_COMPLETE') return 'SERVICE COMPLETE';
    if (t === 'ASSET_EDIT') return 'EDIT';
    if (t === 'NEW_ASSET') return 'NEW ASSET';
    if (t === 'CHECK_IN') return 'TRANSFER TO OFFICE';
    return t.replace(/_/g, ' ');
  })();

    let subTop = '';
    if (item.kind === 'ASSET_TYPE_CREATED') {
      subTop = String(item.name || '').trim();
    } else if (isAction && String(item.type).toUpperCase() === 'TRANSFER') {
      subTop = `${fromName} → ${toName}`;
    } else if (isAction && String(item.type).toUpperCase() === 'CHECK_IN') {
      subTop = `From ${fromName}`;
    } else if (isAction && String(item.type).toUpperCase() === 'CHECK_OUT') {
      subTop = `To ${toName}`;
    } else {
      subTop = safeUser(item.actor) || '';
    }

    const assetId = item.asset?.id || '';
    const assetName = item.asset?.name || '';
    const assetTypeName = item.asset?.type || '';

    return (
      <TouchableOpacity
        activeOpacity={0.85}
        // onPress={() => assetId && router.push({ pathname: '/asset/[assetId]', params: { assetId } })}
        style={[styles.card, { borderLeftColor: stroke, borderLeftWidth: 4 }]}
      >
        <View style={styles.thumbWrap}>
          {thumb ? (
            <Image source={{ uri: thumb }} style={styles.thumb} />
          ) : (
            <View style={[styles.thumb, styles.thumbPlaceholder]}>
              <MaterialIcons name={icon} size={22} color="#1E40AF" />
            </View>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>{prettyTitle}</Text>
            {!!assetTypeName && (
              <View style={[styles.chip, styles.chipSoft]}><Text style={styles.chipText}>{assetTypeName}</Text></View>
            )}
          </View>
          {!!assetName && (
            <Text style={styles.assetName} numberOfLines={1}>{assetName}</Text>
          )}
          <View style={styles.metaRow}>
            {assetId ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Open asset ${assetId}`}
            onPress={() => router.push({
              pathname: '/asset/[assetId]',
              params: { assetId, returnTo: '/activity' },
            })}
                style={{ marginRight: 2 }}
              >
                <View style={styles.pill}><Text style={styles.pillText}>ID: {assetId}</Text></View>
              </TouchableOpacity>
            ) : null}
            {isAction && String(item.type).toUpperCase() === 'TRANSFER' ? (
              <View style={styles.transferRow}>
                <View style={[styles.chip, styles.chipPrimary]}><Text style={[styles.chipText, styles.chipTextStrong]} numberOfLines={1}>{fromName}</Text></View>
                <MaterialIcons name="east" size={16} color="#0B63CE" />
                <View style={[styles.chip, styles.chipPrimary]}><Text style={[styles.chipText, styles.chipTextStrong]} numberOfLines={1}>{toName}</Text></View>
              </View>
            ) : !!subTop ? (
              <View style={[styles.chip, styles.chipMuted]}><Text style={[styles.chipText, styles.chipTextStrong]} numberOfLines={1}>{subTop}</Text></View>
            ) : null}
          </View>
          {(noteText && !(isAction && String(item.type || '').toUpperCase() === 'TRANSFER')) ? (
            <View style={styles.noteRow}>
              <MaterialIcons name="notes" size={14} color="#64748B" />
              <Text style={styles.noteLine} numberOfLines={2}>{noteText}</Text>
            </View>
          ) : null}
          <Text style={styles.when}>{prettyWhen(item.when)}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader
        title="Activity"
        backLabel="Dashboard"
        onBack={() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace('/(tabs)/dashboard');
          }
        }}
      />
      <View style={styles.hero}>
        <Text style={styles.heroSub}>All asset actions, notes and changes</Text>
      </View>
      {/* Filters & sort bar */}
      <View style={styles.filterBar}>
        <TouchableOpacity style={styles.filterBtn} onPress={() => setFiltersOpen(true)}>
          <MaterialIcons name="tune" size={16} color="#0B63CE" />
          <Text style={styles.filterBtnText}>Filters</Text>
          {activeFilterCount > 0 ? (
            <View style={styles.badge}><Text style={styles.badgeText}>{activeFilterCount}</Text></View>
          ) : null}
        </TouchableOpacity>
        <TouchableOpacity style={styles.filterBtn} onPress={() => setSortOpen(true)}>
          <MaterialIcons name="sort" size={16} color="#0B63CE" />
          <Text style={styles.filterBtnText}>Sort</Text>
        </TouchableOpacity>
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => String(it.id) + String(it.when)}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
        />
      )}

      {/* Filters modal */}
      <FiltersModal
        visible={filtersOpen}
        filters={filters}
        setFilters={setFilters}
        assetTypeOptions={assetTypeOptions}
        onClose={() => setFiltersOpen(false)}
        onApply={() => setFiltersOpen(false)}
      />
      <SortModal
        visible={sortOpen}
        sort={sort}
        setSort={setSort}
        onClose={() => setSortOpen(false)}
        onApply={() => setSortOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F8FAFF' },
  hero: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 8, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#EEF2F7' },
  heroSub: { color: '#64748B' },
  filterBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E6EDF3' },
  filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#DBEAFE', backgroundColor: '#F1F5FF', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  filterBtnText: { color: '#0B63CE', fontWeight: '800' },
  badge: { marginLeft: 4, backgroundColor: '#0B63CE', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { color: '#fff', fontWeight: '900', fontSize: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: '#E6EDF3', borderRadius: 12, padding: 12,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 2 },
      default: {},
    }),
  },
  thumbWrap: { },
  thumb: { width: 52, height: 52, borderRadius: 8, backgroundColor: '#eef2ff', borderWidth: 1, borderColor: '#DBEAFE' },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: '#0F172A', fontWeight: '900', letterSpacing: 0.3, fontSize: 14 },
  strong: { fontWeight: '800', color: '#0B63CE' },
  assetName: { color: '#0F172A', fontWeight: '700', marginTop: 2 },
  sub: { color: '#334155' },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  noteLine: { color: '#475569', flex: 1 },
  when: { color: '#64748B', marginTop: 8, fontSize: 12 },
  pill: { borderWidth: 1, borderColor: '#DBEAFE', backgroundColor: '#F1F5FF', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  pillText: { color: '#1E40AF', fontWeight: '800', fontSize: 11 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  transferRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  chipText: { fontSize: 12, color: '#0F172A' },
  chipTextStrong: { fontWeight: '800' },
  chipPrimary: { backgroundColor: '#EAF2FF', borderWidth: 1, borderColor: '#DBEAFE' },
  chipMuted: { backgroundColor: '#F4F6FA', borderWidth: 1, borderColor: '#E6EDF3' },
  chipSoft: { backgroundColor: '#F1F5FF', borderWidth: 1, borderColor: '#DBEAFE' },
});

// --------- Modals and small UI helpers ---------
function FiltersModal({ visible, onClose, filters, setFilters, onApply, assetTypeOptions }) {
  const TYPE_OPTIONS = [
    { label: 'Deleted', value: 'ASSET_DELETED' },
    { label: 'Edit', value: 'ASSET_EDIT' },
    { label: 'Transfer', value: 'TRANSFER' },
    { label: 'Transfer In', value: 'CHECK_IN' }, // mapped from CHECK_IN events
    { label: 'Repair', value: 'REPAIR' },
    { label: 'Service / Maintenance', value: 'MAINTENANCE' },
    { label: 'Hire', value: 'HIRE' },
    { label: 'End of Life', value: 'END_OF_LIFE' },
    { label: 'Lost', value: 'LOST' },
    { label: 'Stolen', value: 'STOLEN' },
    { label: 'New asset', value: 'NEW_ASSET' },
    { label: 'Type Created', value: 'ASSET_TYPE' },
  ];
  const STATUS_OPTIONS = [
    { label: 'Any', value: null },
    { label: 'In Service', value: 'in_service' },
    { label: 'Repair', value: 'repair' },
    { label: 'Maintenance', value: 'maintenance' },
    { label: 'End of Life', value: 'end_of_life' },
  ];
  const DATE_OPTIONS = [
    { label: 'All', value: 'all' },
    { label: '24h', value: '24h' },
    { label: '7d', value: '7d' },
    { label: '30d', value: '30d' },
    { label: 'Custom', value: 'custom' },
  ];

  const toggleType = (val) => {
    setFilters((f) => {
      const set = new Set(f.types || []);
      if (set.has(val)) set.delete(val); else set.add(val);
      return { ...f, types: Array.from(set) };
    });
  };

  const setStatus = (val) => setFilters((f) => ({ ...f, status: val }));
  const setDate = (val) => setFilters((f) => ({ ...f, dateRange: val }));
  const toggleAssetType = (name) => setFilters((f) => {
    const set = new Set(f.assetTypes || []);
    const key = String(name || '').trim();
    if (!key) return f;
    if (set.has(key)) set.delete(key); else set.add(key);
    return { ...f, assetTypes: Array.from(set) };
  });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={mStyles.backdrop} onPress={onClose} />
      <View style={mStyles.sheet}>
        <View style={mStyles.header}>
          <Text style={mStyles.title}>Filters</Text>
          <TouchableOpacity onPress={onClose}><MaterialIcons name="close" size={20} color="#0F172A" /></TouchableOpacity>
        </View>

        <Text style={mStyles.label}>Types</Text>
        <View style={mStyles.row}>
          {TYPE_OPTIONS.map((o) => {
            const active = (filters.types || []).includes(o.value);
            return (
              <TouchableOpacity key={o.value} onPress={() => toggleType(o.value)} style={[mStyles.chip, active && mStyles.chipActive]}>
                <Text style={[mStyles.chipText, active && mStyles.chipTextActive]}>{o.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={mStyles.label}>Asset Type</Text>
        <View style={mStyles.row}>
          {(assetTypeOptions || []).map((t) => {
            const active = (filters.assetTypes || []).includes(t.name);
            return (
              <TouchableOpacity key={t.id} onPress={() => toggleAssetType(t.name)} style={[mStyles.chip, active && mStyles.chipActive]}>
                <Text style={[mStyles.chipText, active && mStyles.chipTextActive]}>{t.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={mStyles.label}>Status</Text>
        <View style={mStyles.row}>
          {STATUS_OPTIONS.map((o) => {
            const active = filters.status === o.value;
            return (
              <TouchableOpacity key={String(o.value)} onPress={() => setStatus(o.value)} style={[mStyles.chip, active && mStyles.chipActive]}>
                <Text style={[mStyles.chipText, active && mStyles.chipTextActive]}>{o.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={mStyles.label}>Date range</Text>
        <View style={mStyles.row}>
          {DATE_OPTIONS.map((o) => {
            const active = filters.dateRange === o.value;
            return (
              <TouchableOpacity key={o.value} onPress={() => setDate(o.value)} style={[mStyles.chip, active && mStyles.chipActive]}>
                <Text style={[mStyles.chipText, active && mStyles.chipTextActive]}>{o.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {filters.dateRange === 'custom' && (
          <View style={[mStyles.row, { gap: 8 }] }>
            <View style={{ flex: 1 }}>
              <Text style={mStyles.smallLabel}>From (DD/MM/YYYY)</Text>
              <TextInput
                placeholder="DD/MM/YYYY"
                value={filters.dateFrom}
                onChangeText={(v) => {
                  const digits = String(v).replace(/\D/g, '').slice(0, 8);
                  let out = digits;
                  if (digits.length > 2) out = `${digits.slice(0,2)}/${digits.slice(2,4)}`;
                  if (digits.length > 4) out = `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4,8)}`;
                  setFilters((f) => ({ ...f, dateFrom: out }));
                }}
                keyboardType={Platform.OS === 'web' ? 'default' : 'number-pad'}
                style={mStyles.input}
                autoCapitalize="none"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={mStyles.smallLabel}>To (DD/MM/YYYY)</Text>
              <TextInput
                placeholder="DD/MM/YYYY"
                value={filters.dateTo}
                onChangeText={(v) => {
                  const digits = String(v).replace(/\D/g, '').slice(0, 8);
                  let out = digits;
                  if (digits.length > 2) out = `${digits.slice(0,2)}/${digits.slice(2,4)}`;
                  if (digits.length > 4) out = `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4,8)}`;
                  setFilters((f) => ({ ...f, dateTo: out }));
                }}
                keyboardType={Platform.OS === 'web' ? 'default' : 'number-pad'}
                style={mStyles.input}
                autoCapitalize="none"
              />
            </View>
          </View>
        )}

        <View style={mStyles.actions}>
          <TouchableOpacity onPress={onClose} style={[mStyles.btn, mStyles.secondary]}>
            <Text style={mStyles.btnSecondaryText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onApply} style={[mStyles.btn, mStyles.primary]}>
            <Text style={mStyles.btnPrimaryText}>Apply</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function SortModal({ visible, onClose, sort, setSort, onApply }) {
  const FIELDS = [
    { label: 'Time', value: 'when' },
    { label: 'Type', value: 'type' },
    { label: 'Asset type', value: 'assetType' },
    { label: 'Actor', value: 'actor' },
  ];
  const DIRS = [
    { label: 'Asc', value: 'asc' },
    { label: 'Desc', value: 'desc' },
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={mStyles.backdrop} onPress={onClose} />
      <View style={mStyles.sheet}>
        <View style={mStyles.header}>
          <Text style={mStyles.title}>Sort</Text>
          <TouchableOpacity onPress={onClose}><MaterialIcons name="close" size={20} color="#0F172A" /></TouchableOpacity>
        </View>

        <Text style={mStyles.label}>Field</Text>
        <View style={mStyles.row}>
          {FIELDS.map((o) => {
            const active = sort.field === o.value;
            return (
              <TouchableOpacity key={o.value} onPress={() => setSort((s) => ({ ...s, field: o.value }))} style={[mStyles.chip, active && mStyles.chipActive]}>
                <Text style={[mStyles.chipText, active && mStyles.chipTextActive]}>{o.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={mStyles.label}>Direction</Text>
        <View style={mStyles.row}>
          {DIRS.map((o) => {
            const active = sort.dir === o.value;
            return (
              <TouchableOpacity key={o.value} onPress={() => setSort((s) => ({ ...s, dir: o.value }))} style={[mStyles.chip, active && mStyles.chipActive]}>
                <Text style={[mStyles.chipText, active && mStyles.chipTextActive]}>{o.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={mStyles.actions}>
          <TouchableOpacity onPress={onClose} style={[mStyles.btn, mStyles.secondary]}>
            <Text style={mStyles.btnSecondaryText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onApply} style={[mStyles.btn, mStyles.primary]}>
            <Text style={mStyles.btnPrimaryText}>Apply</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const mStyles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.2)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#FFFFFF', borderTopLeftRadius: 14, borderTopRightRadius: 14, padding: 16, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#0F172A', fontWeight: '900', fontSize: 18 },
  label: { color: '#334155', fontWeight: '800', marginTop: 6, marginBottom: 6 },
  smallLabel: { color: '#475569', fontWeight: '700', marginBottom: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: '#DBEAFE', backgroundColor: '#F1F5FF' },
  chipActive: { backgroundColor: '#0B63CE', borderColor: '#084AA0' },
  chipText: { color: '#0B63CE', fontWeight: '800' },
  chipTextActive: { color: '#FFFFFF', fontWeight: '900' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  toggle: { width: 44, height: 26, borderRadius: 14, backgroundColor: '#E6EDF3', justifyContent: 'center', padding: 3 },
  toggleOn: { backgroundColor: '#0B63CE' },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF', transform: [{ translateX: 0 }] },
  knobOn: { transform: [{ translateX: 18 }] },
  toggleLabel: { color: '#0F172A', fontWeight: '700' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 8 },
  btn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  primary: { backgroundColor: '#0B63CE', borderColor: '#084AA0' },
  secondary: { backgroundColor: '#FFFFFF', borderColor: '#CBD5E1' },
  btnPrimaryText: { color: '#FFFFFF', fontWeight: '900' },
  btnSecondaryText: { color: '#0F172A', fontWeight: '800' },
  input: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: Platform.OS === 'web' ? 8 : 6 },
});
