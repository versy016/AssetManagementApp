// components/tasks/CreateTaskModal.js
// Create a manual (user-created) task. Title is required; everything else is
// optional: category, priority, due date, a linked asset, and (admins only) an
// assignee. Submitting calls onCreate(payload) and closes on success.

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, Modal, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, Platform, KeyboardAvoidingView, useWindowDimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { DatePickerModal } from 'react-native-paper-dates';
import { Colors, Radius, Shadows, sf } from '../../constants/uiTheme';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import { auth } from '../../firebaseConfig';
import { isAssetIdAwaitingQr } from '../../utils/assetId';
import { fetchFields } from '../../hooks/useAssetTypeFields';

// A field counts as a "certificate" field if its name/slug mentions a
// certificate or calibration (calibration lives under certificates here).
const isCertField = (f) => /cert|calibrat/i.test(`${f?.name || ''} ${f?.slug || ''}`);
// QR-reserved placeholder rows carry this sentinel description.
const isQrReserved = (a) =>
  String(a?.description || a?.fields?.description || '').trim().toLowerCase() === 'qr reserved asset';

const CATEGORIES = ['GENERAL', 'SERVICE', 'REPAIR', 'MAINTENANCE', 'INSPECTION', 'CERTIFICATE', 'OTHER'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];
// Certificate sub-types (calibration lives here — calibration & certificates
// are one category).
const CERT_TYPES = ['Calibration', 'Test', 'Inspection', 'Compliance', 'Conformance', 'Warranty', 'Other'];
const cap = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : s);

const fmtDue = (ymd) => {
  if (!ymd) return null;
  const d = new Date(ymd + 'T00:00:00');
  if (isNaN(+d)) return ymd;
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
};

const toYMD = (d) => {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(+dt)) return null;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

