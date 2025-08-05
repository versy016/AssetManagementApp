// Inventory.js - Asset inventory screen with tab navigation for asset types and all assets

// Import React and hooks for state and effect management
import React, { useState, useEffect } from 'react';
// Import UI components from React Native
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  ScrollView,
  Dimensions,
} from 'react-native';
// Import MaterialIcons for icons
import { MaterialIcons } from '@expo/vector-icons';
// Import tab view components for tabbed navigation
import { TabView, SceneMap, TabBar } from 'react-native-tab-view';
// Import navigation hooks from Expo Router
import { useRouter, useLocalSearchParams } from 'expo-router'; 

// Set up the initial layout for the tab view
const initialLayout = { width: Dimensions.get('window').width };

// Tab for displaying asset types and their stats
const AssetTypesTab = () => {
  const router = useRouter();
  const [assetTypes, setAssetTypes] = useState([]); // Asset types state

  // Fetch asset types from backend on component mount
  useEffect(() => {
    const fetchAssetTypes = async () => {
      try {
        const res = await fetch('http://ec2-3-25-81-127.ap-southeast-2.compute.amazonaws.com:3000/assets/asset-types-summary');
        const data = await res.json();
        console.log('Asset types response:', data);
        setAssetTypes(data || []);
      } catch (err) {
        console.error('Error fetching asset types:', err);
      }
    };
    fetchAssetTypes();
  }, []);

  // Handle navigation to asset type details
  const handleAssetPress = (type) => {
    router.push({
      pathname: '/asset/type/' + type.id,
      params: { type_name: type.name },
    });
    console.log('/asset/type/' + type.id);
  };

  // Render asset type cards
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 20 }}>
      {Array.isArray(assetTypes) && assetTypes.map((type, index) => (
        <TouchableOpacity
          key={index}
          style={styles.typeItem}
          onPress={() => handleAssetPress(type)}
        >
          <View style={styles.typeLeft}>
            <Image
              source={{ uri: (type.image_url || 'https://via.placeholder.com/50').trim() }}
              style={styles.typeImage}
            />
            <View style={styles.typeDetails}>
              <Text style={styles.typeName}>{type.name}</Text>
              <View style={styles.typeStatsRow}>
                <Text style={styles.statText}>Available: {type.available}</Text>
                <Text style={styles.statText}>In Use: {type.inUse}</Text>
                <Text style={styles.statText}>Rented: {type.rented}</Text>
              </View>
            </View>
          </View>
          <MaterialIcons name="chevron-right" size={24} color="#1E90FF" />
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
};

// Tab for displaying all assets (excluding QR reserved assets)
const AllAssetsTab = () => {
  const router = useRouter();
  const [assets, setAssets] = useState([]); // All assets state

  // Fetch all assets from backend on component mount
  useEffect(() => {
    const fetchAssets = async () => {
      try {
        const res = await fetch('http://ec2-3-25-81-127.ap-southeast-2.compute.amazonaws.com:3000/assets');
        const data = await res.json();
        // Exclude assets marked as QR reserved
        const filtered = data.filter(asset => asset.description?.toLowerCase() !== 'qr reserved asset');
        setAssets(filtered);
      } catch (err) {
        console.error('Failed to fetch assets:', err);
        setAssets([]);
      }
    };
    fetchAssets();
  }, []);

  // Render asset cards
  return (
    <ScrollView contentContainerStyle={{ padding: 20 }}>
      {assets.map((asset, index) => (
        <TouchableOpacity
          key={index}
          style={styles.typeItem}
          onPress={() => router.push({
            pathname: '/asset/[assetId]',
            params: { assetId: asset.id },
          })}
        >
          <View style={styles.typeInfo}>
            <Image
              source={{ uri: asset.image_url || 'https://via.placeholder.com/50' }}
              style={styles.typeImage}
            />
            <View style={styles.typeDetails}>
              <Text style={styles.typeName}>
                {asset.asset_types?.name || asset.name || asset.model || 'Unnamed'}
              </Text>
              <Text style={styles.statText}>Serial: {asset.serial_number || 'N/A'}</Text>
            </View>
          </View>
          <MaterialIcons name="chevron-right" size={24} color="#1E90FF" />
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
};

// Main Inventory component with tab navigation
const Inventory = () => {
  const router = useRouter();
  const { tab } = useLocalSearchParams(); // Get the current tab from URL params
  const [index, setIndex] = useState(tab === 'all' ? 1 : 0); // Tab index state
  const [routes] = useState([
    { key: 'types', title: 'Asset Types' },
    { key: 'all', title: 'All Assets' },
  ]); // Tab routes

  // Map tab keys to components
  const renderScene = SceneMap({
    types: AssetTypesTab,
    all: AllAssetsTab,
  });

  // Render the tab view and floating action button
  return (
    <View style={{ flex: 1 }}>
      {/* Header with search and quick action icons */}
      <View style={styles.header}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search Inventory"
          placeholderTextColor="#888"
        />
        <TouchableOpacity style={styles.iconButton}>
          <MaterialIcons name="filter-list" size={24} color="#1E90FF" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconButton}>
          <MaterialIcons name="qr-code-scanner" size={24} color="#1E90FF" />
        </TouchableOpacity>
      </View>
      {/* Tab view for switching between asset types and all assets */}
      <TabView
        navigationState={{ index, routes }}
        renderScene={renderScene}
        onIndexChange={setIndex}
        initialLayout={initialLayout}
        renderTabBar={props => (
          <TabBar
            {...props}
            indicatorStyle={{ backgroundColor: '#1E90FF' }}
            style={{ backgroundColor: '#fff' }}
            activeColor="#000"
            inactiveColor="#555"
            labelStyle={{ fontWeight: 'bold' }}
            renderLabel={({ route, focused }) => (
              <Text
                style={{
                  color: focused ? '#000' : '#555',
                  fontWeight: focused ? 'bold' : 'normal',
                  fontSize: 14,
                }}
              >
                {route.title}
              </Text>
            )}
          />
        )}
      />
      {/* Floating action button to add new asset or asset type */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() =>
          index === 0
            ? router.push('/asset/type/new')   // Add new asset type
            : router.push('/asset/new')        // Add new asset
        }
      >
        <MaterialIcons name="add" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
};

// Styles for the inventory screen
const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    padding: 10,
    backgroundColor: '#fff',
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 10,
    borderRadius: 5,
    marginRight: 10,
    borderColor: '#ddd',
    borderWidth: 1,
  },
  iconButton: {
    padding: 10,
  },
  typeItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    elevation: 2,
  },
  typeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  typeImage: {
    width: 50,
    height: 50,
    borderRadius: 5,
    marginRight: 10,
  },
  typeDetails: {
    flexDirection: 'column',
  },
  typeName: {
    fontWeight: 'bold',
    fontSize: 16,
    color: '#333',
  },
  typeStats: {
    alignItems: 'flex-end',
  },
  statText: {
    fontSize: 14,
    color: '#555',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 30,
    backgroundColor: '#1E90FF',
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
  },
  typeLeft: {
  flexDirection: 'row',
  alignItems: 'center',
  flex: 1,
  },

  typeStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },

});

export default Inventory;
