// app/components/ActionsForm.js
import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { DatePickerModal } from 'react-native-paper-dates';
import { MaterialIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { ALGOLIA_INDEX_CLIENTS, ALGOLIA_INDEX_PROJECTS, algoliaSearch } from '../config/algolia';
import { getAuth } from 'firebase/auth';

const Colors = {
  bg: '#FFFFFF',
  card: '#FFFFFF',
  border: '#E5E7EB',
  text: '#111827',
  subtle: '#6B7280',
  muted: '#9CA3AF',
  green: '#16A34A',
  blue:  '#2563EB',
  slate: '#64748B',
  red:   '#DC2626',
};

const ACTIONS = [
  'Repair',
  'Maintenance',
  'Hire',
  'End of Life',
  'Report Lost',
  'Report Stolen',
];

// Map actions to a status that your backend accepts (PUT /assets/:id)
const STATUS_MAP = {
  'Repair': 'Repair',
  'Maintenance': 'Maintenance',
  'End of Life': 'End of Life',
  // Lost / Stolen / Hire do not forcibly change status by default.
  // You can override via props.statusMap if needed.
};

// Map display label -> API action enum
const ACTION_ENUM = {
  'Repair': 'REPAIR',
  'Maintenance': 'MAINTENANCE',
  'Hire': 'HIRE',
  'End of Life': 'END_OF_LIFE',
  'Report Lost': 'LOST',
  'Report Stolen': 'STOLEN',
};

export default function ActionsForm({
  visible,
  onClose,
  asset,                // { id, ... }
  action,               // one of ACTIONS
  onSubmitted,          // (updatedAssetPartial, meta) => void
  submitToBackend = true,
  statusMap = STATUS_MAP,
  apiBaseUrl,
  users = [],           // pass from parent to support Hire picker
}) {
  const [submitting, setSubmitting] = useState(false);

  // Common fields across forms
  const [date, setDate] = useState(new Date().toISOString().slice(0,10)); // ISO (YYYY-MM-DD)
  const [notes, setNotes] = useState('');

  // Repair / Maintenance only
  const [priority, setPriority] = useState('Normal'); // Low | Normal | High | Critical
  const [summary, setSummary] = useState('');
  const [cost, setCost] = useState('');
  const [odometer, setOdometer] = useState('');
  const [serviceImages, setServiceImages] = useState([]); // web: File[]
  const [serviceReport, setServiceReport] = useState(null); // single report attachment
  const [nextServiceDate, setNextServiceDate] = useState(''); // ISO YYYY-MM-DD
  const [hasDynamicNextService, setHasDynamicNextService] = useState(false);
  const [nextServiceRequired, setNextServiceRequired] = useState(false);

  // Hire only
  const [hireTo, setHireTo] = useState('');
  const [hireStart, setHireStart] = useState(new Date().toISOString().slice(0,10));
  const [hireEnd, setHireEnd] = useState('');
  const [hireRate, setHireRate] = useState('');
  const [hireProject, setHireProject] = useState('');
  const [hireClient, setHireClient] = useState('');
  const [hireMode, setHireMode] = useState('user'); // 'user' | 'project' | 'client' | 'manual'
  const [hireSearch, setHireSearch] = useState('');
  const [selectedHireUser, setSelectedHireUser] = useState(null);
  const [projectSearch, setProjectSearch] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [projectHits, setProjectHits] = useState([]);
  const [clientHits, setClientHits] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);
  const [searching, setSearching] = useState(false);

  // Debounced Algolia search for projects (works in any mode and for optional field)
  useEffect(() => {
    const q = projectSearch.trim();
    if (selectedProject || q.length <= 1) { setProjectHits([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const hits = await algoliaSearch(ALGOLIA_INDEX_PROJECTS, q);
        setProjectHits(hits);
      } catch {
        setProjectHits([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [projectSearch, selectedProject]);

  // Debounced Algolia search for clients (works in any mode and for optional field)
  useEffect(() => {
    const q = clientSearch.trim();
    if (selectedClient || q.length <= 1) { setClientHits([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const hits = await algoliaSearch(ALGOLIA_INDEX_CLIENTS, q);
        setClientHits(hits);
      } catch {
        setClientHits([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [clientSearch, selectedClient]);

  // EOL only
  const [eolReason, setEolReason] = useState('Obsolete'); // Obsolete | Damaged | Other
  const [confirmEol, setConfirmEol] = useState(false);

  // Lost / Stolen
  const [where, setWhere] = useState('');
  const [policeReport, setPoliceReport] = useState(''); // stolen only

  const fields = useMemo(() => {
    switch (action) {
      case 'Repair':
      case 'Maintenance':
        return 'service';
      case 'Hire':
        return 'hire';
      case 'End of Life':
        return 'eol';
      case 'Report Lost':
        return 'lost';
      case 'Report Stolen':
        return 'stolen';
      default:
        return 'none';
    }
  }, [action]);

  const isVehicleAsset = useMemo(() => {
    const typeName = String(asset?.asset_types?.name || asset?.type || '').toLowerCase();
    const model = String(asset?.model || asset?.description || '').toLowerCase();
    const keywords = ['vehicle','car','truck','ute','van','bus','lorry','tractor','hilux'];
    return keywords.some((kw) => typeName.includes(kw) || model.includes(kw));
  }, [asset]);
  const allowOdometerInput = fields === 'service' && isVehicleAsset && (action === 'Maintenance' || action === 'Repair');

  useEffect(() => {
    if (!allowOdometerInput) {
      setOdometer('');
    }
  }, [allowOdometerInput, visible]);

  // Lookup if this asset type defines a dynamic 'next_service_date' field and if it's required
  useEffect(() => {
    let cancel = false;
    if (!visible) return;
    try {
      const typeId = asset?.asset_types?.id || asset?.type_id;
      if (!apiBaseUrl || !typeId) { setHasDynamicNextService(false); setNextServiceRequired(false); return; }
      (async () => {
        try {
          const res = await fetch(`${apiBaseUrl}/assets/asset-types/${typeId}/fields`);
          const j = await res.json();
          const arr = Array.isArray(j) ? j : (Array.isArray(j?.data) ? j.data : (Array.isArray(j?.items) ? j.items : []));
          const match = (arr || []).find(d => {
            const slug = String(d?.slug || '').toLowerCase();
            const name = String(d?.name || '').toLowerCase();
            const t = String(d?.field_type?.slug || d?.field_type?.name || '').toLowerCase();
            return t === 'date' && (slug === 'next_service_date' || name.includes('next service'));
          });
          if (!cancel) {
            const has = !!match;
            const req = !!(match?.is_required);
            setHasDynamicNextService(has);
            setNextServiceRequired(req);
          }
        } catch {
          if (!cancel) { setHasDynamicNextService(false); setNextServiceRequired(false); }
        }
      })();
    } catch {
      setHasDynamicNextService(false); setNextServiceRequired(false);
    }
    return () => { cancel = true; };
  }, [visible, apiBaseUrl, asset?.asset_types?.id, asset?.type_id]);

  const actionLabel =
    action === 'Repair'
      ? 'Repair Required'
      : action === 'Maintenance'
        ? 'Log Service'
        : action;
  const summaryLabel = action === 'Repair' ? 'Type of Repair *' : 'Type of Service *';
  const summaryPlaceholder = action === 'Repair' ? 'e.g. Screen replacement' : 'e.g. Scheduled maintenance';
  const summaryAlertText = action === 'Repair' ? 'Please add the type of repair.' : 'Please add the type of service.';

  const validate = () => {
    if (!action || !ACTIONS.includes(action)) {
      Alert.alert('Invalid', 'Please choose a valid action.'); 
      return false;
    }
    if (fields === 'service') {
      if (!summary.trim()) {
        Alert.alert('Missing info', summaryAlertText);
        return false;
      }
    } else if (fields === 'hire') {
      if (hireMode === 'user') {
        if (!selectedHireUser) return Alert.alert('Missing info', 'Please choose who to hire to.'), false;
      } else if (hireMode === 'project') {
        if (!selectedProject) return Alert.alert('Missing info', 'Please select a project from suggestions.'), false;
      } else if (hireMode === 'client') {
        if (!selectedClient) return Alert.alert('Missing info', 'Please select a client from suggestions.'), false;
      } else if (hireMode === 'manual') {
        if (!hireTo.trim()) return Alert.alert('Missing info', 'Please enter who this is hired to.'), false;
      }
      if (!hireStart) return Alert.alert('Missing dates', 'Please choose a start date.'), false;
      // (Optional) end date can be empty for open-ended hires
    } else if (fields === 'eol') {
      if (!confirmEol) return Alert.alert('Confirm', 'Please confirm End of Life.'), false;
    } else if (fields === 'lost') {
      if (!where.trim()) return Alert.alert('Missing info', 'Please add where it was last seen.'), false;
    } else if (fields === 'stolen') {
      if (!where.trim()) return Alert.alert('Missing info', 'Please add where it was stolen from.'), false;
      // policeReport optional
    }
    return true;
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!validate()) return;

    setSubmitting(true);
    try {
      const odometerNumeric = Number(odometer);
      const odometerValue = (allowOdometerInput && String(odometer || '').trim())
        ? (Number.isFinite(odometerNumeric) ? odometerNumeric : String(odometer).trim())
        : null;
      // Build a metadata record for parent logging or future POST /asset-actions
      const meta = {
        action,
        date,
        notes,
        ...(fields === 'service'
          ? {
              summary,
              ...(action === 'Repair'
                ? {
                    priority,
                    ...(nextServiceDate ? { estimatedRepairDate: nextServiceDate } : {}),
                  }
                : {}),
              cost: Number(cost) || 0,
              ...(odometerValue ? { odometer: odometerValue } : {}),
            }
          : {}),
        ...(fields === 'hire' ? {
          hireTo: hireMode === 'user' ? (selectedHireUser?.name || selectedHireUser?.useremail || selectedHireUser?.id) : (hireMode === 'manual' ? hireTo : undefined),
          hireStart,
          hireEnd,
          hireRate: Number(hireRate) || 0,
          project: hireMode === 'project' ? (selectedProject?.name || selectedProject?.title || selectedProject?.label || hireProject) : (hireProject || undefined),
          projectId: selectedProject?.objectID,
          client: hireMode === 'client' ? (selectedClient?.name || selectedClient?.title || selectedClient?.label || hireClient) : (hireClient || undefined),
          clientId: selectedClient?.objectID,
          hireUserId: hireMode === 'user' ? selectedHireUser?.id : undefined,
          mode: hireMode,
        } : {}),
        ...(fields === 'eol' ? { eolReason } : {}),
        ...(fields === 'lost' ? { where } : {}),
        ...(fields === 'stolen' ? { where, policeReport } : {}),
      };

      // Optionally update asset status (only for API-accepted statuses)
      let updated = {};
      const newStatus = statusMap[action]; // may be undefined
        if (submitToBackend && newStatus) {
      const auth = getAuth();
      const current = auth?.currentUser;
      // Build update payload; Next Service Date is now captured at review/sign‑off time,
      // so we only update the status here.
      const bodyPatch = { status: newStatus };
        const res = await fetch(`${apiBaseUrl}/assets/${asset?.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(current?.uid ? { 'X-User-Id': current.uid } : {}),
            ...(current?.displayName ? { 'X-User-Name': current.displayName } : {}),
            ...(current?.email ? { 'X-User-Email': current.email } : {}),
          },
          body: JSON.stringify(bodyPatch),
        });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(t || `Failed to set status: ${newStatus}`);
        }
        updated.status = newStatus;
      }

      // Always record a structured action with details
      const enumType = ACTION_ENUM[action];
      if (submitToBackend && enumType) {
        const auth = getAuth();
        const current = auth?.currentUser;
        // If we have service/repair images, send multipart to /actions/upload
        const hasImages = (fields === 'service') && (['REPAIR','MAINTENANCE'].includes(enumType)) && Array.isArray(serviceImages) && serviceImages.length > 0;
        if (hasImages) {
          const form = new FormData();
          form.append('type', enumType);
          form.append('note', summary || '');
          form.append('occurred_at', date);
          form.append('details', JSON.stringify(meta));
          // data flags for sign-off
          form.append('data', JSON.stringify({ requires_signoff: true, completed: false }));
          serviceImages.forEach((f) => form.append('images', f));
          const headers = {};
          if (current?.uid) headers['X-User-Id'] = current.uid;
          if (current?.displayName) headers['X-User-Name'] = current.displayName;
          if (current?.email) headers['X-User-Email'] = current.email;
          const post = await fetch(`${apiBaseUrl}/assets/${asset?.id}/actions/upload`, {
            method: 'POST',
            headers,
            body: form,
          });
          if (!post.ok) {
            const t = await post.text();
            throw new Error(t || 'Failed to save action images');
          }
        } else {
          const headers = { 'Content-Type': 'application/json' };
          if (current?.uid) headers['X-User-Id'] = current.uid;
          if (current?.displayName) headers['X-User-Name'] = current.displayName;
          if (current?.email) headers['X-User-Email'] = current.email;
          const body = {
            type: enumType,
            note: fields === 'service' ? summary : (notes || undefined),
            details: meta,
            occurred_at: date,
            data: (fields === 'service' || enumType === 'HIRE') ? { requires_signoff: true, completed: false } : undefined,
          };
          const post = await fetch(`${apiBaseUrl}/assets/${asset?.id}/actions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          });
          if (!post.ok) {
            const t = await post.text();
            throw new Error(t || 'Failed to save action');
          }
        }

        // Optional service / repair file upload
        if (serviceReport) {
          try {
            let fileObj;
            if (Platform.OS === 'web') {
              fileObj = serviceReport; // File from <input>
            } else {
              fileObj = {
                uri: serviceReport.uri,
                name: serviceReport.name || 'report',
                type: serviceReport.mimeType || 'application/pdf',
              };
            }
            const fd = new FormData();
            fd.append('file', fileObj);
            // Keep backend labels as generic "Report" for now;
            // front-end wording is handled in the form labels/buttons.
            const label = action === 'Repair' ? 'Repair Report' : 'Service Report';
            fd.append('title', label);
            fd.append('kind', label);
            fd.append('related_date_label', label);
            fd.append('related_date', date);
            const docHeaders = {};
            if (current?.uid) docHeaders['X-User-Id'] = current.uid;
            if (current?.displayName) docHeaders['X-User-Name'] = current.displayName;
            if (current?.email) docHeaders['X-User-Email'] = current.email;
            await fetch(`${apiBaseUrl}/assets/${asset?.id}/documents/upload`, {
              method: 'POST',
              headers: docHeaders,
              body: fd,
            });
          } catch (e) {
            console.error('ActionsForm report upload failed', e);
          }
        }
      }

      // No automatic assignment on Hire (by request)

      // Let parent update UI (optimistic or refetch)
      onSubmitted && onSubmitted(updated, meta);

      // Close the sheet immediately on success (no blocking alert)
      onClose && onClose();
    } catch (e) {
      console.error('ActionsForm submit error', e);
      Alert.alert('Error', e?.message || 'Failed to submit action');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>{actionLabel || 'Action'}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialIcons name="close" size={24} color={Colors.subtle} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {/* Date */}
            <DateField label="Date" value={date} onChange={setDate} minDate={new Date(new Date().setFullYear(new Date().getFullYear() - 10))} maxDate={new Date()} />

            {/* Upload Document removed in ActionsForm */}

            {fields === 'service' && (
              <>
                <LabeledInput label={summaryLabel}>
                  <TextInput
                    style={styles.input}
                    placeholder={summaryPlaceholder}
                    placeholderTextColor={Colors.muted}
                    value={summary}
                    onChangeText={setSummary}
                  />
                </LabeledInput>

                {action !== 'Repair' && (
                  <View style={{ marginBottom: 8 }}>
                    <Text style={{ color: Colors.subtle, fontSize: 12, marginBottom: 6 }}>
                      Quick select
                    </Text>
                    <View style={styles.pillRow}>
                      {['Regular', 'Minor', 'Major'].map((opt) => {
                        const active = summary.trim().toLowerCase() === opt.toLowerCase();
                        return (
                          <TouchableOpacity
                            key={opt}
                            onPress={() => setSummary(opt)}
                            style={[
                              styles.pill,
                              {
                                borderColor: active ? Colors.blue : Colors.border,
                                backgroundColor: active ? '#EFF6FF' : '#FFF',
                              },
                            ]}
                          >
                            <Text style={{ color: active ? Colors.blue : Colors.text, fontWeight: '700' }}>
                              {opt}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}

                {action === 'Repair' && (
                  <PickerRow
                    label="Priority"
                    value={priority}
                    onChange={setPriority}
                    options={['Low','Normal','High','Critical']}
                  />
                )}

                <LabeledInput label="Estimated Cost (optional)">
                  <TextInput
                    style={styles.input}
                    placeholder="0"
                    keyboardType="numeric"
                    placeholderTextColor={Colors.muted}
                    value={cost}
                    onChangeText={setCost}
                  />
                </LabeledInput>

                {allowOdometerInput && (
                  <LabeledInput label="Odometer (optional)">
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. 125000"
                      placeholderTextColor={Colors.muted}
                      keyboardType="numeric"
                      value={odometer}
                      onChangeText={setOdometer}
                    />
                  </LabeledInput>
                )}

                {/* Estimated Repair Date (Repair). Next Service Date is now captured when signing off. */}
                {action === 'Repair' && (
                  <DateField
                    label="Estimated Date of Repair (optional)"
                    value={nextServiceDate}
                    onChange={setNextServiceDate}
                  />
                )}

                {/* Optional photos for Repair/Maintenance */}
                {Platform.OS === 'web' && (
                  <LabeledInput label={action === 'Repair' ? 'Upload Repair Images (optional)' : 'Upload Service Images (optional)'}>
                    <View style={{ gap: 8 }}>
                      <input
                        type="file"
                        multiple
                        accept="image/*"
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          setServiceImages(files);
                        }}
                        style={{
                          border: '1px solid #E5E7EB',
                          borderRadius: 10,
                          padding: 10,
                          background: '#fff',
                          color: '#111827',
                        }}
                      />
                      {!!serviceImages.length && (
                        <Text style={{ color: Colors.subtle, fontSize: 12 }}>{serviceImages.length} file(s) selected</Text>
                      )}
                    </View>
                  </LabeledInput>
                )}

                {/* Service / Repair attachment (labelled as photos/images in UI) */}
                {Platform.OS === 'web' ? (
                  <LabeledInput label={action === 'Repair' ? 'Upload Repair Photos (optional)' : 'Upload Service Images (optional)'}>
                    <View style={{ gap: 8 }}>
                      <input
                        type="file"
                        accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
                        onChange={(e) => {
                          const file = (e.target.files && e.target.files[0]) || null;
                          setServiceReport(file || null);
                        }}
                        style={{
                          border: '1px solid #E5E7EB',
                          borderRadius: 10,
                          padding: 10,
                          background: '#fff',
                          color: '#111827',
                        }}
                      />
                      {serviceReport && (
                        <Text style={{ color: Colors.subtle, fontSize: 12 }}>
                          Attached: {serviceReport.name || 'document'}
                        </Text>
                      )}
                    </View>
                  </LabeledInput>
                ) : (
                  <View style={{ marginTop: 8 }}>
                    <Text style={{ color: Colors.subtle, fontSize: 12, marginBottom: 6 }}>
                      {action === 'Repair' ? 'Upload Repair Photos (optional)' : 'Upload Service Images (optional)'}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <TouchableOpacity
                        style={[styles.btn, styles.btnGhost, { flex: 1 }]}
                        onPress={async () => {
                          try {
                            const res = await DocumentPicker.getDocumentAsync({
                              type: [
                                'application/pdf',
                                'application/msword',
                                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                                'image/*',
                              ],
                              multiple: false,
                            });
                            if (res.canceled) return;
                            const asset = res.assets?.[0];
                            if (!asset) return;
                            setServiceReport(asset);
                          } catch (e) {
                            Alert.alert('Error', e.message || 'Failed to select document');
                          }
                        }}
                      >
                        <Text style={{ fontWeight: '700', color: Colors.blue }}>
                          {serviceReport
                            ? 'Replace File'
                            : action === 'Repair'
                              ? 'Upload Repair Photos'
                              : 'Upload Service Images'}
                        </Text>
                      </TouchableOpacity>
                      {serviceReport && (
                        <TouchableOpacity
                          style={[styles.btn, { flex: 1, backgroundColor: '#FEE2E2' }]}
                          onPress={() => setServiceReport(null)}
                        >
                          <Text style={{ fontWeight: '700', color: '#B91C1C' }}>Remove</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    {serviceReport && (
                      <Text style={{ marginTop: 4, fontSize: 12, color: Colors.subtle }}>
                        Attached: {serviceReport.name || 'document'}
                      </Text>
                    )}
                  </View>
                )}
              </>
            )}

            {fields === 'hire' && (
              <>
                {/* Mode toggle */}
                <PickerRow
                  label="Entry Mode"
                  value={{ user: 'User', project: 'Project', client: 'Client', manual: 'Enter Manually' }[hireMode]}
                  onChange={(v) => {
                    const map = { 'User': 'user', 'Project': 'project', 'Client': 'client', 'Enter Manually': 'manual' };
                    setHireMode(map[v] || 'user');
                  }}
                  options={['User','Project','Client','Enter Manually']}
                />

                {hireMode === 'user' ? (
                  <>
                    <LabeledInput label="Search User">
                      <View style={styles.inputWrap}>
                        <TextInput
                          style={[styles.input, { paddingRight: 36 }]}
                          placeholder="Type a name or email"
                          placeholderTextColor={Colors.muted}
                          value={selectedHireUser ? (selectedHireUser.name || selectedHireUser.useremail || selectedHireUser.id) : hireSearch}
                          onChangeText={(v) => { setSelectedHireUser(null); setHireSearch(v); }}
                        />
                        {(selectedHireUser || hireSearch) ? (
                          <TouchableOpacity style={styles.clearBtn} onPress={() => { setSelectedHireUser(null); setHireSearch(''); }}>
                            <MaterialIcons name="close" size={18} color={Colors.subtle} />
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </LabeledInput>
                    {hireSearch?.trim()?.length > 0 && !selectedHireUser && (
                      <View style={{ maxHeight: 160, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, overflow: 'hidden' }}>
                        <ScrollView>
                          {(users || [])
                            .filter(u => (u.name?.toLowerCase().includes(hireSearch.toLowerCase()) || u.useremail?.toLowerCase().includes(hireSearch.toLowerCase())))
                            .slice(0, 20)
                            .map(u => (
                              <TouchableOpacity key={u.id} onPress={() => { setSelectedHireUser(u); setHireSearch(''); }} style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
                                <Text style={{ color: Colors.text, fontWeight: '700' }}>{u.name || u.useremail || u.id}</Text>
                                {!!u.useremail && <Text style={{ color: Colors.subtle, fontSize: 12 }}>{u.useremail}</Text>}
                              </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    )}
                    {/* Selected user's name/email now shown directly in the input above */}
                  </>
                ) : hireMode === 'project' ? (
                  <>
                    <LabeledInput label="Project *">
                      <View style={styles.inputWrap}>
                        <TextInput
                          style={[styles.input, { paddingRight: 36 }]}
                          placeholder="Type to search projects"
                          placeholderTextColor={Colors.muted}
                          value={selectedProject ? (selectedProject.name || selectedProject.title || selectedProject.label) : projectSearch}
                          onChangeText={(v) => { setSelectedProject(null); setProjectSearch(v); }}
                        />
                        {(selectedProject || projectSearch) ? (
                          <TouchableOpacity style={styles.clearBtn} onPress={() => { setSelectedProject(null); setProjectSearch(''); }}>
                            <MaterialIcons name="close" size={18} color={Colors.subtle} />
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </LabeledInput>
                    {projectSearch.trim().length > 1 && !selectedProject && (
                      <View style={{ maxHeight: 200, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, overflow: 'hidden' }}>
                        <ScrollView>
                          {projectHits.map(hit => (
                            <TouchableOpacity key={hit.objectID} onPress={() => { setSelectedProject(hit); setProjectSearch(''); setHireProject(hit.name || hit.title || hit.label || ''); }} style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
                              <Text style={{ color: Colors.text, fontWeight: '700' }}>{hit.name || hit.title || hit.label}</Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    )}
                    <LabeledInput label="Client (optional)">
                      <View style={styles.inputWrap}>
                        <TextInput
                          style={[styles.input, { paddingRight: 36 }]}
                          placeholder="Type to search clients"
                          placeholderTextColor={Colors.muted}
                          value={selectedClient ? (selectedClient.name || selectedClient.title || selectedClient.label) : clientSearch || hireClient}
                          onChangeText={(v) => { setSelectedClient(null); setClientSearch(v); setHireClient(''); }}
                        />
                        {(selectedClient || clientSearch) ? (
                          <TouchableOpacity style={styles.clearBtn} onPress={() => { setSelectedClient(null); setClientSearch(''); setHireClient(''); }}>
                            <MaterialIcons name="close" size={18} color={Colors.subtle} />
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </LabeledInput>
                    {clientSearch.trim().length > 1 && !selectedClient && (
                      <View style={{ maxHeight: 200, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, overflow: 'hidden' }}>
                        <ScrollView>
                          {clientHits.map(hit => (
                            <TouchableOpacity key={hit.objectID} onPress={() => { setSelectedClient(hit); setClientSearch(''); setHireClient(hit.name || hit.title || hit.label || ''); }} style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
                              <Text style={{ color: Colors.text, fontWeight: '700' }}>{hit.name || hit.title || hit.label}</Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    )}
                </>
              ) : hireMode === 'client' ? (
                <>
                    <LabeledInput label="Client *">
                      <View style={styles.inputWrap}>
                        <TextInput
                          style={[styles.input, { paddingRight: 36 }]}
                          placeholder="Type to search clients"
                          placeholderTextColor={Colors.muted}
                          value={selectedClient ? (selectedClient.name || selectedClient.title || selectedClient.label) : clientSearch}
                          onChangeText={(v) => { setSelectedClient(null); setClientSearch(v); }}
                        />
                        {(selectedClient || clientSearch) ? (
                          <TouchableOpacity style={styles.clearBtn} onPress={() => { setSelectedClient(null); setClientSearch(''); }}>
                            <MaterialIcons name="close" size={18} color={Colors.subtle} />
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </LabeledInput>
                    {clientSearch.trim().length > 1 && !selectedClient && (
                      <View style={{ maxHeight: 200, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, overflow: 'hidden' }}>
                        <ScrollView>
                          {clientHits.map(hit => (
                            <TouchableOpacity key={hit.objectID} onPress={() => { setSelectedClient(hit); setClientSearch(''); setHireClient(hit.name || hit.title || hit.label || ''); }} style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
                              <Text style={{ color: Colors.text, fontWeight: '700' }}>{hit.name || hit.title || hit.label}</Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    )}
                    <LabeledInput label="Project (optional)">
                      <View style={styles.inputWrap}>
                        <TextInput
                          style={[styles.input, { paddingRight: 36 }]}
                          placeholder="Type to search projects"
                          placeholderTextColor={Colors.muted}
                          value={selectedProject ? (selectedProject.name || selectedProject.title || selectedProject.label) : projectSearch || hireProject}
                          onChangeText={(v) => { setSelectedProject(null); setProjectSearch(v); setHireProject(''); }}
                        />
                        {(selectedProject || projectSearch) ? (
                          <TouchableOpacity style={styles.clearBtn} onPress={() => { setSelectedProject(null); setProjectSearch(''); setHireProject(''); }}>
                            <MaterialIcons name="close" size={18} color={Colors.subtle} />
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </LabeledInput>
                    {projectSearch.trim().length > 1 && !selectedProject && (
                      <View style={{ maxHeight: 200, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, overflow: 'hidden' }}>
                        <ScrollView>
                          {projectHits.map(hit => (
                            <TouchableOpacity key={hit.objectID} onPress={() => { setSelectedProject(hit); setProjectSearch(''); setHireProject(hit.name || hit.title || hit.label || ''); }} style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
                              <Text style={{ color: Colors.text, fontWeight: '700' }}>{hit.name || hit.title || hit.label}</Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    )}
                  </>
                ) : (
                  <LabeledInput label="Hire To *">
                    <TextInput
                      style={styles.input}
                      placeholder="Company / Person"
                      placeholderTextColor={Colors.muted}
                      value={hireTo}
                      onChangeText={setHireTo}
                    />
                  </LabeledInput>
                )}

                <DateField label="Start Date *" value={hireStart} onChange={setHireStart} minDate={new Date(new Date().setFullYear(new Date().getFullYear() - 1))} maxDate={new Date(new Date().setFullYear(new Date().getFullYear() + 2))} />

                <DateField label="End Date (optional)" value={hireEnd} onChange={setHireEnd} minDate={hireStart ? new Date(hireStart) : new Date()} maxDate={new Date(new Date().setFullYear(new Date().getFullYear() + 3))} />

                <LabeledInput label="Rate (per day, optional)">
                  <TextInput
                    style={styles.input}
                    placeholder="0"
                    keyboardType="numeric"
                    placeholderTextColor={Colors.muted}
                    value={hireRate}
                    onChangeText={setHireRate}
                  />
                </LabeledInput>
              </>
            )}

            {fields === 'eol' && (
              <>
                <PickerRow
                  label="Reason"
                  value={eolReason}
                  onChange={setEolReason}
                  options={['Obsolete','Damaged','Other']}
                />
                <CheckboxRow
                  label="I confirm this asset should be marked End of Life"
                  checked={!!confirmEol}
                  onToggle={() => setConfirmEol(v => !v)}
                />
              </>
            )}

            {fields === 'lost' && (
              <LabeledInput label="Where was it last seen? *">
                <TextInput
                  style={styles.input}
                  placeholder="Location / Job / Person"
                  placeholderTextColor={Colors.muted}
                  value={where}
                  onChangeText={setWhere}
                />
              </LabeledInput>
            )}

            {fields === 'stolen' && (
              <>
                <LabeledInput label="Where was it stolen from? *">
                  <TextInput
                    style={styles.input}
                    placeholder="Location / Job / Person"
                    placeholderTextColor={Colors.muted}
                    value={where}
                    onChangeText={setWhere}
                  />
                </LabeledInput>
                <LabeledInput label="Police Report # (optional)">
                  <TextInput
                    style={styles.input}
                    placeholder="Reference number"
                    placeholderTextColor={Colors.muted}
                    value={policeReport}
                    onChangeText={setPoliceReport}
                  />
                </LabeledInput>
              </>
            )}

            {/* Notes (all) */}
            <LabeledInput label="Notes (optional)">
              <TextInput
                style={[styles.input, { height: 96, textAlignVertical: 'top' }]}
                placeholder="Any extra details..."
                placeholderTextColor={Colors.muted}
                value={notes}
                onChangeText={setNotes}
                multiline
              />
            </LabeledInput>

            {/* Buttons */}
            <View style={styles.row}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={onClose} disabled={submitting}>
                <Text style={[styles.btnText, { color: Colors.slate }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, submitting && { opacity: 0.7 }]}
                onPress={handleSubmit}
                disabled={submitting}
              >
                <MaterialIcons name="check-circle" size={18} color="#fff" />
                <Text style={[styles.btnText, { color: '#fff' }]}>{submitting ? 'Saving...' : 'Submit'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function LabeledInput({ label, children }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function PickerRow({ label, value, onChange, options }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.pillRow}>
        {options.map(opt => {
          const active = value === opt;
          return (
            <TouchableOpacity
              key={opt}
              onPress={() => onChange(opt)}
              style={[
                styles.pill,
                { borderColor: active ? Colors.blue : Colors.border, backgroundColor: active ? '#EFF6FF' : '#FFF' },
              ]}
            >
              <Text style={{ color: active ? Colors.blue : Colors.text, fontWeight: '700' }}>{opt}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function CheckboxRow({ label, checked, onToggle }) {
  return (
    <TouchableOpacity onPress={onToggle} style={styles.checkboxRow}>
      <View style={[styles.checkboxBox, checked && { backgroundColor: Colors.blue, borderColor: Colors.blue }]}>
        {checked ? <MaterialIcons name="check" size={16} color="#fff" /> : null}
      </View>
      <Text style={{ color: Colors.text }}>{label}</Text>
    </TouchableOpacity>
  );
}

function successTitle(action) {
  switch (action) {
    case 'Repair': return 'Repair logged';
    case 'Maintenance': return 'Maintenance logged';
    case 'Hire': return 'Hire recorded';
    case 'End of Life': return 'Asset marked End of Life';
    case 'Report Lost': return 'Loss reported';
    case 'Report Stolen': return 'Theft reported';
    default: return 'Action completed';
  }
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    maxHeight: '88%',
    ...Platform.select({ android: { elevation: 2 } }),
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { color: Colors.text, fontSize: 18, fontWeight: '800' },
  label: { color: Colors.subtle, fontSize: 12, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    color: Colors.text,
    backgroundColor: '#FFF',
  },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  row: { flexDirection: 'row', gap: 12, marginTop: 8, marginBottom: 16 },
  btn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  btnPrimary: {
    backgroundColor: Colors.blue,
  },
  btnGhost: {
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: '#FFF',
  },
  // (upload button styles removed)
  btnText: {
    fontWeight: '800',
  },
  inputWrap: {
    position: 'relative',
  },
  clearBtn: {
    position: 'absolute',
    right: 10,
    top: Platform.OS === 'ios' ? 10 : 8,
    padding: 6,
  },
  // Checkbox row (used for End of Life confirmation)
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 6,
  },
  checkboxBox: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    backgroundColor: '#FFF',
  },
});


function formatDisplayDate(d) {
  try {
    return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      .format(d)
      .replace(/\u00A0/g, ' ');
  } catch {
    const dd = String(d.getDate()).padStart(2, '0');
    const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
    return `${dd} ${m} ${d.getFullYear()}`;
  }
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function DateField({ label, value, onChange, minDate, maxDate }) {
  const [open, setOpen] = React.useState(false);
  const parsed = React.useMemo(() => {
    try {
      return value ? new Date(value) : new Date();
    } catch {
      return new Date();
    }
  }, [value]);

  return (
    <>
      <LabeledInput label={label}>
        <TouchableOpacity onPress={() => setOpen(true)}>
          <View style={[styles.input, { justifyContent: 'center' }]}>
            <Text style={{ color: value ? Colors.text : Colors.muted }}>
              {value ? formatDisplayDate(parsed) : 'Select date'}
            </Text>
          </View>
        </TouchableOpacity>
      </LabeledInput>

      <DatePickerModal
        locale="en-GB"
        mode="single"
        visible={open}
        onDismiss={() => setOpen(false)}
        date={parsed}
        onConfirm={({ date }) => {
          setOpen(false);
          onChange(toISODate(date));
        }}
      />
    </>
  );
}




