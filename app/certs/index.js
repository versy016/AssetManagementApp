import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import ScreenWrapper from '../../components/ui/ScreenWrapper';
import CertsView from '../../components/CertsView';
import ErrorBoundary from '../../components/ErrorBoundary';

export default function CertsScreen() {
  useEffect(() => {
    const id = setTimeout(() => {}, 0);
    return () => clearTimeout(id);
  }, []);

  return (
    <ScreenWrapper>
      <ErrorBoundary>
        <React.Suspense fallback={
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color="#2563EB" />
          </View>
        }>
          <CertsView visible />
        </React.Suspense>
      </ErrorBoundary>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
});

