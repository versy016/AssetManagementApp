// app/repair/[assetId].js
// Repair menu reached from the "Repair" shortcut after scanning an asset.
// Mirrors the Maintenance screen (app/servicing/[assetId].js) so both flows feel
// the same, with two clearly-separated options:
//
//   1. Log a repair       → records a COMPLETED repair (history, no open task) and
//      clears the Needs-repair flag. Optional cost, notes and a repair report.
//
//   2. Repair required    → reports a fault that still needs doing. Creates a REPAIR
//      task (which raises the Needs-repair flag server-side) so it shows in Tasks
//      until someone signs it off.
//
// Repair-focused by design: no category picker and no assignee — just the fault.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, Alert, ScrollView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { DatePickerModal } from 'react-native-paper-dates';
import { getAuth } from 'firebase/auth';
import * as DocumentPicker from 'expo-document-picker';

import ScreenHeader from '../../components/ui/ScreenHeader';
import StatusBadge, { normalizeStatus } from '../../components/ui/StatusBadge';
import ConfirmModal from '../../components/ui/ConfirmModal';
import AssetWorkPanel from '../../components/work/AssetWorkPanel';
import { Colors, Radius, Shadows, sf } from '../../constants/uiTheme';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import { useTasksCount } from '../../contexts/TasksCountContext';
import { fetchTaskCount } from '../../utils/fetchTaskCount';
import { FIELD_LIMITS } from '../../constants/fieldLimits';
import { ASSET_DOCUMENT_FIELD_HINT } from '../../constants/uploadFormats';
import logger from '../../utils/logger';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];

// ── Date helpers (kept local so this screen is self-contained) ──────────────
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function addMonths(date, months) {
  const base = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const target = new Date(base.getFullYear(), base.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(base.getDate(), last));
  return target;
}
function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
// The action API validates occurred_at as a full ISO datetime — turn a
// date-only string (YYYY-MM-DD) into midnight-local ISO so it passes.
function toDateTimeISO(ymd) {
  if (!ymd) return new Date().toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    const d = new Date(`${ymd}T00:00:00`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return ymd;
}
function prettyDate(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
  } catch {
    return iso;
  }
}

// When did the repair happen: 10 years ago .. today.
const pastWindow = () => ({ startDate: addMonths(startOfToday(), -120), endDate: startOfToday() });
// When is it needed by: today .. 12 months ahead.
const dueWindow = () => ({ startDate: startOfToday(), endDate: addMonths(startOfToday(), 12) });

