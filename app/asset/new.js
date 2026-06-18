import { sf } from '../../constants/uiTheme.js';
// app/(tabs)/assets/new.js
import React, { useEffect, useState, useCallback, useMemo, useRef, useContext } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Image, Alert, Platform, Switch, ActivityIndicator, Modal, useWindowDimensions
} from 'react-native';
import { en, registerTranslation } from 'react-native-paper-dates';
import AppDatePicker from '../../components/ui/AppDatePicker';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../firebaseConfig';
import * as DocumentPicker from 'expo-document-picker';
import DropDownPicker from 'react-native-dropdown-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { LogBox } from 'react-native';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import { fetchFields } from '../../hooks/useAssetTypeFields';
import { FIELD_LIMITS } from '../../constants/fieldLimits';
import { formatDisplayDate } from '../../utils/date';
import logger from '../../utils/logger';
import { getAuthHeaders, setXHRAuthHeaders } from '../../utils/authHeaders';
import ScreenHeader from '../../components/ui/ScreenHeader';
import FormButton from '../../components/ui/FormButton';
import { MaterialIcons } from '@expo/vector-icons';
import { useTasksCount } from '../../contexts/TasksCountContext';
import { fetchTaskCount } from '../../utils/fetchTaskCount';

import { getImageFileFromPicker, ALLOWED_IMAGE_MIME_TYPES, revokeImageUri } from '../../utils/getFormFileFromPicker';
import * as ImagePicker from 'expo-image-picker';
import { fetchDropdownOptions } from '../../utils/fetchDropdownOptions';
import { TourTarget, TourContext } from '../../components/TourGuide';
import { IMAGE_UPLOAD_HINT, ASSET_DOCUMENT_FIELD_HINT } from '../../constants/uploadFormats';

registerTranslation('en', en);
LogBox.ignoreLogs(['VirtualizedLists should never be nested']);

const ALLOWED_DOC_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const normSlug = (s = '') =>
  String(s).toLowerCase().trim().replace(/[\s\-]+/g, '_').replace(/[^a-z0-9_]/g, '');

/**
 * Lightweight autocomplete: shows a filtered dropdown of `suggestions` below
 * the input when it's focused.  Also accepts a `forcedSuggestion` (used for
 * the "next Other ID" computed pill, which we always offer regardless of
 * current input).  Suggestions filter on substring match (case-insensitive).
 *
 * The parent renders the actual <TextInput> itself; this component only
 * renders the dropdown panel.  We keep it this way so existing input refs,
 * placeholder, error styling, etc. stay exactly as before.
 */
