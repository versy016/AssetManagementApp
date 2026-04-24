// components/checkin/CreateNoteModal.js
// Centred modal for creating a freeform note on an asset (no transfer).

import React from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  Modal, Platform, ScrollView, KeyboardAvoidingView, StyleSheet,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, sf } from '../../constants/uiTheme';
import { sharedStyles } from './shared';
import { FIELD_LIMITS } from '../../constants/fieldLimits';

export default function CreateNoteModal({
  visible,
  onClose,
  isPlaceholder,
  createNoteText,
  setCreateNoteText,
  createNoteSubmitting,
  onSubmit,
}) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View style={[sharedStyles.sheetBackdrop, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}
          style={{ width: '100%', maxWidth: 360, alignSelf: 'center' }}
        >
          <View style={[sharedStyles.sheet, styles.createNoteSheet]}>
            <View style={sharedStyles.sheetHandle} />
            <View style={sharedStyles.modalHeader}>
              <Text style={sharedStyles.modalTitle}>
                {isPlaceholder ? 'Create a note for this asset' : 'Create note'}
              </Text>
              <TouchableOpacity onPress={onClose}>
                <MaterialIcons name="close" size={24} color={Colors.subtle} />
              </TouchableOpacity>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.createNoteContent}
              showsVerticalScrollIndicator={false}
            >
              <TextInput
                placeholder="Create a note for this asset"
                value={createNoteText}
                onChangeText={setCreateNoteText}
                style={[sharedStyles.input, { minHeight: 80 }]}
                placeholderTextColor={Colors.subtle}
                multiline
                maxLength={FIELD_LIMITS.NOTES}
                editable={!createNoteSubmitting}
              />
              <TouchableOpacity
                style={[sharedStyles.btnPrimary, styles.submitBtn, createNoteSubmitting && { opacity: 0.7 }]}
                onPress={onSubmit}
                disabled={createNoteSubmitting}
              >
                <MaterialIcons name="check-circle" size={18} color="#fff" />
                <Text style={sharedStyles.btnPrimaryText} numberOfLines={1}>
                  {createNoteSubmitting ? 'Saving...' : 'Submit'}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  createNoteSheet: {
    borderRadius: 18,
    width: '100%',
    minHeight: 220,
    maxHeight: '90%',
    overflow: 'hidden',
  },
  createNoteContent: {
    paddingHorizontal: 16,
    paddingBottom: 28,
    paddingTop: 4,
  },
  submitBtn: {
    marginTop: 12,
    alignSelf: 'flex-start',
    maxWidth: 160,
  },
});
