// components/checkin/UserPickerModal.js
// Bottom-sheet modal for picking a user to transfer an asset to.

import React from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity,
  Modal, Platform, KeyboardAvoidingView, Alert, StyleSheet,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, sf } from '../../constants/uiTheme';
import { AvatarCircle, sharedStyles } from './shared';

export default function UserPickerModal({
  visible,
  onClose,
  forceUserAssign,
  filteredUsers,
  searchQuery,
  setSearchQuery,
  onSelect,
  loading,
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={() => {
        if (forceUserAssign) {
          Alert.alert('Required', 'Please select a user to assign this asset.');
        } else {
          onClose();
        }
      }}
    >
      <View style={sharedStyles.sheetBackdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
          style={{ width: '100%' }}
        >
          <View style={[sharedStyles.sheet, styles.userModalSheet]}>
            <View style={sharedStyles.sheetHandle} />
            <View style={sharedStyles.modalHeader}>
              <Text style={sharedStyles.modalTitle}>
                {forceUserAssign ? 'Assign to User (required)' : 'Transfer to User'}
              </Text>
              {!forceUserAssign && (
                <TouchableOpacity onPress={onClose}>
                  <MaterialIcons name="close" size={24} color={Colors.subtle} />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.searchContainer}>
              <MaterialIcons name="search" size={20} color={Colors.muted} style={{ marginRight: 8 }} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search name or email"
                placeholderTextColor={Colors.muted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
              />
            </View>

            <FlatList
              data={filteredUsers}
              keyExtractor={(item) => String(item.id)}
              contentContainerStyle={{ paddingBottom: 24 }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.userRow}
                  onPress={() => onSelect(item)}
                  disabled={loading}
                >
                  <AvatarCircle name={item.name} email={item.useremail} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.userName}>{item.name || 'No Name'}</Text>
                    <Text style={styles.userEmail}>{item.useremail}</Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={22} color={Colors.muted} />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={{ padding: 24, alignItems: 'center' }}>
                  <Text style={{ color: Colors.muted }}>No users found</Text>
                </View>
              }
            />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  userModalSheet: { maxHeight: '90%' },
  searchContainer: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: Radius.pill,
    borderWidth: 2,
    borderColor: Colors.line,
    backgroundColor: Colors.chip,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchInput: { flex: 1, height: 40, color: Colors.text },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  userName:  { color: Colors.text,   fontWeight: '700' },
  userEmail: { color: Colors.subtle, marginTop: 2, fontSize: sf(12) },
});
