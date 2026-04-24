// dashboard.js — Bold Industrial Dashboard
// Main dashboard screen for authenticated users

import React, { useState, useEffect, useContext, useRef, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert,
  ActivityIndicator, Modal, Platform, StatusBar,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { auth } from '../../firebaseConfig';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import logger from '../../utils/logger';
import PropTypes from 'prop-types';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import SearchScreen from '../search';
import InventoryScreen from './Inventory';
import TasksScreen from './tasks';
import CertsView from '../../components/CertsView';
import ErrorBoundary from '../../components/ErrorBoundary';
import HireView from '../../components/HireView';
import ScreenWrapper from '../../components/ui/ScreenWrapper';
import { getShortcutType, getDisplayShortcuts, canUseShortcut } from '../../constants/ShortcutTypes';
import { executeShortcut } from '../../utils/ShortcutExecutor';
import { formatActivityListTitle } from '../../utils/activityLabels';
import { TourTarget, TourContext, shouldShowTour, resetTour } from '../../components/TourGuide';
import { Colors, Radius, Shadows, sf } from '../../constants/uiTheme';

const C = Colors; // shorthand

const Dashboard = ({ isAdmin }) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [adminClaim, setAdminClaim] = useState(false);
  const [dbAdmin, setDbAdmin] = useState(false);
  const [recent, setRecent] = useState({ items: [], loading: true });
  const SHOW_RECENT = true;
  // On web, always use the web layout regardless of window width.
  // The WebNavbar handles branding + navigation at all sizes (hamburger on mobile, full bar on desktop).
  // The mobile hero header should only render on native iOS/Android.
  const isDesktopWeb = Platform.OS === 'web';
  const isIos = Platform.OS === 'ios';

  const { view: viewParam } = useLocalSearchParams();
  const [mobileView, setMobileView] = useState('dashboard');
  const webViewKey = String(viewParam || '').toLowerCase() || 'dashboard';

  // ─── Auth ───
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      try {
        if (!currentUser) {
          router.replace('/(auth)/login');
          setUser(null);
          setAdminClaim(false);
        } else {
          setUser(currentUser);
          await currentUser.getIdToken(true);
          const tokenResult = await currentUser.getIdTokenResult();
          setAdminClaim(!!tokenResult?.claims?.admin);
        }
      } catch (err) {
        logger.error('Auth/claims error:', err);
      } finally {
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user?.uid) { setDbAdmin(false); return; }
    let ignore = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/users/${user.uid}`);
        if (!res.ok) throw new Error('Failed to load user');
        const data = await res.json();
        if (!ignore) setDbAdmin(String(data?.role || '').toUpperCase() === 'ADMIN');
      } catch { if (!ignore) setDbAdmin(false); }
    })();
    return () => { ignore = true; };
  }, [user?.uid]);

  const canAdmin = isAdmin || adminClaim || dbAdmin;

  const shortcuts = useMemo(
    () =>
      getDisplayShortcuts(canAdmin, Platform.OS === 'web').map((t) => ({
        id: `tile_${t.id}`,
        type: t.id,
      })),
    [canAdmin]
  );

  // ─── Tour ───
  const { startTour, finishTour, setDisabled: setTourDisabled, ensureVisible, currentStep } = useContext(TourContext);
  const [tourStarted, setTourStarted] = useState(false);
  const scrollViewRef = useRef(null);
  const shortcutsRef = useRef(null);

  useEffect(() => {
    if (showProfileMenu) {
      finishTour?.();
      setTourDisabled?.(true);
    } else {
      setTourDisabled?.(false);
    }
  }, [showProfileMenu, finishTour, setTourDisabled]);

  const handleRestartTour = async () => {
    setShowProfileMenu(false);
    await resetTour();
    setTourStarted(false);
    setTimeout(() => { startTour(); setTourStarted(true); }, 300);
  };

  const measureAndScroll = (ref) => {
    if (!ref || !scrollViewRef.current) return;
    try {
      ref.measure((x, y, width, height, pageX, pageY) => {
        scrollViewRef.current.measure((sx, sy, sw, sh, spx, spy) => {
          const relativeY = pageY - spy;
          if (relativeY >= 0) {
            scrollViewRef.current?.scrollTo({ y: Math.max(0, relativeY - 100), animated: true });
          }
        });
      });
    } catch (e) {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }
  };

  useEffect(() => {
    if (currentStep?.targetId === 'section-shortcuts') {
      setTimeout(() => { shortcutsRef.current && measureAndScroll(shortcutsRef.current); }, 100);
    }
  }, [currentStep]);

  useEffect(() => {
    if (ensureVisible && scrollViewRef.current) ensureVisible(scrollViewRef.current);
  }, [ensureVisible]);

  // ─── Recent Activity (via /assets/stats — single request replaces 26-request waterfall) ───
  useEffect(() => {
    if (!SHOW_RECENT) return;
    let cancelled = false;
    (async () => {
      try {
        setRecent((r) => ({ ...r, loading: true }));
        const res = await fetch(`${API_BASE_URL}/assets/stats?limit=10`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // Normalise to the { asset, action } shape the render code already expects
        const items = (Array.isArray(data?.recent_activity) ? data.recent_activity : [])
          .filter(a => (a?.asset?.name || '').toLowerCase() !== 'qr reserved asset')
          .map(a => ({ asset: a.asset, action: a }));
        if (!cancelled) setRecent({ items, loading: false });
      } catch (e) {
        logger.warn('dashboard: stats fetch failed', e?.message || e);
        if (!cancelled) setRecent({ items: [], loading: false });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleExecuteShortcut = (shortcutType) => {
    if (!user) { Alert.alert('Error', 'You must be logged in to use shortcuts'); return; }
    if (!canUseShortcut(shortcutType, canAdmin)) {
      Alert.alert('Admin only', 'This shortcut is only available to administrators.');
      return;
    }
    executeShortcut(shortcutType, router, user, canAdmin);
  };

  // ─── Quick Actions ───
  const quickActions = useMemo(() => [
    { key: 'scan', label: 'Scan Asset', icon: 'qr-code-scanner', onPress: () => router.push('/qr-scanner') },
    { key: 'multi', label: 'Multi-Scan', icon: 'sync-alt', onPress: () => router.push('/qr-scanner?mode=multi') },
    { key: 'search', label: 'Search', icon: 'search', onPress: () => router.push('/search') },
    { key: 'assets', label: 'My Assets', icon: 'inventory', onPress: () => router.push('/asset/assets') },
    { key: 'activity', label: 'Activity', icon: 'history', onPress: () => router.push('/activity') },
    { key: 'certs', label: 'Certs', icon: 'verified', onPress: () => router.push('/certs') },
  ], [router]);

  const handleLogout = async () => {
    try { await signOut(auth); router.replace('/(auth)/login'); }
    catch (error) { Alert.alert('Logout Error', error.message); }
  };

  const userInitials = (user?.displayName || user?.email || 'US').substring(0, 2).toUpperCase();

  // ─── Action color mapping ───
  const ACTION_ICON_MAP = {
    TRANSFER: { icon: 'swap-horiz', bg: '#E2E8F0', fg: C.primary },
    CHECK_IN: { icon: 'check-circle', bg: C.successBg, fg: C.successFg },
    CHECK_OUT: { icon: 'logout', bg: C.infoBg, fg: C.infoFg },
    REPAIR: { icon: 'build', bg: C.accentLight, fg: C.accent },
    MAINTENANCE: { icon: 'engineering', bg: C.warningBg, fg: C.warningFg },
    HIRE: { icon: 'assignment', bg: C.infoBg, fg: C.infoFg },
    STATUS_CHANGE: { icon: 'swap-vert', bg: '#E2E8F0', fg: C.primary },
    END_OF_LIFE: { icon: 'block', bg: C.chip, fg: C.sub },
    LOST: { icon: 'error', bg: C.dangerBg, fg: C.dangerFg },
    STOLEN: { icon: 'warning', bg: C.dangerBg, fg: C.dangerFg },
  };

  const getRelativeTime = (date) => {
    if (!date) return '';
    const now = new Date();
    const d = new Date(date);
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
    return `${Math.floor(diff / 604800)}w`;
  };

  // ═══════════════════════════════════════════════════════
  // RENDER: Shortcuts Section
  // ═══════════════════════════════════════════════════════
  const renderShortcutsSection = () => (
    <View ref={shortcutsRef} style={s.shortcutsSection}>
      <View style={s.sectionHeaderRow}>
        <Text style={s.shortcutsHeading}>Shortcuts</Text>
      </View>
      <View style={s.shortcutGrid}>
        {shortcuts.map((shortcut) => {
          const shortcutType = getShortcutType(shortcut.type);
          if (!shortcutType) return null;
          return (
            <TouchableOpacity
              key={shortcut.id}
              style={s.shortcutGridCard}
              onPress={() => handleExecuteShortcut(shortcut.type)}
              activeOpacity={0.75}
            >
              <View style={[s.shortcutGridIcon, { backgroundColor: shortcutType.bgColor }]}>
                <MaterialIcons name={shortcutType.icon} size={24} color={shortcutType.color} />
              </View>
              <Text style={s.shortcutGridLabel} numberOfLines={2}>
                {shortcutType.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  // ═══════════════════════════════════════════════════════
  // RENDER: Recent Activity
  // ═══════════════════════════════════════════════════════
  const renderRecentActivity = () => {
    if (!SHOW_RECENT) return null;
    return (
      <View style={s.activitySection}>
        <Text style={[s.shortcutsHeading, { marginBottom: 12 }]}>Recent Activity</Text>
        {recent.loading ? (
          <ActivityIndicator size="small" color={C.accent} style={{ marginTop: 16 }} />
        ) : recent.items.length === 0 ? (
          <View style={s.activityEmpty}>
            <MaterialIcons name="history" size={28} color={C.sub2} />
            <Text style={s.activityEmptyText}>No recent activity</Text>
            </View>
        ) : (
          <View style={{ gap: 8 }}>
            {recent.items.map((item, idx) => {
              const actionType = (item.action?.type || 'STATUS_CHANGE').toUpperCase();
              const mapping = ACTION_ICON_MAP[actionType] || ACTION_ICON_MAP.STATUS_CHANGE;
              const borderLeftColors = {
                TRANSFER: C.primary,
                REPAIR: C.accent,
                CHECK_IN: C.successFg,
                CHECK_OUT: C.infoFg,
                MAINTENANCE: C.warningFg,
              };
          return (
            <TouchableOpacity
                  key={idx}
                  style={[s.activityRow, { borderLeftColor: borderLeftColors[actionType] || C.line }]}
                  onPress={() => item.asset?.id && router.push(`/asset/${item.asset.id}`)}
                >
                  <View style={[s.activityIcon, { backgroundColor: mapping.bg }]}>
                    <MaterialIcons name={mapping.icon} size={16} color={mapping.fg} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.activityTitle} numberOfLines={1}>
                      {item.asset?.model || item.asset?.description || 'Asset'} —{' '}
                      {formatActivityListTitle(actionType, {
                        firebaseUser: user,
                        toUser: item.action?.to_user,
                        toLabel: item.action?.to,
                      })}
              </Text>
                    <Text style={s.activitySub} numberOfLines={1}>
                      {item.action?.note || item.action?.performed_by?.name || ''}
                    </Text>
                  </View>
                  <Text style={s.activityTime}>{getRelativeTime(item.action?.occurred_at)}</Text>
            </TouchableOpacity>
          );
        })}
                        </View>
                      )}
                    </View>
    );
  };

  // ═══════════════════════════════════════════════════════
  // RENDER: Hero (Mobile)
  // ═══════════════════════════════════════════════════════
  const renderHeroMobile = () => (
    <View style={[s.hero, { paddingTop: insets.top + (Platform.OS === 'ios' ? 8 : 6) }]}>
      <StatusBar barStyle="light-content" backgroundColor={C.primary} />
      <View style={s.heroTopRow}>
        <View style={s.heroStub} />
        <Text style={s.heroTitle}>
          <Text style={s.heroTitleGear}>GEAR</Text>
          <Text style={s.heroTitleOps}>OPS</Text>
        </Text>
        <TouchableOpacity onPress={() => setShowProfileMenu(!showProfileMenu)}>
          <TourTarget id="profile-btn">
            <View style={s.avatar}>
              <Text style={s.avatarText}>{userInitials}</Text>
            </View>
          </TourTarget>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ═══════════════════════════════════════════════════════
  // RENDER: Quick Actions (Mobile)
  // ═══════════════════════════════════════════════════════
  const ACTION_COLORS = [
    { bg: C.accentMuted, fg: C.accent },
    { bg: C.infoBg, fg: C.infoFg },
    { bg: C.chip, fg: C.sub },
    { bg: C.successBg, fg: C.successFg },
    { bg: '#EEF2FF', fg: C.infoFg },
    { bg: C.warningBg, fg: C.warningFg },
  ];

  const renderQuickActions = () => (
    <View style={s.actionsGrid}>
      {quickActions.map((action, idx) => {
        const ac = ACTION_COLORS[idx] || ACTION_COLORS[0];
              return (
          <TourTarget key={action.key} id={`qa-${action.key}`} style={{ flexBasis: '31%' }}>
            <TouchableOpacity style={s.actionCard} onPress={action.onPress}>
              <View style={[s.actionIconWrap, { backgroundColor: ac.bg }]}>
                <MaterialIcons name={action.icon} size={22} color={ac.fg} />
              </View>
              <Text style={s.actionLabel}>{action.label}</Text>
            </TouchableOpacity>
          </TourTarget>
              );
            })}
    </View>
  );

  // ═══════════════════════════════════════════════════════
  // RENDER: Web Content Area
  // ═══════════════════════════════════════════════════════
  const renderWebContent = () => {
    const key = webViewKey;
    if (!key || key === 'dashboard' || key === 'search') {
      return <View style={s.webPane}><SearchScreen embed /></View>;
    }
    if (key === 'certs') return <View style={s.webPane}><ErrorBoundary><CertsView visible /></ErrorBoundary></View>;
    if (key === 'inventory') return <View style={s.webPane}><InventoryScreen /></View>;
    if (key === 'shortcuts') {
      return (
        <ScrollView contentContainerStyle={s.scrollContent}>
          <TourTarget id="section-shortcuts">{renderShortcutsSection()}</TourTarget>
        </ScrollView>
      );
    }
    if (key === 'tasks') return <View style={s.webPane}><TasksScreen /></View>;
    if (key === 'hire') return <View style={s.webPane}><HireView /></View>;
    return <View style={s.webPane}><SearchScreen embed /></View>;
  };

  // ═══════════════════════════════════════════════════════
  // RENDER: Loading
  // ═══════════════════════════════════════════════════════
  if (loading) {
    return (
      <View style={[s.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={C.accent} />
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════
  // MAIN RETURN
  // ═══════════════════════════════════════════════════════
  return (
    <ScreenWrapper style={s.safeArea} edges={['left', 'right', 'bottom']}>
      <View style={s.dashboard}>
        {isDesktopWeb ? (
          <View style={s.webContent}>{renderWebContent()}</View>
        ) : (
          <ScrollView
            ref={scrollViewRef}
            contentContainerStyle={s.scrollContent}
          >
            {renderHeroMobile()}
            <View style={s.scrollPad}>
              {renderQuickActions()}
              <TourTarget id="section-shortcuts">
                {renderShortcutsSection()}
              </TourTarget>
              {renderRecentActivity()}
            </View>
            </ScrollView>
        )}

        {!isDesktopWeb && (
          <TourTarget
            id="nav-inventory-tab"
            style={{ position: 'absolute', bottom: 0, right: 0, width: '50%', height: 0 }}
          >
            <View />
          </TourTarget>
        )}
      </View>

      {/* ─── Profile Menu Modal ─── */}
      <Modal
        transparent visible={showProfileMenu} animationType="fade"
        onRequestClose={() => setShowProfileMenu(false)}
        statusBarTranslucent presentationStyle="overFullScreen"
      >
        <View style={s.menuOverlay} pointerEvents="box-none">
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowProfileMenu(false)} />
          <View style={s.profileMenu} onStartShouldSetResponder={() => true} pointerEvents="box-none">
            {canAdmin && (
              <TouchableOpacity style={s.menuItem} onPress={() => { setShowProfileMenu(false); setTimeout(() => router.push('/admin'), 100); }}>
                <MaterialIcons name="admin-panel-settings" size={18} color={C.sub} />
                <Text style={s.menuText}>Admin Console</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={s.menuItem} onPress={() => { setShowProfileMenu(false); setTimeout(() => router.push('/profile'), 100); }}>
              <MaterialIcons name="person" size={18} color={C.sub} />
              <Text style={s.menuText}>Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.menuItem} onPress={async () => { setShowProfileMenu(false); setTimeout(() => handleRestartTour(), 100); }}>
              <MaterialIcons name="replay" size={18} color={C.sub} />
              <Text style={s.menuText}>Restart Tour</Text>
            </TouchableOpacity>
            <View style={s.menuDivider} />
            <TouchableOpacity style={s.menuItem} onPress={() => { setShowProfileMenu(false); setTimeout(() => handleLogout(), 100); }}>
              <MaterialIcons name="logout" size={18} color={C.dangerFg} />
              <Text style={[s.menuText, { color: C.dangerFg }]}>Log Out</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </ScreenWrapper>
  );
};

Dashboard.propTypes = { isAdmin: PropTypes.bool };
Dashboard.defaultProps = { isAdmin: false };

// ═══════════════════════════════════════════════════════
// STYLES — Bold Industrial
// ═══════════════════════════════════════════════════════
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  safeArea: { flex: 1, backgroundColor: C.bg },
  dashboard: { flex: 1, backgroundColor: C.bg },
  scrollContent: { paddingBottom: 24 },
  scrollPad: { paddingHorizontal: 16, paddingTop: 16 },
  webContent: { flex: 1 },
  webPane: { flex: 1, minHeight: 0, overflow: 'auto' },

  // Hero
  hero: {
    backgroundColor: C.primary,
    paddingHorizontal: 16,
    paddingBottom: 13,
    borderBottomWidth: 3,
    borderBottomColor: C.accent,
    marginBottom: 16,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  heroGreeting: {
    fontSize: sf(11),
    fontWeight: '700',
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  heroTitle: {
    flex: 1,
    fontSize: sf(22),
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 1,
  },
  heroTitleGear: {
    color: '#FFFFFF',
  },
  heroTitleOps: {
    color: C.accent,
  },
  avatar: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: Radius.md,
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { color: '#fff', fontSize: sf(13), fontWeight: '900' },
  heroStub: { width: 36, height: 36 },

  // Quick Actions
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  actionCard: {
    flexBasis: '31%',
    backgroundColor: C.card,
    borderRadius: Radius.lg,
    paddingVertical: 18,
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderColor: C.line,
    ...Shadows.card,
  },
  actionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontSize: sf(11),
    fontWeight: '700',
    color: C.text,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    textAlign: 'center',
  },

  // Section headers
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionLabel: {
    fontSize: sf(11),
    fontWeight: '800',
    color: C.sub2,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 12,
  },

  // Shortcuts
  shortcutsSection: { marginBottom: 24 },
  shortcutsHeading: {
    fontSize: sf(18),
    fontWeight: '800',
    color: C.text,
    letterSpacing: -0.3,
  },
  // Mobile 3-column Bold Industrial grid
  shortcutGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  shortcutGridCard: {
    width: '30.5%',
    flexGrow: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderRadius: Radius.lg,
    borderWidth: 2,
    backgroundColor: C.card,
    borderColor: C.line,
  },
  shortcutGridIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shortcutGridLabel: {
    fontSize: sf(11),
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    textAlign: 'center',
    color: C.text,
  },
  // Recent Activity
  activitySection: { marginTop: 4, marginBottom: 16 },
  activityEmpty: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  activityEmptyText: { fontSize: sf(13), color: C.sub2, fontWeight: '500' },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    backgroundColor: C.card,
    borderWidth: 2,
    borderColor: C.line,
    borderRadius: Radius.md,
    borderLeftWidth: 4,
  },
  activityIcon: {
    width: 34,
    height: 34,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  activityTitle: { fontSize: sf(13), fontWeight: '700', color: C.text },
  activitySub: { fontSize: sf(11), color: C.sub2, marginTop: 1 },
  activityTime: {
    fontSize: sf(10),
    fontWeight: '700',
    color: C.sub2,
    textTransform: 'uppercase',
    flexShrink: 0,
  },

  // Profile Menu
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 70,
    paddingRight: 20,
    zIndex: 10001,
    elevation: 10001,
  },
  profileMenu: {
    backgroundColor: C.card,
    borderRadius: Radius.lg,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: C.line,
    minWidth: 200,
    ...Shadows.lg,
    zIndex: 10002,
    elevation: 10002,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: Radius.sm,
  },
  menuText: { fontSize: sf(14), fontWeight: '600', color: C.text },
  menuDivider: { height: 1, backgroundColor: C.line, marginVertical: 4, marginHorizontal: 8 },

  // Colour Picker
  cpOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  cpSheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
  },
  cpHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.line,
    marginBottom: 16,
  },
  cpTitle: { fontSize: sf(18), fontWeight: '900', color: C.text, textAlign: 'center', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  cpSub: { fontSize: sf(13), color: C.sub, textAlign: 'center', marginBottom: 20 },
  cpChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.md,
    borderWidth: 1.5,
  },
  cpChipLabel: { fontSize: sf(13), fontWeight: '700' },
  cpToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: Radius.md,
    borderWidth: 2,
    borderColor: C.line,
    backgroundColor: C.chip,
    marginBottom: 20,
  },
  cpToggleActive: { backgroundColor: C.accent, borderColor: C.accent },
  cpToggleText: { fontSize: sf(13), fontWeight: '700', color: C.accent },
  cpSwatchGrid: { flexDirection: 'row', justifyContent: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 28 },
  cpSwatch: {
    width: 60,
    height: 76,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    position: 'relative',
  },
  cpSwatchDot: { width: 24, height: 24, borderRadius: 12 },
  cpSwatchCheck: { position: 'absolute', top: 4, right: 4 },
  cpSwatchName: { fontSize: sf(9), fontWeight: '700', textAlign: 'center' },
  cpDoneBtn: {
    backgroundColor: C.primary,
    borderRadius: Radius.md,
    paddingVertical: 15,
    alignItems: 'center',
  },
  cpDoneBtnText: { color: '#fff', fontSize: sf(14), fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
});

export default Dashboard;