export default function CreateTaskModal({ visible, onClose, onCreate, onUpdate, isAdmin, editTask }) {
  const isEdit = !!editTask;
  const { height: winH } = useWindowDimensions();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('GENERAL');
  const [certType, setCertType] = useState(null);
  const [priority, setPriority] = useState('MEDIUM');
  // Whether the linked asset's type has a certificate field: 'idle'|'checking'|'has'|'missing'.
  const [certFieldStatus, setCertFieldStatus] = useState('idle');
  const [dueDate, setDueDate] = useState(null); // 'YYYY-MM-DD' | null
  const [dateOpen, setDateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Linked asset
  const [asset, setAsset] = useState(null); // { id, label }
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [assets, setAssets] = useState([]);
  const [assetQuery, setAssetQuery] = useState('');
  const [assetsLoading, setAssetsLoading] = useState(false);

  // Assignee (admins only)
  const [assignee, setAssignee] = useState(null); // { id, label }
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);

  const reset = () => {
    setTitle(''); setDescription(''); setCategory('GENERAL'); setCertType(null); setCertFieldStatus('idle'); setPriority('MEDIUM');
    setDueDate(null); setDateOpen(false); setSubmitting(false);
    setAsset(null); setAssetPickerOpen(false); setAssetQuery('');
    setAssignee(null); setAssigneePickerOpen(false);
  };

  // On open: prefill from editTask, or start fresh. On close: reset.
  useEffect(() => {
    if (!visible) { reset(); return; }
    if (editTask) {
      setTitle(editTask.title || '');
      setDescription(editTask.description || '');
      setCategory(editTask.category || 'GENERAL');
      setCertType(editTask.certType || null);
      setPriority(editTask.priority || 'MEDIUM');
      setDueDate(editTask.due ? toYMD(editTask.due) : null);
      setAsset(editTask.assetId
        ? {
            id: editTask.assetId,
            label: editTask.assetTypeName || editTask.model || editTask.assetId,
            typeId: editTask.assetTypeId || null,
            sub: [editTask.model, editTask.serialNumber].filter(Boolean).join(' · '),
          }
        : null);
      setAssignee(editTask.assignedToId
        ? { id: editTask.assignedToId, label: editTask.assigneeName || editTask.assignedToId }
        : null);
    }
  }, [visible, editTask]);

  // Once an asset is selected, inspect its type's fields so we only offer the
  // categories that make sense for it (e.g. Certificate only when the type has
  // a certificate field).
  useEffect(() => {
    let cancelled = false;
    if (!visible || !asset?.id) { setCertFieldStatus('idle'); return; }
    if (!asset.typeId) { setCertFieldStatus('missing'); return; } // no type → no fields
    setCertFieldStatus('checking');
    fetchFields(asset.typeId)
      .then((fields) => {
        if (cancelled) return;
        setCertFieldStatus(Array.isArray(fields) && fields.some(isCertField) ? 'has' : 'missing');
      })
      .catch(() => { if (!cancelled) setCertFieldStatus('idle'); });
    return () => { cancelled = true; };
  }, [visible, asset?.id, asset?.typeId]);

  // Certificate is only a valid category when the asset type has a cert field.
  const hasCertField = certFieldStatus === 'has';
  const categories = useMemo(
    () => CATEGORIES.filter((c) => c !== 'CERTIFICATE' || hasCertField),
    [hasCertField],
  );
  // If Certificate becomes unavailable (e.g. asset changed), fall back.
  useEffect(() => {
    if (category === 'CERTIFICATE' && !hasCertField) { setCategory('GENERAL'); setCertType(null); }
  }, [hasCertField, category]);

  const authHeaders = async () => {
    const headers = {};
    const u = auth?.currentUser;
    if (u?.uid) headers['X-User-Id'] = u.uid;
    try {
      if (u && typeof u.getIdToken === 'function') {
        const token = await u.getIdToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      }
    } catch { /* non-fatal */ }
    return headers;
  };

  // Lazy-load the asset list the first time the picker opens.
  const openAssetPicker = async () => {
    setAssetPickerOpen((v) => !v);
    if (assets.length || assetsLoading) return;
    setAssetsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/assets`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      setAssets(list);
    } catch { /* ignore */ } finally { setAssetsLoading(false); }
  };

  const openAssigneePicker = async () => {
    setAssigneePickerOpen((v) => !v);
    if (users.length || usersLoading) return;
    setUsersLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE_URL}/admin/users`, { headers });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (Array.isArray(data?.users) ? data.users : (Array.isArray(data?.items) ? data.items : []));
        setUsers(list);
      }
    } catch { /* ignore */ } finally { setUsersLoading(false); }
  };

  const filteredAssets = useMemo(() => {
    const q = assetQuery.trim().toLowerCase();
    const base = assets
      // Hide QR-awaiting (UUID id, no sticker yet) and QR-reserved placeholders.
      .filter((a) => !isAssetIdAwaitingQr(a.id) && !isQrReserved(a))
      .map((a) => ({
        id: a.id,
        typeId: a.type_id || a.asset_types?.id || null,
        label: a.asset_types?.name || a.model || a.serial_number || a.id,
        sub: [a.model, a.serial_number, a.other_id].filter(Boolean).join(' · '),
        // All fields used for matching — name, model, serial, other id, description, id.
        hay: [a.asset_types?.name, a.model, a.serial_number, a.other_id, a.description, a.id]
          .filter(Boolean).join(' ').toLowerCase(),
      }));
    if (!q) return base.slice(0, 10);
    return base.filter((a) => a.hay.includes(q)).slice(0, 10);
  }, [assets, assetQuery]);

  // Block creating a Certificate task against an asset whose type can't hold one.
  const certBlocked = category === 'CERTIFICATE' && !!asset && certFieldStatus === 'missing';
  // Admins must assign the task to someone (the assignee picker is admin-only).
  const assigneeMissing = isAdmin && !assignee;

  const submit = async () => {
    const t = title.trim();
    if (!t || certBlocked || assigneeMissing) return;
    setSubmitting(true);
    const payload = {
      title: t,
      description: description.trim() || (isEdit ? null : undefined),
      category,
      // For edits send null to clear; for create omit when empty.
      cert_type: category === 'CERTIFICATE' ? (certType || (isEdit ? null : undefined)) : (isEdit ? null : undefined),
      priority,
      due_date: dueDate || (isEdit ? null : undefined),
      asset_id: asset?.id || (isEdit ? null : undefined),
      assigned_to_id: assignee?.id || (isEdit ? null : undefined),
    };
    const ok = isEdit ? await onUpdate(editTask.taskId, payload) : await onCreate(payload);
    setSubmitting(false);
    if (ok) onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.kav}>
          <View style={[s.card, { height: Math.round(winH * 0.92) }]}>
            <View style={s.header}>
              <Text style={s.headerTitle}>{isEdit ? 'Edit task' : 'New Task'}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <MaterialIcons name="close" size={24} color={Colors.sub} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
              {/* Asset — pick this first; the rest of the form appears after. */}
              <Text style={s.label}>Asset</Text>
              <View style={s.assetField}>
                <TouchableOpacity style={s.selectBtn} onPress={openAssetPicker}>
                  <MaterialIcons name="qr-code-2" size={18} color={Colors.primary} />
                  <Text style={s.selectBtnText} numberOfLines={1}>
                    {asset ? asset.label : 'Search and link an asset (optional)'}
                  </Text>
                  <MaterialIcons name={assetPickerOpen ? 'expand-less' : 'expand-more'} size={20} color={Colors.sub} />
                </TouchableOpacity>
                {assetPickerOpen && (
                  <View style={s.picker}>
                  {/* Search box stays pinned at the top */}
                  <View style={s.pickerSearchRow}>
                    <MaterialIcons name="search" size={18} color={Colors.sub} />
                    <TextInput
                      style={s.pickerSearchInput}
                      placeholder="Search by name, model, serial, other ID…"
                      placeholderTextColor={Colors.subtle}
                      value={assetQuery}
                      onChangeText={setAssetQuery}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoFocus
                    />
                    {assetQuery ? (
                      <TouchableOpacity onPress={() => setAssetQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <MaterialIcons name="close" size={18} color={Colors.sub} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  {assetsLoading ? (
                    <ActivityIndicator color={Colors.primary} style={{ paddingVertical: 12 }} />
                  ) : (
                    <ScrollView style={s.pickerList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                      {filteredAssets.map((a) => (
                        <TouchableOpacity
                          key={a.id}
                          style={s.pickerItem}
                          onPress={() => { setAsset({ id: a.id, label: a.label, typeId: a.typeId, sub: a.sub }); setAssetPickerOpen(false); }}
                        >
                          <Text style={s.pickerItemText} numberOfLines={1}>{a.label}</Text>
                          {a.sub ? <Text style={s.pickerItemSub} numberOfLines={1}>{a.sub}</Text> : null}
                          <Text style={s.pickerItemId} numberOfLines={1}>ID: {a.id}</Text>
                        </TouchableOpacity>
                      ))}
                      {filteredAssets.length === 0 && (
                        <Text style={s.pickerEmpty}>No matching assets</Text>
                      )}
                    </ScrollView>
                  )}
                  </View>
                )}
              </View>
              {asset ? (
                <>
                  <View style={s.assetInfo}>
                    {asset.sub ? <Text style={s.assetInfoSub} numberOfLines={2}>{asset.sub}</Text> : null}
                    <Text style={s.assetInfoId}>ID: {asset.id}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setAsset(null)} style={s.inlineClear}>
                    <Text style={s.clearText}>Remove linked asset</Text>
                  </TouchableOpacity>
                </>
              ) : null}

              {/* The rest of the form only appears once an asset is selected, so
                  the options can be tailored to that asset's type. */}
              {!asset ? (
                <Text style={s.gateHint}>Select an asset above to fill in the task details.</Text>
              ) : (
                <>
              {/* Title */}
              <Text style={s.label}>Title *</Text>
              <TextInput
                style={s.input}
                placeholder="What needs to be done?"
                placeholderTextColor={Colors.subtle}
                value={title}
                onChangeText={setTitle}
                maxLength={200}
              />

              {/* Description */}
              <Text style={s.label}>Description</Text>
              <TextInput
                style={[s.input, s.inputMultiline]}
                placeholder="Add more detail (optional)"
                placeholderTextColor={Colors.subtle}
                value={description}
                onChangeText={setDescription}
                multiline
                maxLength={2000}
              />

              {/* Category */}
              <Text style={s.label}>Category</Text>
              <View style={s.chipWrap}>
                {categories.map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[s.chip, category === c && s.chipOn]}
                    onPress={() => { setCategory(c); if (c !== 'CERTIFICATE') setCertType(null); }}
                  >
                    <Text style={[s.chipText, category === c && s.chipTextOn]}>{cap(c)}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Certificate type — only when the Certificate category is chosen */}
              {category === 'CERTIFICATE' && (
                <>
                  <Text style={s.label}>Certificate type</Text>
                  <View style={s.chipWrap}>
                    {CERT_TYPES.map((ct) => (
                      <TouchableOpacity
                        key={ct}
                        style={[s.chip, certType === ct && s.chipOn]}
                        onPress={() => setCertType(ct)}
                      >
                        <Text style={[s.chipText, certType === ct && s.chipTextOn]}>{ct}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {asset && certFieldStatus === 'checking' && (
                    <Text style={s.certNote}>Checking this asset's type…</Text>
                  )}
                  {asset && certFieldStatus === 'missing' && (
                    <View style={s.certWarn}>
                      <MaterialIcons name="warning-amber" size={16} color={Colors.dangerFg} />
                      <Text style={s.certWarnText}>
                        {asset.label}'s asset type has no certificate field. Pick a different asset or change the category.
                      </Text>
                    </View>
                  )}
                </>
              )}

              {/* Priority */}
              <Text style={s.label}>Priority</Text>
              <View style={s.chipWrap}>
                {PRIORITIES.map((p) => (
                  <TouchableOpacity
                    key={p}
                    style={[s.chip, priority === p && (p === 'HIGH' ? s.chipDanger : s.chipOn)]}
                    onPress={() => setPriority(p)}
                  >
                    <Text style={[s.chipText, priority === p && s.chipTextOn]}>{cap(p)}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Due date */}
              <Text style={s.label}>Due date</Text>
              <View style={s.row}>
                <TouchableOpacity style={s.selectBtn} onPress={() => setDateOpen(true)}>
                  <MaterialIcons name="event" size={18} color={Colors.primary} />
                  <Text style={s.selectBtnText}>{dueDate ? fmtDue(dueDate) : 'Set a due date'}</Text>
                </TouchableOpacity>
                {dueDate ? (
                  <TouchableOpacity onPress={() => setDueDate(null)} style={s.clearBtn}>
                    <Text style={s.clearText}>Clear</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {/* Assignee (admins only) — required */}
              {isAdmin && (
                <>
                  <Text style={s.label}>Assign to *</Text>
                  <TouchableOpacity style={s.selectBtn} onPress={openAssigneePicker}>
                    <MaterialIcons name="person" size={18} color={Colors.primary} />
                    <Text style={[s.selectBtnText, !assignee && { color: Colors.subtle }]} numberOfLines={1}>
                      {assignee ? assignee.label : 'Select'}
                    </Text>
                    <MaterialIcons name={assigneePickerOpen ? 'expand-less' : 'expand-more'} size={20} color={Colors.sub} />
                  </TouchableOpacity>
                  {assigneePickerOpen && (
                    <View style={s.picker}>
                      {usersLoading ? (
                        <ActivityIndicator color={Colors.primary} style={{ paddingVertical: 12 }} />
                      ) : (
                        users.map((u) => (
                          <TouchableOpacity
                            key={u.id}
                            style={s.pickerItem}
                            onPress={() => { setAssignee({ id: u.id, label: u.name || u.useremail || u.id }); setAssigneePickerOpen(false); }}
                          >
                            <Text style={s.pickerItemText} numberOfLines={1}>{u.name || u.useremail || u.id}</Text>
                            {u.useremail && u.name ? <Text style={s.pickerItemSub} numberOfLines={1}>{u.useremail}</Text> : null}
                          </TouchableOpacity>
                        ))
                      )}
                      {!usersLoading && users.length === 0 && (
                        <Text style={s.pickerEmpty}>No users found</Text>
                      )}
                    </View>
                  )}
                </>
              )}
                </>
              )}
            </ScrollView>

            {/* Footer */}
            <View style={s.footer}>
              <TouchableOpacity style={s.cancelBtn} onPress={onClose} disabled={submitting}>
                <Text style={s.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.submitBtn, (!title.trim() || submitting || certBlocked || assigneeMissing) && s.submitBtnDisabled]}
                onPress={submit}
                disabled={!title.trim() || submitting || certBlocked || assigneeMissing}
              >
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>{isEdit ? 'Save changes' : 'Create task'}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>

      <DatePickerModal
        locale="en-GB"
        mode="single"
        visible={dateOpen}
        onDismiss={() => setDateOpen(false)}
        date={dueDate ? new Date(dueDate + 'T00:00:00') : new Date()}
        onConfirm={({ date }) => {
          setDateOpen(false);
          if (!date) return;
          const y = date.getFullYear();
          const m = String(date.getMonth() + 1).padStart(2, '0');
          const d = String(date.getDate()).padStart(2, '0');
          setDueDate(`${y}-${m}-${d}`);
        }}
      />
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  kav: { width: '100%', maxWidth: 560, alignSelf: 'center' },
  card: {
    backgroundColor: Colors.bg,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    overflow: 'hidden',
    ...Shadows.lg,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.line,
  },
  headerTitle: { fontSize: sf(18), fontWeight: '900', color: Colors.text },
  body: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 20 },
  label: { fontSize: sf(12), fontWeight: '800', color: Colors.sub, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 14, marginBottom: 7 },
  gateHint: { fontSize: sf(13), color: Colors.sub, marginTop: 16, fontStyle: 'italic', textAlign: 'center' },
  input: {
    borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.md,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: sf(15), color: Colors.text,
    backgroundColor: Colors.card,
  },
  inputMultiline: { minHeight: 76, textAlignVertical: 'top' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999,
    borderWidth: 2, borderColor: Colors.line, backgroundColor: Colors.card,
  },
  chipOn: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  chipDanger: { borderColor: Colors.dangerFg, backgroundColor: Colors.dangerBg },
  chipText: { fontSize: sf(13), fontWeight: '700', color: Colors.sub2 },
  chipTextOn: { color: Colors.primary },
  certNote: { fontSize: sf(12), color: Colors.sub, marginTop: 8, fontStyle: 'italic' },
  certWarn: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 8,
    padding: 10, borderRadius: Radius.md,
    borderWidth: 2, borderColor: Colors.dangerBorder, backgroundColor: Colors.dangerBg,
  },
  certWarnText: { flex: 1, fontSize: sf(12), fontWeight: '700', color: Colors.dangerFg, lineHeight: sf(17) },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  selectBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1,
    borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.md,
    paddingHorizontal: 12, paddingVertical: 11, backgroundColor: Colors.card,
  },
  selectBtnText: { flex: 1, fontSize: sf(14), fontWeight: '700', color: Colors.text },
  assetInfo: { marginTop: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.line, backgroundColor: Colors.card },
  assetInfoSub: { fontSize: sf(13), color: Colors.text, fontWeight: '600' },
  assetInfoId: { fontSize: sf(12), color: Colors.accent, fontWeight: '800', marginTop: 3 },
  clearBtn: { paddingHorizontal: 10, paddingVertical: 8 },
  inlineClear: { paddingVertical: 6 },
  clearText: { fontSize: sf(12), fontWeight: '700', color: Colors.dangerFg },
  assetField: { position: 'relative', zIndex: 20 },
  // Raise above the fields below while the dropdown is open so the overlay wins.
  assetFieldOpen: { zIndex: 50 },
  picker: {
    borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.md,
    backgroundColor: Colors.card, marginTop: 8, overflow: 'hidden',
  },
  // Float the dropdown below the asset button, overlapping the fields beneath.
  pickerAbsolute: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    zIndex: 50,
    elevation: 12,
    ...Shadows.lg,
  },
  pickerSearchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 4,
    borderBottomWidth: 1, borderBottomColor: Colors.line,
    backgroundColor: Colors.bg,
  },
  pickerSearchInput: { flex: 1, paddingVertical: 10, fontSize: sf(14), color: Colors.text },
  pickerList: { maxHeight: 360 },
  pickerItem: { paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: Colors.line },
  pickerItemText: { fontSize: sf(14), fontWeight: '700', color: Colors.text },
  pickerItemSub: { fontSize: sf(12), color: Colors.sub, marginTop: 2 },
  pickerItemId: { fontSize: sf(11), color: Colors.accent, marginTop: 2, fontWeight: '700' },
  pickerEmpty: { padding: 12, fontSize: sf(13), color: Colors.sub, textAlign: 'center' },
  footer: {
    flexDirection: 'row', gap: 10, padding: 16,
    borderTopWidth: 1, borderTopColor: Colors.line,
  },
  cancelBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: Radius.md, borderWidth: 2, borderColor: Colors.line },
  cancelText: { fontSize: sf(15), fontWeight: '800', color: Colors.sub2 },
  submitBtn: { flex: 2, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: Radius.md, backgroundColor: Colors.primary },
  submitBtnDisabled: { opacity: 0.5 },
  submitText: { fontSize: sf(15), fontWeight: '900', color: '#fff' },
});
