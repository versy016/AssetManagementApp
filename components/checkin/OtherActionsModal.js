// components/checkin/OtherActionsModal.js
// Bottom-sheet modal showing Hire / EOL / Report Lost / Report Stolen actions.

import React from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, sf } from '../../constants/uiTheme';
import { sharedStyles } from './shared';

export default function OtherActionsModal({ visible, onClose, isAdmin, loading, onAction }) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={sharedStyles.sheetBackdrop}>
        <View style={sharedStyles.sheet}>
          <View style={sharedStyles.sheetHandle} />
          <View style={sharedStyles.modalHeader}>
            <Text style={sharedStyles.modalTitle}>Other Actions</Text>
            <TouchableOpacity onPress={onClose}>
              <MaterialIcons name="close" size={24} color={Colors.subtle} />
            </TouchableOpacity>
          </View>

          <View style={{ paddingVertical: 8 }}>
            {isAdmin && (
              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => onAction('hire')}
                disabled={loading}
              >
                <MaterialIcons name="work-outline" size={22} color="#0369A1" />
                <Text style={styles.actionText}>Hire</Text>
              </TouchableOpacity>
            )}
            {isAdmin && (
              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => onAction('eol')}
                disabled={loading}
              >
                <MaterialIcons name="remove-circle-outline" size={22} color="#B91C1C" />
                <Text style={styles.actionText}>End of Life</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => onAction('lost')}
              disabled={loading}
            >
              <MaterialIcons name="lost-and-found" size={22} color="#D97706" />
              <Text style={styles.actionText}>Report Lost</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => onAction('stolen')}
              disabled={loading}
            >
              <MaterialIcons name="warning-amber" size={22} color="#DC2626" />
              <Text style={styles.actionText}>Report Stolen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  actionText: { color: Colors.text, fontWeight: '700', fontSize: sf(16) },
});
