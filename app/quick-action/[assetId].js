import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import ScreenHeader from '../../components/ui/ScreenHeader';
import ActionsForm from '../../components/ActionsForm';
import StatusBadge, { normalizeStatus } from '../../components/ui/StatusBadge';
import { Colors, Radius, Shadows, sf } from '../../constants/uiTheme';
import { API_BASE_URL } from '../../inventory-api/apiBase';

const ACTION_META = {
  repair:      { label: 'Repair',      header: 'Log Repair',   icon: 'build',         color: Colors.dangerFg },
  maintenance: { label: 'Maintenance', header: 'Log Service',  icon: 'build-circle',  color: Colors.warningFg },
  service:     { label: 'Maintenance', header: 'Log Service',  icon: 'build-circle',  color: Colors.warningFg },
};

export default function QuickActionScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();

  const assetId = params?.assetId ? String(params.assetId) : null;
  const actionParam = params?.action ? String(params.action).toLowerCase() : 'maintenance';
  const returnTo = params?.returnTo ? String(params.returnTo) : null;

  const meta = ACTION_META[actionParam] || ACTION_META.maintenance;

  const [asset, setAsset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [formVisible, setFormVisible] = useState(false);

  const backToTarget = useCallback(() => {
    if (returnTo) router.replace(returnTo);
    else if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/dashboard');
  }, [returnTo, router]);

  const handleClose = useCallback(() => {
    setFormVisible(false);
    backToTarget();
  }, [backToTarget]);

  useEffect(() => {
    let ignore = false;
    if (!assetId) { setLoading(false); return; }
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE_URL}/assets/${assetId}`);
        if (!res.ok) throw new Error('Unable to load asset');
        const data = await res.json();
        if (!ignore) { setAsset(data); setFormVisible(true); }
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
    return () => { ignore = true; };
  }, [assetId, backToTarget]);

  const handleSubmitted = useCallback(() => {
    setFormVisible(false);
    Alert.alert(
      'Saved',
      meta.label === 'Repair' ? 'Repair logged successfully.' : 'Service logged successfully.',
      [
        { text: 'Done', onPress: () => backToTarget() },
        { text: 'View Asset', onPress: () => router.replace({ pathname: '/asset/[assetId]', params: { assetId } }) },
      ]
    );
  }, [meta.label, assetId, backToTarget, router]);

  const assetType = asset?.asset_types?.name || asset?.name || 'Asset';
  const model = asset?.model || asset?.description || '';
  const serial = asset?.serial_number || '';
  const assignedTo = asset?.users?.name || asset?.users?.useremail || 'Unassigned';

  return (
    <SafeAreaView style={s.safe}>
      <ScreenHeader title={meta.header} backLabel="Back" onBack={handleClose} />
      <View style={s.content}>
        {loading ? (
          <View style={s.center}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={s.loadingText}>Loading asset…</Text>
          </View>
        ) : !asset ? (
          <View style={s.center}>
            <MaterialIcons name="error-outline" size={40} color={Colors.dangerFg} />
            <Text style={s.errorText}>Asset not found.</Text>
          </View>
        ) : (
          <View style={s.assetCard}>
            {/* Left accent bar */}
            <View style={[s.accentBar, { backgroundColor: meta.color }]} />

            <View style={s.cardBody}>
              {/* Action type badge */}
              <View style={s.actionBadge}>
                <MaterialIcons name={meta.icon} size={14} color={meta.color} />
                <Text style={[s.actionBadgeText, { color: meta.color }]}>
                  {meta.header.toUpperCase()}
                </Text>
              </View>

              {/* Asset name + ID */}
              <View style={s.titleRow}>
                <Text style={s.assetTitle} numberOfLines={2}>{assetType}</Text>
                <View style={s.idChip}>
                  <Text style={s.idChipText}>{asset.id}</Text>
                </View>
              </View>

              {model ? <Text style={s.assetModel}>{model}</Text> : null}

              {/* Info grid */}
              <View style={s.infoGrid}>
                {serial ? (
                  <View style={s.infoCell}>
                    <Text style={s.infoLabel}>SERIAL</Text>
                    <Text style={s.infoValue}>{serial}</Text>
                  </View>
                ) : null}
                <View style={s.infoCell}>
                  <Text style={s.infoLabel}>ASSIGNED TO</Text>
                  <Text style={s.infoValue}>{assignedTo}</Text>
                </View>
                <View style={s.infoCell}>
                  <Text style={s.infoLabel}>STATUS</Text>
                  <View style={{ marginTop: 4 }}>
                    <StatusBadge status={normalizeStatus(asset.status)} />
                  </View>
                </View>
              </View>

              <View style={s.divider} />
              <Text style={s.formHint}>
                Fill out the form below to record a {meta.label.toLowerCase()}.
              </Text>
            </View>
          </View>
        )}
      </View>

      {asset && (
        <ActionsForm
          visible={formVisible}
          onClose={handleClose}
          asset={asset}
          action={meta.label}
          apiBaseUrl={API_BASE_URL}
          users={[]}
          onSubmitted={handleSubmitted}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: Colors.sub,
    fontSize: sf(15),
    fontWeight: '500',
  },
  errorText: {
    color: Colors.dangerFg,
    fontSize: sf(16),
    fontWeight: '700',
  },
  assetCard: {
    flexDirection: 'row',
    borderWidth: 2,
    borderColor: Colors.line,
    borderRadius: Radius.lg,
    backgroundColor: Colors.card,
    overflow: 'hidden',
    ...Shadows.card,
  },
  accentBar: {
    width: 5,
    alignSelf: 'stretch',
  },
  cardBody: {
    flex: 1,
    padding: 16,
    gap: 6,
  },
  actionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
  },
  actionBadgeText: {
    fontSize: sf(11),
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    justifyContent: 'space-between',
  },
  assetTitle: {
    fontSize: sf(18),
    fontWeight: '900',
    color: Colors.text,
    flex: 1,
  },
  idChip: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    flexShrink: 0,
  },
  idChipText: {
    color: '#FFFFFF',
    fontSize: sf(11),
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  assetModel: {
    fontSize: sf(14),
    color: Colors.sub,
    fontWeight: '500',
    marginTop: 2,
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
  },
  infoCell: {
    flex: 1,
    minWidth: 80,
  },
  infoLabel: {
    fontSize: sf(10),
    fontWeight: '800',
    letterSpacing: 0.8,
    color: Colors.sub2,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: sf(13),
    fontWeight: '700',
    color: Colors.text,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.line,
    marginVertical: 8,
  },
  formHint: {
    fontSize: sf(13),
    color: Colors.sub,
    fontWeight: '500',
    fontStyle: 'italic',
  },
});