async function authHeaders(json = true) {
  const headers = json ? { 'Content-Type': 'application/json' } : {};
  try {
    const current = getAuth()?.currentUser;
    if (current?.uid) headers['X-User-Id'] = current.uid;
    if (current?.displayName) headers['X-User-Name'] = current.displayName;
    if (current?.email) headers['X-User-Email'] = current.email;
    if (current && typeof current.getIdToken === 'function') {
      const token = await current.getIdToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
  } catch (_) { /* unauthenticated fallthrough */ }
  return headers;
}

export default function RepairScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const assetId = params?.assetId ? String(params.assetId) : null;
  const returnTo = params?.returnTo ? String(params.returnTo) : null;
  const { setTaskCount } = useTasksCount();

  const [asset, setAsset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState(null); // null | 'log' | 'required'
  const [submitting, setSubmitting] = useState(false);
  const [resultUi, setResultUi] = useState(null);
  const [workKey, setWorkKey] = useState(0); // bumped so the work panel reloads after a submit

  // "Log a repair" form state
  const [repairDate, setRepairDate] = useState(toISO(startOfToday()));
  const [summary, setSummary] = useState('');
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');
  const [report, setReport] = useState(null);

  // "Repair required" form state
  const [faultTitle, setFaultTitle] = useState('');
  const [faultDetail, setFaultDetail] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [dueDate, setDueDate] = useState(null);

  const backToTarget = useCallback(() => {
    if (returnTo) router.replace(returnTo);
    else if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/dashboard');
  }, [returnTo, router]);

  useEffect(() => {
    let ignore = false;
    if (!assetId) { setLoading(false); return; }
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE_URL}/assets/${assetId}`);
        if (!res.ok) throw new Error('Unable to load asset');
        const data = await res.json();
        if (!ignore) setAsset(data);
      } catch (error) {
        if (!ignore) {
          Alert.alert('Error', error?.message || 'Failed to load asset', [{ text: 'OK', onPress: () => backToTarget() }]);
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [assetId, backToTarget]);

  const refreshTaskBadge = useCallback(async () => {
    try {
      const count = await fetchTaskCount();
      setTaskCount(count);
    } catch (_) { /* non-fatal */ }
  }, [setTaskCount]);

  // ── Submit: Log a completed repair (no open task) ────────────────────────
  const submitLog = useCallback(async () => {
    if (submitting) return;
    if (!summary.trim()) {
      setResultUi({ phase: 'result', title: 'Missing detail', message: 'Please describe what was repaired.', error: true });
      return;
    }
    setSubmitting(true);
    try {
      const headers = await authHeaders(true);
      // 1) History: completed repair, explicitly NOT requiring sign-off.
      const detail = {
        action: 'Repair',
        date: repairDate,
        summary: summary.trim(),
        cost: Number(cost) || 0,
        notes: notes.trim() || undefined,
      };
      const actRes = await fetch(`${API_BASE_URL}/assets/${assetId}/actions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'REPAIR',
          note: detail.summary,
          occurred_at: toDateTimeISO(repairDate),
          details: detail,
          data: { requires_signoff: false, completed: true },
        }),
      });
      if (!actRes.ok) throw new Error((await actRes.text()) || 'Failed to log the repair');

      // 2) The repair is done, so clear the Needs-repair flag.
      const putRes = await fetch(`${API_BASE_URL}/assets/${assetId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ needs_repair: false, skip_required_documents: true }),
      });
      if (!putRes.ok) throw new Error((await putRes.text()) || 'Failed to clear the repair flag');

      // 3) Optional repair report.
      if (report) {
        try {
          const fileObj = Platform.OS === 'web'
            ? report
            : { uri: report.uri, name: report.name || 'repair-report', type: report.mimeType || 'application/pdf' };
          const fd = new FormData();
          fd.append('file', fileObj);
          fd.append('title', 'Repair Report');
          fd.append('kind', 'Repair Report');
          fd.append('related_date_label', 'Repair Report');
          fd.append('related_date', repairDate);
          await fetch(`${API_BASE_URL}/assets/${assetId}/documents/upload`, {
            method: 'POST',
            headers: await authHeaders(false),
            body: fd,
          });
        } catch (e) {
          logger.error('Repair: report upload failed', e);
        }
      }

      await refreshTaskBadge();
      setWorkKey((n) => n + 1);
      setResultUi({
        phase: 'confirm',
        title: 'Repair logged',
        message: `Recorded the repair on ${prettyDate(repairDate)}. The asset is no longer flagged as needing repair.`,
        confirmLabel: 'View asset',
        cancelLabel: 'Done',
        onConfirm: () => { setResultUi(null); router.replace({ pathname: '/asset/[assetId]', params: { assetId } }); },
        onCancel: () => { setResultUi(null); backToTarget(); },
      });
    } catch (e) {
      setResultUi({ phase: 'result', title: 'Error', message: e?.message || 'Failed to log the repair', error: true });
    } finally {
      setSubmitting(false);
    }
  }, [submitting, summary, repairDate, cost, notes, report, assetId, refreshTaskBadge, backToTarget, router]);

  // ── Submit: Repair required (creates the REPAIR task) ────────────────────
  const submitRequired = useCallback(async () => {
    if (submitting) return;
    if (!faultTitle.trim()) {
      setResultUi({ phase: 'result', title: 'Missing detail', message: 'Please describe what needs repair.', error: true });
      return;
    }
    setSubmitting(true);
    try {
      const headers = await authHeaders(true);
      const body = {
        title: faultTitle.trim(),
        category: 'REPAIR',
        priority,
        asset_id: assetId,
      };
      if (faultDetail.trim()) body.description = faultDetail.trim();
      if (dueDate) body.due_date = dueDate;

      const res = await fetch(`${API_BASE_URL}/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.text()) || 'Failed to report the repair');

      await refreshTaskBadge();
      setWorkKey((n) => n + 1);
      setResultUi({
        phase: 'confirm',
        title: 'Repair reported',
        message: `"${faultTitle.trim()}" is now flagged as needing repair${dueDate ? `, due ${prettyDate(dueDate)}` : ''}. It stays open in Tasks until it's signed off.`,
        confirmLabel: 'View asset',
        cancelLabel: 'Done',
        onConfirm: () => { setResultUi(null); router.replace({ pathname: '/asset/[assetId]', params: { assetId } }); },
        onCancel: () => { setResultUi(null); backToTarget(); },
      });
    } catch (e) {
      setResultUi({ phase: 'result', title: 'Error', message: e?.message || 'Failed to report the repair', error: true });
    } finally {
      setSubmitting(false);
    }
  }, [submitting, faultTitle, faultDetail, priority, dueDate, assetId, refreshTaskBadge, backToTarget, router]);

  const assetType = asset?.asset_types?.name || asset?.name || 'Asset';
  const model = asset?.model || asset?.description || '';
  const serial = asset?.serial_number || '';
  const assignedTo = asset?.users?.name || asset?.users?.useremail || 'Unassigned';

  const headerTitle = mode === 'log' ? 'Log a Repair' : mode === 'required' ? 'Repair Required' : 'Repair';

  const onBack = useCallback(() => {
    if (mode) { setMode(null); return; }
    backToTarget();
  }, [mode, backToTarget]);

  return (
    <SafeAreaView style={s.safe}>
      <ScreenHeader title={headerTitle} backLabel="Back" onBack={onBack} />
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {loading ? (
          <View style={s.center}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={s.loadingText}>Loading asset…</Text>
          </View>
        ) : !asset ? (
          <View style={s.center}>
            <MaterialIcons name="error-outline" size={40} color={Colors.dangerFg} />
            <Text style={s.errorText}>Asset not found.</Text>
          </View>
        ) : (
          <>
            {/* Asset summary card */}
            <View style={s.assetCard}>
              <View style={[s.accentBar, { backgroundColor: Colors.warningFg }]} />
              <View style={s.cardBody}>
                <View style={s.titleRow}>
                  <Text style={s.assetTitle} numberOfLines={2}>{assetType}</Text>
                  <View style={s.idChip}><Text style={s.idChipText}>{asset.id}</Text></View>
                </View>
                {model ? <Text style={s.assetModel}>{model}</Text> : null}
                <View style={s.infoGrid}>
                  {serial ? (
                    <View style={s.infoCell}><Text style={s.infoLabel}>SERIAL</Text><Text style={s.infoValue}>{serial}</Text></View>
                  ) : null}
                  <View style={s.infoCell}><Text style={s.infoLabel}>ASSIGNED TO</Text><Text style={s.infoValue}>{assignedTo}</Text></View>
                  <View style={s.infoCell}>
                    <Text style={s.infoLabel}>STATUS</Text>
                    <View style={{ marginTop: 4 }}><StatusBadge status={normalizeStatus(asset.status)} /></View>
                  </View>
                </View>
                {asset.needs_repair ? (
                  <View style={s.nextRow}>
                    <MaterialIcons name="build" size={14} color={Colors.warningFg} />
                    <Text style={[s.nextText, { color: Colors.warningFg }]}>Currently flagged as needing repair</Text>
                  </View>
                ) : null}
              </View>
            </View>

            {/* Menu */}
            {!mode ? (
              <View style={{ gap: 12, marginTop: 4 }}>
                <Text style={s.menuHeading}>What would you like to do?</Text>

                <TouchableOpacity style={s.optionCard} activeOpacity={0.85} onPress={() => setMode('log')}>
                  <View style={[s.optionIcon, { backgroundColor: Colors.accentMuted }]}>
                    <MaterialIcons name="history" size={22} color={Colors.accent} />
                  </View>
                  <View style={s.optionTextWrap}>
                    <Text style={s.optionTitle}>Log a repair</Text>
                    <Text style={s.optionSub}>Record a repair that has already been done. Clears the Needs-repair flag. No task is created.</Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={22} color={Colors.sub2} />
                </TouchableOpacity>

                <TouchableOpacity style={s.optionCard} activeOpacity={0.85} onPress={() => setMode('required')}>
                  <View style={[s.optionIcon, { backgroundColor: Colors.warningBg }]}>
                    <MaterialIcons name="report-problem" size={22} color={Colors.warningFg} />
                  </View>
                  <View style={s.optionTextWrap}>
                    <Text style={s.optionTitle}>Repair required</Text>
                    <Text style={s.optionSub}>Report a fault that still needs fixing. Flags the asset and creates a task that stays open until it's signed off.</Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={22} color={Colors.sub2} />
                </TouchableOpacity>

                {/* Outstanding repairs (sign-off-able) + past repair record */}
                <AssetWorkPanel
                  asset={asset}
                  assetId={assetId}
                  kind="REPAIR"
                  reloadKey={workKey}
                  onChanged={(patch) => {
                    setAsset((prev) => (prev ? { ...prev, ...patch } : prev));
                    refreshTaskBadge();
                  }}
                />
              </View>
            ) : null}

            {/* Option 1 — Log a completed repair */}
            {mode === 'log' ? (
              <View style={s.formCard}>
                <DateField label="When was it repaired?" value={repairDate} onChange={setRepairDate} validRange={pastWindow()} />

                <Text style={s.fieldLabel}>What was repaired? *</Text>
                <TextInput
                  style={s.input}
                  placeholder="e.g. Replaced cracked screen"
                  placeholderTextColor={Colors.muted}
                  value={summary}
                  onChangeText={setSummary}
                  maxLength={FIELD_LIMITS.DESCRIPTION}
                />

                <Text style={s.fieldLabel}>Cost (optional)</Text>
                <TextInput
                  style={s.input}
                  placeholder="0"
                  keyboardType="numeric"
                  placeholderTextColor={Colors.muted}
                  value={cost}
                  onChangeText={setCost}
                />

                <Text style={s.fieldLabel}>Notes (optional)</Text>
                <TextInput
                  style={[s.input, { height: 88, textAlignVertical: 'top' }]}
                  placeholder="Anything worth recording…"
                  placeholderTextColor={Colors.muted}
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                  maxLength={FIELD_LIMITS.NOTES}
                />

                <Text style={s.fieldLabel}>Repair report (optional)</Text>
                <Text style={s.hint}>{ASSET_DOCUMENT_FIELD_HINT}</Text>
                {report ? <Text style={s.attached}>Attached: {report.name || 'document'}</Text> : null}
                <TouchableOpacity
                  style={s.secondaryBtn}
                  onPress={async () => {
                    try {
                      const res = await DocumentPicker.getDocumentAsync({
                        type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
                        multiple: false,
                      });
                      if (res.canceled) return;
                      const picked = res.assets?.[0];
                      if (picked) setReport(picked);
                    } catch (e) {
                      Alert.alert('Error', e?.message || 'Failed to pick document');
                    }
                  }}
                >
                  <MaterialIcons name="attach-file" size={18} color={Colors.text} />
                  <Text style={s.secondaryBtnText}>{report ? 'Replace report' : 'Attach report'}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[s.primaryBtn, (submitting || !summary.trim()) && { opacity: 0.6 }]}
                  onPress={submitLog}
                  disabled={submitting || !summary.trim()}
                >
                  {submitting ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>Log Repair</Text>}
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Option 2 — Repair required */}
            {mode === 'required' ? (
              <View style={s.formCard}>
                <View style={s.banner}>
                  <MaterialIcons name="info-outline" size={16} color={Colors.warningFg} />
                  <Text style={s.bannerText}>
                    This flags the asset as needing repair and creates a task. It stays open in Tasks
                    until someone logs the repair or signs it off.
                  </Text>
                </View>

                <Text style={s.fieldLabel}>What needs repair? *</Text>
                <TextInput
                  style={s.input}
                  placeholder="e.g. Cracked screen, won't power on"
                  placeholderTextColor={Colors.muted}
                  value={faultTitle}
                  onChangeText={setFaultTitle}
                  maxLength={200}
                />

                <Text style={s.fieldLabel}>Description (optional)</Text>
                <TextInput
                  style={[s.input, { height: 88, textAlignVertical: 'top' }]}
                  placeholder="More detail about the fault…"
                  placeholderTextColor={Colors.muted}
                  value={faultDetail}
                  onChangeText={setFaultDetail}
                  multiline
                  maxLength={FIELD_LIMITS.NOTES}
                />

                <Text style={s.fieldLabel}>Priority</Text>
                <View style={s.chipRow}>
                  {PRIORITIES.map((p) => (
                    <TouchableOpacity
                      key={p}
                      style={[s.chip, priority === p && (p === 'HIGH' ? s.chipDanger : s.chipOn)]}
                      onPress={() => setPriority(p)}
                    >
                      <Text style={[s.chipText, priority === p && s.chipTextOn]}>
                        {p.charAt(0) + p.slice(1).toLowerCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <DateField
                  label="Needed by (optional)"
                  value={dueDate}
                  onChange={setDueDate}
                  validRange={dueWindow()}
                  placeholder="No date set"
                  onClear={dueDate ? () => setDueDate(null) : null}
                />

                <TouchableOpacity
                  style={[s.primaryBtn, (submitting || !faultTitle.trim()) && { opacity: 0.6 }]}
                  onPress={submitRequired}
                  disabled={submitting || !faultTitle.trim()}
                >
                  {submitting ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>Report Repair</Text>}
                </TouchableOpacity>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      <ConfirmModal
        visible={!!resultUi}
        phase={resultUi?.phase || 'result'}
        title={resultUi?.title || ''}
        message={resultUi?.message || ''}
        resultError={!!resultUi?.error}
        confirmLabel={resultUi?.confirmLabel || 'Confirm'}
        cancelLabel={resultUi?.cancelLabel || 'Cancel'}
        onConfirm={() => { if (resultUi?.onConfirm) resultUi.onConfirm(); else setResultUi(null); }}
        onCancel={() => { if (resultUi?.onCancel) resultUi.onCancel(); else setResultUi(null); }}
        onDismiss={() => { if (resultUi?.onCancel) resultUi.onCancel(); else setResultUi(null); }}
      />
    </SafeAreaView>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────
function DateField({ label, value, onChange, validRange, helper, placeholder, onClear }) {
  const [open, setOpen] = useState(false);
  const parsed = useMemo(() => {
    try { return value ? new Date(value) : new Date(); } catch { return new Date(); }
  }, [value]);
  return (
    <View>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={s.dateRow}>
        <TouchableOpacity style={[s.dateInput, { flex: 1 }]} onPress={() => setOpen(true)}>
          <MaterialIcons name="event" size={18} color={Colors.sub} />
          <Text style={[s.dateText, !value && { color: Colors.muted }]}>
            {value ? prettyDate(value) : (placeholder || 'Select date')}
          </Text>
        </TouchableOpacity>
        {onClear ? (
          <TouchableOpacity onPress={onClear} style={s.clearBtn}>
            <Text style={s.clearText}>Clear</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {helper ? <Text style={s.hint}>{helper}</Text> : null}
      <DatePickerModal
        locale="en-GB"
        mode="single"
        visible={open}
        onDismiss={() => setOpen(false)}
        date={parsed}
        validRange={validRange}
        onConfirm={({ date }) => { setOpen(false); onChange(toISO(date)); }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40, gap: 14, width: '100%', maxWidth: 760, alignSelf: 'center' },
  center: { paddingVertical: 60, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: Colors.sub, fontSize: sf(15), fontWeight: '500' },
  errorText: { color: Colors.dangerFg, fontSize: sf(16), fontWeight: '700' },

  assetCard: { flexDirection: 'row', borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.lg, backgroundColor: Colors.card, overflow: 'hidden', ...Shadows.card },
  accentBar: { width: 5, alignSelf: 'stretch' },
  cardBody: { flex: 1, padding: 16, gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, justifyContent: 'space-between' },
  assetTitle: { fontSize: sf(18), fontWeight: '900', color: Colors.text, flex: 1 },
  idChip: { backgroundColor: Colors.primary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.sm, flexShrink: 0 },
  idChipText: { color: '#FFFFFF', fontSize: sf(11), fontWeight: '700', letterSpacing: 0.5 },
  assetModel: { fontSize: sf(14), color: Colors.sub, fontWeight: '500', marginTop: 2 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  infoCell: { flex: 1, minWidth: 80 },
  infoLabel: { fontSize: sf(10), fontWeight: '800', letterSpacing: 0.8, color: Colors.sub2, marginBottom: 2 },
  infoValue: { fontSize: sf(13), fontWeight: '700', color: Colors.text },
  nextRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  nextText: { fontSize: sf(12), color: Colors.sub, fontWeight: '600' },

  menuHeading: { fontSize: sf(13), fontWeight: '800', color: Colors.sub, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4, marginBottom: 2 },
  optionCard: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18, paddingHorizontal: 18, borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.lg, backgroundColor: Colors.card, ...Shadows.card },
  optionIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  optionTextWrap: { flex: 1, gap: 3 },
  optionTitle: { fontSize: sf(16), fontWeight: '800', color: Colors.text },
  optionSub: { fontSize: sf(12), color: Colors.sub, lineHeight: sf(17) },

  formCard: { padding: 16, borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.lg, backgroundColor: Colors.card, gap: 6, ...Shadows.card },
  fieldLabel: { fontSize: sf(13), fontWeight: '700', color: Colors.text, marginTop: 10, marginBottom: 6 },
  input: { borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.md, padding: 12, color: Colors.text, backgroundColor: Colors.card },
  hint: { fontSize: sf(11), color: Colors.sub2, marginTop: 4, lineHeight: sf(16) },
  attached: { marginTop: 6, fontStyle: 'italic', color: Colors.sub },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateInput: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.md, padding: 12, backgroundColor: Colors.card },
  dateText: { color: Colors.text, fontWeight: '600' },
  clearBtn: { paddingHorizontal: 12, paddingVertical: 12 },
  clearText: { fontSize: sf(12.5), fontWeight: '700', color: Colors.sub },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1.5, borderColor: Colors.line, backgroundColor: Colors.chip },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipDanger: { backgroundColor: Colors.dangerFg, borderColor: Colors.dangerFg },
  chipText: { fontWeight: '700', color: Colors.sub, fontSize: sf(12.5) },
  chipTextOn: { color: '#fff' },

  banner: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: Radius.md, backgroundColor: Colors.warningBg, borderWidth: 1, borderColor: Colors.warningBorder, marginBottom: 4 },
  bannerText: { flex: 1, fontSize: sf(12), color: Colors.warningFg, lineHeight: sf(17) },

  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: Radius.md, borderWidth: 2, borderColor: Colors.line, backgroundColor: Colors.chip, marginTop: 4 },
  secondaryBtnText: { fontWeight: '700', color: Colors.text },
  primaryBtn: { marginTop: 18, paddingVertical: 15, borderRadius: Radius.md, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: sf(15) },
});
