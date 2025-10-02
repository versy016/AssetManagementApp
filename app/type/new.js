// app/(tabs)/types/new.js
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Image, ScrollView,
  Alert, ActivityIndicator, Switch, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../firebaseConfig';
import { SafeAreaView } from 'react-native-safe-area-context';
import DropDownPicker from 'react-native-dropdown-picker';
import { getImageFileFromPicker } from '../../utils/getFormFileFromPicker';
import { API_BASE_URL } from '../../inventory-api/apiBase';

// ---- Default fields (always present on assets) -----------------------------
const DEFAULT_FIELDS = [
  { slug: 'serial_number',     label: 'Serial Number' },
  { slug: 'model',             label: 'Model' },
  { slug: 'description',       label: 'Description' },
  { slug: 'status',            label: 'Status' },
  { slug: 'next_service_date', label: 'Next Service Date' },
  { slug: 'documentation_url', label: 'Documentation URL' },
  { slug: 'image_url',         label: 'Image URL' },
  { slug: 'last_updated',      label: 'Last Updated (system)' },
  { slug: 'last_changed_by',   label: 'Last Changed By (system)' },
  { slug: 'location',          label: 'Location' },
  { slug: 'id',                label: 'Asset ID (system)' },
  { slug: 'date_purchased',    label: 'Date Purchased' },
  { slug: 'notes',             label: 'Notes' },
];

// ---- Pick-from-library presets (2-column checklist) ------------------------
// fieldTypeSlug must match your field_types.slug values
const PRESET_LIBRARY = [
  // Yours
  { key: 'asset_life_years', label: 'Asset life (years)', fieldTypeSlug: 'number' },
  { key: 'warranty_terms', label: 'Warranty terms', fieldTypeSlug: 'textarea' },
  { key: 'last_serviced', label: 'Last serviced', fieldTypeSlug: 'date' },
  { key: 'vehicle_accessories', label: 'Vehicle Accessories', fieldTypeSlug: 'textarea' },
  // Suggestions
  { key: 'supplier', label: 'Supplier', fieldTypeSlug: 'text' },
  { key: 'purchase_price', label: 'Purchase price', fieldTypeSlug: 'currency' },
  { key: 'condition', label: 'Condition', fieldTypeSlug: 'select', options: ['New', 'Good', 'Fair', 'Poor'] },
  { key: 'warranty_expiry', label: 'Warranty expiry', fieldTypeSlug: 'date' },
];

function DefaultFieldRow({ label }) {
  return (
    <View style={s.defaultRow}>
      <View style={s.checkboxDisabled}><Text style={s.checkboxTick}>✓</Text></View>
      <Text style={s.defaultRowLabel}>{label}</Text>
    </View>
  );
}

// Small reusable checkbox (list row)
function BlueCheckbox({ value, onToggle, label, right }) {
  return (
    <TouchableOpacity style={s.checkboxRow} onPress={onToggle} activeOpacity={0.8}>
      <View style={[s.checkboxBox, value ? s.checkboxBoxChecked : s.checkboxBoxUnchecked]}>
        {value ? <Text style={s.checkboxBoxTick}>✓</Text> : null}
      </View>
      <Text style={s.checkboxRowLabel}>{label}</Text>
      {right}
    </TouchableOpacity>
  );
}

// Small square checkbox (grid cell)
function SquareCheckbox({ checked }) {
  return (
    <View style={[s.gridBox, checked ? s.gridBoxChecked : s.gridBoxUnchecked]}>
      {checked ? <Text style={s.gridTick}>✓</Text> : null}
    </View>
  );
}

