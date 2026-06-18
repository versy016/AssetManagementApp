import { sf } from '../../constants/uiTheme.js';
// app/type/index.js - Asset Types landing page
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenWrapper from '../../components/ui/ScreenWrapper';
import ScreenHeader from '../../components/ui/ScreenHeader';
import NewButton from '../../components/ui/NewButton';

export default function TypeIndexScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWebWide = Platform.OS === 'web' && (width || 0) >= 960;

  return (
    <ScreenWrapper style={styles.safeArea}>
      <ScreenHeader
        title="Asset Types"
        backLabel="Dashboard"
        onBack={() => router.replace('/(tabs)/dashboard')}
      />

      {isWebWide ? (
        <View style={whs.page}>
          {/* Hero banner */}
          <View style={whs.hero}>
            <View style={whs.heroIconWrap}>
              <MaterialIcons name="category" size={48} color={Colors.primary} />
            </View>
            <View style={whs.heroInfo}>
              <Text style={whs.heroLabel}>Asset Management</Text>
              <Text style={whs.heroTitle}>Asset Types</Text>
              <Text style={whs.heroSub}>
                Define the categories of assets tracked in your system. Each type can have its own set of custom fields, preset attributes, and required data.
              </Text>
            </View>
          </View>

          {/* Action cards */}
          <View style={whs.actions}>
            <TouchableOpacity style={whs.actionCard} onPress={() => router.push('/type/new')} activeOpacity={0.85}>
              <View style={whs.actionIconWrap}>
                <MaterialIcons name="add-circle-outline" size={32} color={Colors.primary} />
              </View>
              <Text style={whs.actionCardTitle}>Create New Type</Text>
              <Text style={whs.actionCardSub}>Define a new asset category with custom fields and presets</Text>
              <View style={whs.actionArrow}>
                <MaterialIcons name="arrow-forward" size={18} color={Colors.sub2} />
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={[whs.actionCard, whs.actionCardSecondary]} onPress={() => router.push('/(tabs)/Inventory')} activeOpacity={0.85}>
              <View style={[whs.actionIconWrap, { backgroundColor: Colors.chip }]}>
                <MaterialIcons name="inventory-2" size={32} color={Colors.sub} />
              </View>
              <Text style={[whs.actionCardTitle, { color: Colors.sub }]}>View Inventory</Text>
              <Text style={whs.actionCardSub}>Browse assets and manage existing asset types</Text>
              <View style={whs.actionArrow}>
                <MaterialIcons name="arrow-forward" size={18} color={Colors.sub2} />
              </View>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        /* Mobile layout — unchanged */
        <View style={styles.container}>
          <Text style={styles.title}>Asset Types</Text>
          <Text style={styles.subtitle}>
            Use the shortcuts below to manage asset types.
          </Text>
          <NewButton label="Create New Type" onPress={() => router.push('/type/new')} style={{ alignSelf: 'flex-start', marginBottom: 12 }} />
          <TouchableOpacity style={[styles.button, styles.secondaryButton]} onPress={() => router.push('/(tabs)/Inventory')}>
            <Text style={[styles.buttonText, styles.secondaryButtonText]}>Back to Inventory</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScreenWrapper>
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
  safeArea: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: sf(24),
    fontWeight: '900',
    color: Colors.primaryDark,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: sf(14),
    color: Colors.sub,
    textAlign: 'center',
    marginBottom: 24,
    fontWeight: '600',
  },
  button: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: Radius.lg,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  buttonText: {
    color: Colors.card,
    fontSize: sf(16),
    fontWeight: '800',
  },
  secondaryButton: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.line,
  },
  secondaryButtonText: {
    color: Colors.primary,
    fontWeight: '800',
  },
});

// Web-only styles
const whs = StyleSheet.create({
  page: {
    flex: 1,
    maxWidth: 1100,
    width: '100%',
    alignSelf: 'center',
    padding: 32,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.line,
    padding: 32,
    marginBottom: 24,
    gap: 28,
    ...CardShadow,
  },
  heroIconWrap: {
    width: 80,
    height: 80,
    borderRadius: Radius.lg,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.line,
  },
  heroInfo: {
    flex: 1,
    gap: 6,
  },
  heroLabel: {
    fontSize: sf(11),
    fontWeight: '700',
    color: Colors.sub2,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  heroTitle: {
    fontSize: sf(30),
    fontWeight: '900',
    color: Colors.primaryDark,
    letterSpacing: -0.5,
  },
  heroSub: {
    fontSize: sf(14),
    fontWeight: '500',
    color: Colors.sub,
    lineHeight: sf(22),
    maxWidth: 600,
  },
  actions: {
    flexDirection: 'row',
    gap: 16,
  },
  actionCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.primary,
    padding: 24,
    gap: 10,
    ...CardShadow,
  },
  actionCardSecondary: {
    borderColor: Colors.line,
  },
  actionIconWrap: {
    width: 56,
    height: 56,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  actionCardTitle: {
    fontSize: sf(18),
    fontWeight: '800',
    color: Colors.primaryDark,
    letterSpacing: -0.3,
  },
  actionCardSub: {
    fontSize: sf(13),
    fontWeight: '500',
    color: Colors.sub,
    lineHeight: sf(20),
  },
  actionArrow: {
    marginTop: 8,
  },
});
