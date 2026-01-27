// app/(tabs)/asset/[assetId].js
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Linking,
  Alert,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
  Modal,
  Pressable,
} from 'react-native';
import * as LinkingExpo from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { differenceInCalendarDays, format, isValid, parseISO } from 'date-fns';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '../../components/ui/ScreenHeader';
import { Colors } from '../../constants/uiTheme';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../firebaseConfig';
import QRCode from 'react-native-qrcode-svg';

const DEFAULT_ADDRESS = '4/11 Ridley Street, Hindmarsh, South Australia';

const STATUS_CONFIG = {
  in_service:        { label: 'In Service',         bg: '#e0f2fe', fg: '#075985', icon: 'build-circle' },
  end_of_life:       { label: 'End of Life',        bg: '#ede9fe', fg: '#5b21b6', icon: 'block' },
  repair:      { label: 'Repair',       bg: '#ffedd5', fg: '#9a3412', icon: 'build' },
  maintenance: { label: 'Maintenance',  bg: '#fef9c3', fg: '#854d0e', icon: 'build' },
};
function normalizeStatus(s) {
  if (!s) return 'in_service';
  const key = String(s).toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');

  // Back-compat / synonyms mapping
  const alias = {
    // exact new set
    in_service: 'in_service',
    end_of_life: 'end_of_life',
    repair: 'repair',
    maintenance: 'maintenance',

    // legacy/common variants
    available: 'in_service',
    checked_out: 'repair', // or pick 'in_service' if you prefer
    rented: 'repair',
    reserved: 'in_service',
    lost: 'end_of_life',
    retired: 'end_of_life',
  };

  return alias[key] || 'in_service';
}

function StatusBadge({ status }) {
  const key = normalizeStatus(status);
  const cfg = STATUS_CONFIG[key] || STATUS_CONFIG.available;
  return (
    <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
      <MaterialIcons name={cfg.icon} size={16} color={cfg.fg} style={{ marginRight: 6 }} />
      <Text style={[styles.statusText, { color: cfg.fg }]}>{cfg.label}</Text>
    </View>
  );
}



// Display-only: format dates like "10 Oct 2025"
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

