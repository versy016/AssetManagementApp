// components/CertsView.js (restored with fixes)
import React, { useEffect, useMemo, useState, useRef } from 'react';
import logger from '../utils/logger';
import { fetchFields } from '../hooks/useAssetTypeFields';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform, TextInput, Alert, Modal, Linking, useWindowDimensions, InteractionManager } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { DatePickerModal } from 'react-native-paper-dates';
import { en, registerTranslation } from 'react-native-paper-dates';

try {
  registerTranslation('en', en);
} catch {
  /* already registered */
}
import PropTypes from 'prop-types';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { API_BASE_URL } from '../inventory-api/apiBase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDisplayDate, formatValidUntilDisplay } from '../utils/date';
import { Colors, Radius, Shadows, sf } from '../constants/uiTheme';
import { auth } from '../firebaseConfig';
import Chip from './ui/Chip';
import InlineButton from './ui/InlineButton';
import SearchInput from './ui/SearchInput';
import ScreenHeader from './ui/ScreenHeader';
import TableIconButton from './ui/TableIconButton';
import TablePagination from './ui/TablePagination';
import { TourTarget } from './TourGuide';
import { CERT_DOCUMENT_UPLOAD_HINT } from '../constants/uploadFormats';

const openDocumentLink = (url) => {
  if (!url) return;
  try {
    let href = String(url).trim();
    // On native, relative or path-only URLs must be made absolute (API may return path-only in some setups).
    if (Platform.OS !== 'web' && href && !/^https?:\/\//i.test(href)) {
      const base = (typeof API_BASE_URL !== 'undefined' && API_BASE_URL) ? String(API_BASE_URL).replace(/\/+$/, '') : '';
      href = base ? `${base}${href.startsWith('/') ? '' : '/'}${href}` : href;
    }
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(href, '_blank', 'noopener');
    } else {
      Linking.openURL(href);
    }
  } catch (error) {
    logger.error('Error opening document link:', error);
  }
};

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
  // Document type labels from asset type fields (field_id -> name)
  const [fieldIdToLabel, setFieldIdToLabel] = useState({});
  // Create new document modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState(1);
  const [createAssetSearch, setCreateAssetSearch] = useState('');
  const [allAssetsForPicker, setAllAssetsForPicker] = useState([]);
  const [createAssetsLoading, setCreateAssetsLoading] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [createTypeFields, setCreateTypeFields] = useState([]);
  const [createTypeFieldsLoading, setCreateTypeFieldsLoading] = useState(false);
  const [selectedDocField, setSelectedDocField] = useState(null);
  const [createFile, setCreateFile] = useState(null);
  const [createDate, setCreateDate] = useState('');
  const [createDateLabel, setCreateDateLabel] = useState('');
  const [createDatePickerOpen, setCreateDatePickerOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [editDocFieldId, setEditDocFieldId] = useState(null);
  const [editTypeFields, setEditTypeFields] = useState([]);
  // Date fields that link to a document type + asset's current date values (for create step 2)
  const [createDateDocLinks, setCreateDateDocLinks] = useState([]);
  const [createAssetDetails, setCreateAssetDetails] = useState(null);

  // Use useWindowDimensions hook
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const isCompact = Platform.OS === 'web' ? (screenWidth < 1024) : true;
  const isNative = Platform.OS !== 'web';
  const docCount = Array.isArray(state.items) ? state.items.length : 0;
  const isWeb = Platform.OS === 'web';
  const enrichAssets = isWeb || docCount <= 200;

  // Pagination state
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ field: 'updated', dir: 'desc' });
  const [pageSize, setPageSize] = useState(25);


  // Determine if we should render anything based on visibility
  const shouldRender = initialVisible && state !== null && renderReady;

  // On native, renderReady is set after interactions (or fallback timeout) so the certs list can paint.
  // If runAfterInteractions never fires (e.g. some navigators), fallback after 200ms so mobile always shows content.
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const task = InteractionManager.runAfterInteractions(() => setRenderReady(true));
    const fallback = setTimeout(() => setRenderReady(true), 200);
    return () => {
      task.cancel();
      clearTimeout(fallback);
    };
  }, []);

  useEffect(() => {
    if (!initialVisible) return undefined;
    let cancelled = false;

    const fetchData = async () => {
      try {
        setState(prev => ({ ...prev, loading: true, error: null }));
        const res = await fetch(`${API_BASE_URL}/asset-documents/documents`);
        const j = await res.json().catch(() => ({}));
        const rawList = Array.isArray(j?.items) ? j.items : Array.isArray(j) ? j : [];
        // Normalize keys (API may return snake_case or camelCase)
        const list = rawList.map((d) => {
          if (!d || typeof d !== 'object') return d;
          return {
            ...d,
            asset_id: d.asset_id ?? d.assetId,
            url: d.url,
            created_at: d.created_at ?? d.createdAt,
            updated_at: d.updated_at ?? d.updatedAt,
            related_date: d.related_date ?? d.relatedDate,
            related_date_label: d.related_date_label ?? d.relatedDateLabel,
            asset_type_field_id: d.asset_type_field_id ?? d.assetTypeFieldId,
          };
        });

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
      logger.error('Error loading current user:', error);
    }
  }, []);

  // Enrich with asset details (type, model, assigned user). Fetch unique IDs once per load.
  useEffect(() => {
    if (!initialVisible) return undefined;
    if (!enrichAssets) {
      setAssetMap((prev) => (Object.keys(prev || {}).length === 0 ? prev : {}));
      return undefined;
    }
    const ids = Array.from(new Set((state.items || []).map((d) => d?.asset_id).filter(Boolean)));
    if (!ids.length) {
      setAssetMap((prev) => (Object.keys(prev || {}).length === 0 ? prev : {}));
      return undefined;
    }
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

  // Create document: load assets when modal opens (step 1)
  useEffect(() => {
    if (!createOpen || createStep !== 1) return;
    setCreateAssetsLoading(true);
    let cancelled = false;
    fetch(`${API_BASE_URL}/assets`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        const isUUID = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
        const filtered = list
          .filter((a) => (a?.description || '').toLowerCase() !== 'qr reserved asset')
          .filter((a) => !isUUID(String(a?.id || '')));
        setAllAssetsForPicker(filtered);
      })
      .catch(() => { if (!cancelled) setAllAssetsForPicker([]); })
      .finally(() => { if (!cancelled) setCreateAssetsLoading(false); });
    return () => { cancelled = true; };
  }, [createOpen, createStep]);

  // Create document: when asset selected, load type fields (URL + date→doc links) and asset details for step 2
  useEffect(() => {
    if (!createOpen || !selectedAsset || createStep !== 2) {
      if (!selectedAsset) {
        setCreateTypeFields([]);
        setCreateDateDocLinks([]);
        setCreateAssetDetails(null);
      }
      return;
    }
    const assetId = selectedAsset.id;
    let cancelled = false;

    const parseLinkSlug = (f) => {
      try {
        const vr = (f.validation_rules && typeof f.validation_rules === 'object')
          ? f.validation_rules
          : (f.validation_rules ? JSON.parse(f.validation_rules) : null);
        const opts = (f.options && typeof f.options === 'object') ? f.options : (f.options ? JSON.parse(f.options) : null);
        const link = (vr && (vr.requires_document_slug || vr.require_document_slug)) ||
          (opts && (opts.requires_document_slug || opts.require_document_slug));
        const slug = Array.isArray(link) ? link[0] || '' : (link || '');
        return slug ? String(slug) : '';
      } catch { return ''; }
    };

    function isDocumentField(f) {
      const slug = String(f?.field_type?.slug || f?.field_type?.name || '').toLowerCase();
      const name = String(f?.field_type?.name || f?.field_type?.slug || '').toLowerCase();
      if (slug === 'url' || name === 'url') return true;
      if (slug === 'document' || name === 'document') return true;
      if (name === 'documentation' || slug === 'documentation') return true;
      return false;
    }

    function applyFields(fieldList, assetDetails) {
      if (cancelled) return;
      const urlFields = fieldList.filter(isDocumentField);
      const docTypeFields = urlFields.length > 0 ? urlFields : fieldList;
      setCreateTypeFields(docTypeFields);
      if (docTypeFields.length && !selectedDocField) setSelectedDocField(docTypeFields[0]);
      else if (!docTypeFields.length) setSelectedDocField(null);

      const dateFields = fieldList.filter(
        (f) => String(f?.field_type?.slug || f?.field_type?.name || '').toLowerCase() === 'date'
      );
      const links = [];
      for (const dateF of dateFields) {
        const docSlug = parseLinkSlug(dateF);
        if (!docSlug) continue;
        const linkedDoc = docTypeFields.find(
          (u) => String(u?.slug || '').toLowerCase() === String(docSlug).toLowerCase()
        );
        if (!linkedDoc) continue;
        const assetFields = (assetDetails && assetDetails.fields && typeof assetDetails.fields === 'object') ? assetDetails.fields : {};
        const dateValue = assetFields[dateF.slug] ?? assetFields[dateF.name] ?? null;
        const dateValueStr = dateValue != null ? (typeof dateValue === 'string' ? dateValue.split('T')[0] : String(dateValue).split('T')[0]) : null;
        links.push({
          dateField: { id: dateF.id, name: dateF.name || dateF.slug, slug: dateF.slug },
          linkedDocField: { id: linkedDoc.id, name: linkedDoc.name || linkedDoc.slug, slug: linkedDoc.slug },
          dateValue: dateValueStr,
        });
      }
      setCreateDateDocLinks(links);
      if (assetDetails) setCreateAssetDetails(assetDetails);
    }

    setCreateTypeFieldsLoading(true);
    setCreateDateDocLinks([]);
    setCreateAssetDetails(null);

    (async () => {
      try {
        let assetDetails = null;
        if (assetId) {
          const assetRes = await fetch(`${API_BASE_URL}/assets/${encodeURIComponent(assetId)}`);
          if (assetRes.ok) assetDetails = await assetRes.json();
          if (cancelled) return;
        }
        const typeId = selectedAsset.type_id || selectedAsset.asset_types?.id || (assetDetails && (assetDetails.type_id || (assetDetails.asset_types && assetDetails.asset_types.id)));
        let fields = [];

        if (typeId) {
          fields = await fetchFields(typeId).catch(() => []);
          if (cancelled) return;

          if (fields.length === 0) {
            const typeRes = await fetch(`${API_BASE_URL}/asset-types/${encodeURIComponent(typeId)}?include=fields`);
            if (typeRes.ok) {
              const typeJson = await typeRes.json();
              const typeData = typeJson?.data || typeJson;
              const typeFields = Array.isArray(typeData?.fields) ? typeData.fields : [];
              if (typeFields.length > 0) {
                const ftRes = await fetch(`${API_BASE_URL}/field-types`);
                const ftList = (ftRes.ok && await ftRes.json()) || [];
                const ftArray = Array.isArray(ftList) ? ftList : (ftList?.data || []);
                const ftById = Object.fromEntries((ftArray).map((t) => [t.id, t]));
                fields = typeFields.map((f) => ({
                  ...f,
                  field_type: f.field_type || (f.field_type_id && ftById[f.field_type_id]) || {},
                }));
              }
            }
            if (cancelled) return;
          }
        }

        if (!cancelled) applyFields(fields, assetDetails);
      } catch {
        if (!cancelled) {
          setCreateTypeFields([]);
          setCreateDateDocLinks([]);
          setCreateAssetDetails(null);
        }
      } finally {
        if (!cancelled) setCreateTypeFieldsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [createOpen, selectedAsset, createStep]);

  // Load type fields for document type labels (field_id -> name). Used to show "Warranty" etc from asset type.
  useEffect(() => {
    if (!initialVisible || !enrichAssets) return;
    const typeIds = Array.from(new Set(
      (state.items || [])
        .map((d) => (assetMap[d?.asset_id] || {})?.type_id || (assetMap[d?.asset_id] || {})?.asset_types?.id)
        .filter(Boolean)
    ));
    if (!typeIds.length) { setFieldIdToLabel({}); return; }
    let cancelled = false;
    (async () => {
      const map = {};
      for (const typeId of typeIds) {
        try {
          if (cancelled) break;
          const arr = await fetchFields(typeId);
          for (const f of arr) {
            const slug = String(f?.field_type?.slug || '').toLowerCase();
            const name = String(f?.field_type?.name || '').toLowerCase();
            const isDoc = slug === 'url' || name === 'url' || slug === 'document' || name === 'document' || name === 'documentation' || slug === 'documentation';
            if (isDoc && f.id) map[f.id] = f.name || f.slug || 'Document';
          }
        } catch (e) {
          logger.warn('CertsView: field label fetch failed', { typeId, message: e?.message || e });
        }
      }
      if (!cancelled) setFieldIdToLabel(map);
    })();
    return () => { cancelled = true; };
  }, [initialVisible, state.items, assetMap, enrichAssets]);

  const rows = useMemo(() => {
    if (!state.items) return [];
    const rawItems = Array.isArray(state.items) ? state.items : [];
    // Exclude all photos from certs (task sign-off photos, images, etc. — not certificates)
    const isPhotoDoc = (label) => /photo|image|picture|task photo/i.test(String(label || ''));
    const items = rawItems.filter((d) => {
      const k = (d?.kind || d?.title || '').trim();
      return !isPhotoDoc(k);
    });
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
        docLabel: (d.asset_type_field_id && fieldIdToLabel[d.asset_type_field_id])
          ? fieldIdToLabel[d.asset_type_field_id]
          : toTitle(d.title || d.kind || 'Document'),
        dateLabel: (d.related_date_label || '').replace(/\s*reminder\s*$/i, '').trim() || (d.related_date ? 'Valid Until' : ''),
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
    // Sort by latest added first (createdAt desc), then by related date desc
    arr.sort((a, b) => {
      const ac = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bc = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (bc !== ac) return bc - ac;
      const ad = a.dateValue ? new Date(a.dateValue).getTime() : 0;
      const bd = b.dateValue ? new Date(b.dateValue).getTime() : 0;
      return bd - ad;
    });
    return arr;
  }, [state.items, assetMap, fieldIdToLabel]);

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
      // prefer latest added (createdAt), then latest by related date
      const ac = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bc = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (ac !== bc) return ac - bc;
      const ad = a?.dateValue ? new Date(a.dateValue).getTime() : 0;
      const bd = b?.dateValue ? new Date(b.dateValue).getTime() : 0;
      return ad - bd;
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
      logger.error('Error filtering rows:', error);
      return [];
    }
  }, [rows, latestRows, filterText, filterType, filterAssigned, onlyMine, me.email, filterDoc, filterRange.start, filterRange.end, filterExp, showHistory]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [filterText, filterType, filterAssigned, onlyMine, filterDoc, filterRange, filterExp, showHistory, sort.field, sort.dir]);


  // Ensure filteredRows is always an array
  const safeFilteredRows = useMemo(() => {
    try {
      return Array.isArray(filteredRows) ? filteredRows : [];
    } catch (error) {
      logger.error('Error getting filtered rows:', error);
      return [];
    }
  }, [filteredRows]);

  // Column key -> row property for sorting (skip attachment and actions)
  const columnKeyToSortField = useMemo(() => ({
    asset: 'assetId',
    type: 'typeName',
    model: 'model',
    assigned: 'assigned',
    documentType: 'docLabel',
    date: 'dateValue',
    updated: 'updatedAt',
  }), []);

  const sortableColumnKeys = useMemo(() => Object.keys(columnKeyToSortField), [columnKeyToSortField]);

  const getRowVal = (r, field) => {
    if (!r || !field) return '';
    const v = r[field];
    if (v == null || v === '') return '';
    return v;
  };

  const sortedRows = useMemo(() => {
    const list = [...(safeFilteredRows || [])];
    const rowField = columnKeyToSortField[sort.field] || sort.field;
    const dir = sort.dir || 'desc';
    const isDate = rowField === 'dateValue' || rowField === 'updatedAt';
    list.sort((a, b) => {
      const av = getRowVal(a, rowField);
      const bv = getRowVal(b, rowField);
      const aEmpty = av === '' || av == null;
      const bEmpty = bv === '' || bv == null;
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return dir === 'asc' ? 1 : 1;
      if (bEmpty) return dir === 'asc' ? -1 : -1;
      let cmp = 0;
      if (isDate) {
        const at = new Date(av).getTime();
        const bt = new Date(bv).getTime();
        if (!Number.isNaN(at) && !Number.isNaN(bt)) cmp = at - bt;
      } else {
        const as = String(av).toLowerCase();
        const bs = String(bv).toLowerCase();
        cmp = as < bs ? -1 : as > bs ? 1 : 0;
      }
      return dir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [safeFilteredRows, sort.field, sort.dir, columnKeyToSortField]);

  // Paginated rows (from sorted list)
  const paginatedRows = useMemo(() => {
    if (pageSize === 'All') return sortedRows;
    const start = (page - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, page, pageSize]);

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
      <TourTarget id="web-certs-filters">
      <TouchableOpacity style={styles.iconBtn} onPress={() => setFilterOpen(true)}>
        <View style={{ position: 'relative' }}>
          <Feather name="sliders" size={18} color={Colors.accent} />
          {activeFilterCount > 0 && (
            <View style={styles.countDot}>
              <Text style={styles.countDotText}>{Math.min(activeFilterCount, 9)}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
      </TourTarget>
      <TouchableOpacity style={styles.iconBtn} onPress={() => setRefreshKey((v) => v + 1)}>
        <Feather name="refresh-ccw" size={18} color={Colors.accent} />
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

  // Load edit type fields when edit modal opens (for document type dropdown)
  useEffect(() => {
    if (!editOpen || !editRow) { setEditTypeFields([]); setEditDocFieldId(null); return; }
    setEditDocFieldId(editRow.asset_type_field_id || null);
    const typeId = assetMap[editRow.assetId]?.type_id || assetMap[editRow.assetId]?.asset_types?.id;
    if (!typeId) { setEditTypeFields([]); return; }
    let cancelled = false;
    fetchFields(typeId)
      .then((arr) => {
        if (cancelled) return;
        const isDoc = (f) => {
          const s = String(f?.field_type?.slug || '').toLowerCase();
          const n = String(f?.field_type?.name || '').toLowerCase();
          return s === 'url' || n === 'url' || s === 'document' || n === 'document' || n === 'documentation' || s === 'documentation';
        };
        setEditTypeFields(arr.filter(isDoc));
      })
      .catch((e) => {
        logger.warn('CertsView: edit type fields fetch failed', e?.message || e);
        if (!cancelled) setEditTypeFields([]);
      });
    return () => { cancelled = true; };
  }, [editOpen, editRow, assetMap]);

  const renderEditModal = () => (
      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit Certificate</Text>
            {!!editRow && (
              <>
                <Text style={styles.modalLabel}>Document Type</Text>
                {editTypeFields.length > 0 ? (
                  <View style={{ marginTop: 6 }}>
                    {editTypeFields.map((f) => (
                      <TouchableOpacity
                        key={f.id}
                        style={{
                          paddingVertical: 8,
                          paddingHorizontal: 12,
                          borderWidth: 2,
                          borderColor: editDocFieldId === f.id ? Colors.accent : Colors.line,
                          borderRadius: Radius.md,
                          marginBottom: 6,
                          backgroundColor: editDocFieldId === f.id ? Colors.accentMuted : Colors.card,
                        }}
                        onPress={() => setEditDocFieldId(f.id)}
                      >
                        <Text style={{ fontWeight: '700', color: Colors.text }}>{f.name || f.slug}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.modalValue}>{editRow.docLabel ? (isPhotoDoc(editRow.docLabel) ? `Image ${editRow.docLabel}` : editRow.docLabel) : '—'}</Text>
                )}

                <View style={{ marginTop: 8 }}>
                  <Text style={styles.modalLabel}>Current Document</Text>
                  {editRow.docUrl ? (
                    <TouchableOpacity onPress={() => openDocumentLink(editRow.docUrl)} style={[styles.inlineBtn, { marginTop: 6, alignSelf: 'flex-start' }]}>
                      <MaterialIcons name="open-in-new" size={16} color={Colors.accent} />
                      <Text style={styles.inlineBtnText}>Open</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={{ color: Colors.sub, marginTop: 6 }}>No file attached</Text>
                  )}
                </View>

                <Text style={[styles.modalLabel, { marginTop: 12 }]}>Valid Until</Text>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 6 }}>
                  <TouchableOpacity
                    style={[styles.inputLike, { flex: 1, justifyContent: 'center', minHeight: 44 }]}
                    onPress={() => setEditDateOpen(true)}
                    activeOpacity={0.7}
                  >
                    <Text style={{ color: editDate ? Colors.text : Colors.sub }}>
                      {editDate ? formatValidUntilDisplay(editDate) : 'Tap to choose date'}
                    </Text>
                  </TouchableOpacity>
                  {!!editDate && (
                    <TouchableOpacity style={[styles.btn, { backgroundColor: Colors.dangerBg }]} onPress={() => setEditDate('')}>
                      <Text style={{ color: Colors.dangerFg, fontWeight: '700' }}>Clear</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.quickDateRow}>
                  <TouchableOpacity onPress={() => setEditDate(addMonthsSafe(editDate, 3))} style={styles.quickDateChip}><Text style={styles.quickDateChipText}>+3 months</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => setEditDate(addMonthsSafe(editDate, 6))} style={styles.quickDateChip}><Text style={styles.quickDateChipText}>+6 months</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => setEditDate(addMonthsSafe(editDate, 12))} style={styles.quickDateChip}><Text style={styles.quickDateChipText}>+12 months</Text></TouchableOpacity>
                </View>

                <Text style={[styles.modalLabel, { marginTop: 12 }]}>Upload New Document (optional)</Text>
                <Text style={{ fontSize: sf(11), color: Colors.sub, marginBottom: 8, lineHeight: 16 }}>{CERT_DOCUMENT_UPLOAD_HINT}</Text>
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
                    if (!editRow) return;
                    const assetId = editRow.assetId;
                    const docId = editRow.id;
                    const fieldId = editDocFieldId ?? editRow.asset_type_field_id;
                    const toTitle = (s) => { const txt = String(s || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim(); return txt.split(' ').map(w => w ? (w[0].toUpperCase() + w.slice(1)) : '').join(' '); };
                    const selectedField = editTypeFields.find((f) => f.id === fieldId);
                    const niceName = selectedField ? (selectedField.name || selectedField.slug) : toTitle(editRow.docLabel);
                    const prevHadFile = !!editRow.docUrl;
                    try {
                      setEditBusy(true);
                      if (docOptional === null && fieldId && assetMap[assetId]) {
                        try {
                          const typeId = assetMap[assetId]?.type_id || assetMap[assetId]?.asset_types?.id;
                          if (typeId) {
                            const defs = await fetchFields(typeId);
                            const def = defs.find(d => String(d.id) === String(fieldId));
                            setDocOptional(def ? !def.is_required : null);
                          }
                        } catch (e) {
                          logger.warn('CertsView: docOptional field lookup failed', e?.message || e);
                        }
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
                        const dateToSend = editDate || (editRow.dateValue ? String(editRow.dateValue).split('T')[0] : '');
                        if (dateToSend) fd.append('related_date', dateToSend);
                        const uid = auth?.currentUser?.uid;
                        const headers = uid ? { 'X-User-Id': uid } : {};
                        const up = await fetch(`${API_BASE_URL}/assets/${assetId}/documents/upload`, { method: 'POST', body: fd, headers });
                        if (!up.ok) throw new Error(await up.text());
                        try { await fetch(`${API_BASE_URL}/assets/${assetId}/documents/${docId}`, { method: 'DELETE', headers }); } catch { }
                      } else {
                        const body = {};
                        if (editRow.dateLabel) body.related_date_label = editRow.dateLabel;
                        if (editDate) body.related_date = editDate; else body.related_date = null;
                        if (fieldId !== undefined && fieldId !== null) body.asset_type_field_id = fieldId;
                        body.title = niceName;
                        body.kind = niceName;
                        const uid = auth?.currentUser?.uid;
                        const headers = { 'Content-Type': 'application/json', ...(uid ? { 'X-User-Id': uid } : {}) };
                        const pr = await fetch(`${API_BASE_URL}/assets/${assetId}/documents/${docId}`, { method: 'PATCH', headers, body: JSON.stringify(body) });
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

  // Create new document modal
  const createFilteredAssets = useMemo(() => {
    if (!createAssetSearch.trim()) return allAssetsForPicker;
    const q = createAssetSearch.trim().toLowerCase();
    return allAssetsForPicker.filter(
      (a) =>
        String(a?.id || '').toLowerCase().includes(q) ||
        String(a?.model || '').toLowerCase().includes(q) ||
        String(a?.serial_number || '').toLowerCase().includes(q) ||
        String(a?.asset_types?.name || a?.type || '').toLowerCase().includes(q)
    );
  }, [allAssetsForPicker, createAssetSearch]);

  const renderCreateModal = () => (
    <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { maxWidth: 520 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Text style={styles.modalTitle}>
              {createStep === 1 ? 'Select asset' : createStep === 2 ? 'Select document type' : 'Upload document'}
            </Text>
            <TouchableOpacity onPress={() => setCreateOpen(false)} style={styles.inlineIconBtn}>
              <Feather name="x" size={18} color={Colors.primary} />
            </TouchableOpacity>
          </View>

          {createStep === 1 && (
            <>
              <Text style={styles.modalLabel}>Search assets by ID, model, serial or type</Text>
              <TextInput
                style={[styles.inputLike, { marginTop: 6, marginBottom: 12 }]}
                placeholder="Type to search..."
                value={createAssetSearch}
                onChangeText={setCreateAssetSearch}
                autoCapitalize="none"
              />
              {createAssetsLoading ? (
                <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 20 }} />
              ) : (
                <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator>
                  {createFilteredAssets.slice(0, 100).map((a) => (
                    <TouchableOpacity
                      key={a.id}
                      style={{
                        paddingVertical: 12,
                        paddingHorizontal: 12,
                        borderWidth: 1,
                        borderColor: selectedAsset?.id === a.id ? Colors.primary : '#E2E8F0',
                        borderRadius: 8,
                        marginBottom: 6,
                        backgroundColor: selectedAsset?.id === a.id ? '#EFF6FF' : '#fff',
                      }}
                      onPress={() => setSelectedAsset(a)}
                    >
                      <Text style={{ fontWeight: '700', color: '#0F172A' }}>{a.id}</Text>
                      <Text style={{ fontSize: sf(13), color: '#64748B', marginTop: 2 }}>
                        {a.asset_types?.name || a.type || '—'} {a.model ? `• ${a.model}` : ''}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  {createFilteredAssets.length === 0 && !createAssetsLoading && (
                    <Text style={{ color: '#64748B', paddingVertical: 20 }}>No assets match your search.</Text>
                  )}
                </ScrollView>
              )}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <TouchableOpacity style={[styles.btn, styles.btnGhost, { flex: 1 }]} onPress={() => setCreateOpen(false)}>
                  <Text>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary, { flex: 1, opacity: selectedAsset ? 1 : 0.5 }]}
                  disabled={!selectedAsset}
                  onPress={() => setCreateStep(2)}
                >
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Next</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {createStep === 2 && (
            <>
              {selectedAsset && (
                <View style={{ marginBottom: 12, padding: 10, backgroundColor: '#F8FAFC', borderRadius: 8 }}>
                  <Text style={{ fontSize: sf(12), color: '#64748B' }}>Asset</Text>
                  <Text style={{ fontWeight: '700', color: '#0F172A' }}>{selectedAsset.id}</Text>
                  <TouchableOpacity onPress={() => setCreateStep(1)} style={{ marginTop: 6 }}>
                    <Text style={styles.inlineBtnText}>Change asset</Text>
                  </TouchableOpacity>
                </View>
              )}
              {createTypeFieldsLoading ? (
                <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 20 }} />
              ) : createTypeFields.length === 0 ? (
                <View style={{ marginVertical: 16 }}>
                  <Text style={{ color: '#64748B', marginBottom: 12 }}>
                    No document fields were found for this asset&apos;s type. If you added custom fields (e.g. Calibration certificate, Calibration certificate expiry) in Asset Type settings, make sure this asset has that type assigned. Otherwise add Document and Date fields in the asset type settings.
                  </Text>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnPrimary]}
                    onPress={() => {
                      const typeId = createAssetDetails?.type_id || selectedAsset?.type_id || selectedAsset?.asset_types?.id;
                      setCreateOpen(false);
                      if (typeId) router.push({ pathname: '/type/edit', params: { id: typeId } });
                      else router.push('/');
                    }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700' }}>{createAssetDetails?.type_id || selectedAsset?.asset_types?.id ? 'Open asset type settings' : 'Back'}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <Text style={styles.modalLabel}>Document type</Text>
                  <View style={{ marginTop: 6, marginBottom: 16 }}>
                    {createTypeFields.map((f) => (
                      <TouchableOpacity
                        key={f.id}
                        style={{
                          paddingVertical: 10,
                          paddingHorizontal: 12,
                          borderWidth: 1,
                          borderColor: selectedDocField?.id === f.id ? Colors.primary : '#E2E8F0',
                          borderRadius: 8,
                          marginBottom: 6,
                          backgroundColor: selectedDocField?.id === f.id ? '#EFF6FF' : '#fff',
                        }}
                        onPress={() => setSelectedDocField(f)}
                      >
                        <Text style={{ fontWeight: '700', color: Colors.text }}>{f.name || f.slug}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {createDateDocLinks.length > 0 ? (
                    <View style={{ marginBottom: 16 }}>
                      <Text style={[styles.modalLabel, { marginBottom: 6 }]}>Dates with linked documents</Text>
                      <Text style={{ fontSize: sf(12), color: '#64748B', marginBottom: 8 }}>
                        This asset has date fields linked to document types. Tap a row to use that date for the new document.
                      </Text>
                      <View style={{ gap: 6 }}>
                        {createDateDocLinks.map((link) => (
                          <TouchableOpacity
                            key={`${link.dateField.id}-${link.linkedDocField.id}`}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              paddingVertical: 8,
                              paddingHorizontal: 10,
                              borderWidth: 1,
                              borderColor: createDate === link.dateValue ? Colors.primary : '#E2E8F0',
                              borderRadius: 8,
                              backgroundColor: createDate === link.dateValue ? '#EFF6FF' : '#F8FAFC',
                            }}
                            onPress={() => {
                              setCreateDate(link.dateValue || '');
                              setCreateDateLabel(link.dateField.name || '');
                              setSelectedDocField(createTypeFields.find((f) => f.id === link.linkedDocField.id) || selectedDocField);
                            }}
                          >
                            <Feather name="calendar" size={14} color="#64748B" style={{ marginRight: 8 }} />
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontWeight: '600', color: '#0F172A', fontSize: sf(13) }}>{link.dateField.name}</Text>
                              <Text style={{ fontSize: sf(12), color: '#64748B', marginTop: 2 }}>
                                {link.dateValue ? formatValidUntilDisplay(link.dateValue) : 'No date set'} → {link.linkedDocField.name}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  ) : null}
                  <Text style={[styles.modalLabel, { marginTop: 8 }]}>File (required)</Text>
                  <Text style={{ fontSize: sf(11), color: Colors.sub, marginBottom: 4, lineHeight: 16 }}>{CERT_DOCUMENT_UPLOAD_HINT}</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                    <TouchableOpacity
                      style={styles.btn}
                      onPress={async () => {
                        try {
                          const res = await DocumentPicker.getDocumentAsync({
                            multiple: false,
                            type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/*'],
                          });
                          if (res.canceled) return;
                          const a = res.assets?.[0];
                          if (a) setCreateFile(a);
                        } catch (e) {
                          Alert.alert('Error', e?.message || 'Failed to select file');
                        }
                      }}
                    >
                      <Text>{createFile ? 'Change file' : 'Choose file'}</Text>
                    </TouchableOpacity>
                    {createFile ? (
                      <Text style={{ alignSelf: 'center', color: '#64748B' }} numberOfLines={1}>{createFile.name}</Text>
                    ) : null}
                  </View>
                  <Text style={[styles.modalLabel, { marginTop: 12 }]}>Valid Until (optional)</Text>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 6 }}>
                    <TouchableOpacity
                      style={[styles.inputLike, { flex: 1, justifyContent: 'center', minHeight: 44 }]}
                      onPress={() => setCreateDatePickerOpen(true)}
                      activeOpacity={0.7}
                    >
                      <Text style={{ color: createDate ? Colors.text : Colors.sub }}>
                        {createDate ? formatValidUntilDisplay(createDate) : 'Tap to choose date'}
                      </Text>
                    </TouchableOpacity>
                    {!!createDate && (
                      <TouchableOpacity
                        style={[styles.btn, { backgroundColor: Colors.dangerBg }]}
                        onPress={() => { setCreateDate(''); setCreateDateLabel(''); }}
                      >
                        <Text style={{ color: Colors.dangerFg, fontWeight: '700' }}>Clear</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
                    <TouchableOpacity style={[styles.btn, styles.btnGhost, { flex: 1 }]} onPress={() => setCreateStep(1)}>
                      <Text>Back</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      disabled={createBusy || !selectedDocField || !createFile}
                      style={[styles.btn, styles.btnPrimary, { flex: 1, opacity: createFile && selectedDocField ? 1 : 0.5 }]}
                      onPress={async () => {
                        if (!selectedAsset || !selectedDocField || !createFile) return;
                        setCreateBusy(true);
                        try {
                          const fd = new FormData();
                          if (Platform.OS === 'web') {
                            try {
                              const resp = await fetch(createFile.uri);
                              const blob = await resp.blob();
                              const file = new File([blob], createFile.name || 'document.pdf', {
                                type: createFile.mimeType || blob.type || 'application/pdf',
                              });
                              fd.append('file', file, file.name);
                            } catch {
                              fd.append('file', { uri: createFile.uri, name: createFile.name || 'document.pdf', type: createFile.mimeType || 'application/pdf' });
                            }
                          } else {
                            fd.append('file', { uri: createFile.uri, name: createFile.name || 'document.pdf', type: createFile.mimeType || 'application/pdf' });
                          }
                          fd.append('asset_type_field_id', selectedDocField.id);
                          fd.append('title', selectedDocField.name || selectedDocField.slug);
                          fd.append('kind', selectedDocField.name || selectedDocField.slug);
                          if (createDate) {
                            fd.append('related_date', createDate);
                            fd.append('related_date_label', createDateLabel || selectedDocField.name || selectedDocField.slug || 'Valid Until');
                          }
                          const uid = auth?.currentUser?.uid;
                          const headers = uid ? { 'X-User-Id': uid } : {};
                          const r = await fetch(`${API_BASE_URL}/assets/${selectedAsset.id}/documents/upload`, {
                            method: 'POST',
                            body: fd,
                            headers,
                          });
                          if (!r.ok) throw new Error(await r.text());
                          setCreateOpen(false);
                          setRefreshKey((k) => k + 1);
                        } catch (e) {
                          Alert.alert('Error', e?.message || 'Failed to upload document');
                        } finally {
                          setCreateBusy(false);
                        }
                      }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '700' }}>{createBusy ? 'Uploading…' : 'Upload'}</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
              {createTypeFields.length > 0 && (
                <TouchableOpacity style={{ marginTop: 12 }} onPress={() => setCreateStep(1)}>
                  <Text style={styles.inlineBtnText}>← Back to asset selection</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  );

  // Palette via centralized tokens

  const columns = [
    { key: 'asset', label: 'Asset ID', flex: 1, minWidth: 112 },
    { key: 'type', label: 'Asset Type', flex: 1, minWidth: 132 },
    { key: 'model', label: 'Model', flex: 1, minWidth: 120 },
    { key: 'assigned', label: 'Assigned To', flex: 1, minWidth: 152 },
    { key: 'documentType', label: 'Document Type', flex: 1.15, minWidth: 220 },
    { key: 'attachment', label: 'Document', flex: 1.15, minWidth: 200 },
    { key: 'date', label: 'Valid Until', flex: 1.4, minWidth: 180 },
    { key: 'updated', label: 'Last Updated', flex: 1, minWidth: 124 },
    { key: 'actions', label: 'Actions', flex: 1, minWidth: 168 },
  ];

  const isPhotoDoc = (label) => /photo|image|picture|task photo/i.test(String(label || ''));

  const computedWidths = useMemo(() => {
    const map = {};
    const pad = 0;
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

  const tableContentMinWidth = useMemo(
    () => columns.reduce((sum, c) => sum + (computedWidths[c.key] ?? c.minWidth ?? 120), 0),
    [columns, computedWidths],
  );

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
        <Text style={styles.sectionTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>Certificates & Documents</Text>
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
        <TourTarget id="web-certs-search">
        <View style={styles.toolbarRow}>
          <SearchInput
            placeholder="Search by asset, type, model, assigned…"
            value={filterText}
            onChangeText={setFilterText}
            style={{ flex: 1 }}
            inputStyle={{ fontSize: sf(16) }}
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {actionsNode}
              </View>
            }
          />
        </View>
        {/* My documents quick chip under search + New document on the right */}
        <View style={[styles.quickRow, { marginTop: 8, justifyContent: 'space-between', flexWrap: 'wrap' }]}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip label="My documents" icon="user" active={onlyMine} onPress={() => setOnlyMine((v) => !v)} />
            <Chip label="Expiring soon" tone="warning" active={filterExp === 'soon'} onPress={() => setFilterExp((prev) => (prev === 'soon' ? '' : 'soon'))} />
            <Chip label="Expired" tone="danger" active={filterExp === 'expired'} onPress={() => setFilterExp((prev) => (prev === 'expired' ? '' : 'expired'))} />
          </View>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}
            onPress={() => {
              setCreateOpen(true);
              setCreateStep(1);
              setCreateAssetSearch('');
              setSelectedAsset(null);
              setSelectedDocField(null);
              setCreateTypeFields([]);
              setCreateFile(null);
              setCreateDate('');
              setCreateDateLabel('');
              setCreateDatePickerOpen(false);
            }}
          >
            <MaterialIcons name="add" size={20} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700' }}>New document</Text>
          </TouchableOpacity>
        </View>
        </TourTarget>
      </View>
      {renderEditModal()}
      {renderCreateModal()}
      <DatePickerModal
        locale="en-GB"
        mode="single"
        visible={editDateOpen}
        onDismiss={() => setEditDateOpen(false)}
        date={editDate ? new Date(`${editDate}T12:00:00`) : new Date()}
        onConfirm={({ date }) => {
          setEditDateOpen(false);
          if (date) setEditDate(toISO(date));
        }}
      />
      <DatePickerModal
        locale="en-GB"
        mode="single"
        visible={createDatePickerOpen}
        onDismiss={() => setCreateDatePickerOpen(false)}
        date={createDate ? new Date(`${createDate}T12:00:00`) : new Date()}
        onConfirm={({ date }) => {
          setCreateDatePickerOpen(false);
          if (date) setCreateDate(toISO(date));
        }}
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
      <DatePickerModal
        locale="en-GB"
        mode="single"
        visible={filterStartOpen}
        onDismiss={() => setFilterStartOpen(false)}
        date={filterRange.start ? new Date(`${filterRange.start}T12:00:00`) : new Date()}
        onConfirm={({ date }) => {
          setFilterStartOpen(false);
          if (date) setFilterRange((r) => ({ ...r, start: toISO(date) }));
        }}
      />
      <DatePickerModal
        locale="en-GB"
        mode="single"
        visible={filterEndOpen}
        onDismiss={() => setFilterEndOpen(false)}
        date={filterRange.end ? new Date(`${filterRange.end}T12:00:00`) : new Date()}
        onConfirm={({ date }) => {
          setFilterEndOpen(false);
          if (date) setFilterRange((r) => ({ ...r, end: toISO(date) }));
        }}
      />
      <Text style={[styles.metaText, { marginHorizontal: 16, marginBottom: (Platform.OS !== 'web' || isCompact) ? 12 : 6 }]}>
        {safeFilteredRows.length} document{safeFilteredRows.length === 1 ? '' : 's'}
      </Text>

      {/* Mobile Card View - match search iOS: list is a flex child so it takes remaining height */}
      {Platform.OS !== 'web' || isCompact ? (
        <TourTarget id="web-certs-list" style={(Platform.OS !== 'web' || isCompact) ? { flex: 1, minHeight: 0 } : undefined}>
        <ScrollView
          style={styles.mobileScroll}
          contentContainerStyle={[
            styles.mobileScrollContent,
            { paddingBottom: 24 + (isNative ? insets.bottom : 0) },
            safeFilteredRows.length > 0 && (Platform.OS !== 'web' ? { flexGrow: 1 } : undefined),
          ]}
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
                  dateDisplay = r.dateValue ? formatValidUntilDisplay(r.dateValue) : '—';
                  updatedDisplay = r.updatedAt ? formatDisplayDate(r.updatedAt) : '—';
                } catch (error) {
                  logger.warn('Error formatting dates:', error);
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
                          <MaterialIcons name={isPhotoDoc(r.docLabel) ? 'insert-photo' : 'description'} size={22} color={Colors.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <MaterialIcons name={isPhotoDoc(r.docLabel) ? 'insert-photo' : 'description'} size={16} color="#64748B" />
                            <Text style={styles.mobileCardTitle} numberOfLines={1}>{isPhotoDoc(r.docLabel) ? `Image ${r.docLabel}` : r.docLabel}</Text>
                          </View>
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
                      {r.dateLabel || r.dateValue ? (
                        <View style={styles.mobileDetailRow}>
                          <Feather name="calendar" size={14} color="#64748B" />
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
                      {r.docUrl ? (
                        <TouchableOpacity
                          onPress={() => openDocumentLink(r.docUrl)}
                          style={[styles.mobileActionBtn, styles.mobileActionBtnPrimary]}
                        >
                          <MaterialIcons name="insert-photo" size={18} color="#fff" />
                          <Text style={styles.mobileActionBtnText}>Open</Text>
                        </TouchableOpacity>
                      ) : (
                        <View style={[styles.mobileActionBtn, { backgroundColor: '#E2E8F0', opacity: 0.9 }]}>
                          <MaterialIcons name="insert-photo" size={18} color="#64748B" />
                          <Text style={[styles.mobileActionBtnText, { color: '#64748B' }]}>No photos</Text>
                        </View>
                      )}
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
                            const uid = auth?.currentUser?.uid;
                            const delHeaders = uid ? { 'X-User-Id': uid } : {};
                            if (auth?.currentUser?.displayName) delHeaders['X-User-Name'] = auth.currentUser.displayName;
                            if (auth?.currentUser?.email) delHeaders['X-User-Email'] = auth.currentUser.email;
                            const resp = await fetch(url, { method: 'DELETE', headers: delHeaders });
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
        </TourTarget>
      ) : (
        /* Desktop Table View */
        <TourTarget id="web-certs-list" style={{ flex: 1, minHeight: 0 }}>
      <View style={[styles.tableWrap, { flex: 1 }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          style={{ flex: 1 }}
          ref={contentRef}
          onLayout={(e) => { const vw = e?.nativeEvent?.layout?.width || 0; setHViewportW(vw); }}
          onContentSizeChange={(w/*, h*/) => { setHContentW(w || 0); }}
        >
          <View style={{ minWidth: Math.max(hViewportW || 0, tableContentMinWidth) }}>
            <View style={styles.tableHeader}>
              {columns.map((c) => {
                const isSortable = sortableColumnKeys.includes(c.key);
                const isActive = sort.field === c.key;
                const label = c.key === 'asset' ? 'Asset Id' : c.key === 'type' ? 'Asset type' : c.label;
                if (!isSortable) {
                  return (
                    <View key={c.key} style={[styles.th, { width: computedWidths[c.key] }]}>
                      <Text style={styles.thText}>{label}</Text>
                    </View>
                  );
                }
                return (
                  <TouchableOpacity
                    key={c.key}
                    style={[styles.th, styles.thSortable, { width: computedWidths[c.key] }]}
                    onPress={() => {
                      const nextDir = isActive
                        ? (sort.dir === 'asc' ? 'desc' : 'asc')
                        : (c.key === 'date' || c.key === 'updated' ? 'desc' : 'asc');
                      setSort({ field: c.key, dir: nextDir });
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.thSortableInner, Platform.OS === 'web' && { direction: 'ltr' }]}>
                      <Text style={[styles.thText, isActive && { color: Colors.accent }]} numberOfLines={2}>{label}</Text>
                      {isActive ? (
                        <Feather
                          name={sort.dir === 'asc' ? 'chevron-up' : 'chevron-down'}
                          size={14}
                          color={Colors.accent}
                          style={styles.thSortIcon}
                        />
                      ) : (
                        <Feather name="chevron-down" size={12} color="rgba(255,255,255,0.45)" style={styles.thSortIcon} />
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
            <ScrollView style={styles.tableBodyScroll} showsVerticalScrollIndicator>
                {paginatedRows.map((r, idx) => {
                const dateDisplay = r.dateValue ? formatValidUntilDisplay(r.dateValue) : '—';
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
                    {/* Document type (text) */}
                    <View style={[styles.td, { width: computedWidths['documentType'] }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <MaterialIcons name={isPhotoDoc(r.docLabel) ? 'insert-photo' : 'description'} size={18} color="#64748B" />
                        <Text style={styles.tdText} numberOfLines={1}>{isPhotoDoc(r.docLabel) ? `Image ${r.docLabel || ''}` : (r.docLabel || '—')}</Text>
                      </View>
                    </View>
                    {/* Document / Attachment (link) */}
                    <View style={[styles.td, { width: computedWidths['attachment'] }]}>
                      {r.docUrl ? (
                        <TouchableOpacity style={styles.link} onPress={() => openDocumentLink(r.docUrl)}>
                          <MaterialIcons name={isPhotoDoc(r.docLabel) ? 'insert-photo' : 'description'} size={16} color={Colors.primary} />
                          <Text style={styles.linkText} numberOfLines={1}>Open document</Text>
                          <MaterialIcons name="open-in-new" size={16} color={Colors.accent} />
                        </TouchableOpacity>
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <MaterialIcons name="insert-photo" size={16} color="#94A3B8" />
                          <Text style={[styles.tdText, { color: '#94A3B8', fontStyle: 'italic' }]} numberOfLines={1}>No photos</Text>
                        </View>
                      )}
                    </View>
                    {/* Date */}
                    <View style={[styles.td, { width: computedWidths['date'] }]}>
                      <Text style={[styles.dateValue, status === 'soon' && styles.dateValueSoon, status === 'expired' && styles.dateValueExpired]} numberOfLines={1}>{dateDisplay}</Text>
                    </View>
                    {/* Last Updated (date only) */}
                    <View style={[styles.td, { width: computedWidths['updated'] }]}>
                      <Text style={styles.dateValue} numberOfLines={1}>{updatedDisplay}</Text>
                    </View>
                    {/* Actions */}
                    <View style={[styles.td, styles.tdActions, { width: computedWidths['actions'] }]}>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TableIconButton
                          icon="download"
                          tone="download"
                          onPress={() => openDocumentLink(r.docUrl)}
                          accessibilityLabel="Download document"
                        />
                        <TableIconButton
                          icon="edit"
                          tone="edit"
                          onPress={() => {
                            setEditRow(r);
                            setEditDate((r.dateValue ? String(r.dateValue).split('T')[0] : ''));
                            setEditFile(null);
                            setDocOptional(null);
                            setEditOpen(true);
                          }}
                          accessibilityLabel="Edit document"
                        />
                        <TableIconButton
                          icon="delete"
                          tone="delete"
                          loading={deleteBusyId === r.id}
                          disabled={deleteBusyId === r.id}
                          accessibilityLabel="Delete document"
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
                              const uid = auth?.currentUser?.uid;
                              const headers = uid ? { 'X-User-Id': uid } : {};
                              if (auth?.currentUser?.displayName) headers['X-User-Name'] = auth.currentUser.displayName;
                              if (auth?.currentUser?.email) headers['X-User-Email'] = auth.currentUser.email;
                              const resp = await fetch(url, { method: 'DELETE', headers });
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
                        />
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
            <TablePagination
              page={page}
              pageSize={pageSize}
              total={safeFilteredRows.length}
              onPageChange={setPage}
              onPageSizeChange={(sz) => { setPageSize(sz); setPage(1); }}
            />
          )}
        </View>
        </TourTarget>
      )}
    </View>
  );
}

CertsView.propTypes = { initialVisible: PropTypes.bool };
CertsView.defaultProps = { initialVisible: false };

const styles = StyleSheet.create({
  certsWrap: { flex: 1, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: Colors.bg },
  certsWrapMobile: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 32 },
  sectionTitle: { fontSize: sf(22), fontWeight: '800', color: Colors.text, marginBottom: 10, textTransform: 'uppercase', flexShrink: 1 },
  toolbarSurface: { marginBottom: 8 },
  toolbarRow: { gap: 8, marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inlineIconBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.accentMuted, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.accent },
  quickRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  metaText: { fontSize: sf(13), color: Colors.sub, fontWeight: '700' },
  iconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.accentMuted, alignItems: 'center', justifyContent: 'center' },
  actionBtn: { paddingHorizontal: 12, height: 34, borderRadius: Radius.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  actionBtnText: { color: Colors.accent, fontWeight: '700', fontSize: sf(13), textTransform: 'uppercase' },
  countDot: { position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: Colors.dangerFg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  countDotText: { color: '#fff', fontSize: sf(10), fontWeight: '700' },
  tableWrap: { backgroundColor: Colors.card, borderRadius: Radius.lg, borderWidth: 2, borderColor: Colors.line, overflow: 'hidden', ...Shadows.card },
  tableHeader: { flexDirection: 'row', backgroundColor: Colors.primary, borderBottomWidth: 0, alignItems: 'stretch', flexShrink: 0 },
  th: { paddingVertical: 13, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center', flexShrink: 0, borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.1)' },
  thSortable: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  thSortableInner: { flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap', flex: 1, justifyContent: 'center' },
  thSortIcon: { marginLeft: 4, flexShrink: 0 },
  thText: { fontSize: sf(12), fontWeight: '800', color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 1, minWidth: 0, textAlign: 'center' },
  tableBodyScroll: {
    flex: 1,
    ...Platform.select({
      web: { backgroundColor: Colors.bg },
      default: {},
    }),
  },
  tr: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
    backgroundColor: Platform.OS === 'web' ? Colors.card : '#FFFFFF',
    alignItems: 'center',
    flexShrink: 0,
  },
  rowAlt: {
    backgroundColor: Platform.OS === 'web' ? Colors.bg : '#F8FAFC',
  },
  rowHover: { backgroundColor: Colors.accentLight },
  td: { paddingVertical: 8, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center', flexShrink: 0, overflow: 'hidden' },
  tdActions: { alignItems: 'center' },
  tdText: { fontSize: sf(13), color: Colors.text, fontWeight: '500', textAlign: 'center' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkText: { fontSize: sf(13), color: Colors.primary, fontWeight: '700' },
  dateLabel: { fontSize: sf(12), color: Colors.sub, marginBottom: 2, textTransform: 'uppercase', fontWeight: '700', letterSpacing: 0.3 },
  dateValue: { fontSize: sf(13), color: Colors.text, fontWeight: '600', textAlign: 'center' },
  dateValueSoon: { color: Colors.warningFg },
  dateValueExpired: { color: Colors.dangerFg },
  errorText: { color: Colors.dangerFg, fontWeight: '700', marginVertical: 10 },
  emptyText: { color: Colors.sub, fontStyle: 'italic', marginTop: 10 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 16, borderRadius: Radius.md, backgroundColor: Colors.accentMuted },
  btnPrimary: { backgroundColor: Colors.accent },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 2, borderColor: Colors.line },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { backgroundColor: Colors.card, borderRadius: Radius.lg, padding: 24, width: '100%', maxWidth: 480, ...Shadows.card },
  modalTitle: { fontSize: sf(20), fontWeight: '800', color: Colors.text, marginBottom: 16, textTransform: 'uppercase' },
  modalLabel: { fontSize: sf(13), fontWeight: '700', color: Colors.sub, marginBottom: 4 },
  modalValue: { fontSize: sf(16), color: Colors.text, fontWeight: '700' },
  inlineBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: Radius.sm, backgroundColor: Colors.accentMuted },
  inlineBtnText: { fontSize: sf(13), fontWeight: '700', color: Colors.accent },
  filterSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: Colors.card, borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg, padding: 20, ...Shadows.card, maxHeight: '78%' },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  groupTitle: { fontSize: sf(14), fontWeight: '800', color: Colors.text, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  filterMenuRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  chipsRow: { flexWrap: 'wrap' },
  quickDateRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  quickDateChip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: Radius.sm, backgroundColor: Colors.chip, borderWidth: 2, borderColor: Colors.line },
  quickDateChipText: { color: Colors.text, fontWeight: '700' },
  inputLike: { borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: Colors.card },
  inputLikeText: { color: Colors.text, fontWeight: '700' },
  // Mobile card view
  mobileScroll: { flex: 1 },
  mobileScrollContent: { paddingHorizontal: 12, paddingBottom: 24 },
  gridContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  mobileCard: {
    width: '100%',
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: 16,
    borderWidth: 2,
    borderColor: Colors.line,
    ...Shadows.card,
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
    borderRadius: Radius.md,
    backgroundColor: Colors.accentMuted,
    borderWidth: 2,
    borderColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobileCardTitle: {
    fontSize: sf(17),
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 4,
  },
  mobileCardSubtitle: {
    fontSize: sf(13),
    color: Colors.sub,
    fontWeight: '700',
  },
  mobileStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primaryLight,
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  mobileStatusBadgeExpired: {
    backgroundColor: Colors.dangerBg,
    borderColor: Colors.dangerFg,
  },
  mobileStatusBadgeSoon: {
    backgroundColor: Colors.warningBg,
    borderColor: Colors.warningFg,
  },
  mobileStatusText: {
    fontSize: sf(11),
    fontWeight: '800',
    color: Colors.primary,
  },
  mobileStatusTextExpired: {
    color: Colors.dangerFg,
  },
  mobileStatusTextSoon: {
    color: Colors.warningFg,
  },
  mobileCardDetails: {
    gap: 10,
    marginBottom: 12,
    paddingTop: 12,
    borderTopWidth: 2,
    borderTopColor: Colors.line,
  },
  mobileDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mobileDetailLabel: {
    fontSize: sf(13),
    color: Colors.sub,
    fontWeight: '700',
    minWidth: 80,
  },
  mobileDetailValue: {
    fontSize: sf(13),
    color: Colors.text,
    fontWeight: '700',
    flex: 1,
  },
  mobileDetailValueSoon: {
    color: Colors.warningFg,
    fontWeight: '800',
  },
  mobileDetailValueExpired: {
    color: Colors.dangerFg,
    fontWeight: '800',
  },
  mobileCardActions: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 2,
    borderTopColor: Colors.line,
  },
  mobileActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: Radius.md,
  },
  mobileActionBtnPrimary: {
    backgroundColor: Colors.primary,
  },
  mobileActionBtnEdit: { backgroundColor: Colors.warningFg },
  mobileActionBtnDelete: { backgroundColor: Colors.dangerFg },
  mobileActionBtnText: { color: '#FFFFFF', fontSize: sf(14), fontWeight: '700', textTransform: 'uppercase' },
  mobileEmptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  mobileEmptyText: {
    fontSize: sf(16),
    fontWeight: '800',
    color: Colors.text,
    marginTop: 12,
  },
  mobileEmptySubtext: {
    fontSize: sf(13),
    color: Colors.sub,
    marginTop: 4,
  },
});
