// components/bookings/CreateBookingModal.js
// Create a booking: pick/scan a bookable asset, see its busy windows (bookings +
// hires), choose the dates + project, and submit. Server enforces the 6-week /
// 6-month rules and returns a friendly clash message on overlap.
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, Modal, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Platform, KeyboardAvoidingView, useWindowDimensions, Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { DatePickerModal } from 'react-native-paper-dates';
import { Colors, Radius, Shadows, sf } from '../../constants/uiTheme';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import { isAssetIdAwaitingQr } from '../../utils/assetId';
import AssetScannerModal from '../tasks/AssetScannerModal';

const SCAN_TO_LINK = Platform.OS !== 'web';

const toYMD = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(+dt)) return null;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};
const fmt = (ymd) => {
  if (!ymd) return null;
  const d = new Date(`${ymd}T00:00:00`);
  return Number.isNaN(+d) ? ymd : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
};
const isQrReserved = (a) =>
  String(a?.description || a?.fields?.description || '').trim().toLowerCase() === 'qr reserved asset';

export default function CreateBookingModal({ visible, onClose, onCreate, onUpdate, getAvailability, editBooking }) {
  const isEdit = !!editBooking;
  const { height: winH } = useWindowDimensions();
  const [asset, setAsset] = useState(null); // { id, label, sub }
  const [project, setProject] = useState('');
  const [dateFrom, setDateFrom] = useState(null);
  const [dateTo, setDateTo] = useState(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [windows, setWindows] = useState([]);
  const [windowsLoading, setWindowsLoading] = useState(false);
  const [maint, setMaint] = useState(null); // { maintenanceDue, nextServiceDate, status }

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanResolving, setScanResolving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [assets, setAssets] = useState([]);
  const [assetQuery, setAssetQuery] = useState('');
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);

  const reset = () => {
    setAsset(null); setProject(''); setDateFrom(null); setDateTo(null); setNotes('');
    setSubmitting(false); setError(''); setWindows([]); setMaint(null); setScannerOpen(false);
    setScanResolving(false); setPickerOpen(false); setAssetQuery('');
    setFromOpen(false); setToOpen(false);
  };
  useEffect(() => {
    if (!visible) { reset(); return; }
    if (editBooking) {
      // Editing: asset is fixed; prefill the editable fields.
      setAsset({ id: editBooking.assetId, label: editBooking.assetTypeName || editBooking.model || editBooking.assetId, sub: [editBooking.model, editBooking.serialNumber].filter(Boolean).join(' · ') });
      setProject(editBooking.project || '');
      setDateFrom(editBooking.dateFrom || null);
      setDateTo(editBooking.dateTo || null);
      setNotes(editBooking.notes || '');
    }
  }, [visible, editBooking]);

  // Load busy windows whenever the selected asset changes.
  useEffect(() => {
    let cancelled = false;
    if (!visible || !asset?.id) { setWindows([]); return; }
    setWindowsLoading(true);
    getAvailability(asset.id)
      .then((data) => { if (!cancelled) { setWindows(data?.windows || []); setMaint(data?.asset || null); } })
      .catch(() => { if (!cancelled) { setWindows([]); setMaint(null); } })
      .finally(() => { if (!cancelled) setWindowsLoading(false); });
    return () => { cancelled = true; };
  }, [visible, asset?.id, getAvailability]);

  const openPicker = async () => {
    setPickerOpen((v) => !v);
    if (assets.length || assetsLoading) return;
    setAssetsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/assets`);
      const data = await res.json();
      setAssets(Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []));
    } catch { /* ignore */ } finally { setAssetsLoading(false); }
  };

  const handleScanned = async (assetId) => {
    setScanResolving(true);
    try {
      if (isAssetIdAwaitingQr(assetId)) { Alert.alert('No asset assigned', 'This QR has no asset assigned yet.'); return; }
      const res = await fetch(`${API_BASE_URL}/assets/${encodeURIComponent(assetId)}`);
      if (!res.ok) { Alert.alert(res.status === 404 ? 'Not found' : 'Error', 'Could not look up that asset.'); return; }
      const a = await res.json();
      if (isQrReserved(a)) { Alert.alert('No asset assigned', 'This QR is reserved but has no asset yet.'); return; }
      setAsset({ id: a.id, label: a.asset_types?.name || a.model || a.serial_number || a.id, sub: [a.model, a.serial_number, a.other_id].filter(Boolean).join(' · ') });
      setScannerOpen(false); setError('');
    } catch { Alert.alert('Error', 'Failed to look up that asset.'); } finally { setScanResolving(false); }
  };

  const filteredAssets = useMemo(() => {
    const q = assetQuery.trim().toLowerCase();
    const base = assets
      .filter((a) => !isAssetIdAwaitingQr(a.id) && !isQrReserved(a))
      .map((a) => ({
        id: a.id,
        label: a.asset_types?.name || a.model || a.serial_number || a.id,
        sub: [a.model, a.serial_number, a.other_id].filter(Boolean).join(' · '),
        hay: [a.asset_types?.name, a.model, a.serial_number, a.other_id, a.id].filter(Boolean).join(' ').toLowerCase(),
      }));
    return (q ? base.filter((a) => a.hay.includes(q)) : base).slice(0, 10);
  }, [assets, assetQuery]);

  const canSubmit = !!asset && !!dateFrom && !!dateTo && !submitting;
  const maintWarn = !!maint && (maint.maintenanceDue || (!!maint.nextServiceDate && !!dateFrom && !!dateTo && dateFrom <= maint.nextServiceDate && maint.nextServiceDate <= dateTo));
  const maintText = maint?.maintenanceDue
    ? 'Heads up: this asset is flagged Maintenance Due.'
    : (maintWarn ? `Heads up: maintenance is due ${fmt(maint.nextServiceDate)}, within your window.` : '');

  const submit = async () => {
    if (!canSubmit) return;
    if (dateTo < dateFrom) { setError('End date must be on or after the start date.'); return; }
    setSubmitting(true); setError('');
    const payload = { project: project.trim() || undefined, date_from: dateFrom, date_to: dateTo, notes: notes.trim() || undefined };
    const result = isEdit ? await onUpdate(editBooking.id, payload) : await onCreate({ asset_id: asset.id, ...payload });
    setSubmitting(false);
    if (result?.ok) onClose();
    else setError(result?.error || 'Failed to save booking.');
  };

  const today = new Date();
  const horizon = new Date(); horizon.setMonth(horizon.getMonth() + 6);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.kav}>
          <View style={[s.card, { height: Math.round(winH * 0.92) }]}>
            <View style={s.header}>
              <Text style={s.headerTitle}>{isEdit ? 'Edit booking' : 'New booking'}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <MaterialIcons name="close" size={24} color={Colors.sub} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
              {/* Asset */}
              <Text style={s.label}>Asset</Text>
              {isEdit ? null : SCAN_TO_LINK ? (
                <TouchableOpacity style={s.scanBtn} onPress={() => setScannerOpen(true)}>
                  <MaterialIcons name="qr-code-scanner" size={20} color="#fff" />
                  <Text style={s.scanBtnText}>{asset ? 'Scan a different asset' : 'Scan asset QR to book'}</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity style={s.selectBtn} onPress={openPicker}>
                    <MaterialIcons name="qr-code-2" size={18} color={Colors.primary} />
                    <Text style={s.selectBtnText} numberOfLines={1}>{asset ? asset.label : 'Search for an asset to book'}</Text>
                    <MaterialIcons name={pickerOpen ? 'expand-less' : 'expand-more'} size={20} color={Colors.sub} />
                  </TouchableOpacity>
                  {pickerOpen && (
                    <View style={s.picker}>
                      <View style={s.pickerSearchRow}>
                        <MaterialIcons name="search" size={18} color={Colors.sub} />
                        <TextInput style={s.pickerSearchInput} placeholder="Search by name, model, serial…" placeholderTextColor={Colors.subtle} value={assetQuery} onChangeText={setAssetQuery} autoCapitalize="none" autoCorrect={false} autoFocus />
                      </View>
                      {assetsLoading ? <ActivityIndicator color={Colors.primary} style={{ paddingVertical: 12 }} /> : (
                        <ScrollView style={s.pickerList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                          {filteredAssets.map((a) => (
                            <TouchableOpacity key={a.id} style={s.pickerItem} onPress={() => { setAsset(a); setPickerOpen(false); setError(''); }}>
                              <Text style={s.pickerItemText} numberOfLines={1}>{a.label}</Text>
                              {a.sub ? <Text style={s.pickerItemSub} numberOfLines={1}>{a.sub}</Text> : null}
                            </TouchableOpacity>
                          ))}
                          {filteredAssets.length === 0 ? <Text style={s.pickerEmpty}>No matching assets</Text> : null}
                        </ScrollView>
                      )}
                    </View>
                  )}
                </>
              )}
              {asset ? (
                <View style={s.assetInfo}>
                  {asset.sub ? <Text style={s.assetInfoSub} numberOfLines={2}>{asset.sub}</Text> : null}
                  <Text style={s.assetInfoId}>ID: {asset.id}</Text>
                </View>
              ) : null}

              {/* Availability */}
              {asset ? (
                <>
                  <Text style={s.label}>Availability</Text>
                  {windowsLoading ? (
                    <ActivityIndicator color={Colors.primary} style={{ paddingVertical: 8 }} />
                  ) : windows.length === 0 ? (
                    <Text style={s.freeNote}><MaterialIcons name="check-circle" size={13} color={Colors.successFg} /> Free — no bookings or hires on record.</Text>
                  ) : (
                    <View style={s.busyList}>
                      {windows.map((w, i) => (
                        <View key={`w-${i}`} style={s.busyRow}>
                          <View style={[s.busyDot, { backgroundColor: w.kind === 'hire' ? '#9333EA' : Colors.infoFg }]} />
                          <Text style={s.busyText} numberOfLines={1}>
                            {w.kind === 'hire' ? 'On hire' : (w.label || 'Booked')} · {fmt(w.from)} → {w.to ? fmt(w.to) : 'open'}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </>
              ) : null}

              {/* Dates */}
              <View style={s.two}>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>From</Text>
                  <TouchableOpacity style={s.selectBtn} onPress={() => setFromOpen(true)}>
                    <MaterialIcons name="event" size={18} color={Colors.primary} />
                    <Text style={[s.selectBtnText, !dateFrom && { color: Colors.subtle }]}>{dateFrom ? fmt(dateFrom) : 'Start'}</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>To</Text>
                  <TouchableOpacity style={s.selectBtn} onPress={() => setToOpen(true)}>
                    <MaterialIcons name="event" size={18} color={Colors.primary} />
                    <Text style={[s.selectBtnText, !dateTo && { color: Colors.subtle }]}>{dateTo ? fmt(dateTo) : 'End'}</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {maintWarn ? (
                <View style={s.warnBox}>
                  <MaterialIcons name="build" size={16} color={Colors.warningFg} />
                  <Text style={s.warnText}>{maintText}</Text>
                </View>
              ) : null}

              {/* Project */}
              <Text style={s.label}>Project</Text>
              <TextInput style={s.input} placeholder="e.g. Riverside Survey" placeholderTextColor={Colors.subtle} value={project} onChangeText={setProject} maxLength={200} />

              {/* Notes */}
              <Text style={s.label}>Notes</Text>
              <TextInput style={[s.input, s.inputMultiline]} placeholder="Optional" placeholderTextColor={Colors.subtle} value={notes} onChangeText={setNotes} multiline maxLength={1000} />

              {error ? (
                <View style={s.errorBox}>
                  <MaterialIcons name="error-outline" size={16} color={Colors.dangerFg} />
                  <Text style={s.errorText}>{error}</Text>
                </View>
              ) : null}
            </ScrollView>

            <View style={s.footer}>
              <TouchableOpacity style={s.cancelBtn} onPress={onClose} disabled={submitting}>
                <Text style={s.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.submitBtn, !canSubmit && s.submitBtnDisabled]} onPress={submit} disabled={!canSubmit}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>{isEdit ? 'Save changes' : 'Create booking'}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>

      {SCAN_TO_LINK && (
        <AssetScannerModal visible={scannerOpen} busy={scanResolving} onClose={() => { if (!scanResolving) setScannerOpen(false); }} onScanned={handleScanned} />
      )}
      <DatePickerModal locale="en-GB" mode="single" visible={fromOpen} onDismiss={() => setFromOpen(false)} date={dateFrom ? new Date(`${dateFrom}T00:00:00`) : today} validRange={{ startDate: today, endDate: horizon }} onConfirm={({ date }) => { setFromOpen(false); if (date) { setDateFrom(toYMD(date)); if (dateTo && toYMD(date) > dateTo) setDateTo(toYMD(date)); } }} />
      <DatePickerModal locale="en-GB" mode="single" visible={toOpen} onDismiss={() => setToOpen(false)} date={dateTo ? new Date(`${dateTo}T00:00:00`) : (dateFrom ? new Date(`${dateFrom}T00:00:00`) : today)} validRange={{ startDate: dateFrom ? new Date(`${dateFrom}T00:00:00`) : today }} onConfirm={({ date }) => { setToOpen(false); if (date) setDateTo(toYMD(date)); }} />
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  kav: { width: '100%', maxWidth: 560, alignSelf: 'center' },
  card: { backgroundColor: Colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: 'hidden', ...Shadows.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.line },
  headerTitle: { fontSize: sf(18), fontWeight: '900', color: Colors.text },
  body: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 20 },
  label: { fontSize: sf(12), fontWeight: '800', color: Colors.sub, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 14, marginBottom: 7 },
  input: { borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: sf(15), color: Colors.text, backgroundColor: Colors.card },
  inputMultiline: { minHeight: 64, textAlignVertical: 'top' },
  two: { flexDirection: 'row', gap: 12 },
  scanBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: Radius.md, paddingVertical: 13, paddingHorizontal: 14, backgroundColor: Colors.primary },
  scanBtnText: { fontSize: sf(15), fontWeight: '900', color: '#fff' },
  selectBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: Colors.card },
  selectBtnText: { flex: 1, fontSize: sf(14), fontWeight: '700', color: Colors.text },
  picker: { borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.md, backgroundColor: Colors.card, marginTop: 8, overflow: 'hidden' },
  pickerSearchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: Colors.line, backgroundColor: Colors.bg },
  pickerSearchInput: { flex: 1, paddingVertical: 10, fontSize: sf(14), color: Colors.text },
  pickerList: { maxHeight: 240 },
  pickerItem: { paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: Colors.line },
  pickerItemText: { fontSize: sf(14), fontWeight: '700', color: Colors.text },
  pickerItemSub: { fontSize: sf(12), color: Colors.sub, marginTop: 2 },
  pickerEmpty: { padding: 12, fontSize: sf(13), color: Colors.sub, textAlign: 'center' },
  assetInfo: { marginTop: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.line, backgroundColor: Colors.card },
  assetInfoSub: { fontSize: sf(13), color: Colors.text, fontWeight: '600' },
  assetInfoId: { fontSize: sf(12), color: Colors.accent, fontWeight: '800', marginTop: 3 },
  freeNote: { fontSize: sf(13), color: Colors.successFg, fontWeight: '600' },
  busyList: { gap: 6 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  busyDot: { width: 10, height: 10, borderRadius: 3 },
  busyText: { fontSize: sf(12.5), color: Colors.sub, flex: 1 },
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 14, padding: 10, borderRadius: Radius.md, borderWidth: 2, borderColor: Colors.dangerBorder, backgroundColor: Colors.dangerBg },
  errorText: { flex: 1, fontSize: sf(13), fontWeight: '700', color: Colors.dangerFg, lineHeight: sf(18) },
  warnBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 6, padding: 10, borderRadius: Radius.md, borderWidth: 2, borderColor: Colors.warningBorder, backgroundColor: Colors.warningBg },
  warnText: { flex: 1, fontSize: sf(13), fontWeight: '700', color: Colors.warningFg, lineHeight: sf(18) },
  footer: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: Colors.line },
  cancelBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: Radius.md, borderWidth: 2, borderColor: Colors.line },
  cancelText: { fontSize: sf(15), fontWeight: '800', color: Colors.sub2 },
  submitBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: Radius.md, backgroundColor: Colors.primary, flexDirection: 'row' },
  submitBtnDisabled: { opacity: 0.5 },
  submitText: { fontSize: sf(15), fontWeight: '900', color: '#fff' },
});
