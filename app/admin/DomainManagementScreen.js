// DomainManagementScreen.js - Admin interface for managing allowed email domains

// Import React and hooks for state and effect management
import React, { useEffect, useState } from 'react';
// Import UI components from React Native
import { View, Text, TextInput, TouchableOpacity, FlatList, Alert, StyleSheet } from 'react-native';
// Import Firestore helpers for domain CRUD operations
import { collection, addDoc, doc, setDoc, deleteDoc, onSnapshot, getFirestore } from 'firebase/firestore';
// Import Firebase Auth config (not directly used here, but available for future use)
import { auth } from '../../firebaseConfig';
import { Colors, Radius, Shadows, sf } from '../../constants/uiTheme';

// Initialize Firestore database instance
const db = getFirestore();

// Main component for domain management UI and logic
export default function DomainManagementScreen() {
  // State for list of allowed domains and new domain input
  const [domains, setDomains] = useState([]);
  const [newDomain, setNewDomain] = useState('');

  // Listen for real-time updates to allowedDomains collection in Firestore
  useEffect(() => {
    // Subscribe to changes in the allowedDomains collection
    const unsub = onSnapshot(collection(db, 'allowedDomains'), (snapshot) => {
      const domainData = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));
      setDomains(domainData);
    });
    return () => unsub(); // Cleanup subscription on unmount
  }, []);

  // Add a new domain to Firestore
  const handleAddDomain = async () => {
    if (!newDomain) {
      Alert.alert('Error', 'Please enter a domain.');
      return;
    }
    try {
      // Convert domain to lowercase for consistency
      const domainKey = newDomain.toLowerCase();
      // Create or overwrite a doc with the domain name as the key
      await setDoc(doc(db, 'allowedDomains', domainKey), {
        active: true,
        planType: 'basic', // Default plan type
        // Add additional fields as needed
      });
      setNewDomain(''); // Clear the input
    } catch (error) {
      Alert.alert('Error adding domain', error.message);
    }
  };

  // Remove a domain from Firestore
  const handleRemoveDomain = async (domainId) => {
    try {
      await deleteDoc(doc(db, 'allowedDomains', domainId));
    } catch (error) {
      Alert.alert('Error removing domain', error.message);
    }
  };

  // Render the admin domain management UI
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Domain Management</Text>

      {/* Row for adding a new domain */}
      <View style={styles.card}>
        <Text style={styles.label}>Add New Domain</Text>
        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            placeholder="Enter domain (e.g. company.com)"
            value={newDomain}
            onChangeText={setNewDomain}
            placeholderTextColor={Colors.sub2}
          />
          <TouchableOpacity style={styles.button} onPress={handleAddDomain}>
            <Text style={styles.buttonText}>Add</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* List of current allowed domains */}
      <Text style={styles.subTitle}>Allowed Domains ({domains.length})</Text>
      <FlatList
        data={domains}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.domainRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.domainText}>{item.id}</Text>
              <Text style={styles.planText}>{item.planType}</Text>
            </View>
            <TouchableOpacity style={styles.removeButton} onPress={() => handleRemoveDomain(item.id)}>
              <Text style={styles.removeButtonText}>Remove</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}

// Styles for the domain management screen
const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: Colors.bg },
  title: { fontSize: sf(24), fontWeight: '900', textTransform: 'uppercase', marginBottom: 20, color: Colors.text },
  card: { backgroundColor: Colors.card, borderRadius: Radius.lg, padding: 16, marginBottom: 24, borderWidth: 2, borderColor: Colors.line, ...Shadows.card },
  label: { fontSize: sf(12), fontWeight: '900', textTransform: 'uppercase', color: Colors.text, marginBottom: 12 },
  addRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderColor: Colors.line,
    borderWidth: 2,
    padding: 12,
    borderRadius: Radius.md,
    backgroundColor: Colors.card,
    color: Colors.text,
    fontSize: sf(14),
  },
  button: { backgroundColor: Colors.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: Radius.md, alignItems: 'center' },
  buttonText: { color: Colors.card, fontWeight: '700', fontSize: sf(14), textTransform: 'uppercase' },
  subTitle: { fontSize: sf(14), fontWeight: '900', textTransform: 'uppercase', color: Colors.text, marginBottom: 12, marginTop: 8 },
  domainRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 8,
    alignItems: 'center',
    backgroundColor: Colors.card,
    padding: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  domainText: { fontSize: sf(15), fontWeight: '700', color: Colors.text },
  planText: { fontSize: sf(13), color: Colors.sub, marginTop: 4 },
  removeButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.dangerFg },
  removeButtonText: { color: Colors.dangerFg, fontWeight: '700', fontSize: sf(12) },
});
