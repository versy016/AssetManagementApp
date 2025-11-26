import React, { useEffect, useMemo, useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  ActivityIndicator,
  FlatList,
  TouchableOpacity,
  Alert,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { auth } from '../../firebaseConfig';
import ScreenHeader from '../../components/ui/ScreenHeader';
import AppTextInput from '../../components/ui/AppTextInput';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import { captureLastScannedLocation } from '../../utils/location';

export default function TransferAssetScreen() {
  const router = useRouter();
  const { assetId, returnTo } = useLocalSearchParams();
  const normalizedReturnTo = returnTo ? String(returnTo) : null;
  const [asset, setAsset] = useState(null);
  const [users, setUsers] = useState([]);
  const [loadingAsset, setLoadingAsset] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState('');

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        setLoadingAsset(true);
        const res = await fetch(`${API_BASE_URL}/assets/${assetId}`);
        if (!res.ok) throw new Error('Failed to load asset');
        const data = await res.json();
        if (!ignore) setAsset(data);
      } catch (e) {
        Alert.alert('Error', e?.message || 'Unable to load asset');
        if (normalizedReturnTo) {
          router.replace(normalizedReturnTo);
        } else {
          router.back();
        }
      } finally {
        if (!ignore) setLoadingAsset(false);
      }
    })();
    return () => { ignore = true; };
  }, [assetId, router, normalizedReturnTo]);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        setLoadingUsers(true);
        const res = await fetch(`${API_BASE_URL}/users`);
        if (!res.ok) throw new Error('Failed to load users');
        const data = await res.json();
        if (!ignore && Array.isArray(data)) setUsers(data);
      } catch (e) {
        if (!ignore) Alert.alert('Error', e?.message || 'Unable to load user list');
      } finally {
        if (!ignore) setLoadingUsers(false);
      }
    })();
    return () => { ignore = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const name = String(u?.name || '').toLowerCase();
      const email = String(u?.useremail || u?.email || '').toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [users, search]);

  const handleSelect = async (targetUser) => {
    if (!assetId || !targetUser?.id) return;
    if (asset?.assigned_to_id && String(asset.assigned_to_id) === String(targetUser.id)) {
      Alert.alert('Already Assigned', 'This asset is already assigned to that user.');
      return;
    }
    const current = auth?.currentUser;
    if (!current) {
      Alert.alert('Error', 'You must be logged in to transfer assets.');
      return;
    }
    try {
      setSubmitting(targetUser.id);
      const token = await current.getIdToken();
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      };
      const location = await captureLastScannedLocation();
      const payload = {
        assigned_to_id: targetUser.id,
      };
      if (location) {
        payload.location = location;
      }
      const res = await fetch(`${API_BASE_URL}/assets/${assetId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to transfer asset');

      await fetch(`${API_BASE_URL}/assets/${assetId}/actions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'TRANSFER',
          performed_by: current.uid,
          from_user_id: asset?.assigned_to_id || null,
          to_user_id: targetUser.id,
          note: `Quick transfer to ${targetUser.name || targetUser.useremail || targetUser.id}`,
        }),
      });

      const actions = [];
      if (normalizedReturnTo) {
        actions.push({
          text: 'Back',
          onPress: () => router.replace(normalizedReturnTo),
        });
      }
      actions.push({
        text: 'View asset',
        onPress: () => router.replace({ pathname: '/asset/[assetId]', params: { assetId } }),
      });
      Alert.alert('Success', 'Asset transferred successfully.', actions);
    } catch (e) {
      Alert.alert('Error', e?.message || 'Transfer failed');
    } finally {
      setSubmitting('');
    }
  };

  if (loadingAsset) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#1D4ED8" />
        <Text style={styles.loadingText}>Loading asset…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <ScreenHeader
        title="Transfer Asset"
        backLabel="Back"
        onBack={() => {
          if (normalizedReturnTo) {
            router.replace(normalizedReturnTo);
          } else if (router.canGoBack()) {
            router.back();
          } else {
            router.replace('/(tabs)/dashboard');
          }
        }}
      />
      <View style={styles.container}>
        <View style={styles.assetCard}>
          <Text style={styles.assetTitle}>{asset?.asset_types?.name || 'Asset'}</Text>
          <Text style={styles.assetSubtitle}>ID: {asset?.id}</Text>
          <Text style={styles.assetDetail}>
            Assigned to: {asset?.users?.name || asset?.users?.useremail || asset?.assigned_to_id || 'Unassigned'}
          </Text>
        </View>
        <View style={styles.searchBox}>
          <AppTextInput
            placeholder="Search user by name or email"
            value={search}
            onChangeText={setSearch}
          />
        </View>
        {loadingUsers ? (
          <View style={styles.center}>
            <ActivityIndicator size="small" color="#2563EB" />
            <Text style={styles.loadingText}>Loading users…</Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ paddingBottom: 40 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.userRow}
                onPress={() => handleSelect(item)}
                disabled={submitting === item.id}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.userName}>{item.name || 'Unnamed User'}</Text>
                  <Text style={styles.userEmail}>{item.useremail || item.email || 'No email'}</Text>
                </View>
                <Text style={[styles.transferBtn, submitting === item.id && { opacity: 0.6 }]}>
                  {submitting === item.id ? 'Transferring…' : 'Transfer'}
                </Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No matching users</Text>
              </View>
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 8, color: '#6B7280' },
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  assetCard: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    backgroundColor: '#F8FAFF',
  },
  assetTitle: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  assetSubtitle: { fontSize: 14, color: '#475569', marginTop: 4 },
  assetDetail: { fontSize: 13, color: '#475569', marginTop: 6 },
  searchBox: { marginBottom: 12 },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    gap: 12,
  },
  userName: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  userEmail: { fontSize: 13, color: '#475569' },
  transferBtn: {
    color: '#2563EB',
    fontWeight: '700',
  },
  emptyState: { alignItems: 'center', paddingVertical: 32 },
  emptyText: { color: '#94A3B8' },
});