export default function NewAssetType() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [checking, setChecking] = useState(true);

  // Type basics
  const [name, setName] = useState('');
  const [image, setImage] = useState(null); // { uri, file }
  const [submitting, setSubmitting] = useState(false);

  // Field types from API
  const [fieldTypes, setFieldTypes] = useState([]);
  const [loadingFieldTypes, setLoadingFieldTypes] = useState(true);

  // Saved custom fields (manually added via editor)
  const [fields, setFields] = useState([]);

  // Preset selections: key -> { selected: boolean, required: boolean }
  const [presetState, setPresetState] = useState(
    PRESET_LIBRARY.reduce((acc, p) => {
      acc[p.key] = { selected: false, required: false };
      return acc;
    }, {})
  );

  // “Editor” state (only shown when adding)
  const [editingOpen, setEditingOpen] = useState(false);
  const [editing, setEditing] = useState({ name: '', field_type_id: null, is_required: false, optionsCsv: '' });
  const [pickerOpen, setPickerOpen] = useState(false);

  // Admin gate via DB role
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

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingFieldTypes(true);
        await fetch(`${API_BASE_URL}/field-types/ensure-defaults`, { method: 'POST' }).catch(() => {});
        const r = await fetch(`${API_BASE_URL}/field-types`);
        if (!r.ok) throw new Error(await r.text());
        const data = await r.json();
        if (alive) setFieldTypes(Array.isArray(data) ? data : data?.data || []);
      } catch (e) {
        console.error('Field types load error:', e);
        Alert.alert('Error', 'Failed to load field types.');
      } finally {
        if (alive) setLoadingFieldTypes(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const fieldTypeItems = useMemo(() => (
    fieldTypes.map(ft => ({
      label: `${ft.name}${ft.has_options ? ' (options)' : ''}`,
      value: ft.id,
      has_options: ft.has_options,
      slug: ft.slug,
    }))
  ), [fieldTypes]);

  const slugToTypeId = (slug) => fieldTypes.find(ft => ft.slug === slug)?.id || null;
  const slugHasOptions = (slug) => !!fieldTypes.find(ft => ft.slug === slug)?.has_options;

  const selectedTypeMeta = useMemo(
    () => fieldTypeItems.find(it => it.value === editing.field_type_id),
    [fieldTypeItems, editing.field_type_id]
  );
  const selectedTypeRequiresOptions = !!selectedTypeMeta?.has_options;

  const pickImage = async () => {
    const result = await getImageFileFromPicker();
    if (result) setImage(result);
  };

  // Preset grid toggles
  const togglePresetSelected = (key) => {
    setPresetState(prev => ({ ...prev, [key]: { ...prev[key], selected: !prev[key].selected } }));
  };
  const togglePresetRequired = (key) => {
    setPresetState(prev => ({ ...prev, [key]: { ...prev[key], required: !prev[key].required } }));
  };

  // Open/close editor
  const openEditor = () => {
    setEditing({ name: '', field_type_id: null, is_required: false, optionsCsv: '' });
    setPickerOpen(false);
    setEditingOpen(true);
  };
  const cancelEditor = () => { setEditingOpen(false); setPickerOpen(false); };

  // Save editor → add to list, close editor
  const saveEditor = () => {
    const trimmed = editing.name.trim();
    if (!trimmed || !editing.field_type_id) {
      return Alert.alert('Missing info', 'Please select a field type and enter a field name.');
    }
    setFields(prev => ([
      ...prev,
      {
        id: `f-${Date.now()}`,
        enabled: true,
        name: trimmed,
        field_type_id: editing.field_type_id,
        is_required: !!editing.is_required,
        optionsCsv: (editing.optionsCsv || '').trim(),
      }
    ]));
    cancelEditor();
  };

  const toggleFieldEnabled = (id) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, enabled: !f.enabled } : f));
  };
  const removeField = (id) => setFields(prev => prev.filter(f => f.id !== id));

  const handleSubmit = async () => {
    if (!name.trim()) return Alert.alert('Missing field', 'Please enter a name.');
    if (editingOpen) return Alert.alert('Finish field', 'Please save or cancel the field you are adding first.');

    setSubmitting(true);
    try {
      // 1) Create type (image optional)
      const form = new FormData();
      form.append('name', name.trim());
      if (image?.file) form.append('image', image.file);
      const uid = auth.currentUser?.uid;
      const headers = uid ? { 'X-User-Id': uid } : {};
      const createTypeRes = await fetch(`${API_BASE_URL}/asset-types`, { method: 'POST', body: form, headers });
      if (!createTypeRes.ok) throw new Error(await createTypeRes.text() || 'Failed to create asset type');
      const created = await createTypeRes.json();
      const newType = created?.data || created?.assetType || created;
      const typeId = newType?.id;
      if (!typeId) throw new Error('Type created, but no id returned');

      // 2) Combine preset selections (with required state) + manual fields
      const selectedPresetKeys = PRESET_LIBRARY.filter(p => presetState[p.key]?.selected).map(p => p.key);

      const presetPayloads = selectedPresetKeys.map((key, i) => {
        const p = PRESET_LIBRARY.find(x => x.key === key);
        const typeIdMapped = slugToTypeId(p.fieldTypeSlug);
        if (!typeIdMapped) return null;
        const payload = {
          name: p.label,
          field_type_id: typeIdMapped,
          is_required: !!presetState[key]?.required, // <-- REQUIRED from toggle
          display_order: i,
        };
        if (p.options && slugHasOptions(p.fieldTypeSlug)) payload.options = p.options;
        return payload;
      }).filter(Boolean);

      const manualPayloads = fields
        .filter(f => f.enabled && f.name && f.field_type_id)
        .map((f, idx) => {
          const meta = fieldTypes.find(ft => ft.id === f.field_type_id);
          const payload = {
            name: f.name,
            field_type_id: f.field_type_id,
            is_required: !!f.is_required,
            display_order: presetPayloads.length + idx,
          };
          if (meta?.has_options) {
            payload.options = (f.optionsCsv || '').split(',').map(s => s.trim()).filter(Boolean);
          }
          return payload;
        });

      const toCreate = [...presetPayloads, ...manualPayloads];

      if (toCreate.length === 0) {
        Alert.alert('Success', 'Asset type created successfully');
        return router.replace({ pathname: '/Inventory', params: { tab: 'types' } });
      }

      const errors = [];
      for (const payload of toCreate) {
        const r = await fetch(`${API_BASE_URL}/assets/asset-types/${typeId}/fields`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(auth.currentUser?.uid ? { 'X-User-Id': auth.currentUser.uid } : {}) },
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          const t = await r.text();
          errors.push(`${payload.name}: ${t || 'Failed'}`);
        }
      }

      if (errors.length) {
        Alert.alert('Type created, some fields failed', errors.slice(0, 6).join('\n'));
      } else {
        Alert.alert('Success', 'Asset type and fields created successfully');
      }
      router.replace({ pathname: '/Inventory', params: { tab: 'types' } });
    } catch (err) {
      console.error('Create asset type error:', err);
      Alert.alert('Error', err.message || 'Failed to create asset type');
    } finally {
      setSubmitting(false);
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
        <TouchableOpacity onPress={() => router.replace('/Inventory')} style={{ padding: 12, borderRadius: 8, backgroundColor: '#0B63CE' }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.replace({ pathname: '/Inventory', params: { tab: 'types' } })} style={{ marginBottom: 10 }}>
            <Text style={{ color: '#1E90FF', fontWeight: 'bold', fontSize: 16 }}>{'< Back'}</Text>
          </TouchableOpacity>

          <Text style={s.title}>Create New Asset Type</Text>

          {/* Type name */}
          <Text style={s.label}>Name</Text>
          <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Enter asset type name" autoCapitalize="words" />

          {/* Type image */}
          <TouchableOpacity style={s.btn} onPress={pickImage}>
            <Text>{image ? 'Change Image' : 'Pick Image (optional)'}</Text>
          </TouchableOpacity>
          {image?.uri && <Image source={{ uri: image.uri }} style={s.preview} />}

          {/* Default (always included) */}
          <View style={{ marginTop: 24 }}>
            <Text style={[s.label, { fontSize: 18 }]}>Default fields (always included)</Text>
            <View style={s.defaultList}>
              {DEFAULT_FIELDS.map(f => <DefaultFieldRow key={f.slug} label={f.label} />)}
            </View>
          </View>

          {/* Pick from library (2-column checklist with Required toggles) */}
          <View style={{ marginTop: 24 }}>
            <Text style={[s.label, { fontSize: 18 }]}>Pick from library</Text>
            <View style={s.grid}>
              {PRESET_LIBRARY.map((p) => {
                const state = presetState[p.key];
                const checked = !!state?.selected;
                const required = !!state?.required;
                return (
                  <View key={p.key} style={s.gridItem}>
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
                      onPress={() => togglePresetSelected(p.key)}
                      activeOpacity={0.8}
                    >
                      <SquareCheckbox checked={checked} />
                      <Text style={s.gridLabel}>{p.label}</Text>
                    </TouchableOpacity>
                    <View style={s.reqWrap}>
                      <Text style={s.reqLabel}>Required</Text>
                      <Switch value={required} onValueChange={() => togglePresetRequired(p.key)} />
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Custom fields (saved list + editor) */}
          <View style={{ marginTop: 24 }}>
            <Text style={[s.label, { fontSize: 18 }]}>Custom fields</Text>

            {loadingFieldTypes && (
              <View style={{ paddingVertical: 12 }}>
                <ActivityIndicator />
                <Text style={{ textAlign: 'center', marginTop: 8 }}>Loading field types…</Text>
              </View>
            )}

            {/* Saved custom fields */}
            {fields.map((f) => {
              const meta = fieldTypeItems.find(it => it.value === f.field_type_id);
              const subtitle = meta ? ` • ${meta.label}` : '';
              return (
                <BlueCheckbox
                  key={f.id}
                  value={!!f.enabled}
                  onToggle={() => toggleFieldEnabled(f.id)}
                  label={`${f.name}${subtitle}`}
                  right={
                    <TouchableOpacity onPress={() => removeField(f.id)} style={{ marginLeft: 'auto' }}>
                      <Text style={{ color: '#FF5555', fontWeight: '600' }}>Remove</Text>
                    </TouchableOpacity>
                  }
                />
              );
            })}

            {/* Inline editor */}
            {editingOpen && (
              <View style={[s.card, { marginTop: 8 }]}>
                <Text style={s.cardTitle}>New field</Text>

                <Text style={s.subLabel}>Field name</Text>
                <TextInput
                  style={s.input}
                  value={editing.name}
                  onChangeText={(t) => setEditing(e => ({ ...e, name: t }))}
                  placeholder="e.g. Voltage"
                />

                <Text style={s.subLabel}>Field type</Text>
                <View style={{ zIndex: 2000, elevation: 2000 }}>
                  <DropDownPicker
                    open={pickerOpen}
                    value={editing.field_type_id}
                    items={fieldTypeItems}
                    setOpen={setPickerOpen}
                    setValue={(callback) => {
                      const val = callback(editing.field_type_id);
                      setEditing(e => ({ ...e, field_type_id: val }));
                    }}
                    placeholder="Select a field type"
                    style={s.dropdown}
                    dropDownContainerStyle={s.dropdownContainer}
                    listMode="SCROLLVIEW"
                  />
                </View>

                <View style={s.switchRow}>
                  <Text style={s.subLabel}>Required</Text>
                  <Switch
                    value={!!editing.is_required}
                    onValueChange={(v) => setEditing(e => ({ ...e, is_required: v }))}
                  />
                </View>

                {selectedTypeRequiresOptions && (
                  <>
                    <Text style={s.subLabel}>Options (comma-separated)</Text>
                    <TextInput
                      style={s.input}
                      value={editing.optionsCsv}
                      onChangeText={(t) => setEditing(e => ({ ...e, optionsCsv: t }))}
                      placeholder="e.g. 110V, 240V"
                      autoCapitalize="none"
                    />
                  </>
                )}

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                  <TouchableOpacity style={[s.btn, { flex: 1 }]} onPress={cancelEditor}>
                    <Text>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.btn, s.submit, { flex: 1 }]} onPress={saveEditor}>
                    <Text style={{ color: '#fff' }}>Save field</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {!editingOpen && (
              <TouchableOpacity style={[s.btn, { marginTop: 10 }]} onPress={openEditor}>
                <Text>+ Add Field</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Submit */}
          <TouchableOpacity style={[s.btn, s.submit, { marginTop: 16 }]} onPress={handleSubmit} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff' }}>Create Asset Type</Text>}
          </TouchableOpacity>

          <View style={{ height: 24 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { padding: 20 },
  title: { fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 20 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, marginVertical: 8, justifyContent: 'center' },
  btn: { backgroundColor: '#eee', padding: 15, alignItems: 'center', borderRadius: 8, marginVertical: 8 },
  submit: { backgroundColor: '#1E90FF' },
  preview: { width: '100%', height: 200, borderRadius: 8, marginVertical: 10 },
  label: { fontSize: 16, fontWeight: 'bold', marginBottom: 5 },
  subLabel: { fontSize: 14, fontWeight: '600', marginTop: 8, marginBottom: 4 },
  card: { borderWidth: 1, borderColor: '#E6E6E6', borderRadius: 12, padding: 12, marginBottom: 12, backgroundColor: '#FAFAFA' },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  dropdown: { borderColor: '#ccc', borderRadius: 8, marginTop: 4 },
  dropdownContainer: { borderColor: '#ccc' },

  // Default-fields UI
  defaultList: { marginTop: 8, borderRadius: 12, backgroundColor: '#FAFAFA', borderWidth: 1, borderColor: '#E6E6E6' },
  defaultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#EFEFEF' },
  defaultRowLabel: { marginLeft: 10, color: '#666', fontSize: 15 },
  checkboxDisabled: { width: 20, height: 20, borderRadius: 4, backgroundColor: '#E0E0E0', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#C9C9C9' },
  checkboxTick: { color: '#8C8C8C', fontSize: 14, lineHeight: 16, fontWeight: 'bold' },

  // Blue checkbox rows (saved custom list)
  checkboxRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 12,
    borderWidth: 1, borderColor: '#E6E6E6', borderRadius: 10,
    backgroundColor: '#F9FBFF', marginTop: 8,
  },
  checkboxRowLabel: { marginLeft: 10, fontSize: 14, fontWeight: '600', color: '#1E90FF' },
  checkboxBox: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  checkboxBoxChecked: { borderColor: '#1E90FF', backgroundColor: '#1E90FF' },
  checkboxBoxUnchecked: { borderColor: '#1E90FF', backgroundColor: 'transparent' },
  checkboxBoxTick: { color: '#fff', fontWeight: 'bold', fontSize: 14, lineHeight: 16 },

  // Grid (preset library)
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  gridItem: {
    width: '48%', borderWidth: 1, borderColor: '#E6E6E6', borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#FBFBFB',
    flexDirection: 'row', alignItems: 'center',
  },
  gridLabel: { marginLeft: 10, fontSize: 14, color: '#333', flexShrink: 1 },
  gridBox: { width: 18, height: 18, borderRadius: 4, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  gridBoxChecked: { borderColor: '#1E90FF', backgroundColor: '#1E90FF' },
  gridBoxUnchecked: { borderColor: '#C5DFFF', backgroundColor: 'transparent' },
  gridTick: { color: '#fff', fontSize: 12, fontWeight: 'bold', lineHeight: 12 },

  // Required toggle on grid item
  reqWrap: { marginLeft: 'auto', alignItems: 'center' },
  reqLabel: { fontSize: 11, color: '#516B8E', marginBottom: 4 },
});
