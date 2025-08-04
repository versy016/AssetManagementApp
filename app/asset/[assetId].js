// [assetId].js - Asset detail page for viewing a single asset

// Import hooks and components for navigation, state, and UI
import { useLocalSearchParams } from 'expo-router'; // For route parameters
import { useEffect, useState } from 'react'; // React state/effect
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity } from 'react-native'; // Core UI
import { MaterialIcons } from '@expo/vector-icons'; // Icon library
import { useRouter } from 'expo-router'; // Navigation
import { SafeAreaView } from 'react-native-safe-area-context'; // Handles device safe areas

// AssetDetailPage displays detailed info for a specific asset
// Main component for displaying details of a single asset
export default function AssetDetailPage() {
  const { assetId } = useLocalSearchParams(); // Get assetId from route params
  const [asset, setAsset] = useState(null);   // State: asset details
  const router = useRouter();                 // Navigation/router object

  // Fetch asset details from backend when assetId changes
  useEffect(() => {
    if (!assetId) return;
    fetch(`http://ec2-13-239-139-73.ap-southeast-2.compute.amazonaws.com:3000/assets/${assetId}`)
      .then(res => res.json())
      .then(setAsset)
      .catch(console.error);
  }, [assetId]);

  // Show loading state until asset is fetched
  if (!asset) return <Text>Loading...</Text>;

  // Render the asset detail UI
  return (
    // SafeAreaView keeps UI clear of device notches and bars
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* ScrollView allows content to be scrollable if needed */}
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        {/* Header with back button and title */}
        <View style={styles.header}>
          {/* Back button: go back if possible, else go to Inventory */}
          <TouchableOpacity
            onPress={() => {
              if (router.canGoBack()) {
                router.back(); // Go back to the previous screen
              } else {
                router.push({
                  pathname: '/Inventory',
                  params: { tab: 'all' }
                }); // Fallback route
              }
            }}
          >
            <MaterialIcons name="arrow-back" size={24} color="#1E90FF" />
          </TouchableOpacity>
          {/* Title for the asset detail screen */}
          <Text style={styles.title}>Asset Details</Text>
        </View>

        {/* Asset detail card with all information */}
        <View style={styles.detailCard}>
          {/* Asset name/type and serial number */}
          <Text style={styles.assetName}>
            {asset.asset_types?.name || 'Asset'} - SN: {asset.serial_number}
          </Text>
          {/* Asset image, fallback to placeholder if missing */}
          <Image
            source={{ uri: asset.image_url || 'https://via.placeholder.com/150' }}
            style={styles.image}
          />
          {/* Asset details as rows */}
          <View style={styles.detailRow}><Text style={styles.label}>Status:</Text><Text style={styles.value}>{asset.status}</Text></View>
          <View style={styles.detailRow}><Text style={styles.label}>Assigned To:</Text><Text style={styles.value}>{asset.users?.name || 'N/A'}</Text></View>
          <View style={styles.detailRow}><Text style={styles.label}>Location:</Text><Text style={styles.value}>{asset.location || 'N/A'}</Text></View>
          <View style={styles.detailRow}><Text style={styles.label}>Model:</Text><Text style={styles.value}>{asset.model || 'N/A'}</Text></View>
          <View style={styles.detailRow}><Text style={styles.label}>Next Service:</Text><Text style={styles.value}>{asset.next_service_date?.split('T')[0] || 'N/A'}</Text></View>
          <View style={styles.detailRow}><Text style={styles.label}>Description:</Text><Text style={styles.value}>{asset.description || 'No description'}</Text></View>
          {/* Show document link if documentation_url exists */}
          {asset.documentation_url && (
            <TouchableOpacity
              onPress={() => {
                // Open the document in the browser
                import('react-native').then(({ Linking }) => {
                  Linking.openURL(asset.documentation_url);
                });
              }}
              style={styles.documentButton}
            >
              <Text style={styles.documentText}>📄 View Attached Document</Text>
            </TouchableOpacity>
          )}
          {/* Button to copy asset (pre-fill new asset form) */}
          <TouchableOpacity
            style={{
              marginTop: 20,
              padding: 12,
              backgroundColor: '#1E90FF',
              borderRadius: 8,
              alignItems: 'center',
            }}
            onPress={() => {
              router.push({
                pathname: '/asset/new',
                params: { fromAssetId: asset.id }, // Pass asset ID to NewAsset page
              });
            }}
          >
            <Text style={{ color: 'white', fontWeight: 'bold' }}>📋 Copy Asset</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Styles for the asset detail screen
const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f5f5f5', // Light background for the whole screen
  },
  header: {
    flexDirection: 'row',         // Row layout for header
    alignItems: 'center',         // Center items vertically
    backgroundColor: '#fff',      // White background for header
    borderBottomColor: '#ddd',    // Light gray border
    borderBottomWidth: 1,         // Border thickness
  },
  title: {
    fontSize: 20,                 // Large font for title
    fontWeight: 'bold',           // Bold font
    marginLeft: 12,               // Space between icon and title
    color: '#1E90FF',             // Blue color for title
  },
  detailCard: {
    backgroundColor: '#fff',      // White card background
    padding: 20,                  // Card padding
    margin: 16,                   // Margin around card
    borderRadius: 10,             // Rounded corners
    elevation: 2,                 // Shadow for Android
  },
  image: {
    height: 200,                  // Asset image height
    borderRadius: 10,             // Rounded image corners
    marginBottom: 20,             // Space below image
    resizeMode: 'contain',        // Contain image aspect
    backgroundColor: '#eee',      // Placeholder background
  },
  assetName: {
    fontSize: 18,                 // Font size for asset name
    fontWeight: 'bold',           // Bold font
    marginBottom: 15,             // Space below name
    color: '#333',                // Dark text
  },
  detailRow: {
    flexDirection: 'row',         // Row layout for detail rows
    justifyContent: 'space-between', // Space between label and value
    marginVertical: 8,            // Vertical spacing between rows
  },
  label: {
    fontWeight: '600',            // Semi-bold for labels
    color: '#555',                // Muted label color
    width: '45%',                 // Label width
  },
  value: {
    color: '#000',                // Value text color
    width: '55%',                 // Value width
    textAlign: 'right',
  },
  documentButton: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#f0f8ff',
    borderRadius: 8,
    alignItems: 'center',
  },
  documentText: {
    color: '#1E90FF',
    fontWeight: 'bold',
  },
});
