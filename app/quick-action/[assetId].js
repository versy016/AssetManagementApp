import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import ScreenHeader from '../../components/ui/ScreenHeader';
import ActionsForm from '../../components/ActionsForm';
import { API_BASE_URL } from '../../inventory-api/apiBase';

const Colors = {
  bg: '#FFFFFF',
  border: '#E2E8F0',
  text: '#0F172A',
  subtle: '#64748B',
  primary: '#0B63CE',
};

const ACTION_LABELS = {
  repair: 'Repair',
  maintenance: 'Maintenance',
  service: 'Maintenance',
};

export default function QuickActionScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();

  const assetId = params?.assetId ? String(params.assetId) : null;
  const actionParam = params?.action ? String(params.action).toLowerCase() : 'maintenance';
  const returnTo = params?.returnTo ? String(params.returnTo) : null;

  const actionName = ACTION_LABELS[actionParam] || 'Maintenance';
  const headerTitle = actionName === 'Repair' ? 'Quick Repair' : 'Log Service';

  const [asset, setAsset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [formVisible, setFormVisible] = useState(false);

  const backToTarget = useCallback(() => {
    if (returnTo) {
      router.replace(returnTo);
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/dashboard');
    }
  }, [returnTo, router]);

  const handleClose = useCallback(() => {
    setFormVisible(false);
    backToTarget();
  }, [backToTarget]);

  useEffect(() => {
    let ignore = false;
    if (!assetId) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE_URL}/assets/${assetId}`);
        if (!res.ok) throw new Error('Unable to load asset');
        const data = await res.json();
        if (!ignore) {
          setAsset(data);
          setFormVisible(true);
        }
      } catch (error) {
        if (!ignore) {
          Alert.alert('Error', error?.message || 'Failed to load asset', [
            { text: 'OK', onPress: () => backToTarget() },
          ]);
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [assetId, backToTarget]);

  const handleSubmitted = useCallback(() => {
    setFormVisible(false);
    Alert.alert(
      'Saved',
      actionName === 'Repair' ? 'Repair logged successfully.' : 'Service logged successfully.',
      [
        {
          text: 'Done',
          onPress: () => backToTarget(),
        },
        {
          text: 'View asset',
          onPress: () => router.replace({ pathname: '/asset/[assetId]', params: { assetId } }),
        },
      ]
    );
  }, [actionName, assetId, backToTarget, router]);

  const assetSummary = useMemo(() => {
    if (!asset) return null;
    return {
      title: asset?.asset_types?.name || asset?.name || 'Asset',
      model: asset?.model || asset?.description || 'No description',
      status: asset?.status || 'Unknown status',
    };
  }, [asset]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title={headerTitle} backLabel="Back" onBack={handleClose} />
      <View style={styles.content}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>Loading asset…</Text>
          </View>
        ) : !asset ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>Asset not found.</Text>
          </View>
        ) : (
          <View style={styles.assetCard}>
            <Text style={styles.assetTitle}>{assetSummary?.title}</Text>
            <Text style={styles.assetMeta}>Asset ID: {asset?.id}</Text>
            <Text style={styles.assetMeta}>Model: {assetSummary?.model}</Text>
            <Text style={styles.assetMeta}>Status: {assetSummary?.status}</Text>
            <Text style={[styles.assetMeta, { marginTop: 12 }]}>
              Fill out the form to record a {actionName.toLowerCase()}.
            </Text>
          </View>
        )}
      </View>

      {asset && (
        <ActionsForm
          visible={formVisible}
          onClose={handleClose}
          asset={asset}
          action={actionName}
          apiBaseUrl={API_BASE_URL}
          users={[]}
          onSubmitted={handleSubmitted}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: Colors.subtle,
  },
  errorText: {
    color: Colors.subtle,
  },
  assetCard: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 16,
    backgroundColor: '#F8FAFF',
    gap: 4,
  },
  assetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.text,
  },
  assetMeta: {
    fontSize: 14,
    color: Colors.subtle,
  },
});

