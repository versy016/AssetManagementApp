// components/tasks/TaskActionModal.js
// Modal for marking a task done or signing off a pending action.
// All state lives in useTasks(); this component is pure presentation.

import React from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Modal,
  Platform,
  Image,
  KeyboardAvoidingView,
  Keyboard,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { DatePickerModal } from 'react-native-paper-dates';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { getImageFileFromPicker } from '../../utils/getFormFileFromPicker';
import { Colors, Radius, sf } from '../../constants/uiTheme';
import { useTheme } from 'react-native-paper';
import AppTextInput from '../ui/AppTextInput';
import { prettyDate } from '../../hooks/useTasks';
import { showError } from '../../utils/showError';
import { FIELD_LIMITS } from '../../constants/fieldLimits';
import { IMAGE_UPLOAD_HINT, TASK_REPORT_UPLOAD_HINT, ASSET_DOCUMENT_FIELD_HINT } from '../../constants/uploadFormats';

/**
 * All props come straight from useTasks() return value.
 */
export default function TaskActionModal({
  // visibility
  actionOpen,
  setActionOpen,

  // task
  actionTask,

  // date state
  dateOpen,
  setDateOpen,
  actionNextDate,
  setActionNextDate,
  setNextMonths,

  // doc / photo state
  actionDocSlug,
  actionDocPicked,
  setActionDocPicked,
  actionPhoto,
  setActionPhoto,
  actionNote,
  setActionNote,
  signoffReport,
  setSignoffReport,
  signoffChoice,
  setSignoffChoice,
  relevantDocName,
  setRelevantDocName,

  // submit
  actionSubmitting,
  handleSubmitTaskAction,

  // scroll ref
  actionScrollRef,
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={actionOpen}
      transparent
      animationType="fade"
      onRequestClose={() => setActionOpen(false)}
    >
      <View style={[styles.menuOverlay, { justifyContent: 'center', alignItems: 'center', paddingHorizontal: '4%' }]}>
        <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />
        <TouchableOpacity style={styles.menuBackdrop} onPress={() => setActionOpen(false)} />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
          style={{
            width: '100%',
            maxWidth: 520,
            ...(Platform.OS === 'web' ? { maxHeight: '85vh' } : {}),
            ...(Platform.OS !== 'web' ? { marginTop: insets.top, marginBottom: insets.bottom, maxHeight: '90%' } : {}),
          }}
        >
          <View style={[
            styles.taskModalCard,
            Platform.OS === 'web' && { maxHeight: '85vh' },
            Platform.OS !== 'web' && {
              paddingTop: Math.max(16, insets.top + 8),
              paddingBottom: Math.max(16, insets.bottom + 8),
            },
          ]}>
            <ScrollView
              ref={actionScrollRef}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                paddingBottom: Platform.OS === 'web' ? 32 : 16,
                ...(Platform.OS !== 'web' ? { paddingTop: 4 } : {}),
              }}
              showsVerticalScrollIndicator={true}
              style={Platform.OS === 'web' ? { maxHeight: '75vh' } : undefined}
            >
              <Text style={{ fontSize: sf(18), fontWeight: '900', marginBottom: 8 }}>
                {actionTask?.title || 'Action Task'}
              </Text>
              <Text style={{ color: '#6B7280', marginBottom: 14 }}>
                {actionTask?.subtitle || ''}
              </Text>

              {/* ── Work photos (sign-off only) ────────────────────── */}
              {actionTask?.kind === 'signoff' && (
                <View style={{ marginBottom: 20, alignItems: 'center' }}>
                  <Text style={{ color: '#6B7280', fontSize: sf(12), marginBottom: 10, fontWeight: '600' }}>Work photo(s)</Text>
                  {Array.isArray(actionTask?.actionImages) && actionTask.actionImages.length > 0 ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ alignItems: 'center', justifyContent: 'center' }}
                    >
                      {actionTask.actionImages.map((url, idx) => (
                        <Image
                          key={`work-img-${idx}`}
                          source={{ uri: url }}
                          style={{
                            width: 220, height: 220, borderRadius: 12,
                            borderWidth: 1, borderColor: '#E5E7EB',
                            marginRight: idx < actionTask.actionImages.length - 1 ? 12 : 0,
                          }}
                          resizeMode="cover"
                        />
                      ))}
                    </ScrollView>
                  ) : (
                    <Text style={{ color: '#9CA3AF', fontSize: sf(13) }}>No work photos attached</Text>
                  )}
                </View>
              )}

              {/* ── Sign-off branch ────────────────────────────────── */}
              {actionTask?.kind === 'signoff' ? (
                <>
                  {/* Completed? */}
                  <View style={{ marginBottom: 10 }}>
                    <Text style={{ color: '#6B7280', fontSize: sf(12), marginBottom: 6 }}>
                      Has this work been completed?
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      {['yes', 'no'].map((choice) => (
                        <TouchableOpacity
                          key={choice}
                          onPress={() => setSignoffChoice(choice)}
                          style={[
                            styles.quickDateChip,
                            {
                              backgroundColor: signoffChoice === choice
                                ? (choice === 'yes' ? '#DBEAFE' : '#FEE2E2')
                                : '#fff',
                              borderColor: signoffChoice === choice
                                ? (choice === 'yes' ? '#93C5FD' : '#FCA5A5')
                                : '#E5E7EB',
                            },
                          ]}
                        >
                          <Text style={[
                            styles.quickDateChipText,
                            { color: signoffChoice === choice ? (choice === 'yes' ? '#1D4ED8' : '#B91C1C') : '#374151' },
                          ]}>
                            {choice === 'yes' ? 'Yes' : 'No'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Next service date (maintenance only) */}
                  {signoffChoice === 'yes' && String(actionTask?.actionType || '').toUpperCase() === 'MAINTENANCE' && (
                    <>
                      <View style={{ marginBottom: 10 }}>
                        <Text style={{ color: '#6B7280', fontSize: sf(12), marginBottom: 6 }}>Next Service Date</Text>
                        <TouchableOpacity onPress={() => setDateOpen(true)}>
                          <View style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 }}>
                            <Text style={{ color: '#111827' }}>{prettyDate(new Date(actionNextDate))}</Text>
                          </View>
                        </TouchableOpacity>
                      </View>
                      <QuickDateRow setNextMonths={setNextMonths} />
                    </>
                  )}

                  {/* Report upload (maintenance or repair) */}
                  {signoffChoice === 'yes' &&
                    (String(actionTask?.actionType || '').toUpperCase() === 'MAINTENANCE' ||
                      String(actionTask?.actionType || '').toUpperCase() === 'REPAIR') && (
                    <View style={{ marginTop: 10 }}>
                      <Text style={{ color: '#6B7280', fontSize: sf(12), marginBottom: 6 }}>
                        {String(actionTask.actionType || '').toUpperCase() === 'REPAIR'
                          ? 'Upload Repair Report (optional)'
                          : 'Upload Service Report (optional)'}
                      </Text>
                      <Text style={{ color: '#94A3B8', fontSize: sf(11), marginBottom: 6, lineHeight: 16 }}>{TASK_REPORT_UPLOAD_HINT}</Text>
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <TouchableOpacity
                          style={[styles.btn, styles.btnGhost, { flex: 1 }]}
                          onPress={async () => {
                            try {
                              const res = await DocumentPicker.getDocumentAsync({
                                type: ['application/pdf', 'application/msword',
                                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                                  'image/*'],
                                multiple: false,
                              });
                              if (res.canceled) return;
                              const asset = res.assets?.[0];
                              if (!asset) return;
                              setSignoffReport(asset);
                            } catch (e) {
                              showError(e, 'Failed to select document');
                            }
                          }}
                        >
                          <Text style={{ fontWeight: '700', color: '#2563EB' }}>
                            {signoffReport ? 'Replace Report' : 'Upload Report'}
                          </Text>
                        </TouchableOpacity>
                        {signoffReport && (
                          <TouchableOpacity
                            style={[styles.btn, { flex: 1, backgroundColor: '#FEE2E2' }]}
                            onPress={() => setSignoffReport(null)}
                          >
                            <Text style={{ fontWeight: '700', color: '#B91C1C' }}>Remove</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      {signoffReport && (
                        <Text style={{ marginTop: 4, fontSize: sf(12), color: '#6B7280' }}>
                          Attached: {signoffReport.name || 'document'}
                        </Text>
                      )}
                    </View>
                  )}

                  {/* Additional doc upload (yes branch) */}
                  {signoffChoice === 'yes' && (
                    <>
                      <DocUploadSection
                        label={actionDocSlug
                          ? `Upload ${String(actionDocSlug).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}${actionTask?.scope === 'field' ? ' (required)' : ' (optional)'}`
                          : 'Other relevant document (optional)'}
                        actionDocSlug={actionDocSlug}
                        actionDocPicked={actionDocPicked}
                        setActionDocPicked={setActionDocPicked}
                      />
                      <View style={{ marginTop: 10 }}>
                        <Text style={{ color: '#6B7280', fontSize: sf(12), marginBottom: 6 }}>Other relevant document name</Text>
                        <TextInput
                          placeholder="e.g. Certificate, Invoice, Compliance doc"
                          placeholderTextColor="#9CA3AF"
                          value={relevantDocName}
                          onChangeText={setRelevantDocName}
                          maxLength={FIELD_LIMITS.DESCRIPTION}
                          style={{
                            height: 36,
                            fontSize: sf(14),
                            borderWidth: 1,
                            borderColor: '#E5E7EB',
                            borderRadius: 8,
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            backgroundColor: theme.colors.surface,
                            color: theme.dark ? '#fff' : '#111',
                          }}
                        />
                      </View>
                      <PhotoSection actionPhoto={actionPhoto} setActionPhoto={setActionPhoto} />
                    </>
                  )}
                </>
              ) : (
                /* ── Regular task branch ────────────────────────────── */
                <>
                  <View style={{ marginBottom: 10 }}>
                    <Text style={{ color: '#6B7280', fontSize: sf(12), marginBottom: 6 }}>Select next date</Text>
                    <TouchableOpacity onPress={() => setDateOpen(true)}>
                      <View style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 }}>
                        <Text style={{ color: '#111827' }}>{prettyDate(new Date(actionNextDate))}</Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                  <QuickDateRow setNextMonths={setNextMonths} />
                </>
              )}

              {/* ── Note (both paths) ──────────────────────────────── */}
              <View style={{ marginTop: 8 }}>
                <Text style={{ color: '#6B7280', fontSize: sf(12), marginBottom: 6 }}>Note (optional)</Text>
                <AppTextInput
                  style={{ minHeight: 44, backgroundColor: theme.colors.surface }}
                  placeholder="Add a note"
                  value={actionNote}
                  onChangeText={setActionNote}
                  multiline
                  onFocus={() => {
                    if (Platform.OS !== 'web') {
                      setTimeout(() => actionScrollRef.current?.scrollToEnd({ animated: true }), 150);
                    }
                  }}
                />
                {Platform.OS !== 'web' && (
                  <TouchableOpacity onPress={() => Keyboard.dismiss()} style={{ alignSelf: 'flex-end', marginTop: 4 }}>
                    <Text style={{ fontSize: sf(12), color: '#2563EB', fontWeight: '600' }}>Hide keyboard</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* ── Doc + photo for regular tasks ─────────────────── */}
              {actionTask?.kind !== 'signoff' && (
                <>
                  <DocUploadSection
                    label={actionDocSlug
                      ? `Upload ${String(actionDocSlug).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}${actionTask?.scope === 'field' ? ' (required)' : ' (optional)'}`
                      : 'Other relevant document (optional)'}
                    actionDocSlug={actionDocSlug}
                    actionDocPicked={actionDocPicked}
                    setActionDocPicked={setActionDocPicked}
                    containerStyle={{ marginTop: 10 }}
                  />
                  <PhotoSection actionPhoto={actionPhoto} setActionPhoto={setActionPhoto} containerStyle={{ marginTop: 14 }} />
                </>
              )}
            </ScrollView>

            {/* ── Footer buttons ─────────────────────────────────── */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
              <TouchableOpacity
                onPress={() => setActionOpen(false)}
                style={[styles.btn, styles.btnGhost, { flex: 1 }]}
              >
                <Text style={styles.menuText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={actionSubmitting}
                onPress={handleSubmitTaskAction}
                style={[styles.btn, styles.btnPrimary, { flex: 1, opacity: actionSubmitting ? 0.7 : 1 }]}
              >
                <MaterialIcons name="check-circle" size={18} color="#fff" />
                <Text style={[styles.menuText, { color: '#fff', fontWeight: '800' }]}>
                  {actionSubmitting
                    ? 'Saving...'
                    : actionTask?.kind === 'signoff'
                      ? String(actionTask?.actionType || '').toUpperCase() === 'MAINTENANCE'
                        ? 'Sign off Service'
                        : 'Sign Off'
                      : 'Mark Done'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>

      {/* Date picker — next service may be scheduled at most 6 months out */}
      <DatePickerModal
        locale="en-GB"
        mode="single"
        visible={dateOpen}
        onDismiss={() => setDateOpen(false)}
        date={new Date(actionNextDate)}
        validRange={{ startDate: serviceWindowStart(), endDate: serviceWindowEnd() }}
        onConfirm={({ date }) => {
          setDateOpen(false);
          const y = date.getFullYear();
          const m = String(date.getMonth() + 1).padStart(2, '0');
          const d = String(date.getDate()).padStart(2, '0');
          setActionNextDate(`${y}-${m}-${d}`);
        }}
      />
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small sub-components (private to this file)
// ─────────────────────────────────────────────────────────────────────────────

// Next service can be booked at most 6 months ahead, so the quick chips stop at 6.
function QuickDateRow({ setNextMonths }) {
  return (
    <View style={styles.quickDateRow}>
      {[1, 3, 6].map((months) => (
        <TouchableOpacity key={months} onPress={() => setNextMonths(months)} style={styles.quickDateChip}>
          <Text style={styles.quickDateChipText}>+{months} month{months === 1 ? '' : 's'}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// Shared service-window bounds: today .. today + 6 months. Defined once here so
// the picker's validRange and any future callers stay consistent.
function serviceWindowStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function serviceWindowEnd() {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const target = new Date(base.getFullYear(), base.getMonth() + 6, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(base.getDate(), last));
  return target;
}

function DocUploadSection({ label, actionDocSlug, actionDocPicked, setActionDocPicked, containerStyle }) {
  return (
    <View style={[{ marginTop: 0 }, containerStyle]}>
      <Text style={{ color: '#6B7280', fontSize: sf(12), marginBottom: 6 }}>{label}</Text>
      <Text style={{ color: '#94A3B8', fontSize: sf(11), marginBottom: 8, lineHeight: 16 }}>{ASSET_DOCUMENT_FIELD_HINT}</Text>
      {actionDocPicked ? (
        <Text style={{ marginBottom: 6, fontStyle: 'italic', color: '#374151' }}>
          Attached: {actionDocPicked.name || 'document'}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <TouchableOpacity
          style={[styles.btn, styles.btnGhost, { paddingVertical: 10, flex: 1 }]}
          onPress={async () => {
            try {
              const res = await DocumentPicker.getDocumentAsync({
                type: ['application/pdf', 'application/msword',
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
                multiple: false,
              });
              if (res.canceled) return;
              const asset = res.assets?.[0];
              if (!asset) return;
              setActionDocPicked(asset);
            } catch (e) {
              showError(e, 'Failed to select document');
            }
          }}
        >
          <Text style={{ fontWeight: '700', color: '#2563EB' }}>
            {actionDocPicked
              ? `Replace ${String(actionDocSlug || 'document').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`
              : `Upload ${String(actionDocSlug || 'document').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`}
          </Text>
        </TouchableOpacity>
        {actionDocPicked ? (
          <TouchableOpacity
            style={[styles.btn, { paddingVertical: 10, backgroundColor: '#fdecea', flex: 1 }]}
            onPress={() => setActionDocPicked(null)}
          >
            <Text style={{ color: '#b00020' }}>Remove</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

function PhotoSection({ actionPhoto, setActionPhoto, containerStyle }) {
  return (
    <View style={[{ marginTop: 14 }, containerStyle]}>
      <Text style={{ color: '#6B7280', fontSize: sf(12), marginBottom: 6 }}>Photo (optional)</Text>
      <Text style={{ color: '#94A3B8', fontSize: sf(11), marginBottom: 8, lineHeight: 16 }}>{IMAGE_UPLOAD_HINT}</Text>
      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {Platform.OS !== 'web' && (
          <TouchableOpacity
            style={[styles.btn, styles.btnGhost, { paddingVertical: 10 }]}
            onPress={async () => {
              try {
                const { status } = await ImagePicker.requestCameraPermissionsAsync();
                if (status !== 'granted') {
                  Alert.alert('Permission needed', 'Camera access is required to take a photo.');
                  return;
                }
                const res = await ImagePicker.launchCameraAsync({
                  mediaTypes: ImagePicker.MediaTypeOptions.Images,
                  allowsEditing: true,
                  quality: 0.8,
                });
                if (!res.canceled && res.assets?.[0]) setActionPhoto(res.assets[0]);
              } catch (e) {
                showError(e, 'Failed to take photo');
              }
            }}
          >
            <Text style={{ fontWeight: '700', color: '#2563EB' }}>Take photo</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.btn, styles.btnGhost, { paddingVertical: 10 }]}
          onPress={async () => {
            try {
              if (Platform.OS === 'web') {
                const r = await getImageFileFromPicker();
                if (!r) return;
                setActionPhoto({ uri: r.uri, name: r.name, mimeType: r.type });
                return;
              }
              const res = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                quality: 0.8,
              });
              if (!res.canceled && res.assets?.[0]) setActionPhoto(res.assets[0]);
            } catch (e) {
              showError(e, 'Failed to pick photo');
            }
          }}
        >
          <Text style={{ fontWeight: '700', color: '#2563EB' }}>
            {Platform.OS === 'web' ? 'Choose photo' : 'Choose from library'}
          </Text>
        </TouchableOpacity>
        {actionPhoto ? (
          <>
            <Image source={{ uri: actionPhoto.uri }} style={{ width: 48, height: 48, borderRadius: 8 }} resizeMode="cover" />
            <TouchableOpacity
              style={[styles.btn, { paddingVertical: 10, backgroundColor: '#fdecea' }]}
              onPress={() => setActionPhoto(null)}
            >
              <Text style={{ color: '#b00020' }}>Remove</Text>
            </TouchableOpacity>
          </>
        ) : null}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  menuBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  taskModalCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: 16,
    width: '100%',
    maxWidth: 520,
    borderWidth: 2,
    borderColor: Colors.line,
  },
  menuText: { fontSize: sf(16), color: Colors.text },
  btn: {
    flex: 1,
    borderRadius: Radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  btnPrimary: { backgroundColor: Colors.accent },
  btnGhost: { borderWidth: 2, borderColor: Colors.line, backgroundColor: Colors.card },
  quickDateRow: { flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 4 },
  quickDateChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: Colors.line,
    backgroundColor: Colors.chip,
  },
  quickDateChipText: { color: Colors.accent, fontWeight: '800' },
});
