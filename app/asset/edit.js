import { sf } from '../../constants/uiTheme.js';
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, Alert, Switch, Image, Modal, ActivityIndicator, Linking, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import DropDownPicker from 'react-native-dropdown-picker';
import { DatePickerModal } from 'react-native-paper-dates';
import { en, registerTranslation } from 'react-native-paper-dates';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import { fetchFields } from '../../hooks/useAssetTypeFields';
import { FIELD_LIMITS } from '../../constants/fieldLimits';
import { getAuthHeaders, setXHRAuthHeaders } from '../../utils/authHeaders';
import { formatDisplayDate } from '../../utils/date';
import { auth } from '../../firebaseConfig';
import { onAuthStateChanged } from 'firebase/auth';
import * as DocumentPicker from 'expo-document-picker';
import { getImageFileFromPicker, revokeImageUri } from '../../utils/getFormFileFromPicker';
import { IMAGE_UPLOAD_HINT, ASSET_DOCUMENT_FIELD_HINT } from '../../constants/uploadFormats';
import ScreenHeader from '../../components/ui/ScreenHeader';

registerTranslation('en', en);

const normSlug = (s = '') => String(s).toLowerCase().trim().replace(/[\s\-]+/g, '_').replace(/[^a-z0-9_]/g, '');

/**
 * AssetActionBar passes returnTo as this asset's detail URL so nested ?returnTo= survives.
 * router.replace() from edit → that URL stacks a second copy of detail; use router.back() instead.
 */
function isReturnToThisAssetDetail(returnTo, assetId) {
  if (returnTo == null || assetId == null || String(assetId) === '') return false;
  const raw = Array.isArray(returnTo) ? returnTo[0] : returnTo;
  if (typeof raw !== 'string') return false;
  let path = raw.split('?')[0].trim();
  if (!path) return false;
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname || '';
    } catch {
      return false;
    }
  }
  const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);
  if (parts.length < 2 || parts[0] !== 'asset') return false;
  try {
    return decodeURIComponent(parts[1]) === String(assetId);
  } catch {
    return parts[1] === String(assetId);
  }
}

