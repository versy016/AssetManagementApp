// app/components/ActionsForm.js
import React, { useMemo, useState } from 'react';
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
import { MaterialIcons } from '@expo/vector-icons';

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

export default function ActionsForm({
  visible,
  onClose,
  asset,                // { id, ... }
  action,               // one of ACTIONS
  onSubmitted,          // (updatedAssetPartial, meta) => void
  submitToBackend = true,
  statusMap = STATUS_MAP,
  apiBaseUrl,
}) {
  const [submitting, setSubmitting] = useState(false);

  // Common fields across forms
  const [date, setDate] = useState(new Date().toISOString().slice(0,10)); // YYYY-MM-DD
  const [notes, setNotes] = useState('');

  // Repair / Maintenance only
  const [priority, setPriority] = useState('Normal'); // Low | Normal | High | Critical
  const [summary, setSummary] = useState('');
  const [cost, setCost] = useState('');

  // Hire only
  const [hireTo, setHireTo] = useState('');
  const [hireStart, setHireStart] = useState(new Date().toISOString().slice(0,10));
  const [hireEnd, setHireEnd] = useState('');
  const [hireRate, setHireRate] = useState('');

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

  const validate = () => {
    if (!action || !ACTIONS.includes(action)) {
      Alert.alert('Invalid', 'Please choose a valid action.'); 
      return false;
    }
    if (fields === 'service') {
      if (!summary.trim()) {
        Alert.alert('Missing info', 'Please add a short summary.');
        return false;
      }
    } else if (fields === 'hire') {
      if (!hireTo.trim()) return Alert.alert('Missing info', 'Who is this asset being hired to?'), false;
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
      // Build a metadata record for parent logging or future POST /asset-actions
      const meta = {
        action,
        date,
        notes,
        ...(fields === 'service' ? { summary, priority, cost: Number(cost) || 0 } : {}),
        ...(fields === 'hire' ? { hireTo, hireStart, hireEnd, hireRate: Number(hireRate) || 0 } : {}),
        ...(fields === 'eol' ? { eolReason } : {}),
        ...(fields === 'lost' ? { where } : {}),
        ...(fields === 'stolen' ? { where, policeReport } : {}),
      };

      // Optionally update asset status (only for API-accepted statuses)
      let updated = {};
      const newStatus = statusMap[action]; // may be undefined
      if (submitToBackend && newStatus) {
        const res = await fetch(`${apiBaseUrl}/assets/${asset?.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(t || `Failed to set status: ${newStatus}`);
        }
        updated.status = newStatus;
      }

      // Let parent update UI (optimistic or refetch)
      onSubmitted && onSubmitted(updated, meta);

      Alert.alert('Success', successTitle(action), [
        { text: 'OK', onPress: onClose },
      ]);
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
            <Text style={styles.title}>{action || 'Action'}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialIcons name="close" size={24} color={Colors.subtle} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {/* Date */}
            <LabeledInput label="Date (YYYY-MM-DD)">
              <TextInput
                style={styles.input}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={Colors.muted}
                value={date}
                onChangeText={setDate}
              />
            </LabeledInput>

            {fields === 'service' && (
              <>
                <LabeledInput label="Summary *">
                  <TextInput
                    style={styles.input}
                    placeholder="Short summary"
                    placeholderTextColor={Colors.muted}
                    value={summary}
                    onChangeText={setSummary}
                  />
                </LabeledInput>

                <PickerRow
                  label="Priority"
                  value={priority}
                  onChange={setPriority}
                  options={['Low','Normal','High','Critical']}
                />

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
              </>
            )}

            {fields === 'hire' && (
              <>
                <LabeledInput label="Hire To *">
                  <TextInput
                    style={styles.input}
                    placeholder="Company / Person"
                    placeholderTextColor={Colors.muted}
                    value={hireTo}
                    onChangeText={setHireTo}
                  />
                </LabeledInput>

                <LabeledInput label="Start Date * (YYYY-MM-DD)">
                  <TextInput
                    style={styles.input}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={Colors.muted}
                    value={hireStart}
                    onChangeText={setHireStart}
                  />
                </LabeledInput>

                <LabeledInput label="End Date (optional)">
                  <TextInput
                    style={styles.input}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={Colors.muted}
                    value={hireEnd}
                    onChangeText={setHireEnd}
                  />
                </LabeledInput>

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
                placeholder="Any extra details…"
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
                <Text style={[styles.btnText, { color: '#fff' }]}>{submitting ? 'Saving…' : 'Submit'}</Text>
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
  btnText: {
    fontWeight: '800',
  },
});
