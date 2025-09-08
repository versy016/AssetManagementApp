// [type_id].js - Lists all assets of a specific asset type

// Import React and hooks for state and effect management
import React, { useEffect, useState } from 'react'; // React core and hooks
// Import UI components from React Native
import {
  View,               // Container for layout
  Text,               // Text display
  FlatList,           // Efficient list rendering
  Image,              // Asset image preview
  TouchableOpacity,   // Pressable UI element
  StyleSheet,
  Alert,
  Platform,// Style definitions
} from 'react-native';
// Import navigation helpers for routing and params
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons'; // Icon library for UI
import { SafeAreaView } from 'react-native-safe-area-context'; // Handles device safe areas
import { API_BASE_URL } from '../../inventory-api/apiBase';

// AssetsType displays all assets for a given type_id
// Main component for displaying all assets of a specific type
export default function AssetsType() {
  // Get type_id (for filtering) and type_name (for display) from route params
  const { type_id, type_name } = useLocalSearchParams();
  const router = useRouter(); // Navigation/router object
  const [assets, setAssets] = useState([]); // State: filtered assets list
 
 const doDeleteType = async () => {
  const ok = await new Promise((resolve) => {
    // Web: use confirm if available
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      return resolve(window.confirm('Delete this asset type? This cannot be undone.'));
    }
    // Native fallback
    Alert.alert(
      'Delete asset type',
      'This cannot be undone. Continue?',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true }
    );
  });

  if (!ok) return;

  try {
    const res = await fetch(`${API_BASE_URL}/asset-types/${type_id}`, { method: 'DELETE' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.message || body?.error || 'Failed to delete');

    // Only show native toast on native; on web the confirm was enough
    if (Platform.OS !== 'web') {
      Alert.alert('Deleted', 'Asset type removed.');
    }

    router.replace({ pathname: '/Inventory', params: { tab: 'types' } });
  } catch (e) {
    Alert.alert('Error', e.message || 'Failed to delete asset type');
  }
};


  const goEditType = () => {
    router.push({ pathname: '/type/edit', params: { id: type_id, name: type_name } });
  };
  // Fetch and filter assets by type_id whenever type_id changes
  useEffect(() => {
    if (!type_id) return; // Guard: do nothing if no type_id

    // Fetch all assets from backend API
    fetch(`${API_BASE_URL}/assets`)
      .then(res => res.json()) // Parse JSON response
      .then(data => {
        // Filter assets to those matching the current type_id
        const filtered = data.filter(asset => asset.type_id?.toString() === type_id);
        setAssets(filtered); // Store filtered assets in state
      })
      .catch(err => console.error('Failed to fetch filtered assets:', err)); // Log errors
  }, [type_id]);

  // Render the filtered asset list UI
  return (
    // SafeAreaView keeps UI clear of device notches and bars
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* Main vertical container for the screen */}
      <View style={styles.container}>
        {/* Header section with back button and asset type name */}
        <View style={styles.header}>
          {/* Back button navigates to Inventory tab for types */}
          <TouchableOpacity
            onPress={() =>
              router.push({
                pathname: '/Inventory',
                params: { tab: 'types' }, // or 'all' depending on where you're coming from
              })
            }
          >
            <MaterialIcons name="arrow-back" size={24} color="#1E90FF" />
          </TouchableOpacity>
          {/* Title showing the asset type */}
          <Text style={styles.title}>{type_name} Assets</Text>
        </View>

        {/* Show message if no assets found for this type */}
        {assets.length === 0 ? (
          <Text style={styles.noData}>No assets found for this type.</Text>
        ) : (
          // FlatList efficiently renders the list of filtered assets
          <FlatList
            data={assets}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 20 }}
            renderItem={({ item }) => (
              // Each asset is a touchable card that navigates to asset details
              <TouchableOpacity
                style={styles.card}
                onPress={() =>
                  router.push({ pathname: '/asset/[assetId]', params: { assetId: item.id } })
                }
              >
                {/* Asset image preview (fallback to placeholder if missing) */}
                <Image
                  source={{ uri: item.image_url?.trim() || 'https://via.placeholder.com/80' }}
                  style={styles.image}
                />
                {/* Asset details: model, serial, status */}
                <View style={styles.details}>
                  <Text style={styles.name}>{item.model}</Text>
                  <Text style={styles.subtext}>Serial: {item.serial_number}</Text>
                  <Text style={styles.subtext}>Status: {item.status}</Text>
                </View>
                {/* Chevron icon for navigation hint */}
                <MaterialIcons name="chevron-right" size={24} color="#1E90FF" />
              </TouchableOpacity>
            )}
          />
        )}
      </View>
      <View style={styles.headerActions}>
        <TouchableOpacity style={[styles.chip, {backgroundColor:'#e8f1ff'}]} onPress={goEditType}>
          <MaterialIcons name="edit" size={16} color="#1E90FF" />
          <Text style={styles.chipText}>Edit Type</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.chip, {backgroundColor:'#ffe8ea'}]} onPress={doDeleteType}>
          <MaterialIcons name="delete" size={16} color="#b00020" />
          <Text style={[styles.chipText, {color:'#b00020'}]}>Delete Type</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// Styles for the asset type filtered list screen
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' }, // Main container, white background
  header: {
    flexDirection: 'row',        // Row layout for header
    alignItems: 'center',        // Center items vertically
    padding: 16,                 // Padding around header
    borderBottomColor: '#ddd',   // Light gray border
    borderBottomWidth: 1,        // Border thickness
  },
  title: {
    fontSize: 18,                // Large font for title
    fontWeight: 'bold',          // Bold font
    marginLeft: 12,              // Space between icon and title
    color: '#1E90FF',            // Blue color for title
  },
  card: {
    flexDirection: 'row',        // Row layout for asset card
    backgroundColor: '#f9f9f9',  // Light gray card background
    borderRadius: 10,            // Rounded corners
    marginBottom: 15,            // Space between cards
    alignItems: 'center',        // Center contents vertically
    padding: 10,                 // Card padding
  },
  image: {
    width: 60,                   // Asset image width
    height: 60,                  // Asset image height
    borderRadius: 8,             // Rounded image corners
    marginRight: 12,             // Space between image and details
    backgroundColor: '#eee',     // Placeholder background
  },
  details: {
    flex: 1,                     // Take up remaining space
  },
  name: {
    fontWeight: 'bold',          // Bold for asset model
    fontSize: 16,                // Larger font
    marginBottom: 4,             // Space below model
    color: '#333',               // Dark text
  },
  subtext: {
    fontSize: 13,                // Smaller font for serial/status
    color: '#666',               // Muted text color
  },
  noData: {
    textAlign: 'center',         // Centered no-data message
    marginTop: 50,               // Space from top
    fontSize: 16,                // Font size for no-data
    color: '#777',               // Muted color
  },
  headerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    padding: 16,
    borderTopColor: '#ddd',
    borderTopWidth: 1,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
    padding: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  chipText: {
    marginLeft: 4,
    fontSize: 12,
    color: '#333',
  },
});
