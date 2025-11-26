// constants/uiTheme.js
import { MD3LightTheme as DefaultTheme } from 'react-native-paper';

export const Colors = {
  // Brand
  primary: '#0B63CE',
  primaryDark: '#084AA0',
  primaryLight: '#E7F3FF',
  primaryPill: '#EAF1FF',

  // Text & surfaces
  text: '#0F172A',
  sub: '#64748B',
  sub2: '#94A3B8',
  line: '#E5E7EB',
  bg: '#F7FAFF',
  card: '#FFFFFF',
  chip: '#F2F6FD',

  // Semantic accents
  successBg: '#ECFDF5',
  successFg: '#047857',
  successLight: '#D1FAE5',

  warningBg: '#FFFBEB',
  warningFg: '#B45309',
  warningLight: '#FEF3C7',

  infoBg: '#EFF6FF',
  infoFg: '#2563EB',
  infoLight: '#DBEAFE',

  dangerBg: '#FFEBEE',
  dangerFg: '#D32F2F',
  dangerLight: '#FEE2E2',
};

export const Radius = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  pill: 999,
};

export const Spacing = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
};

export const Shadows = {
  card: {
    shadowColor: '#0B63CE',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
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
  roundness: 2, // Multiplier for base roundness (4px * 2 = 8px)
};
