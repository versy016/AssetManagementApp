// hooks/useAssetDetail.js
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, View, Text, TouchableOpacity, Linking, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { differenceInCalendarDays, format, isValid, parseISO } from 'date-fns';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebaseConfig';
import { API_BASE_URL, CHECKIN_WEB_BASE_URL } from '../inventory-api/apiBase';
import { fetchFields } from './useAssetTypeFields';
import logger from '../utils/logger';
import { showError, showSuccess, confirm } from '../utils/showError';
import { normalizeStatus } from '../components/ui/StatusBadge';
import { transferRecipientMatchesFirebaseUser } from '../utils/activityLabels';
import { getAuthHeaders } from '../utils/authHeaders';
import { Colors } from '../constants/uiTheme';

// Helper: format dates like "10 Oct 2025"
function prettyDate(d) {
  try {
    if (!d) return 'N/A';
    let dt = null;
    if (typeof d === 'string') {
      const s = d.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const [y, m, day] = s.split('-').map(Number);
        dt = new Date(y, m - 1, day);
      } else {
        const parsed = parseISO(s);
        dt = isValid(parsed) ? parsed : new Date(s);
      }
    } else if (d instanceof Date) {
      dt = d;
    } else {
      const t = new Date(d);
      dt = Number.isNaN(+t) ? null : t;
    }
    if (!dt || !isValid(dt)) return 'N/A';
    return format(dt, 'dd MMM yyyy');
  } catch { return 'N/A'; }
}

// Cross-platform clipboard
async function copyText(text, successMsg = 'Copied to clipboard') {
  try {
    if (Platform.OS === 'web') {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const el = document.createElement('textarea');
        el.value = text;
        el.setAttribute('readonly', '');
        el.style.position = 'absolute';
        el.style.left = '-9999px';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      window.alert(successMsg);
      return;
    }
    if (Clipboard?.setString) {
      Clipboard.setString(text);
      Alert.alert('Copied', successMsg);
      return;
    }
    throw new Error('Clipboard unavailable');
  } catch {
    Platform.OS === 'web'
      ? window.prompt('Copy this text:', text)
      : Alert.alert('Copy failed', 'Could not copy to clipboard.');
  }
}

