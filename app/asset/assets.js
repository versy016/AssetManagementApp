// app/(tabs)/assets.js — Screen showing assets assigned to the current user

import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { auth } from '../../firebaseConfig';
import { API_BASE_URL } from '../../inventory-api/apiBase';

export default function MyAssets() {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const navigation = useNavigation();

  useEffect(() => {
    const fetchAssets = async () => {
      const user = auth.currentUser;
      if (!user) {
        setAssets([]);
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(`${API_BASE_URL}/assets/assigned/${user.uid}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setAssets(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Failed to fetch user assets:', err);
        setAssets([]);
      } finally {
        setLoading(false);
      }
    };
    fetchAssets();
  }, []);

  const goBack = () => {
    if (navigation?.canGoBack?.()) {
      router.back();
    } else {
      // Fallback: go to Assets tab (Inventory/all) if there’s no history (e.g., deep link)
      router.replace({ pathname: '/Inventory', params: { tab: 'all' } });
    }
  };

  const openAsset = (id) => {
    // Navigate to the updated detail route
    router.push({ pathname: '/asset/[assetId]', params: { assetId: String(id) } });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack}>
            <MaterialIcons name="arrow-back" size={24} color="#1E90FF" />
          </TouchableOpacity>
          <Text style={styles.title}>My Assigned Assets</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Content */}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" />
            <Text style={{ marginTop: 8, color: '#666' }}>Loading…</Text>
          </View>
        ) : assets.length === 0 ? (
          <Text style={styles.noAssets}>No assets assigned.</Text>
        ) : (
          assets.map((asset) => (
            <TouchableOpacity key={asset.id} style={styles.card} onPress={() => openAsset(asset.id)}>
              <Image
                source={{ uri: asset.image_url || 'https://via.placeholder.com/50' }}
                style={styles.image}
              />
              <View style={styles.info}>
                <Text style={styles.name}>
                  {asset.asset_types?.name || asset.model || 'Unnamed'}
                </Text>
                <Text style={styles.serial}>Serial: {asset.serial_number || 'N/A'}</Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color="#bbb" />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f9f9f9' },
  container: { padding: 16, backgroundColor: '#f9f9f9' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingBottom: 10,
  },
  title: { fontSize: 18, fontWeight: 'bold', marginLeft: 12, color: '#1E90FF', flex: 1 },
  center: { alignItems: 'center', paddingVertical: 24 },
  noAssets: { textAlign: 'center', color: '#666', marginTop: 12 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 4,
  },
  image: { width: 50, height: 50, borderRadius: 5, marginRight: 10, backgroundColor: '#eee' },
  info: { flex: 1, justifyContent: 'center' },
  name: { fontWeight: 'bold', fontSize: 16, color: '#111' },
  serial: { fontSize: 14, color: '#555', marginTop: 2 },
});
