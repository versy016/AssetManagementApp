/**
 * hooks/useResponsive.js
 *
 * Single source of truth for responsive breakpoints across the app.
 *
 * Usage:
 *   const { isMobile, isTablet, isDesktop, width } = useResponsive();
 *
 * Breakpoints:
 *   mobile  : width < 768   (phones, mobile web in Chrome)
 *   tablet  : 768 – 1023    (iPad, small browser windows)
 *   desktop : width >= 1024 (laptop / desktop web)
 *
 * On web we initialise from window.innerWidth synchronously so the very first
 * render already knows the correct breakpoint.  This avoids the flash where the
 * desktop topbar briefly appears at a 375 px viewport before React state catches
 * up (the root cause of "no hamburger at 375 px").
 */
import { useState, useEffect } from 'react';
import { useWindowDimensions, Platform } from 'react-native';

export const BREAKPOINTS = Object.freeze({
  tablet:  768,
  desktop: 1024,
});

/** Read window.innerWidth synchronously; safe to call inside useState() init. */
function readWindowWidth() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.innerWidth || 0;
  }
  return 0;
}

export function useResponsive() {
  const { width: rnWidth, height } = useWindowDimensions();

  // On web, keep a local copy of window.innerWidth so we always have the right
  // value from the first render (lazy useState initialiser runs synchronously).
  const [webWidth, setWebWidth] = useState(readWindowWidth);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onResize = () => setWebWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    // Sync once in case the window was resized between SSR and mount.
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Prefer the direct window measurement on web; fall back to RN's value on
  // native or when the web measurement isn't available yet.
  const width = Platform.OS === 'web' && webWidth > 0 ? webWidth : rnWidth;

  const isMobile  = width < BREAKPOINTS.tablet;
  const isTablet  = width >= BREAKPOINTS.tablet && width < BREAKPOINTS.desktop;
  const isDesktop = width >= BREAKPOINTS.desktop;

  return {
    width,
    height,
    isMobile,
    isTablet,
    isDesktop,
    // convenience: "not a full desktop" — used for condensed layouts
    isCompact: !isDesktop,
  };
}
