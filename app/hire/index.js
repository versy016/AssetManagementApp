// app/hire/index.js
// Web: redirect to dashboard hire tab (web has full hire dashboard there)
// Native: full-screen Equipment Hire Lease Disclaimer form, optionally pre-populated
//         from a scanned asset passed as ?assetId=<id>
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  Platform,
  ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '../../components/ui/ScreenHeader';
import HireDisclaimerForm from '../../components/HireDisclaimerForm';
import { Colors, Radius, Shadows, sf } from '../../constants/uiTheme';
import { API_BASE_URL } from '../../inventory-api/apiBase';

export default function HireRoute() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const assetId = params?.assetId ? String(params.assetId) : null;

  const [asset, setAsset] = useState(null);
  const [loading, setLoading] = useState(!!assetId);

  // Web: redirect to hire tab in the dashboard
  useEffect(() => {
    if (Platform.OS === 'web') {
      router.replace('/(tabs)/dashboard?view=hire');
    }
  }, [router]);

  // Fetch the scanned asset to pre-populate the hire form
  useEffect(() => {
    if (!assetId || Platform.OS === 'web') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/assets/${encodeURIComponent(assetId)}`);
        if (!res.ok) throw new Error('Failed to load asset');
        const data = await res.json();
        if (!cancelled) setAsset(data);
      } catch {
        // If fetch fails just show blank form
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [assetId]);

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/dashboard');
  };

  // On successful form submission go back to the previous screen
  const handleGenerated = () => {
    handleBack();
  };

  if (Platform.OS === 'web') return null;

  /** Build an initialHire seed from the scanned asset so fields pre-fill. */
  const initialHire = asset
    ? {
        data: {
          assetId: asset.serial_number || asset.id || '',
          equipmentDescription:
            asset.asset_types?.name || asset.model || asset.description || '',
          equipmentItems: [
            {
              assetId: asset.serial_number || asset.id || '',
              description:
                asset.asset_types?.name ||
                asset.model ||
                asset.description ||
                '',
            },
          ],
        },
      }
    : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading asset…</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {asset && (
            <View style={styles.assetBanner}>
              <Text style={styles.bannerLabel}>Hiring asset</Text>
              <Text style={styles.bannerTitle}>
                {asset.asset_types?.name || asset.model || 'Asset'}
              </Text>
              {(asset.serial_number || asset.id) && (
                <Text style={styles.bannerSub}>
                  Serial / ID: {asset.serial_number || asset.id}
                </Text>
              )}
            </View>
          )}

          <HireDisclaimerForm
            onGenerated={handleGenerated}
            initialHire={initialHire}
            hireFormMode="new"
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: sf(14),
    color: Colors.sub,
  },
  assetBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: 14,
    borderWidth: 2,
    borderColor: Colors.line,
    ...Shadows.card,
  },
  bannerLabel: {
    fontSize: sf(11),
    fontWeight: '800',
    color: Colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  bannerTitle: {
    fontSize: sf(16),
    fontWeight: '900',
    color: Colors.text,
  },
  bannerSub: {
    fontSize: sf(12),
    color: Colors.sub2,
    marginTop: 2,
  },
});
