// components/HireView.js – Hire section: dashboard (list of hires) + button to view hire form
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import HireDashboard from './HireDashboard';
import HireDisclaimerForm from './HireDisclaimerForm';
import ScreenHeader from './ui/ScreenHeader';
import { Colors, Radius, Shadows } from '../constants/uiTheme';

export default function HireView() {
  const [showForm, setShowForm] = useState(false);
  const [editingHire, setEditingHire] = useState(null);
  /** 'new' = blank form; 'edit' = update same hire; 'copy' = prefill from hire but create new record */
  const [hireFormMode, setHireFormMode] = useState('new');
  /** ID of the hire to highlight in the list after a successful form submission. */
  const [highlightedHireId, setHighlightedHireId] = useState(null);

  const openNewForm = () => {
    setEditingHire(null);
    setHireFormMode('new');
    setShowForm(true);
  };

  const backToList = (hireId) => {
    setShowForm(false);
    setEditingHire(null);
    setHireFormMode('new');
    if (hireId) setHighlightedHireId(hireId);
  };

  const actionButton = (
    <TouchableOpacity
      style={styles.topButton}
      onPress={() => (showForm ? backToList() : openNewForm())}
      activeOpacity={0.8}
    >
      <Text style={styles.topButtonText}>
        {showForm ? 'Back to list' : 'New hire'}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={showForm ? (hireFormMode === 'edit' ? 'Edit Hire' : 'New Hire') : 'Hire'}
        right={actionButton}
      />
      <View style={styles.content}>
        {showForm ? (
          <HireDisclaimerForm
            initialHire={editingHire}
            hireFormMode={hireFormMode}
            onGenerated={backToList}
          />
        ) : (
          <HireDashboard
            onViewForm={openNewForm}
            highlightId={highlightedHireId}
            onHighlightDone={() => setHighlightedHireId(null)}
            onEditHire={(hire) => {
              setEditingHire(hire);
              setHireFormMode('edit');
              setShowForm(true);
            }}
            onCopyHire={(hire) => {
              setEditingHire(hire);
              setHireFormMode('copy');
              setShowForm(true);
            }}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0 },
  topButton: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: Radius.md,
    backgroundColor: Colors.accent,
  },
  topButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFF',
    textTransform: 'uppercase',
  },
  content: { flex: 1, minHeight: 0 },
});
