import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Image, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { API_BASE_URL } from '../../inventory-api/apiBase';

export default function ScannedAssetsList() {
  const router = useRouter();
  const { items: itemsParam, checkedIn: checkedInParam } = useLocalSearchParams();
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [checkedInAssets, setCheckedInAssets] = useState([]);

  // Parse the scanned items and checked-in assets from the URL params
  useEffect(() => {
    const fetchAssets = async () => {
      if (itemsParam) {
        try {
          setLoading(true);
          const parsedItems = JSON.parse(decodeURIComponent(itemsParam));
          const parsedCheckedIn = checkedInParam ? JSON.parse(decodeURIComponent(checkedInParam)) : [];
          
          // Fetch details for each asset
          const assetsWithDetails = await Promise.all(
            parsedItems.map(async (id) => {
              try {
                const response = await fetch(`${API_BASE_URL}/assets/${id}`);
                if (!response.ok) throw new Error('Failed to fetch asset details');
                const data = await response.json();
                return {
                  id,
                  name: data.model || data.asset_types?.name || `Asset ${id}`,
                  status: 'pending'
                };
              } catch (error) {
                console.error(`Error fetching asset ${id}:`, error);
                return {
                  id,
                  name: `Asset ${id}`, // Fallback to ID if fetch fails
                  status: 'error'
                };
              }
            })
          );
          
          setAssets(assetsWithDetails);
          setCheckedInAssets(parsedCheckedIn);
        } catch (e) {
          console.error('Error parsing items:', e);
          Alert.alert('Error', 'Failed to load scanned items');
        } finally {
          setLoading(false);
        }
      }
    };

    fetchAssets();
  }, [itemsParam, checkedInParam]);

  const handleCheckIn = async (assetId) => {
    try {
      setLoading(true);
      // Create the return URL with all items and updated checked-in status
      const updatedCheckedIn = [...new Set([...checkedInAssets, assetId])];
      const returnUrl = `/multi-scan/list?items=${encodeURIComponent(JSON.stringify(assets.map(a => a.id)))}&checkedIn=${encodeURIComponent(JSON.stringify(updatedCheckedIn))}`;
      
      // Navigate to the check-in screen for this asset
      router.push({
        pathname: `/check-in/${assetId}`,
        params: { 
          returnTo: returnUrl
        }
      });
    } catch (error) {
      console.error('Error navigating to check-in:', error);
      Alert.alert('Error', 'Failed to navigate to check-in');
    } finally {
      setLoading(false);
    }
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity 
      style={styles.card}
      onPress={() => !loading && handleCheckIn(item.id)}
      disabled={loading}
    >
      <View style={styles.cardContent}>
        <Image
          source={{ uri: 'https://via.placeholder.com/50' }}
          style={styles.image}
        />
        <View style={styles.info}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.status}>
            Status: {checkedInAssets.includes(item.id) ? 'Processed' : 'Pending'}
          </Text>
        </View>
        {checkedInAssets.includes(item.id) ? (
          <MaterialIcons name="check-circle" size={24} color="green" />
        ) : (
          <MaterialIcons name="arrow-forward-ios" size={16} color="#666" />
        )}
      </View>
    </TouchableOpacity>
  );

  const allCheckedIn = assets.length > 0 && assets.every(asset => checkedInAssets.includes(asset.id));

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color="#1E90FF" />
        </TouchableOpacity>
        <Text style={styles.title}>Scanned Assets</Text>
      </View>
      
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1E90FF" />
        </View>
      ) : (
        <FlatList
          data={assets}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
        />
      )}

      {allCheckedIn && (
        <TouchableOpacity 
          style={styles.doneButton}
          onPress={() => router.replace('/(tabs)/dashboard')}
        >
          <Text style={styles.doneButtonText}>Back to Dashboard</Text>
        </TouchableOpacity>
      )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  backButton: {
    marginRight: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    paddingBottom: 20,
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  image: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 16,
    backgroundColor: '#f0f0f0',
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  status: {
    fontSize: 14,
    color: '#666',
  },
  doneButton: {
    backgroundColor: '#1E90FF',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  doneButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
});
