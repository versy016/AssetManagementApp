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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#E2E8F0',
  },
  secondaryButtonText: {
    color: '#1E293B',
  },
});

