// assets.js - Screen showing assets assigned to the current user

// Import React and hooks for state and effect management
import React, { useEffect, useState } from 'react'; // React core and hooks
// Import UI components from React Native
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Image } from 'react-native'; // Core UI components
// Import Firebase Auth to get current user
import { auth } from '../../firebaseConfig'; // Firebase authentication instance
// Import router for navigation
import { useRouter } from 'expo-router'; // Navigation hook
// Import MaterialIcons for icons
import { MaterialIcons } from '@expo/vector-icons'; // Icon library for UI

// MyAssets displays all assets assigned to the logged-in user
// Main component that displays all assets assigned to the logged-in user
export default function MyAssets() {
  const [assets, setAssets] = useState([]); // State: list of user's assets
  const [loading, setLoading] = useState(true); // State: loading indicator
  const router = useRouter(); // Navigation/router object

  // Fetch assets assigned to the current user on mount
  useEffect(() => {
    const fetchAssets = async () => {
      const user = auth.currentUser; // Get current logged-in user
      if (!user) return; // Guard: do nothing if not logged in

      try {
        // Fetch assets assigned to the user from backend API
        const res = await fetch(`http://ec2-3-25-81-127.ap-southeast-2.compute.amazonaws.com:3000/assets/assigned/${user.uid}`);
        const data = await res.json(); // Parse JSON response
        setAssets(data); // Store assets in state
      } catch (err) {
        // Handle network or parsing errors
        console.error('Failed to fetch user assets:', err);
        setAssets([]); // Set empty if error
      } finally {
        setLoading(false); // Hide loading indicator
      }
    };

    fetchAssets(); // Call fetch on mount
  }, []);

  // Render the assigned assets UI
  return (
    // ScrollView allows scrolling if asset list is long
    <ScrollView contentContainerStyle={styles.container}>
      {/* Header with back button and screen title */}
      <View style={styles.header}>
        {/* Back button to return to previous screen */}
        <TouchableOpacity onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={24} color="#1E90FF" />
        </TouchableOpacity>
        {/* Title for the screen */}
        <Text style={styles.title}>My Assigned Assets</Text>
      </View>

      {/* Show loading spinner, no-assets message, or asset cards */}
      {loading ? (
        <Text>Loading...</Text>
      ) : assets.length === 0 ? (
        <Text style={styles.noAssets}>No assets assigned.</Text>
      ) : (
        // Map through assets and render a card for each
        assets.map((asset) => (
          <TouchableOpacity
            key={asset.id}
            style={styles.card}
            onPress={() => router.push(`/asset/${asset.id}`)} // Navigate to asset details
          >
            {/* Asset image (fallback to placeholder if missing) */}
            <Image
              source={{ uri: asset.image_url || 'https://via.placeholder.com/50' }}
              style={styles.image}
            />
            {/* Asset info: name/type and serial number */}
            <View style={styles.info}>
              <Text style={styles.name}>{asset.asset_types?.name || asset.model || 'Unnamed'}</Text>
              <Text style={styles.serial}>Serial: {asset.serial_number || 'N/A'}</Text>
            </View>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

// Styles for the MyAssets screen
const styles = StyleSheet.create({
  container: {
    padding: 20,      // Outer padding for content
    paddingTop: 10,   // Extra space at the top
  },
  header: {
    flexDirection: 'row', // Row layout for back button and title
    alignItems: 'center', // Vertically center header items
    marginBottom: 15,     // Space below header
  },
  title: {
    fontSize: 18,         // Large font for title
    fontWeight: 'bold',   // Bold font
    marginLeft: 12,       // Space between icon and title
    color: '#1E90FF',     // Blue color for title
  },
  noAssets: {
    textAlign: 'center',  // Centered text for no-assets message
    color: '#666',        // Muted gray color
  },
  card: {
    flexDirection: 'row', // Row layout for asset card
    backgroundColor: '#fff', // White card background
    padding: 15,          // Card padding
    borderRadius: 10,     // Rounded corners
    marginBottom: 10,     // Space between cards
    elevation: 2,         // Shadow for Android
  },
  image: {
    width: 50,            // Asset image width
    height: 50,           // Asset image height
    borderRadius: 5,      // Slightly rounded image
    marginRight: 10,      // Space between image and info
  },
  info: {
    justifyContent: 'center', // Center info vertically
  },
  name: {
    fontWeight: 'bold',   // Bold asset name/type
    fontSize: 16,         // Larger font
  },
  serial: {
    fontSize: 14,         // Serial number font size
    color: '#555',        // Muted serial color
  },
});
