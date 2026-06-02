// app/servicing/[assetId].js
// Servicing menu reached from the "Servicing" shortcut after scanning an asset.
//
// Two clearly-separated flows (single service cadence per asset — they never
// overlap because both write the SAME assets.next_service_date):
//
//   1. Log a PAST service  → records a completed MAINTENANCE action (history,
//      NO open task) and sets the next service due date (default +6 months,
//      capped at +6 months).
//
//   2. Schedule / today's service → sets assets.next_service_date to the chosen
//      due date (today … +6 months). That derives the normal date-based service
//      task, which the assigned user later actions and closes ("service done"),
//      and is then offered to schedule the next one (handled by the existing
//      TaskActionModal flow).
//
// The 6-month limit is enforced on every future-service picker via validRange.

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
import { Colors, Radius, Shadows, sf } from '../../constants/uiTheme';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import { useTasksCount } from '../../contexts/TasksCountContext';
import { fetchTaskCount } from '../../utils/fetchTaskCount';
import { FIELD_LIMITS } from '../../constants/fieldLimits';
import { ASSET_DOCUMENT_FIELD_HINT } from '../../constants/uploadFormats';
import logger from '../../utils/logger';

const SERVICE_WINDOW_MONTHS = 6;

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

// Future-service window: today .. today + 6 months.
const serviceWindow = () => ({ startDate: startOfToday(), endDate: addMonths(startOfToday(), SERVICE_WINDOW_MONTHS) });
// Past window for "when was it serviced": 10 years ago .. today.
const pastWindow = () => ({ startDate: addMonths(startOfToday(), -120), endDate: startOfToday() });

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

