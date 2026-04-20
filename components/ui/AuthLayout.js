import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
  StatusBar,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Radius, Shadows, sf } from '../../constants/uiTheme';

/**
 * Shared layout for all auth screens.
 * Renders a dark navy hero at the top with the GearOps logo,
 * then a rounded light card below for the form content.
 */
export default function AuthLayout({ subtitle, children }) {
  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.primary} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Hero ── */}
          <View style={s.hero}>
            <View style={s.logoWrap}>
              <Text style={s.logoGear}>GEAR</Text>
              <Text style={s.logoOps}>OPS</Text>
            </View>
            {subtitle ? (
              <Text style={s.heroSub}>{subtitle}</Text>
            ) : (
              <Text style={s.heroSub}>Asset Management Platform</Text>
            )}
          </View>

          {/* ── Form card ── */}
          <View style={s.card}>
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.primary,
  },
  scroll: {
    flexGrow: 1,
    backgroundColor: Colors.primary,
  },
  hero: {
    backgroundColor: Colors.primary,
    alignItems: 'center',
    paddingTop: 40,
    paddingBottom: 48,
    paddingHorizontal: 24,
  },
  logoWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 12,
  },
  logoGear: {
    fontSize: sf(52),
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -1,
    lineHeight: 56,
  },
  logoOps: {
    fontSize: sf(52),
    fontWeight: '900',
    color: Colors.accent,
    letterSpacing: -1,
    lineHeight: 56,
  },
  heroSub: {
    fontSize: sf(13),
    fontWeight: '600',
    color: 'rgba(255,255,255,0.55)',
    textTransform: 'uppercase',
    letterSpacing: 2,
    textAlign: 'center',
  },
  card: {
    flex: 1,
    minHeight: 400,
    backgroundColor: Colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 40,
    ...Shadows.lg,
  },
});
