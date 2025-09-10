// app/(tabs)/assets/new.js
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Image, Alert, Platform, Switch, ActivityIndicator, Modal
} from 'react-native';
import { DatePickerModal } from 'react-native-paper-dates';
import { en, registerTranslation } from 'react-native-paper-dates';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import DropDownPicker from 'react-native-dropdown-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { LogBox } from 'react-native';
import { API_BASE_URL } from '../../inventory-api/apiBase';

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
  const { fromAssetId } = useLocalSearchParams();

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

  // ---------- static / non-dynamic fields ----------
  const [image, setImage] = useState(null);
  const [document, setDocument] = useState(null);

  // UI error bag
  const [errors, setErrors] = useState({});       // { slugOrFieldName: "message" }
  const [formError, setFormError] = useState(''); // fallback for unknown errors

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0); // 0..100 (web only)

  // dropdown meta
  const [options, setOptions] = useState({ assetTypes: [], users: [], statuses: [], assetIds: [] });
  const [typeOpen, setTypeOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  // qr picker
  const [showQRs, setShowQRs] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredAssetIds, setFilteredAssetIds] = useState([]);

  // ---------- core form ----------
  const [id, setId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [assignedToId, setAssignedToId] = useState('');
  const [status, setStatus] = useState('');
  const [location, setLocation] = useState('');

  // classic top-level fields
  const [model, setModel] = useState('');
  const [description, setDescription] = useState('');
  const [nextServiceDate, setNextServiceDate] = useState('');
  const [datePurchased, setDatePurchased] = useState('');
  const [notes, setNotes] = useState('');
  const [serialNumber, setSerialNumber] = useState('');

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
    });

    if (fromAssetId) {
      fetch(`${API_BASE_URL}/assets/${fromAssetId}`)
        .then(res => res.json())
        .then(data => {
          setSerialNumber(data.serial_number || '');
          setTypeId(data.type_id || '');
          setAssignedToId(data.assigned_to_id || '');
          setStatus(data.status || '');
          setLocation(data.location || '');
          if (data.fields && typeof data.fields === 'object') setFieldValues(data.fields);
        })
        .catch(console.error);
    }
  }, []);

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
        'id','type_id','assigned_to_id','status','location','model','description','next_service_date','date_purchased','notes','image','document'
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
        const empty =
          (t === 'multiselect' && (!Array.isArray(val) || val.length === 0))
            ? true
            : (t === 'boolean')
              ? false
              : (val === undefined || val === null || String(val).trim() === '');
        if (empty) newErrors[slug] = 'Required';
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
    if (location) data.append('location', location);
    data.append('fields', JSON.stringify(fieldValues));
    if (model) data.append('model', model);
    if (description) data.append('description', description);
    if (nextServiceDate) data.append('next_service_date', nextServiceDate);
    if (datePurchased) data.append('date_purchased', datePurchased);
    if (notes) data.append('notes', notes);
    if (serialNumber) data.append('serial_number', serialNumber);

    if (image?.file) data.append('image', image.file, image.file.name || 'upload.jpg');
    if (document) {
      data.append('document', {
        uri: document.uri,
        name: document.name || 'document.pdf',
        type: document.mimeType || 'application/pdf',
      });
    }

    setUploading(true);
    setUploadProgress(0);

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
      if (Platform.OS === 'web') {
        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', `${API_BASE_URL}/assets`);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 100);
              setUploadProgress(pct);
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
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
      } else {
        const res = await fetch(`${API_BASE_URL}/assets`, { method: 'POST', body: data });
        if (!res.ok) {
          await handleServerFailure(res);
          throw new Error('upload-failed');
        }
      }

      Alert.alert('Success', 'Asset created!');
      router.replace({ pathname: '/Inventory', params: { tab: 'all' } });
    } catch (_e) {
      // handled above
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

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
      case 'text':
      case 'textarea':
      case 'email':
      case 'url':
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

      case 'date':
        return (
          <View key={slug} style={{ marginBottom: 12 }} onLayout={onLayoutFor(slug)}>
            {Label}
            <TouchableOpacity style={styles.input} onPress={() => setDatePicker({ open: true, slug })}>
              <Text style={{ color: fieldValues[slug] ? '#000' : '#888' }}>
                {fieldValues[slug] || `Select ${f.label || f.name}`}
              </Text>
            </TouchableOpacity>
            {!!errors[slug] && <Text style={styles.errorBelow}>{errors[slug]}</Text>}
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <KeyboardAwareScrollView
        ref={scrollRef}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        extraScrollHeight={80}
        enableOnAndroid
      >
        {/* Header */}
        <View style={{ marginBottom: 20 }} onLayout={onLayoutFor('header')}>
          <TouchableOpacity
            onPress={() => router.replace({ pathname: '/Inventory', params: { tab: 'all' } })}
            style={{ marginBottom: 10 }}
          >
            <Text style={{ color: '#1E90FF', fontWeight: 'bold', fontSize: 16 }}>{'< Back'}</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginTop: 5 }}>
            Create New Asset
          </Text>
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
          <TextInput
            ref={setInputRef('id')}
            style={styles.input}
            placeholder="Search by ID"
            value={searchTerm}
            onChangeText={text => {
              setSearchTerm(text);
              const filtered = (options.assetIds || []).filter(qrId =>
                String(qrId).toLowerCase().includes(text.toLowerCase())
              );
              setFilteredAssetIds(filtered);
            }}
          />
          <TouchableOpacity onPress={() => setShowQRs(!showQRs)} style={styles.qrToggle}>
            <Text style={{ color: '#1E90FF', fontWeight: 'bold' }}>
              {showQRs ? 'Hide QR Options ▲' : 'Show QR Options ▼'}
            </Text>
          </TouchableOpacity>
          {!!errors.id && <Text style={styles.errorBelow}>{errors.id}</Text>}
        </View>

        {showQRs && (
          <View style={styles.qrGrid}>
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

        {/* Static common fields */}
        <View onLayout={onLayoutFor('location')}>
          <Text style={styles.label}>Location</Text>
          <TextInput
            ref={setInputRef('location')}
            style={styles.input}
            placeholder="Location"
            value={location}
            onChangeText={(t)=>{ setLocation(t); setErrors(prev=>({...prev,location:undefined})); }}
          />
          {!!errors.location && <Text style={styles.errorBelow}>{errors.location}</Text>}
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

        <View onLayout={onLayoutFor('next_service_date')}>
          <Text style={styles.label}>Next Service Date</Text>
          <TouchableOpacity style={styles.input} onPress={() => setDatePicker({ open: true, slug: '__next_service_date' })}>
            <Text style={{ color: nextServiceDate ? '#000' : '#888' }}>
              {nextServiceDate || 'Select Next Service Date'}
            </Text>
          </TouchableOpacity>
          {!!errors.next_service_date && <Text style={styles.errorBelow}>{errors.next_service_date}</Text>}
        </View>

        <View onLayout={onLayoutFor('date_purchased')}>
          <Text style={styles.label}>Date Purchased</Text>
          <TouchableOpacity style={styles.input} onPress={() => setDatePicker({ open: true, slug: '__date_purchased' })}>
            <Text style={{ color: datePurchased ? '#000' : '#888' }}>
              {datePurchased || 'Select Date Purchased'}
            </Text>
          </TouchableOpacity>
          {!!errors.date_purchased && <Text style={styles.errorBelow}>{errors.date_purchased}</Text>}
        </View>

        <View onLayout={onLayoutFor('notes')}>
          <Text style={styles.label}>Notes</Text>
          <TextInput
            ref={setInputRef('notes')}
            style={[styles.input, { height: 80 }]}
            placeholder="Notes"
            value={notes}
            onChangeText={(t)=>{ setNotes(t); setErrors(prev=>({...prev,notes:undefined})); }}
            multiline
          />
          {!!errors.notes && <Text style={styles.errorBelow}>{errors.notes}</Text>}
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
          {image?.uri && <Image source={{ uri: image.uri }} style={styles.preview} />}
          {!!errors.image && <Text style={styles.errorBelow}>{errors.image}</Text>}
          <TouchableOpacity style={styles.btn} onPress={pickImage}><Text>Pick Image</Text></TouchableOpacity>
        </View>

        <View onLayout={onLayoutFor('document')}>
          {document && <Text style={{ marginTop: 10, fontStyle: 'italic' }}>Attached: {document.name}</Text>}
          {!!errors.document && <Text style={styles.errorBelow}>{errors.document}</Text>}
          <TouchableOpacity style={styles.btn} onPress={pickDocument}><Text>Attach Document</Text></TouchableOpacity>
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
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={{ color: '#fff' }}>Create Asset</Text>
          )}
        </TouchableOpacity>

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
            Uploading {Platform.OS === 'web' && uploadProgress ? `${uploadProgress}%` : '...'}
          </Text>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: Platform.OS === 'ios' ? 20 : 0 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 5, padding: 12, marginVertical: 8, color: '#000' },
  label: { marginTop: 10, marginBottom: 6, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  btn: { backgroundColor: '#eee', padding: 15, alignItems: 'center', borderRadius: 5, marginVertical: 8 },
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
});