function SuggestionDropdown({ value, suggestions, forcedSuggestion, visible, onPick, max = 6 }) {
  if (!visible) return null;
  const v = String(value || '').toLowerCase().trim();
  const list = (() => {
    const base = Array.isArray(suggestions) ? suggestions : [];
    const filtered = v
      ? base.filter((s) => String(s).toLowerCase().includes(v) && String(s).toLowerCase() !== v)
      : base;
    return filtered.slice(0, max);
  })();
  const showForced = !!forcedSuggestion && String(forcedSuggestion) !== String(value || '');
  if (list.length === 0 && !showForced) return null;
  // We commit the pick on `onPressIn` (= mousedown on web) so the value is
  // set BEFORE the input's onBlur fires and tears down the dropdown — the
  // previous `onPress` (= click, fires on mouseup) was racing the blur handler
  // and frequently losing.  `onMouseDown.preventDefault` keeps focus on the
  // input so the picked text remains editable immediately afterwards.
  const handlePick = (val) => () => onPick(val);
  const keepFocus = Platform.OS === 'web'
    ? (e) => { try { e?.preventDefault?.(); } catch { /* ignore */ } }
    : undefined;

  return (
    <View style={ds.dropdownPanel}>
      {showForced ? (
        <TouchableOpacity
          style={[ds.dropdownRow, ds.dropdownRowForced]}
          onPressIn={handlePick(forcedSuggestion)}
          onMouseDown={keepFocus}
          activeOpacity={0.85}
        >
          <View style={ds.dropdownForcedBadge}>
            <Text style={ds.dropdownForcedBadgeText}>NEXT</Text>
          </View>
          <Text style={ds.dropdownRowText} numberOfLines={1}>{forcedSuggestion}</Text>
        </TouchableOpacity>
      ) : null}
      {list.map((s, i) => (
        <TouchableOpacity
          key={`${s}-${i}`}
          style={[ds.dropdownRow, (showForced || i > 0) && ds.dropdownRowBordered]}
          onPressIn={handlePick(s)}
          onMouseDown={keepFocus}
          activeOpacity={0.85}
        >
          <Text style={ds.dropdownRowText} numberOfLines={1}>{s}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const ds = StyleSheet.create({
  dropdownPanel: {
    marginTop: 4,
    borderWidth: 1.5,
    borderColor: '#D6D3D1',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    shadowColor: '#1C1917',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  dropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  dropdownRowBordered: {
    borderTopWidth: 1,
    borderTopColor: '#EDEAE6',
  },
  dropdownRowForced: {
    backgroundColor: '#FFF7ED',
  },
  dropdownRowText: {
    fontSize: 14,
    color: '#1C1917',
    fontWeight: '600',
    flex: 1,
  },
  dropdownForcedBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#EA580C',
  },
  dropdownForcedBadgeText: {
    fontSize: 10,
    color: '#FFFFFF',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});

export default function NewAsset() {
  const router = useRouter();
  const { fromAssetId, preselectId, returnTo } = useLocalSearchParams();
  const normalizedReturnTo = Array.isArray(returnTo) ? returnTo[0] : returnTo;
  const [isAdmin, setIsAdmin] = useState(false);
  const [checking, setChecking] = useState(true);

  const { ensureVisible, currentStep } = useContext(TourContext);
  const scrollViewRef = useRef(null);
  const { setTaskCount } = useTasksCount();

  // ---------- scroll & focus helpers (web-safe) ----------
  const scrollRef = useRef(null);
  const fieldRefs = useRef({});     // focusable refs (TextInput)
  const fieldYs = useRef({});     // container Y positions (from onLayout)

  const { width } = useWindowDimensions();
  const isWebWide = Platform.OS === 'web' && (width || 0) >= 960;

  const setInputRef = (slug) => (ref) => { if (ref) fieldRefs.current[slug] = ref; };
  const onLayoutFor = (slug) => (e) => { fieldYs.current[slug] = e.nativeEvent.layout.y; };

  const scrollToSlug = (slug) => {
    const y = fieldYs.current[slug];
    const targetY = typeof y === 'number' ? Math.max(y - 80, 0) : 0;

    if (Platform.OS === 'web') {
      // Web: Use window.scrollTo for better compatibility
      if (typeof window !== 'undefined') {
        const currentScrollY = window.scrollY || 0;
        const targetAbsoluteY = targetY + currentScrollY;
        const desiredScrollY = targetAbsoluteY - 150;
        window.scrollTo({ top: Math.max(0, desiredScrollY), behavior: 'smooth' });
      }
      // Also try ScrollView if available
      if (scrollRef.current?.scrollToPosition) {
        scrollRef.current.scrollToPosition(0, targetY, true);
      } else if (scrollRef.current?.scrollTo) {
        scrollRef.current.scrollTo({ x: 0, y: targetY, animated: true });
      }
    } else {
      // Native: KeyboardAwareScrollView API
      if (scrollRef.current?.scrollToPosition) {
        scrollRef.current.scrollToPosition(0, targetY, true);
      } else if (scrollRef.current?.scrollTo) {
        // RN ScrollView fallback
        scrollRef.current.scrollTo({ x: 0, y: targetY, animated: true });
      }
    }
  };

  // Map tour IDs to field slugs for auto-scrolling
  useEffect(() => {
    if (!currentStep) return;
    const map = {
      'asset-id': 'id',
      'asset-type': 'typeId',
      'asset-details': 'serial_number', // Scroll to first field in details section
      'asset-save': 'image', // Scroll to near the bottom where save button is
    };
    const slug = map[currentStep.targetId];
    if (slug) {
      if (Platform.OS === 'web') {
        // On web, try to scroll even if fieldYs is not set yet
        // Use a small delay to allow layout to complete
        setTimeout(() => {
          if (fieldYs.current[slug] !== undefined) {
            scrollToSlug(slug);
          } else if (slug === 'image') {
            // Fallback: scroll to bottom for save button
            if (typeof window !== 'undefined') {
              window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
            }
          }
        }, 200);
      } else if (fieldYs.current[slug] !== undefined) {
        scrollToSlug(slug);
      }
    }
  }, [currentStep]);

  useEffect(() => {
    if (ensureVisible && scrollViewRef.current) {
      ensureVisible(scrollViewRef.current);
    }
  }, [ensureVisible]);

  const focusSlug = (slug) => {
    const ref = fieldRefs.current[slug];
    if (ref && typeof ref.focus === 'function') {
      // Delay a bit so it focuses after scroll
      setTimeout(() => ref.focus(), 120);
    }
  };

  const scrollAndFocus = (slug) => {
    scrollToSlug(slug);
    focusSlug(slug);
  };

  const scrollToFirstError = (errs) => {
    const keys = Object.keys(errs).filter((k) => k !== '__form' && errs[k]);
    if (keys.length) scrollAndFocus(keys[0]);
  };

  // Admin gate via DB user role
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      try {
        if (!u) { setIsAdmin(false); setChecking(false); return; }
        const res = await fetch(`${API_BASE_URL}/users/${u.uid}`);
        const dbUser = res.ok ? await res.json() : null;
        setIsAdmin(dbUser?.role === 'ADMIN');
      } catch {
        setIsAdmin(false);
      } finally {
        setChecking(false);
      }
    });
    return unsub;
  }, []);

  // ---------- static / non-dynamic fields ----------
  const [image, setImage] = useState(null);
  // Ref + unmount cleanup so we revoke any leftover blob: URL when the user
  // navigates away (prevents the Chrome STATUS_ILLEGAL_INSTRUCTION crash
  // after repeated Replace clicks).
  const imageUriRef = useRef(null);
  useEffect(() => { imageUriRef.current = image?.uri || null; }, [image]);
  useEffect(() => () => { revokeImageUri(imageUriRef.current); }, []);

  const [document, setDocument] = useState(null);
  // For custom URL fields: allow selecting a document and auto-fill with S3 URL after upload
  const [urlDocMap, setUrlDocMap] = useState({}); // { [slug]: { uri, name, mimeType } }

  // UI error bag
  const [errors, setErrors] = useState({});       // { slugOrFieldName: "message" }
  const [formError, setFormError] = useState(''); // fallback for unknown errors

  // Upload state — use a ref as a double-submit guard so rapid taps can't fire twice
  // before the first setUploading(true) re-render lands.
  const submittingRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0); // 0..100
  const [uploadStartTs, setUploadStartTs] = useState(null); // Date.now()
  const [indetTick, setIndetTick] = useState(0);
  // Web-only: direct DOM overlay to guarantee visibility regardless of RNW Modal quirks
  const webDomOverlayRef = useRef(null);

  // dropdown meta
  const [options, setOptions] = useState({ assetTypes: [], users: [], statuses: [], assetIds: [] });
  const [typeOpen, setTypeOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [toast, setToast] = useState({ visible: false, text: '', kind: 'success' });
  const showToast = (text, kind = 'success') => {
    setToast({ visible: true, text, kind });
    setTimeout(() => setToast({ visible: false, text: '', kind }), 2500);
  };

  // qr picker
  const [showQRs, setShowQRs] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredAssetIds, setFilteredAssetIds] = useState([]);

  // Keep filtered list in sync with searchTerm and the available QR IDs
  useEffect(() => {
    const all = options.assetIds || [];
    if (!searchTerm) { setFilteredAssetIds(all); return; }
    const q = searchTerm.toLowerCase();
    setFilteredAssetIds(all.filter(qrId => String(qrId).toLowerCase().includes(q)));
  }, [searchTerm, options.assetIds]);

  // ---------- core form ----------
  const [id, setId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [assignedToId, setAssignedToId] = useState('');
  const [status, setStatus] = useState('In Service');
  const [location, setLocation] = useState('');
  const [locQuery, setLocQuery] = useState('');
  const [locOpen, setLocOpen] = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  const [locSuggestions, setLocSuggestions] = useState([]);
  const [locSuggestEnabled, setLocSuggestEnabled] = useState(true);
  const [locSuggestError, setLocSuggestError] = useState('');

  // classic top-level fields
  const [model, setModel] = useState('');
  const [description, setDescription] = useState('');
  // Default purchase date to today (YYYY-MM-DD)
  const __today = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  })();
  const [datePurchased, setDatePurchased] = useState(__today);
  const [notes, setNotes] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [otherId, setOtherId] = useState('');

  // dynamic schema & values
  const [fieldsSchema, setFieldsSchema] = useState([]); // backend-defined fields for the chosen type
  const [fieldValues, setFieldValues] = useState({});
  const [datePicker, setDatePicker] = useState({ open: false, slug: null });

  // ── Type-aware suggestions ────────────────────────────────────────────
  // Pull all existing assets once on mount so we can suggest common values
  // (model, description, custom fields) and an incremented Other ID based on
  // what's already in inventory for the selected type.
  const [allAssets, setAllAssets] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/assets`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => { if (!cancelled && Array.isArray(data)) setAllAssets(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Assets of the currently-selected type — the suggestion pool.
  const typeAssets = useMemo(() => {
    if (!typeId) return [];
    return allAssets.filter((a) => String(a?.type_id || '') === String(typeId));
  }, [allAssets, typeId]);

  /** Unique non-empty trimmed values from a field across `typeAssets`. */
  const collectDistinct = (getter) => {
    const seen = new Set();
    const out = [];
    for (const a of typeAssets) {
      const raw = getter(a);
      if (raw == null) continue;
      const s = String(raw).trim();
      if (!s) continue;
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
    return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  };

  const modelSuggestions = useMemo(
    () => collectDistinct((a) => a?.model ?? a?.fields?.model),
    [typeAssets], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const descriptionSuggestions = useMemo(
    () => collectDistinct((a) => a?.description ?? a?.fields?.description),
    [typeAssets], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Which suggestion dropdown is currently open ('model' | 'description' | 'other_id' | null).
  const [suggestOpen, setSuggestOpen] = useState(null);

  /**
   * Next Other ID suggestion. Detects `<prefix><number>` patterns in existing
   * other_id values for this type, picks the most-common prefix, and returns
   * `prefix + (maxNumber + 1)` preserving zero-padding.
   * Returns `null` if no usable pattern is found.
   */
  const nextOtherIdSuggestion = useMemo(() => {
    const raws = typeAssets
      .map((a) => String(a?.other_id ?? a?.fields?.other_id ?? '').trim())
      .filter(Boolean);
    if (raws.length === 0) return null;
    const re = /^(.*?)(\d+)$/;
    /** @type {Record<string, {samples: number, max: number, pad: number}>} */
    const groups = {};
    for (const v of raws) {
      const m = v.match(re);
      if (!m) continue;
      const prefix = m[1];
      const numStr = m[2];
      const n = parseInt(numStr, 10);
      if (!Number.isFinite(n)) continue;
      const g = groups[prefix] || { samples: 0, max: -Infinity, pad: 0 };
      g.samples += 1;
      if (n > g.max) g.max = n;
      // Track the longest digit-length so we can preserve zero-padding
      g.pad = Math.max(g.pad, numStr.length);
      groups[prefix] = g;
    }
    let best = null;
    for (const [prefix, info] of Object.entries(groups)) {
      if (!best || info.samples > best.samples) best = { prefix, ...info };
    }
    if (!best || !Number.isFinite(best.max)) return null;
    const nextN = best.max + 1;
    const nextStr = String(nextN).padStart(best.pad, '0');
    return `${best.prefix}${nextStr}`;
  }, [typeAssets]);

  // ── Image-based auto-fill (dedicated picker, NOT the asset image) ───
  // Separate flow from the asset's hero image. The user opens a dedicated
  // picker (camera on native, file/camera on web), the photo is sent to
  // /assets/scan-image where a vision model extracts model / serial /
  // description / price, and any currently-empty matching field is filled.
  // The picked photo itself is NEVER persisted as the asset's image — it's
  // ephemeral and the blob URL is revoked as soon as the request returns.
  // User-typed values are never overwritten.
  const [scanning, setScanning] = useState(false);
  const [scanResultLabel, setScanResultLabel] = useState('');

  const applyScanResult = useCallback((fields) => {
    const f = fields || {};
    const filled = [];
    if (f.model && !String(model || '').trim()) { setModel(String(f.model)); filled.push('Model'); }
    if (f.serial_number && !String(serialNumber || '').trim()) { setSerialNumber(String(f.serial_number)); filled.push('Serial Number'); }
    if (f.description && !String(description || '').trim()) { setDescription(String(f.description)); filled.push('Description'); }
    if (f.price && !String(fieldValues?.purchase_price || '').trim()) {
      setFieldValues((prev) => ({ ...prev, purchase_price: String(f.price) }));
      filled.push('Purchase price');
    }
    setScanResultLabel(
      filled.length === 0
        ? 'No new values found in photo (or fields already filled).'
        : `Filled ${filled.join(', ')} from photo.`
    );
  }, [model, serialNumber, description, fieldValues]);

  /**
   * Send a picked file to the server's vision endpoint and apply the result.
   * Accepts the same { uri, file, name, type } shape returned by our picker
   * helpers — so it works for web File uploads and native ImagePicker assets.
   */
  const runScan = useCallback(async (picked) => {
    if (!picked) return;
    setScanning(true);
    setScanResultLabel('');
    try {
      const form = new FormData();
      if (picked.file && typeof File !== 'undefined' && picked.file instanceof File) {
        form.append('image', picked.file);
      } else if (picked.uri) {
        form.append('image', {
          uri: picked.uri,
          name: picked.name || 'scan.jpg',
          type: picked.type || 'image/jpeg',
        });
      } else {
        Alert.alert('Could not read photo', 'The selected photo could not be opened.');
        return;
      }
      const res = await fetch(`${API_BASE_URL}/assets/scan-image`, { method: 'POST', body: form });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) {
        Alert.alert('Could not scan photo', j?.error || `Scan failed (HTTP ${res.status}).`);
        return;
      }
      applyScanResult(j.fields);
    } catch (e) {
      Alert.alert('Could not scan photo', e?.message || 'Network error.');
    } finally {
      // Free the ephemeral blob URL — we never kept this photo around.
      try { revokeImageUri(picked?.uri); } catch { /* ignore */ }
      setScanning(false);
    }
  }, [applyScanResult]);

  /**
   * Open the dedicated "scan asset photo" picker. On native, presents an
   * Alert with Take Photo / Choose from Library. On web, opens the file
   * dialog (mobile browsers will surface the camera via accept="image/*").
   */
  const handleScanImage = useCallback(async () => {
    if (scanning) return;
    try {
      if (Platform.OS !== 'web') {
        Alert.alert(
          'Scan asset',
          'Take a photo of the nameplate, label, or receipt — we\'ll auto-fill the fields.',
          [
            {
              text: 'Take Photo',
              onPress: async () => {
                const { status } = await ImagePicker.requestCameraPermissionsAsync();
                if (status !== 'granted') {
                  Alert.alert('Permission Required', 'Camera permission is required to take photos.');
                  return;
                }
                const { assets, canceled } = await ImagePicker.launchCameraAsync({
                  mediaTypes: ImagePicker.MediaTypeOptions.Images,
                  allowsEditing: false,
                  quality: 0.7,
                });
                if (canceled || !assets?.length) return;
                const asset = assets[0];
                const contentType = (asset.mimeType || 'image/jpeg').replace(/jpg/i, 'jpeg');
                await runScan({
                  uri: asset.uri,
                  file: { uri: asset.uri, name: asset.fileName || `scan_${Date.now()}.jpg`, type: contentType },
                  name: asset.fileName || `scan_${Date.now()}.jpg`,
                  type: contentType,
                });
              },
            },
            {
              text: 'Choose from Library',
              onPress: async () => {
                const result = await getImageFileFromPicker();
                if (!result) return;
                await runScan(result);
              },
            },
            { text: 'Cancel', style: 'cancel' },
          ],
          { cancelable: true }
        );
        return;
      }
      // Web — same library picker (mobile browsers expose camera via the OS sheet)
      const result = await getImageFileFromPicker();
      if (!result) return;
      await runScan(result);
    } catch (e) {
      Alert.alert('Could not scan photo', e?.message || 'Could not open photo picker.');
    }
  }, [scanning, runScan]);

  // ---------- load dropdowns & optional copy-from ----------
  useEffect(() => {
    fetchDropdownOptions().then((data) => {
      const normAssetIds = Array.isArray(data.assetIds)
        ? data.assetIds
          .map(a => (typeof a === 'string' ? a : (a && a.id ? String(a.id) : null)))
          .filter(Boolean)
        : [];
      setOptions({
        assetTypes: data.assetTypes || [],
        users: data.users || [],
        statuses: data.statuses || [],
        assetIds: normAssetIds,
      });
      setFilteredAssetIds(normAssetIds);
      // If a preselected QR id is provided (from check-in), set it (and searchTerm so web input shows it)
      if (preselectId && normAssetIds.includes(String(preselectId))) {
        const sid = String(preselectId);
        setId(sid);
        setSearchTerm(sid);
      }
    });

    if (fromAssetId) {
      const toYMD = (v) => (v ? String(v).split('T')[0] : '');
      fetch(`${API_BASE_URL}/assets/${fromAssetId}`)
        .then(res => res.json())
        .then(data => {
          // Top-level fields (copy everything except the target asset id)
          setTypeId(data.type_id || '');
          setAssignedToId(data.assigned_to_id || '');
          setStatus(data.status || '');
          setLocation(data.location || '');
          setLocQuery(data.location || '');
          setModel(data.model || '');
          setDescription(data.description || '');
          setNotes(data.notes || '');
          setSerialNumber(data.serial_number || '');
          setOtherId(data.other_id || '');
          setDatePurchased(toYMD(data.date_purchased));

          // Dynamic fields
          if (data.fields && typeof data.fields === 'object') setFieldValues(data.fields);
        })
        .catch((e) => logger.error('Preselect asset fetch error', e));
    }
  }, [preselectId]);

  // Debounced Google Places suggestions via server proxy
  useEffect(() => {
    let timer;
    if (!locSuggestEnabled) return; // disabled after a server 400 (e.g., missing API key)
    const q = (locQuery || '').trim();
    if (!q) {
      setLocSuggestions([]);
      return;
    }
    if (q.length < 3) {
      setLocSuggestions([]);
      return;
    }
    timer = setTimeout(async () => {
      try {
        setLocLoading(true);
        const res = await fetch(`${API_BASE_URL}/places/autocomplete?q=${encodeURIComponent(q)}`);
        if (!res.ok) {
          let msg = '';
          try { const j = await res.json(); msg = j?.error || j?.message || ''; } catch { }
          // If server reports missing API key, permanently disable suggestions for this session
          if (res.status === 400 && /GOOGLE_PLACES_API_KEY/i.test(msg)) {
            setLocSuggestEnabled(false);
            setLocSuggestError('Location suggestions unavailable (API key not configured).');
            setLocSuggestions([]);
            return;
          }
          setLocSuggestions([]);
          return;
        }
        const json = await res.json();
        setLocSuggestions(Array.isArray(json.predictions) ? json.predictions : []);
      } catch (e) {
        setLocSuggestions([]);
      } finally {
        setLocLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [locQuery, locSuggestEnabled]);

  // ---------- fetch dynamic schema when type changes ----------
  useEffect(() => {
    let ignore = false;
    async function load() {
      if (!typeId) { setFieldsSchema([]); setFieldValues({}); return; }
      try {
        const json = await fetchFields(typeId);
        if (ignore) return;

        setFieldsSchema(json);
        const seed = { ...fieldValues };
        json.forEach(f => {
          const slug = f.slug || normSlug(f.name);
          if (seed[slug] === undefined || seed[slug] === null) {
            const t = ((f.field_type?.slug || f.field_type?.name || '')).toLowerCase();
            if (t === 'boolean') seed[slug] = false;
            else if (t === 'multiselect') seed[slug] = [];
            else if (t === 'datetime') seed[slug] = ''; // treat datetime as date (date picker)
            else seed[slug] = '';
          }
        });
        setFieldValues(seed);
      } catch (e) {
        logger.error('field schema fetch error', e);
      }
    }
    load();
    return () => { ignore = true; };
  }, [typeId]);

  // ---------- helpers ----------
  const updateField = useCallback((slug, val) => {
    setFieldValues(prev => ({ ...prev, [slug]: val }));
    setErrors(prev => ({ ...prev, [slug]: undefined }));
  }, []);

  const setFieldError = (slug, message) => {
    setErrors(prev => ({ ...prev, [slug]: message || 'Invalid value' }));
  };

  // Given a server error string, try to map to specific fields
  const distributeServerErrors = (message) => {
    const newErrs = {};
    if (!message || typeof message !== 'string') return;

    // 1) "Invalid values: ..." (may be semicolon-separated)
    const invalidIdx = message.indexOf('Invalid values:');
    if (invalidIdx !== -1) {
      const part = message.slice(invalidIdx + 'Invalid values:'.length).trim();
      const pieces = part.split(';').map(s => s.trim()).filter(Boolean);

      // Known slugs
      const known = new Set([
        'id', 'type_id', 'assigned_to_id', 'status', 'location', 'model', 'description', 'other_id', 'date_purchased', 'notes', 'image', 'document'
      ]);
      for (const f of fieldsSchema) known.add(f.slug || normSlug(f.name));

      pieces.forEach(p => {
        const tokens = p.split(/\s+/);
        const hit = Array.from(known).find(kslug =>
          p.toLowerCase().includes(kslug) ||
          p.toLowerCase().includes(kslug.replace(/_/g, '-')) ||
          tokens.some(t => normSlug(t) === kslug)
        );
        if (hit) newErrs[hit] = p; else newErrs.__form = (newErrs.__form ? newErrs.__form + ' | ' : '') + p;
      });
    }

    // 2) "Missing required: a, b, c"
    const missIdx = message.indexOf('Missing required:');
    if (missIdx !== -1) {
      const part = message.slice(missIdx + 'Missing required:'.length).trim();
      const names = part.split(',').map(s => s.trim()).filter(Boolean);
      names.forEach((n) => {
        const slugGuess = normSlug(n);
        const match = fieldsSchema.find(f => (f.slug || normSlug(f.name)) === slugGuess);
        if (match) {
          const slug = match.slug || normSlug(match.name);
          newErrs[slug] = 'Required';
        } else {
          if (slugGuess === 'type_id' || /asset[_\s-]?type/i.test(n)) newErrs.typeId = 'Required';
          if (slugGuess === 'id' || /asset[_\s-]?id/i.test(n)) newErrs.id = 'Required';
        }
      });
    }

    if (/Invalid status/i.test(message)) newErrs.status = message;
    if (!Object.keys(newErrs).length) newErrs.__form = message;

    setErrors(prev => ({ ...prev, ...newErrs }));
    setFormError(newErrs.__form || '');
    scrollToFirstError(newErrs);
  };

  // ---------- pickers with validation ----------
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // keep in sync with the API (10MB)
  const tooLargeImage = (bytes) => typeof bytes === 'number' && bytes > MAX_IMAGE_BYTES;
  const reportImageTooLarge = () => {
    const msg = 'Image is too large (max 10MB). Please choose a smaller image.';
    setFieldError('image', msg);
    scrollToFirstError({ image: msg });
    Alert.alert('Image too large', msg);
  };

  const pickImage = async () => {
    try {
      // On mobile, show options to take photo or choose from library
      if (Platform.OS !== 'web') {
        Alert.alert(
          'Select Image',
          'Choose an option',
          [
            {
              text: 'Take Photo',
              onPress: async () => {
                // Request camera permissions
                const { status } = await ImagePicker.requestCameraPermissionsAsync();
                if (status !== 'granted') {
                  Alert.alert('Permission Required', 'Camera permission is required to take photos.');
                  return;
                }

                // Launch camera
                const { assets, canceled } = await ImagePicker.launchCameraAsync({
                  mediaTypes: ImagePicker.MediaTypeOptions.Images,
                  allowsEditing: true,
                  quality: 0.7,
                });

                if (canceled || !assets?.length) return;
                const asset = assets[0];

                if (tooLargeImage(asset.fileSize)) { reportImageTooLarge(); return; }

                // Process the camera result similar to getImageFileFromPicker
                const contentType = (asset.mimeType || 'image/jpeg').replace(/jpg/i, 'jpeg');
                const allowed = new Set(ALLOWED_IMAGE_MIME_TYPES);
                if (!allowed.has(contentType)) {
                  const msg = 'Unsupported image type for this upload.';
                  setFieldError('image', msg);
                  scrollToFirstError({ image: msg });
                  return;
                }

                const name = asset.fileName || `photo_${Date.now()}.jpg`;
                const result = {
                  uri: asset.uri,
                  file: { uri: asset.uri, name, type: contentType },
                  name,
                  type: contentType,
                };

                setErrors(prev => ({ ...prev, image: undefined }));
                revokeImageUri(image?.uri);
                setImage(result);
              },
            },
            {
              text: 'Choose from Library',
              onPress: async () => {
                const result = await getImageFileFromPicker();
                if (!result) return;
                if (tooLargeImage(result.size)) { reportImageTooLarge(); return; }
                const t = String(result.type || '')
                  .replace(/^image\/jpg$/i, 'image/jpeg')
                  .toLowerCase();
                if (!ALLOWED_IMAGE_MIME_TYPES.includes(t)) {
                  const msg = 'Unsupported image type for this upload.';
                  setFieldError('image', msg);
                  scrollToFirstError({ image: msg });
                  return;
                }
                setErrors(prev => ({ ...prev, image: undefined }));
                revokeImageUri(image?.uri);
                setImage(result);
              },
            },
            {
              text: 'Cancel',
              style: 'cancel',
            },
          ],
          { cancelable: true }
        );
      } else {
        // Web: just use the library picker
        const result = await getImageFileFromPicker();
        if (!result) return;
        if (tooLargeImage(result.size)) { reportImageTooLarge(); return; }
        const t = String(result.type || '')
          .replace(/^image\/jpg$/i, 'image/jpeg')
          .toLowerCase();
        if (!ALLOWED_IMAGE_MIME_TYPES.includes(t)) {
          const msg = 'Unsupported image type for this upload.';
          setFieldError('image', msg);
          scrollToFirstError({ image: msg });
          return;
        }
        setErrors(prev => ({ ...prev, image: undefined }));
        setImage(result);
      }
    } catch (e) {
      const msg = e.message || 'Invalid image';
      setFieldError('image', msg);
      scrollToFirstError({ image: msg });
    }
  };

  const pickDocument = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (res.canceled) return;

    const asset = res.assets?.[0];
    const mime = asset?.mimeType || '';
    if (!ALLOWED_DOC_MIME.includes(mime)) {
      const msg = 'Allowed: PDF, DOC, DOCX';
      setFieldError('document', msg);
      scrollToFirstError({ document: msg });
      return;
    }
    setErrors(prev => ({ ...prev, document: undefined }));
    setDocument(asset);
  };
  // tiny cross-platform alert helper
  const warn = (msg, title = 'Select a date') => {
    if (Platform.OS === 'web') {
      // RN web Alert is sometimes inconsistent; use native window.alert
      window.alert(`${title ? title + ': ' : ''}${msg}`);
    } else {
      Alert.alert(title, msg);
    }
  };
  // ---------- client-side validation ----------
  const validate = () => {
    const newErrors = {};
    if (!id) newErrors.id = 'Please select an Asset ID';
    if (!typeId) newErrors.typeId = 'Please choose an Asset Type';

    fieldsSchema.forEach(f => {
      const slug = f.slug || normSlug(f.name);
      if (f.is_required) {
        const val = fieldValues[slug];
        const t = ((f.field_type?.slug || f.field_type?.name || '')).toLowerCase();
        let empty = false;
        if (t === 'multiselect') empty = (!Array.isArray(val) || val.length === 0);
        else if (t === 'boolean') empty = false;
        else empty = (val === undefined || val === null || String(val).trim() === '');

        // Special case: URL fields may be satisfied by an attached document for this slug
        if (t === 'url' && empty) {
          if (urlDocMap && urlDocMap[slug]) empty = false;
        }
        if (empty) newErrors[slug] = 'Required';
      }
      // Only document-primary links (attach a date to a document) enforce the
      // document when the date is set. The date→document direction was removed.
      if (['date', 'datetime'].includes(((f.field_type?.slug || f.field_type?.name || '')).toLowerCase())) {
        let linkSlug = '';
        let linkPrimary = '';
        try {
          const vr = f.validation_rules && typeof f.validation_rules === 'object'
            ? f.validation_rules
            : (f.validation_rules ? JSON.parse(f.validation_rules) : null);
          const opts = f.options && typeof f.options === 'object' ? f.options : null;
          const l = (vr && (vr.requires_document_slug || vr.require_document_slug)) || (opts && (opts.requires_document_slug || opts.require_document_slug));
          linkSlug = Array.isArray(l) ? (l[0] || '') : (l || '');
          linkSlug = String(linkSlug || '').trim();
          linkPrimary = String((vr && vr.link_primary) || '').toLowerCase();
        } catch { }
        if (linkPrimary !== 'document') linkSlug = ''; // skip removed date→document enforcement
        // Read optional requirement flag
        let requireDoc = true;
        try {
          const vr = f.validation_rules && typeof f.validation_rules === 'object'
            ? f.validation_rules
            : (f.validation_rules ? JSON.parse(f.validation_rules) : null);
          if (vr) {
            const v = vr.requires_document_required ?? vr.require_document_required ?? vr.document_required ?? vr.require_document;
            if (typeof v === 'boolean') requireDoc = v; else if (typeof v === 'string') requireDoc = v.toLowerCase() === 'true';
          }
        } catch { }
        if (linkSlug && requireDoc) {
          const dateVal = fieldValues[slug];
          if (dateVal) {
            const docSlug = normSlug(linkSlug);
            const docVal = fieldValues[docSlug];
            const hasUpload = !!(urlDocMap && urlDocMap[docSlug]);
            if ((!docVal || String(docVal).trim() === '') && !hasUpload) {
              newErrors[docSlug] = `Required with ${f.label || f.name}`;
            }
          }
        }
      }
      if (((f.field_type?.slug || f.field_type?.name || '')).toLowerCase() === 'number') {
        const v = fieldValues[slug];
        if (v !== '' && v !== undefined && v !== null && isNaN(Number(v))) {
          newErrors[slug] = 'Must be a number';
        }
      }
      if (['date', 'datetime'].includes(((f.field_type?.slug || f.field_type?.name || '')).toLowerCase())) {
        const v = fieldValues[slug];
        if (v && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
          newErrors[slug] = 'Must be YYYY-MM-DD';
        }
      }
    });

    setErrors(newErrors);
    setFormError('');
    if (Object.keys(newErrors).length) {
      scrollToFirstError(newErrors);
      return false;
    }
    return true;
  };

  // ---------- submit with progress ----------
  const submit = async () => {
    // Ref guard prevents double-fire when the button is tapped before the
    // first setUploading(true) re-render has landed (race condition on fast taps).
    if (submittingRef.current || uploading) return;
    if (!validate()) return;
    submittingRef.current = true;

    const data = new FormData();
    data.append('id', id);
    data.append('type_id', typeId);
    if (assignedToId) data.append('assigned_to_id', assignedToId);
    if (status) data.append('status', status);
    // Build dynamic fields payload (include next_service_date when type has it and user filled it)
    data.append('fields', JSON.stringify(fieldValues));
    if (model) data.append('model', model);
    if (description) data.append('description', description); if (datePurchased) data.append('date_purchased', datePurchased); if (serialNumber) data.append('serial_number', serialNumber);
    if (otherId) data.append('other_id', otherId);

    if (image?.file) data.append('image', image.file, image.file.name || 'upload.jpg');
    // When user picked document(s) for URL fields (e.g. Calibration Certificate), send the first one
    // in the create request and tell the API which slugs to fill so validation passes.
    // Otherwise use the legacy top-level document picker if no URL-field docs were chosen.
    const urlDocEntries = Object.entries(urlDocMap).filter(([, v]) => !!v);
    const docToUpload = urlDocEntries.length > 0 ? urlDocEntries[0][1] : document;
    const shouldSendDoc = !!docToUpload;
    if (shouldSendDoc) {
      if (urlDocEntries.length > 0) {
        data.append('url_doc_slugs', JSON.stringify(urlDocEntries.map(([slug]) => slug)));
      }
      if (Platform.OS === 'web') {
        try {
          const resp = await fetch(docToUpload.uri);
          const blob = await resp.blob();
          const file = new File([blob], docToUpload.name || 'document.pdf', { type: docToUpload.mimeType || blob.type || 'application/pdf' });
          data.append('document', file, file.name);
        } catch {
          data.append('document', { uri: docToUpload.uri, name: docToUpload.name || 'document.pdf', type: docToUpload.mimeType || 'application/pdf' });
        }
      } else {
        data.append('document', { uri: docToUpload.uri, name: docToUpload.name || 'document.pdf', type: docToUpload.mimeType || 'application/pdf' });
      }
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadStartTs(Date.now());
    // Yield to the UI so the modal renders before starting the upload
    await new Promise((r) => setTimeout(r, 0));

    const handleServerFailure = async (errLike) => {
      try {
        if (errLike && typeof errLike.text === 'function') {
          const raw = await errLike.text();
          let parsed; try { parsed = JSON.parse(raw); } catch { }
          const message = (parsed && (parsed.error || parsed.message)) || raw || 'Failed to create asset';
          distributeServerErrors(message);
          Alert.alert('Error', message);
          return;
        }
        if (errLike && typeof errLike === 'object' && 'responseText' in errLike) {
          const raw = String(errLike.responseText || '');
          let parsed; try { parsed = JSON.parse(raw); } catch { }
          const message = (parsed && (parsed.error || parsed.message)) || raw || 'Failed to create asset';
          distributeServerErrors(message);
          Alert.alert('Error', message);
          return;
        }
        if (typeof errLike === 'string') {
          let parsed; try { parsed = JSON.parse(errLike); } catch { }
          const message = (parsed && (parsed.error || parsed.message)) || errLike || 'Failed to create asset';
          distributeServerErrors(message);
          // Give a helpful hint when the ID is already in use — the asset likely
          // exists from a previous attempt; offer to open it rather than retry.
          if (/already in use/i.test(message) && id) {
            Alert.alert(
              'Asset Already Exists',
              `${message}\n\nThe asset was already created — would you like to open it?`,
              [
                { text: 'Open Asset', onPress: () => router.replace(`/asset/${id}`) },
                { text: 'Dismiss', style: 'cancel' },
              ],
            );
          } else {
            Alert.alert('Error', message);
          }
          return;
        }
        const message = errLike?.message || 'Failed to create asset';
        distributeServerErrors(message);
        Alert.alert('Error', message);
      } catch {
        Alert.alert('Error', 'Failed to create asset');
      }
    };

    try {
      // Use XHR on all platforms to surface progress
      let createdAsset = null;
      await new Promise(async (resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE_URL}/assets`);
        await setXHRAuthHeaders(xhr);
        xhr.upload.onprogress = (e) => {
          if (e && e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setUploadProgress(pct);
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try { createdAsset = JSON.parse(xhr.responseText || '{}')?.asset || null; } catch { }
            resolve();
          }
          else {
            handleServerFailure(xhr.responseText);
            reject(new Error('upload-failed'));
          }
        };
        xhr.onerror = () => {
          handleServerFailure('Network error');
          reject(new Error('network-error'));
        };
        xhr.send(data);
      });

      // After create: upload each selected per-field document to asset_documents
      try {
        if (createdAsset && createdAsset.id && urlDocEntries.length > 0) {
          // Build mapping docSlug -> { dateLabel, dateValue, fieldId, fieldName }
          const norm = (s) => String(s || '').toLowerCase().trim().replace(/[\s\-]+/g, '_').replace(/[^a-z0-9_]/g, '');
          const toTitle = (s) => {
            const txt = String(s || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
            return txt.split(' ').map(w => (w ? w.charAt(0).toUpperCase() + w.slice(1) : '')).join(' ');
          };
          const parseJsonMaybe = (v) => { if (!v) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };
          const docMeta = {};
          for (const df of (fieldsSchema || [])) {
            const slug = df.slug || norm(df.name);
            const typeCode = (df.field_type?.slug || df.field_type?.name || '').toLowerCase();
            if (typeCode === 'date' || typeCode === 'datetime') {
              const vr = parseJsonMaybe(df.validation_rules) || {};
              const opts = parseJsonMaybe(df.options) || {};
              // Only document-primary links carry the date onto the document.
              if (String(vr.link_primary || '').toLowerCase() !== 'document') continue;
              const link = vr.requires_document_slug || vr.require_document_slug || opts.requires_document_slug || opts.require_document_slug;
              let docSlug = Array.isArray(link) ? (link[0] || '') : (link || '');
              docSlug = norm(docSlug);
              if (!docSlug) continue;
              const dateVal = fieldValues[slug];
              const docField = (fieldsSchema || []).find(ff => (ff.slug || norm(ff.name)) === docSlug) || null;
              docMeta[docSlug] = {
                dateLabel: df.label || df.name || slug,
                dateValue: dateVal || null,
                fieldId: docField?.id || null,
                fieldName: docField?.name || docSlug,
              };
            }
          }
          // Upload each picked doc
          for (const [docSlug, picked] of urlDocEntries) {
            try {
              const meta = docMeta[norm(docSlug)] || {};
              const fd = new FormData();
              // attach file
              if (Platform.OS === 'web') {
                try {
                  const resp = await fetch(picked.uri);
                  const blob = await resp.blob();
                  const file = new File([blob], picked.name || 'document.pdf', { type: picked.mimeType || blob.type || 'application/pdf' });
                  fd.append('file', file, file.name);
                } catch {
                  fd.append('file', { uri: picked.uri, name: picked.name || 'document.pdf', type: picked.mimeType || 'application/pdf' });
                }
              } else {
                fd.append('file', { uri: picked.uri, name: picked.name || 'document.pdf', type: picked.mimeType || 'application/pdf' });
              }
              if (meta.fieldId) fd.append('asset_type_field_id', String(meta.fieldId));
              const rawName = meta.fieldName || docSlug;
              const niceName = toTitle(rawName);
              fd.append('title', niceName);
              fd.append('kind', niceName);
              if (meta.dateLabel) fd.append('related_date_label', String(meta.dateLabel));
              if (meta.dateValue) fd.append('related_date', String(meta.dateValue));
              const resp = await fetch(`${API_BASE_URL}/assets/${createdAsset.id}/documents/upload`, {
                method: 'POST',
                headers: await getAuthHeaders(),
                body: fd,
              });
              if (!resp.ok) {
                // swallow to avoid blocking creation; user can reattach later
                continue;
              }
            } catch {
              // ignore individual failures to not block the whole flow
            }
          }
        }
      } catch { }

      showToast('Asset created!');
      // Refresh Tasks tab badge so reminder tasks from this asset (e.g. cert expiry) are reflected
      const uid = auth.currentUser?.uid;
      if (uid) {
        (async () => {
          try {
            const res = await fetch(`${API_BASE_URL}/users/${uid}`);
            const data = res.ok ? await res.json() : null;
            const canAdmin = String(data?.role || '').toUpperCase() === 'ADMIN';
            const count = await fetchTaskCount(uid, canAdmin);
            setTaskCount(count);
          } catch (_) {}
        })();
      }

      setTimeout(() => {
        if (normalizedReturnTo) {
          try { router.replace(String(normalizedReturnTo)); } catch { router.back(); }
        } else {
          router.replace({ pathname: '/Inventory', params: { tab: 'all' } });
        }
      }, 1000);
    } catch (_e) {
      // handled above
    } finally {
      submittingRef.current = false;
      setUploading(false);
      setUploadProgress(0);
      setUploadStartTs(null);
    }
  };

  // ---------- Web DOM overlay (guaranteed) ----------
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    try {
      if (uploading) {
        // Create if missing
        if (!webDomOverlayRef.current) {
          const el = document.createElement('div');
          el.style.position = 'fixed';
          el.style.top = '0'; el.style.left = '0'; el.style.right = '0'; el.style.bottom = '0';
          el.style.zIndex = '2147483647';
          el.style.background = 'rgba(255,255,255,0.85)';
          el.style.display = 'flex';
          el.style.alignItems = 'center';
          el.style.justifyContent = 'center';
          el.innerHTML = `
            <div style="text-align:center;font-family:system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial; color:#1E293B">
              <div class="spin" style="width:32px;height:32px;border:3px solid #FFEDD5;border-top-color:#EA580C;border-radius:50%;margin:0 auto;animation:rnwspin 0.9s linear infinite"></div>
              <div style="margin-top:10px">Uploading <span id="pct">0%</span></div>
              <div style="width:260px;height:8px;background:#EDEAE6;border-radius:6px;overflow:hidden;margin:8px auto 0">
                <div id="bar" style="height:8px;background:#EA580C;width:0;border-radius:6px"></div>
              </div>
              <div id="secs" style="margin-top:6px;color:#57534E"></div>
            </div>
            <style>@keyframes rnwspin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style>
          `;
          document.body.appendChild(el);
          webDomOverlayRef.current = el;
        }
        // Update progress text and bar
        const el = webDomOverlayRef.current;
        const pctNode = el.querySelector('#pct');
        const barNode = el.querySelector('#bar');
        const secsNode = el.querySelector('#secs');
        if (pctNode) pctNode.textContent = `${Math.max(0, Math.floor(uploadProgress || 0))}%`;
        if (barNode) barNode.style.width = `${Math.max(0, Math.min(100, uploadProgress || 0)) * 2.6}px`;
        if (secsNode && uploadStartTs) secsNode.textContent = `${Math.max(0, Math.floor((Date.now() - uploadStartTs) / 1000))}s elapsed`;
      } else {
        // Remove if present
        if (webDomOverlayRef.current) {
          try { document.body.removeChild(webDomOverlayRef.current); } catch { }
          webDomOverlayRef.current = null;
        }
      }
    } catch { }
    return () => {
      if (Platform.OS !== 'web') return;
      if (webDomOverlayRef.current) {
        try { document.body.removeChild(webDomOverlayRef.current); } catch { }
        webDomOverlayRef.current = null;
      }
    };
  }, [uploading, uploadProgress, uploadStartTs]);

  // ---------- Indeterminate animation for web/native when percent is unknown ----------
  useEffect(() => {
    let timer;
    const noPct = !(typeof uploadProgress === 'number' && uploadProgress > 0);
    if (uploading && noPct) {
      timer = setInterval(() => setIndetTick((t) => (t + 8) % 100), 120);
    }
    return () => { if (timer) clearInterval(timer); };
  }, [uploading, uploadProgress]);

  // ---------- UI pieces ----------
  // Which url-field slugs are "owned" by a date field via requires_document_slug.
  // Those upload controls are rendered INSIDE the date's grouped card, so we
  // skip rendering them standalone (avoids the confusing duplicate upload).
  const docLinkInfo = useMemo(() => {
    const linkedDocSlugs = new Set();
    const dateForDoc = {};
    (fieldsSchema || []).forEach((f) => {
      const tc = ((f.field_type?.slug || f.field_type?.name || '')).toLowerCase();
      if (tc !== 'date' && tc !== 'datetime') return;
      let link = '';
      let linkPrimary = '';
      try {
        const vr = f.validation_rules && typeof f.validation_rules === 'object'
          ? f.validation_rules
          : (f.validation_rules ? JSON.parse(f.validation_rules) : null);
        const opts = f.options && typeof f.options === 'object' ? f.options : null;
        const l = (vr && (vr.requires_document_slug || vr.require_document_slug)) || (opts && (opts.requires_document_slug || opts.require_document_slug));
        link = Array.isArray(l) ? (l[0] || '') : (l || '');
        link = String(link || '').trim();
        linkPrimary = String((vr && vr.link_primary) || '').toLowerCase();
      } catch { /* ignore */ }
      // Only document-primary links group the document inside the date card
      // (attach date → document). The reverse (document attached to a date) is
      // no longer supported, so its url field renders standalone.
      if (link && linkPrimary === 'document') {
        const ds = normSlug(link);
        linkedDocSlugs.add(ds);
        dateForDoc[ds] = f;
      }
    });
    return { linkedDocSlugs, dateForDoc };
  }, [fieldsSchema]);

  const renderField = (f) => {
    const slug = f.slug || normSlug(f.name);
    let typeCode = ((f.field_type?.slug || f.field_type?.name || '')).toLowerCase();
    if (typeCode === 'datetime') typeCode = 'date';
    const isReq = !!f.is_required;
    const displayLabel = (slug === 'documentation_url') ? 'Document/attachment' : ((f.label || f.name) || slug);

    const Label = (
      <Text style={[styles.label, !!errors[slug] && styles.labelError]}>
        {displayLabel}{isReq ? ' *' : ''}
      </Text>
    );

    const selectItems = (f.options || []).map(o => ({ label: String(o.label ?? o), value: (o.value ?? o) }));

    switch (typeCode) {
      case 'url':
        // If a date field "owns" this document, it renders the upload inside
        // its grouped card — don't render a second standalone control here.
        if (docLinkInfo.linkedDocSlugs.has(slug)) return null;
        return (
          <View key={slug} style={{ marginBottom: 12 }} onLayout={onLayoutFor(slug)}>
            {Label}
            <Text style={styles.uploadHint}>{ASSET_DOCUMENT_FIELD_HINT}</Text>
            {(() => {
              const picked = urlDocMap[slug];
              const existing = fieldValues[slug];
              const urlLike = typeof existing === 'string' && /^https?:\/\//i.test(existing);
              const nameFromUrl = urlLike ? decodeURIComponent(existing.split('?')[0].split('#')[0].split('/').pop() || 'document') : null;
              const name = picked?.name || nameFromUrl;
              return name ? (
                <Text style={{ marginTop: 6, fontStyle: 'italic', color: '#444' }}>Attached: {name}</Text>
              ) : null;
            })()}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <TouchableOpacity
                style={[styles.btn, { paddingVertical: 10 }]}
                onPress={async () => {
                  try {
                    const res = await DocumentPicker.getDocumentAsync({
                      type: [
                        'application/pdf',
                        'application/msword',
                        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                      ],
                      multiple: false,
                    });
                    if (res.canceled) return;
                    const asset = res.assets?.[0];
                    if (!asset) return;
                    setUrlDocMap((m) => ({ ...m, [slug]: asset }));
                    // Clear any previous "Required" error for this URL field
                    setErrors((prev) => ({ ...prev, [slug]: undefined }));
                  } catch (e) {
                    Alert.alert('Error', e.message || 'Failed to select document');
                  }
                }}
              >
                <Text>{urlDocMap[slug] ? 'Replace Document' : 'Upload Document'}</Text>
              </TouchableOpacity>
              {urlDocMap[slug] ? (
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: Colors.dangerBg, paddingVertical: 10 }]}
                  onPress={() => {
                    setUrlDocMap((m) => { const n = { ...m }; delete n[slug]; return n; });
                    // Clear error; validation will re-add if needed on submit
                    setErrors((prev) => ({ ...prev, [slug]: undefined }));
                  }}
                >
                  <Text style={{ color: Colors.dangerFg }}>Remove</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {/* filename now shown above the buttons */}
            {!!errors[slug] && <Text style={styles.errorBelow}>{errors[slug]}</Text>}
          </View>
        );

      case 'text':
      case 'textarea':
      case 'email':
        return (
          <View key={slug} style={{ marginBottom: 12 }} onLayout={onLayoutFor(slug)}>
            {Label}
            <TextInput
              ref={setInputRef(slug)}
              style={[styles.input, !!errors[slug] && styles.inputError, typeCode === 'textarea' && { height: 90 }]}
              placeholder={`Enter ${f.label || f.name}`}
              value={String(fieldValues[slug] ?? '')}
              onChangeText={(t) => updateField(slug, t)}
              multiline={typeCode === 'textarea'}
              maxLength={typeCode === 'textarea' ? FIELD_LIMITS.NOTES : FIELD_LIMITS.FIELD_VALUE}
            />
            {!!errors[slug] && <Text style={styles.errorBelow}>{errors[slug]}</Text>}
          </View>
        );

      case 'number':
        return (
          <View key={slug} style={{ marginBottom: 12 }} onLayout={onLayoutFor(slug)}>
            {Label}
            <TextInput
              ref={setInputRef(slug)}
              style={[styles.input, !!errors[slug] && styles.inputError]}
              placeholder={`Enter ${f.label || f.name}`}
              keyboardType="numeric"
              value={fieldValues[slug] !== undefined && fieldValues[slug] !== null ? String(fieldValues[slug]) : ''}
              onChangeText={(t) => updateField(slug, t.replace(/[^\d.-]/g, ''))}
            />
            {!!errors[slug] && <Text style={styles.errorBelow}>{errors[slug]}</Text>}
          </View>
        );

      case 'currency':
        return (
          <View key={slug} style={{ marginBottom: 12 }} onLayout={onLayoutFor(slug)}>
            {Label}
            <View style={[styles.currencyField, !!errors[slug] && styles.inputError]}>
              <Text style={styles.currencyPrefix}>$</Text>
              <TextInput
                ref={setInputRef(slug)}
                style={styles.currencyInput}
                placeholder="0.00"
                placeholderTextColor={Colors.sub2}
                keyboardType="numeric"
                value={fieldValues[slug] !== undefined && fieldValues[slug] !== null ? String(fieldValues[slug]) : ''}
                // Store the raw number only — the $ is a display affordance.
                onChangeText={(t) => updateField(slug, t.replace(/[^\d.]/g, ''))}
              />
            </View>
            {!!errors[slug] && <Text style={styles.errorBelow}>{errors[slug]}</Text>}
          </View>
        );

      case 'date':
      case 'datetime': {
        // Try to read a linked document slug + which side is "primary"
        let requiredDocSlug = '';
        let linkPrimary = '';
        try {
          const vr = f.validation_rules && typeof f.validation_rules === 'object'
            ? f.validation_rules
            : (f.validation_rules ? JSON.parse(f.validation_rules) : null);
          const opts = f.options && typeof f.options === 'object' ? f.options : null;
          const link = (vr && (vr.requires_document_slug || vr.require_document_slug)) || (opts && (opts.requires_document_slug || opts.require_document_slug));
          requiredDocSlug = Array.isArray(link) ? (link[0] || '') : (link || '');
          requiredDocSlug = String(requiredDocSlug || '').trim();
          linkPrimary = String((vr && vr.link_primary) || '').toLowerCase();
        } catch { }

        const docSlug = requiredDocSlug ? normSlug(requiredDocSlug) : '';
        const docField = docSlug
          ? fieldsSchema.find(ff => (ff.slug || normSlug(ff.name)) === docSlug && ((ff.field_type?.slug || ff.field_type?.name || '').toLowerCase() === 'url'))
          : null;
        const pickedDoc = docSlug ? urlDocMap[docSlug] : null;
        const docName = docField ? ((docField.label || docField.name) || 'Document') : 'Document';
        const docRequired = !!docField?.is_required;
        const dateName = (f.label || f.name);

        // Plain date picker when there is no linked document, OR for the removed
        // date→document direction. Only document-primary links keep the grouped
        // card (attach a date to a document).
        if (!docSlug || linkPrimary !== 'document') {
          return (
            <View key={slug} style={{ marginBottom: 12 }} onLayout={onLayoutFor(slug)}>
              {Label}
              <TouchableOpacity style={[styles.input, !!errors[slug] && styles.inputError]} onPress={() => setDatePicker({ open: true, slug })}>
                <Text style={{ color: fieldValues[slug] ? '#000' : '#888' }}>
                  {fieldValues[slug] ? formatDisplayDate(fieldValues[slug]) : `Select ${f.label || f.name}`}
                </Text>
              </TouchableOpacity>
              {!!errors[slug] && <Text style={styles.errorBelow}>{errors[slug]}</Text>}
            </View>
          );
        }

        // The two sub-controls, rendered in an order that depends on which
        // side is the "primary" of the link (so labels never get swapped).
        const dateIsPrimary = linkPrimary === 'date';
        const headlineText = dateIsPrimary ? `${dateName}${isReq ? ' *' : ''}` : `${docName}${docRequired ? ' *' : ''}`;

        const UploadBlock = (
          <View>
            {!dateIsPrimary ? null : (
              <Text style={[styles.label, { marginTop: 0 }]}>{docName}{docRequired ? ' *' : ''}</Text>
            )}
            <Text style={styles.uploadHint}>{ASSET_DOCUMENT_FIELD_HINT}</Text>
            {pickedDoc ? (
              <Text style={{ marginTop: 6, fontStyle: 'italic', color: '#444' }}>Attached: {pickedDoc.name || 'document'}</Text>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <TouchableOpacity
                style={[styles.btn, { paddingVertical: 10 }]}
                onPress={async () => {
                  try {
                    const res = await DocumentPicker.getDocumentAsync({ type: ALLOWED_DOC_MIME, multiple: false });
                    if (res.canceled) return;
                    const asset = res.assets?.[0];
                    if (!asset) return;
                    setUrlDocMap((m) => ({ ...m, [docSlug]: asset }));
                    setErrors((prev) => ({ ...prev, [docSlug]: undefined }));
                  } catch (e) {
                    Alert.alert('Error', e.message || 'Failed to select document');
                  }
                }}
              >
                <Text>{pickedDoc ? 'Replace Document' : 'Upload Document'}</Text>
              </TouchableOpacity>
              {pickedDoc ? (
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: Colors.dangerBg, paddingVertical: 10 }]}
                  onPress={() => {
                    setUrlDocMap((m) => { const n = { ...m }; delete n[docSlug]; return n; });
                    setErrors((prev) => ({ ...prev, [docSlug]: undefined }));
                  }}
                >
                  <Text style={{ color: Colors.dangerFg }}>Remove</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {!!errors[docSlug] && <Text style={styles.errorBelow}>{errors[docSlug]}</Text>}
          </View>
        );

        const DateBlock = (
          <View>
            {!dateIsPrimary ? (
              <Text style={[styles.label, { marginTop: 0 }, !!errors[slug] && styles.labelError]}>{dateName}{isReq ? ' *' : ''}</Text>
            ) : null}
            <TouchableOpacity style={[styles.input, !!errors[slug] && styles.inputError]} onPress={() => setDatePicker({ open: true, slug })}>
              <Text style={{ color: fieldValues[slug] ? '#000' : '#888' }}>
                {fieldValues[slug] ? formatDisplayDate(fieldValues[slug]) : `Select ${dateName}`}
              </Text>
            </TouchableOpacity>
            {!!errors[slug] && <Text style={styles.errorBelow}>{errors[slug]}</Text>}
          </View>
        );

        // Linked document/date → ONE grouped card. Headline + order follow the
        // configured primary side: document-first or date-first.
        return (
          <View key={slug} style={styles.docGroupCard} onLayout={onLayoutFor(slug)}>
            <View style={styles.docGroupHeader}>
              <MaterialIcons name={dateIsPrimary ? 'event' : 'description'} size={18} color={Colors.primary} />
              <Text style={styles.docGroupTitle}>{headlineText}</Text>
            </View>
            {dateIsPrimary ? DateBlock : UploadBlock}
            <View style={styles.docGroupDivider} />
            {dateIsPrimary ? UploadBlock : DateBlock}
          </View>
        );
      }

      case 'boolean':
        return (
          <View key={slug} style={{ marginBottom: 12 }} onLayout={onLayoutFor(slug)}>
            {Label}
            <View style={[styles.row, { marginTop: 6 }]}>
              <Switch value={!!fieldValues[slug]} onValueChange={(v) => updateField(slug, v)} />
            </View>
            {!!errors[slug] && <Text style={styles.errorBelow}>{errors[slug]}</Text>}
          </View>
        );

      case 'select':
        return (
          <View key={slug} style={{ zIndex: 3000, marginBottom: 18 }} onLayout={onLayoutFor(slug)}>
            {Label}
            <DropDownPicker
              open={!!f.__open}
              setOpen={(o) => { f.__open = o; setFieldsSchema([...fieldsSchema]); }}
              value={fieldValues[slug]}
              setValue={(fn) => updateField(slug, fn())}
              items={selectItems}
              placeholder={`Select ${f.label || f.name}`}
              style={[styles.dropdown, !!errors[slug] && styles.dropdownError]}
              dropDownContainerStyle={styles.dropdownContainer}
              nestedScrollEnabled
            />
            {!!errors[slug] && <Text style={styles.errorBelow}>{errors[slug]}</Text>}
          </View>
        );

      case 'multiselect':
        return (
          <View key={slug} style={{ zIndex: 2500, marginBottom: 18 }} onLayout={onLayoutFor(slug)}>
            {Label}
            <DropDownPicker
              multiple
              min={0}
              max={100}
              open={!!f.__open}
              setOpen={(o) => { f.__open = o; setFieldsSchema([...fieldsSchema]); }}
              value={Array.isArray(fieldValues[slug]) ? fieldValues[slug] : []}
              setValue={(fn) => updateField(slug, fn())}
              items={selectItems}
              placeholder={`Select ${f.label || f.name}`}
              style={[styles.dropdown, !!errors[slug] && styles.dropdownError]}
              dropDownContainerStyle={styles.dropdownContainer}
              mode="BADGE"
              badgeDotColors={[]}
              nestedScrollEnabled
            />
            {!!errors[slug] && <Text style={styles.errorBelow}>{errors[slug]}</Text>}
          </View>
        );

      default:
        return (
          <View key={slug} style={{ marginBottom: 12 }} onLayout={onLayoutFor(slug)}>
            {Label}
            <TextInput
              ref={setInputRef(slug)}
              style={[styles.input, !!errors[slug] && styles.inputError]}
              placeholder={`Enter ${f.label || f.name}`}
              value={String(fieldValues[slug] ?? '')}
              onChangeText={(t) => updateField(slug, t)}
              maxLength={FIELD_LIMITS.FIELD_VALUE}
            />
            {!!errors[slug] && <Text style={styles.errorBelow}>{errors[slug]}</Text>}
          </View>
        );
    }
  };

  if (checking) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Checking access…</Text>
      </SafeAreaView>
    );
  }

  if (!isAdmin) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <Text style={{ fontSize: sf(16), marginBottom: 12 }}>Admin access required.</Text>
        <TouchableOpacity onPress={() => {
          if (normalizedReturnTo) { try { router.replace(String(normalizedReturnTo)); } catch { router.back(); } }
          else { router.replace('/Inventory'); }
        }} style={{ padding: 12, borderRadius: Radius.md, backgroundColor: Colors.primary }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      {toast.visible && (
        <View style={[styles.toast, styles.toastSuccess]}>
          <Text style={styles.toastText}>{toast.text}</Text>
        </View>
      )}
      <ScreenHeader
        title="Create New Asset"
        backLabel="Inventory"
        onBack={() => {
          if (normalizedReturnTo) {
            router.replace(String(normalizedReturnTo));
            return;
          }
          router.replace({ pathname: '/Inventory', params: { tab: 'all' } });
        }}
      />
      <KeyboardAwareScrollView
        ref={scrollRef}
        contentContainerStyle={isWebWide ? [styles.container, whs.pageScroll] : styles.container}
        keyboardShouldPersistTaps="handled"
        extraScrollHeight={80}
        enableOnAndroid
      >
        {/* Web-only form header — only after an Asset ID is chosen. */}
        {isWebWide && id && (
          <WebNewAssetFormHeader
            pickedImageUri={image?.uri}
            assetTypeName={(options.assetTypes || []).find(t => t.id === typeId)?.name || ''}
            onPickImage={pickImage}
            onClearImage={() => { if (!uploading) { revokeImageUri(image?.uri); setImage(null); setErrors((prev) => ({ ...prev, image: undefined })); } }}
            uploading={uploading}
            uploadProgress={uploadProgress}
          />
        )}
        {/* Header copy */}
        <View style={{ marginBottom: 20 }}>
          {!!formError && <Text style={styles.errorTop}>{formError}</Text>}
          {fromAssetId ? (
            <Text style={{ textAlign: 'center', marginTop: 6, color: '#888' }}>
              Copying data from: <Text style={{ fontWeight: 'bold', color: '#333' }}>{fromAssetId}</Text>
            </Text>
          ) : null}
        </View>

        {/* QR / Asset ID */}
        <View onLayout={onLayoutFor('id')}>
          <Text style={[styles.label, !!errors.id && styles.labelError]}>Select Asset ID</Text>
          <TourTarget id="asset-id">
            {Platform.OS !== 'web' ? (
              <View style={{ alignItems: 'center' }}>
                {!id ? (
                  <TouchableOpacity
                    style={[styles.btn, styles.pickerBtn]}
                    onPress={() => {
                      const rp = encodeURIComponent(JSON.stringify({
                        fromAssetId: fromAssetId ? String(fromAssetId) : undefined,
                        returnTo: normalizedReturnTo ? String(normalizedReturnTo) : undefined,
                      }));
                      router.push({ pathname: '/qr-scanner', params: { intent: 'pick-id', returnTo: '/asset/new', returnParams: rp } });
                    }}
                  >
                    <Text>Scan QR to select ID</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={{ width: '100%', alignItems: 'center' }}>
                    <View style={{
                      backgroundColor: Colors.accentMuted,
                      borderWidth: 2,
                      borderColor: Colors.accent,
                      borderRadius: Radius.md,
                      paddingVertical: 16,
                      paddingHorizontal: 20,
                      marginVertical: 12,
                      width: '100%',
                      alignItems: 'center',
                    }}>
                      <Text style={{ fontSize: sf(12), color: Colors.sub, marginBottom: 6 }}>Selected Asset ID</Text>
                      <Text style={{ fontSize: sf(24), fontWeight: 'bold', color: Colors.accent, letterSpacing: 1, fontWeight: '900' }}>{id}</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.btn, { backgroundColor: Colors.dangerBg, minWidth: 180 }]}
                      onPress={() => {
                        setId('');
                        setSearchTerm('');
                        setShowQRs(false);
                        setFilteredAssetIds(options.assetIds || []);
                        setErrors(prev => ({ ...prev, id: undefined }));
                      }}
                    >
                      <Text style={{ color: Colors.dangerFg }}>Remove selected QR</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {!!errors.id && <Text style={styles.errorBelow}>{errors.id}</Text>}
              </View>
            ) : (
              <>
                {id ? (
                  <View style={{
                    backgroundColor: Colors.accentMuted,
                    borderWidth: 2,
                    borderColor: Colors.accent,
                    borderRadius: Radius.md,
                    paddingVertical: 12,
                    paddingHorizontal: 16,
                    marginBottom: 10,
                  }}>
                    <Text style={{ fontSize: sf(12), color: Colors.sub, marginBottom: 4 }}>Selected Asset ID</Text>
                    <Text style={{ fontSize: sf(20), fontWeight: 'bold', color: Colors.accent, letterSpacing: 1, fontWeight: '900' }}>{id}</Text>
                    <TouchableOpacity
                      onPress={() => { setId(''); setSearchTerm(''); setShowQRs(false); setFilteredAssetIds(options.assetIds || []); setErrors(prev => ({ ...prev, id: undefined })); }}
                      style={{ marginTop: 8, alignSelf: 'flex-start' }}
                    >
                      <Text style={{ color: Colors.dangerFg, fontWeight: '600', fontSize: sf(14) }}>Clear selection</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
                <TextInput
                  ref={setInputRef('id')}
                  style={styles.input}
                  placeholder="Search by ID"
                  value={searchTerm}
                  onChangeText={text => {
                    setSearchTerm(text);
                    if (text !== id) setId('');
                  }}
                />
                <TouchableOpacity onPress={() => setShowQRs(!showQRs)} style={styles.qrToggle}>
                  <Text style={{ color: Colors.accent, fontWeight: '900' }}>
                    {showQRs ? 'Hide QR Options ▲' : 'Show QR Options ▼'}
                  </Text>
                </TouchableOpacity>
                {!!errors.id && <Text style={styles.errorBelow}>{errors.id}</Text>}
              </>
            )}
          </TourTarget>
        </View>

        {(showQRs || searchTerm.length > 0) && (
          <View style={styles.qrGrid}>
            {filteredAssetIds.length === 0 ? (
              <Text style={{ width: '100%', textAlign: 'center', color: '#666' }}>No matching QR IDs</Text>
            ) : null}
            {filteredAssetIds.map((qrId) => (
              <TouchableOpacity
                key={qrId}
                style={[styles.qrCard, id === String(qrId) && styles.qrCardSelected]}
                onPress={() => {
                  const sid = String(qrId);
                  setId(sid);
                  setSearchTerm(sid);                // show selected ID in text box (web)
                  setShowQRs(false);
                  setErrors(prev => ({ ...prev, id: undefined }));
                  setFilteredAssetIds(options.assetIds || []);
                }}
              >
                <View style={{ width: 80, height: 80 }}>
                  <Image
                    source={{ uri: `${API_BASE_URL}/qr/${qrId}.png` }}
                    style={{ width: 80, height: 80 }}
                    resizeMode="contain"
                  />
                </View>
                <Text style={styles.qrLabel}>{qrId}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Everything below appears only once an Asset ID is selected. */}
        {id && (
          <>
        {/* Mobile-only image picker — placed AFTER the QR/Asset ID step. On
            native, scanning a QR navigates away and back, which would discard an
            already-picked image; pick the QR first, then the image persists. */}
        {!isWebWide && (
          <View onLayout={onLayoutFor('image')}>
            <Text style={styles.label}>Asset image (optional)</Text>
            {!id ? (
              <Text style={styles.uploadHint}>Select an Asset ID above first, then add an image.</Text>
            ) : (
              <>
                <View style={styles.imagePreviewBox}>
                  {image?.uri ? (
                    uploading ? (
                      <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                        <ActivityIndicator size="large" color="#1E90FF" />
                        <Text style={{ marginTop: 8, color: '#5374a6' }}>
                          Uploading image… {uploadProgress ? `${uploadProgress}%` : ''}
                        </Text>
                      </View>
                    ) : (
                      <Image source={{ uri: image.uri }} style={styles.imagePreview} resizeMode="contain" />
                    )
                  ) : (
                    <Text style={styles.imagePreviewPlaceholder}>No image yet.</Text>
                  )}
                </View>
                <Text style={styles.uploadHint}>{IMAGE_UPLOAD_HINT}</Text>
                <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                  {image?.uri ? (
                    <>
                      <TouchableOpacity
                        style={[styles.btn, { flex: 1, minWidth: 120, opacity: uploading ? 0.6 : 1 }]}
                        onPress={pickImage}
                        disabled={uploading}
                      >
                        <Text>Replace image</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.btn, styles.btnDangerOutline, { flex: 1, minWidth: 120, opacity: uploading ? 0.6 : 1 }]}
                        onPress={() => { if (!uploading) { revokeImageUri(image?.uri); setImage(null); setErrors((prev) => ({ ...prev, image: undefined })); } }}
                        disabled={uploading}
                      >
                        <Text style={styles.btnDangerOutlineText}>Remove image</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity
                      style={[styles.btn, { flex: 1, minWidth: 140, opacity: uploading ? 0.6 : 1 }]}
                      onPress={pickImage}
                      disabled={uploading}
                    >
                      <Text>Pick image</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}
          </View>
        )}

        {/* Asset Type — the field label below carries the section name,
           so no separate uppercase whs.sectionHeader (was duplicating it). */}
        <View style={{ zIndex: 4000 }} onLayout={onLayoutFor('typeId')}>
          <Text style={[styles.label, !!errors.typeId && styles.labelError]}>Asset Type *</Text>
          <TourTarget id="asset-type">
            <DropDownPicker
              open={typeOpen}
              setOpen={setTypeOpen}
              value={typeId}
              setValue={(fn) => setTypeId(fn())}
              items={(options.assetTypes || []).map(t => ({ label: t.name, value: t.id }))}
              placeholder="Select Asset Type"
              searchable
              searchPlaceholder="Search asset type"
              listMode="SCROLLVIEW"
              searchContainerStyle={{ borderWidth: 0, paddingHorizontal: 0, paddingVertical: 0, backgroundColor: 'transparent' }}
              searchTextInputStyle={{ borderWidth: 0, backgroundColor: 'transparent', paddingVertical: 8 }}
              style={[styles.dropdown, !!errors.typeId && styles.dropdownError]}
              dropDownContainerStyle={styles.dropdownContainer}
              nestedScrollEnabled
            />
          </TourTarget>
          {!!errors.typeId && <Text style={styles.errorBelow}>{errors.typeId}</Text>}
        </View>

        {/* ── Scan-from-photo card (iOS/Android only) ──────────────────
            Dedicated picker that ONLY extracts asset metadata via vision —
            the photo is never persisted as the asset's image. Hidden on
            web because the camera-on-phone flow is the primary use case
            (snap a nameplate in the field). */}
        {Platform.OS !== 'web' && (
          <View>
            <View style={whs.scanCard}>
              <View style={whs.scanCardIconWrap}>
                <MaterialIcons name="document-scanner" size={24} color="#fff" />
              </View>
              <View style={whs.scanCardTextWrap}>
                <Text style={whs.scanCardTitle}>Scan from photo</Text>
                <Text style={whs.scanCardSub}>
                  Snap or upload a photo of the asset's nameplate, label, or receipt and we'll auto-fill model, serial, description, and price.
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.btn, styles.btnScan, { minWidth: 160, marginVertical: 0, opacity: scanning ? 0.7 : 1 }]}
                onPress={handleScanImage}
                disabled={scanning}
                accessibilityRole="button"
                accessibilityLabel="Scan a photo to auto-fill fields"
              >
                {scanning ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <ActivityIndicator size="small" color="#fff" />
                    <Text style={styles.btnScanText}>Scanning…</Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <MaterialIcons name="auto-fix-high" size={16} color="#fff" />
                    <Text style={styles.btnScanText}>Scan photo</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
            {!!scanResultLabel && (
              <View style={whs.scanResultBanner}>
                <MaterialIcons name="check-circle" size={14} color={Colors.successFg} />
                <Text style={whs.scanResultBannerText}>{scanResultLabel}</Text>
              </View>
            )}
          </View>
        )}

        {/* All Asset Details - Wrapped for Tour */}
        <Text style={whs.sectionHeader}>Asset Details</Text>
        {/* zIndex on the TourTarget creates a stacking context that contains
           the inner dropdown menus (Asset Type / Assigned User / Status). Without
           this, later siblings (the Document section below) paint over the
           open menus because plain Views default to zIndex 0. */}
        <TourTarget id="asset-details" style={{ zIndex: 10 }}>
          {/* Dynamic Fields */}
          {!!typeId && fieldsSchema.map(renderField)}
          {/* Serial Number */}
          <View onLayout={onLayoutFor('serial_number')}>
            <Text style={[styles.label, !!errors.serial_number && styles.labelError]}>Serial Number</Text>
            <TextInput
              ref={setInputRef('serial_number')}
              style={[styles.input, !!errors.serial_number && styles.inputError]}
              placeholder="Serial Number"
              value={serialNumber}
              onChangeText={(t) => {
                setSerialNumber(t);
                setErrors(prev => ({ ...prev, serial_number: undefined }));
              }}
              autoCapitalize="characters"
              maxLength={FIELD_LIMITS.SERIAL}
            />
            {!!errors.serial_number && <Text style={styles.errorBelow}>{errors.serial_number}</Text>}
          </View>

          <View onLayout={onLayoutFor('other_id')} style={{ zIndex: suggestOpen === 'other_id' ? 50 : 1 }}>
            <Text style={[styles.label, !!errors.other_id && styles.labelError]}>Other ID</Text>
            <TextInput
              ref={setInputRef('other_id')}
              style={[styles.input, !!errors.other_id && styles.inputError]}
              placeholder={nextOtherIdSuggestion ? `Suggested: ${nextOtherIdSuggestion}` : 'Optional'}
              value={otherId}
              onChangeText={(t) => {
                setOtherId(t);
                setErrors(prev => ({ ...prev, other_id: undefined }));
              }}
              autoCapitalize="none"
              maxLength={FIELD_LIMITS.SERIAL}
              onFocus={() => setSuggestOpen('other_id')}
              onBlur={() => setTimeout(() => setSuggestOpen((s) => (s === 'other_id' ? null : s)), 150)}
            />
            <SuggestionDropdown
              value={otherId}
              suggestions={[]}
              forcedSuggestion={nextOtherIdSuggestion}
              visible={suggestOpen === 'other_id'}
              onPick={(v) => { setOtherId(v); setSuggestOpen(null); }}
            />
            {!!errors.other_id && <Text style={styles.errorBelow}>{errors.other_id}</Text>}
          </View>

          <View onLayout={onLayoutFor('model')} style={{ zIndex: suggestOpen === 'model' ? 50 : 1 }}>
            <Text style={[styles.label, !!errors.model && styles.labelError]}>Model</Text>
            <TextInput
              ref={setInputRef('model')}
              style={[styles.input, !!errors.model && styles.inputError]}
              placeholder="Model"
              value={model}
              onChangeText={(t) => { setModel(t); setErrors(prev => ({ ...prev, model: undefined })); setSuggestOpen('model'); }}
              maxLength={FIELD_LIMITS.MODEL}
              onFocus={() => setSuggestOpen('model')}
              onBlur={() => setTimeout(() => setSuggestOpen((s) => (s === 'model' ? null : s)), 150)}
            />
            <SuggestionDropdown
              value={model}
              suggestions={modelSuggestions}
              visible={suggestOpen === 'model'}
              onPick={(v) => { setModel(v); setSuggestOpen(null); }}
            />
            {!!errors.model && <Text style={styles.errorBelow}>{errors.model}</Text>}
          </View>

          <View onLayout={onLayoutFor('description')} style={{ zIndex: suggestOpen === 'description' ? 50 : 1 }}>
            <Text style={[styles.label, !!errors.description && styles.labelError]}>Description</Text>
            <TextInput
              ref={setInputRef('description')}
              style={[styles.input, !!errors.description && styles.inputError, { height: 80 }]}
              placeholder="Description"
              value={description}
              onChangeText={(t) => { setDescription(t); setErrors(prev => ({ ...prev, description: undefined })); setSuggestOpen('description'); }}
              multiline
              maxLength={FIELD_LIMITS.DESCRIPTION}
              onFocus={() => setSuggestOpen('description')}
              onBlur={() => setTimeout(() => setSuggestOpen((s) => (s === 'description' ? null : s)), 150)}
            />
            <SuggestionDropdown
              value={description}
              suggestions={descriptionSuggestions}
              visible={suggestOpen === 'description'}
              onPick={(v) => { setDescription(v); setSuggestOpen(null); }}
            />
            {!!errors.description && <Text style={styles.errorBelow}>{errors.description}</Text>}
          </View>
          <View onLayout={onLayoutFor('date_purchased')}>
            <Text style={[styles.label, !!errors.date_purchased && styles.labelError]}>Date Purchased</Text>
            <TouchableOpacity style={[styles.input, !!errors.date_purchased && styles.inputError]} onPress={() => setDatePicker({ open: true, slug: '__date_purchased' })}>
              <Text style={{ color: datePurchased ? '#000' : '#888' }}>
                {datePurchased ? formatDisplayDate(datePurchased) : 'Select Date Purchased'}
              </Text>
            </TouchableOpacity>
            {!!errors.date_purchased && <Text style={styles.errorBelow}>{errors.date_purchased}</Text>}
          </View>
          <View style={{ zIndex: 2000 }} onLayout={onLayoutFor('assigned_to_id')}>
            <Text style={[styles.label, !!errors.assigned_to_id && styles.labelError]}>User Assigned</Text>
            <DropDownPicker
              open={userOpen}
              setOpen={setUserOpen}
              value={assignedToId}
              setValue={(fn) => setAssignedToId(fn())}
              items={(options.users || []).map(u => ({ label: u.name, value: u.id }))}
              placeholder="Select User"
              searchable
              searchPlaceholder="Search user"
              listMode="SCROLLVIEW"
              searchContainerStyle={{ borderWidth: 0, paddingHorizontal: 0, paddingVertical: 0, backgroundColor: 'transparent' }}
              searchTextInputStyle={{ borderWidth: 0, backgroundColor: 'transparent', paddingVertical: 8 }}
              style={[styles.dropdown, !!errors.assigned_to_id && styles.dropdownError]}
              dropDownContainerStyle={styles.dropdownContainer}
              nestedScrollEnabled
            />
            {!!errors.assigned_to_id && <Text style={styles.errorBelow}>{errors.assigned_to_id}</Text>}
          </View>

          <View style={{ zIndex: 1000 }} onLayout={onLayoutFor('status')}>
            <Text style={[styles.label, !!errors.status && styles.labelError]}>Status</Text>
            <DropDownPicker
              open={statusOpen}
              setOpen={setStatusOpen}
              value={status}
              setValue={(fn) => setStatus(fn())}
              items={(options.statuses || []).map(s => ({ label: s, value: s }))}
              placeholder="Select Status"
              style={[styles.dropdown, !!errors.status && styles.dropdownError]}
              dropDownContainerStyle={styles.dropdownContainer}
              nestedScrollEnabled
            />
            {!!errors.status && <Text style={styles.errorBelow}>{errors.status}</Text>}
          </View>

          {/* Image picker was moved to the top of the form (right after the
             hero) for consistency with the Edit Asset screen. Errors that
             reference the image still surface here if any are set. */}
          {!!errors.image && <Text style={styles.errorBelow}>{errors.image}</Text>}
        </TourTarget>

        {/* Submit */}
        <TourTarget id="asset-save">
          <FormButton
            label={uploading && uploadProgress ? `Creating… ${uploadProgress}%` : 'Create Asset'}
            onPress={submit}
            loading={uploading && !uploadProgress}
            disabled={uploading}
            fullWidth
          />
        </TourTarget>

        {uploading ? (
          <View style={{ alignItems: 'center', marginTop: 8 }}>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  { width: Math.round((typeof uploadProgress === 'number' && uploadProgress > 0 ? uploadProgress : indetTick) / 100 * 260) },
                ]}
              />
            </View>
            <Text style={{ marginTop: 4, color: '#666' }}>
              {uploadStartTs ? `${Math.max(0, Math.floor((Date.now() - uploadStartTs) / 1000))}s elapsed` : ''}
            </Text>
          </View>
        ) : null}

        <View style={{ height: 120 }} />
          </>
        )}
      </KeyboardAwareScrollView>

      {/* One DatePicker for everything */}
      <AppDatePicker
        visible={datePicker.open}
        label={datePicker.slug === '__date_purchased' ? 'Date Purchased' : 'Select date'}
        value={datePicker.slug === '__date_purchased' ? datePurchased : (datePicker.slug ? fieldValues[datePicker.slug] : null)}
        onDismiss={() => setDatePicker({ open: false, slug: null })}
        onConfirm={(iso) => {
          if (datePicker.slug) {
            if (datePicker.slug === '__date_purchased') setDatePurchased(iso);
            else updateField(datePicker.slug, iso);
          }
          setDatePicker({ open: false, slug: null });
        }}
      />

      {/* Upload overlay */}
      <Modal transparent animationType="fade" visible={uploading}>
        <View style={styles.modalBackdrop}>
          <ActivityIndicator size="large" />
          <Text style={{ marginTop: 12 }}>
            Uploading{(typeof uploadProgress === 'number' && uploadProgress > 0) ? ` ${uploadProgress}%` : '…'}
          </Text>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: Math.round((typeof uploadProgress === 'number' && uploadProgress > 0 ? uploadProgress : indetTick) / 100 * 260) },
              ]}
            />
          </View>
          {uploadStartTs ? (
            <Text style={{ marginTop: 4, color: '#666' }}>
              {`${Math.max(0, Math.floor((Date.now() - uploadStartTs) / 1000))}s elapsed`}
            </Text>
          ) : null}
        </View>
      </Modal>
      {/* Web portal overlay (renders into document.body) */}
      {Platform.OS === 'web' && (
        <WebOverlayPortal visible={uploading}>
          <ActivityIndicator size="large" />
          <Text style={{ marginTop: 12 }}>
            Uploading {uploadProgress ? `${uploadProgress}%` : ''}
          </Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: Math.round(Math.max(0, Math.min(100, uploadProgress)) / 100 * 260) }]} />
          </View>
          {uploadStartTs ? (
            <Text style={{ marginTop: 4, color: '#666' }}>
              {`${Math.max(0, Math.floor((Date.now() - uploadStartTs) / 1000))}s elapsed`}
            </Text>
          ) : null}
        </WebOverlayPortal>
      )}

    </SafeAreaView>
  );
}

