import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, Alert, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import DropDownPicker from 'react-native-dropdown-picker';
import { DatePickerModal } from 'react-native-paper-dates';
import { en, registerTranslation } from 'react-native-paper-dates';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { API_BASE_URL } from '../../inventory-api/apiBase';

registerTranslation('en', en);

const normSlug = (s = '') => String(s).toLowerCase().trim().replace(/[\s\-]+/g, '_').replace(/[^a-z0-9_]/g, '');

export default function EditAsset() {
  const { assetId } = useLocalSearchParams();
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

  const [datePicker, setDatePicker] = useState({ open: false, slug: null });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
        setNextServiceDate(a.next_service_date ? String(a.next_service_date).split('T')[0] : '');
        setDatePurchased(a.date_purchased ? String(a.date_purchased).split('T')[0] : '');
        setNotes(a.notes || '');
        setFieldValues(a.fields || {});
      } catch (e) {
        Alert.alert('Error', e.message || 'Failed to load asset');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [assetId]);

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
      if (Platform.OS !== 'web') Alert.alert('Updated', 'Asset saved.');
      router.replace({ pathname: `/asset/${assetId}` });
    } catch (e) {
      Alert.alert('Error', e.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const renderDynamic = (f) => {
    const slug = f.slug || normSlug(f.name);
    const typeCode = (f.field_type?.code || f.field_type?.slug || '').toLowerCase();
    const isReq = !!f.is_required;
    const Label = <Text style={styles.label}>{(f.label || f.name) || slug}{isReq ? ' *' : ''}</Text>;
    const items = (f.options || []).map(o => ({ label: String(o.label ?? o), value: (o.value ?? o) }));

    switch (typeCode) {
      case 'text':
      case 'textarea':
      case 'email':
      case 'url':
        return (
          <View key={slug} style={{ marginBottom: 12 }} onLayout={onLayoutFor(slug)}>
            {Label}
            <TextInput
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
      <KeyboardAwareScrollView
        ref={scrollRef}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        extraScrollHeight={80}
        enableOnAndroid
      >
        <View style={{ marginBottom: 20 }}>
          <TouchableOpacity onPress={() => router.replace({ pathname: `/asset/${assetId}` })} style={{ marginBottom: 10 }}>
            <Text style={{ color: '#1E90FF', fontWeight: 'bold', fontSize: 16 }}>{'< Back'}</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginTop: 5 }}>
            Edit Asset — {assetId}
          </Text>
        </View>

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
            style={styles.dropdown}
            dropDownContainerStyle={styles.dropdownContainer}
            nestedScrollEnabled
          />
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
            <Text style={{ color: nextServiceDate ? '#000' : '#888' }}>{nextServiceDate || 'Select Next Service Date'}</Text>
          </TouchableOpacity>
        </View>

        <View onLayout={onLayoutFor('date_purchased')}>
          <Text style={styles.label}>Date Purchased</Text>
          <TouchableOpacity style={styles.input} onPress={() => setDatePicker({ open: true, slug: '__date_purchased' })}>
            <Text style={{ color: datePurchased ? '#000' : '#888' }}>{datePurchased || 'Select Date Purchased'}</Text>
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
            style={styles.dropdown}
            dropDownContainerStyle={styles.dropdownContainer}
            nestedScrollEnabled
          />
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
        </View>

        <TouchableOpacity
          onPress={submit}
          disabled={saving}
          style={[styles.btn, styles.submit, saving && styles.submitDisabled]}
        >
          <Text style={{ color: '#fff' }}>{saving ? 'Saving...' : 'Save Changes'}</Text>
        </TouchableOpacity>
      </KeyboardAwareScrollView>

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

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: Platform.OS === 'ios' ? 20 : 0 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 5, padding: 12, marginVertical: 8, color: '#000' },
  label: { marginTop: 10, marginBottom: 6, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  btn: { backgroundColor: '#eee', padding: 15, alignItems: 'center', borderRadius: 5, marginVertical: 8 },
  submit: { backgroundColor: '#1E90FF' },
  submitDisabled: { opacity: 0.7, ...(Platform.OS === 'web' ? { cursor: 'not-allowed' } : null) },
  dropdown: { borderColor: '#ccc', marginBottom: 16 },
  dropdownContainer: { borderColor: '#ccc' },
  errorBelow: { marginTop: 4, color: '#b00020' },
});
