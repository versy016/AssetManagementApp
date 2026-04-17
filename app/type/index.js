// app/type/index.js - Simple placeholder to satisfy Expo Router
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import ScreenWrapper from '../../components/ui/ScreenWrapper';
import ScreenHeader from '../../components/ui/ScreenHeader';

export default function TypeIndexScreen() {
  const router = useRouter();

  return (
    <ScreenWrapper style={styles.safeArea}>
      <ScreenHeader
        title="Asset Types"
        backLabel="Dashboard"
        onBack={() => router.replace('/(tabs)/dashboard')}
      />
      <View style={styles.container}>
        <Text style={styles.title}>Asset Types</Text>
        <Text style={styles.subtitle}>
          Use the shortcuts below to manage asset types.
        </Text>
        <TouchableOpacity style={styles.button} onPress={() => router.push('/type/new')}>
          <Text style={styles.buttonText}>Create New Type</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.secondaryButton]} onPress={() => router.push('/(tabs)/Inventory')}>
          <Text style={[styles.buttonText, styles.secondaryButtonText]}>Back to Inventory</Text>
        </TouchableOpacity>
      </View>
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
    fontSize: 24,
    fontWeight: '900',
    color: Colors.primaryDark,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
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
    fontSize: 16,
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