function WebNewAssetFormHeader({ pickedImageUri, assetTypeName, onPickImage, onClearImage, uploading, uploadProgress }) {
  const hasImage = !!pickedImageUri;
  return (
    <View style={whs.formHeader}>
      <View style={whs.formHeaderImg}>
        {hasImage ? (
          uploading ? (
            <View style={{ alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator size="large" color="#1E90FF" />
              <Text style={{ marginTop: 8, color: '#5374a6' }}>
                Uploading image… {uploadProgress ? `${uploadProgress}%` : ''}
              </Text>
            </View>
          ) : (
            <Image source={{ uri: pickedImageUri }} style={whs.formHeaderImgFull} resizeMode="contain" />
          )
        ) : (
          <View style={whs.formHeaderImgPlaceholder}>
            <MaterialIcons name="add-photo-alternate" size={40} color={Colors.sub2} />
            <Text style={whs.formHeaderImgHint}>Image optional</Text>
          </View>
        )}
      </View>
      <View style={whs.formHeaderInfo}>
        <View style={whs.formHeaderText}>
          <Text style={whs.formHeaderLabel}>Asset Management</Text>
          <Text style={whs.formHeaderTitle}>Create New Asset</Text>
          {!!assetTypeName && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <MaterialIcons name="category" size={14} color={Colors.sub2} />
              <Text style={whs.formHeaderMeta}>{assetTypeName}</Text>
            </View>
          )}
          <Text style={whs.formHeaderSub}>Select an Asset ID, choose a type, fill in the details below, and submit.</Text>
        </View>
        <View style={whs.formHeaderControls}>
          <Text style={whs.formHeaderControlsHint}>{IMAGE_UPLOAD_HINT}</Text>
          <View style={whs.formHeaderControlsRow}>
            {hasImage ? (
              <>
                <TouchableOpacity
                  style={[styles.btn, { flex: 1, minWidth: 120, marginVertical: 0, opacity: uploading ? 0.6 : 1 }]}
                  onPress={onPickImage}
                  disabled={uploading}
                >
                  <Text>Replace image</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnDangerOutline, { flex: 1, minWidth: 120, marginVertical: 0, opacity: uploading ? 0.6 : 1 }]}
                  onPress={onClearImage}
                  disabled={uploading}
                >
                  <Text style={styles.btnDangerOutlineText}>Remove image</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={[styles.btn, { flex: 1, minWidth: 140, marginVertical: 0, opacity: uploading ? 0.6 : 1 }]}
                onPress={onPickImage}
                disabled={uploading}
              >
                <Text>Pick image</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

function WebOverlayPortal({ visible, children }) {
  const mountRef = React.useRef(null);
  React.useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    if (!visible) return undefined;
    try {
      const el = document.createElement('div');
      el.style.position = 'fixed';
      el.style.top = '0'; el.style.left = '0'; el.style.right = '0'; el.style.bottom = '0';
      el.style.display = 'flex'; el.style.alignItems = 'center'; el.style.justifyContent = 'center';
      el.style.background = 'rgba(255,255,255,0.85)';
      el.style.zIndex = '2147483647';
      document.body.appendChild(el);
      mountRef.current = el;
      return () => { try { document.body.removeChild(el); } catch { } mountRef.current = null; };
    } catch { return undefined; }
  }, [visible]);
  if (Platform.OS !== 'web' || !visible || !mountRef.current) return null;
  let ReactDOM;
  try { ReactDOM = require('react-dom'); } catch { return null; }
  return ReactDOM.createPortal(
    <View style={styles.portalOverlayCard}>{children}</View>,
    mountRef.current
  );
}

const Colors = {
  primary: '#1E293B',
  primaryDark: '#0F172A',
  primaryLight: '#E2E8F0',
  accent: '#EA580C',
  accentDark: '#C2410C',
  accentLight: '#FFF7ED',
  accentMuted: '#FFEDD5',
  text: '#1C1917',
  sub: '#57534E',
  sub2: '#A8A29E',
  line: '#D6D3D1',
  bg: '#F5F3F0',
  card: '#FFFFFF',
  chip: '#EDEAE6',
  dangerFg: '#DC2626',
  dangerBg: '#FEF2F2',
  successFg: '#0D9488',
  successBg: '#F0FDFA',
};

const Radius = { sm: 6, md: 10, lg: 14 };
const CardShadow = { shadowColor: '#1C1917', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 };

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: Platform.OS === 'ios' ? 20 : 0, backgroundColor: Colors.bg },
  input: { borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.sm, padding: 12, marginVertical: 8, color: Colors.text, backgroundColor: Colors.card },
  // Currency input: a bordered row with a leading "$" adornment. The stored
  // value stays a plain number; the symbol is display-only.
  currencyField: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.sm, paddingHorizontal: 12, marginVertical: 8, backgroundColor: Colors.card },
  currencyPrefix: { fontSize: sf(16), fontWeight: '800', color: Colors.sub, marginRight: 6 },
  currencyInput: { flex: 1, paddingVertical: 12, color: Colors.text, fontSize: sf(15) },
  label: { marginTop: 10, marginBottom: 6, fontWeight: '700', color: Colors.text },
  labelError: { color: Colors.dangerFg },
  inputError: { borderColor: Colors.dangerFg },
  dropdownError: { borderColor: Colors.dangerFg },
  subtleLabel: { color: Colors.sub, fontSize: sf(12), marginTop: 6, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  btn: { backgroundColor: Colors.chip, padding: 15, alignItems: 'center', borderRadius: Radius.sm, marginVertical: 8, borderWidth: 2, borderColor: Colors.line },
  // Consistent width for media pickers (image/doc) so buttons look same size
  pickerBtn: { minWidth: 180, alignSelf: 'center' },
  submit: { backgroundColor: Colors.primary },
  submitDisabled: { opacity: 0.7, ...(Platform.OS === 'web' ? { cursor: 'not-allowed' } : null) },
  preview: { width: '100%', height: 200, borderRadius: Radius.md, marginVertical: 10, ...CardShadow },
  dropdown: { borderColor: Colors.line, marginBottom: 16, borderWidth: 2, borderRadius: Radius.sm },
  dropdownContainer: { borderColor: Colors.line, borderRadius: Radius.sm },
  qrGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginVertical: 10 },
  qrCard: { width: '30%', backgroundColor: Colors.card, padding: 6, marginBottom: 10, alignItems: 'center', borderRadius: Radius.md, borderWidth: 2, borderColor: Colors.line, ...CardShadow },
  qrCardSelected: { borderColor: Colors.successFg, borderWidth: 3, backgroundColor: Colors.successBg },
  qrLabel: { marginTop: 4, fontSize: sf(10), fontWeight: '700', color: Colors.text },
  qrToggle: { alignSelf: 'flex-end', marginBottom: 4 },

  // error styles
  errorTop: { marginTop: 8, color: Colors.dangerFg, textAlign: 'center', fontWeight: '700' },
  errorBelow: { marginTop: 4, color: Colors.dangerFg, fontWeight: '600' },
  uploadHint: { marginTop: 4, marginBottom: 8, fontSize: 12, color: '#64748B', lineHeight: 18 },

  // overlay
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  webOverlay: { display: 'none' },
  progressBar: { width: 260, height: 8, borderRadius: Radius.sm, backgroundColor: Colors.chip, marginTop: 8, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: Colors.accent, borderRadius: Radius.sm },
  portalOverlayCard: { backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },

  // location suggestions
  locSuggestBox: {
    borderWidth: 2,
    borderColor: Colors.line,
    borderRadius: Radius.md,
    paddingVertical: 6,
    marginTop: -6,
    marginBottom: 8,
    backgroundColor: Colors.card,
    // shadow/elevation for native
    ...CardShadow,
    ...Platform.select({
      ios: {},
      android: {},
      default: {},
    }),
  },
  locSuggestItem: { paddingHorizontal: 12, paddingVertical: 8 },
  locSuggestMain: { color: Colors.text, fontWeight: '700' },
  locSuggestSecondary: { color: Colors.sub, fontSize: sf(12) },
  locSuggestHint: { paddingHorizontal: 12, paddingVertical: 8, color: Colors.sub, fontStyle: 'italic' },

  toast: { position: 'absolute', bottom: 24, left: 16, right: 16, paddingVertical: 12, paddingHorizontal: 16, borderRadius: Radius.lg, zIndex: 9999, elevation: 4, ...CardShadow },
  toastSuccess: { backgroundColor: Colors.successBg, borderWidth: 2, borderColor: Colors.successFg },
  toastText: { color: Colors.successFg, fontWeight: '700' },

  // ── Big image preview box (matches Edit Asset / Edit Asset Type) ──
  imagePreviewBox: {
    marginTop: 10,
    minHeight: 180,
    maxHeight: 240,
    borderRadius: Radius.md,
    borderWidth: 2,
    borderColor: Colors.line,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    padding: 12,
  },
  imagePreview: { width: '100%', height: '100%' },
  imagePreviewPlaceholder: { color: Colors.sub2, fontWeight: '600', fontSize: sf(13) },
  btnDangerOutline: {
    backgroundColor: Colors.card,
    borderColor: Colors.dangerFg,
    borderWidth: 2,
  },
  btnDangerOutlineText: { color: Colors.dangerFg, fontWeight: '800' },
  // "Auto-fill from image" button — visually distinct (accent fill) so the
  // discovery surface for the AI feature stands out from secondary controls.
  btnScan: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accentDark,
    borderWidth: 2,
  },
  btnScanText: { color: '#fff', fontWeight: '800' },
  // ── Grouped document+date card (asset form) ──
  docGroupCard: {
    marginBottom: 16,
    padding: 14,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.line,
    backgroundColor: Colors.card,
    ...CardShadow,
  },
  docGroupHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  docGroupTitle: { fontSize: sf(16), fontWeight: '800', color: Colors.text },
  docGroupDivider: { height: 1, backgroundColor: Colors.line, marginVertical: 12 },
});

