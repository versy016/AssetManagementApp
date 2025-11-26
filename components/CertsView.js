// components/CertsView.js (rewritten)
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform, TextInput, Alert, Modal, useWindowDimensions } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { DatePickerModal } from 'react-native-paper-dates';
import { en, registerTranslation } from 'react-native-paper-dates';
import PropTypes from 'prop-types';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { API_BASE_URL } from '../inventory-api/apiBase';
import { formatDisplayDate } from '../utils/date';
import { Colors } from '../constants/uiTheme';
import PageHeader from './ui/PageHeader';
import Chip from './ui/Chip';
import InlineButton from './ui/InlineButton';
import SearchInput from './ui/SearchInput';

const openDocumentLink = (url) => {
  if (!url) return;
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener');
    } else {
      const { Linking } = require('react-native');
      Linking.openURL(url);
    }
  } catch { }
};

export default function CertsView({ visible }) {
  const [state, setState] = useState({ items: [], loading: false, error: null });
  const [assetMap, setAssetMap] = useState({}); // { assetId: { id, model, users, asset_types, ... } }
  const [refreshKey, setRefreshKey] = useState(0);
  // Horizontal sizing similar to search table
  const contentRef = useRef(null);
  const [hContentW, setHContentW] = useState(0);
  const [hViewportW, setHViewportW] = useState(0);
  // Filters like search table
  const [filterText, setFilterText] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterAssigned, setFilterAssigned] = useState('');
  // Edit modal state
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
  const [filterDoc, setFilterDoc] = useState(''); // Document Type (by label)
  const [filterExp, setFilterExp] = useState(''); // '', 'soon', 'expired'
  const [showHistory, setShowHistory] = useState(false); // show all previous certs
  const [filterStartOpen, setFilterStartOpen] = useState(false);
  const [filterEndOpen, setFilterEndOpen] = useState(false);
  const [filterRange, setFilterRange] = useState({ start: '', end: '' }); // ISO strings
  const [me, setMe] = useState({ uid: null, email: null });
  const { width } = useWindowDimensions();
  const isCompact = Platform.OS === 'web' ? ((width || 0) < 1024) : true;
  const [hoverRowId, setHoverRowId] = useState(null);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    (async () => {
      try {
        setState((s) => ({ ...s, loading: true, error: null }));
        const res = await fetch(`${API_BASE_URL}/asset-documents/documents`);
        const j = await res.json().catch(() => ({}));
        const list = Array.isArray(j?.items) ? j.items : Array.isArray(j) ? j : [];
        if (!cancelled) setState({ items: list, loading: false, error: null });
      } catch (e) {
        if (!cancelled) setState({ items: [], loading: false, error: e?.message || 'Failed to load documents' });
      }
    })();
    return () => { cancelled = true; };
  }, [visible, refreshKey]);

  // Load current user for filter chips
  useEffect(() => {
    try {
      const u = require('../firebaseConfig').auth?.currentUser || null;
      const email = u?.email ? String(u.email).toLowerCase() : null;
      setMe({ uid: u?.uid || null, email });
    } catch { }
  }, []);

  // Enrich with asset details (type, model, assigned user). Fetch unique IDs once per load.
  useEffect(() => {
    if (!visible) return undefined;
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
  }, [visible, state.items]);

  const rows = useMemo(() => {
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
      const a = assetMap[d.asset_id] || {};
      const assigned = a?.users?.name || a?.users?.useremail || a?.assigned_to || '';
      const model = a?.model || (a?.fields && (a.fields.model || a.fields.Model)) || '';
      const typeName = a?.asset_types?.name || a?.type || a?.asset_type || '';
      return ({
        id: d.id || String(idx),
        assetId: d.asset_id,
        docLabel: toTitle(d.title || d.kind || 'Document'),
        dateLabel: d.related_date_label || '',
        dateValue: d.related_date || null,
        docUrl: d.url,
        createdAt: d.created_at || null,
        updatedAt: d.updated_at || d.created_at || null,
        assigned,
        model,
        typeName,
        asset_type_field_id: d.asset_type_field_id || null,
      });
    });
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
    // Only show latest per group by default; when Status=Expired is selected,
    // use the full dataset so older/expired docs are visible. Also allow explicit toggle.
    const base = (showHistory || filterExp === 'expired') ? rows : latestRows;
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
      if (filterType && r.typeName !== filterType) return false;
      if (filterAssigned && r.assigned !== filterAssigned) return false;
      if (onlyMine) {
        const a = (r.assigned || '').toString().toLowerCase();
        if (!(me.email && a.includes(me.email))) return false;
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
  }, [rows, latestRows, filterText, filterType, filterAssigned, onlyMine, me.email, filterDoc, filterRange.start, filterRange.end, filterExp, showHistory]);

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
  try { registerTranslation('en', en); } catch { }

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

  // Early exits AFTER all hooks to keep hook order stable
  if (!visible) return null;
  if (state.loading) {
    return (
      <View style={styles.certsWrap}><ActivityIndicator color={Colors.primary} /></View>
    );
  }
  if (state.error) {
    return (
      <View style={styles.certsWrap}>
        <Text style={styles.sectionTitle}>Certificates & Documents</Text>
        <Text style={styles.errorText}>{state.error}</Text>
        <TouchableOpacity style={[styles.btn]} onPress={() => setRefreshKey((x) => x + 1)}>
          <MaterialIcons name="refresh" size={18} color={Colors.primaryDark} />
          <Text style={{ marginLeft: 6, color: Colors.primaryDark, fontWeight: '700' }}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!rows.length) {
    return (
      <View style={styles.certsWrap}>
        <Text style={styles.sectionTitle}>Certificates & Documents</Text>
        <Text style={styles.emptyText}>No attachments found.</Text>
      </View>
    );
  }

  return (
    <View style={styles.certsWrap}>
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
              <TouchableOpacity style={styles.inlineIconBtn} onPress={() => setFilterOpen((v) => !v)}>
                <Feather name="sliders" size={18} color={Colors.primary} />
              </TouchableOpacity>
            }
          />
        </View>
        {/* My assets quick chip under search */}
        <View style={[styles.quickRow, { marginTop: 8 }]}>
          <Chip label="My assets" icon="user" active={onlyMine} onPress={() => setOnlyMine(v => !v)} />
        </View>
      </View>
      {/* Edit Modal */}
      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit Certificate</Text>
            {!!editRow && (
              <>
                <Text style={styles.modalLabel}>Document Type</Text>
                <Text style={styles.modalValue}>{editRow.docLabel}</Text>

                {/* Current document reference */}
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

                {/* Date picker */}
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
                      // Fetch doc optional flag once if unknown
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

                      // If only date is changing and there was a previous file, warn when optional
                      if (!editFile && prevHadFile && (docOptional === true)) {
                        const ok = Platform.OS === 'web' ? window.confirm('You are updating the date without replacing the existing file. Continue?') : await new Promise((res) => Alert.alert('Confirm', 'Update date without replacing the existing file?', [{ text: 'Cancel', style: 'cancel', onPress: () => res(false) }, { text: 'Continue', onPress: () => res(true) }]));
                        if (!ok) { setEditBusy(false); return; }
                      }

                      // If file selected: upload new, then soft-delete old
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
                        // Soft delete previous doc
                        try { await fetch(`${API_BASE_URL}/assets/${assetId}/documents/${docId}`, { method: 'DELETE' }); } catch { }
                      } else {
                        // Only metadata update
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
      <DatePickerModal
        locale="en"
        mode="single"
        visible={editDateOpen}
        onDismiss={() => setEditDateOpen(false)}
        onConfirm={({ date }) => { if (date) setEditDate(toISO(date)); setEditDateOpen(false); }}
      />
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
      <DatePickerModal
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
      />
      {/* Meta bar */}
      <View style={[styles.metaBar, { marginHorizontal: 12 }]}>
        <Text style={styles.metaText}>{filteredRows.length} documents</Text>
      </View>
      {/* Table wrapper matches Search table look */}
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
              {filteredRows.map((r, idx) => {
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
      </View>
    </View>
  );
}

CertsView.propTypes = { visible: PropTypes.bool };
CertsView.defaultProps = { visible: false };

const styles = StyleSheet.create({
  certsWrap: { paddingVertical: 8, paddingHorizontal: 12 },
  sectionTitle: { fontSize: 22, fontWeight: '800', color: '#0F172A', marginBottom: 10 },
  toolbarSurface: { marginBottom: 8 },
  toolbarRow: { gap: 8, marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    paddingHorizontal: 12,
    paddingLeft: 34,
    borderRadius: 12,
    minHeight: 46,
    borderWidth: 1,
    borderColor: '#D6E8FF',
    flexGrow: 1,
  },
  searchIcon: { position: 'absolute', left: 10, top: 10 },
  searchInput: { flex: 1, fontSize: 17, color: '#0F172A' },
  toolbarIconBtns: { flexDirection: 'row', gap: 8 },
  inlineIconBtn: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E7F3FF', borderWidth: 1, borderColor: '#D6E8FF' },
  quickRow: { flexDirection: 'row', gap: 8 },
  quick: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#D6E8FF', borderRadius: 999, backgroundColor: 'white' },
  quickActive: { borderColor: '#0B63CE', backgroundColor: '#E7F3FF' },
  quickText: { fontSize: 14, color: '#64748B' },
  filterMenu: { position: 'absolute', right: 10, top: 54, backgroundColor: '#fff', borderWidth: 1, borderColor: '#D6E8FF', borderRadius: 12, padding: 12, shadowColor: '#0B63CE', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  filterMenuTitle: { fontWeight: '800', color: '#0F172A', marginBottom: 6 },
  filterMenuRow: { flexDirection: 'row', gap: 8 },
  filterSheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: '#D6E8FF', padding: 16 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  filterRow: { flexDirection: 'row', gap: 12, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' },
  filterGroup: { gap: 6, flexDirection: 'row', alignItems: 'center' },
  filterLabel: { color: '#64748B', fontSize: 12, fontWeight: '700' },
  groupTitle: { color: '#0F172A', fontWeight: '800', fontSize: 14, marginBottom: 6 },
  chipsRow: { flexWrap: 'wrap', alignItems: 'center' },
  choiceChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: '#D6E8FF', backgroundColor: '#FFFFFF', marginRight: 6 },
  choiceChipActive: { backgroundColor: '#E7F3FF', borderColor: '#D6E8FF' },
  choiceChipText: { color: '#374151' },
  choiceChipTextActive: { color: '#0B63CE', fontWeight: '700' },
  metaBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  metaText: { color: '#475569', fontSize: 13 },
  inlineBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#D6E8FF', backgroundColor: '#E7F3FF' },
  inlineBtnText: { color: '#0B63CE', fontWeight: '700' },
  errorText: { color: '#B91C1C', marginTop: 8 },
  emptyText: { color: '#6B7280', marginTop: 8 },
  tableWrap: { flex: 1, marginHorizontal: 12, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#E9F1FF', overflow: 'hidden', shadowColor: '#0B63CE', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  tableHeader: { flexDirection: 'row', backgroundColor: '#E7F3FF', borderBottomWidth: 1, borderBottomColor: '#D6E8FF' },
  th: { paddingVertical: 10, paddingHorizontal: 10, borderRightWidth: 1, borderRightColor: '#E6EDF3' },
  thText: { color: '#084AA0', fontWeight: '800', fontSize: 13 },
  tr: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F0F4F8' },
  rowAlt: { backgroundColor: '#FAFCFF' },
  rowHover: { backgroundColor: '#F3F9FF' },
  td: { paddingVertical: 10, paddingHorizontal: 10, borderRightWidth: 1, borderRightColor: '#D6E8FF', justifyContent: 'center' },
  tdText: { color: '#0F172A', fontSize: 13 },
  tableBodyScroll: { flexGrow: 0, maxHeight: 560 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  linkText: { fontWeight: '900', color: '#0B63CE' },
  urlText: { color: '#6B7280', fontSize: 12 },
  dateLabel: { color: '#0F172A', fontWeight: '700', fontSize: 13 },
  dateValue: { color: '#475569', marginTop: 2, fontSize: 13 },
  dateValueSoon: { color: '#B45309', fontWeight: '700' },
  dateValueExpired: { color: '#D32F2F', fontWeight: '700' },
  btn: { backgroundColor: '#E7F3FF', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: '#D6E8FF' },
  btnPrimary: { backgroundColor: '#0B63CE', borderColor: '#0B63CE', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  btnGhost: { backgroundColor: '#F3F6FB', borderColor: '#E6EDF3', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  btnIcon: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1 },
  btnDownload: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  btnEdit: { backgroundColor: '#B45309', borderColor: '#B45309' },
  btnDelete: { backgroundColor: '#D32F2F', borderColor: '#D32F2F' },
  // modal styles
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modalCard: { width: 520, maxWidth: '96%', backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E9F1FF', padding: 16 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#0F172A', marginBottom: 8 },
  modalLabel: { color: '#64748B', fontWeight: '700' },
  modalValue: { color: '#0F172A', fontWeight: '700', marginTop: 4 },
  quickDateRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  quickDateChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: '#D6E8FF', backgroundColor: '#FFFFFF' },
  quickDateChipText: { color: '#374151', fontWeight: '700' },
  inputLike: { borderWidth: 1, borderColor: '#D6E8FF', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#FFFFFF' },
  inputLikeText: { color: '#0F172A', fontWeight: '600' },
});
