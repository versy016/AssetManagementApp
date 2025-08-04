// [id].js - Asset check-in/transfer screen

// Import navigation and parameter hooks from Expo Router
import { useLocalSearchParams } from 'expo-router'; // For route parameters
// Import React and state/effect hooks
import React, { useEffect, useState } from 'react';
// Import core React Native UI components
import {
  View, Text, ActivityIndicator, Button, StyleSheet
} from 'react-native';
// Import Firebase Auth for user authentication
import { getAuth } from 'firebase/auth';

import { useRouter } from 'expo-router';
const router = useRouter();

import { API_BASE_URL } from '../../inventory-api/apiBase';

// Main component for asset check-in and transfer actions
export default function CheckInScreen() {
  const { id } = useLocalSearchParams(); // Get asset ID from route params

  // State for loading spinner
  const [loading, setLoading] = useState(true);
  // State for current user info
  const [user, setUser] = useState(null);
  // State for asset details
  const [asset, setAsset] = useState(null);
  // State for error messages
  const [error, setError] = useState(null);

  // Fetch user and asset data when component mounts
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Get Firebase Auth and current user
        const auth = getAuth();
        const currentUser = auth.currentUser;
        console.log("👤 Current user:", currentUser);

        if (currentUser) {
          setUser(currentUser); // Set user state if logged in
        } else {
          // For development: allow preview if not logged in
          console.warn("⚠️ Not logged in - allowing preview for dev");
          setUser({ uid: "guest" });
        }

        // Fetch asset details from backend
        const res = await fetch(`${API_BASE_URL}/assets/${id}`);
        if (!res.ok) throw new Error('Asset not found');
        const data = await res.json();

        console.log("📦 Asset data:", data);
        setAsset(data); // Store asset info
      } catch (err) {
        // Handle fetch or network errors
        console.error("❌ Error in Check-In screen:", err);
        setError(err.message);
      } finally {
        setLoading(false); // Hide loading spinner
      }
    };

    fetchData(); // Run on mount
  }, []);

  // Handle check-in or transfer button actions
  const handleAction = async (type) => {
    if (!asset || !user) return; // Guard: must have asset and user

    let assignedToId = null; // Will hold the user ID to assign asset to

    if (type === 'checkin') {
      // For check-in, assign asset to admin user
      // Fetch all users and find the admin
      const response = await fetch(`${API_BASE_URL}/users`);
      const users = await response.json();
      console.log(users);

      const adminUser = users.find(u => u.useremail === 'admin@engsurveys.com.au');
      if (!adminUser) {
        alert('Admin user not found');
        return;
      }
      assignedToId = adminUser.id;
    } else if (type === 'transfer') {
      // For transfer, assign asset to current user
      assignedToId = user?.uid;
    }

    // Prepare payload for asset update
    const payload = {
      status: type === 'checkin' ? 'Available' : 'In Use', // Set status
      assigned_to_id: assignedToId,                        // Assign to user/admin
      checked_out: type === 'checkin' ? false : true,      // Checked out flag
    };

    try {
      // Send PUT request to update asset
      const res = await fetch(`${API_BASE_URL}/assets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(await res.text());

      // Show confirmation alert
      alert(
        type === 'checkin'
          ? 'Asset checked in to Office Admin.'
          : `Asset transferred to ${user.displayName || 'you'}`
      );
      router.replace('/dashboard');
    } catch (err) {
      alert(err.message);
    }
  };


  // Show loading spinner while fetching data
  if (loading) return <ActivityIndicator style={{ flex: 1 }} size="large" />;

  // Show error message if fetch failed
  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>⚠️ Error</Text>
        <Text style={{ color: 'red' }}>{error}</Text>
      </View>
    );
  }

  // Show fallback if asset or user is missing
  if (!asset || !user) {
    return (
      <View style={styles.container}>
        <Text style={{ color: 'red' }}>Missing asset or user data.</Text>
      </View>
    );
  }

  // Main UI for check-in/transfer actions
  return (
    <View style={styles.container}>
      {/* Screen title */}
      <Text style={styles.title}>Check-In / Transfer</Text>
      {/* Asset info */}
      <Text style={styles.subtext}>Asset ID: {asset.id}</Text>
      <Text style={styles.subtext}>Model: {asset.model || '—'}</Text>
      <Text style={styles.subtext}>Assigned To: {asset.assigned_to_id || 'None'}</Text>

      {/* Action buttons */}
      <View style={{ marginTop: 30 }}>
        <Text style={styles.optionTitle}>Choose an action:</Text>
        {/* Button to check in asset to admin */}
        <Button
          title="Check In to Office"
          onPress={() => handleAction('checkin')}
          color={'green'}
        />
        <View style={{ height: 10 }} />
        {/* Button to transfer asset to self or another user */}
        <Button
          title={asset.assigned_to_id === user?.uid ? 'Transfer Asset' : 'Transfer to Me'}
          onPress={() => handleAction('transfer')}
          color={'blue'}
        />
        <Button
          title="Go Back to Dashboard"
          onPress={() => router.replace('/dashboard')}
          color={'gray'}
        />
      </View>
    </View>
  );
}


// Styles for the check-in/transfer screen
const styles = StyleSheet.create({
  container: {
    flex: 1,                   // Take full height
    padding: 20,               // Padding around content
    justifyContent: 'center',  // Center content vertically
  },
  title: {
    fontSize: 22,              // Large font for title
    fontWeight: 'bold',        // Bold font
    marginBottom: 10,          // Space below title
  },
  subtext: {
    fontSize: 16,              // Subtext font size
    marginVertical: 3,         // Vertical margin for subtext
  },
  optionTitle: {
    fontSize: 18,              // Font size for action title
    marginBottom: 8,           // Space below action title
    fontWeight: '600',         // Semi-bold
  },
});
