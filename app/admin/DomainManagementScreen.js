// DomainManagementScreen.js - Admin interface for managing allowed email domains

// Import React and hooks for state and effect management
import React, { useEffect, useState } from 'react';
// Import UI components from React Native
import { View, Text, TextInput, Button, FlatList, Alert, StyleSheet } from 'react-native';
// Import Firestore helpers for domain CRUD operations
import { collection, addDoc, doc, setDoc, deleteDoc, onSnapshot, getFirestore } from 'firebase/firestore';
// Import Firebase Auth config (not directly used here, but available for future use)
import { auth } from '../../firebaseConfig';

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
      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          placeholder="Enter domain (e.g. company.com)"
          value={newDomain}
          onChangeText={setNewDomain}
        />
        <Button title="Add Domain" onPress={handleAddDomain} />
      </View>

      {/* List of current allowed domains */}
      <FlatList
        data={domains}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.domainRow}>
            <Text style={styles.domainText}>{item.id}</Text>
            <Text style={styles.planText}>{item.planType}</Text>
            <Button title="Remove" onPress={() => handleRemoveDomain(item.id)} />
          </View>
        )}
      />
    </View>
  );
}

// Styles for the domain management screen
const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#f5f5f5' },
  title: { fontSize: 24, marginBottom: 20, textAlign: 'center' },
  addRow: {
    flexDirection: 'row',
    marginBottom: 20,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderColor: '#ccc',
    borderWidth: 1,
    marginRight: 10,
    padding: 10,
    borderRadius: 5,
    backgroundColor: '#fff',
  },
  domainRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 8,
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 5,
  },
  domainText: { fontSize: 16, fontWeight: 'bold' },
  planText: { fontSize: 14, color: '#666' },
});
