// app/(tabs)/assets/new.js
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Image, Alert, Platform, Switch, ActivityIndicator, Modal
} from 'react-native';
import { DatePickerModal } from 'react-native-paper-dates';
import { en, registerTranslation } from 'react-native-paper-dates';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../firebaseConfig';
import * as DocumentPicker from 'expo-document-picker';
import DropDownPicker from 'react-native-dropdown-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { LogBox } from 'react-native';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import { formatDisplayDate } from '../../utils/date';
import ScreenHeader from '../../components/ui/ScreenHeader';

import { getImageFileFromPicker } from '../../utils/getFormFileFromPicker';
import { fetchDropdownOptions } from '../../utils/fetchDropdownOptions';

registerTranslation('en', en);
LogBox.ignoreLogs(['VirtualizedLists should never be nested']);

const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'];
const ALLOWED_DOC_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const normSlug = (s = '') =>
  String(s).toLowerCase().trim().replace(/[\s\-]+/g, '_').replace(/[^a-z0-9_]/g, '');

export default function NewAsset() {
  const router = useRouter();
  const { fromAssetId, preselectId, returnTo } = useLocalSearchParams();
  const normalizedReturnTo = Array.isArray(returnTo) ? returnTo[0] : returnTo;
  const [isAdmin, setIsAdmin] = useState(false);
  const [checking, setChecking] = useState(true);

  // ---------- scroll & focus helpers (web-safe) ----------
  const scrollRef = useRef(null);
  const fieldRefs = useRef({});     // focusable refs (TextInput)
  const fieldYs   = useRef({});     // container Y positions (from onLayout)

  const setInputRef = (slug) => (ref) => { if (ref) fieldRefs.current[slug] = ref; };
  const onLayoutFor = (slug) => (e) => { fieldYs.current[slug] = e.nativeEvent.layout.y; };

  const scrollToSlug = (slug) => {
    const y = fieldYs.current[slug];
    const targetY = typeof y === 'number' ? Math.max(y - 80, 0) : 0;

    // KeyboardAwareScrollView API
    if (scrollRef.current?.scrollToPosition) {
      scrollRef.current.scrollToPosition(0, targetY, true);
    } else if (scrollRef.current?.scrollTo) {
      // RN ScrollView fallback
      scrollRef.current.scrollTo({ x: 0, y: targetY, animated: true });
    }
  };

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
  const [document, setDocument] = useState(null);
  // For custom URL fields: allow selecting a document and auto-fill with S3 URL after upload
  const [urlDocMap, setUrlDocMap] = useState({}); // { [slug]: { uri, name, mimeType } }

  // UI error bag
  const [errors, setErrors] = useState({});       // { slugOrFieldName: "message" }
  const [formError, setFormError] = useState(''); // fallback for unknown errors

  // Upload state
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
  const [nextServiceDate, setNextServiceDate] = useState('');
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
        users:      data.users || [],
        statuses:   data.statuses || [],
        assetIds:   normAssetIds,
      });
      setFilteredAssetIds(normAssetIds);
      // If a preselected QR id is provided (from check-in), set it
      if (preselectId && normAssetIds.includes(String(preselectId))) {
        setId(String(preselectId));
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
          setNextServiceDate(toYMD(data.next_service_date));
          setDatePurchased(toYMD(data.date_purchased));

          // Dynamic fields
          if (data.fields && typeof data.fields === 'object') setFieldValues(data.fields);
        })
        .catch(console.error);
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
          try { const j = await res.json(); msg = j?.error || j?.message || ''; } catch {}
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
        const res = await fetch(`${API_BASE_URL}/assets/asset-types/${typeId}/fields`);
        const json = await res.json();
        if (ignore) return;

        setFieldsSchema(json || []);
        const seed = { ...fieldValues };
        (json || []).forEach(f => {
          const slug = f.slug || normSlug(f.name);
          if (seed[slug] === undefined || seed[slug] === null) {
            const t = ((f.field_type?.slug || f.field_type?.name || '')).toLowerCase();
            if (t === 'boolean') seed[slug] = false;
            else if (t === 'multiselect') seed[slug] = [];
            else seed[slug] = '';
          }
        });
        setFieldValues(seed);
      } catch (e) {
        console.error('field schema fetch error', e);
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
        'id','type_id','assigned_to_id','status','location','model','description','other_id','next_service_date','date_purchased','notes','image','document'
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
  const pickImage = async () => {
    try {
      const result = await getImageFileFromPicker();
      if (!result) return;
      const t = (result.type || '').replace('jpg', 'jpeg');
      if (!ALLOWED_IMAGE_MIME.includes(t)) {
        const msg = 'Allowed types: PNG, JPG/JPEG, WEBP';
        setFieldError('image', msg);
        scrollToFirstError({ image: msg });
        return;
      }
      setErrors(prev => ({ ...prev, image: undefined }));
      setImage(result);
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
      // If a date field links to a document slug, and the date is set, ensure the doc exists or is attached
      if (((f.field_type?.slug || f.field_type?.name || '')).toLowerCase() === 'date') {
        let linkSlug = '';
        try {
          const vr = f.validation_rules && typeof f.validation_rules === 'object'
            ? f.validation_rules
            : (f.validation_rules ? JSON.parse(f.validation_rules) : null);
          const opts = f.options && typeof f.options === 'object' ? f.options : null;
          const l = (vr && (vr.requires_document_slug || vr.require_document_slug)) || (opts && (opts.requires_document_slug || opts.require_document_slug));
          linkSlug = Array.isArray(l) ? (l[0] || '') : (l || '');
          linkSlug = String(linkSlug || '').trim();
        } catch {}
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
        } catch {}
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
      if (((f.field_type?.slug || f.field_type?.name || '')).toLowerCase() === 'date') {
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
    if (uploading) return;
    if (!validate()) return;

    const data = new FormData();
    data.append('id', id);
    data.append('type_id', typeId);
    if (assignedToId) data.append('assigned_to_id', assignedToId);
    if (status) data.append('status', status);
    // Build dynamic fields payload (no placeholders)
    data.append('fields', JSON.stringify(fieldValues));
    if (model) data.append('model', model);
    if (description) data.append('description', description);    if (datePurchased) data.append('date_purchased', datePurchased);    if (serialNumber) data.append('serial_number', serialNumber);
    if (otherId) data.append('other_id', otherId);

    if (image?.file) data.append('image', image.file, image.file.name || 'upload.jpg');
    // We no longer bundle per-field documents in the create request.
    // They will be uploaded to /assets/:id/documents/upload after the asset is created.
    // Keep the legacy top-level 'document' only if user picked the generic Document picker and no URL-field docs were chosen.
    const urlDocEntries = Object.entries(urlDocMap).filter(([, v]) => !!v);
    const shouldSendLegacyDoc = urlDocEntries.length === 0 && !!document;
    if (shouldSendLegacyDoc) {
      const docToUpload = document;
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
          let parsed; try { parsed = JSON.parse(raw); } catch {}
          const message = (parsed && (parsed.error || parsed.message)) || raw || 'Failed to create asset';
          distributeServerErrors(message);
          Alert.alert('Error', message);
          return;
        }
        if (errLike && typeof errLike === 'object' && 'responseText' in errLike) {
          const raw = String(errLike.responseText || '');
          let parsed; try { parsed = JSON.parse(raw); } catch {}
          const message = (parsed && (parsed.error || parsed.message)) || raw || 'Failed to create asset';
          distributeServerErrors(message);
          Alert.alert('Error', message);
          return;
        }
        if (typeof errLike === 'string') {
          let parsed; try { parsed = JSON.parse(errLike); } catch {}
          const message = (parsed && (parsed.error || parsed.message)) || errLike || 'Failed to create asset';
          distributeServerErrors(message);
          Alert.alert('Error', message);
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
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE_URL}/assets`);
        const uid = auth.currentUser?.uid;
        if (uid) xhr.setRequestHeader('X-User-Id', uid);
        xhr.upload.onprogress = (e) => {
          if (e && e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setUploadProgress(pct);
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try { createdAsset = JSON.parse(xhr.responseText || '{}')?.asset || null; } catch {}
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
            if (typeCode === 'date') {
              const vr = parseJsonMaybe(df.validation_rules) || {};
              const opts = parseJsonMaybe(df.options) || {};
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
          const resp = await fetch(`${API_BASE_URL}/assets/${createdAsset.id}/documents/upload`, { method: 'POST', body: fd });
          if (!resp.ok) {
            // swallow to avoid blocking creation; user can reattach later
            continue;
              }
            } catch {
              // ignore individual failures to not block the whole flow
            }
          }
        }
      } catch {}

      Alert.alert('Success', 'Asset created!');
      if (normalizedReturnTo) {
        try { router.replace(String(normalizedReturnTo)); } catch { router.back(); }
      } else {
        router.replace({ pathname: '/Inventory', params: { tab: 'all' } });
      }
    } catch (_e) {
      // handled above
    } finally {
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
            <div style="text-align:center;font-family:system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial; color:#0F172A">
              <div class="spin" style="width:32px;height:32px;border:3px solid #D0E2FF;border-top-color:#0B63CE;border-radius:50%;margin:0 auto;animation:rnwspin 0.9s linear infinite"></div>
              <div style="margin-top:10px">Uploading <span id="pct">0%</span></div>
              <div style="width:260px;height:8px;background:#E6EDF3;border-radius:6px;overflow:hidden;margin:8px auto 0">
                <div id="bar" style="height:8px;background:#0B63CE;width:0;border-radius:6px"></div>
              </div>
              <div id="secs" style="margin-top:6px;color:#64748B"></div>
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
        if (secsNode && uploadStartTs) secsNode.textContent = `${Math.max(0, Math.floor((Date.now() - uploadStartTs)/1000))}s elapsed`;
      } else {
        // Remove if present
        if (webDomOverlayRef.current) {
          try { document.body.removeChild(webDomOverlayRef.current); } catch {}
          webDomOverlayRef.current = null;
        }
      }
    } catch {}
    return () => {
      if (Platform.OS !== 'web') return;
      if (webDomOverlayRef.current) {
        try { document.body.removeChild(webDomOverlayRef.current); } catch {}
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
  const renderField = (f) => {
    const slug = f.slug || normSlug(f.name);
    const typeCode = ((f.field_type?.slug || f.field_type?.name || '')).toLowerCase();
    const isReq = !!f.is_required;

    const Label = (
      <Text style={styles.label}>
        {(f.label || f.name) || slug}{isReq ? ' *' : ''}
      </Text>
    );

    const selectItems = (f.options || []).map(o => ({ label: String(o.label ?? o), value: (o.value ?? o) }));

    switch (typeCode) {
      case 'url':
        return (
          <View key={slug} style={{ marginBottom: 12 }} onLayout={onLayoutFor(slug)}>
            {Label}
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
                  style={[styles.btn, { backgroundColor: '#fdecea', paddingVertical: 10 }]}
                  onPress={() => {
                    setUrlDocMap((m) => { const n = { ...m }; delete n[slug]; return n; });
                    // Clear error; validation will re-add if needed on submit
                    setErrors((prev) => ({ ...prev, [slug]: undefined }));
                  }}
                >
                  <Text style={{ color: '#b00020' }}>Remove</Text>
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
              style={[styles.input, typeCode === 'textarea' && { height: 90 }]}
              placeholder={`Enter ${f.label || f.name}`}
              value={String(fieldValues[slug] ?? '')}
              onChangeText={(t) => updateField(slug, t)}
              multiline={typeCode === 'textarea'}
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
              style={styles.input}
              placeholder={`Enter ${f.label || f.name}`}
              keyboardType="numeric"
              value={fieldValues[slug] !== undefined && fieldValues[slug] !== null ? String(fieldValues[slug]) : ''}
              onChangeText={(t) => updateField(slug, t.replace(/[^\d.-]/g, ''))}
            />
            {!!errors[slug] && <Text style={styles.errorBelow}>{errors[slug]}</Text>}
          </View>
        );

      case 'date': {
        // Try to read a linked document slug from validation_rules
        let requiredDocSlug = '';
        try {
          const vr = f.validation_rules && typeof f.validation_rules === 'object'
            ? f.validation_rules
            : (f.validation_rules ? JSON.parse(f.validation_rules) : null);
          const opts = f.options && typeof f.options === 'object' ? f.options : null;
          const link = (vr && (vr.requires_document_slug || vr.require_document_slug)) || (opts && (opts.requires_document_slug || opts.require_document_slug));
          requiredDocSlug = Array.isArray(link) ? (link[0] || '') : (link || '');
          requiredDocSlug = String(requiredDocSlug || '').trim();
        } catch {}

        const docSlug = requiredDocSlug ? normSlug(requiredDocSlug) : '';
        const docFieldExists = !!fieldsSchema.find(ff => (ff.slug || normSlug(ff.name)) === docSlug && ((ff.field_type?.slug || ff.field_type?.name || '').toLowerCase() === 'url'));
        const pickedDoc = docSlug ? urlDocMap[docSlug] : null;
        const docLabel = requiredDocSlug || 'document';

        return (
          <View key={slug} style={{ marginBottom: 12 }} onLayout={onLayoutFor(slug)}>
            {Label}
            <TouchableOpacity style={styles.input} onPress={() => setDatePicker({ open: true, slug })}>
              <Text style={{ color: fieldValues[slug] ? '#000' : '#888' }}>
                {fieldValues[slug] ? formatDisplayDate(fieldValues[slug]) : `Select ${f.label || f.name}`}
              </Text>
            </TouchableOpacity>
            {!!errors[slug] && <Text style={styles.errorBelow}>{errors[slug]}</Text>}

            {docSlug ? (
              <View style={{ marginTop: 8 }}>
                <Text style={[styles.subtleLabel]}>Linked document category: {docLabel}</Text>
                {pickedDoc ? (
                  <Text style={{ marginTop: 6, fontStyle: 'italic', color: '#444' }}>Attached: {pickedDoc.name || 'document'}</Text>
                ) : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <TouchableOpacity
                    style={[styles.btn, { paddingVertical: 10 }]}
                    onPress={async () => {
                      try {
                        const res = await DocumentPicker.getDocumentAsync({
                          type: ALLOWED_DOC_MIME,
                          multiple: false,
                        });
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
                    <Text>{pickedDoc ? 'Replace Document' : `Upload ${docLabel}`}</Text>
                  </TouchableOpacity>
                  {pickedDoc ? (
                    <TouchableOpacity
                      style={[styles.btn, { backgroundColor: '#fdecea', paddingVertical: 10 }]}
                      onPress={() => {
                        setUrlDocMap((m) => { const n = { ...m }; delete n[docSlug]; return n; });
                        setErrors((prev) => ({ ...prev, [docSlug]: undefined }));
                      }}
                    >
                      <Text style={{ color: '#b00020' }}>Remove</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                {!!errors[docSlug] && <Text style={styles.errorBelow}>{errors[docSlug]}</Text>}
              </View>
            ) : null}
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
              style={styles.dropdown}
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
              style={styles.dropdown}
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
              style={styles.input}
              placeholder={`Enter ${f.label || f.name}`}
              value={String(fieldValues[slug] ?? '')}
              onChangeText={(t) => updateField(slug, t)}
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
        <Text style={{ fontSize: 16, marginBottom: 12 }}>Admin access required.</Text>
        <TouchableOpacity onPress={() => {
          if (normalizedReturnTo) { try { router.replace(String(normalizedReturnTo)); } catch { router.back(); } }
          else { router.replace('/Inventory'); }
        }} style={{ padding: 12, borderRadius: 8, backgroundColor: '#0B63CE' }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
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
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        extraScrollHeight={80}
        enableOnAndroid
      >
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
          {!!id && <Text style={{ marginBottom: 10, color: '#333' }}>Selected Asset ID: {id}</Text>}
          <Text style={styles.label}>Select Asset ID</Text>
          {Platform.OS !== 'web' ? (
            <View style={{ alignItems: 'center' }}>
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
                <Text>Scan QR to Assign</Text>
              </TouchableOpacity>
              {!!errors.id && <Text style={styles.errorBelow}>{errors.id}</Text>}
            </View>
          ) : (
            <>
              <TextInput
                ref={setInputRef('id')}
                style={styles.input}
                placeholder="Search by ID"
                value={searchTerm}
                onChangeText={text => {
                  setSearchTerm(text);
                }}
              />
              <TouchableOpacity onPress={() => setShowQRs(!showQRs)} style={styles.qrToggle}>
                <Text style={{ color: '#1E90FF', fontWeight: 'bold' }}>
                  {showQRs ? 'Hide QR Options ▲' : 'Show QR Options ▼'}
                </Text>
              </TouchableOpacity>
              {!!errors.id && <Text style={styles.errorBelow}>{errors.id}</Text>}
            </>
          )}
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
                    setId(String(qrId));
                    setShowQRs(false);                 // ⬅ close menu immediately
                    setErrors(prev => ({ ...prev, id: undefined }));
                    setSearchTerm('');                 // optional: clear search
                    setFilteredAssetIds(options.assetIds || []); // optional: reset list
                  }}              >
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

        {/* Asset Type */}
        <View style={{ zIndex: 4000 }} onLayout={onLayoutFor('typeId')}>
          <Text style={styles.label}>Asset Type *</Text>
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
            style={styles.dropdown}
            dropDownContainerStyle={styles.dropdownContainer}
            nestedScrollEnabled
          />
          {!!errors.typeId && <Text style={styles.errorBelow}>{errors.typeId}</Text>}
        </View>

        {/* Dynamic Fields */}
        {!!typeId && fieldsSchema.map(renderField)}
        {/* Serial Number */}
        <View onLayout={onLayoutFor('serial_number')}>
          <Text style={styles.label}>Serial Number</Text>
            <TextInput
              ref={setInputRef('serial_number')}
              style={styles.input}
              placeholder="Serial Number"
              value={serialNumber}
              onChangeText={(t) => {
                setSerialNumber(t);
                setErrors(prev => ({ ...prev, serial_number: undefined }));
              }}
              autoCapitalize="characters" // or "none" if you prefer
            />
          {!!errors.serial_number && <Text style={styles.errorBelow}>{errors.serial_number}</Text>}
        </View>

        <View onLayout={onLayoutFor('other_id')}>
          <Text style={styles.label}>Other ID</Text>
          <TextInput
            ref={setInputRef('other_id')}
            style={styles.input}
            placeholder="Optional"
            value={otherId}
            onChangeText={(t) => {
              setOtherId(t);
              setErrors(prev => ({ ...prev, other_id: undefined }));
            }}
            autoCapitalize="none"
          />
          {!!errors.other_id && <Text style={styles.errorBelow}>{errors.other_id}</Text>}
        </View>

        <View onLayout={onLayoutFor('model')}>
          <Text style={styles.label}>Model</Text>
          <TextInput
            ref={setInputRef('model')}
            style={styles.input}
            placeholder="Model"
            value={model}
            onChangeText={(t)=>{ setModel(t); setErrors(prev=>({...prev,model:undefined})); }}
          />
          {!!errors.model && <Text style={styles.errorBelow}>{errors.model}</Text>}
        </View>

        <View onLayout={onLayoutFor('description')}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            ref={setInputRef('description')}
            style={[styles.input, { height: 80 }]}
            placeholder="Description"
            value={description}
            onChangeText={(t)=>{ setDescription(t); setErrors(prev=>({...prev,description:undefined})); }}
            multiline
          />
          {!!errors.description && <Text style={styles.errorBelow}>{errors.description}</Text>}
        </View>
        <View onLayout={onLayoutFor('date_purchased')}>
          <Text style={styles.label}>Date Purchased</Text>
          <TouchableOpacity style={styles.input} onPress={() => setDatePicker({ open: true, slug: '__date_purchased' })}>
            <Text style={{ color: datePurchased ? '#000' : '#888' }}>
              {datePurchased ? formatDisplayDate(datePurchased) : 'Select Date Purchased'}
            </Text>
          </TouchableOpacity>
          {!!errors.date_purchased && <Text style={styles.errorBelow}>{errors.date_purchased}</Text>}
        </View>
        <View style={{ zIndex: 2000 }} onLayout={onLayoutFor('assigned_to_id')}>
          <Text style={styles.label}>User Assigned</Text>
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
            style={styles.dropdown}
            dropDownContainerStyle={styles.dropdownContainer}
            nestedScrollEnabled
          />
          {!!errors.assigned_to_id && <Text style={styles.errorBelow}>{errors.assigned_to_id}</Text>}
        </View>

        <View style={{ zIndex: 1000 }} onLayout={onLayoutFor('status')}>
          <Text style={styles.label}>Status</Text>
          <DropDownPicker
            open={statusOpen}
            setOpen={setStatusOpen}
            value={status}
            setValue={(fn) => setStatus(fn())}
            items={(options.statuses || []).map(s => ({ label: s, value: s }))}
            placeholder="Select Status"
            style={styles.dropdown}
            dropDownContainerStyle={styles.dropdownContainer}
            nestedScrollEnabled
          />
          {!!errors.status && <Text style={styles.errorBelow}>{errors.status}</Text>}
        </View>

        {/* Attachments */}
        <View onLayout={onLayoutFor('image')}>
          {image?.uri && (
            <View>
              {uploading ? (
                <View style={[styles.preview, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF5FF', borderWidth: 1, borderColor: '#DBEAFE' }]}>
                  <ActivityIndicator size="large" color="#1E90FF" />
                  <Text style={{ marginTop: 8, color: '#5374a6' }}>
                    Uploading image… {uploadProgress ? `${uploadProgress}%` : ''}
                  </Text>
                </View>
              ) : (
                <Image source={{ uri: image.uri }} style={styles.preview} />
              )}
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: '#fdecea', opacity: uploading ? 0.6 : 1 }]}
                onPress={() => { if (!uploading) { setImage(null); setErrors(prev => ({ ...prev, image: undefined })); } }}
                disabled={uploading}
              >
                <Text style={{ color: '#b00020' }}>{uploading ? 'Uploading…' : 'Remove Image'}</Text>
              </TouchableOpacity>
            </View>
          )}
          {!!errors.image && <Text style={styles.errorBelow}>{errors.image}</Text>}
          <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
            <TouchableOpacity style={[styles.btn, styles.pickerBtn]} onPress={pickImage} disabled={uploading}>
              <Text>{image?.uri ? 'Replace Image' : 'Pick Image'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View onLayout={onLayoutFor('document')}>
          {document && (
            <Text style={{ marginTop: 10, fontStyle: 'italic' }}>Attached: {document.name}</Text>
          )}
          {!!errors.document && <Text style={styles.errorBelow}>{errors.document}</Text>}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <TouchableOpacity style={styles.btn} onPress={pickDocument} disabled={uploading}>
              <Text>{document ? 'Replace Document' : 'Attach Document'}</Text>
            </TouchableOpacity>
            {document ? (
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: '#fdecea', opacity: uploading ? 0.6 : 1 }]}
                onPress={() => { if (!uploading) setDocument(null); }}
                disabled={uploading}
              >
                <Text style={{ color: '#b00020' }}>Remove</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* Submit */}
        <TouchableOpacity
          onPress={submit}
          disabled={uploading}
          style={[styles.btn, styles.submit, uploading && styles.submitDisabled]}
          accessibilityRole="button"
          accessibilityState={{ disabled: uploading, busy: uploading }}
        >
          {uploading ? (
            <Text style={{ color: '#fff', fontWeight: '700' }}>
              Creating… {uploadProgress ? `${uploadProgress}%` : ''}
            </Text>
          ) : (
            <Text style={{ color: '#fff' }}>Create Asset</Text>
          )}
        </TouchableOpacity>

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
              {uploadStartTs ? `${Math.max(0, Math.floor((Date.now() - uploadStartTs)/1000))}s elapsed` : ''}
            </Text>
          </View>
        ) : null}

      </KeyboardAwareScrollView>

      {/* One DatePicker for everything */}
      <DatePickerModal
        locale="en"
        mode="single"
        visible={datePicker.open}
        onDismiss={() => setDatePicker({ open: false, slug: null })}
        onConfirm={({ date }) => {
          if (!date || isNaN(new Date(date).getTime())) {
            // keep the modal open so they can pick; just warn them
            const label =
              datePicker.slug === '__next_service_date' ? 'Next Service Date' :
              datePicker.slug === '__date_purchased'   ? 'Date Purchased'     : 'Date';
            warn(`Please choose a valid ${label} before confirming.`);
            return;
          }
          if (datePicker.slug) {
            const iso = new Date(date).toISOString().split('T')[0];
            if (datePicker.slug === '__next_service_date') setNextServiceDate(iso);
            else if (datePicker.slug === '__date_purchased') setDatePurchased(iso);
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
              {`${Math.max(0, Math.floor((Date.now() - uploadStartTs)/1000))}s elapsed`}
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
              {`${Math.max(0, Math.floor((Date.now() - uploadStartTs)/1000))}s elapsed`}
            </Text>
          ) : null}
        </WebOverlayPortal>
      )}

    </SafeAreaView>
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
      return () => { try { document.body.removeChild(el); } catch {} mountRef.current = null; };
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

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: Platform.OS === 'ios' ? 20 : 0 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 5, padding: 12, marginVertical: 8, color: '#000' },
  label: { marginTop: 10, marginBottom: 6, fontWeight: '600' },
  subtleLabel: { color: '#475569', fontSize: 12, marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  btn: { backgroundColor: '#eee', padding: 15, alignItems: 'center', borderRadius: 5, marginVertical: 8 },
  // Consistent width for media pickers (image/doc) so buttons look same size
  pickerBtn: { minWidth: 180, alignSelf: 'center' },
  submit: { backgroundColor: '#1E90FF' },
  submitDisabled: { opacity: 0.7, ...(Platform.OS === 'web' ? { cursor: 'not-allowed' } : null) },
  preview: { width: '100%', height: 200, borderRadius: 5, marginVertical: 10 },
  dropdown: { borderColor: '#ccc', marginBottom: 16 },
  dropdownContainer: { borderColor: '#ccc' },
  qrGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginVertical: 10 },
  qrCard: { width: '30%', backgroundColor: '#f9f9f9', padding: 6, marginBottom: 10, alignItems: 'center', borderRadius: 6, borderWidth: 1, borderColor: '#ccc' },
  qrCardSelected: { borderColor: 'green', borderWidth: 3, backgroundColor: '#d0f0c0' },
  qrLabel: { marginTop: 4, fontSize: 10, fontWeight: '600' },
  qrToggle: { alignSelf: 'flex-end', marginBottom: 4 },

  // error styles
  errorTop: { marginTop: 8, color: '#b00020', textAlign: 'center' },
  errorBelow: { marginTop: 4, color: '#b00020' },

  // overlay
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  webOverlay: { display: 'none' },
  progressBar: { width: 260, height: 8, borderRadius: 6, backgroundColor: '#E6EDF3', marginTop: 8, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: '#0B63CE', borderRadius: 6 },
  portalOverlayCard: { backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },

  // location suggestions
  locSuggestBox: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    paddingVertical: 6,
    marginTop: -6,
    marginBottom: 8,
    backgroundColor: '#fff',
    // shadow/elevation for native
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 2 },
      default: {},
    }),
  },
  locSuggestItem: { paddingHorizontal: 12, paddingVertical: 8 },
  locSuggestMain: { color: '#111', fontWeight: '600' },
  locSuggestSecondary: { color: '#666', fontSize: 12 },
  locSuggestHint: { paddingHorizontal: 12, paddingVertical: 8, color: '#666', fontStyle: 'italic' },
});