export default function ServicingScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const assetId = params?.assetId ? String(params.assetId) : null;
  const returnTo = params?.returnTo ? String(params.returnTo) : null;
  const { setTaskCount } = useTasksCount();

  const [asset, setAsset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState(null); // null | 'past' | 'schedule'
  const [submitting, setSubmitting] = useState(false);

  // Past-service form state
  const [serviceDate, setServiceDate] = useState(toISO(startOfToday()));
  const [summary, setSummary] = useState('');
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');
  const [report, setReport] = useState(null);
  const [nextDate, setNextDate] = useState(toISO(addMonths(startOfToday(), SERVICE_WINDOW_MONTHS)));

  // Schedule form state
  const [dueDate, setDueDate] = useState(toISO(startOfToday()));

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
      // Server-side count derives from the user's token; args are ignored.
      const count = await fetchTaskCount();
      setTaskCount(count);
    } catch (_) { /* non-fatal */ }
  }, [setTaskCount]);

  // ── Submit: Log a PAST service (no open task) ────────────────────────────
  const submitPast = useCallback(async () => {
    if (submitting) return;
    if (!nextDate) { Alert.alert('Missing date', 'Please choose when the next service is due.'); return; }
    setSubmitting(true);
    try {
      const headers = await authHeaders(true);
      // 1) History: completed maintenance, explicitly NOT requiring sign-off.
      const detail = {
        action: 'Maintenance',
        date: serviceDate,
        summary: summary.trim() || 'Service',
        cost: Number(cost) || 0,
        notes: notes.trim() || undefined,
      };
      const actRes = await fetch(`${API_BASE_URL}/assets/${assetId}/actions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'MAINTENANCE',
          note: detail.summary,
          occurred_at: serviceDate,
          details: detail,
          data: { requires_signoff: false, completed: true },
        }),
      });
      if (!actRes.ok) throw new Error((await actRes.text()) || 'Failed to log the service');

      // 2) Set the next service due date (the only forward-looking item).
      const putRes = await fetch(`${API_BASE_URL}/assets/${assetId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ next_service_date: nextDate, skip_required_documents: true }),
      });
      if (!putRes.ok) throw new Error((await putRes.text()) || 'Failed to set the next service date');

      // 3) Optional service report.
      if (report) {
        try {
          const fileObj = Platform.OS === 'web'
            ? report
            : { uri: report.uri, name: report.name || 'service-report', type: report.mimeType || 'application/pdf' };
          const fd = new FormData();
          fd.append('file', fileObj);
          fd.append('title', 'Service Report');
          fd.append('kind', 'Service Report');
          fd.append('related_date_label', 'Service Report');
          fd.append('related_date', serviceDate);
          await fetch(`${API_BASE_URL}/assets/${assetId}/documents/upload`, {
            method: 'POST',
            headers: await authHeaders(false),
            body: fd,
          });
        } catch (e) {
          logger.error('Servicing: report upload failed', e);
        }
      }

      await refreshTaskBadge();
      Alert.alert('Service logged', `Recorded the past service. Next service due ${prettyDate(nextDate)}.`, [
        { text: 'Done', onPress: () => backToTarget() },
        { text: 'View Asset', onPress: () => router.replace({ pathname: '/asset/[assetId]', params: { assetId } }) },
      ]);
    } catch (e) {
      Alert.alert('Error', e?.message || 'Failed to log the service');
    } finally {
      setSubmitting(false);
    }
  }, [submitting, nextDate, serviceDate, summary, cost, notes, report, assetId, refreshTaskBadge, backToTarget, router]);

  // ── Submit: Schedule / today's service (creates the task) ────────────────
  const submitSchedule = useCallback(async () => {
    if (submitting) return;
    if (!dueDate) { Alert.alert('Missing date', 'Please choose the service due date.'); return; }
    setSubmitting(true);
    try {
      const headers = await authHeaders(true);
      // Setting next_service_date derives the date-based service task; the
      // assigned user actions and closes it later, then schedules the next one.
      const putRes = await fetch(`${API_BASE_URL}/assets/${assetId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ next_service_date: dueDate, skip_required_documents: true }),
      });
      if (!putRes.ok) throw new Error((await putRes.text()) || 'Failed to schedule the service');

      await refreshTaskBadge();
      Alert.alert('Service scheduled', `A service task is set for ${prettyDate(dueDate)}. The assigned user can action and close it from Tasks.`, [
        { text: 'Done', onPress: () => backToTarget() },
        { text: 'View Asset', onPress: () => router.replace({ pathname: '/asset/[assetId]', params: { assetId } }) },
      ]);
    } catch (e) {
      Alert.alert('Error', e?.message || 'Failed to schedule the service');
    } finally {
      setSubmitting(false);
    }
  }, [submitting, dueDate, assetId, refreshTaskBadge, backToTarget, router]);

  const assetType = asset?.asset_types?.name || asset?.name || 'Asset';
  const model = asset?.model || asset?.description || '';
  const serial = asset?.serial_number || '';
  const assignedTo = asset?.users?.name || asset?.users?.useremail || 'Unassigned';

  const headerTitle = mode === 'past' ? 'Log Past Service' : mode === 'schedule' ? 'Schedule Service' : 'Servicing';

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
              <View style={[s.accentBar, { backgroundColor: Colors.accent }]} />
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
                {asset.next_service_date ? (
                  <View style={s.nextRow}>
                    <MaterialIcons name="event-available" size={14} color={Colors.sub} />
                    <Text style={s.nextText}>Current next service: {prettyDate(asset.next_service_date)}</Text>
                  </View>
                ) : null}
              </View>
            </View>

            {/* Menu */}
            {!mode ? (
              <View style={{ gap: 12, marginTop: 4 }}>
                <Text style={s.menuHeading}>What would you like to do?</Text>

                <TouchableOpacity style={s.optionCard} activeOpacity={0.85} onPress={() => setMode('past')}>
                  <View style={[s.optionIcon, { backgroundColor: Colors.accentMuted }]}>
                    <MaterialIcons name="history" size={22} color={Colors.accent} />
                  </View>
                  <View style={s.optionTextWrap}>
                    <Text style={s.optionTitle}>Log a past service</Text>
                    <Text style={s.optionSub}>Record a service that already happened and set when the next one is due. No task is created.</Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={22} color={Colors.sub2} />
                </TouchableOpacity>

                <TouchableOpacity style={s.optionCard} activeOpacity={0.85} onPress={() => setMode('schedule')}>
                  <View style={[s.optionIcon, { backgroundColor: '#EEF2FF' }]}>
                    <MaterialIcons name="event" size={22} color="#4F46E5" />
                  </View>
                  <View style={s.optionTextWrap}>
                    <Text style={s.optionTitle}>Schedule a service</Text>
                    <Text style={s.optionSub}>Book a service for today or up to 6 months ahead. Creates a task for the assigned user to action and close.</Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={22} color={Colors.sub2} />
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Option 1 — Log past service */}
            {mode === 'past' ? (
              <View style={s.formCard}>
                <DateField label="When was it serviced?" value={serviceDate} onChange={setServiceDate} validRange={pastWindow()} />

                <Text style={s.fieldLabel}>Type of service (optional)</Text>
                <TextInput
                  style={s.input}
                  placeholder="e.g. Scheduled maintenance"
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

                <Text style={s.fieldLabel}>Service report (optional)</Text>
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

                <View style={s.divider} />

                <DateField
                  label="Next service due *"
                  value={nextDate}
                  onChange={setNextDate}
                  validRange={serviceWindow()}
                  helper="Defaults to 6 months from today. Cannot be more than 6 months ahead."
                />
                <QuickMonths onPick={(m) => setNextDate(toISO(addMonths(startOfToday(), m)))} />

                <TouchableOpacity
                  style={[s.primaryBtn, submitting && { opacity: 0.6 }]}
                  onPress={submitPast}
                  disabled={submitting}
                >
                  {submitting ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>Log service</Text>}
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Option 2 — Schedule service */}
            {mode === 'schedule' ? (
              <View style={s.formCard}>
                <View style={s.banner}>
                  <MaterialIcons name="info-outline" size={16} color="#4F46E5" />
                  <Text style={s.bannerText}>
                    This creates a service task on the chosen date. The assigned user actions and closes it
                    ("service done") and is then offered to schedule the next service.
                  </Text>
                </View>

                <DateField
                  label="Service due date *"
                  value={dueDate}
                  onChange={setDueDate}
                  validRange={serviceWindow()}
                  helper="Today up to 6 months ahead."
                />
                <QuickMonths onPick={(m) => setDueDate(toISO(addMonths(startOfToday(), m)))} includeToday />

                <TouchableOpacity
                  style={[s.primaryBtn, submitting && { opacity: 0.6 }]}
                  onPress={submitSchedule}
                  disabled={submitting}
                >
                  {submitting ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>Schedule service</Text>}
                </TouchableOpacity>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────
function DateField({ label, value, onChange, validRange, helper }) {
  const [open, setOpen] = useState(false);
  const parsed = useMemo(() => {
    try { return value ? new Date(value) : new Date(); } catch { return new Date(); }
  }, [value]);
  return (
    <View>
      <Text style={s.fieldLabel}>{label}</Text>
      <TouchableOpacity style={s.dateInput} onPress={() => setOpen(true)}>
        <MaterialIcons name="event" size={18} color={Colors.sub} />
        <Text style={s.dateText}>{value ? prettyDate(value) : 'Select date'}</Text>
      </TouchableOpacity>
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

function QuickMonths({ onPick, includeToday }) {
  return (
    <View style={s.quickRow}>
      {includeToday ? (
        <TouchableOpacity style={s.quickChip} onPress={() => onPick(0)}>
          <Text style={s.quickChipText}>Today</Text>
        </TouchableOpacity>
      ) : null}
      {[1, 3, 6].map((m) => (
        <TouchableOpacity key={m} style={s.quickChip} onPress={() => onPick(m)}>
          <Text style={s.quickChipText}>+{m} month{m === 1 ? '' : 's'}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  content: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 40, gap: 14 },
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

  menuHeading: { fontSize: sf(13), fontWeight: '800', color: Colors.sub, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
  optionCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.lg, backgroundColor: Colors.card, ...Shadows.card },
  optionIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  optionTextWrap: { flex: 1, gap: 2 },
  optionTitle: { fontSize: sf(16), fontWeight: '800', color: Colors.text },
  optionSub: { fontSize: sf(12), color: Colors.sub, lineHeight: sf(17) },

  formCard: { padding: 16, borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.lg, backgroundColor: Colors.card, gap: 6, ...Shadows.card },
  fieldLabel: { fontSize: sf(13), fontWeight: '700', color: Colors.text, marginTop: 10, marginBottom: 6 },
  input: { borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.md, padding: 12, color: Colors.text, backgroundColor: Colors.card },
  hint: { fontSize: sf(11), color: Colors.sub2, marginTop: 4, lineHeight: sf(16) },
  attached: { marginTop: 6, fontStyle: 'italic', color: Colors.sub },
  dateInput: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.md, padding: 12, backgroundColor: Colors.card },
  dateText: { color: Colors.text, fontWeight: '600' },
  divider: { height: 1, backgroundColor: Colors.line, marginVertical: 12 },

  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  quickChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: Colors.line, backgroundColor: Colors.chip },
  quickChipText: { fontWeight: '700', color: Colors.primaryDark, fontSize: sf(12) },

  banner: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: Radius.md, backgroundColor: '#EEF2FF', borderWidth: 1, borderColor: '#C7D2FE', marginBottom: 4 },
  bannerText: { flex: 1, fontSize: sf(12), color: '#3730A3', lineHeight: sf(17) },

  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: Radius.md, borderWidth: 2, borderColor: Colors.line, backgroundColor: Colors.chip, marginTop: 4 },
  secondaryBtnText: { fontWeight: '700', color: Colors.text },
  primaryBtn: { marginTop: 18, paddingVertical: 15, borderRadius: Radius.md, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: sf(15) },
});
