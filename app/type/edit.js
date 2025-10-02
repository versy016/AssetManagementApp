// app/(tabs)/type/edit.js
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
  Platform, Image, ScrollView, Switch, KeyboardAvoidingView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import DropDownPicker from 'react-native-dropdown-picker';
import { MaterialIcons } from '@expo/vector-icons';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import { auth } from '../../firebaseConfig';
import { getImageFileFromPicker } from '../../utils/getFormFileFromPicker';

// ---- Presets (must match how you created them originally) ----
const PRESET_LIBRARY = [
  { key: 'asset_life_years', label: 'Asset life (years)', fieldTypeSlug: 'number' },
  { key: 'warranty_terms', label: 'Warranty terms', fieldTypeSlug: 'textarea' },
  { key: 'last_serviced', label: 'Last serviced', fieldTypeSlug: 'date' },
  { key: 'home_location', label: 'Home location', fieldTypeSlug: 'text' },
  { key: 'vehicle_accessories', label: 'Vehicle Accessories', fieldTypeSlug: 'textarea' },
  { key: 'supplier', label: 'Supplier', fieldTypeSlug: 'text' },
  { key: 'purchase_price', label: 'Purchase price', fieldTypeSlug: 'currency' },
  { key: 'condition', label: 'Condition', fieldTypeSlug: 'select', options: ['New', 'Good', 'Fair', 'Poor'] },
  { key: 'warranty_expiry', label: 'Warranty expiry', fieldTypeSlug: 'date' },
  { key: 'maintenance_interval_days', label: 'Maintenance interval (days)', fieldTypeSlug: 'number' },
  { key: 'barcode_tag', label: 'Tag / Barcode', fieldTypeSlug: 'text' },
  { key: 'department', label: 'Department', fieldTypeSlug: 'text' },
];

function Square({ checked }) {
  return (
    <View style={[s.gridBox, checked ? s.gridBoxChecked : s.gridBoxUnchecked]}>
      {checked ? <Text style={s.gridTick}>✓</Text> : null}
    </View>
  );
}