/* ---------- Cross-platform clipboard ---------- */
async function copyText(text, successMsg = 'Copied to clipboard') {
  try {
    if (Platform.OS === 'web') {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // legacy fallback
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

/** Platform-aware map preview.
 * - Web: <iframe> Google Maps embed
 * - Native: dynamically require WebView to avoid web bundling error
 */
function MapPreview({ location }) {
  const url = `https://www.google.com/maps?q=${encodeURIComponent(location)}&z=16&output=embed`;

  if (Platform.OS === 'web') {
    // Render a raw iframe on web; RNW will pass it through to the DOM.
    return (
      <View style={styles.mapCard}>
        <div style={{ width: '100%', height: '100%' }}>
          <iframe
            title="map"
            src={url}
            style={{ border: 0, width: '100%', height: '100%', borderRadius: 10 }}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </View>
    );
  }

  // Native (iOS/Android): render an iframe inside WebView.
  // Google requires the embed URL to be used within an iframe; loading it directly in WebView triggers an error.
  const { WebView } = require('react-native-webview');
  const html = `<!doctype html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <style>html, body, .wrap { height: 100%; margin: 0; padding: 0; }</style>
      </head>
      <body>
        <div class="wrap">
          <iframe
            src="${url}"
            width="100%"
            height="100%"
            style="border:0;"
            allowfullscreen
            loading="lazy"
            referrerpolicy="no-referrer-when-downgrade"
          ></iframe>
        </div>
      </body>
    </html>`;
  return (
    <View style={styles.mapCard}>
      <WebView
        originWhitelist={["*"]}
        source={{ html, baseUrl: 'https://www.google.com' }}
        style={styles.map}
        automaticallyAdjustContentInsets={false}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
      />
    </View>
  );
}

export default function AssetDetailPage() {
  const { assetId, returnTo } = useLocalSearchParams();
  const normalizedReturnTo = Array.isArray(returnTo) ? returnTo[0] : returnTo;
  const isUUID = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
  const isImportedId = useMemo(() => isUUID(String(assetId || '')), [assetId]);
  const [asset, setAsset] = useState(null);
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const router = useRouter();
  const navigation = useNavigation();
  const [isAdmin, setIsAdmin] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const { width } = useWindowDimensions();
  const isWebWide = Platform.OS === 'web' && (width || 0) >= 960;
  const [qrOpen, setQrOpen] = useState(false);
  const [typeFields, setTypeFields] = useState([]); // definitions for this asset type
  const [assetDocs, setAssetDocs] = useState([]); // DB-backed documents
  const [dateDocLinks, setDateDocLinks] = useState({}); // { dateSlug: docSlug }
  const [docLabels, setDocLabels] = useState({}); // { docSlug: label }
  const [attachBusySlug, setAttachBusySlug] = useState('');

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

  const load = useCallback(async () => {
    if (!assetId) return;
    setLoading(true);
    setErr('');
    try {
      // Hide imported (UUID) assets until QR is assigned
      if (isImportedId) {
        throw new Error('This imported asset is hidden until a QR is assigned to it. Assign via Transfer In > Assign Imported Asset.');
      }
      const res = await fetch(`${API_BASE_URL}/assets/${assetId}`);
      if (!res.ok) throw new Error(`Failed to load asset (${res.status})`);
      const data = await res.json();
      setAsset(data);
      // Load type field definitions to resolve Date → Document links
      try {
        const typeId = data?.type_id || data?.asset_types?.id;
        if (typeId) {
          const fr = await fetch(`${API_BASE_URL}/assets/asset-types/${typeId}/fields`);
          if (fr.ok) {
            const defs = await fr.json();
            const arr = Array.isArray(defs) ? defs : [];
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
                  // Prefer label from the document field def if it exists
                  const docDef = bySlug[docSlug];
                  const label = docDef?.name || docDef?.label || docDef?.slug || raw;
                  docNames[docSlug] = label;
                }
              } catch {}
            }
            setDateDocLinks(links);
            setDocLabels(docNames);
          }
        }
      } catch {}
      // Load DB-backed documents for this asset
      try {
        const dr = await fetch(`${API_BASE_URL}/asset-documents/documents?assetId=${encodeURIComponent(assetId)}`);
        if (dr.ok) {
          const dj = await dr.json();
          setAssetDocs(Array.isArray(dj?.items) ? dj.items : Array.isArray(dj) ? dj : []);
        } else { setAssetDocs([]); }
      } catch { setAssetDocs([]); }
      // fetch related actions for detail display
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
  }, [assetId]);

  // Determine DB admin role
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

  useEffect(() => { load(); }, [load]);

  const customFieldEntries = useMemo(() => {
    if (!asset?.fields || typeof asset.fields !== 'object') return [];
    return Object.entries(asset.fields);
  }, [asset]);

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

  const formatFieldLabel = (slug) => {
    try {
      const s = String(slug || '').replace(/_/g, ' ').trim();
      return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    } catch { return String(slug || ''); }
  };

  const renderValue = (slug, v, helpers = {}) => {
    // Link helper for document URLs
    const isUrl = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);
    const isDocLike = (s) => /\.(pdf|docx?|xls[x]?|pptx?)($|\?)/i.test(s);
    const renderDocLink = (url) => (
      <TouchableOpacity
        onPress={() => Linking.openURL(url).catch(() => Alert.alert('Could not open the document'))}
        style={{ paddingVertical: 2 }}
      >
        <Text style={{ color: '#0B63CE', fontWeight: '800' }}>View</Text>
      </TouchableOpacity>
    );

    // If a field value is a URL, show a link instead of raw text (especially for document URL fields)
    if (typeof v === 'string' && isUrl(v) && isDocLike(v)) {
      return renderDocLink(v);
    }
    if (typeof v === 'string' && isUrl(v)) {
      return (
        <TouchableOpacity
          onPress={() => Linking.openURL(v).catch(() => Alert.alert('Could not open the link'))}
          style={{ paddingVertical: 2 }}
        >
          <Text style={{ color: '#0B63CE', fontWeight: '800' }}>View</Text>
        </TouchableOpacity>
      );
    }

    const normalizedSlug = String(slug || '').toLowerCase();
    const isReportField = normalizedSlug.includes('service_report') || normalizedSlug.includes('repair_report');
    if (isReportField) {
      const attachBusy = helpers.attachBusySlug === normalizedSlug;
      const onAttach = helpers.onAttachReport;
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ color: '#EF4444', fontWeight: '700' }}>Not provided</Text>
          {onAttach ? (
            <TouchableOpacity
              onPress={() => onAttach({ slug: normalizedSlug, label: normalizedSlug.includes('repair') ? 'Repair Report' : 'Service Report' })}
              style={{ backgroundColor: '#0B63CE', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 }}
            >
              {attachBusy ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={{ color: '#fff', fontWeight: '700' }}>Attach report</Text>
              )}
            </TouchableOpacity>
          ) : null}
        </View>
      );
    }

    if (Array.isArray(v)) {
      // format array items too if date-like
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
        body: fd,
      });
      if (!upload.ok) {
        throw new Error(await upload.text());
      }
      Alert.alert('Success', `${label} attached`);
      await load();
    } catch (e) {
      Alert.alert('Error', e?.message || 'Failed to attach report');
    } finally {
      setAttachBusySlug('');
    }
  }, [assetId, typeFields, load]);

  const renderFieldValue = useCallback((slug, value) => renderValue(slug, value, {
    onAttachReport: handleAttachReport,
    attachBusySlug,
  }), [handleAttachReport, attachBusySlug]);

  const handleBack = () => {
    // Prefer explicit return target when provided to keep navbar state correct
    if (normalizedReturnTo && navigateToReturnTarget(normalizedReturnTo)) return;
    // Fall back to navigation history
    try {
      if (router?.canGoBack?.() && router.canGoBack()) {
        router.back();
        return;
      }
    } catch {}
    if (navigation?.canGoBack?.()) {
      router.back();
      return;
    }
    // Final fallback: Inventory tab
    router.replace({ pathname: '/(tabs)/Inventory', params: { tab: 'all' } });
  };

  const confirmDelete = async () => {
    if (Platform.OS === 'web') {
      return window.confirm('Delete this asset? This cannot be undone.');
    }
    return new Promise((resolve) => {
      Alert.alert('Delete asset', 'This cannot be undone. Continue?', [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
      ]);
    });
  };

  const handleDelete = async () => {
    const ok = await confirmDelete();
    if (!ok) return;
    try {
      // Hard delete
      const uid = auth.currentUser?.uid;
      const headers = uid ? { 'X-User-Id': uid } : {};
      const res = await fetch(`${API_BASE_URL}/assets/${asset.id}`, { method: 'DELETE', headers });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || 'Failed to delete');
      }
      if (Platform.OS !== 'web') Alert.alert('Deleted', 'Asset removed.');
      router.replace({ pathname: '/(tabs)/Inventory', params: { tab: 'all' } });
    } catch (e) {
      Alert.alert('Error', e.message || 'Failed to delete asset');
    }
  };

  // Helper: build ordered dynamic rows with doc shown beneath its date.
  // Any additional (older) DB-backed documents are returned as a separate
  // history list so we only show the latest per field in Additional Fields.
  const buildDynamicData = () => {
    const rows = [];
    const history = [];
    const consumedDocSlugs = new Set();
    const consumedDocIds = new Set();
    const toYmd = (val) => {
      try {
        if (!val) return '';
        if (typeof val === 'string') {
          // Expecting YYYY-MM-DD for stored dates
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
      // If this field is a document that will be rendered under its date, skip duplicate later
      if (consumedDocSlugs.has(lower)) continue;
      if (maybeDocSlug) {
        // Push date row
        rows.push({ label: formatFieldLabel(slug), value: renderFieldValue(slug, value), right: false });
        // Compute the document row
        const docSlug = String(maybeDocSlug);
        let docUrl = (docSlug === 'documentation_url') ? (asset?.documentation_url || '') : '';
        const needsStrictDate = /service_report|repair_report/i.test(docSlug || '');
        // Prefer DB-backed document for this doc field and date
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
          // Fallback 1: match by tokens from doc field label/slug
          if (!docUrl && Array.isArray(assetDocs) && assetDocs.length && !needsStrictDate) {
            const label = (def?.name || def?.label || docSlug || '').toString();
            const tokens = [norm(label), normSlug(docSlug)];
            const cand = pickBestByDate(assetDocs.filter(d => docMatchesTokens(d, tokens)), wantedYmd) || null;
            if (cand?.url) docUrl = cand.url;
            if (cand?.id) consumedDocIds.add(String(cand.id));
          }
          // Fallback 2: no good token match — pick any doc with the same date
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
        // As a last resort, show top-level documentation_url if present
        if (!docUrl && asset?.documentation_url && !needsStrictDate) docUrl = asset.documentation_url;
        const docLabel = docLabels[docSlug] ? String(docLabels[docSlug]) : formatFieldLabel(docSlug);
        rows.push({ label: docLabel, value: renderFieldValue(docSlug, docUrl || 'N/A'), right: false });
        consumedDocSlugs.add(docSlug);
      } else if (!Object.values(dateDocLinks).includes(lower)) {
        // Regular non-date or unrelated field; and not a doc consumed elsewhere
        let v = value;
        try {
          // If this is a document-like field and is empty, prefer DB-backed document
          const def = (typeFields || []).find(d => String(d.slug || '').toLowerCase() === lower);
          const typeSlug = String(def?.field_type?.slug || def?.field_type?.name || '').toLowerCase();
          const looksDoc = typeSlug === 'url' || /document|certificate|licen|permit|report|attachment|upload/i.test(def?.name || def?.label || '');
          if (looksDoc && (!(typeof v === 'string' && /^https?:\/\//i.test(v)))) {
            const fieldId = def?.id ? String(def.id) : null;
            if (fieldId && Array.isArray(assetDocs) && assetDocs.length) {
              const sorted = assetDocs
                .filter(d => String(d.asset_type_field_id || '') === fieldId)
                .sort((a,b) => new Date(b.related_date || b.created_at || 0) - new Date(a.related_date || a.created_at || 0));
              if (sorted[0]?.url) v = sorted[0].url;
              if (sorted[0]?.id) consumedDocIds.add(String(sorted[0].id));
            }
            // Fallback: title/kind contains field label/slug
            if (!(typeof v === 'string' && /^https?:\/\//i.test(v)) && Array.isArray(assetDocs) && assetDocs.length) {
              const label = (def?.name || def?.label || slug || '').toString();
              const tokens = [norm(label), lower];
              const cand = assetDocs
                .filter(d => docMatchesTokens(d, tokens))
                .sort((a,b) => new Date(b.related_date || b.created_at || 0) - new Date(a.related_date || a.created_at || 0))[0];
              if (cand?.url) v = cand.url;
              if (cand?.id) consumedDocIds.add(String(cand.id));
            }
          }
        } catch {}
        rows.push({ label: formatFieldLabel(slug), value: renderFieldValue(slug, v), right: false });
      }
    }

    // Collect remaining DB-backed documents as history (do NOT show in Additional Fields)
    try {
      if (Array.isArray(assetDocs) && assetDocs.length) {
        const leftovers = assetDocs
          .filter((d) => d && d.url && !consumedDocIds.has(String(d.id)))
          .sort((a,b) => new Date(b.related_date || b.created_at || 0) - new Date(a.related_date || a.created_at || 0));
        for (const d of leftovers) {
          let label = d.title || d.kind || 'Attachment';
          try {
            const def = (typeFields || []).find(f => String(f.id) === String(d.asset_type_field_id));
            if (def?.name) label = def.name;
          } catch {}
          const pretty = (() => {
            const txt = String(label || '').trim();
            if (!txt) return 'Attachment';
            const s = txt.replace(/_/g, ' ');
            return s.slice(0,1).toUpperCase() + s.slice(1);
          })();
          history.push({
            id: d.id,
            label: pretty,
            date: d.related_date || d.created_at || null,
            url: d.url,
          });
        }
      }
    } catch {}

    return { rows, history };
  };

  const copyId = () => copyText(asset?.id || assetId, 'Asset ID copied');
  const copyDeepLink = () => {
    const _app = LinkingExpo.createURL(`check-in/${asset?.id || assetId}`);
    const web = `https://ec2-3-25-81-127.ap-southeast-2.compute.amazonaws.com/check-in/${asset?.id || assetId}`;
    copyText(web, 'Shareable link copied');
  };

  const qrPayload = () => {
    const id = asset?.id || assetId;
    const base = String(API_BASE_URL || '').replace(/\/+$/, '');
    return `${base}/check-in/${id}`;
  };

  const displayLocation = (asset?.location && String(asset.location).trim()) || DEFAULT_ADDRESS;

  // Avoid duplicate document link: hide the bottom fallback button ONLY when
  // we actually rendered a valid document URL inline next to a linked date.
  const hasDocUrlInFields = useMemo(() => {
    try {
      const isHttpUrl = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);
      if (!asset) return false;
      const fields = (asset.fields && typeof asset.fields === 'object') ? asset.fields : {};

      // Helper to resolve a doc url for a given doc slug
      const resolveDocUrl = (docSlug) => {
        if (!docSlug) return '';
        const slug = String(docSlug).toLowerCase();
        if (slug === 'documentation_url' && isHttpUrl(asset.documentation_url)) return asset.documentation_url;
        // direct hit
        if (isHttpUrl(fields[slug])) return fields[slug];
        // try normalized match over keys like "Service Report" -> service_report
        for (const [k, v] of Object.entries(fields)) {
          const norm = String(k || '').toLowerCase().trim().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
          if (norm === slug && isHttpUrl(v)) return v;
        }
        // last resort: if no field found but top-level doc exists, treat it as the linked doc
        if (isHttpUrl(asset.documentation_url)) return asset.documentation_url;
        return '';
      };

      // 1) Next Service mapping
      if (dateDocLinks && dateDocLinks['next_service_date']) {
        const url = resolveDocUrl(dateDocLinks['next_service_date']);
        if (isHttpUrl(url)) return true;
      }
      // 2) Any custom date -> doc mapping
      for (const [dateSlug, docSlug] of Object.entries(dateDocLinks || {})) {
        if (!dateSlug || !docSlug) continue;
        const url = resolveDocUrl(docSlug);
        if (isHttpUrl(url)) return true;
      }
      // Also consider DB-backed documents
      if (Array.isArray(assetDocs) && assetDocs.length) return true;
      return false;
    } catch { return false; }
  }, [asset, dateDocLinks, assetDocs]);

  const openMaps = () => {
    const q = encodeURIComponent(displayLocation);
    const url = Platform.select({
      ios: `http://maps.apple.com/?q=${q}`,
      android: `geo:0,0?q=${q}`,
      default: `https://www.google.com/maps/search/?api=1&query=${q}`,
    });
    Linking.openURL(url).catch(() => Alert.alert('Could not open maps'));
  };

  const statusKey = normalizeStatus(asset?.status);
  const latestMatchingAction = useMemo(() => {
    const all = Array.isArray(actions) ? actions : [];
    if (!all.length) return null;

    // Pick the most recent REPAIR / MAINTENANCE / END_OF_LIFE action,
    // but ignore service/repair actions that have been signed off/completed.
    // (actions are already ordered desc).
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

      // Also pull in image-like documents whose date matches this action
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
  const [docHistoryOpen, setDocHistoryOpen] = useState(false);
  const prettyDateTime = (d) => {
    try {
      const t = typeof d === 'string' ? new Date(d) : new Date(d);
      return isValid(t) ? format(t, 'dd MMM yyyy HH:mm') : prettyDate(d);
    } catch { return prettyDate(d); }
  };

  const typeMeta = (t) => {
    const k = String(t || '').toUpperCase();
    switch (k) {
      case 'TRANSFER':     return { label: 'Transfer', bg: '#EFF6FF', fg: '#1D4ED8', bd: '#BFDBFE' };
      case 'CHECK_IN':     return { label: 'Transfer In', bg: '#ECFDF5', fg: '#065F46', bd: '#BBF7D0' };
      case 'CHECK_OUT':    return { label: 'Transfer Out', bg: '#F5F3FF', fg: '#6D28D9', bd: '#DDD6FE' };
      case 'STATUS_CHANGE':return { label: 'Status', bg: '#FEF3C7', fg: '#92400E', bd: '#FDE68A' };
      case 'REPAIR':       return { label: 'Repair', bg: '#FFF7ED', fg: '#9A3412', bd: '#FED7AA' };
      case 'MAINTENANCE':  return { label: 'Maintenance', bg: '#F5F3FF', fg: '#6D28D9', bd: '#DDD6FE' };
      case 'HIRE':         return { label: 'Hire', bg: '#E0F2FE', fg: '#075985', bd: '#BAE6FD' };
      default:             return { label: k || 'Note', bg: '#F3F4F6', fg: '#374151', bd: '#E5E7EB' };
    }
  };

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
          let text = (a.note || '').trim();

          // Prefer name-based rendering for transfer/check in/out
          if (typeUpper === 'TRANSFER') {
            text = `Transfer ${asset?.id || ''} from ${fromLabel || 'Unassigned'} to ${toLabel || 'Unassigned'}`;
          } else if (typeUpper === 'CHECK_IN') {
            text = 'Transfer In';
          } else if (typeUpper === 'CHECK_OUT') {
            text = `Transfer Out ${asset?.id || ''} to ${toLabel || 'Assignee'}`;
          }

          // If no custom note, fall back to a sensible default for key action types
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
            images: imgs,
          });
        });
    } catch { return []; }
  }, [actions, asset?.id]);

  // Notes typed by users during check-in/transfer/status (flagged on server)
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

  // Top-level note saved on the asset itself (e.g., from Dashboard action modal)
  const assetNote = useMemo(() => {
    try {
      const t = (asset?.notes || '').toString();
      return t.trim();
    } catch { return ''; }
  }, [asset]);

  const nextService = (() => {
    const raw = asset?.next_service_date;
    if (!raw) return null;
    const d = typeof raw === 'string' ? parseISO(raw) : new Date(raw);
    return isValid(d) ? d : null;
  })();
  const overdueDays = nextService ? differenceInCalendarDays(new Date(), nextService) : 0;
  const isOverdue = nextService ? overdueDays > 0 : false;

  if (loading) {
    return (
      <SafeAreaView style={styles.centerWrap}>
        <ActivityIndicator size="large" color="#1E90FF" />
        <Text style={{ marginTop: 12, color: '#666' }}>Loading asset…</Text>
      </SafeAreaView>
    );
  }

  if (err && isImportedId) {
    return (
      <SafeAreaView style={styles.centerWrap}>
        <Ionicons name="qr-code-outline" size={36} color="#1E90FF" />
        <Text style={{ marginTop: 12, color: '#333', fontWeight: '700' }}>Awaiting QR Assignment</Text>
        <Text style={{ marginTop: 8, color: '#666', paddingHorizontal: 24, textAlign: 'center' }}>{err}</Text>
        <TouchableOpacity
          style={{ marginTop: 18 }}
          onPress={() => {
            try { if (router?.canGoBack?.() && router.canGoBack()) { router.back(); return; } } catch {}
            if (normalizedReturnTo) { router.replace(normalizedReturnTo); return; }
            router.replace('/(tabs)/Inventory');
          }}
        >
          <Text style={{ color: '#1E90FF', fontWeight: '700' }}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (err) {
    return (
      <SafeAreaView style={styles.centerWrap}>
        <Text style={{ color: '#b00020', marginBottom: 12 }}>{err}</Text>
        <TouchableOpacity onPress={load} style={[styles.actionBtn, { backgroundColor: '#1E90FF', paddingHorizontal: 22 }]}>
          <Text style={styles.actionText}>Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (!asset) {
    return (
      <SafeAreaView style={styles.centerWrap}>
        <Text>No asset found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff', ...(Platform.OS === 'web' ? { minHeight: '100vh' } : {}) }}>
      <ScreenHeader
        title="Asset Details"
        backLabel="Back"
        onBack={handleBack}
      />

      <ScrollView
        style={{ flex: 1, ...(Platform.OS === 'web' ? { height: '100vh', overflow: 'auto' } : {}) }}
        contentContainerStyle={{ paddingHorizontal: 0, paddingBottom: 160, flexGrow: 1 }}
      >
        {/* Hero image spanning full width */}
        <Image
          source={{ uri: asset.image_url || 'https://via.placeholder.com/150' }}
          style={styles.heroImage}
        />

        <View style={styles.detailCard}>
          {/* Title Row — status badge removed to avoid duplication */}
          <View style={styles.titleRow}>
            <Text style={styles.assetName}>
              {asset.asset_types?.name || 'Asset'} · SN: {asset.serial_number || 'N/A'}
            </Text>
          </View>

          {/* Meta chips */}
          <View style={styles.metaRow}>
            <TouchableOpacity onPress={copyId} style={styles.metaChip}>
              <MaterialIcons name="fingerprint" size={16} color="#1E90FF" />
              <Text style={styles.metaChipText}>ID: {asset.id}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={copyDeepLink} style={styles.metaChip}>
              <MaterialIcons name="link" size={16} color="#1E90FF" />
              <Text style={styles.metaChipText}>Copy Link</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={openMaps} style={styles.metaChip}>
              <MaterialIcons name="place" size={16} color="#1E90FF" />
              <Text style={styles.metaChipText}>Maps</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setQrOpen(true)} style={styles.metaChip}>
              <Ionicons name="qr-code-outline" size={18} color="#1E90FF" />
            </TouchableOpacity>
          </View>

          {/* Core fields */}
          {(() => {
            // Hide common Next Service when the type defines a custom next_service_date field
            // or when the current asset already has a dynamic field key named next_service_date.
            const hasCustomNext = (() => {
              try {
                const byType = Array.isArray(typeFields)
                  && typeFields.some(tf => String(tf.slug || '').toLowerCase() === 'next_service_date'
                    && String(tf?.field_type?.slug || tf?.field_type?.name || '').toLowerCase() === 'date');
                if (byType) return true;
                const f = asset?.fields && typeof asset.fields === 'object' ? asset.fields : null;
                if (!f) return false;
                // Look for an existing dynamic field named next_service_date (normalized)
                for (const k of Object.keys(f)) {
                  const norm = String(k || '').toLowerCase().trim().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
                  if (norm === 'next_service_date') return true;
                }
                return false;
              } catch { return false; }
            })();
            const coreRows = [
              { label: 'Status', value: <StatusBadge status={asset.status} /> },
              { label: 'Assigned To', value: asset.users?.name || 'N/A' },
              { label: 'Last Scanned Location', value: displayLocation },
              { label: 'Model', value: asset.model || 'N/A' },
              { label: 'Other ID', value: asset.other_id || 'N/A' },
              { label: 'Date Purchased', value: asset.date_purchased ? prettyDate(asset.date_purchased) : 'N/A' },
            ];
            // Only show the common Next Service when there is no custom field for it
            if (!hasCustomNext) {
              coreRows.push({
                label: 'Next Service',
                value: nextService ? (
                  <Text style={{ color: isOverdue ? '#b00020' : '#065f46', fontWeight: '600' }}>
                    {format(nextService, 'dd MMM yyyy')}
                    {isOverdue ? `  • ${overdueDays}d overdue` : ''}
                  </Text>
                ) : 'N/A',
                right: false,
              });
              // If Next Service date links to a document, insert the document row just after it
              try {
                const docSlug = dateDocLinks['next_service_date'];
                if (docSlug) {
                  let docUrl = (docSlug === 'documentation_url') ? (asset?.documentation_url || '') : '';
                  if (!docUrl && asset?.fields) {
                    if (asset.fields[docSlug]) docUrl = asset.fields[docSlug];
                    else {
                      for (const [k, v] of Object.entries(asset.fields)) {
                        const norm = String(k || '').toLowerCase().trim().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
                        if (norm === docSlug) { docUrl = v; break; }
                      }
                    }
                  }
                  if (!docUrl && asset?.documentation_url) docUrl = asset.documentation_url;
                  const docLabel = docLabels[docSlug] ? String(docLabels[docSlug]) : formatFieldLabel(docSlug);
                  const idx = coreRows.findIndex(r => r.label === 'Next Service');
                  const row = { label: docLabel, value: renderFieldValue(docSlug, docUrl || 'N/A'), right: false };
                  if (idx >= 0) coreRows.splice(idx + 1, 0, row); else coreRows.push(row);
                }
              } catch {}
            }
            coreRows.push(
              { label: 'Last Updated', value: asset.last_updated ? prettyDate(asset.last_updated) : 'N/A' },
              { label: 'Last Updated By', value: (asset.last_changed_by_name || asset.users?.name || asset.last_changed_by || 'N/A') },
              { label: 'Description', value: asset.description || 'No description' },
            );
            if (isWebWide) {
              return <DetailsGrid rows={coreRows} />;
            }
            return coreRows.map((r, i) => (
              <Row key={`core-${i}`} label={r.label} value={r.value} rightAlign={r.right !== false} />
            ));
          })()}

          {currentDetails && (
            <>
              <Text style={[styles.sectionH, { marginTop: 16 }]}>Current Work Details</Text>
              {isWebWide ? (
                (() => {
                  const rows = [];
                  if (currentDetails.date) rows.push({ label: 'Date', value: prettyDate(currentDetails.date) });
                  if (currentDetails.summary) rows.push({ label: 'Summary', value: currentDetails.summary });
                  if (currentDetails.priority) rows.push({ label: 'Priority', value: String(currentDetails.priority) });
                  if (typeof currentDetails.estimated_cost !== 'undefined' && currentDetails.estimated_cost !== null) {
                    rows.push({ label: 'Estimated Cost', value: `$${Number(currentDetails.estimated_cost).toFixed(2)}` });
                  }
                  if (currentDetails.eol_reason) rows.push({ label: 'Reason', value: currentDetails.eol_reason });
                  if (currentDetails.notes) rows.push({ label: 'Notes', value: currentDetails.notes });
                  return <DetailsGrid rows={rows} />;
                })()
              ) : (
                <>
                  {currentDetails.date && (
                    <Row label="Date" value={prettyDate(currentDetails.date)} rightAlign={false} />
                  )}
                  {currentDetails.summary && (
                    <Row label="Summary" value={currentDetails.summary} rightAlign={false} />
                  )}
                  {currentDetails.priority && (
                    <Row label="Priority" value={String(currentDetails.priority)} rightAlign={false} />
                  )}
                  {typeof currentDetails.estimated_cost !== 'undefined' && currentDetails.estimated_cost !== null && (
                    <Row label="Estimated Cost" value={`$${Number(currentDetails.estimated_cost).toFixed(2)}`} rightAlign={false} />
                  )}
                  {currentDetails.eol_reason && (
                    <Row label="Reason" value={currentDetails.eol_reason} rightAlign={false} />
                  )}
                  {currentDetails.notes && (
                    <Row label="Notes" value={currentDetails.notes} rightAlign={false} />
                  )}
                </>
              )}
              {!!currentActionImages.length && (
                <>
                  <Text style={[styles.sectionH, { marginTop: 12 }]}>Work Photos</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                    {currentActionImages.map((url, idx) => (
                      <Image key={`curr-img-${idx}`} source={{ uri: url }} style={{ width: 100, height: 100, borderRadius: 8, marginRight: 10, borderWidth: 1, borderColor: '#eee' }} />
                    ))}
                  </ScrollView>
                </>
              )}
            </>
          )}
          {/* Notes and History moved below Additional Fields */}

          {/* Dynamic fields */}
          {customFieldEntries.length > 0 && (
            <>
              <Text style={[styles.sectionH, { marginTop: 16 }]}>Additional Fields</Text>
              {(() => {
                const { rows: dynRows } = buildDynamicData();
                if (isWebWide) return <DetailsGrid rows={dynRows} />;
                return dynRows.map((r, idx) => (
                  <Row key={`dyn-${idx}`} label={r.label} value={r.value} />
                ));
              })()}
            </>
          )}

          {/* Divider before Notes/History */}
          <View style={styles.sectionDivider} />

          {/* Notes (asset-level + typed) */}
          <Text style={[styles.sectionH, { marginTop: 16 }]}>Notes</Text>
          {!assetNote && typedNotes.length === 0 ? (
            <Text style={{ color: '#666' }}>No notes yet.</Text>
          ) : (
            <View style={{ gap: 10 }}>
              {!!assetNote && (
                <View key="asset-note" style={styles.noteCard}>
                  <Text style={styles.noteText}>{assetNote}</Text>
                </View>
              )}
              {typedNotes.map((n) => (
                <View key={n.id} style={styles.noteCard}>
                  <View style={styles.noteHead}>
                    <View style={styles.noteAvatar}><Text style={styles.noteAvatarText}>{initials(n.who)}</Text></View>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={styles.noteWho} numberOfLines={1}>{n.who || 'System'}</Text>
                      <Text style={styles.noteWhen}>{prettyDateTime(n.when)}</Text>
                    </View>
                  </View>
                  <Text style={styles.noteText}>{n.note}</Text>
                </View>
              ))}
            </View>
          )}

          {/* History (all actions) */}
          <Text style={[styles.sectionH, { marginTop: 16 }]}>History</Text>
          {noteItems.length === 0 ? (
            <Text style={{ color: '#666' }}>No history yet.</Text>
          ) : (
            <>
              <View style={{ gap: 10 }}>
                {(notesExpanded ? noteItems : noteItems.slice(0, 3)).map((n) => {
                  const meta = typeMeta(n.type);
                  return (
                    <View key={n.id} style={styles.noteCard}>
                      <View style={styles.noteHead}>
                        <View style={styles.noteAvatar}><Text style={styles.noteAvatarText}>{initials(n.who)}</Text></View>
                        <View style={{ flex: 1, paddingRight: 8 }}>
                          <Text style={styles.noteWho} numberOfLines={1}>{n.who || 'System'}</Text>
                          <Text style={styles.noteWhen}>{prettyDateTime(n.when)}</Text>
                        </View>
                        {!!n.type && (
                          <View style={[styles.noteBadge, { backgroundColor: meta.bg, borderColor: meta.bd }]}>
                            <Text style={[styles.noteBadgeText, { color: meta.fg }]}>{meta.label}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.noteText}>{n.note}</Text>
                      {!!(n.images && n.images.length) && (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                          {n.images.map((url, idx) => (
                            <Image key={`${n.id}-img-${idx}`} source={{ uri: url }} style={{ width: 80, height: 80, borderRadius: 8, marginRight: 8, borderWidth: 1, borderColor: '#eee' }} />
                          ))}
                        </ScrollView>
                      )}
                    </View>
                  );
                })}
              </View>
              {noteItems.length > 3 && (
                <View style={{ marginTop: 10 }}>
                  <TouchableOpacity onPress={() => setNotesExpanded((v) => !v)} style={styles.noteToggle}>
                    <Text style={styles.noteToggleText}>{notesExpanded ? 'Show less' : 'Show more'}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}

          {/* Document history (older attachments) */}
          {(() => {
            try {
              const { history } = buildDynamicData();
              if (!history || !history.length) return null;
              const rows = history.map((h) => ({
                label: `${h.label}${h.date ? ' (' + prettyDate(h.date) + ')' : ''}`,
                value: renderFieldValue('documentation_url', h.url),
                right: false,
              }));
              const visible = docHistoryOpen ? rows : rows.slice(0, 2); // collapsed shows last 1–2 items
              return (
                <>
                  <View style={styles.collapsibleHead}>
                    <Text style={[styles.sectionH, { marginTop: 16, marginBottom: 0 }]}>Document History</Text>
                  </View>
                  {isWebWide ? (
                    <>
                      {!!visible.length && <DetailsGrid rows={visible} />}
                      {!docHistoryOpen && rows.length > visible.length ? (
                        <TouchableOpacity onPress={() => setDocHistoryOpen(true)} style={{ alignSelf: 'flex-start', marginTop: 6 }}>
                          <Text style={{ color: '#0B63CE', fontWeight: '800' }}>Show more</Text>
                        </TouchableOpacity>
                      ) : docHistoryOpen ? (
                        <TouchableOpacity onPress={() => setDocHistoryOpen(false)} style={{ alignSelf: 'flex-start', marginTop: 6 }}>
                          <Text style={{ color: '#0B63CE', fontWeight: '800' }}>Show less</Text>
                        </TouchableOpacity>
                      ) : null}
                    </>
                  ) : (
                    <>
                      {visible.map((r, i) => (
                        <Row key={`hist-${i}`} label={r.label} value={r.value} />
                      ))}
                      {!docHistoryOpen && rows.length > visible.length ? (
                        <TouchableOpacity onPress={() => setDocHistoryOpen(true)} style={{ alignSelf: 'flex-start', marginTop: 6 }}>
                          <Text style={{ color: '#0B63CE', fontWeight: '800' }}>Show more</Text>
                        </TouchableOpacity>
                      ) : docHistoryOpen ? (
                        <TouchableOpacity onPress={() => setDocHistoryOpen(false)} style={{ alignSelf: 'flex-start', marginTop: 6 }}>
                          <Text style={{ color: '#0B63CE', fontWeight: '800' }}>Show less</Text>
                        </TouchableOpacity>
                      ) : null}
                    </>
                  )}
                </>
              );
            } catch { return null; }
          })()}
          {/* Linked assets */}
          {linkedAssetIds.length > 0 && (
            <>
              <Text style={[styles.sectionH, { marginTop: 18 }]}>Linked Assets</Text>
              <View style={styles.linkedWrap}>
                {linkedAssetIds.map((id) => (
                  <TouchableOpacity
                    key={id}
                    style={styles.linkedChip}
                    onPress={() =>
                      router.push({ pathname: '/(tabs)/asset/[assetId]', params: { assetId: id } })
                    }
                  >
                    <MaterialIcons name="link" size={16} color="#1E90FF" />
                    <Text style={styles.linkedChipText}>{id}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {/* Docs */}
          {false && asset.documentation_url && !hasDocUrlInFields && (
            <TouchableOpacity
              onPress={() => {
                Linking.openURL(asset.documentation_url).catch((err) => {
                  console.error('Error opening URL:', err);
                  Alert.alert('Could not open the document');
                });
              }}
              style={styles.documentButton}
            >
              <Text style={styles.documentText}>📄 View Attached Document</Text>
            </TouchableOpacity>
          )}
          {/* Map (works on all platforms) */}
          <MapPreview location={displayLocation} />
          {/* Smart actions */}
          <View style={styles.actionsRow}>
            {(() => {
              const isQRReserved = String(asset?.description || '').trim().toLowerCase() === 'qr reserved asset';
              
              if (isQRReserved) {
                // QR reserved assets only show Transfer Out/In buttons, no Edit/Copy/Delete
                return normalizeStatus(asset?.status) === 'available' ? (
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: '#16a34a' }]}
                    onPress={() =>
                      router.push({ pathname: '/qr-scanner', params: { intent: 'check-out', assetId: asset.id } })
                    }
                  >
                    <Text style={styles.actionText}>Transfer Out</Text>
                  </TouchableOpacity>
                ) : normalizeStatus(asset?.status) === 'rented' ? (
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: '#1E90FF' }]}
                    onPress={() => router.push(`/check-in/${asset.id}`)}
                  >
                    <Text style={styles.actionText}>Transfer In</Text>
                  </TouchableOpacity>
                ) : null;
              }
              
              // Regular assets show all buttons
              return (
                <>
                  {normalizeStatus(asset?.status) === 'available' ? (
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: '#16a34a' }]}
                      onPress={() =>
                        router.push({ pathname: '/qr-scanner', params: { intent: 'check-out', assetId: asset.id } })
                      }
                    >
                      <Text style={styles.actionText}>Transfer Out</Text>
                    </TouchableOpacity>
                  ) : normalizeStatus(asset?.status) === 'rented' ? (
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: '#1E90FF' }]}
                      onPress={() => router.push(`/check-in/${asset.id}`)}
                    >
                      <Text style={styles.actionText}>Transfer In</Text>
                    </TouchableOpacity>
                  ) : (
                    isAdmin ? (
                      <TouchableOpacity
                        style={[styles.actionBtn, { backgroundColor: '#1E90FF' }]}
                        onPress={() => {
                          router.push({
                            pathname: '/asset/new',
                            params: { fromAssetId: asset.id }, // Pass asset ID to NewAsset page
                          });
                        }}
                      >
                        <Text style={{ color: 'white', fontWeight: 'bold' }}>📋 Copy Asset</Text>
                      </TouchableOpacity>
                    ) : null
                  )}
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: '#FFA500' }]}
                    onPress={() =>
                      router.push({
                        pathname: '/asset/edit',
                        params: {
                          assetId: asset.id,
                          returnTo: `/asset/${asset.id}${normalizedReturnTo ? `?returnTo=${encodeURIComponent(normalizedReturnTo)}` : ''}`,
                        },
                      })
                    }
                  >
                    <Text style={styles.actionText}>✏️ Edit</Text>
                  </TouchableOpacity>

                  {isAdmin && (
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: '#b00020' }]}
                      onPress={handleDelete}
                    >
                      <Text style={styles.actionText}>🗑 Delete</Text>
                    </TouchableOpacity>
                  )}
                </>
              );
            })()}
          </View>

          {/* Helpful shortcuts
          <View style={{ marginTop: 12, flexDirection: 'row', flexWrap: 'wrap' }}>
            <Shortcut
              icon="search"
              label="Search with this ID"
              onPress={() => router.push({ pathname: '/search', params: { query: asset.id } })}
            />
            {asset.model ? (
              <Shortcut
                icon="tune"
                label="Find same model"
                onPress={() => router.push({ pathname: '/search', params: { model: asset.model } })}
              />
            ) : null}
          </View> */}
          
        </View>
      </ScrollView>
      {/* QR modal */}
      <Modal
        visible={qrOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setQrOpen(false)}
      >
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={() => setQrOpen(false)} />
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: '#fff', padding: 18, borderRadius: 16, alignItems: 'center', width: 340, maxWidth: '90%' }}>
            <QRCode value={qrPayload()} size={260} ecl="M" />
            <Text style={{ marginTop: 12, fontWeight: '700', color: '#333' }}>{asset?.id || assetId}</Text>
            <Text style={{ marginTop: 8, color: '#555', textAlign: 'center' }}>
              Scan this QR to open the asset and perform check-in or check-out.
            </Text>
            <TouchableOpacity onPress={() => setQrOpen(false)} style={{ marginTop: 12 }}>
              <Text style={{ color: '#1E90FF', fontWeight: '800' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Row({ label, value, rightAlign = true }) {
  const isPrimitive = typeof value === 'string' || typeof value === 'number';

  // Non-primitive values (e.g. buttons/links/components)
  if (!isPrimitive) {
    if (!rightAlign) {
      return (
        <View style={styles.detailRowStack}>
          <Text style={styles.label}>{label}</Text>
          <View style={styles.valueBelow}>{value}</View>
        </View>
      );
    }
    return (
      <View style={styles.detailRow}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.valueContainer}>{value}</View>
      </View>
    );
  }

  const text = value == null ? 'N/A' : String(value);
  const shouldStack = !rightAlign || text.length > 28;

  if (shouldStack) {
    return (
      <View style={styles.detailRowStack}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.valueBelow}>
          <Text style={[styles.value, { textAlign: 'left', alignSelf: 'flex-start' }]}>
            {text}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.detailRow}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.valueContainer}>
        <Text style={styles.value}>{text}</Text>
      </View>
    </View>
  );
}

