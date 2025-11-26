import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, Alert, Switch, Image, Modal, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import DropDownPicker from 'react-native-dropdown-picker';
import { DatePickerModal } from 'react-native-paper-dates';
import { en, registerTranslation } from 'react-native-paper-dates';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import { formatDisplayDate } from '../../utils/date';
import * as DocumentPicker from 'expo-document-picker';
import { getImageFileFromPicker } from '../../utils/getFormFileFromPicker';
import ScreenHeader from '../../components/ui/ScreenHeader';

registerTranslation('en', en);

const normSlug = (s = '') => String(s).toLowerCase().trim().replace(/[\s\-]+/g, '_').replace(/[^a-z0-9_]/g, '');

export default function EditAsset() {
  const { assetId, returnTo } = useLocalSearchParams();
  const normalizedReturnTo = Array.isArray(returnTo) ? returnTo[0] : returnTo;
  const router = useRouter();

  const scrollRef = useRef(null);
  const fieldYs = useRef({});

  const [options, setOptions] = useState({ assetTypes: [], users: [], statuses: [] });
  const [typeOpen, setTypeOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  const [fieldsSchema, setFieldsSchema] = useState([]);
  const [fieldValues, setFieldValues] = useState({});

  const [typeId, setTypeId] = useState('');
  const [assignedToId, setAssignedToId] = useState('');
  const [status, setStatus] = useState('');
  const [location, setLocation] = useState('');
  const [model, setModel] = useState('');
  const [description, setDescription] = useState('');
  const [nextServiceDate, setNextServiceDate] = useState('');
  const [datePurchased, setDatePurchased] = useState('');
  const [notes, setNotes] = useState('');
  const [assetDocUrl, setAssetDocUrl] = useState(''); // top-level documentation_url
  const [assetDocs, setAssetDocs] = useState([]);     // DB-backed documents for this asset
  const [image, setImage] = useState(null);       // { uri, file }
  const [currentImageUrl, setCurrentImageUrl] = useState('');
  const [document, setDocument] = useState(null); // { uri, name, mimeType }

  const [datePicker, setDatePicker] = useState({ open: false, slug: null });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
          statuses: opts.statuses || ['Available', 'In Use', 'Rented', 'Maintenance'],
        });

        setTypeId(a.type_id || '');
        setAssignedToId(a.assigned_to_id || '');
        setStatus(a.status || '');
        setLocation(a.location || '');
        setModel(a.model || '');
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
      const res = await fetch(`${API_BASE_URL}/assets/asset-types/${typeId}/fields`);
      const json = await res.json();
      if (ignore) return;

      setFieldsSchema(json || []);
      setFieldValues(prev => {
        const seed = { ...prev };
        (json || []).forEach(f => {
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
      status: status || undefined,
      location: location || null,
      model: model || null,
      description: description || null,
      next_service_date: nextServiceDate || null,
      date_purchased: datePurchased || null,
      notes: notes || null,
      fields: fieldValues,
    };

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/assets/${assetId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || body?.message || 'Failed to update');
      }

      // If files selected, upload them in a separate call (with progress)
      if (image?.file || document) {
        // Allow overlay to render before starting upload
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((resolve, reject) => {
          const fd = new FormData();
          if (image?.file) fd.append('image', image.file, image.file.name || 'upload.jpg');
          if (document) {
            if (Platform.OS === 'web') {
              fetch(document.uri)
                .then((r) => r.blob())
                .then((blob) => {
                  const file = new File([blob], document.name || 'document.pdf', { type: document.mimeType || blob.type || 'application/pdf' });
                  fd.append('document', file, file.name);
                })
                .catch(() => {
                  fd.append('document', { uri: document.uri, name: document.name || 'document.pdf', type: document.mimeType || 'application/pdf' });
                });
            } else {
              fd.append('document', { uri: document.uri, name: document.name || 'document.pdf', type: document.mimeType || 'application/pdf' });
            }
          }
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', `${API_BASE_URL}/assets/${assetId}/files`);
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
      if (Platform.OS !== 'web') Alert.alert('Updated', 'Asset saved.');
      router.replace({ pathname: `/asset/${assetId}` });
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

  const renderDynamic = (f) => {
    const slug = f.slug || normSlug(f.name);
    const typeCode = (f.field_type?.code || f.field_type?.slug || '').toLowerCase();
    const isReq = !!f.is_required;
    const Label = <Text style={styles.label}>{(f.label || f.name) || slug}{isReq ? ' *' : ''}</Text>;
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
                style={[styles.input, typeCode === 'textarea' && { height: 90 }]}
                placeholder={`Enter ${f.label || f.name}`}
                value={String(fieldValues[slug] ?? '')}
                onChangeText={(t) => updateField(slug, t)}
                multiline={typeCode === 'textarea'}
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
                      await new Promise((resolve, reject) => {
                        const xhr = new XMLHttpRequest();
                        xhr.open('PUT', `${API_BASE_URL}/assets/${assetId}/files`);
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
                    style={[styles.btn, { backgroundColor: '#fdecea' }]}
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
              style={styles.input}
              keyboardType="numeric"
              value={fieldValues[slug] !== undefined && fieldValues[slug] !== null ? String(fieldValues[slug]) : ''}
              onChangeText={(t) => updateField(slug, t.replace(/[^\d.-]/g, ''))}
            />
            {!!errors[slug] && <Text style={styles.errorBelow}>{errors[slug]}</Text>}
          </View>
        );
      case 'date':
        return (
          <View key={slug} style={{ marginBottom: 12 }} onLayout={onLayoutFor(slug)}>
            {Label}
            <TouchableOpacity style={styles.input} onPress={() => setDatePicker({ open: true, slug })}>
              <Text style={{ color: fieldValues[slug] ? '#000' : '#888' }}>
                {fieldValues[slug] ? formatDisplayDate(fieldValues[slug]) : `Select ${f.label || f.name}`}
              </Text>
            </TouchableOpacity>
            {!!errors[slug] && <Text style={styles.errorBelow}>{errors[slug]}</Text>}
            {/* Attachment controls linked to this date, when a document field is required */}
            {requiredDocSlug ? (
              <View style={{ marginTop: 6 }}>
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
                            <Text style={{ color: '#0B63CE', fontWeight: '800' }}>{name}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.btn, { backgroundColor: '#fdecea' }]}
                            onPress={async () => {
                              try {
                                if (best?.id) {
                                  await fetch(`${API_BASE_URL}/assets/${assetId}/documents/${best.id}`, { method: 'DELETE' });
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
            ) : null}
          </View>
        );
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
            // ⬇️ push array directly
            onChangeValue={(vals) => updateField(slug, Array.isArray(vals) ? vals : [])}
            items={items}
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

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' }}>
        <Text>Loading...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScreenHeader
        title="Edit Asset"
        backLabel="Details"
        onBack={() => {
          if (normalizedReturnTo) {
            router.replace(normalizedReturnTo);
            return;
          }
          router.replace({ pathname: '/asset/[assetId]', params: { assetId } });
        }}
        right={<Text style={styles.headerId}>#{assetId}</Text>}
      />
      <KeyboardAwareScrollView
        ref={scrollRef}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        extraScrollHeight={80}
        enableOnAndroid
      >
        {/* Type */}
        <View style={{ zIndex: 4000 }} onLayout={onLayoutFor('typeId')}>
          <Text style={styles.label}>Asset Type *</Text>
          <DropDownPicker
            open={typeOpen}
            setOpen={setTypeOpen}
            value={typeId}
            setValue={(fn) => setTypeId(fn())}
            items={(options.assetTypes || []).map(t => ({ label: t.name, value: t.id }))}
            placeholder="Select Asset Type"
            style={[styles.dropdown, styles.disabledField]}
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

        {/* Dynamic */}
        {!!typeId && fieldsSchema.map(renderDynamic)}

        {/* Static */}
        <View onLayout={onLayoutFor('location')}>
          <Text style={styles.label}>Location</Text>
          <TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder="Location" />
        </View>

        <View onLayout={onLayoutFor('model')}>
          <Text style={styles.label}>Model</Text>
          <TextInput style={styles.input} value={model} onChangeText={setModel} placeholder="Model" />
        </View>

        <View onLayout={onLayoutFor('description')}>
          <Text style={styles.label}>Description</Text>
          <TextInput style={[styles.input, { height: 80 }]} value={description} onChangeText={setDescription} placeholder="Description" multiline />
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

        <View onLayout={onLayoutFor('notes')}>
          <Text style={styles.label}>Notes</Text>
          <TextInput style={[styles.input, { height: 80 }]} value={notes} onChangeText={setNotes} placeholder="Notes" multiline />
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
            style={[styles.dropdown, styles.disabledField]}
            dropDownContainerStyle={[styles.dropdownContainer, styles.disabledField]}
            nestedScrollEnabled
            disabled
          />
          <View style={styles.lockRow}>
            <MaterialIcons name="lock" size={14} color="#9CA3AF" />
            <Text style={styles.lockText}>Locked on edit</Text>
          </View>
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
            style={[styles.dropdown, styles.disabledField]}
            dropDownContainerStyle={[styles.dropdownContainer, styles.disabledField]}
            nestedScrollEnabled
            disabled
          />
          <View style={styles.lockRow}>
            <MaterialIcons name="lock" size={14} color="#9CA3AF" />
            <Text style={styles.lockText}>Locked on edit</Text>
          </View>
        </View>

        {/* Optional image/document updates */}
        <View onLayout={onLayoutFor('image')}>
          <Text style={styles.label}>Image</Text>
          {(image?.uri || currentImageUrl) ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Image source={{ uri: image?.uri || currentImageUrl }} style={{ width: 80, height: 80, borderRadius: 6, backgroundColor: '#eef' }} />
              {image?.uri ? (
                <TouchableOpacity style={[styles.btn, { backgroundColor: '#fdecea' }]} onPress={() => setImage(null)}>
                  <Text style={{ color: '#b00020' }}>Remove Selected</Text>
                </TouchableOpacity>
              ) : currentImageUrl ? (
                <TouchableOpacity style={[styles.btn, { backgroundColor: '#fdecea' }]} onPress={removeCurrentImage}>
                  <Text style={{ color: '#b00020' }}>Remove Current</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <TouchableOpacity style={styles.btn} onPress={async () => { const res = await getImageFileFromPicker(); if (res) setImage(res); }}>
              <Text>{image?.uri ? 'Change Image' : 'Pick Image'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View onLayout={onLayoutFor('document')}>
          <Text style={styles.label}>Document</Text>
          <TouchableOpacity style={styles.btn} onPress={async () => {
            const pick = await DocumentPicker.getDocumentAsync({ multiple: false });
            if (pick.type === 'success') setDocument(pick);
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

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: Platform.OS === 'ios' ? 20 : 0 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 5, padding: 12, marginVertical: 8, color: '#000' },
  label: { marginTop: 10, marginBottom: 6, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  btn: { backgroundColor: '#eee', paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', borderRadius: 6, marginVertical: 8, justifyContent: 'center' },
  btnLg: { minHeight: 48, borderRadius: 10, paddingVertical: 14 },
  submit: { backgroundColor: '#1E90FF' },
  submitDisabled: { opacity: 0.7, ...(Platform.OS === 'web' ? { cursor: 'not-allowed' } : null) },
  btnTextPrimary: { color: '#fff', fontWeight: '700', fontSize: 16 },
  headerId: { fontSize: 12, fontWeight: '700', color: '#475569' },
  dropdown: { borderColor: '#ccc', marginBottom: 16 },
  dropdownContainer: { borderColor: '#ccc' },
  errorBelow: { marginTop: 4, color: '#b00020' },
  // Disabled visuals for locked fields
  disabledField: { backgroundColor: '#F8FAFC', borderColor: '#E5E7EB', ...(Platform.OS === 'web' ? { cursor: 'not-allowed' } : {}) },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  lockText: { color: '#9CA3AF', fontSize: 12, fontWeight: '700' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(255,255,255,0.85)', justifyContent: 'center', alignItems: 'center' },
  progressBar: { width: 260, height: 8, borderRadius: 6, backgroundColor: '#E6EDF3', marginTop: 8, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: '#0B63CE', borderRadius: 6 },
  webOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center', justifyContent: 'center',
    zIndex: 2147483647,
    pointerEvents: 'auto',
  },
  portalOverlayCard: { backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
});