export default function EditAsset() {
  const { assetId, returnTo } = useLocalSearchParams();
  const normalizedReturnTo = Array.isArray(returnTo) ? returnTo[0] : returnTo;
  const router = useRouter();

  const scrollRef = useRef(null);
  const fieldYs = useRef({});
  const { width } = useWindowDimensions();
  const isWebWide = Platform.OS === 'web' && (width || 0) >= 960;

  const [options, setOptions] = useState({ assetTypes: [], users: [] });
  const [typeOpen, setTypeOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [fieldsSchema, setFieldsSchema] = useState([]);
  const [fieldValues, setFieldValues] = useState({});

  const [typeId, setTypeId] = useState('');
  const [assignedToId, setAssignedToId] = useState('');
  const [status, setStatus] = useState('');
  const [location, setLocation] = useState('');
  const [model, setModel] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [otherId, setOtherId] = useState('');
  const [description, setDescription] = useState('');
  const [nextServiceDate, setNextServiceDate] = useState('');
  const [datePurchased, setDatePurchased] = useState('');
  const [notes, setNotes] = useState('');
  const [assetDocUrl, setAssetDocUrl] = useState(''); // top-level documentation_url
  const [assetDocs, setAssetDocs] = useState([]);     // DB-backed documents for this asset
  const [image, setImage] = useState(null);       // { uri, file }
  const [currentImageUrl, setCurrentImageUrl] = useState('');
  // Track the latest image uri in a ref so the unmount cleanup can revoke it
  // even if React strips the closure (which it does in StrictMode dev).
  const imageUriRef = useRef(null);
  useEffect(() => { imageUriRef.current = image?.uri || null; }, [image]);
  useEffect(() => () => { revokeImageUri(imageUriRef.current); }, []);
  /** Pending doc for main "Document" section (maps upload on save). { uri, name, mimeType, file? } */
  const [document, setDocument] = useState(null);

  const [datePicker, setDatePicker] = useState({ open: false, slug: null });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ visible: false, text: '', kind: 'success' });
  const showToast = (text, kind = 'success') => {
    setToast({ visible: true, text, kind });
    setTimeout(() => setToast({ visible: false, text: '', kind }), 2500);
  };
  const [filesProgress, setFilesProgress] = useState(0);
  const [filesStartTs, setFilesStartTs] = useState(null);

  const onLayoutFor = (slug) => (e) => { fieldYs.current[slug] = e.nativeEvent.layout.y; };
  const scrollToSlug = (slug) => {
    const y = fieldYs.current[slug];
    const targetY = typeof y === 'number' ? Math.max(y - 80, 0) : 0;
    if (scrollRef.current?.scrollToPosition) scrollRef.current.scrollToPosition(0, targetY, true);
    else if (scrollRef.current?.scrollTo) scrollRef.current.scrollTo({ x: 0, y: targetY, animated: true });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [optsRes, assetRes] = await Promise.all([
          fetch(`${API_BASE_URL}/assets/asset-options`),
          fetch(`${API_BASE_URL}/assets/${assetId}`),
        ]);
        const opts = await optsRes.json();
        const a = await assetRes.json();

        if (cancelled) return;

        setOptions({
          assetTypes: opts.assetTypes || [],
          users: opts.users || [],
        });

        setTypeId(a.type_id || '');
        setAssignedToId(a.assigned_to_id || '');
        setStatus(a.status || '');
        setLocation(a.location || '');
        setModel(a.model || '');
        setSerialNumber(a.serial_number != null ? String(a.serial_number) : '');
        setOtherId(a.other_id != null ? String(a.other_id) : '');
        setDescription(a.description || '');
        setCurrentImageUrl(a.image_url || '');
        setNextServiceDate(a.next_service_date ? String(a.next_service_date).split('T')[0] : '');
        setDatePurchased(a.date_purchased ? String(a.date_purchased).split('T')[0] : '');
        setNotes(a.notes || '');
        setFieldValues(a.fields || {});
        setAssetDocUrl(a.documentation_url || '');
      } catch (e) {
        Alert.alert('Error', e.message || 'Failed to load asset');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [assetId]);

  // DB role: admins can edit assignment and serial on this screen (status is workflow-driven only)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      try {
        if (!u) {
          setIsAdmin(false);
          return;
        }
        const res = await fetch(`${API_BASE_URL}/users/${u.uid}`);
        const dbUser = res.ok ? await res.json() : null;
        setIsAdmin(String(dbUser?.role || '').toUpperCase() === 'ADMIN');
      } catch {
        setIsAdmin(false);
      }
    });
    return unsub;
  }, []);

  // Load DB-backed documents for this asset (asset_documents)
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/assets/${assetId}/documents`);
        const j = await res.json();
        if (ignore) return;
        const items = Array.isArray(j?.items) ? j.items : Array.isArray(j) ? j : [];
        setAssetDocs(items);
      } catch {
        setAssetDocs([]);
      }
    })();
    return () => { ignore = true; };
  }, [assetId, loading]);

  useEffect(() => {
  let ignore = false;
  (async () => {
    if (!typeId) { setFieldsSchema([]); return; }
    try {
      const json = await fetchFields(typeId);
      if (ignore) return;

      setFieldsSchema(json);
      setFieldValues(prev => {
        const seed = { ...prev };
        json.forEach(f => {
          const slug = f.slug || normSlug(f.name);
          if (seed[slug] === undefined || seed[slug] === null) {
            const t = (f.field_type?.code || f.field_type?.slug || f.field_type?.name || '').toLowerCase();
            if (t === 'boolean') seed[slug] = false;
            else if (t === 'multiselect') seed[slug] = [];
            else seed[slug] = '';
          }
        });
        return seed;
      });
    } catch {
      Alert.alert('Error', 'Failed to load field schema');
    }
  })();
  return () => { ignore = true; };
}, [typeId]);

  const updateField = useCallback((slug, val) => {
    setFieldValues(prev => ({ ...prev, [slug]: val }));
    setErrors(prev => ({ ...prev, [slug]: undefined }));
  }, []);

  const validate = () => {
    const newErrors = {};
    if (!typeId) newErrors.typeId = 'Please choose an Asset Type';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const submit = async () => {
    if (saving) return;
    if (!validate()) return;

    const payload = {
      type_id: typeId,
      assigned_to_id: assignedToId || null,
      location: location || null,
      model: model || null,
      other_id: otherId.trim() || null,
      description: description || null,
      next_service_date: nextServiceDate || null,
      date_purchased: datePurchased || null,
      notes: notes || null,
      fields: fieldValues,
    };
    if (isAdmin) {
      const s = String(serialNumber || '').trim();
      payload.serial_number = s || null;
    }

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/assets/${assetId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Context': 'asset-edit',
          ...(await getAuthHeaders()),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || body?.message || 'Failed to update');
      }

      // If files selected, upload them in a separate call (with progress)
      if (image?.file || document) {
        await new Promise((r) => setTimeout(r, 0));
        const fd = new FormData();
        if (image?.file) {
          fd.append('image', image.file, image.file.name || 'upload.jpg');
        }
        if (document) {
          if (Platform.OS === 'web') {
            if (document.file && document.file instanceof File) {
              fd.append('document', document.file, document.file.name || document.name || 'document.pdf');
            } else {
              try {
                const blobRes = await fetch(document.uri);
                const blob = await blobRes.blob();
                const file = new File(
                  [blob],
                  document.name || 'document.pdf',
                  { type: document.mimeType || blob.type || 'application/pdf' },
                );
                fd.append('document', file, file.name);
              } catch {
                fd.append('document', {
                  uri: document.uri,
                  name: document.name || 'document.pdf',
                  type: document.mimeType || 'application/pdf',
                });
              }
            }
          } else {
            fd.append('document', {
              uri: document.uri,
              name: document.name || 'document.pdf',
              type: document.mimeType || 'application/pdf',
            });
          }
        }
        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', `${API_BASE_URL}/assets/${assetId}/files`);
          setXHRAuthHeaders(xhr)
            .then(() => {
              setFilesProgress(0);
              setFilesStartTs(Date.now());
              xhr.upload.onprogress = (e) => {
                if (e && e.lengthComputable) {
                  setFilesProgress(Math.round((e.loaded / e.total) * 100));
                }
              };
              xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                  resolve();
                } else {
                  reject(new Error(xhr.responseText || 'Failed to upload files'));
                }
              };
              xhr.onerror = () => reject(new Error('Network error'));
              xhr.send(fd);
            })
            .catch(reject);
        });
        // clear selected after successful upload; then refresh doc URL for display
        if (image?.uri) { setImage(null); }
        if (document) {
          try {
            const r = await fetch(`${API_BASE_URL}/assets/${assetId}`);
            const j = await r.json();
            // Optionally show the doc somewhere, but at least clear local selection
          } catch {}
          setDocument(null);
        }
      }
      showToast('Asset saved');
      setTimeout(() => {
        const returnToIsOnlyThisDetail =
          !normalizedReturnTo || isReturnToThisAssetDetail(normalizedReturnTo, assetId);
        if (normalizedReturnTo && !returnToIsOnlyThisDetail) {
          try { router.replace(normalizedReturnTo); } catch { router.back(); }
          return;
        }
        // Pop edit — do not replace with same asset detail (returnTo from AssetActionBar caused duplicate stacks).
        try {
          if (router.canGoBack?.()) {
            router.back();
            return;
          }
        } catch { /* fall through */ }
        router.replace({ pathname: '/asset/[assetId]', params: { assetId } });
      }, 600);
    } catch (e) {
      Alert.alert('Error', e.message || 'Failed to update');
    } finally {
      setSaving(false);
      setFilesProgress(0);
      setFilesStartTs(null);
    }
  };

  const removeCurrentImage = async () => {
    const ok = Platform.OS === 'web' ? window.confirm('Remove current image?') : await new Promise((r)=> Alert.alert('Remove Image', 'This will remove the current image.', [ { text: 'Cancel', style: 'cancel', onPress: ()=>r(false) }, { text: 'Remove', style: 'destructive', onPress: ()=>r(true) } ]));
    if (!ok) return;
    try {
      const res = await fetch(`${API_BASE_URL}/assets/${assetId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_url: null }) });
      if (!res.ok) throw new Error('Failed to remove image');
      setCurrentImageUrl('');
      setImage(null);
    } catch (e) {
      Alert.alert('Error', e.message || 'Failed to remove image');
    }
  };

  // url-field slugs that a date field "owns" via requires_document_slug — we
  // render their upload inside the date's grouped card, not standalone.
  const linkedDocSlugs = useMemo(() => {
    const set = new Set();
    (fieldsSchema || []).forEach((f) => {
      const tc = (f.field_type?.code || f.field_type?.slug || '').toLowerCase();
      if (tc !== 'date' && tc !== 'datetime') return;
      let link = '';
      try {
        const vr = f.validation_rules && typeof f.validation_rules === 'object'
          ? f.validation_rules
          : (f.validation_rules ? JSON.parse(f.validation_rules) : null);
        const opts = f.options && typeof f.options === 'object' ? f.options : null;
        const l = (vr && (vr.requires_document_slug || vr.require_document_slug)) || (opts && (opts.requires_document_slug || opts.require_document_slug));
        link = Array.isArray(l) ? (l[0] || '') : (l || '');
        link = String(link || '').trim();
      } catch { /* ignore */ }
      if (link) set.add(normSlug(link));
    });
    return set;
  }, [fieldsSchema]);

  const renderDynamic = (f) => {
    const slug = f.slug || normSlug(f.name);
    let typeCode = (f.field_type?.code || f.field_type?.slug || '').toLowerCase();
    if (typeCode === 'datetime') typeCode = 'date';
    const isReq = !!f.is_required;
    const displayLabel = (slug === 'documentation_url') ? 'Document/attachment' : ((f.label || f.name) || slug);
    const Label = <Text style={[styles.label, !!errors[slug] && styles.labelError]}>{displayLabel}{isReq ? ' *' : ''}</Text>;
    const items = (f.options || []).map(o => ({ label: String(o.label ?? o), value: (o.value ?? o) }));

    // helper: parse validation rules/options
    const parseJsonMaybe = (v) => {
      if (!v) return null;
      if (typeof v === 'object') return v;
      try { return JSON.parse(v); } catch { return null; }
    };
    const rules = parseJsonMaybe(f.validation_rules) || {};
    const opts  = parseJsonMaybe(f.options) || {};
    const requires = rules.requires_document_slug || rules.require_document_slug || opts.requires_document_slug || opts.require_document_slug;
    const requiredDocSlug = Array.isArray(requires) ? (requires[0] || '') : (requires || '');
    const docFieldDef = requiredDocSlug ? (fieldsSchema.find(ff => (ff.slug || normSlug(ff.name)) === requiredDocSlug) || null) : null;
    const resolveUrlFileName = (u) => {
      if (!u || typeof u !== 'string') return null;
      try {
        return decodeURIComponent(u.split('?')[0].split('#')[0].split('/').pop() || 'document');
      } catch { return 'document'; }
    };

    switch (typeCode) {
      case 'text':
      case 'textarea':
      case 'email':
      case 'url': {
        // Linked documents are rendered inside their date's grouped card.
        if (typeCode === 'url' && linkedDocSlugs.has(slug)) return null;
        const val = fieldValues[slug];
        const hasUrl = typeof val === 'string' && /^https?:\/\//i.test(val);
        const isReq = !!f.is_required;
        return (
          <View key={slug} style={{ marginBottom: 12 }} onLayout={onLayoutFor(slug)}>
            {Label}
            {/* Show current attached document name (derived from URL) */}
            {(() => {
              const existing = fieldValues[slug];
              const urlLike = typeof existing === 'string' && /^https?:\/\//i.test(existing);
              const nameFromUrl = urlLike
                ? decodeURIComponent((existing || '')
                    .split('?')[0]
                    .split('#')[0]
                    .split('/')
                    .pop() || 'document')
                : null;
              return nameFromUrl ? (
                <Text style={{ marginTop: 6, fontStyle: 'italic', color: '#444' }}>
                  Attached: {nameFromUrl}
                </Text>
              ) : null;
            })()}
            {typeCode !== 'url' ? (
              <TextInput
                style={[styles.input, !!errors[slug] && styles.inputError, typeCode === 'textarea' && { height: 90 }]}
                placeholder={`Enter ${f.label || f.name}`}
                value={String(fieldValues[slug] ?? '')}
                onChangeText={(t) => updateField(slug, t)}
                multiline={typeCode === 'textarea'}
                maxLength={typeCode === 'textarea' ? FIELD_LIMITS.NOTES : FIELD_LIMITS.FIELD_VALUE}
              />
            ) : null}
            {typeCode === 'url' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <TouchableOpacity
                  style={styles.btn}
                  onPress={async () => {
                    try {
                      const pick = await DocumentPicker.getDocumentAsync({ multiple: false, type: [
                        'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                      ] });
                      if (pick.canceled) return; const sel = pick.assets?.[0]; if (!sel) return;
                      // Build FormData with a real File on web so multer accepts it
                      let fd = new FormData();
                      if (Platform.OS === 'web') {
                        try {
                          const resp = await fetch(sel.uri);
                          const blob = await resp.blob();
                          const file = new File([blob], sel.name || 'document.pdf', { type: sel.mimeType || blob.type || 'application/pdf' });
                          fd.append('document', file, file.name);
                        } catch {
                          fd.append('document', { uri: sel.uri, name: sel.name || 'document.pdf', type: sel.mimeType || 'application/pdf' });
                        }
                      } else {
                        fd.append('document', { uri: sel.uri, name: sel.name || 'document.pdf', type: sel.mimeType || 'application/pdf' });
                      }
                      await new Promise((r) => setTimeout(r, 0));
                      await new Promise(async (resolve, reject) => {
                        const xhr = new XMLHttpRequest();
                        xhr.open('PUT', `${API_BASE_URL}/assets/${assetId}/files`);
                        await setXHRAuthHeaders(xhr);
                        setFilesProgress(0); setFilesStartTs(Date.now()); setSaving(true);
                        xhr.upload.onprogress = (e) => { if (e && e.lengthComputable) setFilesProgress(Math.round((e.loaded/e.total)*100)); };
                        xhr.onload = () => { (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(xhr.responseText || 'Upload failed')); };
                        xhr.onerror = () => reject(new Error('Network error'));
                        xhr.send(fd);
                      });
                      // Refresh and fill the field value with the server's documentation_url
                      try {
                        const r = await fetch(`${API_BASE_URL}/assets/${assetId}`);
                        const j = await r.json();
                        const url = j?.documentation_url || '';
                        if (url) updateField(slug, url);
                      } catch {}
                    } catch (e) { Alert.alert('Error', e.message || 'Failed to upload document'); }
                    finally { setSaving(false); setFilesProgress(0); setFilesStartTs(null); }
                  }}
                >
                  <Text>{hasUrl ? 'Replace Document' : 'Upload Document'}</Text>
                </TouchableOpacity>
                {hasUrl ? (
                  <TouchableOpacity
                    style={[styles.btn, { backgroundColor: Colors.dangerBg }]}
                    onPress={() => { if (isReq) { Alert.alert('Required', 'This document is required and cannot be removed.'); return; } updateField(slug, ''); }}
                  >
                    <Text style={{ color: '#b00020' }}>Remove</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}
            {!!errors[slug] && <Text style={styles.errorBelow}>{errors[slug]}</Text>}
          </View>
        );
      }
      case 'number':
        return (
          <View key={slug} style={{ marginBottom: 12 }} onLayout={onLayoutFor(slug)}>
            {Label}
            <TextInput
              style={[styles.input, !!errors[slug] && styles.inputError]}
              keyboardType="numeric"
              value={fieldValues[slug] !== undefined && fieldValues[slug] !== null ? String(fieldValues[slug]) : ''}
              onChangeText={(t) => updateField(slug, t.replace(/[^\d.-]/g, ''))}
            />
            {!!errors[slug] && <Text style={styles.errorBelow}>{errors[slug]}</Text>}
          </View>
        );
      case 'date':
      case 'datetime': {
        const docName = docFieldDef ? ((docFieldDef.label || docFieldDef.name) || 'Document') : 'Document';
        const docRequired = !!docFieldDef?.is_required;
        const dateName = (f.label || f.name);
        const linkPrimary = String((parseJsonMaybe(f.validation_rules) || {}).link_primary || '').toLowerCase();
        const dateIsPrimary = linkPrimary === 'date';
        const DateRow = (
          <>
            {/* Show the date's own label unless it's the card headline already */}
            {(!requiredDocSlug || !dateIsPrimary) ? (
              <Text style={[styles.label, requiredDocSlug && { marginTop: 0 }, !!errors[slug] && styles.labelError]}>
                {dateName}{isReq ? ' *' : ''}
              </Text>
            ) : null}
            <TouchableOpacity style={[styles.input, !!errors[slug] && styles.inputError]} onPress={() => setDatePicker({ open: true, slug })}>
              <Text style={{ color: fieldValues[slug] ? '#000' : '#888' }}>
                {fieldValues[slug] ? formatDisplayDate(fieldValues[slug]) : `Select ${dateName}`}
              </Text>
            </TouchableOpacity>
            {!!errors[slug] && <Text style={styles.errorBelow}>{errors[slug]}</Text>}
          </>
        );
        // Plain date (no linked document)
        if (!requiredDocSlug) {
          return (
            <View key={slug} style={{ marginBottom: 12 }} onLayout={onLayoutFor(slug)}>
              {DateRow}
            </View>
          );
        }
        // Linked document/date → ONE grouped card; headline + order follow
        // the configured primary side (document-first or date-first).
        const DocBlock = (
          <View style={{ marginTop: 2 }}>
            {/* Show the document's own label unless it's the card headline */}
            {dateIsPrimary ? (
              <Text style={[styles.label, { marginTop: 0 }]}>{docName}{docRequired ? ' *' : ''}</Text>
            ) : null}
                {(() => {
                  // Prefer DB-backed document logically associated to this date+doc pair
                  const toYmd = (v) => {
                    try {
                      if (!v) return '';
                      if (typeof v === 'string') {
                        const s = v.trim();
                        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
                        const d = new Date(v); if (isNaN(+d)) return ''; const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`;
                      }
                      const d = new Date(v); if (isNaN(+d)) return ''; const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`;
                    } catch { return ''; }
                  };
                  const norm = (s='') => String(s).toLowerCase().trim();
                  const normSlug = (s='') => norm(s).replace(/[\s-]+/g,'_').replace(/[^a-z0-9_]/g,'');
                  const tokens = (() => {
                    const a = (docFieldDef?.name || docFieldDef?.label || requiredDocSlug || '').toString();
                    return [norm(a), norm(requiredDocSlug), normSlug(requiredDocSlug)];
                  })();
                  const wantedYmd = toYmd(fieldValues[slug]);
                  const fieldId = docFieldDef?.id ? String(docFieldDef.id) : null;
                  const candidates = Array.isArray(assetDocs) ? assetDocs.filter(d => {
                    if (!d || !d.url) return false;
                    if (fieldId && String(d.asset_type_field_id || '') === fieldId) return true;
                    // If fieldId is missing on record, fall back to token match in title/kind
                    const title = norm(d.title || '');
                    const kind  = norm(d.kind || '');
                    return tokens.some(t => t && (title.includes(t) || kind.includes(t)));
                  }) : [];
                  const scored = candidates.map(d => {
                    const dy = toYmd(d.related_date);
                    const exactDate = wantedYmd && dy && dy === wantedYmd ? 2 : 0;
                    const tokenBonus = (() => {
                      const title = norm(d.title || ''); const kind = norm(d.kind || '');
                      return tokens.some(t => t && (title.includes(t) || kind.includes(t))) ? 1 : 0;
                    })();
                    const ts = new Date(d.created_at || d.related_date || 0).getTime() || 0;
                    return { d, score: exactDate*10 + tokenBonus, ts };
                  });
                  scored.sort((a,b) => (b.score - a.score) || (b.ts - a.ts));
                  const best = scored[0]?.d || null;
                  const fallbackUrl = (() => {
                    if (best?.url) return best.url;
                    const val = fieldValues[requiredDocSlug];
                    if (typeof val === 'string' && /^https?:\/\//i.test(val)) return val;
                    if (requiredDocSlug === 'documentation_url' && assetDocUrl) return assetDocUrl;
                    return '';
                  })();
                  const name = resolveUrlFileName(fallbackUrl);
                  return (
                    <View>
                      {fallbackUrl ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <TouchableOpacity onPress={() => { try { if (Platform.OS === 'web') window.open(fallbackUrl, '_blank'); else Linking.openURL(fallbackUrl); } catch {} }}>
                            <Text style={{ color: Colors.accent, fontWeight: '800' }}>{name}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.btn, { backgroundColor: Colors.dangerBg }]}
                            onPress={async () => {
                              try {
                                if (best?.id) {
                                  const headers = { ...(await getAuthHeaders()) };
                                  if (auth?.currentUser?.displayName) headers['X-User-Name'] = auth.currentUser.displayName;
                                  if (auth?.currentUser?.email) headers['X-User-Email'] = auth.currentUser.email;
                                  await fetch(`${API_BASE_URL}/assets/${assetId}/documents/${best.id}`, { method: 'DELETE', headers });
                                  setAssetDocs(prev => prev.filter(x => x.id !== best.id));
                                } else {
                                  // clear field value only (for field-based URLs)
                                  setFieldValues((p) => ({ ...p, [requiredDocSlug]: '' }));
                                }
                              } catch (e) { Alert.alert('Error', e.message || 'Failed to remove document'); }
                            }}
                          >
                            <Text style={{ color: '#b00020' }}>Remove</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <Text style={{ color: '#6B7280' }}>No document attached</Text>
                      )}
                      <TouchableOpacity
                        style={[styles.btn, { marginTop: 8 }]}
                        onPress={async () => {
                          try {
                            const pick = await DocumentPicker.getDocumentAsync({ multiple: false, type: [
                              'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/*'
                            ] });
                            if (pick.canceled) return; const sel = pick.assets?.[0]; if (!sel) return;
                            let fd = new FormData();
                          if (Platform.OS === 'web') {
                            try {
                              const resp = await fetch(sel.uri); const blob = await resp.blob();
                              const file = new File([blob], sel.name || 'document.pdf', { type: sel.mimeType || blob.type || 'application/pdf' });
                              fd.append('file', file, file.name);
                            } catch {
                              fd.append('file', { uri: sel.uri, name: sel.name || 'document.pdf', type: sel.mimeType || 'application/pdf' });
                            }
                          } else {
                            fd.append('file', { uri: sel.uri, name: sel.name || 'document.pdf', type: sel.mimeType || 'application/pdf' });
                          }
                          if (docFieldDef?.id) fd.append('asset_type_field_id', String(docFieldDef.id));
                          const toTitle = (s) => {
                            const txt = String(s || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
                            return txt.split(' ').map(w => (w ? w.charAt(0).toUpperCase() + w.slice(1) : '')).join(' ');
                          };
                          const rawName = (docFieldDef?.name || requiredDocSlug);
                          const niceName = toTitle(rawName);
                          fd.append('title', niceName);
                          fd.append('kind', niceName);
                          if (f.label) fd.append('related_date_label', f.label);
                          if (fieldValues[slug]) fd.append('related_date', fieldValues[slug]);

                            const resp = await fetch(`${API_BASE_URL}/assets/${assetId}/documents/upload`, { method: 'POST', body: fd });
                            if (!resp.ok) throw new Error(await resp.text());
                            const j = await resp.json();
                            const doc = j?.document;
                            if (doc?.url) {
                              // reflect immediately
                              setAssetDocs((prev) => [doc, ...prev.filter(x => x.id !== doc.id)]);
                              // back-compat: also write into field value so edit UI shows it without reload
                              setFieldValues((p) => ({ ...p, [requiredDocSlug]: doc.url }));
                            }
                          } catch (e) {
                            Alert.alert('Error', e.message || 'Failed to upload document');
                          }
                        }}
                      >
                        <Text>Attach / Replace Document</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })()}
          </View>
        );
        return (
          <View key={slug} style={styles.docGroupCard} onLayout={onLayoutFor(slug)}>
            <View style={styles.docGroupHeader}>
              <MaterialIcons name={dateIsPrimary ? 'event' : 'description'} size={18} color={Colors.primary} />
              <Text style={styles.docGroupTitle}>
                {dateIsPrimary ? `${dateName}${isReq ? ' *' : ''}` : `${docName}${docRequired ? ' *' : ''}`}
              </Text>
            </View>
            {dateIsPrimary ? DateRow : DocBlock}
            <View style={styles.docGroupDivider} />
            {dateIsPrimary ? DocBlock : DateRow}
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
            // ⬇️ push value directly
            onChangeValue={(val) => updateField(slug, val)}
            items={items}
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
            // ⬇️ push array directly
            onChangeValue={(vals) => updateField(slug, Array.isArray(vals) ? vals : [])}
            items={items}
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

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' }}>
        <Text>Loading...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      {toast.visible && (
        <View style={[styles.toast, styles.toastSuccess]}>
          <MaterialIcons name="check-circle" size={20} color="#047857" />
          <Text style={styles.toastText}>{toast.text}</Text>
        </View>
      )}
      <ScreenHeader
        title="Edit Asset"
        backLabel="Details"
        onBack={() => {
          const returnToIsOnlyThisDetail =
            !normalizedReturnTo || isReturnToThisAssetDetail(normalizedReturnTo, assetId);
          if (normalizedReturnTo && !returnToIsOnlyThisDetail) {
            router.replace(normalizedReturnTo);
            return;
          }
          try {
            if (router.canGoBack?.()) {
              router.back();
              return;
            }
          } catch { /* fall through */ }
          router.replace({ pathname: '/asset/[assetId]', params: { assetId } });
        }}
        right={<Text style={styles.headerId}>#{assetId}</Text>}
      />
      <KeyboardAwareScrollView
        ref={scrollRef}
        contentContainerStyle={isWebWide ? [styles.container, whs.pageScroll] : styles.container}
        keyboardShouldPersistTaps="handled"
        extraScrollHeight={80}
        enableOnAndroid
      >
        {/* Web-only form header — image + heading + upload controls all in
           one card. The mobile-only standalone picker is rendered below. */}
        {isWebWide && (
          <WebEditAssetFormHeader
            currentImageUrl={currentImageUrl}
            pickedImageUri={image?.uri}
            assetId={assetId}
            assetTypeName={(options.assetTypes || []).find(t => t.id === typeId)?.name || ''}
            busy={saving}
            busyLabel="Saving…"
            onPickImage={async () => {
              try {
                const res = await getImageFileFromPicker();
                if (res) {
                  // Free the previous blob: URL before swapping it out
                  revokeImageUri(image?.uri);
                  setImage(res);
                }
              } catch (e) {
                Alert.alert('Unsupported File', e.message || 'Please choose a PNG, JPG, or WEBP image.');
              }
            }}
            onRemoveImage={() => {
              if (image?.uri) {
                revokeImageUri(image.uri);
                setImage(null);
              } else if (currentImageUrl) {
                removeCurrentImage();
              }
            }}
          />
        )}

        {/* Mobile-only image picker (web hero card carries the controls). */}
        {!isWebWide && (
          <View onLayout={onLayoutFor('image')}>
            <Text style={styles.label}>Asset image (optional)</Text>
            <View style={styles.imagePreviewBox}>
              {(image?.uri || currentImageUrl) ? (
                <Image
                  source={{ uri: image?.uri || currentImageUrl }}
                  style={styles.imagePreview}
                  resizeMode="contain"
                />
              ) : (
                <Text style={styles.imagePreviewPlaceholder}>No image yet.</Text>
              )}
              {saving ? (
                <View style={styles.imagePreviewBoxOverlay}>
                  <ActivityIndicator size="large" color={Colors.accent} />
                  <Text style={styles.imagePreviewBoxOverlayLabel}>Saving…</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.uploadHint}>{IMAGE_UPLOAD_HINT}</Text>
            <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
              {(image?.uri || currentImageUrl) ? (
                <>
                  <TouchableOpacity
                    style={[styles.btn, { flex: 1, minWidth: 120 }]}
                    onPress={async () => {
                      try {
                        const res = await getImageFileFromPicker();
                        if (res) { revokeImageUri(image?.uri); setImage(res); }
                      } catch (e) { Alert.alert('Unsupported File', e.message || 'Please choose a PNG, JPG, or WEBP image.'); }
                    }}
                  >
                    <Text>Replace image</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnDangerOutline, { flex: 1, minWidth: 120 }]}
                    onPress={() => {
                      if (image?.uri) { revokeImageUri(image.uri); setImage(null); }
                      else if (currentImageUrl) removeCurrentImage();
                    }}
                  >
                    <Text style={styles.btnDangerOutlineText}>Remove image</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  style={[styles.btn, { flex: 1, minWidth: 140 }]}
                  onPress={async () => {
                    try {
                      const res = await getImageFileFromPicker();
                      if (res) { revokeImageUri(image?.uri); setImage(res); }
                    } catch (e) { Alert.alert('Unsupported File', e.message || 'Please choose a PNG, JPG, or WEBP image.'); }
                  }}
                >
                  <Text>Pick image</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Type */}
        <Text style={whs.sectionHeader}>Basic Information</Text>
        <View style={{ zIndex: 4000 }} onLayout={onLayoutFor('typeId')}>
          <Text style={[styles.label, !!errors.typeId && styles.labelError]}>Asset Type *</Text>
          <DropDownPicker
            open={typeOpen}
            setOpen={setTypeOpen}
            value={typeId}
            setValue={(fn) => setTypeId(fn())}
            items={(options.assetTypes || []).map(t => ({ label: t.name, value: t.id }))}
            placeholder="Select Asset Type"
            style={[styles.dropdown, styles.disabledField, !!errors.typeId && styles.dropdownError]}
            dropDownContainerStyle={[styles.dropdownContainer, styles.disabledField]}
            nestedScrollEnabled
            disabled
          />
          <View style={styles.lockRow}>
            <MaterialIcons name="lock" size={14} color="#9CA3AF" />
            <Text style={styles.lockText}>Locked on edit</Text>
          </View>
          {!!errors.typeId && <Text style={styles.errorBelow}>{errors.typeId}</Text>}
        </View>

        {/* Serial number (column on assets row; admins can edit) */}
        <View onLayout={onLayoutFor('serial_number')}>
          <Text style={styles.label}>Serial number</Text>
          <TextInput
            style={[styles.input, !isAdmin && styles.disabledField]}
            value={serialNumber}
            onChangeText={(t) => {
              if (!isAdmin) return;
              setSerialNumber(t);
            }}
            placeholder="Serial number"
            editable={isAdmin}
            autoCapitalize="characters"
            maxLength={FIELD_LIMITS.SERIAL}
          />
          {!isAdmin ? (
            <View style={styles.lockRow}>
              <MaterialIcons name="lock" size={14} color="#9CA3AF" />
              <Text style={styles.lockText}>Admins can edit serial and assignment</Text>
            </View>
          ) : null}
        </View>

        {/* Dynamic (exclude slug serial_number — shown above as the asset column) */}
        {!!typeId &&
          fieldsSchema
            .filter((f) => String(f.slug || normSlug(f.name)).toLowerCase() !== 'serial_number')
            .map(renderDynamic)}

        {/* Static */}
        <View onLayout={onLayoutFor('location')}>
          <Text style={styles.label}>Location</Text>
          <TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder="Location" maxLength={FIELD_LIMITS.LOCATION} />
        </View>

        <View onLayout={onLayoutFor('model')}>
          <Text style={styles.label}>Model</Text>
          <TextInput style={styles.input} value={model} onChangeText={setModel} placeholder="Model" maxLength={FIELD_LIMITS.MODEL} />
        </View>

        <View onLayout={onLayoutFor('other_id')}>
          <Text style={styles.label}>Other ID</Text>
          <TextInput
            style={styles.input}
            value={otherId}
            onChangeText={setOtherId}
            placeholder="Other ID (e.g. barcode, internal code)"
            maxLength={100}
            autoCapitalize="none"
          />
        </View>

        <View onLayout={onLayoutFor('description')}>
          <Text style={styles.label}>Description</Text>
          <TextInput style={[styles.input, { height: 80 }]} value={description} onChangeText={setDescription} placeholder="Description" multiline maxLength={FIELD_LIMITS.DESCRIPTION} />
        </View>

        <View onLayout={onLayoutFor('next_service_date')}>
          <Text style={styles.label}>Next Service Date</Text>
          <TouchableOpacity style={styles.input} onPress={() => setDatePicker({ open: true, slug: '__next_service_date' })}>
            <Text style={{ color: nextServiceDate ? '#000' : '#888' }}>{nextServiceDate ? formatDisplayDate(nextServiceDate) : 'Select Next Service Date'}</Text>
          </TouchableOpacity>
        </View>

        <View onLayout={onLayoutFor('date_purchased')}>
          <Text style={styles.label}>Date Purchased</Text>
          <TouchableOpacity style={styles.input} onPress={() => setDatePicker({ open: true, slug: '__date_purchased' })}>
            <Text style={{ color: datePurchased ? '#000' : '#888' }}>{datePurchased ? formatDisplayDate(datePurchased) : 'Select Date Purchased'}</Text>
          </TouchableOpacity>
        </View>

        <Text style={whs.sectionHeader}>Assignment & Notes</Text>
        <View onLayout={onLayoutFor('notes')}>
          <Text style={styles.label}>Notes</Text>
          <TextInput style={[styles.input, { height: 80 }]} value={notes} onChangeText={setNotes} placeholder="Notes" multiline maxLength={FIELD_LIMITS.NOTES} />
        </View>

        <View style={{ zIndex: 2000 }} onLayout={onLayoutFor('assigned_to_id')}>
          <Text style={styles.label}>User assigned</Text>
          <DropDownPicker
            open={userOpen}
            setOpen={setUserOpen}
            value={assignedToId}
            setValue={(fn) => setAssignedToId(fn())}
            items={(options.users || []).map(u => ({ label: u.name || u.useremail || u.id, value: u.id }))}
            placeholder="Select user"
            style={[styles.dropdown, !isAdmin && styles.disabledField]}
            dropDownContainerStyle={[styles.dropdownContainer, !isAdmin && styles.disabledField]}
            nestedScrollEnabled
            disabled={!isAdmin}
          />
          {!isAdmin ? (
            <View style={styles.lockRow}>
              <MaterialIcons name="lock" size={14} color="#9CA3AF" />
              <Text style={styles.lockText}>Admins only</Text>
            </View>
          ) : null}
        </View>

        <View onLayout={onLayoutFor('status')}>
          <Text style={styles.label}>Status</Text>
          <View style={[styles.input, styles.readOnlyBox]}>
            <Text style={styles.readOnlyValue}>{status || '—'}</Text>
          </View>
          <View style={styles.lockRow}>
            <MaterialIcons name="lock" size={14} color="#9CA3AF" />
            <Text style={styles.lockText}>Status is set by workflows (check-in, hire, repairs, etc.), not on this screen.</Text>
          </View>
        </View>

        {/* Image picker moved to the top of the form — only the Documents
           section remains in this position. */}
        <Text style={whs.sectionHeader}>Documents</Text>

        <View onLayout={onLayoutFor('document')}>
          <Text style={styles.label}>Document</Text>
          <Text style={styles.uploadHint}>{ASSET_DOCUMENT_FIELD_HINT}</Text>
          <TouchableOpacity style={styles.btn} onPress={async () => {
            try {
              const pick = await DocumentPicker.getDocumentAsync({
                multiple: false,
                type: [
                  'application/pdf',
                  'application/msword',
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                ],
              });
              if (pick.canceled || !pick.assets?.length) return;
              const a = pick.assets[0];
              setDocument({
                uri: a.uri,
                name: a.name || 'document',
                mimeType: a.mimeType || 'application/pdf',
                file: a.file,
              });
            } catch (e) {
              Alert.alert('Document', e?.message || 'Could not select a file.');
            }
          }}>
            <Text>{document ? 'Change Document' : 'Attach Document'}</Text>
          </TouchableOpacity>
          {document && <Text style={{ marginTop: 6, fontStyle: 'italic' }}>Attached: {document.name}</Text>}
        </View>

        <TouchableOpacity
          onPress={submit}
          disabled={saving}
          style={[styles.btn, styles.btnLg, styles.submit, saving && styles.submitDisabled]}
        >
          <Text style={styles.btnTextPrimary}>{saving ? 'Saving...' : 'Save Changes'}</Text>
        </TouchableOpacity>
  </KeyboardAwareScrollView>

      {/* Saving overlay with progress for files */}
      {saving && (
        <Modal transparent animationType="fade" visible>
          <View style={styles.modalBackdrop}>
            <ActivityIndicator size="large" />
            <Text style={{ marginTop: 12, color: '#111' }}>{filesProgress ? `Uploading ${filesProgress}%` : 'Saving…'}</Text>
            {filesProgress ? (
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: Math.round(Math.max(0, Math.min(100, filesProgress)) / 100 * 260) }]} />
              </View>
            ) : null}
            {filesStartTs ? (
              <Text style={{ marginTop: 4, color: '#666' }}>{`${Math.max(0, Math.floor((Date.now() - filesStartTs)/1000))}s elapsed`}</Text>
            ) : null}
          </View>
        </Modal>
      )}
      {/* Web portal overlay to ensure visibility in all hosts */}
      {Platform.OS === 'web' && (
        <WebOverlayPortal visible={saving}>
          <ActivityIndicator size="large" />
          <Text style={{ marginTop: 12, color: '#111' }}>{filesProgress ? `Uploading ${filesProgress}%` : 'Saving…'}</Text>
          {filesProgress ? (
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: Math.round(Math.max(0, Math.min(100, filesProgress)) / 100 * 260) }]} />
            </View>
          ) : null}
          {filesStartTs ? (
            <Text style={{ marginTop: 4, color: '#666' }}>{`${Math.max(0, Math.floor((Date.now() - filesStartTs)/1000))}s elapsed`}</Text>
          ) : null}
        </WebOverlayPortal>
      )}

      <DatePickerModal
        locale="en"
        mode="single"
        visible={datePicker.open}
        onDismiss={() => setDatePicker({ open: false, slug: null })}
        onConfirm={({ date }) => {
          if (datePicker.slug) {
            const iso = date.toISOString().split('T')[0];
            if (datePicker.slug === '__next_service_date') setNextServiceDate(iso);
            else if (datePicker.slug === '__date_purchased') setDatePurchased(iso);
            else setFieldValues((p) => ({ ...p, [datePicker.slug]: iso }));
          }
          setDatePicker({ open: false, slug: null });
        }}
      />
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

function WebEditAssetFormHeader({ currentImageUrl, pickedImageUri, assetId, assetTypeName, onPickImage, onRemoveImage, busy = false, busyLabel = 'Saving…' }) {
  const imgUri = pickedImageUri || currentImageUrl;
  const hasImage = !!imgUri;
  return (
    <View style={whs.formHeader}>
      <View style={whs.formHeaderImg}>
        {hasImage ? (
          <Image source={{ uri: imgUri }} style={whs.formHeaderImgFull} resizeMode="contain" />
        ) : (
          <View style={whs.formHeaderImgPlaceholder}>
            <MaterialIcons name="image-not-supported" size={40} color={Colors.sub2} />
            <Text style={whs.formHeaderImgHint}>No image</Text>
          </View>
        )}
        {busy ? (
          <View style={whs.formHeaderImgOverlay}>
            <ActivityIndicator size="large" color={Colors.accent} />
            <Text style={whs.formHeaderImgOverlayLabel}>{busyLabel}</Text>
          </View>
        ) : null}
      </View>
      <View style={whs.formHeaderInfo}>
        <View style={whs.formHeaderText}>
          <Text style={whs.formHeaderLabel}>Editing Asset</Text>
          <Text style={whs.formHeaderTitle}>#{assetId}</Text>
          {!!assetTypeName && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <MaterialIcons name="category" size={14} color={Colors.sub2} />
              <Text style={whs.formHeaderMeta}>{assetTypeName}</Text>
            </View>
          )}
          <Text style={whs.formHeaderSub}>Update the fields below, then tap Save Changes.</Text>
        </View>
        <View style={whs.formHeaderControls}>
          <Text style={whs.formHeaderControlsHint}>{IMAGE_UPLOAD_HINT}</Text>
          <View style={whs.formHeaderControlsRow}>
            {hasImage ? (
              <>
                <TouchableOpacity style={[styles.btn, { flex: 1, minWidth: 120, marginVertical: 0 }]} onPress={onPickImage}>
                  <Text>Replace image</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnDangerOutline, { flex: 1, minWidth: 120, marginVertical: 0 }]}
                  onPress={onRemoveImage}
                >
                  <Text style={styles.btnDangerOutlineText}>Remove image</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={[styles.btn, { flex: 1, minWidth: 140, marginVertical: 0 }]} onPress={onPickImage}>
                <Text>Pick image</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </View>
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
  // ── Grouped document+date card ──
  docGroupCard: { marginBottom: 16, padding: 14, borderRadius: Radius.lg, borderWidth: 2, borderColor: Colors.line, backgroundColor: Colors.card, ...CardShadow },
  docGroupHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  docGroupTitle: { fontSize: sf(16), fontWeight: '800', color: Colors.text },
  docGroupDivider: { height: 1, backgroundColor: Colors.line, marginVertical: 12 },
  label: { marginTop: 10, marginBottom: 6, fontWeight: '700', color: Colors.text },
  labelError: { color: Colors.dangerFg },
  inputError: { borderColor: Colors.dangerFg },
  dropdownError: { borderColor: Colors.dangerFg },
  uploadHint: { fontSize: 12, color: Colors.sub, lineHeight: 18, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  btn: { backgroundColor: Colors.chip, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', borderRadius: Radius.sm, marginVertical: 8, justifyContent: 'center', borderWidth: 2, borderColor: Colors.line },
  btnLg: { minHeight: 48, borderRadius: Radius.lg, paddingVertical: 14 },
  submit: { backgroundColor: Colors.primary },
  submitDisabled: { opacity: 0.7, ...(Platform.OS === 'web' ? { cursor: 'not-allowed' } : null) },
  btnTextPrimary: { color: Colors.card, fontWeight: '800', fontSize: sf(16) },
  headerId: { fontSize: sf(12), fontWeight: '700', color: Colors.sub },
  dropdown: { borderColor: Colors.line, marginBottom: 16, borderWidth: 2, borderRadius: Radius.sm },
  dropdownContainer: { borderColor: Colors.line, borderRadius: Radius.sm },
  errorBelow: { marginTop: 4, color: Colors.dangerFg, fontWeight: '600' },
  // Disabled visuals for locked fields
  disabledField: { backgroundColor: Colors.chip, borderColor: Colors.line, borderWidth: 2, borderRadius: Radius.sm, ...(Platform.OS === 'web' ? { cursor: 'not-allowed' } : {}) },
  readOnlyBox: { justifyContent: 'center', backgroundColor: Colors.chip },
  readOnlyValue: { fontSize: sf(15), fontWeight: '700', color: Colors.text },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  lockText: { color: Colors.sub2, fontSize: sf(12), fontWeight: '700' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(255,255,255,0.85)', justifyContent: 'center', alignItems: 'center' },
  progressBar: { width: 260, height: 8, borderRadius: Radius.sm, backgroundColor: Colors.chip, marginTop: 8, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: Colors.accent, borderRadius: Radius.sm },
  webOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center', justifyContent: 'center',
    zIndex: 2147483647,
    pointerEvents: 'auto',
  },
  portalOverlayCard: { backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },

  toast: { position: 'absolute', bottom: 24, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 16, borderRadius: Radius.lg, zIndex: 9999, elevation: 4, ...CardShadow },
  toastSuccess: { backgroundColor: Colors.successBg, borderWidth: 2, borderColor: Colors.successFg },
  toastText: { color: Colors.successFg, fontWeight: '700', flex: 1 },

  // ── Big image preview box (matches the asset-type pickers) ──
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
    position: 'relative',
  },
  imagePreview: { width: '100%', height: '100%' },
  imagePreviewPlaceholder: { color: Colors.sub2, fontWeight: '600', fontSize: sf(13) },
  imagePreviewBoxOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  imagePreviewBoxOverlayLabel: {
    fontSize: sf(13),
    fontWeight: '800',
    color: Colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  btnDangerOutline: {
    backgroundColor: Colors.card,
    borderColor: Colors.dangerFg,
    borderWidth: 2,
  },
  btnDangerOutlineText: { color: Colors.dangerFg, fontWeight: '800' },
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
    position: 'relative',
  },
  formHeaderImgFull: {
    width: '100%',
    height: '100%',
  },
  // Translucent overlay shown over the image area during save / upload.
  formHeaderImgOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  formHeaderImgOverlayLabel: {
    fontSize: sf(13),
    fontWeight: '800',
    color: Colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
