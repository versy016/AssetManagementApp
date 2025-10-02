// app/_layout.js
import React, { useEffect, useState } from 'react';
import { Slot, useRouter } from 'expo-router';
import { auth } from '../firebaseConfig';
import { Provider as PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Platform } from 'react-native';

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

  // 3) Web-only: ensure global scrolling is enabled (guard against hidden overflow)
  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-scroll-fix', 'true');
    styleEl.innerHTML = `
      html, body, #root { min-height: 100vh !important; height: auto !important; overflow-y: auto !important; }
      body { overscroll-behavior-y: auto !important; }
    `;
    document.head.appendChild(styleEl);
    // Also clear any inline overflow locks
    const prevHtml = document.documentElement.style.overflowY;
    const prevBody = document.body.style.overflowY;
    document.documentElement.style.overflowY = 'auto';
    document.body.style.overflowY = 'auto';
    return () => {
      try { document.head.removeChild(styleEl); } catch {}
      document.documentElement.style.overflowY = prevHtml;
      document.body.style.overflowY = prevBody;
    };
  }, []);

  // 4) still loading?
  if (user === undefined) {
    return null; // or your splash
  }

  // 5) wrap everything in PaperProvider
  return (
    <SafeAreaProvider>
      <PaperProvider>
        <Slot />
      </PaperProvider>
    </SafeAreaProvider>

  );
}