export default function EditAssetType() {
  const { id } = useLocalSearchParams();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // type core
  const [name, setName] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [pickedImage, setPickedImage] = useState(null); // { uri, file }

  // field type catalog
  const [fieldTypes, setFieldTypes] = useState([]);
  const [loadingFieldTypes, setLoadingFieldTypes] = useState(true);

  // existing fields of this type (full objects from API)
  const [existingFields, setExistingFields] = useState([]);

  // presets state (preloaded to reflect existing)
  // structure: { [key]: { selected:boolean, required:boolean, fieldId?:string } }
  const [presetState, setPresetState] = useState(
    PRESET_LIBRARY.reduce((acc, p) => { acc[p.key] = { selected: false, required: false }; return acc; }, {})
  );

  // editable existing custom rows (NOT matching presets)
  const [editableCustom, setEditableCustom] = useState([]); // [{id,name,field_type_id,is_required,optionsCsv,dirty?:bool}]

  // queued brand-new custom fields (created on Save)
  const [newCustomQueue, setNewCustomQueue] = useState([]);
  const [addOpen, setAddOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [addModel, setAddModel] = useState({ name: '', field_type_id: null, is_required: false, optionsCsv: '' });

  // ------ Helpers ------
  const fieldTypeItems = useMemo(() => (
    fieldTypes.map(ft => ({
      label: `${ft.name}${ft.has_options ? ' (options)' : ''}`,
      value: ft.id,
      has_options: ft.has_options,
      slug: ft.slug,
    }))
  ), [fieldTypes]);

  const getFieldTypeById = (id) => fieldTypes.find(ft => ft.id === id);
  const slugToTypeId = (slug) => fieldTypes.find(ft => ft.slug === slug)?.id || null;
  const slugHasOptions = (slug) => !!fieldTypes.find(ft => ft.slug === slug)?.has_options;
  const pickImage = async () => { const res = await getImageFileFromPicker(); if (res) setPickedImage(res); };

  // Decide if a field from the server matches any preset
  // Priority 1: slug === preset.key
  // Priority 2: case-insensitive name equals preset.label AND field type slug matches
  function matchPresetKeyForField(field) {
    // direct slug match
    const k1 = PRESET_LIBRARY.find(p => (field.slug || '').toLowerCase() === p.key.toLowerCase());
    if (k1) return k1.key;

    // name + type match (fallback)
    const fType = getFieldTypeById(field.field_type_id);
    const fTypeSlug = fType?.slug;
    const k2 = PRESET_LIBRARY.find(p =>
      (field.name || '').trim().toLowerCase() === p.label.trim().toLowerCase() &&
      (!!fTypeSlug && fTypeSlug === p.fieldTypeSlug)
    );
    if (k2) return k2.key;

    return null;
  }

  // ------ Load ------
  useEffect(() => {
    if (!id) {
      Alert.alert('Error', 'Missing asset type id');
      router.replace('/Inventory?tab=types');
      return;
    }
    let live = true;

    (async () => {
      try {
        setLoading(true);
        setLoadingFieldTypes(true);

        // ensure catalog and fetch both
        await fetch(`${API_BASE_URL}/field-types/ensure-defaults`, { method: 'POST' }).catch(() => {});
        const [ftRes, typeRes] = await Promise.all([
          fetch(`${API_BASE_URL}/field-types`),
          fetch(`${API_BASE_URL}/asset-types/${id}?include=fields`)
        ]);

        if (!ftRes.ok) throw new Error(await ftRes.text());
        const ftData = await ftRes.json();
        const ftList = Array.isArray(ftData) ? ftData : (ftData?.data || []);
        if (!typeRes.ok) throw new Error(await typeRes.text());
        const tJson = await typeRes.json();
        const row = tJson?.data || tJson;

        if (!live) return;

        setFieldTypes(ftList);
        setName(row?.name || '');
        setImageUrl(row?.image_url || '');
        const fields = Array.isArray(row?.fields) ? row.fields : [];
        setExistingFields(fields);

        // 1) Pre-check presets from existing fields
        const nextPreset = PRESET_LIBRARY.reduce((acc, p) => {
          acc[p.key] = { selected: false, required: false };
          return acc;
        }, {});

        const customBucket = [];
        for (const f of fields) {
          const presetKey = matchPresetKeyForField(f);
          if (presetKey) {
            nextPreset[presetKey] = {
              selected: true,
              required: !!f.is_required,
              fieldId: f.id,
            };
          } else {
            customBucket.push(f);
          }
        }
        setPresetState(nextPreset);

        // 2) Populate editable custom with everything that didn't match a preset
        const editable = customBucket
          .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
          .map(f => ({
            id: f.id,
            name: f.name,
            field_type_id: f.field_type_id,
            is_required: !!f.is_required,
            optionsCsv: Array.isArray(f.options) ? f.options.join(', ') : '',
            dirty: false,
          }));
        setEditableCustom(editable);
      } catch (e) {
        Alert.alert('Error', e?.message || 'Failed to load asset type');
      } finally {
        if (live) {
          setLoading(false);
          setLoadingFieldTypes(false);
        }
      }
    })();

    return () => { live = false; };
  }, [id]);

  // ------ Custom row editing ------
  const updateCustomRow = (fieldId, patch) => {
    setEditableCustom(prev => prev.map(r => r.id === fieldId ? { ...r, ...patch, dirty: true } : r));
  };
  const saveCustomRow = async (row) => {
    try {
      const payload = {
        name: row.name,
        field_type_id: row.field_type_id,
        is_required: !!row.is_required,
      };
      const meta = getFieldTypeById(row.field_type_id);
      if (meta?.has_options) {
        payload.options = (row.optionsCsv || '').split(',').map(s => s.trim()).filter(Boolean);
      }
      const r = await fetch(`${API_BASE_URL}/asset-types/${id}/fields/${row.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || 'Failed to update field');
      }
      Alert.alert('Saved', `Updated "${row.name}"`);
      setEditableCustom(prev => prev.map(x => x.id === row.id ? { ...x, dirty: false } : x));
    } catch (e) {
      Alert.alert('Error', e.message || 'Update failed');
    }
  };
  const deleteCustomRow = async (row) => {
    try {
      const ok = Platform.OS === 'web'
        ? window.confirm(`Delete field "${row.name}"?`)
        : await new Promise(res => Alert.alert('Delete field', `Delete "${row.name}"?`, [
            { text: 'Cancel', style: 'cancel', onPress: () => res(false) },
            { text: 'Delete', style: 'destructive', onPress: () => res(true) },
          ]));
      if (!ok) return;

      const r = await fetch(`${API_BASE_URL}/asset-types/${id}/fields/${row.id}`, { method: 'DELETE' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error || body?.message || 'Delete failed');
      setEditableCustom(prev => prev.filter(x => x.id !== row.id));
      Alert.alert('Deleted', `"${row.name}" removed`);
    } catch (e) {
      Alert.alert('Error', e.message || 'Delete failed');
    }
  };

  // ------ Add new custom field (queue) ------
  const queueNewCustom = () => {
    // Before queuing, if user typed a name that exactly matches a preset AND type matches,
    // auto-check the preset instead of queuing custom (your request).
    const typedName = (addModel.name || '').trim().toLowerCase();
    const addTypeSlug = getFieldTypeById(addModel.field_type_id)?.slug;

    const matchingPreset = PRESET_LIBRARY.find(p =>
      typedName === p.label.trim().toLowerCase() &&
      (!!addTypeSlug && addTypeSlug === p.fieldTypeSlug)
    );

    if (matchingPreset) {
      setPresetState(ps => ({
        ...ps,
        [matchingPreset.key]: {
          selected: true,
          required: !!addModel.is_required,
          // fieldId will be undefined; Save will CREATE this preset field
        }
      }));
      setAddModel({ name: '', field_type_id: null, is_required: false, optionsCsv: '' });
      setAddOpen(false);
      setPickerOpen(false);
      return;
    }

    if (!addModel.name.trim() || !addModel.field_type_id) {
      return Alert.alert('Missing info', 'Please select a field type and enter a field name.');
    }

    setNewCustomQueue(prev => ([
      ...prev,
      {
        id: `__new__${Date.now()}`,
        name: addModel.name.trim(),
        field_type_id: addModel.field_type_id,
        is_required: !!addModel.is_required,
        optionsCsv: (addModel.optionsCsv || ''),
      }
    ]));
    setAddModel({ name: '', field_type_id: null, is_required: false, optionsCsv: '' });
    setAddOpen(false);
    setPickerOpen(false);
  };
  const removeQueuedCustom = (qid) => setNewCustomQueue(prev => prev.filter(f => f.id !== qid));

  // ------ Preset toggles ------
  const togglePresetSelected = (key) => setPresetState(p => ({ ...p, [key]: { ...p[key], selected: !p[key].selected } }));
  const togglePresetRequired = (key) => setPresetState(p => ({ ...p, [key]: { ...p[key], required: !p[key].required } }));

  // ------ Save all ------
  const handleSave = async () => {
    if (!name.trim()) return Alert.alert('Validation', 'Name is required');

    setSaving(true);
    try {
      // (A) Update core (name/image)
      let resCore;
      if (pickedImage?.file) {
        const fd = new FormData();
        fd.append('name', name.trim());
        fd.append('image', pickedImage.file, pickedImage.file.name || 'upload.jpg');
        resCore = await fetch(`${API_BASE_URL}/asset-types/${id}`, { method: 'PUT', body: fd, headers: { ...(auth.currentUser?.uid ? { 'X-User-Id': auth.currentUser.uid } : {}) } });
      } else {
        resCore = await fetch(`${API_BASE_URL}/asset-types/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...(auth.currentUser?.uid ? { 'X-User-Id': auth.currentUser.uid } : {}) },
          body: JSON.stringify({ name: name.trim(), image_url: imageUrl || null }),
        });
      }
      const coreBody = await resCore.json().catch(() => ({}));
      if (!resCore.ok) throw new Error(coreBody?.message || 'Failed to update asset type');

      // (B) Diff presets against existing fields
      const existingBySlug = Object.fromEntries(existingFields.map(f => [f.slug, f]));
      const presetErrors = [];

      for (const p of PRESET_LIBRARY) {
        const state = presetState[p.key] || { selected: false, required: false };
        const exists = !!existingBySlug[p.key];

        // CREATE if selected but not exists
        if (state.selected && !exists) {
          const ftId = slugToTypeId(p.fieldTypeSlug);
          if (!ftId) { presetErrors.push(`${p.label}: field type missing`); continue; }
          const payload = {
            name: p.label,
            field_type_id: ftId,
            is_required: !!state.required,
            display_order: (existingFields?.length || 0) + 50,
          };
          if (p.options && slugHasOptions(p.fieldTypeSlug)) payload.options = p.options;
          const r = await fetch(`${API_BASE_URL}/asset-types/${id}/fields`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(auth.currentUser?.uid ? { 'X-User-Id': auth.currentUser.uid } : {}) },
            body: JSON.stringify(payload),
          });
          if (!r.ok) presetErrors.push(`${p.label}: ${await r.text() || 'Failed to create'}`);
        }

        // UPDATE required if exists and changed
        if (state.selected && exists) {
          const old = existingBySlug[p.key];
          if (!!old.is_required !== !!state.required) {
            const r = await fetch(`${API_BASE_URL}/asset-types/${id}/fields/${old.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', ...(auth.currentUser?.uid ? { 'X-User-Id': auth.currentUser.uid } : {}) },
              body: JSON.stringify({ is_required: !!state.required }),
            });
            if (!r.ok) presetErrors.push(`${p.label}: ${await r.text() || 'Failed to update'}`);
          }
        }

        // DELETE if not selected but existed
        if (!state.selected && exists) {
          const old = existingBySlug[p.key];
          const r = await fetch(`${API_BASE_URL}/asset-types/${id}/fields/${old.id}`, { method: 'DELETE', headers: { ...(auth.currentUser?.uid ? { 'X-User-Id': auth.currentUser.uid } : {}) } });
          if (!r.ok) presetErrors.push(`${p.label}: ${await r.text() || 'Failed to delete (may have values)'}`);
        }
      }

      // (C) Create queued brand-new custom fields
      const newErrors = [];
      for (const q of newCustomQueue) {
        const meta = getFieldTypeById(q.field_type_id);
        const payload = {
          name: q.name,
          field_type_id: q.field_type_id,
          is_required: !!q.is_required,
          display_order: (existingFields?.length || 0) + 100,
        };
        if (meta?.has_options) {
          payload.options = (q.optionsCsv || '').split(',').map(s => s.trim()).filter(Boolean);
        }
        const r = await fetch(`${API_BASE_URL}/asset-types/${id}/fields`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(auth.currentUser?.uid ? { 'X-User-Id': auth.currentUser.uid } : {}) },
          body: JSON.stringify(payload),
        });
        if (!r.ok) newErrors.push(`${q.name}: ${await r.text() || 'Failed to create'}`);
      }

      if (presetErrors.length || newErrors.length) {
        Alert.alert('Saved with warnings', [...presetErrors, ...newErrors].slice(0, 8).join('\n'));
      } else if (Platform.OS !== 'web') {
        Alert.alert('Saved', 'Asset type updated');
      }

      router.replace('/Inventory?tab=types');
    } catch (e) {
      Alert.alert('Error', e.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteType = () => new Promise((resolve) => {
    if (Platform.OS === 'web') return resolve(window.confirm('Delete this asset type? This cannot be undone.'));
    Alert.alert('Delete asset type', 'This cannot be undone. Continue?', [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
  const handleDelete = async () => {
    const ok = await confirmDeleteType();
    if (!ok) return;
    try {
      const res = await fetch(`${API_BASE_URL}/asset-types/${id}`, { method: 'DELETE', headers: { ...(auth.currentUser?.uid ? { 'X-User-Id': auth.currentUser.uid } : {}) } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || body?.error || 'Delete failed');
      if (Platform.OS !== 'web') Alert.alert('Deleted', 'Asset type removed');
      router.replace('/Inventory?tab=types');
    } catch (e) {
      Alert.alert('Error', e.message || 'Delete failed');
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator size="large" />
        <Text style={{ marginTop: 10 }}>Loading type…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.replace('/Inventory?tab=types')} style={{ paddingRight: 8 }}>
          <MaterialIcons name="arrow-back" size={24} color="#1E90FF" />
        </TouchableOpacity>
        <Text style={s.title}>Edit Asset Type</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
          {/* Type core */}
          <Text style={s.label}>Name *</Text>
          <TextInput style={s.input} placeholder="Type name" value={name} onChangeText={setName} />

          <Text style={s.label}>Image URL</Text>
          <TextInput style={s.input} placeholder="https://…" value={imageUrl} onChangeText={setImageUrl} autoCapitalize="none" />

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity style={[s.btn]} onPress={pickImage}>
              <Text>{pickedImage ? 'Change Image (local)' : 'Pick Image (optional)'}</Text>
            </TouchableOpacity>
            {pickedImage?.uri ? <Image source={{ uri: pickedImage.uri }} style={s.previewThumb} /> : null}
          </View>

          {/* Presets grid — prefilled from existing */}
          <View style={{ marginTop: 24 }}>
            <Text style={s.sectionTitle}>Add / remove preset fields</Text>
            <View style={s.grid}>
              {PRESET_LIBRARY.map((p) => {
                const state = presetState[p.key] || { selected: false, required: false };
                const checked = !!state.selected;
                const required = !!state.required;
                return (
                  <View key={p.key} style={s.gridItem}>
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
                      onPress={() => togglePresetSelected(p.key)}
                      activeOpacity={0.8}
                    >
                      <Square checked={checked} />
                      <Text style={s.gridLabel}>{p.label}</Text>
                    </TouchableOpacity>
                    <View style={s.reqWrap}>
                      <Text style={s.reqLabel}>Required</Text>
                      <Switch
                        value={required}
                        onValueChange={() => togglePresetRequired(p.key)}
                        disabled={!checked}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Existing custom fields (editable) */}
          <View style={{ marginTop: 24 }}>
            <Text style={s.sectionTitle}>Existing custom fields</Text>
            {editableCustom.length === 0 ? (
              <Text style={{ color: '#777', marginTop: 6 }}>No custom fields.</Text>
            ) : null}

            {editableCustom.map((row) => {
              const typeMeta = getFieldTypeById(row.field_type_id);
              const needsOptions = !!typeMeta?.has_options;
              return (
                <View key={row.id} style={s.card}>
                  <Text style={s.cardTitle}>Field • {row.name}</Text>

                  <Text style={s.subLabel}>Field name</Text>
                  <TextInput
                    style={s.input}
                    value={row.name}
                    onChangeText={(t) => updateCustomRow(row.id, { name: t })}
                  />

                  <Text style={s.subLabel}>Field type</Text>
                  <View style={{ zIndex: 2000 }}>
                    <DropDownPicker
                      open={row.__open || false}
                      value={row.field_type_id}
                      items={fieldTypeItems}
                      setOpen={(o) => updateCustomRow(row.id, { __open: o })}
                      setValue={(cb) => {
                        const newVal = cb(row.field_type_id);
                        updateCustomRow(row.id, { field_type_id: newVal });
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
                      value={!!row.is_required}
                      onValueChange={(v) => updateCustomRow(row.id, { is_required: v })}
                    />
                  </View>

                  {needsOptions && (
                    <>
                      <Text style={s.subLabel}>Options (comma-separated)</Text>
                      <TextInput
                        style={s.input}
                        value={row.optionsCsv}
                        onChangeText={(t) => updateCustomRow(row.id, { optionsCsv: t })}
                        placeholder="e.g. 110V, 240V"
                        autoCapitalize="none"
                      />
                    </>
                  )}

                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                    <TouchableOpacity style={[s.btn, { flex: 1 }]} onPress={() => deleteCustomRow(row)}>
                      <Text style={{ color: '#b00020', fontWeight: '700' }}>Remove</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.btn, s.submit, { flex: 1, opacity: row.dirty ? 1 : 0.7 }]}
                      onPress={() => saveCustomRow(row)}
                      disabled={!row.dirty}
                    >
                      <Text style={{ color: '#fff' }}>Save field</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>

          {/* Add new custom field */}
          <View style={{ marginTop: 24 }}>
            <Text style={s.sectionTitle}>Add custom field</Text>

            {loadingFieldTypes ? (
              <View style={{ paddingVertical: 12 }}>
                <ActivityIndicator />
                <Text style={{ textAlign: 'center', marginTop: 8 }}>Loading field types…</Text>
              </View>
            ) : null}

            {addOpen ? (
              <View style={[s.card, { marginTop: 8 }]}>
                <Text style={s.cardTitle}>New field</Text>

                <Text style={s.subLabel}>Field name</Text>
                <TextInput
                  style={s.input}
                  value={addModel.name}
                  onChangeText={(t) => setAddModel(m => ({ ...m, name: t }))}
                  placeholder="e.g. Voltage"
                />

                <Text style={s.subLabel}>Field type</Text>
                <View style={{ zIndex: 2000 }}>
                  <DropDownPicker
                    open={pickerOpen}
                    value={addModel.field_type_id}
                    items={fieldTypeItems}
                    setOpen={setPickerOpen}
                    setValue={(cb) => {
                      const v = cb(addModel.field_type_id);
                      setAddModel(m => ({ ...m, field_type_id: v }));
                    }}
                    placeholder="Select a field type"
                    style={s.dropdown}
                    dropDownContainerStyle={s.dropdownContainer}
                    listMode="SCROLLVIEW"
                  />
                </View>

                <View style={s.switchRow}>
                  <Text style={s.subLabel}>Required</Text>
                  <Switch value={!!addModel.is_required} onValueChange={(v) => setAddModel(m => ({ ...m, is_required: v }))} />
                </View>

                {!!fieldTypeItems.find(it => it.value === addModel.field_type_id)?.has_options && (
                  <>
                    <Text style={s.subLabel}>Options (comma-separated)</Text>
                    <TextInput
                      style={s.input}
                      value={addModel.optionsCsv}
                      onChangeText={(t) => setAddModel(m => ({ ...m, optionsCsv: t }))}
                      placeholder="e.g. 110V, 240V"
                      autoCapitalize="none"
                    />
                  </>
                )}

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                  <TouchableOpacity style={[s.btn, { flex: 1 }]} onPress={() => { setAddOpen(false); setPickerOpen(false); }}>
                    <Text>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.btn, s.submit, { flex: 1 }]} onPress={queueNewCustom}>
                    <Text style={{ color: '#fff' }}>Queue field</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity style={[s.btn, { marginTop: 10 }]} onPress={() => setAddOpen(true)}>
                <Text>+ Add Field</Text>
              </TouchableOpacity>
            )}

            {/* queued */}
            {newCustomQueue.map(q => (
              <View key={q.id} style={[s.card, { marginTop: 8 }]}>
                <Text style={s.cardTitle}>{q.name}</Text>
                <Text style={{ color: '#666' }}>
                  {getFieldTypeById(q.field_type_id)?.name || q.field_type_id}
                  {q.is_required ? ' • Required' : ''}
                </Text>
                {!!q.optionsCsv?.trim() && (
                  <Text style={{ color: '#666', marginTop: 4 }}>Options: {q.optionsCsv}</Text>
                )}
                <TouchableOpacity onPress={() => removeQueuedCustom(q.id)} style={[s.btn, { marginTop: 8 }]}>
                  <Text style={{ color: '#b00020', fontWeight: '700' }}>Remove from queue</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>

          <View style={{ height: 80 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Bottom actions */}
      <View style={s.bottomBar}>
        <TouchableOpacity onPress={handleDelete} style={[s.actionBtn, s.deleteBtn]} accessibilityRole="button">
          <MaterialIcons name="delete" size={18} color="#fff" style={{ marginRight: 6 }} />
          <Text style={s.actionText}>Delete</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleSave}
          disabled={saving}
          style={[s.actionBtn, s.saveBtn, saving && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityState={{ disabled: saving, busy: saving }}
        >
          <MaterialIcons name="save" size={18} color="#fff" style={{ marginRight: 6 }} />
          <Text style={s.actionText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomColor: '#eee', borderBottomWidth: 1, backgroundColor: '#fff',
  },
  title: { fontSize: 18, fontWeight: 'bold', color: '#1E90FF', marginLeft: 8 },
  container: { padding: 20 },
  label: { fontWeight: '600', marginTop: 10 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 10, padding: 12, marginTop: 6, color: '#000' },
  btn: { backgroundColor: '#eee', padding: 15, alignItems: 'center', borderRadius: 8, marginVertical: 8 },
  submit: { backgroundColor: '#1E90FF' },
  previewThumb: { width: 44, height: 44, borderRadius: 6, alignSelf: 'center' },
  sectionTitle: { fontSize: 18, fontWeight: '700' },

  // existing/custom cards
  card: { borderWidth: 1, borderColor: '#E6E6E6', borderRadius: 12, padding: 12, marginTop: 8, backgroundColor: '#FAFAFA' },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  subLabel: { fontSize: 14, fontWeight: '600', marginTop: 8, marginBottom: 4 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  dropdown: { borderColor: '#ccc', borderRadius: 8, marginTop: 4 },
  dropdownContainer: { borderColor: '#ccc' },

  // presets grid
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
  reqWrap: { marginLeft: 'auto', alignItems: 'center' },
  reqLabel: { fontSize: 11, color: '#516B8E', marginBottom: 4 },

  // bottom bar
  bottomBar: {
    flexDirection: 'row', gap: 10, padding: 16,
    borderTopWidth: 1, borderTopColor: '#eee', backgroundColor: '#fff',
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, borderRadius: 10,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, elevation: 2,
  },
  saveBtn: { backgroundColor: '#1E90FF' },
  deleteBtn: { backgroundColor: '#b00020' },
  actionText: { color: '#fff', fontWeight: '700' },
  center: { flex: 1, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
});
