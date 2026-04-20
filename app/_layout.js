// app/_layout.js
import '../global.css';
import { initSentry } from '../utils/sentry';
initSentry(); // must run before anything else so Sentry can instrument imports

import React, { useEffect, useState } from 'react';
import { Slot, useRouter } from 'expo-router';
import { auth } from '../firebaseConfig';
import { Provider as PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Platform, View, StyleSheet } from 'react-native';
import { usePathname } from 'expo-router';
import WebNavbar from '../components/WebNavbar';

import ErrorBoundary from '../components/ErrorBoundary';
import { theme } from '../constants/uiTheme';
import { TourProvider } from '../components/TourGuide';
import { TasksCountProvider } from '../contexts/TasksCountContext';
import TaskCountLoader from '../components/TaskCountLoader';

// Persist across RootLayout remounts (e.g. after router.replace) to avoid redirect loop / "maximum update depth"
let hasRedirectedToLoginSession = false;

export default function RootLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState(undefined);    // undefined = still checking
  const [layoutReady, setLayoutReady] = useState(false);

  // Check if we're on an auth page (login, register, verify-email, etc.)
  const isAuthPage = pathname?.includes('/login') || 
                     pathname?.includes('/register') || 
                     pathname?.includes('/verify-email') ||
                     pathname?.includes('/ForgotPassword');

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
    if (user !== null) {
      hasRedirectedToLoginSession = false;
      return;
    }
    if (!layoutReady || isAuthPage) return;
    if (hasRedirectedToLoginSession) return;
    hasRedirectedToLoginSession = true;
    router.replace('/(auth)/login');
  }, [user, layoutReady, isAuthPage]);

  // 3) Web-only: ensure global scrolling is enabled (guard against hidden overflow)
  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-scroll-fix', 'true');
    styleEl.innerHTML = `
      html, body, #root { min-height: 100vh !important; height: auto !important; overflow-y: auto !important; }
      body { overscroll-behavior-y: auto !important; }
      html, body {
        -webkit-text-size-adjust: 100% !important;
        text-size-adjust: 100% !important;
        zoom: 1 !important;
      }
      /* Smooth momentum scrolling on mobile web */
      * { -webkit-overflow-scrolling: touch; }
      /* Remove tap highlight flash on mobile web */
      * { -webkit-tap-highlight-color: transparent; }
    `;
    document.head.appendChild(styleEl);
    const prevHtml = document.documentElement.style.overflowY;
    const prevBody = document.body.style.overflowY;
    document.documentElement.style.overflowY = 'auto';
    document.body.style.overflowY = 'auto';
    // Prevent unintentional pinch-zoom on mobile web
    const preventZoom = (e) => { if (e.touches && e.touches.length > 1) e.preventDefault(); };
    document.addEventListener('touchmove', preventZoom, { passive: false });
    return () => {
      try { document.head.removeChild(styleEl); } catch { /* ignore */ }
      document.documentElement.style.overflowY = prevHtml;
      document.body.style.overflowY = prevBody;
      document.removeEventListener('touchmove', preventZoom);
    };
  }, []);

  // 4) still loading?
  if (user === undefined) {
    return null; // or your splash
  }

  const showNavbar = Platform.OS === 'web' && user && !isAuthPage;

  // 5) wrap everything in PaperProvider
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <PaperProvider theme={theme}>
          <TourProvider>
            <TasksCountProvider>
              <TaskCountLoader />
              <View style={styles.root}>
                {/* WebNavbar handles its own responsive behaviour (hamburger on mobile) */}
                {showNavbar && <WebNavbar />}
                {/* Content wrapper: centred + max-width on wide desktop screens */}
                <View style={styles.contentWrapper}>
                  <Slot />
                </View>
              </View>
            </TasksCountProvider>
          </TourProvider>
        </PaperProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F5F3F0',
    flexDirection: 'column',
  },
  contentWrapper: {
    flex: 1,
    width: '100%',
    // No global maxWidth here — the inventory/search table needs full viewport width.
    // Narrow content pages (forms, detail views) should apply their own maxWidth container.
  },
});