export function useAssetDetail({ assetId, returnTo }) {
  const router = useRouter();
  const navigation = useNavigation();

  // State
  const [asset, setAsset] = useState(null);
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [authUser, setAuthUser] = useState(() => auth.currentUser || null);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [notesSectionExpanded, setNotesSectionExpanded] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [typeFields, setTypeFields] = useState([]);
  const [assetDocs, setAssetDocs] = useState([]);
  const [dateDocLinks, setDateDocLinks] = useState({});
  const [docLabels, setDocLabels] = useState({});
  const [attachBusySlug, setAttachBusySlug] = useState('');
  const [docDeletingId, setDocDeletingId] = useState(null);
  const [docHistoryOpen, setDocHistoryOpen] = useState(false);
  const [maintenanceExpanded, setMaintenanceExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState('notes');

  // Normalize returnTo
  const normalizedReturnTo = Array.isArray(returnTo) ? returnTo[0] : returnTo;

  // Detect imported (UUID) assets
  const isUUID = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
  const isImportedId = useMemo(() => isUUID(String(assetId || '')), [assetId]);

  // Parse returnTo target
  const parseReturnTarget = useCallback((target) => {
    if (!target) return null;
    if (typeof target === 'object') return target;
    if (typeof target === 'string') {
      const [path, query = ''] = target.split('?');
      if (!path) return null;
      const params = {};
      if (query) {
        query.split('&').forEach((part) => {
          if (!part) return;
          const [rawKey, rawValue = ''] = part.split('=');
          const key = decodeURIComponent(rawKey || '');
          if (!key) return;
          params[key] = decodeURIComponent(rawValue || '');
        });
      }
      return { pathname: path, params };
    }
    return null;
  }, []);

  // Navigate to returnTo target
  const navigateToReturnTarget = useCallback((target) => {
    const parsed = parseReturnTarget(target);
    if (!parsed) return false;
    try {
      router.replace(parsed);
      return true;
    } catch {
      return false;
    }
  }, [parseReturnTarget, router]);

  // Load asset data
  const load = useCallback(async () => {
    if (!assetId) return;
    setLoading(true);
    setErr('');
    try {
      if (isImportedId) {
        throw new Error('This imported asset is hidden until a QR is assigned to it. Assign via Transfer to office > Assign Imported Asset.');
      }
      const res = await fetch(`${API_BASE_URL}/assets/${assetId}`);
      if (!res.ok) throw new Error(`Failed to load asset (${res.status})`);
      const data = await res.json();
      setAsset(data);

      // Load type field definitions (served from module-level cache via useAssetTypeFields)
      try {
        const typeId = data?.type_id || data?.asset_types?.id;
        if (typeId) {
          const arr = await fetchFields(typeId);
          setTypeFields(arr);
          const links = {};
          const docNames = {};
          const bySlug = Object.fromEntries(arr.map(d => [String(d.slug || '').toLowerCase(), d]));
          for (const d of arr) {
            const code = String(d?.field_type?.slug || d?.field_type?.name || '').toLowerCase();
            if (code !== 'date') continue;
            try {
              const vr = d.validation_rules && typeof d.validation_rules === 'object' ? d.validation_rules : (d.validation_rules ? JSON.parse(d.validation_rules) : null);
              const link = vr && (vr.requires_document_slug || vr.require_document_slug);
              const raw = Array.isArray(link) ? (link[0] || '') : (link || '');
              const docSlug = String(raw || '').toLowerCase();
              if (docSlug) {
                const dateSlug = String(d.slug || '').toLowerCase();
                links[dateSlug] = docSlug;
                const docDef = bySlug[docSlug];
                const label = docDef?.name || docDef?.label || docDef?.slug || raw;
                docNames[docSlug] = label;
              }
            } catch (e) {
              logger.warn('useAssetDetail: doc-link field parse failed', e?.message || e);
            }
          }
          setDateDocLinks(links);
          setDocLabels(docNames);
        }
      } catch (e) {
        logger.warn('useAssetDetail: date-doc-links setup failed', e?.message || e);
      }

      // Load DB-backed documents
      try {
        const dr = await fetch(`${API_BASE_URL}/asset-documents/documents?assetId=${encodeURIComponent(assetId)}`);
        if (dr.ok) {
          const dj = await dr.json();
          setAssetDocs(Array.isArray(dj?.items) ? dj.items : Array.isArray(dj) ? dj : []);
        } else { setAssetDocs([]); }
      } catch { setAssetDocs([]); }

      // Load actions
      try {
        const ar = await fetch(`${API_BASE_URL}/assets/${assetId}/actions`);
        if (ar.ok) {
          const json = await ar.json();
          setActions(Array.isArray(json?.actions) ? json.actions : []);
        } else {
          setActions([]);
        }
      } catch {
        setActions([]);
      }
    } catch (e) {
      setErr(e.message || 'Failed to load asset');
    } finally {
      setLoading(false);
    }
  }, [assetId, isImportedId]);

  // Auth user + admin status
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setAuthUser(u || null);
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

  useEffect(() => { load(); }, [load]);

  // Derived: custom field entries
  const customFieldEntries = useMemo(() => {
    if (!asset?.fields || typeof asset.fields !== 'object') return [];
    const normKey = (k) => String(k || '').toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
    return Object.entries(asset.fields).filter(([k]) => normKey(k) !== 'serial_number');
  }, [asset]);

  // Derived: linked asset IDs
  const linkedAssetIds = useMemo(() => {
    if (!asset?.fields || typeof asset.fields !== 'object') return [];
    const f = asset.fields;
    const candidates = new Set();
    ['linked_asset_id','related_asset_id','related_assets','parent_asset_id','child_asset_ids','paired_with']
      .forEach((k) => {
        const v = f[k];
        if (!v) return;
        if (Array.isArray(v)) v.forEach((x) => typeof x === 'string' && x !== asset?.id && candidates.add(x));
        else if (typeof v === 'string' && v !== asset?.id) candidates.add(v);
      });
    return Array.from(candidates);
  }, [asset]);

  // Format field label
  const formatFieldLabel = (slug) => {
    try {
      const s = String(slug || '').replace(/_/g, ' ').trim();
      return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    } catch { return String(slug || ''); }
  };

  // Render value (with helpers)
  const renderValue = (slug, v, helpers = {}) => {
    const isUrl = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);
    const isDocLike = (s) => /\.(pdf|docx?|xls[x]?|pptx?)($|\?)/i.test(s);

    if (typeof v === 'string' && isUrl(v) && isDocLike(v)) {
      return { isLink: true, url: v };
    }
    if (typeof v === 'string' && isUrl(v)) {
      return { isLink: true, url: v };
    }

    const normalizedSlug = String(slug || '').toLowerCase();
    const isReportField = normalizedSlug.includes('service_report') || normalizedSlug.includes('repair_report');
    if (isReportField && !v) {
      return { isReport: true, slug: normalizedSlug };
    }

    if (Array.isArray(v)) {
      const arr = v.map((item) => {
        if (typeof item === 'string' && (/^\d{4}-\d{2}-\d{2}$/.test(item) || /T\d{2}:\d{2}/.test(item))) {
          return prettyDate(item);
        }
        return String(item);
      });
      return arr.join(', ');
    }
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';

    const isDateishSlug = typeof slug === 'string' && /date|_at|time/i.test(slug);
    if (v && (isDateishSlug || (typeof v === 'string' && (/^\d{4}-\d{2}-\d{2}$/.test(v) || /T\d{2}:\d{2}/.test(v))))) {
      return prettyDate(v);
    }
    if (isDateishSlug && typeof v === 'number' && isFinite(v)) {
      return prettyDate(new Date(v));
    }
    return (v ?? 'N/A');
  };

  // Handle report attachment
  const handleAttachReport = useCallback(async ({ slug, label }) => {
    try {
      setAttachBusySlug(slug);
      const pick = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
        type: [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'image/*',
        ],
      });
      if (pick.canceled) { setAttachBusySlug(''); return; }
      const assetFile = pick.assets?.[0];
      if (!assetFile) { setAttachBusySlug(''); return; }

      const fd = new FormData();
      if (Platform.OS === 'web') {
        const resp = await fetch(assetFile.uri);
        const blob = await resp.blob();
        const file = new File([blob], assetFile.name || 'report.pdf', { type: assetFile.mimeType || blob.type || 'application/pdf' });
        fd.append('file', file, file.name);
      } else {
        fd.append('file', {
          uri: assetFile.uri,
          name: assetFile.name || 'report.pdf',
          type: assetFile.mimeType || 'application/pdf',
        });
      }
      const docField = typeFields.find((d) => String(d.slug || '').toLowerCase() === slug);
      if (docField?.id) {
        fd.append('asset_type_field_id', String(docField.id));
      }
      fd.append('title', label);
      fd.append('kind', label);

      const upload = await fetch(`${API_BASE_URL}/assets/${assetId}/documents/upload`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: fd,
      });
      if (!upload.ok) {
        throw new Error(await upload.text());
      }
      showSuccess(`${label} attached`);
      await load();
    } catch (e) {
      showError(e?.message || 'Failed to attach report');
    } finally {
      setAttachBusySlug('');
    }
  }, [assetId, typeFields, load]);

  // Render field value (used in templates) — must return React nodes, not renderValue() descriptor objects
  const renderFieldValue = useCallback((slug, value) => {
    const out = renderValue(slug, value, {
      onAttachReport: handleAttachReport,
      attachBusySlug,
    });
    if (React.isValidElement(out)) return out;
    if (out && typeof out === 'object' && out.isLink && out.url) {
      const href = String(out.url);
      const isPdf = /\.pdf($|\?)/i.test(href.split('?')[0]);
      const tail = (() => {
        try {
          const u = href.split('?')[0];
          return decodeURIComponent(u.split('/').pop() || '') || 'View document';
        } catch {
          return 'View document';
        }
      })();
      const openDoc = () => {
        if (Platform.OS === 'web') {
          // Open in a new tab so the browser renders/previews the document inline
          if (typeof window !== 'undefined') {
            window.open(href, '_blank', 'noopener,noreferrer');
          }
        } else {
          Linking.openURL(href);
        }
      };
      return (
        <TouchableOpacity onPress={openDoc} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={{ color: Colors.primary, fontWeight: '700', textDecorationLine: 'underline' }} numberOfLines={2}>
            {tail}
          </Text>
        </TouchableOpacity>
      );
    }
    if (out && typeof out === 'object' && out.isReport && out.slug) {
      const repSlug = out.slug;
      const busy = attachBusySlug === repSlug;
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <TouchableOpacity
            onPress={() => handleAttachReport({ slug: repSlug, label: formatFieldLabel(repSlug) })}
            disabled={busy}
            style={{ opacity: busy ? 0.6 : 1 }}
          >
            <Text style={{ color: Colors.accent, fontWeight: '700' }}>{busy ? 'Uploading…' : 'Attach report'}</Text>
          </TouchableOpacity>
          {busy ? <ActivityIndicator size="small" color={Colors.primary} /> : null}
        </View>
      );
    }
    if (typeof out === 'boolean') return out ? 'Yes' : 'No';
    return out;
  }, [handleAttachReport, attachBusySlug]);

  // Handle back navigation
  const handleBack = () => {
    try {
      if (router?.canGoBack?.() && router.canGoBack()) {
        router.back();
        return;
      }
    } catch (e) {
      logger.warn('useAssetDetail: canGoBack check failed', e?.message || e);
    }
    if (navigation?.canGoBack?.()) {
      router.back();
      return;
    }
    if (normalizedReturnTo && navigateToReturnTarget(normalizedReturnTo)) return;
    router.replace({ pathname: '/(tabs)/Inventory', params: { tab: 'all' } });
  };

  /**
   * Execute the asset delete API call — no confirmation prompt.
   * Call this from the page after the user confirms via ConfirmModal.
   * Returns the error message string on failure, or null on success.
   */
  const executeDelete = useCallback(async () => {
    try {
      const uid = auth.currentUser?.uid;
      const authH = await getAuthHeaders();
      const headers = { ...authH, ...(uid ? { 'X-User-Id': uid } : {}) };
      const res = await fetch(`${API_BASE_URL}/assets/${asset.id}`, { method: 'DELETE', headers });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `Delete failed (${res.status})`);
      }
      router.replace({ pathname: '/(tabs)/Inventory', params: { tab: 'all' } });
      return null;
    } catch (e) {
      return e?.message || 'Failed to delete asset';
    }
  }, [asset?.id, router]);

  // Legacy: kept so any callers outside [assetId].js don't break.
  // [assetId].js uses executeDelete + ConfirmModal directly.
  const handleDelete = executeDelete;

  // Delete document
  const handleDeleteDocument = useCallback(async (docId) => {
    const ok = await confirm('Remove this document from the asset?');
    if (!ok) return;
    const aId = asset?.id || assetId;
    if (!aId || !docId) return;
    setDocDeletingId(docId);
    try {
      const uid = auth.currentUser?.uid;
      const authH = await getAuthHeaders();
      const headers = { ...authH, ...(uid ? { 'X-User-Id': uid } : {}) };
      const res = await fetch(`${API_BASE_URL}/assets/${aId}/documents/${docId}`, { method: 'DELETE', headers });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `Failed to delete document (${res.status})`);
      }
      await load();
    } catch (e) {
      showError(e?.message || 'Failed to delete document');
    } finally {
      setDocDeletingId(null);
    }
  }, [asset?.id, assetId, load]);

  // Build dynamic data (fields + docs)
  const buildDynamicData = () => {
    const rows = [];
    const history = [];
    const consumedDocSlugs = new Set();
    const consumedDocIds = new Set();
    const toYmd = (val) => {
      try {
        if (!val) return '';
        if (typeof val === 'string') {
          const s = val.trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
          const d = new Date(val);
          if (isNaN(+d)) return '';
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${y}-${m}-${day}`;
        }
        const d = new Date(val);
        if (isNaN(+d)) return '';
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      } catch { return ''; }
    };
    const norm = (s) => String(s || '').toLowerCase().trim();
    const normSlug = (s) => norm(s).replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
    const docMatchesTokens = (d, tokens = []) => {
      const title = norm(d?.title || '');
      const kind  = norm(d?.kind || '');
      return tokens.some((t) => !!t && (title.includes(t) || kind.includes(t)));
    };
    const pickBestByDate = (list, wantedYmd) => {
      if (!Array.isArray(list) || list.length === 0) return null;
      const scored = list.map((d) => {
        const dy = toYmd(d?.related_date);
        const hasExact = wantedYmd && dy && dy === wantedYmd ? 2 : 0;
        const ts = new Date(d?.created_at || d?.related_date || 0).getTime() || 0;
        return { d, score: hasExact, ts };
      });
      scored.sort((a, b) => (b.score - a.score) || (b.ts - a.ts));
      return scored[0]?.d || null;
    };
    for (const [slugRaw, value] of customFieldEntries) {
      const slug = String(slugRaw || '');
      const lower = slug.toLowerCase();
      const maybeDocSlug = dateDocLinks[lower];
      if (consumedDocSlugs.has(lower)) continue;
      if (maybeDocSlug) {
        rows.push({ label: formatFieldLabel(slug), value: renderFieldValue(slug, value), right: false });
        const docSlug = String(maybeDocSlug);
        let docUrl = (docSlug === 'documentation_url') ? (asset?.documentation_url || '') : '';
        const needsStrictDate = /service_report|repair_report/i.test(docSlug || '');
        try {
          const def = (typeFields || []).find(d => norm(d.slug) === norm(docSlug));
          const fieldId = def?.id ? String(def.id) : null;
          const wantedYmd = toYmd(value);
          const acceptable = (cand) => {
            if (!cand?.url) return null;
            if (needsStrictDate) {
              if (!wantedYmd) return null;
              const candDate = toYmd(cand.related_date);
              if (candDate !== wantedYmd) return null;
            }
            return cand;
          };
          if (fieldId && Array.isArray(assetDocs) && assetDocs.length) {
            const forField = assetDocs.filter(d => String(d.asset_type_field_id || '') === fieldId);
            const want = acceptable(pickBestByDate(forField, wantedYmd));
            if (want) {
              docUrl = want.url;
              if (want.id) consumedDocIds.add(String(want.id));
            }
          }
          if (!docUrl && Array.isArray(assetDocs) && assetDocs.length && !needsStrictDate) {
            const label = (def?.name || def?.label || docSlug || '').toString();
            const tokens = [norm(label), normSlug(docSlug)];
            const cand = pickBestByDate(assetDocs.filter(d => docMatchesTokens(d, tokens)), wantedYmd) || null;
            if (cand?.url) docUrl = cand.url;
            if (cand?.id) consumedDocIds.add(String(cand.id));
          }
          if (!docUrl && wantedYmd && Array.isArray(assetDocs) && assetDocs.length) {
            const byDate = assetDocs.filter(d => toYmd(d.related_date) === wantedYmd);
            const cand = acceptable(pickBestByDate(byDate, wantedYmd));
            if (cand) {
              docUrl = cand.url;
              if (cand.id) consumedDocIds.add(String(cand.id));
            }
          }
        } catch {}
        if (!docUrl && asset?.fields && !needsStrictDate) {
          if (asset.fields[docSlug]) docUrl = asset.fields[docSlug];
          else {
            for (const [k, v] of Object.entries(asset.fields)) {
              const norm = String(k || '').toLowerCase().trim().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
              if (norm === docSlug) { docUrl = v; break; }
            }
          }
        }
        if (!docUrl && asset?.documentation_url && !needsStrictDate) docUrl = asset.documentation_url;
        const docLabel = docLabels[docSlug] ? String(docLabels[docSlug]) : formatFieldLabel(docSlug);
        rows.push({ label: docLabel, value: renderFieldValue(docSlug, docUrl || 'N/A'), right: false });
        consumedDocSlugs.add(docSlug);
      } else if (!Object.values(dateDocLinks).includes(lower)) {
        let v = value;
        try {
          const def = (typeFields || []).find(d => String(d.slug || '').toLowerCase() === lower);
          const typeSlug = String(def?.field_type?.slug || def?.field_type?.name || '').toLowerCase();
          const looksDoc = typeSlug === 'url' || /document|certificate|licen|permit|report|attachment|upload/i.test(def?.name || def?.label || '');
          if (looksDoc && (!(typeof v === 'string' && /^https?:\/\//i.test(v)))) {
            const fieldId = def?.id ? String(def.id) : null;
            if (fieldId && Array.isArray(assetDocs) && assetDocs.length) {
              const sorted = assetDocs
                .filter(d => String(d.asset_type_field_id || '') === fieldId)
                .sort((a,b) => new Date(b.created_at || 0) - new Date(a.created_at || 0) || new Date(b.related_date || 0) - new Date(a.related_date || 0));
              if (sorted[0]?.url) v = sorted[0].url;
              if (sorted[0]?.id) consumedDocIds.add(String(sorted[0].id));
            }
            if (!(typeof v === 'string' && /^https?:\/\//i.test(v)) && Array.isArray(assetDocs) && assetDocs.length) {
              const label = (def?.name || def?.label || slug || '').toString();
              const tokens = [norm(label), lower];
              const cand = assetDocs
                .filter(d => docMatchesTokens(d, tokens))
                .sort((a,b) => new Date(b.created_at || 0) - new Date(a.created_at || 0) || new Date(b.related_date || 0) - new Date(a.related_date || 0))[0];
              if (cand?.url) v = cand.url;
              if (cand?.id) consumedDocIds.add(String(cand.id));
            }
          }
        } catch (e) {
          logger.warn('useAssetDetail: doc field resolution failed', e?.message || e);
        }
        rows.push({ label: formatFieldLabel(slug), value: renderFieldValue(slug, v), right: false });
      }
    }

    try {
      if (Array.isArray(assetDocs) && assetDocs.length) {
        const leftovers = assetDocs
          .filter((d) => d && d.url && !consumedDocIds.has(String(d.id)))
          .sort((a,b) => new Date(b.created_at || 0) - new Date(a.created_at || 0) || new Date(b.related_date || 0) - new Date(a.related_date || 0));
        for (const d of leftovers) {
          let label = d.title || d.kind || 'Attachment';
          try {
            const def = (typeFields || []).find(f => String(f.id) === String(d.asset_type_field_id));
            if (def?.name) label = def.name;
          } catch (e) {
            logger.warn('useAssetDetail: leftover doc label lookup failed', e?.message || e);
          }
          const pretty = (() => {
            const txt = String(label || '').trim();
            if (!txt) return 'Attachment';
            const s = txt.replace(/_/g, ' ');
            return s.slice(0,1).toUpperCase() + s.slice(1);
          })();
          history.push({
            id: d.id,
            label: pretty,
            date: d.related_date || null,      // cert/document date (e.g. expiry)
            uploadedAt: d.created_at || null,  // when the file was uploaded
            url: d.url,
          });
        }
      }
    } catch (e) {
      logger.warn('useAssetDetail: leftover docs append failed', e?.message || e);
    }

    return { rows, history };
  };

  // Copy helpers
  const copyId = () => copyText(asset?.id || assetId, 'Asset ID copied');
  const copyDeepLink = () => {
    const id = asset?.id || assetId;
    const base = String(CHECKIN_WEB_BASE_URL || API_BASE_URL || '').replace(/\/+$/, '');
    copyText(`${base}/check-in/${id}`, 'Shareable link copied');
  };

  // QR payload (web app origin, not API — see inventory-api/apiBase CHECKIN_WEB_BASE_URL)
  const qrPayload = () => {
    const id = asset?.id || assetId;
    const base = String(CHECKIN_WEB_BASE_URL || API_BASE_URL || '').replace(/\/+$/, '');
    return `${base}/check-in/${id}`;
  };

  // Display location
  const DEFAULT_ADDRESS = '4/11 Ridley Street, Hindmarsh, South Australia';
  const displayLocation = (asset?.location && String(asset.location).trim()) || DEFAULT_ADDRESS;

  // Check if document URLs are in fields
  const hasDocUrlInFields = useMemo(() => {
    try {
      const isHttpUrl = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);
      if (!asset) return false;
      const fields = (asset.fields && typeof asset.fields === 'object') ? asset.fields : {};

      const resolveDocUrl = (docSlug) => {
        if (!docSlug) return '';
        const slug = String(docSlug).toLowerCase();
        if (slug === 'documentation_url' && isHttpUrl(asset.documentation_url)) return asset.documentation_url;
        if (isHttpUrl(fields[slug])) return fields[slug];
        for (const [k, v] of Object.entries(fields)) {
          const norm = String(k || '').toLowerCase().trim().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
          if (norm === slug && isHttpUrl(v)) return v;
        }
        if (isHttpUrl(asset.documentation_url)) return asset.documentation_url;
        return '';
      };

      if (dateDocLinks && dateDocLinks['next_service_date']) {
        const url = resolveDocUrl(dateDocLinks['next_service_date']);
        if (isHttpUrl(url)) return true;
      }
      for (const [dateSlug, docSlug] of Object.entries(dateDocLinks || {})) {
        if (!dateSlug || !docSlug) continue;
        const url = resolveDocUrl(docSlug);
        if (isHttpUrl(url)) return true;
      }
      if (Array.isArray(assetDocs) && assetDocs.length) return true;
      return false;
    } catch { return false; }
  }, [asset, dateDocLinks, assetDocs]);

  // Open maps
  const openMaps = () => {
    const q = encodeURIComponent(displayLocation);
    const url = Platform.select({
      ios: `http://maps.apple.com/?q=${q}`,
      android: `geo:0,0?q=${q}`,
      default: `https://www.google.com/maps/search/?api=1&query=${q}`,
    });
    const Linking = require('react-native').Linking;
    Linking.openURL(url).catch(() => Alert.alert('Could not open maps'));
  };

  // Current work details
  const latestMatchingAction = useMemo(() => {
    const all = Array.isArray(actions) ? actions : [];
    if (!all.length) return null;
    const wanted = new Set(['REPAIR', 'MAINTENANCE', 'END_OF_LIFE']);
    return (
      all.find((a) => {
        const t = String(a?.type).toUpperCase();
        if (!wanted.has(t)) return false;
        if (t === 'REPAIR' || t === 'MAINTENANCE') {
          const d = (a && a.data) || {};
          if (d.completed === true || d.signed_off === true || d.signed_off_at) {
            return false;
          }
        }
        return true;
      }) || null
    );
  }, [actions]);

  const currentDetails = useMemo(() => {
    if (!latestMatchingAction) return null;
    const base = latestMatchingAction.details || {};
    const date = base.date || latestMatchingAction.occurred_at || null;
    const summary = base.summary || latestMatchingAction.note || null;
    const notes =
      base.notes ||
      (!base.summary && latestMatchingAction.note ? latestMatchingAction.note : null);
    return { ...base, date, summary, notes };
  }, [latestMatchingAction]);

  const currentActionImages = useMemo(() => {
    try {
      const urls = new Set();
      const fromAction = latestMatchingAction?.data?.images;
      if (Array.isArray(fromAction)) {
        fromAction.filter(Boolean).forEach((u) => urls.add(u));
      }

      const isImageUrl = (u) => {
        if (!u || typeof u !== 'string') return false;
        try {
          const clean = u.split('?')[0].toLowerCase();
          return /\.(png|jpe?g|webp|gif)$/.test(clean);
        } catch { return false; }
      };

      if (latestMatchingAction && Array.isArray(assetDocs) && assetDocs.length) {
        const baseDate = latestMatchingAction.occurred_at || latestMatchingAction.created_at || null;
        const toYmd = (val) => {
          try {
            if (!val) return '';
            const d = new Date(val);
            if (Number.isNaN(+d)) return '';
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
          } catch { return ''; }
        };
        const baseYmd = baseDate ? toYmd(baseDate) : '';

        assetDocs.forEach((doc) => {
          const url = doc?.url;
          if (!isImageUrl(url)) return;
          const docYmd = toYmd(doc.related_date || doc.created_at);
          if (baseYmd && docYmd && docYmd === baseYmd) {
            urls.add(url);
          }
        });
      }

      return Array.from(urls);
    } catch { return []; }
  }, [latestMatchingAction, assetDocs]);

  // Pretty date/time formatters
  const prettyDateTime = (d) => {
    try {
      const t = typeof d === 'string' ? new Date(d) : new Date(d);
      return isValid(t) ? format(t, 'dd MMM yyyy HH:mm') : prettyDate(d);
    } catch { return prettyDate(d); }
  };

  // Type metadata (for action badges)
  const typeMeta = useCallback((t, opts = {}) => {
    const k = String(t || '').toUpperCase();
    const transferToMe = !!opts.transferToMe;
    if (k === 'TRANSFER' && transferToMe) {
      return { label: 'Transfer to me', description: 'Assigned to you', bg: '#EFF6FF', fg: '#1D4ED8', bd: '#BFDBFE' };
    }
    switch (k) {
      case 'TRANSFER':     return { label: 'Transfer', description: 'Transfer between users', bg: '#EFF6FF', fg: '#1D4ED8', bd: '#BFDBFE' };
      case 'CHECK_IN':     return { label: 'Transfer to office', description: 'Returned to office', bg: '#ECFDF5', fg: '#065F46', bd: '#BBF7D0' };
      case 'CHECK_OUT':    return { label: 'Transfer out of office', description: 'Left office inventory', bg: '#F5F3FF', fg: '#6D28D9', bd: '#DDD6FE' };
      case 'STATUS_CHANGE':return { label: 'Status', description: 'Status change', bg: '#FEF3C7', fg: '#92400E', bd: '#FDE68A' };
      case 'REPAIR':       return { label: 'Repair', description: 'Repair', bg: '#FFF7ED', fg: '#9A3412', bd: '#FED7AA' };
      case 'MAINTENANCE':  return { label: 'Maintenance', description: 'Service / maintenance', bg: '#F5F3FF', fg: '#6D28D9', bd: '#DDD6FE' };
      case 'HIRE':         return { label: 'Hire', description: 'Hire', bg: '#E0F2FE', fg: '#075985', bd: '#BAE6FD' };
      case 'END_OF_LIFE':  return { label: 'End of Life', description: 'End of life', bg: '#FEF2F2', fg: '#B91C1C', bd: '#FECACA' };
      case 'LOST':         return { label: 'Lost', description: 'Reported lost', bg: '#F3F4F6', fg: '#374151', bd: '#E5E7EB' };
      case 'STOLEN':       return { label: 'Stolen', description: 'Reported stolen', bg: '#F3F4F6', fg: '#374151', bd: '#E5E7EB' };
      default:             return { label: k || 'Note', description: k ? `${k.replace(/_/g, ' ').toLowerCase()}` : 'Note', bg: '#F3F4F6', fg: '#374151', bd: '#E5E7EB' };
    }
  }, []);

  // Get initials
  const initials = (s) => {
    try {
      const src = String(s || '').trim();
      if (!src) return '?';
      const parts = src.split(/[\s@._-]+/).filter(Boolean);
      const a = (parts[0] || '')[0] || '';
      const b = (parts[1] || '')[0] || '';
      return (a + b).toUpperCase() || '?';
    } catch { return '?'; }
  };

  // Note items (all notable actions)
  const noteItems = useMemo(() => {
    try {
      const arr = Array.isArray(actions) ? actions : [];
      const interestingTypes = new Set([
        'TRANSFER',
        'CHECK_IN',
        'CHECK_OUT',
        'STATUS_CHANGE',
        'REPAIR',
        'MAINTENANCE',
        'HIRE',
        'END_OF_LIFE',
        'LOST',
        'STOLEN',
      ]);
      return arr
        .filter((a) => {
          if (!a) return false;
          if (typeof a.note === 'string') return true;
          const t = String(a.type || '').toUpperCase();
          return interestingTypes.has(t);
        })
        .map((a) => {
          const typeUpper = String(a.type || '').toUpperCase();
          const fromLabel = a.from_user?.name || a.from_user?.useremail || a.from_user_id || '';
          const toLabel   = a.to_user?.name   || a.to_user?.useremail   || a.to_user_id   || '';
          const transferToMe = typeUpper === 'TRANSFER' && transferRecipientMatchesFirebaseUser(a.to_user, authUser);
          let text = (a.note || '').trim();

          if (typeUpper === 'TRANSFER') {
            text = transferToMe
              ? `Transfer to me (${asset?.id || ''})`
              : `Transfer (${asset?.id || ''}: ${fromLabel || '?'} → ${toLabel || '?'})`;
          } else if (typeUpper === 'CHECK_IN') {
            text = 'Transfer to office';
          } else if (typeUpper === 'CHECK_OUT') {
            text = `Transfer out of office (${asset?.id || ''}${toLabel ? ` → ${toLabel}` : ''})`;
          }

          if (!text) {
            if (typeUpper === 'REPAIR') text = 'Repair logged';
            else if (typeUpper === 'MAINTENANCE') text = 'Service / maintenance logged';
            else if (typeUpper === 'HIRE') text = 'Hire logged';
            else if (typeUpper === 'END_OF_LIFE') text = 'Marked as End of Life';
            else if (typeUpper === 'LOST') text = 'Reported lost';
            else if (typeUpper === 'STOLEN') text = 'Reported stolen';
            else if (typeUpper === 'STATUS_CHANGE') text = 'Status updated';
            else text = typeUpper || 'Update';
          }

          const performer = a.performer?.name || a.performer?.useremail || a.performed_by || '';
          const whoName = performer || fromLabel || toLabel || 'System';
          const imgs = Array.isArray(a?.data?.images) ? a.data.images.filter(Boolean) : [];
          return ({
            id: a.id,
            note: text,
            when: a.occurred_at,
            who: whoName,
            type: a.type || '',
            transferToMe,
            images: imgs,
          });
        });
    } catch { return []; }
  }, [actions, asset?.id, authUser]);

  // Work detail history
  const workDetailHistory = useMemo(() => {
    try {
      const arr = Array.isArray(actions) ? actions : [];
      const wanted = new Set(['REPAIR', 'MAINTENANCE']);
      return arr
        .filter((a) => a && wanted.has(String(a?.type || '').toUpperCase()))
        .map((a) => {
          const base = a.details || {};
          const date = base.date || a.occurred_at || a.created_at || null;
          const summary = base.summary || a.note || null;
          const notes = base.notes ?? null;
          const images = Array.isArray(a?.data?.images) ? a.data.images.filter(Boolean) : [];
          const signed_off_at = a?.data?.signed_off_at || null;
          return {
            id: a.id,
            type: String(a.type || '').toUpperCase(),
            date,
            occurred_at: a.occurred_at,
            signed_off_at,
            summary,
            priority: base.priority,
            estimated_cost: base.estimated_cost,
            notes,
            images,
          };
        })
        .sort((a, b) => {
          const ta = (a.signed_off_at || a.occurred_at || a.date) ? new Date(a.signed_off_at || a.occurred_at || a.date).getTime() : 0;
          const tb = (b.signed_off_at || b.occurred_at || b.date) ? new Date(b.signed_off_at || b.occurred_at || b.date).getTime() : 0;
          return tb - ta;
        });
    } catch { return []; }
  }, [actions]);

  // Typed notes (user_note_text)
  const typedNotes = useMemo(() => {
    try {
      const arr = Array.isArray(actions) ? actions : [];
      return arr
        .filter((a) => a && a.data && typeof a.data.user_note_text === 'string' && a.data.user_note_text.trim())
        .map((a) => {
          const performer = a.performer?.name || a.performer?.useremail || a.performed_by || '';
          const fromLabel = a.from_user?.name || a.from_user?.useremail || a.from_user_id || '';
          const toLabel   = a.to_user?.name   || a.to_user?.useremail   || a.to_user_id   || '';
          const whoName = performer || fromLabel || toLabel || 'System';
          return ({ id: a.id, note: a.data.user_note_text.trim(), when: a.occurred_at, who: whoName });
        });
    } catch { return []; }
  }, [actions]);

  // Top-level asset note
  const assetNote = useMemo(() => {
    try {
      const t = (asset?.notes || '').toString();
      return t.trim();
    } catch { return ''; }
  }, [asset]);

  // Next service date
  const nextService = (() => {
    const raw = asset?.next_service_date;
    if (!raw) return null;
    const d = typeof raw === 'string' ? parseISO(raw) : new Date(raw);
    return isValid(d) ? d : null;
  })();
  const overdueDays = nextService ? differenceInCalendarDays(new Date(), nextService) : 0;
  const isOverdue = nextService ? overdueDays > 0 : false;

  return {
    // State
    asset,
    actions,
    loading,
    err,
    isAdmin,
    notesExpanded,
    setNotesExpanded,
    notesSectionExpanded,
    setNotesSectionExpanded,
    qrOpen,
    setQrOpen,
    typeFields,
    assetDocs,
    dateDocLinks,
    docLabels,
    attachBusySlug,
    setAttachBusySlug,
    docDeletingId,
    docHistoryOpen,
    setDocHistoryOpen,
    maintenanceExpanded,
    setMaintenanceExpanded,
    activeTab,
    setActiveTab,
    // Derived
    isImportedId,
    customFieldEntries,
    linkedAssetIds,
    hasDocUrlInFields,
    latestMatchingAction,
    currentDetails,
    currentActionImages,
    noteItems,
    workDetailHistory,
    typedNotes,
    assetNote,
    nextService,
    overdueDays,
    isOverdue,
    // Handlers
    load,
    parseReturnTarget,
    navigateToReturnTarget,
    handleAttachReport,
    renderValue,
    renderFieldValue,
    formatFieldLabel,
    handleBack,
    handleDelete,
    executeDelete,
    handleDeleteDocument,
    buildDynamicData,
    copyId,
    copyDeepLink,
    qrPayload,
    displayLocation,
    openMaps,
    // Helpers
    prettyDate: prettyDate,
    prettyDateTime,
    typeMeta,
    initials,
    normalizedReturnTo,
  };
}
