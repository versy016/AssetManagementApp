// components/tasks/CompleteTaskModal.js
// Sign-off form for completing a manual task. Completion requires details
// describing what was done — it is not a one-tap action.

import React, { useEffect, useState } from 'react';
import {
  View, Text, Modal, StyleSheet, TextInput, TouchableOpacity, Image, Alert,
  ScrollView, ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { getImageFileFromPicker } from '../../utils/getFormFileFromPicker';
import { Colors, Radius, Shadows, sf } from '../../constants/uiTheme';

export default function CompleteTaskModal({ visible, task, onClose, onComplete }) {
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (!visible) { setNote(''); setPhoto(null); setSubmitting(false); } }, [visible]);

  if (!task) return null;
  const canSubmit = note.trim().length > 0 && !submitting;
  const canAttach = !!task.assetId; // attachments file against the linked asset

  const pickFromLibrary = async () => {
    try {
      if (Platform.OS === 'web') {
        const r = await getImageFileFromPicker();
        if (r) setPhoto({ uri: r.uri, name: r.name, mimeType: r.type });
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.8 });
      if (!res.canceled && res.assets?.[0]) setPhoto(res.assets[0]);
    } catch (e) { Alert.alert('Error', e?.message || 'Failed to pick photo'); }
  };

  const takePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission needed', 'Camera access is required.'); return; }
      const res = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.8 });
      if (!res.canceled && res.assets?.[0]) setPhoto(res.assets[0]);
    } catch (e) { Alert.alert('Error', e?.message || 'Failed to take photo'); }
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const ok = await onComplete(task.taskId, note.trim(), canAttach ? photo : null, task.assetId);
    setSubmitting(false);
    if (ok) onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.kav}>
          <View style={s.card}>
            <View style={s.header}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                <MaterialIcons name="check-circle" size={22} color="#15803D" />
                <Text style={s.headerTitle}>Complete task</Text>
              </View>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <MaterialIcons name="close" size={24} color={Colors.sub} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
              {/* Task context */}
              <View style={s.taskBox}>
                <Text style={s.taskTitle} numberOfLines={2}>{task.title}</Text>
                {task.assetId ? (
                  <Text style={s.taskMeta} numberOfLines={1}>
                    <MaterialIcons name="link" size={12} color={Colors.sub} />
                    {' '}{[task.assetTypeName || task.model || 'Asset', `ID: ${task.assetId}`].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
              </View>

              <Text style={s.label}>Completion details *</Text>
              <Text style={s.hint}>Describe what was done to sign off this task.</Text>
              <TextInput
                style={[s.input, s.inputMultiline]}
                placeholder="e.g. Calibration completed and certificate filed…"
                placeholderTextColor={Colors.subtle}
                value={note}
                onChangeText={setNote}
                multiline
                autoFocus
                maxLength={2000}
              />
              {task.assetId ? (
                <Text style={s.note}>This will be recorded in the asset's history.</Text>
              ) : null}

              {/* Optional photo — filed against the linked asset's documents */}
              {canAttach && (
                <>
                  <Text style={[s.label, { marginTop: 18 }]}>Photo / attachment (optional)</Text>
                  {photo ? (
                    <View style={s.photoRow}>
                      <Image source={{ uri: photo.uri }} style={s.photoThumb} />
                      <Text style={s.photoName} numberOfLines={1}>{photo.name || 'Photo attached'}</Text>
                      <TouchableOpacity onPress={() => setPhoto(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <MaterialIcons name="close" size={20} color={Colors.dangerFg} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={s.photoBtnRow}>
                      <TouchableOpacity style={s.photoBtn} onPress={pickFromLibrary}>
                        <MaterialIcons name="photo-library" size={18} color={Colors.primary} />
                        <Text style={s.photoBtnText}>Add photo</Text>
                      </TouchableOpacity>
                      {Platform.OS !== 'web' && (
                        <TouchableOpacity style={s.photoBtn} onPress={takePhoto}>
                          <MaterialIcons name="photo-camera" size={18} color={Colors.primary} />
                          <Text style={s.photoBtnText}>Take photo</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </>
              )}
            </ScrollView>

            <View style={s.footer}>
              <TouchableOpacity style={s.cancelBtn} onPress={onClose} disabled={submitting}>
                <Text style={s.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.submitBtn, !canSubmit && s.submitBtnDisabled]}
                onPress={submit}
                disabled={!canSubmit}
              >
                {submitting ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <MaterialIcons name="check" size={16} color="#fff" />
                    <Text style={s.submitText}>Mark complete</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  kav: { width: '100%', maxWidth: 520, alignSelf: 'center' },
  card: { backgroundColor: Colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, minHeight: '94%', maxHeight: '98%', ...Shadows.lg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.line,
  },
  headerTitle: { fontSize: sf(18), fontWeight: '900', color: Colors.text },
  body: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 20 },
  taskBox: {
    borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.md,
    backgroundColor: Colors.card, padding: 12, marginBottom: 16,
  },
  taskTitle: { fontSize: sf(15), fontWeight: '800', color: Colors.text },
  taskMeta: { fontSize: sf(12), color: Colors.sub, marginTop: 4, fontWeight: '600' },
  label: { fontSize: sf(12), fontWeight: '800', color: Colors.sub, textTransform: 'uppercase', letterSpacing: 0.4 },
  hint: { fontSize: sf(12), color: Colors.sub, marginTop: 3, marginBottom: 8 },
  input: {
    borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.md,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: sf(15), color: Colors.text, backgroundColor: Colors.card,
  },
  inputMultiline: { minHeight: 110, textAlignVertical: 'top' },
  note: { fontSize: sf(12), color: Colors.sub, marginTop: 8, fontStyle: 'italic' },
  photoBtnRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  photoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 14, borderRadius: Radius.md,
    borderWidth: 2, borderColor: Colors.line, backgroundColor: Colors.card,
  },
  photoBtnText: { fontSize: sf(13), fontWeight: '800', color: Colors.primary },
  photoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8,
    padding: 8, borderRadius: Radius.md, borderWidth: 2, borderColor: Colors.line, backgroundColor: Colors.card,
  },
  photoThumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: Colors.chip },
  photoName: { flex: 1, fontSize: sf(13), color: Colors.text, fontWeight: '600' },
  footer: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: Colors.line },
  cancelBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: Radius.md, borderWidth: 2, borderColor: Colors.line },
  cancelText: { fontSize: sf(15), fontWeight: '800', color: Colors.sub2 },
  submitBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, borderRadius: Radius.md, backgroundColor: '#15803D' },
  submitBtnDisabled: { opacity: 0.5 },
  submitText: { fontSize: sf(15), fontWeight: '900', color: '#fff' },
});
