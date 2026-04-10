// components/HireView.js – Hire section: dashboard (list of hires) + button to view hire form
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import HireDashboard from './HireDashboard';
import HireDisclaimerForm from './HireDisclaimerForm';
import { Colors } from '../constants/uiTheme';

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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Hire</Text>
        <TouchableOpacity
          style={styles.topButton}
          onPress={() => (showForm ? backToList() : openNewForm())}
          activeOpacity={0.8}
        >
          <Text style={styles.topButtonText}>
            {showForm ? 'Back to list' : 'View hire form'}
          </Text>
        </TouchableOpacity>
      </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
    backgroundColor: Colors.card,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
  },
  topButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: Colors.primary,
  },
  topButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFF',
  },
  content: { flex: 1, minHeight: 0 },
});
