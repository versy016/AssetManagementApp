// constants/uiTheme.js — Bold Industrial Design System
import { MD3LightTheme as DefaultTheme } from 'react-native-paper';

// ── Bold Industrial Palette ──
// Warm stone neutrals + navy/orange brand + professional status colors
export const Colors = {
  // Brand
  primary: '#1E293B',        // Navy — primary brand
  primaryDark: '#0F172A',
  primaryLight: '#E2E8F0',
  primaryPill: '#F1F5F9',

  // Accent
  accent: '#EA580C',         // Safety orange — CTAs and highlights
  accentDark: '#C2410C',
  accentLight: '#FFF7ED',
  accentMuted: '#FFEDD5',

  // Text & surfaces (warm stone neutrals)
  text: '#1C1917',
  sub: '#4A4540',
  sub2: '#7C786E',
  line: '#C0BBB5',
  lineStrong: '#A8A49E',
  bg: '#EAE6E1',
  card: '#F7F5F2',
  chip: '#DEDAD4',

  // Semantic status
  successBg: '#F0FDFA',
  successFg: '#0D9488',
  successBorder: '#99F6E4',

  warningBg: '#FFFBEB',
  warningFg: '#D97706',
  warningBorder: '#FDE68A',

  infoBg: '#EEF2FF',
  infoFg: '#4F46E5',
  infoBorder: '#C7D2FE',

  dangerBg: '#FEF2F2',
  dangerFg: '#DC2626',
  dangerBorder: '#FECACA',

  // Asset status colors
  statusInService: '#0D9488',
  statusInServiceBg: '#F0FDFA',
  statusRepair: '#DC2626',
  statusRepairBg: '#FEF2F2',
  statusMaintenance: '#D97706',
  statusMaintenanceBg: '#FFFBEB',
  statusOnHire: '#4F46E5',
  statusOnHireBg: '#EEF2FF',
  statusEOL: '#78716C',
  statusEOLBg: '#F5F5F4',
};

export const Radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  pill: 9999,
};

export const Spacing = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
  '3xl': 32,
};

export const Shadows = {
  card: {
    shadowColor: '#1C1917',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  md: {
    shadowColor: '#1C1917',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  lg: {
    shadowColor: '#1C1917',
    shadowOpacity: 0.1,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 12 },
    elevation: 5,
  },
};

// Font weights used in Bold Industrial
export const FontWeights = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
  black: '900',
};

// Status config for mapping asset status to colors
export const STATUS_CONFIG = {
  in_service: { label: 'In Service', fg: Colors.statusInService, bg: Colors.statusInServiceBg, border: Colors.successBorder },
  repair: { label: 'Repair', fg: Colors.statusRepair, bg: Colors.statusRepairBg, border: Colors.dangerBorder },
  maintenance: { label: 'Maintenance', fg: Colors.statusMaintenance, bg: Colors.statusMaintenanceBg, border: Colors.warningBorder },
  on_hire: { label: 'On Hire', fg: Colors.statusOnHire, bg: Colors.statusOnHireBg, border: Colors.infoBorder },
  end_of_life: { label: 'End of Life', fg: Colors.statusEOL, bg: Colors.statusEOLBg, border: Colors.line },
};

export const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: Colors.primary,
    onPrimary: '#FFFFFF',
    primaryContainer: Colors.primaryLight,
    onPrimaryContainer: Colors.primaryDark,
    secondary: Colors.sub,
    onSecondary: '#FFFFFF',
    secondaryContainer: Colors.chip,
    onSecondaryContainer: Colors.text,
    background: Colors.bg,
    surface: Colors.card,
    error: Colors.dangerFg,
    onError: '#FFFFFF',
    errorContainer: Colors.dangerBg,
    onErrorContainer: Colors.dangerFg,
    outline: Colors.line,
  },
  roundness: 2.5,
};
