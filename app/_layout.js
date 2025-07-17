// app/_layout.js
import React, { useEffect, useState } from 'react';
import { Slot, useRouter } from 'expo-router';
import { auth } from '../firebaseConfig';
import { Provider as PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  const router = useRouter();
  const [user, setUser] = useState(undefined);    // undefined = still checking
  const [layoutReady, setLayoutReady] = useState(false);

  // 1) watch auth
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((firebaseUser) => {
      setUser(firebaseUser || null);
    });
    return unsubscribe;
  }, []);

  // 2) once layout is mounted, possibly redirect
  useEffect(() => {
    setLayoutReady(true);
  }, []);

  useEffect(() => {
    if (user === null && layoutReady) {
      router.replace('/(auth)/login');
    }
  }, [user, layoutReady]);

  // 3) still loading?
  if (user === undefined) {
    return null; // or your splash
  }

  // 4) wrap everything in PaperProvider
  return (
    <SafeAreaProvider>
      <PaperProvider>
        <Slot />
      </PaperProvider>
    </SafeAreaProvider>

  );
}
