// app/(tabs)/type/edit.js
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
  Image,
  ScrollView,
  Switch,
  KeyboardAvoidingView,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import DropDownPicker from 'react-native-dropdown-picker';
import { MaterialIcons } from '@expo/vector-icons';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import { auth } from '../../firebaseConfig';
import { onAuthStateChanged } from 'firebase/auth';
import { getImageFileFromPicker } from '../../utils/getFormFileFromPicker';
import ScreenHeader from '../../components/ui/ScreenHeader';

// ---- Presets (must match how you created them originally) ----
const PRESET_LIBRARY = [
  { key: 'asset_life_years', label: 'Asset life (years)', fieldTypeSlug: 'number' },
  { key: 'warranty_terms', label: 'Warranty terms', fieldTypeSlug: 'textarea' },
  { key: 'last_serviced', label: 'Last serviced', fieldTypeSlug: 'date' },
  // Common fields moved to library (optional per type)
  { key: 'next_service_date', label: 'Next Service Date', fieldTypeSlug: 'date' },
  { key: 'documentation_url', label: 'Documentation URL', fieldTypeSlug: 'url' },
  { key: 'location', label: 'Location', fieldTypeSlug: 'text' },
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
  const { id, returnTo } = useLocalSearchParams();
  const normalizedReturnTo = Array.isArray(returnTo) ? returnTo[0] : returnTo;
  const router = useRouter();

  const [isAdmin, setIsAdmin] = useState(false);
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // type core
  const [name, setName] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [pickedImage, setPickedImage] = useState(null); // { uri, file }
  const [origName, setOrigName] = useState('');
  const [origImageUrl, setOrigImageUrl] = useState('');

  // field type catalog
  const [fieldTypes, setFieldTypes] = useState([]);
  const [loadingFieldTypes, setLoadingFieldTypes] = useState(true);

  // existing fields of this type (full objects from API)
  const [existingFields, setExistingFields] = useState([]);

  // presets state (preloaded to reflect existing)
  // structure: { [key]: { selected:boolean, required:boolean, fieldId?:string, requiresDocSlug?:string, reminderLeadDays?:number } }
  const [presetState, setPresetState] = useState(
    PRESET_LIBRARY.reduce((acc, p) => {
      acc[p.key] = { selected: false, required: false, requiresDocSlug: '', reminderLeadDays: 0 };
      return acc;
    }, {})
  );

  // editable existing custom rows (NOT matching presets)
  // [{id,name,field_type_id,is_required,optionsCsv,requiresDocSlug,reminderLeadDays,dirty?:bool,__open?:bool}]
  const [editableCustom, setEditableCustom] = useState([]);

  // queued brand-new custom fields (created on Save)
  const [newCustomQueue, setNewCustomQueue] = useState([]);

  // UI state
  const [showSummary, setShowSummary] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [addModel, setAddModel] = useState({ name: '', field_type_id: null, is_required: false, optionsCsv: '', requiresDocSlug: '', reminderLeadDays: 0 });

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

  // ------ Helpers ------
  const fieldTypeItems = useMemo(
    () =>
      fieldTypes.map((ft) => ({
        label: `${ft.slug === 'url' ? 'Document' : ft.name}${ft.has_options ? ' (options)' : ''}`,
        value: ft.id,
        has_options: ft.has_options,
        slug: ft.slug,
      })),
    [fieldTypes]
  );

  const getFieldTypeById = (fid) => fieldTypes.find((ft) => ft.id === fid);
  const slugToTypeId = (slug) => fieldTypes.find((ft) => ft.slug === slug)?.id || null;
  const slugHasOptions = (slug) => !!fieldTypes.find((ft) => ft.slug === slug)?.has_options;

  const pickImage = async () => {
    const res = await getImageFileFromPicker();
    if (res) setPickedImage(res);
  };

  // Decide if a field from the server matches any preset
  // Priority 1: slug === preset.key
  // Priority 2: case-insensitive name equals preset.label AND field type slug matches
  function matchPresetKeyForField(field) {
    // direct slug match
    const k1 = PRESET_LIBRARY.find((p) => (field.slug || '').toLowerCase() === p.key.toLowerCase());
    if (k1) return k1.key;

    // name + type match (fallback)
    const fType = getFieldTypeById(field.field_type_id);
    const fTypeSlug = fType?.slug;
    const k2 = PRESET_LIBRARY.find(
      (p) =>
        (field.name || '').trim().toLowerCase() === p.label.trim().toLowerCase() &&
        fTypeSlug &&
        fTypeSlug === p.fieldTypeSlug
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
    if (checking || !isAdmin) return;
    let live = true;

    (async () => {
      try {
        setLoading(true);
        setLoadingFieldTypes(true);

        // ensure catalog and fetch both
        await fetch(`${API_BASE_URL}/field-types/ensure-defaults`, { method: 'POST' }).catch(() => {});
        const [ftRes, typeRes] = await Promise.all([
          fetch(`${API_BASE_URL}/field-types`),
          fetch(`${API_BASE_URL}/asset-types/${id}?include=fields`),
        ]);

        if (!ftRes.ok) throw new Error(await ftRes.text());
        const ftData = await ftRes.json();
        const ftList = Array.isArray(ftData) ? ftData : ftData?.data || [];

        if (!typeRes.ok) throw new Error(await typeRes.text());
        const tJson = await typeRes.json();
        const row = tJson?.data || tJson;

        if (!live) return;

        setFieldTypes(ftList);
        setName(row?.name || '');
        setImageUrl(row?.image_url || '');
        setOrigName(row?.name || '');
        setOrigImageUrl(row?.image_url || '');
        const fields = Array.isArray(row?.fields) ? row.fields : [];
        setExistingFields(fields);

        // 1) Pre-check presets from existing fields
        const nextPreset = PRESET_LIBRARY.reduce((acc, p) => {
          acc[p.key] = { selected: false, required: false, requiresDocSlug: '', reminderLeadDays: 0 };
          return acc;
        }, {});

        const customBucket = [];
        for (const f of fields) {
          const presetKey = matchPresetKeyForField(f);
          const parseDocSlug = () => {
            try {
              const vr = f.validation_rules;
              const obj = vr && typeof vr === 'object' ? vr : vr ? JSON.parse(vr) : null;
              const s = obj && (obj.requires_document_slug || obj.require_document_slug);
              return (Array.isArray(s) ? s[0] : s) || '';
            } catch {
              return '';
            }
          };
          const parseReminder = () => {
            try {
              const vr = f.validation_rules;
              const obj = vr && typeof vr === 'object' ? vr : vr ? JSON.parse(vr) : null;
              const n = obj && (obj.reminder_lead_days || obj.reminderDays || obj.reminder_days);
              const v = Number(n);
              return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
            } catch { return 0; }
          };
          const parseDocRequired = () => {
            try {
              const vr = f.validation_rules;
              const obj = vr && typeof vr === 'object' ? vr : vr ? JSON.parse(vr) : null;
              const v = obj && (obj.requires_document_required ?? obj.require_document_required ?? obj.document_required ?? obj.require_document);
              if (typeof v === 'boolean') return v;
              if (typeof v === 'string') return v.toLowerCase() === 'true';
              return true;
            } catch { return true; }
          };

          if (presetKey) {
            nextPreset[presetKey] = {
              selected: true,
              required: !!f.is_required,
              fieldId: f.id,
              requiresDocSlug: parseDocSlug(),
              reminderLeadDays: parseReminder(),
              documentRequired: parseDocRequired(),
            };
          } else {
            customBucket.push(f);
          }
        }
        setPresetState(nextPreset);

        // 2) Populate editable custom with everything that didn't match a preset
        const editable = customBucket
          .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
          .map((f) => ({
            id: f.id,
            name: f.name,
            field_type_id: f.field_type_id,
            is_required: !!f.is_required,
            optionsCsv: Array.isArray(f.options) ? f.options.join(', ') : '',
            requiresDocSlug: (() => {
              try {
                const vr = f.validation_rules;
                const obj = vr && typeof vr === 'object' ? vr : vr ? JSON.parse(vr) : null;
                const s = obj && (obj.requires_document_slug || obj.require_document_slug);
                return (Array.isArray(s) ? s[0] : s) || '';
              } catch {
                return '';
              }
            })(),
            reminderLeadDays: (() => {
              try {
                const vr = f.validation_rules;
                const obj = vr && typeof vr === 'object' ? vr : vr ? JSON.parse(vr) : null;
                const n = obj && (obj.reminder_lead_days || obj.reminderDays || obj.reminder_days);
                const v = Number(n);
                return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
              } catch { return 0; }
            })(),
            documentRequired: (() => {
              try {
                const vr = f.validation_rules;
                const obj = vr && typeof vr === 'object' ? vr : vr ? JSON.parse(vr) : null;
                const v = obj && (obj.requires_document_required ?? obj.require_document_required ?? obj.document_required ?? obj.require_document);
                if (typeof v === 'boolean') return v;
                if (typeof v === 'string') return v.toLowerCase() === 'true';
                return true;
              } catch { return true; }
            })(),
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

    return () => {
      live = false;
    };
  }, [id, checking, isAdmin]);

  // ------ Custom row editing ------
  const updateCustomRow = (fieldId, patch) => {
    setEditableCustom((prev) => prev.map((r) => (r.id === fieldId ? { ...r, ...patch, dirty: true } : r)));
  };

  const saveCustomRow = async (row) => {
    try {
      const payload = {
        name: row.name,
        field_type_id: row.field_type_id,
        is_required: !!row.is_required,
      };
      const meta = getFieldTypeById(row.field_type_id);
      if ((meta?.slug || '').toLowerCase() === 'date') {
        const docSlug = (row.requiresDocSlug || '').trim();
        payload.validation_rules = docSlug ? { requires_document_slug: docSlug } : {};
      }
      if (meta?.has_options) {
        payload.options = (row.optionsCsv || '').split(',').map((s) => s.trim()).filter(Boolean);
      } else {
        payload.options = [];
      }
      const r = await fetch(`${API_BASE_URL}/assets/asset-types/${id}/fields/${row.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || 'Failed to update field');
      }
      Alert.alert('Saved', `Updated "${row.name}"`);
      setEditableCustom((prev) => prev.map((x) => (x.id === row.id ? { ...x, dirty: false } : x)));
    } catch (e) {
      Alert.alert('Error', e.message || 'Update failed');
    }
  };

  const deleteCustomRow = async (row) => {
    try {
      const ok =
        Platform.OS === 'web'
          ? window.confirm(`Delete field "${row.name}"?`)
          : await new Promise((res) =>
              Alert.alert('Delete field', `Delete "${row.name}"?`, [
                { text: 'Cancel', style: 'cancel', onPress: () => res(false) },
                { text: 'Delete', style: 'destructive', onPress: () => res(true) },
              ])
            );
      if (!ok) return;

      const r = await fetch(`${API_BASE_URL}/assets/asset-types/${id}/fields/${row.id}`, { method: 'DELETE' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error || body?.message || 'Delete failed');
      setEditableCustom((prev) => prev.filter((x) => x.id !== row.id));
      Alert.alert('Deleted', `"${row.name}" removed`);
    } catch (e) {
      Alert.alert('Error', e.message || 'Delete failed');
    }
  };

  // ------ Add new custom field (queue) ------
  const queueNewCustom = () => {
    // auto-map to preset if label + type matches
    const typedName = (addModel.name || '').trim().toLowerCase();
    const addTypeSlug = getFieldTypeById(addModel.field_type_id)?.slug;

    const matchingPreset = PRESET_LIBRARY.find(
      (p) => typedName === p.label.trim().toLowerCase() && addTypeSlug && addTypeSlug === p.fieldTypeSlug
    );

    if (matchingPreset) {
      setPresetState((ps) => ({
        ...ps,
        [matchingPreset.key]: {
          selected: true,
          required: !!addModel.is_required,
          requiresDocSlug: ps[matchingPreset.key]?.requiresDocSlug || '',
          reminderLeadDays: ps[matchingPreset.key]?.reminderLeadDays || 0,
        },
      }));
      setAddModel({ name: '', field_type_id: null, is_required: false, optionsCsv: '', requiresDocSlug: '', reminderLeadDays: 0 });
      setAddOpen(false);
      setPickerOpen(false);
      return;
    }

    if (!addModel.name.trim() || !addModel.field_type_id) {
      return Alert.alert('Missing info', 'Please select a field type and enter a field name.');
    }

    setNewCustomQueue((prev) => [
      ...prev,
      {
        id: `__new__${Date.now()}`,
        name: addModel.name.trim(),
        field_type_id: addModel.field_type_id,
        is_required: !!addModel.is_required,
        optionsCsv: addModel.optionsCsv || '',
        requiresDocSlug: addModel.requiresDocSlug || '',
        reminderLeadDays: Number(addModel.reminderLeadDays) || 0,
      },
    ]);
    setAddModel({ name: '', field_type_id: null, is_required: false, optionsCsv: '', requiresDocSlug: '', reminderLeadDays: 0 });
    setAddOpen(false);
    setPickerOpen(false);
  };

  const removeQueuedCustom = (qid) => setNewCustomQueue((prev) => prev.filter((f) => f.id !== qid));

  // ------ Preset toggles ------
  const togglePresetSelected = (key) =>
    setPresetState((p) => {
      const nextSel = !p[key]?.selected;
      return {
        ...p,
        [key]: {
          selected: nextSel,
          required: nextSel ? !!p[key]?.required : false,
          requiresDocSlug: p[key]?.requiresDocSlug || '',
        },
      };
    });

  const togglePresetRequired = (key) =>
    setPresetState((p) => {
      const nextReq = !p[key]?.required;
      return {
        ...p,
        [key]: {
          selected: nextReq ? true : !!p[key]?.selected,
          required: nextReq,
          requiresDocSlug: p[key]?.requiresDocSlug || '',
        },
      };
    });

  // ------ Save all ------
  const handleSave = async () => {
    if (!name.trim()) return Alert.alert('Validation', 'Name is required');

    setSaving(true);
    try {
      // (A) Update core (name/image) with change detection
      const trimmedName = name.trim();
      const pickingNew = !!pickedImage?.file;
      const urlTrim = (imageUrl || '').trim();
      const nameChanged = trimmedName !== (origName || '');
      const imageRemoved = !pickingNew && !urlTrim && !!origImageUrl;
      const imageUrlChanged = !pickingNew && !!urlTrim && urlTrim !== (origImageUrl || '');
      const needCore = nameChanged || pickingNew || imageRemoved || imageUrlChanged;

      const coreMsgs = [];
      if (needCore) {
        let resCore;
        if (pickingNew) {
          const fd = new FormData();
          fd.append('name', trimmedName);
          fd.append('image', pickedImage.file, pickedImage.file.name || 'upload.jpg');
          resCore = await fetch(`${API_BASE_URL}/asset-types/${id}`, {
            method: 'PUT',
            body: fd,
            headers: { ...(auth.currentUser?.uid ? { 'X-User-Id': auth.currentUser.uid } : {}) },
          });
        } else {
          const payload = { name: trimmedName };
          if (imageRemoved) payload.image_url = null;
          else if (imageUrlChanged) payload.image_url = urlTrim;

          resCore = await fetch(`${API_BASE_URL}/asset-types/${id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              ...(auth.currentUser?.uid ? { 'X-User-Id': auth.currentUser.uid } : {}),
            },
            body: JSON.stringify(payload),
          });
        }
        const coreBody = await resCore.json().catch(() => ({}));
        if (!resCore.ok) throw new Error(coreBody?.message || 'Failed to update asset type');

        if (pickingNew && origImageUrl) coreMsgs.push('Image changed');
        else if (pickingNew && !origImageUrl) coreMsgs.push('Image added');
        else if (imageRemoved) coreMsgs.push('Image removed');
        else if (imageUrlChanged && origImageUrl) coreMsgs.push('Image changed');
        else if (imageUrlChanged && !origImageUrl) coreMsgs.push('Image added');
        if (nameChanged) coreMsgs.push('Name updated');

        // Update originals for subsequent saves
        setOrigName(trimmedName);
        if (pickingNew) {
          setOrigImageUrl('changed');
          setImageUrl('');
          setPickedImage(null);
        } else if (imageRemoved) {
          setOrigImageUrl('');
        } else if (imageUrlChanged) {
          setOrigImageUrl(urlTrim);
        }
      }

      // (B) Diff presets against existing fields
      const existingBySlug = Object.fromEntries(existingFields.map((f) => [f.slug, f]));
      const presetErrors = [];

      for (const p of PRESET_LIBRARY) {
        const state = presetState[p.key] || { selected: false, required: false };
        const exists = !!existingBySlug[p.key];

        // CREATE if selected but not exists
        if (state.selected && !exists) {
          const ftId = slugToTypeId(p.fieldTypeSlug);
          if (!ftId) {
            presetErrors.push(`${p.label}: field type missing`);
            continue;
          }
          const payload = {
            name: p.label,
            field_type_id: ftId,
            is_required: !!state.required,
            display_order: (existingFields?.length || 0) + 50,
          };
          if (p.options && slugHasOptions(p.fieldTypeSlug)) payload.options = p.options;
          if ((p.fieldTypeSlug || '').toLowerCase() === 'date') {
            const docSlug = (presetState[p.key]?.requiresDocSlug || '').trim();
            const lead = Number(presetState[p.key]?.reminderLeadDays) || 0;
            const docReq = !!presetState[p.key]?.documentRequired;
            const vr = {};
            if (docSlug) vr.requires_document_slug = docSlug;
            if (lead > 0) vr.reminder_lead_days = lead;
            if (docSlug) vr.requires_document_required = docReq; // only meaningful when slug present
            if (Object.keys(vr).length) payload.validation_rules = vr;
          }

          const r = await fetch(`${API_BASE_URL}/assets/asset-types/${id}/fields`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(auth.currentUser?.uid ? { 'X-User-Id': auth.currentUser.uid } : {}),
            },
            body: JSON.stringify(payload),
          });
          if (!r.ok) presetErrors.push(`${p.label}: ${(await r.text()) || 'Failed to create'}`);
        }

        // UPDATE required if exists and changed (and update date validation link)
        if (state.selected && exists) {
          const old = existingBySlug[p.key];
          const shouldUpdateRequired = !!old.is_required !== !!state.required;
          const isDate = (p.fieldTypeSlug || '').toLowerCase() === 'date';
          const newDocSlug = (presetState[p.key]?.requiresDocSlug || '').trim();

          if (shouldUpdateRequired || isDate) {
            const body = { is_required: !!state.required };
            if (isDate) {
              const lead = Number(presetState[p.key]?.reminderLeadDays) || 0;
              const docReq = !!presetState[p.key]?.documentRequired;
              const vr = {};
              if (newDocSlug) vr.requires_document_slug = newDocSlug;
              if (lead > 0) vr.reminder_lead_days = lead;
              if (newDocSlug) vr.requires_document_required = docReq;
              body.validation_rules = vr;
            }

            const r = await fetch(`${API_BASE_URL}/assets/asset-types/${id}/fields/${old.id}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                ...(auth.currentUser?.uid ? { 'X-User-Id': auth.currentUser.uid } : {}),
              },
              body: JSON.stringify(body),
            });
            if (!r.ok) presetErrors.push(`${p.label}: ${(await r.text()) || 'Failed to update'}`);
          }
        }

        // DELETE if not selected but existed
        if (!state.selected && exists) {
          const old = existingBySlug[p.key];
          const r = await fetch(`${API_BASE_URL}/assets/asset-types/${id}/fields/${old.id}`, {
            method: 'DELETE',
            headers: { ...(auth.currentUser?.uid ? { 'X-User-Id': auth.currentUser.uid } : {}) },
          });
          if (!r.ok) presetErrors.push(`${p.label}: ${(await r.text()) || 'Failed to delete (may have values)'}`);
        }
      }

      // (C) Persist edits to existing custom fields (dirty rows)
      const editErrors = [];
      for (const row of editableCustom) {
        if (!row?.dirty) continue;
        const payload = {
          name: row.name,
          field_type_id: row.field_type_id,
          is_required: !!row.is_required,
        };
        const meta = getFieldTypeById(row.field_type_id);
        if ((meta?.slug || '').toLowerCase() === 'date') {
          const docSlug = (row.requiresDocSlug || '').trim();
          const lead = Number(row.reminderLeadDays) || 0;
          const docReq = !!row.documentRequired;
          const vr = {};
          if (docSlug) vr.requires_document_slug = docSlug;
          if (lead > 0) vr.reminder_lead_days = lead;
          if (docSlug) vr.requires_document_required = docReq;
          payload.validation_rules = vr;
        }
        if (meta?.has_options) {
          payload.options = (row.optionsCsv || '').split(',').map((s) => s.trim()).filter(Boolean);
        } else {
          payload.options = [];
        }
        const r = await fetch(`${API_BASE_URL}/assets/asset-types/${id}/fields/${row.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!r.ok) editErrors.push(`${row.name}: ${(await r.text()) || 'Failed to update'}`);
      }

      // (D) Create queued brand-new custom fields
      const newErrors = [];
      for (const q of newCustomQueue) {
        const meta = getFieldTypeById(q.field_type_id);
        const payload = {
          name: q.name,
          field_type_id: q.field_type_id,
          is_required: !!q.is_required,
          display_order: (existingFields?.length || 0) + 100,
        };
        if ((meta?.slug || '').toLowerCase() === 'date') {
          const docSlug = (q.requiresDocSlug || '').trim();
          const lead = Number(q.reminderLeadDays) || 0;
          const vr = {};
          if (docSlug) vr.requires_document_slug = docSlug;
          if (lead > 0) vr.reminder_lead_days = lead;
          payload.validation_rules = vr;
        }
        if (meta?.has_options) {
          payload.options = (q.optionsCsv || '').split(',').map((s) => s.trim()).filter(Boolean);
        } else {
          payload.options = [];
        }
        const r = await fetch(`${API_BASE_URL}/assets/asset-types/${id}/fields`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(auth.currentUser?.uid ? { 'X-User-Id': auth.currentUser.uid } : {}),
          },
          body: JSON.stringify(payload),
        });
        if (!r.ok) newErrors.push(`${q.name}: ${(await r.text()) || 'Failed to create'}`);
      }

      if (presetErrors.length || newErrors.length || editErrors.length) {
        Alert.alert('Saved with warnings', [...presetErrors, ...editErrors, ...newErrors].slice(0, 8).join('\n'));
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

  const confirmDeleteType = () =>
    new Promise((resolve) => {
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
      const res = await fetch(`${API_BASE_URL}/asset-types/${id}`, {
        method: 'DELETE',
        headers: { ...(auth.currentUser?.uid ? { 'X-User-Id': auth.currentUser.uid } : {}) },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || body?.error || 'Delete failed');
      if (Platform.OS !== 'web') Alert.alert('Deleted', 'Asset type removed');
      router.replace('/Inventory?tab=types');
    } catch (e) {
      Alert.alert('Error', e.message || 'Delete failed');
    }
  };

  if (checking) {
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator size="large" />
        <Text style={{ marginTop: 10 }}>Checking access...</Text>
      </SafeAreaView>
    );
  }

  if (!isAdmin) {
    return (
      <SafeAreaView style={s.center}>
        <MaterialIcons name="lock" size={32} color="#64748B" />
        <Text style={{ marginTop: 12, fontSize: 16, color: '#111827' }}>Admin access required.</Text>
        <TouchableOpacity onPress={() => router.replace('/Inventory')} style={[s.btn, { marginTop: 16, backgroundColor: '#2563EB' }]}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator size="large" />
        <Text style={{ marginTop: 10 }}>Loading type...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScreenHeader
        title="Edit Asset Type"
        backLabel="Inventory"
        onBack={() => {
          if (normalizedReturnTo) {
            router.replace(normalizedReturnTo);
            return;
          }
          router.replace('/Inventory?tab=types');
        }}
      />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
          {/* Type core */}
          <Text style={s.label}>Name *</Text>
          <TextInput style={s.input} placeholder="Type name" value={name} onChangeText={setName} />

          <Text style={s.label}>Image URL</Text>
          <TextInput
            style={s.input}
            placeholder="https://..."
            value={imageUrl}
            onChangeText={setImageUrl}
            autoCapitalize="none"
          />

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity style={[s.btn]} onPress={pickImage}>
              <Text>{pickedImage ? 'Change Image (local)' : 'Pick Image (optional)'}</Text>
            </TouchableOpacity>
            {pickedImage?.uri ? <Image source={{ uri: pickedImage.uri }} style={s.previewThumb} /> : null}
          </View>

          {/* Presets grid */}
          <View style={{ marginTop: 24 }}>
            <Text style={s.sectionTitle}>Add / remove preset fields</Text>
            <View style={s.grid}>
              {PRESET_LIBRARY.map((p) => {
                const state = presetState[p.key] || { selected: false, required: false };
                const checked = !!state.selected;
                const required = !!state.required;
                const exField = existingFields.find((f) => (f.slug || '') === p.key);
                const existing = !!exField;
                const pendingCreate = checked && !existing;
                const pendingDelete = !checked && existing;
                const pendingReq = checked && existing && (!!exField?.is_required !== required);
                return (
                  <View key={p.key} style={s.gridItem}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
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
                        <Switch value={required} onValueChange={() => togglePresetRequired(p.key)} disabled={!checked} />
                      </View>
                      {(pendingCreate || pendingDelete || pendingReq) && (
                        <View style={{ marginLeft: 8 }}>
                          {pendingCreate ? (
                            <View style={[s.pill, s.pillNew]}>
                              <Text style={s.pillText}>New</Text>
                            </View>
                          ) : null}
                          {pendingDelete ? (
                            <View style={[s.pill, s.pillDel]}>
                              <Text style={s.pillText}>Remove</Text>
                            </View>
                          ) : null}
                          {pendingReq ? (
                            <View style={[s.pill, s.pillUpd]}>
                              <Text style={s.pillText}>Required Δ</Text>
                            </View>
                          ) : null}
                        </View>
                      )}
                    </View>
                    {checked && (p.fieldTypeSlug || '').toLowerCase() === 'date' ? (
                      <View style={{ width: '100%', marginTop: 8 }}>
                        <Text style={s.subLabel}>{p.label} → Document link (optional)</Text>
                        <TextInput
                          style={s.input}
                          value={presetState[p.key]?.requiresDocSlug || ''}
                          onChangeText={(t) =>
                            setPresetState((prev) => ({
                              ...prev,
                              [p.key]: { ...prev[p.key], requiresDocSlug: t },
                            }))
                          }
                          placeholder="e.g. documentation_url"
                          autoCapitalize="none"
                        />
                        <View style={s.switchRow}>
                          <Text style={s.subLabel}>Document required</Text>
                          <Switch
                            value={!!presetState[p.key]?.documentRequired}
                            onValueChange={(v) =>
                              setPresetState((prev) => ({
                                ...prev,
                                [p.key]: { ...prev[p.key], documentRequired: v },
                              }))
                            }
                          />
                        </View>
                        <Text style={[s.subLabel, { marginTop: 8 }]}>Reminder lead time (days, optional)</Text>
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                          {[7,14,30].map((d) => (
                            <TouchableOpacity
                              key={`lead-${d}`}
                              onPress={() => setPresetState((prev) => ({ ...prev, [p.key]: { ...prev[p.key], reminderLeadDays: d } }))}
                              style={[s.btn, { paddingVertical: 8, backgroundColor: (presetState[p.key]?.reminderLeadDays||0) === d ? '#DBEAFE' : '#F3F4F6' }]}
                            >
                              <Text style={{ fontWeight: '700', color: '#1E3A8A' }}>{d === 30 ? '1 month' : `${d/7} week${d===14? 's':''}`}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        <TextInput
                          style={[s.input, { marginTop: 6 }]}
                          value={(Number(presetState[p.key]?.reminderLeadDays)||0) > 0 ? String(Number(presetState[p.key]?.reminderLeadDays)) : ''}
                          onChangeText={(t) => {
                            const n = Math.max(0, parseInt(String(t).replace(/[^\d]/g,''), 10) || 0);
                            setPresetState((prev) => ({ ...prev, [p.key]: { ...prev[p.key], reminderLeadDays: n } }));
                          }}
                          placeholder="No Reminder"
                          keyboardType="numeric"
                        />
                        <Text style={{ color: '#6B7280', fontSize: 12, marginTop: 6 }}>
                          {(Number(presetState[p.key]?.reminderLeadDays)||0) > 0
                            ? `Reminder to be sent ${Number(presetState[p.key]?.reminderLeadDays)} days before expiry date`
                            : 'No Reminder'}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
          
          {/* Existing custom fields */}
          <View style={{ marginTop: 24 }}>
            <Text style={s.sectionTitle}>Existing custom fields</Text>
            {editableCustom.length === 0 ? (
              <Text style={{ color: '#777', marginTop: 6 }}>No custom fields.</Text>
            ) : null}

            {editableCustom.map((row) => {
              const typeMeta = getFieldTypeById(row.field_type_id);
              const needsOptions = !!typeMeta?.has_options;
              const isDate = (typeMeta?.slug || '').toLowerCase() === 'date';
              return (
                <View key={row.id} style={s.card}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={s.cardTitle}>Field • {row.name}</Text>
                    {row.dirty ? (
                      <View style={[s.pill, s.pillUpd]}>
                        <Text style={s.pillText}>Modified</Text>
                      </View>
                    ) : null}
                  </View>

                  <Text style={s.subLabel}>Field name</Text>
                  <TextInput style={s.input} value={row.name} onChangeText={(t) => updateCustomRow(row.id, { name: t })} />

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
                      listMode="MODAL"
                    />
                  </View>

                  {isDate && (
                    <>
                      <Text style={s.subLabel}>Requires document field name (optional)</Text>
                      <TextInput
                        style={s.input}
                        value={row.requiresDocSlug || ''}
                        onChangeText={(t) => updateCustomRow(row.id, { requiresDocSlug: t })}
                        placeholder="e.g. documentation_url"
                        autoCapitalize="none"
                      />
                      <View style={s.switchRow}>
                        <Text style={s.subLabel}>Document required</Text>
                        <Switch
                          value={!!row.documentRequired}
                          onValueChange={(v) => updateCustomRow(row.id, { documentRequired: v })}
                        />
                      </View>
                      <Text style={s.subLabel}>Reminder lead time (days, optional)</Text>
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                        {[7,14,30].map((d) => (
                          <TouchableOpacity
                            key={`lead-row-${row.id}-${d}`}
                            onPress={() => updateCustomRow(row.id, { reminderLeadDays: d })}
                            style={[s.btn, { paddingVertical: 8, backgroundColor: (Number(row.reminderLeadDays)||0) === d ? '#DBEAFE' : '#F3F4F6' }]}
                          >
                            <Text style={{ fontWeight: '700', color: '#1E3A8A' }}>{d === 30 ? '1 month' : `${d/7} week${d===14? 's':''}`}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <TextInput
                        style={[s.input, { marginTop: 6 }]}
                        value={(Number(row.reminderLeadDays)||0) > 0 ? String(Number(row.reminderLeadDays)) : ''}
                        onChangeText={(t) => {
                          const n = Math.max(0, parseInt(String(t).replace(/[^\d]/g,''), 10) || 0);
                          updateCustomRow(row.id, { reminderLeadDays: n });
                        }}
                        placeholder="No Reminder"
                        keyboardType="numeric"
                      />
                      <Text style={{ color: '#6B7280', fontSize: 12, marginTop: 6 }}>
                        {(Number(row.reminderLeadDays)||0) > 0
                          ? `Reminder to be sent ${Number(row.reminderLeadDays)} days before expiry date`
                          : 'No Reminder'}
                      </Text>
                    </>
                  )}

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

                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                    <TouchableOpacity style={[s.btn]} onPress={() => saveCustomRow(row)}>
                      <Text>Save field</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.btn]} onPress={() => deleteCustomRow(row)}>
                      <Text style={{ color: '#b00020', fontWeight: '700' }}>Delete field</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>

          {/* Add custom field */}
          <View style={{ marginTop: 24 }}>
            <Text style={s.sectionTitle}>Add custom field</Text>
            {addOpen ? (
              <View style={s.card}>
                <Text style={s.subLabel}>Field name</Text>
                <TextInput
                  style={s.input}
                  value={addModel.name}
                  onChangeText={(t) => setAddModel((m) => ({ ...m, name: t }))}
                  placeholder="e.g. Voltage"
                />

                <Text style={s.subLabel}>Field type</Text>
                <View style={{ zIndex: 3000 }}>
                  <DropDownPicker
                    open={pickerOpen}
                    value={addModel.field_type_id}
                    items={fieldTypeItems}
                    setOpen={setPickerOpen}
                    setValue={(cb) => {
                      const newVal = cb(addModel.field_type_id);
                      setAddModel((m) => ({ ...m, field_type_id: newVal }));
                    }}
                    placeholder="Select a field type"
                    style={s.dropdown}
                    dropDownContainerStyle={s.dropdownContainer}
                    listMode="MODAL"
                  />
                </View>

                {(() => {
                  const meta = getFieldTypeById(addModel.field_type_id);
                  const isDate = (meta?.slug || '').toLowerCase() === 'date';
                  if (!isDate) return null;
                  return (
                    <>
                      <Text style={s.subLabel}>Requires document field slug (optional)</Text>
                      <TextInput
                        style={s.input}
                        value={addModel.requiresDocSlug || ''}
                        onChangeText={(t) => setAddModel((m) => ({ ...m, requiresDocSlug: t }))}
                        placeholder="e.g. documentation_url"
                        autoCapitalize="none"
                      />
                      <Text style={s.subLabel}>Reminder lead time (days, optional)</Text>
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                        {[7,14,30].map((d) => (
                          <TouchableOpacity
                            key={`lead-add-${d}`}
                            onPress={() => setAddModel((m) => ({ ...m, reminderLeadDays: d }))}
                            style={[s.btn, { paddingVertical: 8, backgroundColor: (Number(addModel.reminderLeadDays)||0) === d ? '#DBEAFE' : '#F3F4F6' }]}
                          >
                            <Text style={{ fontWeight: '700', color: '#1E3A8A' }}>{d === 30 ? '1 month' : `${d/7} week${d===14? 's':''}`}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <TextInput
                        style={[s.input, { marginTop: 6 }]}
                        value={String(Number(addModel.reminderLeadDays)||0)}
                        onChangeText={(t) => {
                          const n = Math.max(0, parseInt(String(t).replace(/[^\d]/g,''), 10) || 0);
                          setAddModel((m) => ({ ...m, reminderLeadDays: n }));
                        }}
                        placeholder="e.g. 7"
                        keyboardType="numeric"
                      />
                    </>
                  );
                })()}

                <View style={s.switchRow}>
                  <Text style={s.subLabel}>Required</Text>
                  <Switch
                    value={!!addModel.is_required}
                    onValueChange={(v) => setAddModel((m) => ({ ...m, is_required: v }))}
                  />
                </View>

                {!!getFieldTypeById(addModel.field_type_id)?.has_options && (
                  <>
                    <Text style={s.subLabel}>Options (comma-separated)</Text>
                    <TextInput
                      style={s.input}
                      value={addModel.optionsCsv}
                      onChangeText={(t) => setAddModel((m) => ({ ...m, optionsCsv: t }))}
                      placeholder="e.g. 110V, 240V"
                      autoCapitalize="none"
                    />
                  </>
                )}

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                  <TouchableOpacity
                    style={[s.btn, { flex: 1 }]}
                    onPress={() => {
                      setAddOpen(false);
                      setPickerOpen(false);
                    }}
                  >
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
            {newCustomQueue.map((q) => (
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
          onPress={() => setShowSummary(true)}
          disabled={saving}
          style={[s.actionBtn, s.saveBtn, saving && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityState={{ disabled: saving, busy: saving }}
        >
          <MaterialIcons name="save" size={18} color="#fff" style={{ marginRight: 6 }} />
          <Text style={s.actionText}>{saving ? 'Saving...' : 'Save Changes'}</Text>
        </TouchableOpacity>
      </View>

      {/* Summary modal */}
      <Modal transparent animationType="fade" visible={showSummary} onRequestClose={() => setShowSummary(false)}>
        <View style={s.summaryBackdrop}>
          <View style={s.summaryCard}>
            <Text style={s.summaryTitle}>Review changes</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {(() => {
                const existingBySlug = Object.fromEntries(existingFields.map((f) => [f.slug, f]));
                const creates = [];
                const updates = [];
                const deletes = [];

                for (const p of PRESET_LIBRARY) {
                  const st = presetState[p.key] || { selected: false, required: false };
                  const ex = existingBySlug[p.key];
                  if (st.selected && !ex) creates.push(`${p.label}${st.required ? ' • Required' : ''}`);
                  if (!st.selected && ex) deletes.push(`${p.label}`);
                  if (st.selected && ex && (!!ex.is_required !== !!st.required)) {
                    updates.push(`\u2022 ${p.label} • Required: ${ex.is_required ? 'Yes' : 'No'} → ${st.required ? 'Yes' : 'No'}`);
                  }
                  // show date doc links in summary if present
                  if (st.selected && ex && (p.fieldTypeSlug || '').toLowerCase() === 'date') {
                    const newDocSlug = (presetState[p.key]?.requiresDocSlug || '').trim();
                    if (newDocSlug) updates.push(`\u2022 ${p.label} • Link to: ${newDocSlug}`);
                    const lead = Number(presetState[p.key]?.reminderLeadDays) || 0;
                    if (lead > 0) updates.push(`\u2022 ${p.label} • Reminder lead: ${lead} days`);
                  }
                }

                const edits = editableCustom
                  .filter((r) => !!r.dirty)
                  .map((r) => `${r.name} • Required: ${r.is_required ? 'Yes' : 'No'}`);

                const news = newCustomQueue.map((q) => `${q.name}${q.is_required ? ' • Required' : ''}`);

                const any = creates.length || updates.length || deletes.length || edits.length || news.length;
                if (!any) return <Text style={{ color: '#666', marginTop: 8 }}>No changes detected.</Text>;

                return (
                  <>
                    {creates.length ? (
                      <View style={{ marginTop: 8 }}>
                        <Text style={s.summaryH}>Add fields</Text>
                        {creates.map((t, i) => (
                          <Text key={`c-${i}`} style={s.summaryItem}>
                            • {t}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                    {updates.length ? (
                      <View style={{ marginTop: 8 }}>
                        <Text style={s.summaryH}>Update fields</Text>
                        {updates.map((t, i) => (
                          <Text key={`u-${i}`} style={s.summaryItem}>
                            {t}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                    {deletes.length ? (
                      <View style={{ marginTop: 8 }}>
                        <Text style={s.summaryH}>Remove fields</Text>
                        {deletes.map((t, i) => (
                          <Text key={`d-${i}`} style={[s.summaryItem, { color: '#b00020' }]}>
                            • {t}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                    {edits.length ? (
                      <View style={{ marginTop: 8 }}>
                        <Text style={s.summaryH}>Edited custom</Text>
                        {edits.map((t, i) => (
                          <Text key={`e-${i}`} style={s.summaryItem}>
                            • {t}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                    {news.length ? (
                      <View style={{ marginTop: 8 }}>
                        <Text style={s.summaryH}>New custom</Text>
                        {news.map((t, i) => (
                          <Text key={`n-${i}`} style={s.summaryItem}>
                            • {t}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                  </>
                );
              })()}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity style={[s.btn, { flex: 1 }]} onPress={() => setShowSummary(false)}>
                <Text>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btn, s.submit, { flex: 1, opacity: saving ? 0.7 : 1 }]}
                onPress={async () => {
                  setShowSummary(false);
                  await handleSave();
                }}
                disabled={saving}
              >
                <Text style={{ color: '#fff' }}>Confirm Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  // container + basics
  container: { padding: 20, paddingBottom: 120 },
  label: { fontWeight: '600', marginTop: 10 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    padding: 12,
    marginTop: 6,
    color: '#000',
    backgroundColor: '#fff',
  },
  btn: { backgroundColor: '#eee', padding: 12, alignItems: 'center', borderRadius: 8, marginVertical: 8 },
  submit: { backgroundColor: '#1E90FF' },
  previewThumb: { width: 44, height: 44, borderRadius: 6, alignSelf: 'center', borderWidth: 1, borderColor: '#ddd' },

  sectionTitle: { fontSize: 18, fontWeight: '700', borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 6 },

  // grid for presets
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  gridItem: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#E6E6E6',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#FBFBFB',
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  gridLabel: { marginLeft: 10, fontSize: 14, color: '#333', flexShrink: 1, flex: 1 },
  gridBox: { width: 18, height: 18, borderRadius: 4, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  gridBoxChecked: { borderColor: '#1E90FF', backgroundColor: '#1E90FF' },
  gridBoxUnchecked: { borderColor: '#C5DFFF', backgroundColor: 'transparent' },
  gridTick: { color: '#fff', fontSize: 12, fontWeight: 'bold', lineHeight: 12 },
  reqWrap: { marginLeft: 'auto', alignItems: 'center' },
  reqLabel: { fontSize: 11, color: '#516B8E', marginBottom: 4 },

  // pills
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, alignSelf: 'flex-start' },
  pillText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  pillNew: { backgroundColor: '#10B981' },
  pillUpd: { backgroundColor: '#0EA5E9' },
  pillDel: { backgroundColor: '#EF4444' },

  // cards
  card: { borderWidth: 1, borderColor: '#E6E6E6', borderRadius: 12, padding: 12, marginTop: 8, backgroundColor: '#FAFAFA' },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  subLabel: { fontSize: 14, fontWeight: '600', marginTop: 8, marginBottom: 4 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },

  // dropdown
  dropdown: { borderColor: '#ccc', borderRadius: 8, marginTop: 4 },
  dropdownContainer: { borderColor: '#ccc' },

  // bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    backgroundColor: '#fff',
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  saveBtn: { backgroundColor: '#1E90FF' },
  deleteBtn: { backgroundColor: '#b00020' },
  actionText: { color: '#fff', fontWeight: '700' },

  // misc
  center: { flex: 1, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  summaryBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.15)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    width: '92%',
    maxWidth: 520,
    borderWidth: 1,
    borderColor: '#E6EDF3',
  },
  summaryTitle: { fontSize: 18, fontWeight: '900', color: '#0F172A' },
  summaryH: { fontWeight: '800', color: '#0F172A', marginTop: 6 },
  summaryItem: { color: '#334155', marginTop: 4 },
});
