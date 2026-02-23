// dashboard.js - Main dashboard screen for authenticated users

import React, { useState, useEffect, useContext, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, FlatList, Animated, Dimensions, Modal, Platform, Image, useWindowDimensions } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { BlurView } from 'expo-blur';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { auth } from '../../firebaseConfig';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import PropTypes from 'prop-types';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import SearchScreen from '../search';
import InventoryScreen from './Inventory';
import TasksScreen from './tasks';
import CertsView from '../../components/CertsView';
import ErrorBoundary from '../../components/ErrorBoundary';
import { useTheme } from 'react-native-paper';
import ScreenWrapper from '../../components/ui/ScreenWrapper';
import AddShortcutModal from '../../components/AddShortcutModal';
import { getShortcutType } from '../../constants/ShortcutTypes';
import ShortcutManager from '../../utils/ShortcutManager';
import { executeShortcut } from '../../utils/ShortcutExecutor';
import { TourTarget, TourContext, shouldShowTour, resetTour } from '../../components/TourGuide';
import AsyncStorage from '@react-native-async-storage/async-storage';

const Dashboard = ({ isAdmin }) => {
  const router = useRouter();
  const theme = useTheme();
  const [shortcuts, setShortcuts] = useState([]);
  const [shortcutModalVisible, setShortcutModalVisible] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [adminClaim, setAdminClaim] = useState(false); // <-- derived from Firebase custom claims
  const [dbAdmin, setDbAdmin] = useState(false);
  // Removed: numeric overview cards
  const [recent, setRecent] = useState({ items: [], loading: true });
  const { width: windowWidth } = useWindowDimensions();
  const SHOW_RECENT = true;
  const isDesktopWeb = Platform.OS === 'web' && ((windowWidth || Dimensions.get('window')?.width || 0) >= 1024);
  const isIos = Platform.OS === 'ios';

  const { view: viewParam } = useLocalSearchParams();
  const [mobileView, setMobileView] = useState('dashboard');
  const webViewKey = String(viewParam || '').toLowerCase() || 'dashboard';

  // Auth state + fetch custom claims (admin)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      try {
        if (!currentUser) {
          router.replace('/(auth)/login');
          setUser(null);
          setAdminClaim(false);
        } else {
          setUser(currentUser);
          // refresh token to get latest custom claims
          await currentUser.getIdToken(true);
          const tokenResult = await currentUser.getIdTokenResult();
          setAdminClaim(!!tokenResult?.claims?.admin);
        }
      } catch (err) {
        console.error('Auth/claims error:', err);
      } finally {
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      setDbAdmin(false);
      return;
    }
    let ignore = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/users/${user.uid}`);
        if (!res.ok) throw new Error('Failed to load user');
        const data = await res.json();
        if (!ignore) {
          const role = String(data?.role || '').toUpperCase();
          setDbAdmin(role === 'ADMIN');
        }
      } catch {
        if (!ignore) setDbAdmin(false);
      }
    })();
    return () => { ignore = true; };
  }, [user?.uid]);

  const canAdmin = isAdmin || adminClaim || dbAdmin; // allow prop override if you still pass it

  // Tour management
  const { startTour, finishTour, setDisabled: setTourDisabled, ensureVisible, currentStep } = useContext(TourContext);
  const [tourStarted, setTourStarted] = useState(false);
  const scrollViewRef = useRef(null);
  const shortcutsRef = useRef(null);

  // Temporarily disable tour when profile menu is open
  useEffect(() => {
    if (showProfileMenu) {
      // Immediately finish any active tour and disable it
      if (finishTour) {
        finishTour();
      }
      if (setTourDisabled) {
        setTourDisabled(true);
      }
    } else {
      // Re-enable tour when menu closes
      if (setTourDisabled) {
        setTourDisabled(false);
      }
    }
  }, [showProfileMenu, finishTour, setTourDisabled]);

  const handleRestartTour = async () => {
    setShowProfileMenu(false);
    await resetTour();
    setTourStarted(false);
    setTimeout(() => {
      startTour();
      setTourStarted(true);
    }, 300);
  };

  // Auto-scroll to shortcuts section when tour step is active
  const measureAndScroll = (ref) => {
    if (!ref || !scrollViewRef.current) return;

    try {
      // Measure the section to get its absolute page coordinates
      ref.measure((x, y, width, height, pageX, pageY) => {
        // Measure the ScrollView to get its absolute page coordinates
        scrollViewRef.current.measure((sx, sy, sw, sh, spx, spy) => {
          // Calculate relative Y position within the ScrollView
          const relativeY = pageY - spy;
          console.log(`Measured shortcuts: pageY=${pageY}, scrollViewPageY=${spy}, relativeY=${relativeY}`);

          if (relativeY >= 0) {
            const scrollY = Math.max(0, relativeY - 100);
            scrollViewRef.current?.scrollTo({ y: scrollY, animated: true });
          }
        });
      });
    } catch (e) {
      console.error(`Error measuring shortcuts:`, e);
      // Fallback: try scrollToEnd for bottom sections
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }
  };

  useEffect(() => {
    if (currentStep && currentStep.targetId === 'section-shortcuts') {
      // Small delay to ensure layout is complete
      setTimeout(() => {
        if (shortcutsRef.current) {
          measureAndScroll(shortcutsRef.current);
        }
      }, 100);
    }
  }, [currentStep]);

  // Register ScrollView with TourContext
  useEffect(() => {
    if (ensureVisible && scrollViewRef.current) {
      ensureVisible(scrollViewRef.current);
    }
  }, [ensureVisible]);

  // Auto-start tour disabled - users can start it manually via "Restart Tour" in profile menu
  // useEffect(() => {
  //   // Don't start tour if profile menu is open or tour already started
  //   if (!user?.uid || loading || tourStarted || showProfileMenu) return;
  //   (async () => {
  //     const shouldShow = await shouldShowTour();
  //     if (shouldShow) {
  //       // Small delay to ensure UI is rendered
  //       setTimeout(() => {
  //         startTour();
  //         setTourStarted(true);
  //       }, 1000);
  //     }
  //   })();
  // }, [user, loading, tourStarted, showProfileMenu, startTour]);

  // Removed: numeric overview fetch

  // Recent activity (best-effort, lightweight aggregation)
  useEffect(() => {
    if (!SHOW_RECENT) return;
    let cancelled = false;
    (async () => {
      try {
        setRecent((r) => ({ ...r, loading: true }));
        const res = await fetch(`${API_BASE_URL}/assets`);
        const data = await res.json();
        const list = (Array.isArray(data) ? data : [])
          .filter(a => (a?.description || '').toLowerCase() !== 'qr reserved asset');
        // Sort by updated/last_updated desc and take first 25
        const sorted = list.sort((a, b) => {
          const av = new Date(a?.updated_at || a?.last_updated || a?.date_purchased || 0).getTime();
          const bv = new Date(b?.updated_at || b?.last_updated || b?.date_purchased || 0).getTime();
          return bv - av;
        }).slice(0, 25);

        const actionsBatches = await Promise.allSettled(
          sorted.map(async (a) => {
            const r = await fetch(`${API_BASE_URL}/assets/${a.id}/actions`);
            if (!r.ok) return null;
            const j = await r.json();
            const arr = Array.isArray(j?.actions) ? j.actions : [];
            const first = arr[0];
            if (!first) return null;
            return { asset: a, action: first };
          })
        );

        const merged = actionsBatches
          .map(x => (x.status === 'fulfilled' ? x.value : null))
          .filter(Boolean)
          .sort((a, b) => new Date(b.action?.occurred_at || 0) - new Date(a.action?.occurred_at || 0))
          .slice(0, 10);

        if (!cancelled) setRecent({ items: merged, loading: false });
      } catch {
        if (!cancelled) setRecent({ items: [], loading: false });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load shortcuts from AsyncStorage
  useEffect(() => {
    if (!user?.uid) return;
    (async () => {
      const loaded = await ShortcutManager.loadShortcuts(user.uid, canAdmin);
      setShortcuts(loaded);
    })();
  }, [user?.uid, canAdmin]);

  const handleAddShortcut = async (shortcutType) => {
    if (!user?.uid) return;
    const success = await ShortcutManager.addShortcut(user.uid, shortcutType, canAdmin);
    if (success) {
      const updated = await ShortcutManager.loadShortcuts(user.uid, canAdmin);
      setShortcuts(updated);
    } else {
      Alert.alert('Error', 'Could not add shortcut. You may have reached the maximum limit.');
    }
  };

  const handleRemoveShortcut = async (shortcutId) => {
    if (!user?.uid) return;
    Alert.alert(
      'Remove Shortcut',
      'Are you sure you want to remove this shortcut?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const success = await ShortcutManager.removeShortcut(user.uid, shortcutId);
            if (success) {
              const updated = await ShortcutManager.loadShortcuts(user.uid, canAdmin);
              setShortcuts(updated);
            }
          },
        },
      ]
    );
  };

  const handleExecuteShortcut = (shortcutType) => {
    if (!user) {
      Alert.alert('Error', 'You must be logged in to use shortcuts');
      return;
    }
    executeShortcut(shortcutType, router, user);
  };

  const quickActions = React.useMemo(() => {
    const goToSearch = () => router.push('/search');
    const goToCerts = () => router.push('/certs');
    const base = [
      { key: 'scan', label: 'Scan Asset', icon: 'qr-code-scanner', subtitle: 'Open camera scanner', onPress: () => router.push('/qr-scanner') },
      { key: 'multi', label: 'Multi-Scan', icon: 'sync-alt', subtitle: 'Batch check-in / out', onPress: () => router.push('/qr-scanner?mode=multi') },
      { key: 'search', label: 'Search', icon: 'search', subtitle: 'Find any asset fast', onPress: () => router.push('/search') },
      { key: 'assets', label: 'My Assets', icon: 'inventory', subtitle: 'Everything assigned to you', onPress: () => router.push('/asset/assets') },
      { key: 'activity', label: 'Activity', icon: 'history', subtitle: 'Recent asset activity', onPress: () => router.push('/activity') },
      { key: 'certs', label: 'Certs', icon: 'verified', subtitle: 'View certifications', onPress: () => router.push('/certs') },
    ];
    return base;
  }, [canAdmin, router]);

  // Web-only nav is now provided by the global WebNavbar component.

  const handleLogout = async () => {
    try {
      await signOut(auth);
      router.replace('/(auth)/login');
    } catch (error) {
      Alert.alert('Logout Error', error.message);
    }
  };

  const userName = user?.displayName || user?.email?.split('@')[0] || 'User';
  const userInitials = (user?.displayName || user?.email || 'US').substring(0, 2).toUpperCase();

  const renderShortcutsSection = () => {
    const canAddMore = ShortcutManager.canAddMoreShortcuts(shortcuts);

    return (
      <View ref={shortcutsRef} style={styles.shortcutsSection}>
        <View style={styles.shortcutsHeaderRow}>
          <Text style={styles.sectionTitle}>Shortcuts</Text>
          <TouchableOpacity
            style={styles.manageShortcutsBtn}
            onPress={() => setShortcutModalVisible(true)}
          >
            <MaterialIcons name="tune" size={16} color="#1D4ED8" />
            <Text style={styles.manageShortcutsBtnText}>
              {shortcuts.length ? 'Manage' : 'Add shortcuts'}
            </Text>
          </TouchableOpacity>
        </View>
        {shortcuts.length === 0 ? (
          <TouchableOpacity
            style={styles.shortcutsEmptyCard}
            onPress={() => setShortcutModalVisible(true)}
          >
            <MaterialIcons name="add-circle-outline" size={32} color="#1D4ED8" />
            <Text style={styles.shortcutsEmptyTitle}>Add your first shortcut</Text>
            <Text style={styles.shortcutsEmptySubtitle}>Scan, transfer and more actions in one tap</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.shortcutsGrid}>
            {shortcuts.map((shortcut) => {
              const shortcutType = getShortcutType(shortcut.type);
              if (!shortcutType) return null;

              return (
                <TouchableOpacity
                  key={shortcut.id}
                  style={[
                    styles.shortcutCard,
                    { backgroundColor: shortcutType.bgColor }
                  ]}
                  onPress={() => handleExecuteShortcut(shortcut.type)}
                  onLongPress={() => handleRemoveShortcut(shortcut.id)}
                >
                  <MaterialIcons
                    name={shortcutType.icon}
                    size={20}
                    color={shortcutType.color}
                  />
                  <Text
                    style={[styles.shortcutText, { color: shortcutType.color }]}
                    numberOfLines={1}
                  >
                    {shortcutType.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {canAddMore && (
              <TouchableOpacity
                style={[styles.shortcutCard, styles.addShortcutCard]}
                onPress={() => setShortcutModalVisible(true)}
              >
                <MaterialIcons name="add" size={24} color="#1E90FF" />
                <Text style={styles.shortcutAddText}>Add shortcut</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    );
  };

  const renderHeroMobile = () => (
    <View style={styles.hero}>
      <View style={styles.heroTopRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.heroTitle}>Hi {userName},</Text>
          <Text style={styles.heroSub}>
            {isIos ? 'Quick actions for your assets.' : "Here's what needs your attention today."}
          </Text>
        </View>
        <TouchableOpacity onPress={() => setShowProfileMenu(!showProfileMenu)}>
          <TourTarget id="profile-btn">
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{userInitials}</Text>
            </View>
          </TourTarget>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderWebContent = () => {
    const key = webViewKey;
    if (!key || key === 'dashboard' || key === 'search') {
      return (
        <View style={styles.webPane}>
          <SearchScreen embed />
        </View>
      );
    }
    if (key === 'certs') {
      return (
        <View style={styles.webPane}>
          <ErrorBoundary>
            <CertsView visible />
          </ErrorBoundary>
        </View>
      );
    }
    if (key === 'inventory') {
      return (
        <View style={styles.webPane}>
          <InventoryScreen />
        </View>
      );
    }
    if (key === 'shortcuts') {
      return (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <TourTarget id="section-shortcuts">
            {renderShortcutsSection()}
          </TourTarget>
        </ScrollView>
      );
    }
    if (key === 'tasks') {
      return (
        <View style={styles.webPane}>
          <TasksScreen />
        </View>
      );
    }
    return (
      <View style={styles.webPane}>
        <SearchScreen embed />
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color="#1E90FF" />
      </View>
    );
  }

  return (
    <ScreenWrapper style={styles.safeArea}>
      <View style={styles.dashboard}>
        {isDesktopWeb ? (
          <View style={styles.webContent}>{renderWebContent()}</View>
        ) : (
          <ScrollView
            ref={scrollViewRef}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: 120 }]}
          >
            {renderHeroMobile()}
            <View style={styles.quickRow}>
              {quickActions.map((action) => (
                <TourTarget key={action.key} id={`qa-${action.key}`} style={{ flexBasis: '48%' }}>
                  <TouchableOpacity
                    style={[styles.quickCard, { flexBasis: undefined, width: '100%' }]}
                    onPress={action.onPress}
                  >
                    <MaterialIcons name={action.icon} size={20} color="#2563EB" />
                    <Text style={styles.quickText}>{action.label}</Text>
                  </TouchableOpacity>
                </TourTarget>
              ))}
            </View>
            <TourTarget id="section-shortcuts">
              {renderShortcutsSection()}
            </TourTarget>
          </ScrollView>
        )}

        {/* Tour Target for Inventory Tab (Invisible) */}
        {!isDesktopWeb && (
          <TourTarget
            id="nav-inventory-tab"
            style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: '50%',
              height: 0 // Zero height, we'll expand the highlight in TourGuide
            }}
          >
            <View />
          </TourTarget>
        )}
      </View>

      <Modal
        transparent
        visible={showProfileMenu}
        animationType="fade"
        onRequestClose={() => setShowProfileMenu(false)}
        statusBarTranslucent
        presentationStyle="overFullScreen"
      >
        <View style={styles.menuOverlay} pointerEvents="box-none">
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowProfileMenu(false)}
          />
          <View
            style={styles.profileMenuFixed}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            pointerEvents="box-none"
          >
            {canAdmin && (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setShowProfileMenu(false);
                  setTimeout(() => router.push('/admin'), 100);
                }}
              >
                <Text style={styles.menuText}>Admin Console</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setShowProfileMenu(false);
                setTimeout(() => router.push('/profile'), 100);
              }}
            >
              <Text style={styles.menuText}>Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={async () => {
                setShowProfileMenu(false);
                setTimeout(async () => {
                  await handleRestartTour();
                }, 100);
              }}
            >
              <Text style={styles.menuText}>Restart Tour</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.menuItem, styles.menuItemLast]}
              onPress={() => {
                setShowProfileMenu(false);
                setTimeout(() => handleLogout(), 100);
              }}
            >
              <Text style={[styles.menuText, styles.logoutText]}>Logout</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Task action modal moved to (tabs)/tasks.js */}

      {/* Add Shortcut Modal */}
      <AddShortcutModal
        visible={shortcutModalVisible}
        onClose={() => setShortcutModalVisible(false)}
        onAddShortcut={handleAddShortcut}
        onRemoveShortcut={handleRemoveShortcut}
        existingShortcuts={shortcuts}
        isAdmin={canAdmin}
      />
    </ScreenWrapper>
  );
};

Dashboard.propTypes = {
  isAdmin: PropTypes.bool,
};

Dashboard.defaultProps = {
  isAdmin: false,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7FAFF' },
  safeArea: { flex: 1, backgroundColor: '#F7FAFF' },
  dashboard: { flex: 1, backgroundColor: '#F7FAFF' },
  scrollContent: { padding: 16, paddingBottom: 40 },
  loadingContainer: { justifyContent: 'center', alignItems: 'center', flex: 1 },
  hero: {
    backgroundColor: '#0B63CE',
    padding: 16,
    borderRadius: 16,
    marginBottom: 14,
    shadowColor: '#F59E0B',
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
    borderBottomWidth: 3,
    borderBottomColor: '#FBBF24',
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  heroTitle: { fontSize: 22, fontWeight: '900', color: '#fff' },
  heroSub: { color: '#D6E8FF', marginTop: 2, fontSize: 13 },
  heroStatsRow: { flexDirection: 'row', marginTop: 6, gap: 10 },
  heroStatCard: {
    flex: 1,
    backgroundColor: 'rgba(251,191,36,0.15)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.3)',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(191,219,254,0.45)',
  },
  heroStatValue: { fontSize: 18, fontWeight: '800', color: '#FFFFFF' },
  heroStatLabel: { fontSize: 11, fontWeight: '600', color: '#E0ECFF', marginTop: 2, textTransform: 'uppercase' },
  avatar: {
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 25, width: 46, height: 46, justifyContent: 'center', alignItems: 'center', elevation: 2,
  },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  profileMenu: { display: 'none' },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 70,
    paddingRight: 20,
    zIndex: 10001,
    elevation: 10001,
  },
  menuBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  profileMenuFixed: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 10002,
    minWidth: 180,
    borderWidth: 1,
    borderColor: '#E9F1FF',
    zIndex: 10002,
  },
  menuItem: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  menuItemLast: { borderBottomWidth: 0 },
  menuText: { fontSize: 16, color: '#333' },
  logoutText: { color: '#ff4444' },
  overdueBadgeText: { color: '#B91C1C', fontWeight: '800', marginLeft: 6 },
  reminderBadge: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#DBEAFE', borderWidth: 1, borderColor: '#BFDBFE',
    borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8,
  },
  reminderBadgeText: { color: '#1D4ED8', fontWeight: '800', marginLeft: 6 },
  neutralBadge: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8,
  },
  neutralBadgeText: { color: '#374151', fontWeight: '800', marginLeft: 6 },
  taskModalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    width: '92%',
    maxWidth: 520,
    borderWidth: 1,
    borderColor: '#E9F1FF'
  },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8, marginBottom: 18 },
  quickCard: { flexBasis: '48%', backgroundColor: '#fff', borderRadius: 12, paddingVertical: 16, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#E9F1FF', shadowColor: '#0B63CE', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  quickText: { color: '#2563EB', fontWeight: '800' },
  webContent: { flex: 1 },
  webPane: { flex: 1, minHeight: 0, overflow: 'auto' },
  recentSection: { marginTop: 6, marginBottom: 16 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EFF4FF' },
  recentIconWrap: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#EEF5FF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#DDEBFF' },
  recentTitle: { color: '#111', fontWeight: '800' },
  recentSub: { color: '#666', fontSize: 12, marginTop: 2 },
  recentWhen: { color: '#888', fontSize: 11, marginLeft: 8 },
  shortcutsSection: { marginTop: 16, marginBottom: 20 },
  shortcutsHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '900', color: '#D97706', marginBottom: 12, letterSpacing: 0.5 },
  errorText: { color: '#B91C1C', marginTop: 8 },
  emptyText: { color: '#6B7280', marginTop: 8 },
  shortcutsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  shortcutCard: {
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 12,
    width: '48%',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
    minHeight: 86,
    gap: 6,
  },
  addShortcutCard: { borderWidth: 1, borderColor: '#1E90FF', borderStyle: 'dashed', backgroundColor: 'transparent' },
  shortcutText: { color: '#111827', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  shortcutAddText: { marginTop: 2, fontSize: 12, color: '#1D4ED8', fontWeight: '600' },
  manageShortcutsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#DBEAFE',
    backgroundColor: '#F8FAFF',
  },
  manageShortcutsBtnText: { fontSize: 12, color: '#1D4ED8', fontWeight: '700' },
  shortcutsEmptyCard: {
    borderWidth: 1,
    borderColor: '#DBEAFE',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 24,
    alignItems: 'center',
    backgroundColor: '#F8FAFF',
    gap: 6,
  },
  shortcutsEmptyTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  shortcutsEmptySubtitle: { fontSize: 13, color: '#475569', textAlign: 'center' },
  toDoList: { marginTop: 16 },
  toDoCard: { backgroundColor: '#fff', padding: 20, borderRadius: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  tasksHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  tasksHeaderChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    gap: 6,
  },
  tasksHeaderChipText: { fontSize: 12, fontWeight: '700', color: '#1D4ED8' },
  taskSummaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 18 },
  taskSummaryCard: {
    flexGrow: 1,
    flexBasis: '48%',
    minWidth: 140,
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  taskSummaryIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskSummaryValue: { fontSize: 20, fontWeight: '800', color: '#0F172A' },
  taskSummaryLabel: { fontSize: 12, fontWeight: '600', color: '#475569' },
  toDoTitle: { fontSize: 17, fontWeight: '600', color: '#333', marginBottom: 8 },
  toDoText: { color: '#666', marginBottom: 15, fontSize: 15 },
  toDoButton: { backgroundColor: '#1E90FF', paddingVertical: 8, paddingHorizontal: 20, borderRadius: 6, alignSelf: 'flex-start' },
  taskPrimaryButton: { borderRadius: 999, paddingHorizontal: 22 },
  toDoButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  btnPrimary: { backgroundColor: '#2563EB' },
  btnGhost: { borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFF' },
  overdueBadge: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FEE2E2', borderWidth: 1, borderColor: '#FCA5A5',
    borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8,
  },
  taskCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: Platform.OS === 'web' ? 22 : 14,
    paddingHorizontal: Platform.OS === 'web' ? 20 : 14,
    borderWidth: 1,
    borderColor: '#E5EDFF',
    shadowColor: '#1D4ED8',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
    ...(Platform.OS === 'web' ? { minHeight: 210 } : null),
  },
  taskCardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 10 },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    gap: 6,
  },
  statusChipText: { fontSize: 12, fontWeight: '700' },
  duePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#F3F4F6',
    gap: 6,
  },
  duePillText: { fontSize: 12, fontWeight: '600', color: '#111827' },
  taskMainRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  taskHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  taskAssetThumb: { width: 56, height: 56, borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF' },
  taskAssetThumbPlaceholder: { width: 56, height: 56, borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#EEF5FF', justifyContent: 'center', alignItems: 'center' },
  taskAssetTitle: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  taskTitle: { fontSize: 14, fontWeight: '600', color: '#1D4ED8', marginTop: 2 },
  taskMetaRow: { marginTop: 6, gap: 4 },
  taskMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  taskMetaText: { fontSize: 12, color: '#6B7280' },
  taskFooterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, gap: 12 },
  taskTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  smallTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    gap: 4,
  },
  smallTagOverdue: { backgroundColor: '#FEE2E2' },
  smallTagReminder: { backgroundColor: '#DBEAFE' },
  smallTagSignoff: { backgroundColor: '#E0E7FF' },
  smallTagText: { fontSize: 11, fontWeight: '600', color: '#111827' },
  smallTagMaintenance: { backgroundColor: '#CCFBF1' },
  emptyStateCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    gap: 10,
  },
  emptyStateIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyStateTitle: { fontSize: 16, fontWeight: '800', color: '#111827' },
  emptyStateSubtitle: { fontSize: 13, color: '#6B7280', textAlign: 'center', marginHorizontal: 10 },
  emptyStateActionsRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  emptyStateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  emptyStateButtonPrimary: { backgroundColor: '#1D4ED8' },
  emptyStateButtonGhost: { backgroundColor: '#EFF6FF' },
  emptyStateButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  emptyStateButtonGhostText: { color: '#1D4ED8', fontWeight: '700', fontSize: 13 },
  emptyStateHint: { marginTop: 6, fontSize: 11, color: '#9CA3AF', textAlign: 'center' },
  taskFiltersRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 4,
    marginBottom: 6,
    marginTop: 2,
    display: Platform.OS === 'web' ? 'flex' : 'none',
  },
  taskFilterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingVertical: 3,
    paddingHorizontal: 8,
    backgroundColor: '#FFFFFF',
  },
  taskFilterChipSelected: {
    backgroundColor: '#1D4ED8',
    borderColor: '#1D4ED8',
  },
  taskFilterChipEmpty: {
    opacity: 0.45,
  },
  taskFilterChipText: { fontSize: 11, fontWeight: '600', color: '#4B5563' },
  taskFilterChipTextSelected: { color: '#FFFFFF' },
  tasksTimelineSection: { marginTop: 10 },
  tasksTimelineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4 },
  tasksTimelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
    backgroundColor: '#2563EB',
  },
  tasksTimelineTitle: { fontSize: 13, fontWeight: '600', color: '#111827' },
  tasksTimelineSub: { fontSize: 11, color: '#6B7280' },

  quickDateRow: { flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 4 },
  quickDateChip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#F9FAFB' },
  quickDateChipText: { color: '#2563EB', fontWeight: '800' },
});

export default Dashboard;
