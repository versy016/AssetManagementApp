import { sf } from '../../constants/uiTheme.js';
// app/(tabs)/assets.js — Screen showing assets assigned to the current user

import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenHeader from '../../components/ui/ScreenHeader';
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
    router.push({
      pathname: '/asset/[assetId]',
      params: { assetId: String(id), returnTo: '/asset/assets' },
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScreenHeader
        title="My Assets"
        backLabel="Dashboard"
        onBack={goBack}
      />
      <ScrollView contentContainerStyle={styles.container}>
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

const Colors = {
  primary: '#1E293B',
  primaryDark: '#0F172A',
  primaryLight: '#E2E8F0',
  accent: '#EA580C',
  accentDark: '#C2410C',
  accentLight: '#FFF7ED',
  accentMuted: '#FFEDD5',
  text: '#1C1917',
  sub: '#57534E',
  sub2: '#A8A29E',
  line: '#D6D3D1',
  bg: '#F5F3F0',
  card: '#FFFFFF',
  chip: '#EDEAE6',
  dangerFg: '#DC2626',
  dangerBg: '#FEF2F2',
  successFg: '#0D9488',
  successBg: '#F0FDFA',
};

const Radius = { sm: 6, md: 10, lg: 14 };
const CardShadow = { shadowColor: '#1C1917', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 };

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.bg },
  container: { padding: 16, backgroundColor: Colors.bg },
  center: { alignItems: 'center', paddingVertical: 24 },
  noAssets: { textAlign: 'center', color: Colors.sub, marginTop: 12, fontWeight: '600' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    padding: 14,
    borderRadius: Radius.lg,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: Colors.line,
    ...CardShadow,
  },
  image: { width: 50, height: 50, borderRadius: Radius.sm, marginRight: 10, backgroundColor: Colors.chip },
  info: { flex: 1, justifyContent: 'center' },
  name: { fontWeight: '900', fontSize: sf(16), color: Colors.text },
  serial: { fontSize: sf(14), color: Colors.sub, marginTop: 2, fontWeight: '600' },
});