// Web-only styles
const whs = StyleSheet.create({
  pageScroll: {
    maxWidth: 1100,
    width: '100%',
    alignSelf: 'center',
  },
  formHeader: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.line,
    marginBottom: 24,
    overflow: 'hidden',
    ...CardShadow,
  },
  // Evenly-weighted columns — image and heading each take half the card.
  formHeaderImg: {
    flex: 1,
    minHeight: 200,
    backgroundColor: Colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 2,
    borderRightColor: Colors.line,
  },
  formHeaderImgFull: {
    width: '100%',
    height: '100%',
  },
  formHeaderImgPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  formHeaderImgHint: {
    fontSize: sf(12),
    fontWeight: '600',
    color: Colors.sub2,
  },
  // ── Scan-from-photo card (dedicated to the AI auto-fill flow — picker
  // photo is ephemeral, never becomes the asset's image) ────────────────
  scanCard: {
    marginBottom: 20,
    padding: 14,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: Colors.accent,
    backgroundColor: Colors.accentLight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  scanCardIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanCardTextWrap: { flex: 1, minWidth: 200, gap: 2 },
  scanCardTitle: {
    fontSize: sf(15),
    fontWeight: '800',
    color: Colors.primary,
  },
  scanCardSub: {
    fontSize: sf(12),
    color: Colors.sub,
    lineHeight: sf(17),
  },
  // Success banner that appears under the scan card after a successful scan.
  scanResultBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: Radius.md,
    backgroundColor: Colors.successBg,
    borderWidth: 1,
    borderColor: Colors.successFg,
    alignSelf: 'flex-start',
  },
  scanResultBannerText: {
    color: Colors.successFg,
    fontWeight: '700',
    fontSize: sf(12),
  },
  formHeaderInfo: {
    flex: 1,
    padding: 28,
    justifyContent: 'space-between', // text on top, upload controls on bottom
    gap: 12,
    minHeight: 220,
  },
  formHeaderText: { gap: 6 },
  formHeaderControls: {
    marginTop: 12,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
    gap: 8,
  },
  formHeaderControlsHint: {
    fontSize: sf(11),
    color: Colors.sub2,
    fontWeight: '600',
    lineHeight: sf(16),
  },
  formHeaderControlsRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  formHeaderLabel: {
    fontSize: sf(11),
    fontWeight: '700',
    color: Colors.sub2,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  formHeaderTitle: {
    fontSize: sf(28),
    fontWeight: '900',
    color: Colors.primaryDark,
    letterSpacing: -0.5,
  },
  formHeaderMeta: {
    fontSize: sf(13),
    fontWeight: '600',
    color: Colors.sub,
  },
  formHeaderSub: {
    fontSize: sf(13),
    fontWeight: '500',
    color: Colors.sub2,
    lineHeight: sf(20),
    marginTop: 4,
  },
  // Bold title-case section heading, no underline. Same look on web & mobile.
  sectionHeader: {
    fontSize: sf(18),
    fontWeight: '900',
    color: Colors.text,
    marginTop: 28,
    marginBottom: 14,
  },
});



