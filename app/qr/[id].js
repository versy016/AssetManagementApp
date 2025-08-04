// QRActionScreen: Handles asset check-in/check-out by scanning a QR code
// Allows users to check assets in and out by updating their status in the backend

import React, { useEffect, useState } from 'react';
import { View, Text, Button, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getAuth } from 'firebase/auth';
import { API_BASE_URL } from '../../inventory-api/apiBase';

// Main component for handling QR actions
export default function QRActionScreen() {
  // Get the asset ID from the QR code in the URL params
  const { id } = useLocalSearchParams(); // ID from QR code
  const router = useRouter();

  // Local state for asset, user, loading, and updating status
  const [asset, setAsset] = useState(null); // Asset info from backend
  const [user, setUser] = useState(null);   // Current logged-in user
  const [loading, setLoading] = useState(true); // Loading flag for initial fetch
  const [updating, setUpdating] = useState(false); // Loading flag for check-in/out

  // Fetch asset and user info on mount
  useEffect(() => {
    // Async function to fetch asset and user info
    const fetchAssetAndUser = async () => {
      try {
        // Get current Firebase user
        const auth = getAuth();
        const currentUser = auth.currentUser;
        if (!currentUser) throw new Error('Not logged in');

        // Fetch asset details from backend using the scanned ID
        const assetRes = await fetch(`${API_BASE_URL}/assets/${id}`);
        if (!assetRes.ok) throw new Error('Asset not found');
        const assetData = await assetRes.json();

        // Save user and asset to local state
        setUser(currentUser);
        setAsset(assetData);
      } catch (e) {
        // If error, show alert and navigate back
        Alert.alert('Error', e.message);
        router.back();
      } finally {
        setLoading(false); // End loading state
      }
    };

    fetchAssetAndUser(); // Call fetch on mount
  }, []);

  // Handle checking in an asset (returning it to office)
  const handleCheckIn = async () => {
    // If asset or user not loaded, do nothing
    if (!asset || !user) return;

    setUpdating(true); // Start loading state for update

    try {
      const res = await fetch(`${API_BASE_URL}/assets/${asset.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigned_to_id: null,
          status: 'Available',
          checked_out: false,
        }),
      });

      // If the response is not OK, throw an error with the server's response text
      if (!res.ok) throw new Error(await res.text());

      // Show a success message to the user
      Alert.alert('Success', `${asset.model} has been checked in to the office successfully`);
      // Navigate back to the Inventory screen
      router.replace('/Inventory');
    } catch (err) {
      // Show an error alert if anything goes wrong
      Alert.alert('Error', err.message);
    } finally {
      // Always stop the loading/updating state
      setUpdating(false);
    }
  };

  // Handle checking out an asset to the current user
  const handleCheckOut = async () => {
    // If asset or user is missing, do nothing
    if (!asset || !user) return;

    setUpdating(true); // Start loading state
    try {
      // Make a PUT request to update the asset as checked out
      const res = await fetch(`${API_BASE_URL}/assets/${asset.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigned_to_id: user.uid, // Assign asset to current user
          status: 'In Use', // Set asset status to In Use
          checked_out: true, // Mark asset as checked out
        }),
      });

      // If the response is not OK, throw an error with the server's response text
      if (!res.ok) throw new Error(await res.text());

      // Show a success message to the user
      Alert.alert('Success', `${asset.model} has been checked out to ${user.displayName || 'you'} successfully`);
      // Navigate back to the Inventory screen
      router.replace('/Inventory');
    } catch (err) {
      // Show an error alert if anything goes wrong
      Alert.alert('Error', err.message);
    } finally {
      setUpdating(false);
    }
  };

  if (loading) return <ActivityIndicator style={{ flex: 1 }} size="large" />;

  const isAssignedToUser = asset.assigned_to_id === user.uid;
  const isUnassigned = !asset.assigned_to_id;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{asset.model}</Text>
      <Text style={styles.subtitle}>Status: {asset.status}</Text>
      <Text style={styles.subtitle}>Location: {asset.location}</Text>
      <Text style={styles.subtitle}>ID: {asset.id}</Text>

      {isAssignedToUser && (
        <Button title="Check In to Office" onPress={handleCheckIn} disabled={updating} />
      )}

      {isUnassigned && (
        <Button title="Check Out to Me" onPress={handleCheckOut} disabled={updating} />
      )}

      {!isAssignedToUser && !isUnassigned && (
        <Text style={{ marginTop: 20, color: 'gray' }}>
          This asset is currently assigned to another user.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 6,
  },
});
