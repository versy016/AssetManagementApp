// components/CertsView.js (restored with fixes)
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform, TextInput, Alert, Modal, Linking, useWindowDimensions, InteractionManager } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
// import { DatePickerModal } from 'react-native-paper-dates';
// import { en, registerTranslation } from 'react-native-paper-dates';
import PropTypes from 'prop-types';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { API_BASE_URL } from '../inventory-api/apiBase';
import { formatDisplayDate } from '../utils/date';
import { Colors } from '../constants/uiTheme';
import { auth } from '../firebaseConfig';
import Chip from './ui/Chip';
import InlineButton from './ui/InlineButton';
import SearchInput from './ui/SearchInput';
import ScreenHeader from './ui/ScreenHeader';

const openDocumentLink = (url) => {
  if (!url) return;
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener');
    } else {
      Linking.openURL(url);
    }
  } catch (error) {
    console.error('Error opening document link:', error);
  }
};

// Ensure date translations are registered once at module load
// try {
//   registerTranslation('en', en);
// } catch (error) {
//   console.warn('Failed to register date translation:', error);
// }

export default function CertsView({ visible: initialVisible }) {
  // All hooks must be called unconditionally at the top level
  const [state, setState] = useState(() => ({ items: [], loading: false, error: null }));
  const [assetMap, setAssetMap] = useState({});
  const [refreshKey, setRefreshKey] = useState(0);
  const contentRef = useRef(null);
  const [hContentW, setHContentW] = useState(0);
  const [hViewportW, setHViewportW] = useState(0);
  const [filterText, setFilterText] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterAssigned, setFilterAssigned] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [editDate, setEditDate] = useState('');
  const [editFile, setEditFile] = useState(null);
  const [editBusy, setEditBusy] = useState(false);
  const [docOptional, setDocOptional] = useState(null);
  const [editDateOpen, setEditDateOpen] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [filterDoc, setFilterDoc] = useState('');
  const [filterExp, setFilterExp] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [filterStartOpen, setFilterStartOpen] = useState(false);
  const [filterEndOpen, setFilterEndOpen] = useState(false);
  const [filterRange, setFilterRange] = useState({ start: '', end: '' });
  const [me, setMe] = useState({ uid: null, email: null });
  const [hoverRowId, setHoverRowId] = useState(null);
  const [renderReady, setRenderReady] = useState(Platform.OS === 'web');

  // Use useWindowDimensions hook
  const { width: screenWidth } = useWindowDimensions();

  const isCompact = Platform.OS === 'web' ? (screenWidth < 1024) : true;
  const isNative = Platform.OS !== 'web';
  const docCount = Array.isArray(state.items) ? state.items.length : 0;
  const isWeb = Platform.OS === 'web';
  const enrichAssets = isWeb || docCount <= 200;

  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);


  // Determine if we should render anything based on visibility
  const shouldRender = initialVisible && state !== null && renderReady;

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const task = InteractionManager.runAfterInteractions(() => setRenderReady(true));
    return () => task.cancel();
  }, []);

  useEffect(() => {
    if (!initialVisible) return undefined;
    let cancelled = false;

    const fetchData = async () => {
      try {
        setState(prev => ({ ...prev, loading: true, error: null }));
        const res = await fetch(`${API_BASE_URL}/asset-documents/documents`);
        const j = await res.json().catch(() => ({}));
        const list = Array.isArray(j?.items) ? j.items : Array.isArray(j) ? j : [];

        if (!cancelled) {
          const trimmed = list.slice(0, 300);
          setState({ items: trimmed, loading: false, error: null });
        }
      } catch (e) {
        if (!cancelled) {
          setState({ items: [], loading: false, error: e?.message || 'Failed to load documents' });
        }
      }
    };

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [initialVisible, refreshKey]);

  // Load current user for filter chips
  useEffect(() => {
    try {
      const u = auth?.currentUser || null;
      const email = u?.email ? String(u.email).toLowerCase() : null;
      setMe({ uid: u?.uid || null, email });
    } catch (error) {
      console.error('Error loading current user:', error);
    }
  }, []);

  // Enrich with asset details (type, model, assigned user). Fetch unique IDs once per load.
  useEffect(() => {
    if (!initialVisible) return undefined;
    if (!enrichAssets) {
      setAssetMap({});
      return undefined;
    }
    const ids = Array.from(new Set((state.items || []).map((d) => d?.asset_id).filter(Boolean)));
    if (!ids.length) { setAssetMap({}); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const results = await Promise.allSettled(ids.map(async (id) => {
          try {
            const r = await fetch(`${API_BASE_URL}/assets/${encodeURIComponent(id)}`);
            if (!r.ok) return [id, null];
            const a = await r.json();
            return [id, a];
          } catch { return [id, null]; }
        }));
        if (cancelled) return;
        const map = {};
        results.forEach((res) => {
          if (res.status === 'fulfilled') {
            const [id, a] = res.value || [];
            if (id) map[id] = a || null;
          }
        });
        setAssetMap(map);
      } catch { setAssetMap({}); }
    })();
    return () => { cancelled = true; };
  }, [initialVisible, state.items, enrichAssets]);

  const rows = useMemo(() => {
    if (!state.items) return [];
    const items = Array.isArray(state.items) ? state.items : [];
    // Normalize and dedupe by assetId+url; prefer those with a related_date
    const best = new Map();
    for (const d of items) {
      if (!d || !d.url || !d.asset_id) continue;
      const key = `${d.asset_id}|${d.url}`;
      const better = (a, b) => {
        const aHas = a?.related_date ? 1 : 0;
        const bHas = b?.related_date ? 1 : 0;
        if (aHas !== bHas) return aHas - bHas; // prefer has date
        // otherwise prefer newer created_at
        const at = new Date(a?.created_at || 0).getTime();
        const bt = new Date(b?.created_at || 0).getTime();
        return (at - bt);
      };
      const prev = best.get(key);
      if (!prev || better(d, prev) > 0) best.set(key, d);
    }
    const toTitle = (s) => {
      try {
        const txt = String(s || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
        return txt.split(' ').map((w) => (w ? (w[0].toUpperCase() + w.slice(1)) : '')).join(' ');
      } catch { return String(s || ''); }
    };
    const arr = Array.from(best.values()).map((d, idx) => {
      const a = enrichAssets ? (assetMap[d.asset_id] || {}) : {};
      const assignedUser = enrichAssets ? (a?.users || null) : null;
      const assignedName = assignedUser?.name || '';
      const assignedEmail = assignedUser?.useremail || assignedUser?.email || '';
      const assignedId = assignedUser?.id || a?.assigned_to_id || null;
      const assigned = assignedName || assignedEmail || a?.assigned_to || '';
      const model = enrichAssets ? (a?.model || (a?.fields && (a.fields.model || a.fields.Model)) || '') : '';
      const typeName = enrichAssets ? (a?.asset_types?.name || a?.type || a?.asset_type || '') : '';
      const entry = ({
        id: d.id || String(idx),
        assetId: d.asset_id,
        docLabel: toTitle(d.title || d.kind || 'Document'),
        dateLabel: d.related_date_label || '',
        dateValue: d.related_date || null,
        docUrl: d.url,
        createdAt: d.created_at || null,
        updatedAt: d.updated_at || d.created_at || null,
        assigned,
        assignedEmail,
        assignedId,
        model,
        typeName,
        asset_type_field_id: d.asset_type_field_id || null,
      });
      const needsFile = /service report|repair report/i.test(entry.docLabel || '');
      if (needsFile && !entry.docUrl) {
        return null;
      }
      return entry;
    }).filter(Boolean);
    // Sort by date desc, then createdAt desc
    arr.sort((a, b) => {
      const ad = a.dateValue ? new Date(a.dateValue).getTime() : 0;
      const bd = b.dateValue ? new Date(b.dateValue).getTime() : 0;
      if (bd !== ad) return bd - ad;
      const ac = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bc = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bc - ac;
    });
    return arr;
  }, [state.items, assetMap]);

  // Show only the most recent document per asset + (field or label) by default.
  // When the user selects the Expired filter, we will switch to the full rows list
  // so older/expired documents become visible.
  const latestRows = useMemo(() => {
    if (!rows || !Array.isArray(rows) || rows.length === 0) return [];
    const map = new Map();
    const keyOf = (r) => {
      const id = String(r.assetId || '');
      const k = r.asset_type_field_id ? String(r.asset_type_field_id) : String(r.docLabel || '').toLowerCase().replace(/\s+/g, '_');
      return `${id}|${k}`;
    };
    const newer = (a, b) => {
      // pick latest by related date, then by createdAt
      const ad = a?.dateValue ? new Date(a.dateValue).getTime() : 0;
      const bd = b?.dateValue ? new Date(b.dateValue).getTime() : 0;
      if (ad !== bd) return ad - bd;
      const ac = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bc = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
      return ac - bc;
    };
    for (const r of rows) {
      if (!r) continue;
      const k = keyOf(r);
      const prev = map.get(k);
      if (!prev || newer(r, prev) > 0) map.set(k, r);
    }
    return Array.from(map.values());
  }, [rows]);

  // Options for quick filters
  const filterOptions = useMemo(() => {
    const typeSet = new Set();
    const assignedSet = new Set();
    const docSet = new Set();
    rows.forEach((r) => {
      if (r.typeName) typeSet.add(r.typeName);
      if (r.assigned) assignedSet.add(r.assigned);
      if (r.docLabel) docSet.add(r.docLabel);
    });
    return {
      types: Array.from(typeSet).sort(),
      assigned: Array.from(assignedSet).sort(),
      docs: Array.from(docSet).sort(),
    };
  }, [rows]);

  const filteredRows = useMemo(() => {
    try {
    // Only show latest per group by default; when Status=Expired is selected,
    // use the full dataset so older/expired docs are visible. Also allow explicit toggle.
      const base = (showHistory || filterExp === 'expired') ? (rows || []) : (latestRows || []);
      if (!Array.isArray(base)) return [];
    const q = filterText.trim().toLowerCase();
    const within30 = (iso) => {
      try {
        if (!iso) return false;
        const d = new Date(iso);
        if (Number.isNaN(+d)) return false;
        const now = new Date();
        const diff = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
        return diff <= 30;
      } catch { return false; }
    };
    return base.filter((r) => {
        if (!r || typeof r !== 'object') return false;
      if (filterType && r.typeName !== filterType) return false;
      if (filterAssigned && r.assigned !== filterAssigned) return false;
      if (onlyMine) {
        const assigneeId = String(r.assignedId || '').toLowerCase();
        const assigneeEmail = String(r.assignedEmail || '').toLowerCase();
        const assigneeDisplay = String(r.assigned || '').toLowerCase();
        const myUid = me.uid ? String(me.uid).toLowerCase() : '';
        const myEmail = me.email || '';
        const matchesId = myUid && assigneeId && assigneeId === myUid;
        const matchesEmail = myEmail && (assigneeEmail ? assigneeEmail === myEmail : assigneeDisplay.includes(myEmail));
        if (!(matchesId || matchesEmail)) return false;
      }
      if (filterDoc && r.docLabel !== filterDoc) return false;
      // Date range filter
      if ((filterRange.start || filterRange.end)) {
        if (!r.dateValue) return false;
        const d = new Date(r.dateValue);
        if (Number.isNaN(+d)) return false;
        if (filterRange.start) { const s = new Date(filterRange.start); if (d < s) return false; }
        if (filterRange.end) { const e = new Date(filterRange.end); if (d > e) return false; }
      }
      // Expiring status
      if (filterExp) {
        const dIso = r.dateValue; if (!dIso) return false;
        const d = new Date(dIso); if (Number.isNaN(+d)) return false;
        const now = new Date(); now.setHours(0, 0, 0, 0);
        const diff = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
        if (filterExp === 'expired' && !(d < now)) return false;
        if (filterExp === 'soon' && !(diff >= 0 && diff <= 30)) return false;
      }
      if (!q) return true;
      const hay = [r.assetId, r.typeName, r.model, r.assigned, r.docLabel, r.dateLabel, r.docUrl]
        .filter(Boolean)
        .join(' \u0001 ')
        .toLowerCase();
      return hay.includes(q);
    });
    } catch (error) {
      console.error('Error filtering rows:', error);
      return [];
    }
  }, [rows, latestRows, filterText, filterType, filterAssigned, onlyMine, me.email, filterDoc, filterRange.start, filterRange.end, filterExp, showHistory]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [filterText, filterType, filterAssigned, onlyMine, filterDoc, filterRange, filterExp, showHistory]);


  // Ensure filteredRows is always an array
  const safeFilteredRows = useMemo(() => {
    try {
      return Array.isArray(filteredRows) ? filteredRows : [];
    } catch (error) {
      console.error('Error getting filtered rows:', error);
      return [];
    }
  }, [filteredRows]);

  // Paginated rows
  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return safeFilteredRows.slice(start, start + pageSize);
  }, [safeFilteredRows, page, pageSize]);

  const totalPages = Math.ceil(safeFilteredRows.length / pageSize);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filterDoc) count += 1;
    if (filterRange.start) count += 1;
    if (filterRange.end) count += 1;
    if (filterExp) count += 1;
    if (onlyMine) count += 1;
    return count;
  }, [filterDoc, filterRange.start, filterRange.end, filterExp, onlyMine]);

  const actionsNode = (
    <>
      <TouchableOpacity style={styles.iconBtn} onPress={() => setFilterOpen(true)}>
        <View style={{ position: 'relative' }}>
          <Feather name="sliders" size={18} color={Colors.primary} />
          {activeFilterCount > 0 && (
            <View style={styles.countDot}>
              <Text style={styles.countDotText}>{Math.min(activeFilterCount, 9)}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
      <TouchableOpacity style={styles.iconBtn} onPress={() => setRefreshKey((v) => v + 1)}>
        <Feather name="refresh-ccw" size={18} color={Colors.primary} />
      </TouchableOpacity>
    </>
  );



  // Date helpers for modal
  const toISO = (d) => {
    try {
      const dt = d instanceof Date ? d : new Date(d);
      if (Number.isNaN(+dt)) return '';
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const day = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    } catch { return ''; }
  };
  const addMonthsSafe = (dateString, months) => {
    try {
      const base = dateString ? new Date(dateString) : new Date();
      const a = new Date(base.getFullYear(), base.getMonth(), base.getDate());
      const target = new Date(a.getFullYear(), a.getMonth() + months, 1);
      const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      target.setDate(Math.min(a.getDate(), last));
      return toISO(target);
    } catch { return dateString || ''; }
  };

  const renderEditModal = () => (
      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit Certificate</Text>
            {!!editRow && (
              <>
                <Text style={styles.modalLabel}>Document Type</Text>
                <Text style={styles.modalValue}>{editRow.docLabel}</Text>

                <View style={{ marginTop: 8 }}>
                  <Text style={styles.modalLabel}>Current Document</Text>
                  {editRow.docUrl ? (
                    <TouchableOpacity onPress={() => openDocumentLink(editRow.docUrl)} style={[styles.inlineBtn, { marginTop: 6, alignSelf: 'flex-start' }]}>
                      <MaterialIcons name="open-in-new" size={16} color={Colors.primary} />
                      <Text style={styles.inlineBtnText}>Open</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={{ color: '#64748B', marginTop: 6 }}>No file attached</Text>
                  )}
                </View>

                <Text style={[styles.modalLabel, { marginTop: 12 }]}>Related Date</Text>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 6 }}>
                  <TouchableOpacity style={[styles.inputLike, { flex: 1 }]} onPress={() => setEditDateOpen(true)}>
                    <Text style={styles.inputLikeText}>{editDate ? formatDisplayDate(editDate) : 'Select date'}</Text>
                  </TouchableOpacity>
                  {!!editDate && (
                    <TouchableOpacity style={[styles.btn, { backgroundColor: '#fdecea' }]} onPress={() => setEditDate('')}>
                      <Text style={{ color: '#b00020' }}>Clear</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.quickDateRow}>
                  <TouchableOpacity onPress={() => setEditDate(addMonthsSafe(editDate, 3))} style={styles.quickDateChip}><Text style={styles.quickDateChipText}>+3 months</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => setEditDate(addMonthsSafe(editDate, 6))} style={styles.quickDateChip}><Text style={styles.quickDateChipText}>+6 months</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => setEditDate(addMonthsSafe(editDate, 12))} style={styles.quickDateChip}><Text style={styles.quickDateChipText}>+12 months</Text></TouchableOpacity>
                </View>

                <Text style={[styles.modalLabel, { marginTop: 12 }]}>Upload New Document (optional)</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={styles.btn}
                    onPress={async () => {
                      try {
                        const res = await DocumentPicker.getDocumentAsync({
                          multiple: false, type: [
                            'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/*'
                          ]
                        });
                        if (res.canceled) return; const a = res.assets?.[0]; if (!a) return;
                        setEditFile(a);
                      } catch (e) {
                        Alert.alert('Error', e?.message || 'Failed to select file');
                      }
                    }}
                  >
                    <Text>{editFile ? 'Replace Selected' : 'Choose File'}</Text>
                  </TouchableOpacity>
                  {editFile ? (
                    <TouchableOpacity style={[styles.btn, { backgroundColor: '#fdecea' }]} onPress={() => setEditFile(null)}>
                      <Text style={{ color: '#b00020' }}>Remove</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                {!!editFile && <Text style={{ marginTop: 6, fontStyle: 'italic' }}>{editFile.name}</Text>}
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                  <TouchableOpacity disabled={editBusy} style={[styles.btn, styles.btnGhost, { flex: 1, opacity: editBusy ? 0.6 : 1 }]} onPress={() => setEditOpen(false)}>
                    <Text>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity disabled={editBusy} style={[styles.btn, styles.btnPrimary, { flex: 1, opacity: editBusy ? 0.6 : 1 }]} onPress={async () => {
                    if (!editRow) return; const assetId = editRow.assetId; const docId = editRow.id; const fieldId = editRow.asset_type_field_id;
                    const toTitle = (s) => { const txt = String(s || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim(); return txt.split(' ').map(w => w ? (w[0].toUpperCase() + w.slice(1)) : '').join(' '); };
                    const niceName = toTitle(editRow.docLabel);
                    const prevHadFile = !!editRow.docUrl;
                    try {
                      setEditBusy(true);
                      if (docOptional === null && fieldId && assetMap[assetId]) {
                        try {
                          const typeId = assetMap[assetId]?.type_id || assetMap[assetId]?.asset_types?.id;
                          if (typeId) {
                            const r = await fetch(`${API_BASE_URL}/assets/asset-types/${typeId}/fields`);
                            const defs = await r.json();
                            const def = (Array.isArray(defs) ? defs : []).find(d => String(d.id) === String(fieldId));
                            setDocOptional(def ? !def.is_required : null);
                          }
                        } catch { }
                      }

                      if (!editFile && prevHadFile && (docOptional === true)) {
                      const ok = Platform.OS === 'web'
                        ? window.confirm('You are updating the date without replacing the existing file. Continue?')
                        : await new Promise((res) => Alert.alert('Confirm', 'Update date without replacing the existing file?', [
                          { text: 'Cancel', style: 'cancel', onPress: () => res(false) },
                          { text: 'Continue', onPress: () => res(true) },
                        ]));
                        if (!ok) { setEditBusy(false); return; }
                      }

                      if (editFile) {
                        const fd = new FormData();
                        if (Platform.OS === 'web') {
                          try { const resp = await fetch(editFile.uri); const blob = await resp.blob(); const file = new File([blob], editFile.name || 'document.pdf', { type: editFile.mimeType || blob.type || 'application/pdf' }); fd.append('file', file, file.name); }
                          catch { fd.append('file', { uri: editFile.uri, name: editFile.name || 'document.pdf', type: editFile.mimeType || 'application/pdf' }); }
                        } else {
                          fd.append('file', { uri: editFile.uri, name: editFile.name || 'document.pdf', type: editFile.mimeType || 'application/pdf' });
                        }
                        if (fieldId) fd.append('asset_type_field_id', String(fieldId));
                        fd.append('title', niceName); fd.append('kind', niceName);
                        if (editRow.dateLabel) fd.append('related_date_label', editRow.dateLabel);
                        if (editDate) fd.append('related_date', String(editDate));
                        const up = await fetch(`${API_BASE_URL}/assets/${assetId}/documents/upload`, { method: 'POST', body: fd });
                        if (!up.ok) throw new Error(await up.text());
                        try { await fetch(`${API_BASE_URL}/assets/${assetId}/documents/${docId}`, { method: 'DELETE' }); } catch { }
                      } else {
                        const body = {};
                        if (editRow.dateLabel) body.related_date_label = editRow.dateLabel;
                        if (editDate) body.related_date = editDate; else body.related_date = null;
                        const pr = await fetch(`${API_BASE_URL}/assets/${assetId}/documents/${docId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                        if (!pr.ok) throw new Error(await pr.text());
                      }
                      setEditOpen(false);
                      setEditFile(null);
                      setRefreshKey((x) => x + 1);
                    } catch (e) {
                      Alert.alert('Error', e?.message || 'Failed to update document');
                    } finally {
                      setEditBusy(false);
                    }
                  }}>
                    <Text style={{ color: '#fff', fontWeight: '700' }}>{editBusy ? 'Saving…' : 'Save'}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
  );

  // Palette via centralized tokens

  const columns = [
    { key: 'asset', label: 'Asset ID', width: 140 },
    { key: 'type', label: 'Asset Type', width: 180 },
    // Make these flexible to fill remaining space like search table
    { key: 'model', label: 'Model', flex: 1, minWidth: 160 },
    { key: 'assigned', label: 'Assigned To', flex: 1, minWidth: 200 },
    { key: 'doc', label: 'Document Type', flex: 2, minWidth: 260 },
    { key: 'date', label: 'Related Date', width: 200 },
    { key: 'updated', label: 'Last Updated', width: 180 },
    { key: 'actions', label: 'Actions', width: 180 },
  ];

  const computedWidths = useMemo(() => {
    const map = {};
    const pad = 24; // rough gutter/padding like search
    const base = columns.reduce((sum, c) => sum + (c.flex ? (c.minWidth || 120) : (c.width || 120)), 0);
    const totalFlex = columns.reduce((sum, c) => sum + (c.flex || 0), 0);
    const avail = Math.max(0, (hViewportW || 0) - pad);
    const extra = Math.max(0, avail - base);
    columns.forEach((c) => {
      if (c.flex) {
        const share = totalFlex > 0 ? (extra * (c.flex / totalFlex)) : 0;
        map[c.key] = Math.round((c.minWidth || 120) + share);
      } else {
        map[c.key] = c.width || 120;
      }
    });
    return map;
  }, [columns, hViewportW]);

  // Early return if not visible
  if (!renderReady) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!shouldRender) {
    return null;
  }

  // Handle loading and error states
  if (state.loading) {
    return (
      <View style={styles.certsWrap}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (state.error) {
    return (
      <View style={styles.certsWrap}>
        <Text style={styles.sectionTitle}>Certificates & Documents</Text>
        <Text style={styles.errorText}>{String(state.error || 'An error occurred')}</Text>
        <TouchableOpacity
          style={[styles.btn]}
          onPress={() => setRefreshKey((x) => x + 1)}
        >
          <MaterialIcons name="refresh" size={18} color={Colors.primaryDark} />
          <Text style={{ marginLeft: 6, color: Colors.primaryDark, fontWeight: '700' }}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Don't return early if we have rows - let the filtered view handle empty state
  // This allows filters to work even when all items are filtered out

  return (
    <View style={[styles.certsWrap, (Platform.OS !== 'web' || isCompact) && styles.certsWrapMobile]}>
      {isNative && (
        <ScreenHeader
          title="Certificates"
          backLabel="Dashboard"
          onBack={() => {
            try {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/(tabs)/dashboard');
              }
            } catch {
              router.replace('/(tabs)/dashboard');
            }
          }}
          style={{ marginBottom: 4 }}
        />
      )}
      {/* Top surface like Search */}
      <View style={styles.toolbarSurface}>
        <View style={styles.toolbarRow}>
          <SearchInput
            placeholder="Search by asset, type, model, assigned…"
            value={filterText}
            onChangeText={setFilterText}
            style={{ flex: 1 }}
            inputStyle={{ fontSize: 16 }}
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {actionsNode}
              </View>
            }
          />
        </View>
        {/* My documents quick chip under search */}
        <View style={[styles.quickRow, { marginTop: 8 }]}>
          <Chip label="My documents" icon="user" active={onlyMine} onPress={() => setOnlyMine((v) => !v)} />
          <Chip label="Expiring soon" tone="warning" active={filterExp === 'soon'} onPress={() => setFilterExp((prev) => (prev === 'soon' ? '' : 'soon'))} />
          <Chip label="Expired" tone="danger" active={filterExp === 'expired'} onPress={() => setFilterExp((prev) => (prev === 'expired' ? '' : 'expired'))} />
        </View>
      </View>
      {renderEditModal()}
      {/* <DatePickerModal
        locale="en"
        mode="single"
        visible={editDateOpen}
        onDismiss={() => setEditDateOpen(false)}
        onConfirm={({ date }) => { if (date) setEditDate(toISO(date)); setEditDateOpen(false); }}
      /> */}
      {/* Filters bottom sheet */}
      <Modal visible={filterOpen} transparent animationType="fade" onRequestClose={() => setFilterOpen(false)}>
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={{ flex: 1, width: '100%' }} activeOpacity={1} onPress={() => setFilterOpen(false)} />
          <View style={styles.filterSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.modalTitle}>Filters</Text>
              <TouchableOpacity onPress={() => setFilterOpen(false)} style={[styles.inlineIconBtn, { backgroundColor: '#F3F6FB' }]}>
                <Feather name="x" size={16} color={Colors.primary} />
              </TouchableOpacity>
            </View>
            <View style={{ gap: 12 }}>
              {/* Date range */}
              <View style={{ marginTop: 4 }}>
                <Text style={styles.groupTitle}>Date Range</Text>
                <View style={[styles.filterMenuRow, { alignItems: 'center', flexWrap: 'wrap' }]}>
                  <TouchableOpacity onPress={() => setFilterStartOpen(true)} style={[styles.inputLike, { minWidth: 140 }]}>
                    <Text style={styles.inputLikeText}>{filterRange.start ? formatDisplayDate(filterRange.start) : 'Start date'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setFilterEndOpen(true)} style={[styles.inputLike, { minWidth: 140 }]}>
                    <Text style={styles.inputLikeText}>{filterRange.end ? formatDisplayDate(filterRange.end) : 'End date'}</Text>
                  </TouchableOpacity>
                  {(filterRange.start || filterRange.end) ? (
                    <TouchableOpacity onPress={() => setFilterRange({ start: '', end: '' })} style={[styles.inlineBtn, { marginLeft: 6 }]}>
                      <Text style={styles.inlineBtnText}>Clear</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
              {/* Expiry status */}
              <View>
                <Text style={styles.groupTitle}>Status</Text>
                <View style={[styles.filterMenuRow, styles.chipsRow]}>
                  <Chip label="All" active={!filterExp} onPress={() => setFilterExp('')} />
                  <Chip label="Expiring soon" tone="warning" active={filterExp === 'soon'} onPress={() => setFilterExp(filterExp === 'soon' ? '' : 'soon')} />
                  <Chip label="Expired" tone="danger" active={filterExp === 'expired'} onPress={() => setFilterExp(filterExp === 'expired' ? '' : 'expired')} />
                </View>
              </View>
              {/* Versions */}
              <View>
                <Text style={styles.groupTitle}>Versions</Text>
                <View style={[styles.filterMenuRow, styles.chipsRow]}>
                  <Chip label="Latest only" active={!showHistory} onPress={() => setShowHistory(false)} />
                  <Chip label="All previous" active={showHistory} onPress={() => setShowHistory(true)} />
                </View>
              </View>
              {/* Document type */}
              <View>
                <Text style={styles.groupTitle}>Document Type</Text>
                <View style={[styles.filterMenuRow, styles.chipsRow, { flexWrap: 'wrap' }]}>
                  <Chip label="All" active={!filterDoc} onPress={() => setFilterDoc('')} />
                  {filterOptions.docs.map((d) => (
                    <Chip key={d} label={d} active={filterDoc === d} onPress={() => setFilterDoc(d)} />
                  ))}
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <InlineButton label="Clear" onPress={() => { setFilterDoc(''); setFilterRange({ start: '', end: '' }); setFilterExp(''); setShowHistory(false); }} />
                <InlineButton label="Done" onPress={() => setFilterOpen(false)} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
      {/* Filter date pickers */}
      {/* <DatePickerModal
        locale="en"
        mode="single"
        visible={filterStartOpen}
        onDismiss={() => setFilterStartOpen(false)}
        onConfirm={({ date }) => { if (date) setFilterRange((r) => ({ ...r, start: toISO(date) })); setFilterStartOpen(false); }}
      />
      <DatePickerModal
        locale="en"
        mode="single"
        visible={filterEndOpen}
        onDismiss={() => setFilterEndOpen(false)}
        onConfirm={({ date }) => { if (date) setFilterRange((r) => ({ ...r, end: toISO(date) })); setFilterEndOpen(false); }}
      /> */}
      <Text style={[styles.metaText, { marginHorizontal: 16, marginBottom: (Platform.OS !== 'web' || isCompact) ? 12 : 6 }]}>
        {safeFilteredRows.length} document{safeFilteredRows.length === 1 ? '' : 's'}
      </Text>

      {/* Mobile Card View */}
      {Platform.OS !== 'web' || isCompact ? (
        <ScrollView
          style={styles.mobileScroll}
          contentContainerStyle={[styles.mobileScrollContent, { paddingBottom: 80 }]}
          showsVerticalScrollIndicator
        >
          {safeFilteredRows.length === 0 ? (
            <View style={styles.mobileEmptyState}>
              <MaterialIcons name="description" size={48} color="#CBD5E1" />
              <Text style={styles.mobileEmptyText}>No documents found</Text>
              <Text style={styles.mobileEmptySubtext}>Try adjusting your filters</Text>
      </View>
          ) : (
            <View style={styles.gridContainer}>
              {safeFilteredRows.map((r) => {
                if (!r || typeof r !== 'object') return null;
                let dateDisplay = '—';
                let updatedDisplay = '—';
                try {
                  dateDisplay = r.dateValue ? formatDisplayDate(r.dateValue) : '—';
                  updatedDisplay = r.updatedAt ? formatDisplayDate(r.updatedAt) : '—';
                } catch (error) {
                  console.warn('Error formatting dates:', error);
                }
                const now = new Date(); now.setHours(0, 0, 0, 0);
                const status = (() => {
                  try {
                    if (!r.dateValue) return '';
                    const d = new Date(r.dateValue);
                    if (Number.isNaN(+d)) return '';
                    const diff = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
                    if (d < now) return 'expired';
                    if (diff >= 0 && diff <= 30) return 'soon';
                    return '';
                  } catch { return ''; }
                })();

                return (
                  <View key={r.id} style={[styles.mobileCard, !isCompact && styles.desktopGridCard]}>
                    <View style={styles.mobileCardHeader}>
                      <View style={{ flexDirection: 'row', gap: 12, flex: 1 }}>
                        <View style={styles.mobileThumb}>
                          <MaterialIcons name="description" size={22} color={Colors.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.mobileCardTitle} numberOfLines={1}>{r.docLabel}</Text>
                          <Text style={styles.mobileCardSubtitle} numberOfLines={1}>
                            {String(r.assetId || '')}{r.typeName ? ` • ${String(r.typeName)}` : ''}
                          </Text>
                        </View>
                      </View>
                      {status ? (
                        <View style={[
                          styles.mobileStatusBadge,
                          status === 'expired' && styles.mobileStatusBadgeExpired,
                          status === 'soon' && styles.mobileStatusBadgeSoon
                        ]}>
                          <Text style={[
                            styles.mobileStatusText,
                            status === 'expired' && styles.mobileStatusTextExpired,
                            status === 'soon' && styles.mobileStatusTextSoon
                          ]}>
                            {status === 'expired' ? 'Expired' : 'Expiring Soon'}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    <View style={styles.mobileCardDetails}>
                      {r.model ? (
                        <View style={styles.mobileDetailRow}>
                          <Feather name="cpu" size={14} color="#64748B" />
                          <Text style={styles.mobileDetailLabel}>Model:</Text>
                          <Text style={styles.mobileDetailValue} numberOfLines={1}>{String(r.model || '')}</Text>
                        </View>
                      ) : null}
                      <View style={styles.mobileDetailRow}>
                        <Feather name="user" size={14} color="#64748B" />
                        <Text style={styles.mobileDetailLabel}>Assigned:</Text>
                        <Text style={styles.mobileDetailValue} numberOfLines={1}>{String(r.assigned || 'Unassigned')}</Text>
                      </View>
                      {r.dateLabel ? (
                        <View style={styles.mobileDetailRow}>
                          <Feather name="calendar" size={14} color="#64748B" />
                          <Text style={styles.mobileDetailLabel}>{String(r.dateLabel || '')}:</Text>
                          <Text style={[
                            styles.mobileDetailValue,
                            status === 'soon' && styles.mobileDetailValueSoon,
                            status === 'expired' && styles.mobileDetailValueExpired
                          ]} numberOfLines={1}>
                            {dateDisplay}
                          </Text>
                        </View>
                      ) : null}
                      {updatedDisplay && updatedDisplay !== '—' ? (
                        <View style={styles.mobileDetailRow}>
                          <Feather name="clock" size={14} color="#64748B" />
                          <Text style={styles.mobileDetailLabel}>Updated:</Text>
                          <Text style={styles.mobileDetailValue} numberOfLines={1}>{updatedDisplay}</Text>
                        </View>
                      ) : null}
                    </View>

                    <View style={styles.mobileCardActions}>
                      <TouchableOpacity
                        onPress={() => openDocumentLink(r.docUrl)}
                        style={[styles.mobileActionBtn, styles.mobileActionBtnPrimary]}
                      >
                        <MaterialIcons name="open-in-new" size={18} color="#fff" />
                        <Text style={styles.mobileActionBtnText}>Open</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          setEditRow(r);
                          setEditDate((r.dateValue ? String(r.dateValue).split('T')[0] : ''));
                          setEditFile(null);
                          setDocOptional(null);
                          setEditOpen(true);
                        }}
                        style={[styles.mobileActionBtn, styles.mobileActionBtnEdit]}
                      >
                        <MaterialIcons name="edit" size={18} color="#fff" />
                        <Text style={styles.mobileActionBtnText}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={async () => {
                          try {
                            const proceed = await new Promise((resolve) => Alert.alert('Delete document', 'This cannot be undone. Continue?', [
                              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                              { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
                            ]));
                            if (!proceed) return;
                            setDeleteBusyId(r.id);
                            const url = `${API_BASE_URL}/assets/${encodeURIComponent(r.assetId)}/documents/${encodeURIComponent(r.id)}`;
                            const resp = await fetch(url, { method: 'DELETE' });
                            if (!resp.ok) {
                              const t = await resp.text();
                              throw new Error(t || 'Failed to delete');
                            }
                            setRefreshKey((x) => x + 1);
                          } catch (e) {
                            Alert.alert('Error', e?.message || 'Failed to delete document');
                          } finally {
                            setDeleteBusyId(null);
                          }
                        }}
                        style={[
                          styles.mobileActionBtn,
                          styles.mobileActionBtnDelete,
                          deleteBusyId === r.id && { opacity: 0.6 }
                        ]}
                        disabled={deleteBusyId === r.id}
                      >
                        <MaterialIcons name="delete" size={18} color="#fff" />
                        <Text style={styles.mobileActionBtnText}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      ) : (
        /* Desktop Table View */
      <View style={styles.tableWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          ref={contentRef}
          onLayout={(e) => { const vw = e?.nativeEvent?.layout?.width || 0; setHViewportW(vw); }}
          onContentSizeChange={(w/*, h*/) => { setHContentW(w || 0); }}
        >
          <View>
            <View style={styles.tableHeader}>
              {columns.map((c) => (
                <View key={c.key} style={[styles.th, { width: computedWidths[c.key] }]}>
                  <Text style={styles.thText}>{
                    c.key === 'asset' ? 'Asset Id' :
                      c.key === 'type' ? 'Asset type' :
                        c.label
                  }</Text>
                </View>
              ))}
            </View>
            <ScrollView style={styles.tableBodyScroll} showsVerticalScrollIndicator>
                {paginatedRows.map((r, idx) => {
                const dateDisplay = r.dateValue ? formatDisplayDate(r.dateValue) : '—';
                const updatedDisplay = r.updatedAt ? formatDisplayDate(r.updatedAt) : '—';
                const now = new Date(); now.setHours(0, 0, 0, 0);
                const status = (() => {
                  try {
                    if (!r.dateValue) return '';
                    const d = new Date(r.dateValue);
                    if (Number.isNaN(+d)) return '';
                    const diff = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
                    if (d < now) return 'expired';
                    if (diff >= 0 && diff <= 30) return 'soon';
                    return '';
                  } catch { return ''; }
                })();
                return (
                  <View
                    key={r.id}
                    style={[styles.tr, idx % 2 === 1 && styles.rowAlt, (hoverRowId === r.id) && styles.rowHover]}
                    onMouseEnter={() => setHoverRowId(r.id)}
                    onMouseLeave={() => setHoverRowId(null)}
                  >
                    {/* Asset Id */}
                    <View style={[styles.td, { width: computedWidths['asset'] }]}><Text style={styles.tdText} numberOfLines={1}>{r.assetId}</Text></View>
                    {/* Asset type */}
                    <View style={[styles.td, { width: computedWidths['type'] }]}><Text style={styles.tdText} numberOfLines={1}>{r.typeName || '—'}</Text></View>
                    {/* Model */}
                    <View style={[styles.td, { width: computedWidths['model'] }]}><Text style={styles.tdText} numberOfLines={1}>{r.model || '—'}</Text></View>
                    {/* Assigned */}
                    <View style={[styles.td, { width: computedWidths['assigned'] }]}><Text style={styles.tdText} numberOfLines={1}>{r.assigned || '—'}</Text></View>
                    {/* Doc: clickable label (no raw URL below) */}
                    <View style={[styles.td, { width: computedWidths['doc'] }]}>
                      <TouchableOpacity style={styles.link} onPress={() => openDocumentLink(r.docUrl)}>
                        <Text style={styles.linkText} numberOfLines={1}>{r.docLabel}</Text>
                        <MaterialIcons name="open-in-new" size={16} color={Colors.primary} />
                      </TouchableOpacity>
                    </View>
                    {/* Date */}
                    <View style={[styles.td, { width: computedWidths['date'] }]}>
                      <Text style={styles.dateLabel} numberOfLines={1}>{r.dateLabel || '—'}</Text>
                      <Text style={[styles.dateValue, status === 'soon' && styles.dateValueSoon, status === 'expired' && styles.dateValueExpired]} numberOfLines={1}>{dateDisplay}</Text>
                    </View>
                    {/* Last Updated (date only) */}
                    <View style={[styles.td, { width: computedWidths['updated'] }]}>
                      <Text style={styles.dateValue} numberOfLines={1}>{updatedDisplay}</Text>
                    </View>
                    {/* Actions */}
                    <View style={[styles.td, { width: computedWidths['actions'], alignItems: 'center' }]}>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity onPress={() => openDocumentLink(r.docUrl)} style={[styles.btnIcon, styles.btnDownload]}>
                          <MaterialIcons name="download" size={18} color="#fff" />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => { setEditRow(r); setEditDate((r.dateValue ? String(r.dateValue).split('T')[0] : '')); setEditFile(null); setDocOptional(null); setEditOpen(true); }} style={[styles.btnIcon, styles.btnEdit]}>
                          <MaterialIcons name="edit" size={18} color="#fff" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={async () => {
                            try {
                              const proceed = Platform.OS === 'web'
                                ? (window.confirm ? window.confirm('Delete this document? This cannot be undone.') : true)
                                : await new Promise((resolve) => Alert.alert('Delete document', 'This cannot be undone. Continue?', [
                                  { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                                  { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
                                ]));
                              if (!proceed) return;
                              setDeleteBusyId(r.id);
                              const url = `${API_BASE_URL}/assets/${encodeURIComponent(r.assetId)}/documents/${encodeURIComponent(r.id)}`;
                              const resp = await fetch(url, { method: 'DELETE' });
                              if (!resp.ok) {
                                const t = await resp.text();
                                throw new Error(t || 'Failed to delete');
                              }
                              setRefreshKey((x) => x + 1);
                            } catch (e) {
                              Alert.alert('Error', e?.message || 'Failed to delete document');
                            } finally {
                              setDeleteBusyId(null);
                            }
                          }}
                          style={[styles.btnIcon, styles.btnDelete, deleteBusyId === r.id && { opacity: 0.6 }]}
                          disabled={deleteBusyId === r.id}
                        >
                          <MaterialIcons name="delete" size={18} color="#fff" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </ScrollView>
          {/* Pagination Controls */}
          {safeFilteredRows.length > 0 && (
            <View style={styles.paginationRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.pageText}>Rows per page:</Text>
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  {[25, 50, 100].map(sz => (
                    <TouchableOpacity key={sz} onPress={() => setPageSize(sz)} style={[styles.pageSizeBtn, pageSize === sz && styles.pageSizeBtnActive]}>
                      <Text style={[styles.pageSizeText, pageSize === sz && styles.pageSizeTextActive]}>{sz}</Text>
                    </TouchableOpacity>
                  ))}
      </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={styles.pageText}>{((page - 1) * pageSize) + 1}-{Math.min(page * pageSize, safeFilteredRows.length)} of {safeFilteredRows.length}</Text>
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  <TouchableOpacity disabled={page <= 1} onPress={() => setPage(p => p - 1)} style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]}>
                    <MaterialIcons name="chevron-left" size={20} color={page <= 1 ? '#CBD5E1' : '#0F172A'} />
                  </TouchableOpacity>
                  <TouchableOpacity disabled={page >= totalPages} onPress={() => setPage(p => p + 1)} style={[styles.pageBtn, page >= totalPages && styles.pageBtnDisabled]}>
                    <MaterialIcons name="chevron-right" size={20} color={page >= totalPages ? '#CBD5E1' : '#0F172A'} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

CertsView.propTypes = { initialVisible: PropTypes.bool };
CertsView.defaultProps = { initialVisible: false };

const styles = StyleSheet.create({
  certsWrap: { flex: 1, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: '#F7FAFF' },
  certsWrapMobile: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 32 },
  sectionTitle: { fontSize: 22, fontWeight: '800', color: '#0F172A', marginBottom: 10 },
  toolbarSurface: { marginBottom: 8 },
  toolbarRow: { gap: 8, marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inlineIconBtn: { width: 36, height: 36, borderRadius: 8, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#BFDBFE' },
  quickRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  metaText: { fontSize: 13, color: '#64748B', fontWeight: '600' },
  iconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  actionBtn: { paddingHorizontal: 12, height: 34, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  actionBtnText: { color: Colors.primary, fontWeight: '600', fontSize: 13 },
  countDot: { position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: '#D32F2F', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  countDotText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  tableWrap: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  tableHeader: { flexDirection: 'row', backgroundColor: '#F8FAFC', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  th: { paddingVertical: 12, paddingHorizontal: 12, justifyContent: 'center' },
  thText: { fontSize: 12, fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5 },
  tableBodyScroll: { maxHeight: 500 },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F1F5F9', backgroundColor: '#fff' },
  rowAlt: { backgroundColor: '#FAFAFA' },
  rowHover: { backgroundColor: '#F0F9FF' },
  td: { paddingVertical: 12, paddingHorizontal: 12, justifyContent: 'center' },
  tdText: { fontSize: 13, color: '#334155', fontWeight: '500' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkText: { fontSize: 13, color: '#2563EB', fontWeight: '600', textDecorationLine: 'underline' },
  dateLabel: { fontSize: 11, color: '#94A3B8', marginBottom: 2, textTransform: 'uppercase', fontWeight: '700' },
  dateValue: { fontSize: 13, color: '#334155', fontWeight: '600' },
  dateValueSoon: { color: '#D97706' },
  dateValueExpired: { color: '#DC2626' },
  btnIcon: { width: 32, height: 32, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  btnDownload: { backgroundColor: '#3B82F6' },
  btnEdit: { backgroundColor: '#F59E0B' },
  btnDelete: { backgroundColor: '#EF4444' },
  errorText: { color: '#DC2626', fontWeight: '600', marginVertical: 10 },
  emptyText: { color: '#64748B', fontStyle: 'italic', marginTop: 10 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#EFF6FF' },
  btnPrimary: { backgroundColor: '#2563EB' },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#CBD5E1' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 480, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 20, elevation: 10 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#1E293B', marginBottom: 16 },
  modalLabel: { fontSize: 13, fontWeight: '700', color: '#64748B', marginBottom: 4 },
  modalValue: { fontSize: 16, color: '#0F172A', fontWeight: '600' },
  inlineBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, backgroundColor: '#EFF6FF' },
  inlineBtnText: { fontSize: 13, fontWeight: '700', color: '#2563EB' },
  filterSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 10, elevation: 20, maxHeight: '78%' },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  groupTitle: { fontSize: 14, fontWeight: '800', color: '#1E293B', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  filterMenuRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  chipsRow: { flexWrap: 'wrap' },
  quickDateRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  quickDateChip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  quickDateChipText: { color: '#374151', fontWeight: '700' },
  inputLike: { borderWidth: 1, borderColor: '#D6E8FF', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#FFFFFF' },
  inputLikeText: { color: '#0F172A', fontWeight: '600' },
  // Mobile card view
  mobileScroll: { flex: 1 },
  mobileScrollContent: { paddingHorizontal: 12, paddingBottom: 24 },
  gridContainer: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -8 },
  mobileCard: {
    width: '100%',
    flexBasis: '100%',
    flexGrow: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    marginHorizontal: 8,
    borderWidth: 1,
    borderColor: '#E9F1FF',
    shadowColor: '#0B63CE',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  desktopGridCard: { width: '48%', minWidth: 320 },
  mobileCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  mobileThumb: {
    width: 46,
    height: 46,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobileCardTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  mobileCardSubtitle: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },
  mobileStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#DBEAFE',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  mobileStatusBadgeExpired: {
    backgroundColor: '#FEE2E2',
    borderColor: '#FCA5A5',
  },
  mobileStatusBadgeSoon: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FCD34D',
  },
  mobileStatusText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1D4ED8',
  },
  mobileStatusTextExpired: {
    color: '#B91C1C',
  },
  mobileStatusTextSoon: {
    color: '#B45309',
  },
  mobileCardDetails: {
    gap: 10,
    marginBottom: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0F4F8',
  },
  mobileDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mobileDetailLabel: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '700',
    minWidth: 80,
  },
  mobileDetailValue: {
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '600',
    flex: 1,
  },
  mobileDetailValueSoon: {
    color: '#B45309',
    fontWeight: '800',
  },
  mobileDetailValueExpired: {
    color: '#B91C1C',
    fontWeight: '800',
  },
  mobileCardActions: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0F4F8',
  },
  mobileActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  mobileActionBtnPrimary: {
    backgroundColor: '#0B63CE',
  },
  mobileActionBtnEdit: { backgroundColor: '#B45309' },
  mobileActionBtnDelete: { backgroundColor: '#D32F2F' },
  mobileActionBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  mobileEmptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  mobileEmptyText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#475569',
    marginTop: 12,
  },
  mobileEmptySubtext: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 4,
  },
  // Pagination
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderTopWidth: 1, borderTopColor: '#E2E8F0', backgroundColor: '#F8FAFC' },
  pageText: { fontSize: 13, color: '#64748B', fontWeight: '600' },
  pageSizeBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#fff' },
  pageSizeBtnActive: { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' },
  pageSizeText: { fontSize: 12, color: '#64748B', fontWeight: '600' },
  pageSizeTextActive: { color: '#2563EB' },
  pageBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 4, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#fff' },
  pageBtnDisabled: { opacity: 0.5, backgroundColor: '#F1F5F9' },
});
