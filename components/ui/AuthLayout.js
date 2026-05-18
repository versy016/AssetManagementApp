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
import { useResponsive } from '../../hooks/useResponsive';

/**
 * Shared layout for all auth screens.
 *
 * Native / narrow web (<1024 px):
 *   • Dark navy hero at the top with the GearOps logo
 *   • Rounded light card below for the form content
 *
 * Wide web (≥1024 px):
 *   • Split-screen layout — branding panel on the left, form panel on the right
 *   • Standard SaaS login pattern (Notion / Linear / Stripe-style)
 */
export default function AuthLayout({ subtitle, children }) {
  const { isDesktop } = useResponsive();
  const useSplit = Platform.OS === 'web' && isDesktop;

  if (useSplit) {
    return (
      <View style={s.splitRoot}>
        {/* ── Left: branding panel ── */}
        <View style={s.splitBrand}>
          <View style={s.splitBrandInner}>
            <View style={s.splitLogoWrap}>
              <Text style={s.splitLogoGear}>GEAR</Text>
              <Text style={s.splitLogoOps}>OPS</Text>
            </View>
            <Text style={s.splitTagline}>
              {subtitle || 'Asset Management Platform'}
            </Text>

            <View style={s.splitProps}>
              <PropRow icon="📦" title="Track every asset, anywhere"
                       body="Vehicles, total stations, accessories — one inventory across every site." />
              <PropRow icon="📱" title="QR scan for instant updates"
                       body="Field crews check-in, transfer or report lost equipment from any phone." />
              <PropRow icon="📊" title="Hire, maintenance &amp; activity"
                       body="Schedule services, send signed hire docs, and see every change in one feed." />
            </View>

            <View style={s.splitFooter}>
              <Text style={s.splitFooterText}>© GearOps</Text>
            </View>
          </View>
        </View>

        {/* ── Right: form panel ── */}
        <View style={s.splitForm}>
          <ScrollView
            contentContainerStyle={s.splitFormScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={s.splitCard}>
              {children}
            </View>
          </ScrollView>
        </View>
      </View>
    );
  }

  // Default (mobile / narrow web) — vertical hero + card
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

          <View style={s.card}>
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Small value-prop row used on the desktop branding panel. */
function PropRow({ icon, title, body }) {
  return (
    <View style={s.propRow}>
      <Text style={s.propIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={s.propTitle}>{title}</Text>
        <Text style={s.propBody}>{body}</Text>
      </View>
    </View>
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

  // ── Split-screen (desktop web) ─────────────────────────────────────────
  splitRoot: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: Colors.primary,
    minHeight: '100vh',
  },
  splitBrand: {
    flex: 1,
    backgroundColor: Colors.primary,
    padding: 60,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  splitBrandInner: {
    maxWidth: 520,
    alignSelf: 'center',
    width: '100%',
  },
  splitLogoWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 14,
  },
  splitLogoGear: {
    fontSize: sf(64),
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -1.5,
    lineHeight: 68,
  },
  splitLogoOps: {
    fontSize: sf(64),
    fontWeight: '900',
    color: Colors.accent,
    letterSpacing: -1.5,
    lineHeight: 68,
  },
  splitTagline: {
    fontSize: sf(14),
    fontWeight: '700',
    color: 'rgba(255,255,255,0.6)',
    textTransform: 'uppercase',
    letterSpacing: 2.5,
    marginBottom: 44,
  },
  splitProps: { gap: 22 },
  propRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  propIcon: {
    fontSize: 22,
    width: 30,
    textAlign: 'center',
  },
  propTitle: {
    fontSize: sf(15),
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 4,
    letterSpacing: 0.2,
  },
  propBody: {
    fontSize: sf(13),
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 19,
  },
  splitFooter: {
    marginTop: 48,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  splitFooterText: {
    fontSize: sf(11),
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0.4,
  },

  splitForm: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  splitFormScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  splitCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 36,
    borderWidth: 1,
    borderColor: Colors.line,
    ...Shadows.lg,
  },
});
