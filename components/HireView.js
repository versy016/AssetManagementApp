// components/HireView.js – Hire section: dashboard (list of hires) + button to view hire form
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import HireDashboard from './HireDashboard';
import HireDisclaimerForm from './HireDisclaimerForm';
import { Colors, Radius, sf } from '../constants/uiTheme';

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
      {showForm ? (
        <View style={styles.actionBar}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => backToList()}
            activeOpacity={0.8}
          >
            <Text style={styles.backButtonText}>Back to list</Text>
          </TouchableOpacity>
        </View>
      ) : null}
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
  actionBar: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.card,
    borderBottomWidth: 2,
    borderBottomColor: Colors.line,
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: Radius.md,
    backgroundColor: Colors.accentMuted,
    borderWidth: 2,
    borderColor: Colors.line,
  },
  backButtonText: {
    fontSize: sf(13),
    fontWeight: '700',
    color: Colors.accent,
    textTransform: 'uppercase',
  },
  content: { flex: 1, minHeight: 0 },
});
