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
 */
import { useWindowDimensions } from 'react-native';

export const BREAKPOINTS = Object.freeze({
  tablet:  768,
  desktop: 1024,
});

export function useResponsive() {
  const { width, height } = useWindowDimensions();

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
