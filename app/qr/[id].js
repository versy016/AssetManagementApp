// QRActionScreen: Handles asset check-in/check-out by scanning a QR code
// Allows users to check assets in and out by updating their status in the backend

import React, { useEffect, useState } from 'react';
import { View, Text, Button, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getAuth } from 'firebase/auth';
import { API_BASE_URL } from '../../inventory-api/apiBase';
// Avoid static import to prevent SSR/import loops on web; require dynamically when needed.

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
  const getCurrentAddress = async () => {
    try {
      let ExpoLocation;
      try { ExpoLocation = require('expo-location'); } catch { return null; }
      const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (status !== 'granted') return null;
      const pos = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy?.Balanced || 3 });
      if (!pos?.coords) return null;
      const { latitude, longitude } = pos.coords;
      // Prefer server Google Geocoding endpoint for address
      try {
        const resp = await fetch(`${API_BASE_URL}/places/reverse-geocode?lat=${latitude}&lng=${longitude}`);
        if (resp.ok) {
          const j = await resp.json();
          if (j?.formatted_address) return j.formatted_address;
        }
      } catch {}
      try {
        const geos = await ExpoLocation.reverseGeocodeAsync({ latitude, longitude });
        const first = Array.isArray(geos) ? geos[0] : null;
        if (first) {
          const parts = [first.name, first.street, first.city, first.region, first.country].filter(Boolean);
          const addr = parts.join(', ');
          if (addr) return addr;
        }
      } catch {}
      return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    } catch { return null; }
  };

  const handleCheckIn = async () => {
    // If asset or user not loaded, do nothing
    if (!asset || !user) return;

    setUpdating(true); // Start loading state for update

    try {
      const loc = await getCurrentAddress();
      const res = await fetch(`${API_BASE_URL}/assets/${asset.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigned_to_id: null,
          status: 'Available',
          ...(loc ? { location: loc } : {}),
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
      const loc = await getCurrentAddress();
      const res = await fetch(`${API_BASE_URL}/assets/${asset.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigned_to_id: user.uid, // Assign asset to current user
          status: 'In Use', // Set asset status to In Use
          ...(loc ? { location: loc } : {}),
        }),
      });

      // If the response is not OK, throw an error with the server's response text
      if (!res.ok) throw new Error(await res.text());

      // Show success message
      Alert.alert('Success', `${asset.model} has been checked out to you`, [
        {
          text: 'OK',
          onPress: () => {
            // If there's a returnTo parameter, navigate there
            if (router.params?.returnTo) {
              router.replace(router.params.returnTo);
            } else {
              // Otherwise, go back to the inventory
              router.replace('/Inventory');
            }
          }
        }
      ]);
    } catch (err) {
      // Show an error alert if anything goes wrong
      Alert.alert('Error', err.message);
    } finally {
      // Always stop the loading/updating state
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
        <Button title="Transfer In" onPress={handleCheckIn} disabled={updating} />
      )}

      {isUnassigned && (
        <Button title="Transfer Out" onPress={handleCheckOut} disabled={updating} />
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