function DetailsGrid({ rows = [] }) {
  return (
    <View style={styles.webGrid}>
      {rows.map((r, idx) => (
        <View key={`dg-${idx}`} style={styles.webGridRow}>
          <View style={styles.webGridLabel}><Text style={styles.webGridLabelText}>{r.label}</Text></View>
          <View style={styles.webGridValue}>
            {typeof r.value === 'string' || typeof r.value === 'number'
              ? <Text style={styles.webGridValueText}>{r.value ?? 'N/A'}</Text>
              : r.value}
          </View>
        </View>
      ))}
    </View>
  );
}

function Shortcut({ icon, label, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.shortcut}>
      <MaterialIcons name={icon} size={16} color="#1E90FF" />
      <Text style={styles.shortcutText}>{label}</Text>
    </TouchableOpacity>
  );
}

/* ----------------- styles ----------------- */
const styles = StyleSheet.create({
  centerWrap: {
    flex: 1,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderBottomColor: '#ddd',
    borderBottomWidth: 1,
    paddingBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginLeft: 12,
    color: '#1E90FF',
  },
  heroImage: {
    width: '100%',
    height: 220,
    resizeMode: 'cover',
    backgroundColor: '#eee',
  },
  detailCard: {
    backgroundColor: '#FFFFFF',
    padding: 14,
    marginHorizontal: 0,
    marginTop: 12,
    marginBottom: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2EEFF',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  image: { 
    height: 200,
    borderRadius: 10,
    marginBottom: 14,
    resizeMode: 'contain',
    backgroundColor: '#eee',
  },
  mapCard: {
    height: 220,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#eee',
    marginTop: 16,
    marginBottom: 16,
  },
  map: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 8,
  },
  assetName: {
    flex: 1,
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginRight: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
  },
  statusText: { fontWeight: '700', fontSize: 12 },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#f0f8ff',
    borderRadius: 14,
  },
  metaChipText: { color: '#1E90FF', fontWeight: '600', fontSize: 12 },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E6EDF3',
    marginVertical: 0,
    gap: 8,
  },
  detailRowStack: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E6EDF3',
    marginVertical: 0,
    gap: 4,
  },
  label: {
    fontWeight: '700',
    color: '#6B7280',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  valueContainer: {
    flex: 1,
    alignItems: 'flex-end',
  },
  valueBelow: {
    marginTop: 4,
    width: '100%',
    alignItems: 'flex-start',
  },
  value: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'right',
  },
  sectionH: {
    fontSize: 14,
    fontWeight: '800',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  linkedWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  linkedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#eef6ff',
    borderRadius: 14,
  },
  linkedChipText: { color: '#1E90FF', fontWeight: '600', fontSize: 12 },

  documentButton: {
    marginTop: 16,
    marginBottom: 16,
    padding: 2,
    backgroundColor: '#f0f8ff',
    borderRadius: 8,
    alignItems: 'center',
  },
  documentText: {
    color: '#1E90FF',
    fontWeight: 'bold',
  },
  actionsRow: {
    flexDirection: 'row', justifyContent: 'center', gap: 8,
    padding: 16, borderTopColor: '#ddd', borderTopWidth: 1, backgroundColor: '#fff',
  },
  actionBtn: {
    flex: 1,
    minHeight: 50,
    minWidth: 120,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 3, height: 3 } },
      android: { elevation: 3 },
      default: {},
    }),
  },
  actionText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  shortcut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#eef6ff',
    borderRadius: 14,
    marginRight: 8,
    marginBottom: 8,
  },
  shortcutText: { color: '#1E90FF', fontWeight: '600', fontSize: 12 },

  // Web grid (wider layout)
  webGrid: {
    borderWidth: 1,
    borderColor: '#E2EEFF',
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 4,
  },
  webGridRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#EAF2FF',
  },
  webGridLabel: {
    width: '32%',
    minWidth: 220,
    backgroundColor: '#F9FBFF',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRightWidth: 1,
    borderRightColor: '#E2EEFF',
    justifyContent: 'center',
  },
  webGridLabelText: { color: '#555', fontWeight: '800' },
  webGridValue: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  webGridValueText: { color: '#111', fontWeight: '600' },

  // Notes styles
  noteCard: {
    borderWidth: 1,
    borderColor: '#E6EDF3',
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#FAFCFF',
  },
  noteHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  noteAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#DBEAFE',
    marginRight: 10,
  },
  noteAvatarText: { fontWeight: '800', color: '#1E40AF', fontSize: 12 },
  noteWho: { color: '#0F172A', fontWeight: '700' },
  noteWhen: { color: '#64748B', fontSize: 12, marginTop: 2 },
  noteBadge: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  noteBadgeText: { fontWeight: '800', fontSize: 10 },
  noteText: { color: '#0F172A' },
  noteToggle: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E6EDF3',
    backgroundColor: '#F6FAFF',
  },
  noteToggleText: { color: '#0B63CE', fontWeight: '800' },
  sectionDivider: {
    height: 1,
    backgroundColor: '#E9EEF6',
    marginTop: 16,
    marginBottom: 4,
  },
  collapsibleHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  collapsibleMeta: { marginLeft: 6, color: '#64748B', fontWeight: '700' },
});
