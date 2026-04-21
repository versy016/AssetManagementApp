// components/checkin/AssignImportedModal.js
// Bottom-sheet modal for assigning an imported (UUID-id) asset to this QR code.

import React from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity,
  Modal, Platform, ScrollView, KeyboardAvoidingView,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, sf } from '../../constants/uiTheme';
import { sharedStyles } from './shared';

export default function AssignImportedModal({
  visible,
  onClose,
  assignQuery,
  setAssignQuery,
  assignLoading,
  filteredAssignResults,
  assignSelected,
  setAssignSelected,
  onConfirm,
}) {
  return (
    <Modal
      transparent
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={sharedStyles.sheetBackdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}
          style={{ width: '100%' }}
        >
          <View style={[sharedStyles.sheet, { maxHeight: '85%' }]}>
            <View style={sharedStyles.modalHeader}>
              <Text style={sharedStyles.modalTitle}>Assign Imported Asset</Text>
              <TouchableOpacity onPress={onClose}>
                <MaterialIcons name="close" size={20} color={Colors.subtle} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, gap: 14 }}
              keyboardShouldPersistTaps="always"
              keyboardDismissMode="none"
            >
              <View style={sharedStyles.optionCard}>
                <View style={sharedStyles.optionHeaderRow}>
                  <MaterialIcons name="search" size={18} color={Colors.blue} />
                  <Text style={sharedStyles.optionTitle}>Find Imported Asset</Text>
                </View>
                <Text style={sharedStyles.optionDesc}>
                  Pick an imported asset (UUID id) to assign to this QR. We will move its data onto this QR id
                  and reset the original record to a placeholder.
                </Text>

                <TextInput
                  placeholder="Search by model, type, serial, other id, notes"
                  value={assignQuery}
                  onChangeText={setAssignQuery}
                  style={[sharedStyles.input, { borderColor: Colors.amber, borderWidth: 2, backgroundColor: '#FFFBF0' }]}
                  placeholderTextColor={Colors.subtle}
                  autoFocus
                />

                <View style={{ marginTop: 8 }}>
                  {assignLoading ? (
                    <ActivityIndicator />
                  ) : (
                    <FlatList
                      data={filteredAssignResults}
                      keyExtractor={(item) => String(item.id)}
                      style={{ maxHeight: 500 }}
                      contentContainerStyle={{ paddingBottom: 8 }}
                      ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                      scrollEnabled={filteredAssignResults.length > 5}
                      keyboardShouldPersistTaps="always"
                      keyboardDismissMode="none"
                      renderItem={({ item }) => (
                        <TouchableOpacity
                          style={[
                            sharedStyles.optionCard,
                            { padding: 12, borderColor: assignSelected?.id === item.id ? Colors.amber : Colors.border },
                          ]}
                          onPress={() => setAssignSelected(item)}
                          activeOpacity={0.7}
                          delayPressIn={0}
                        >
                          <Text style={{ fontWeight: '700', color: Colors.text }}>{item.model || 'Unnamed'}</Text>
                          <Text style={{ fontWeight: '700', color: Colors.subtle, marginTop: 2 }}>
                            {item.asset_types?.name || 'Unknown type'}
                          </Text>
                          {item.serial_number ? (
                            <Text style={{ fontWeight: '700', color: Colors.subtle, marginTop: 2 }}>
                              SN: {item.serial_number}
                            </Text>
                          ) : null}
                          {item.other_id ? (
                            <Text style={{ fontWeight: '700', color: Colors.muted, marginTop: 2 }}>
                              Other ID: {item.other_id}
                            </Text>
                          ) : null}
                        </TouchableOpacity>
                      )}
                      ListEmptyComponent={() => (
                        <Text style={{ color: Colors.muted, textAlign: 'center', paddingVertical: 16 }}>
                          No matches
                        </Text>
                      )}
                    />
                  )}
                </View>
              </View>
            </ScrollView>

            {/* Fixed confirm bar */}
            <View style={styles.confirmBar}>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: Colors.slate, opacity: assignLoading ? 0.6 : 1 }]}
                disabled={assignLoading}
                onPress={onClose}
              >
                <MaterialIcons name="close" size={20} color="#FFFFFF" />
                <Text style={styles.confirmBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.confirmBtn,
                  { backgroundColor: Colors.amber, opacity: (!assignSelected || assignLoading) ? 0.6 : 1 },
                ]}
                disabled={!assignSelected || assignLoading}
                onPress={() => assignSelected && onConfirm(assignSelected.id)}
              >
                <MaterialIcons name="qr-code" size={20} color="#FFFFFF" />
                <Text style={styles.confirmBtnText}>Assign</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  confirmBar: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 20 : 14,
    backgroundColor: Colors.card,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  confirmBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 8,
    paddingVertical: 10,
    minHeight: 44,
  },
  confirmBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: sf(14),
  },
});
