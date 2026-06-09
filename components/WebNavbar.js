// components/WebNavbar.js — Responsive Navigation Bar
//
// Desktop  (>= 1024px) : full horizontal topbar with labels
// Tablet   (768-1023px): horizontal topbar, icons only (no text labels)
// Mobile   (< 768px)   : brand + hamburger → slide-in drawer
//
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Platform,
  TouchableOpacity,
  Modal,
  Animated,
  ScrollView,
  Pressable,
} from 'react-native';
import { Link, usePathname, useLocalSearchParams, useRouter } from 'expo-router';
import { auth } from '../firebaseConfig';
import { MaterialIcons } from '@expo/vector-icons';
import { API_BASE_URL } from '../inventory-api/apiBase';
import { TourTarget } from './TourGuide';
import { Colors, Radius, sf } from '../constants/uiTheme';
import { useTasksCount } from '../contexts/TasksCountContext';
import { useUserData } from '../contexts/UserDataContext';
import { useResponsive } from '../hooks/useResponsive';

const C = Colors;

// ─── Single nav item — topbar variant ────────────────────────────────────────
const NavItem = ({ href, label, icon, isActive, badge, showLabel = true }) => (
  <Link href={href} style={{ textDecoration: 'none' }}>
    <View style={[s.navItem, isActive && s.navItemActive]}>
      <MaterialIcons
        name={icon}
        size={showLabel ? 16 : 18}
        color={isActive ? '#FFFFFF' : 'rgba(255,255,255,0.85)'}
      />
      {showLabel && (
        <Text style={[s.navText, isActive && s.navTextActive]}>{label}</Text>
      )}
      {badge ? (
        <View style={s.badge}>
          <Text style={s.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </View>
  </Link>
);

// ─── Drawer row — mobile slide-in variant ────────────────────────────────────
const DrawerItem = ({ href, label, icon, isActive, badge, onPress }) => (
  <Link href={href} style={{ textDecoration: 'none' }} onPress={onPress}>
    <View style={[s.drawerItem, isActive && s.drawerItemActive]}>
      <MaterialIcons
        name={icon}
        size={20}
        color={isActive ? C.accent : 'rgba(255,255,255,0.85)'}
      />
      <Text style={[s.drawerText, isActive && s.drawerTextActive]}>{label}</Text>
      {badge ? (
        <View style={[s.badge, { marginLeft: 'auto' }]}>
          <Text style={s.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </View>
  </Link>
);

// ─── Main component ───────────────────────────────────────────────────────────
export default function WebNavbar() {
  const pathname           = usePathname();
  const { view: viewParam } = useLocalSearchParams();
  const { taskCount }      = useTasksCount();
  const { isMobile, isTablet } = useResponsive();
  const router             = useRouter();

  // Admin + user come from the shared UserDataContext so the navbar doesn't
  // re-fetch /users/<uid> on every mount.
  const { isAdmin, profile } = useUserData();
  const [user, setUser]               = useState(null);
  const [searchVersion, setSearchVersion] = useState(0);
  const [drawerOpen, setDrawerOpen]   = useState(false);

  // Drawer slide animation
  const slideAnim = useRef(new Animated.Value(-280)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;
  // Stop in-flight animations on unmount and guard the close callback so it
  // can't setState after the component is gone.
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
    try { slideAnim.stopAnimation(); overlayAnim.stopAnimation(); } catch { /* ignore */ }
  }, [slideAnim, overlayAnim]);

  const openDrawer = () => {
    setDrawerOpen(true);
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 12 }),
      Animated.timing(overlayAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  };

  const closeDrawer = (callback) => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: -280, duration: 220, useNativeDriver: true }),
      Animated.timing(overlayAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      if (!mountedRef.current) return;
      setDrawerOpen(false);
      if (callback) callback();
    });
  };

  // Auth state — admin flag + DB profile are owned by UserDataContext now,
  // so this effect only tracks the local user reference for null-checks.
  useEffect(() => {
    const unsub = auth.onAuthStateChanged((currentUser) => {
      setUser(currentUser);
    });
    return unsub;
  }, []);

  // Track URL search param changes (popstate / history.push)
  const view = useMemo(() => {
    const fromParams = (typeof viewParam === 'string' ? viewParam : Array.isArray(viewParam) ? viewParam[0] : '') || '';
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        const q = new URLSearchParams(window.location.search);
        return (q.get('view') || fromParams || '').toString();
      } catch { /* ignore */ }
    }
    return fromParams;
  }, [viewParam, pathname, searchVersion]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    const onPop = () => setSearchVersion((v) => v + 1);
    window.addEventListener('popstate', onPop);
    const push = history.pushState;
    const replace = history.replaceState;
    const wrap = (fn) => function () {
      const r = fn.apply(this, arguments);
      try { setSearchVersion((v) => v + 1); } catch { /* ignore */ }
      return r;
    };
    try { history.pushState = wrap(push); history.replaceState = wrap(replace); } catch { /* ignore */ }
    return () => {
      window.removeEventListener('popstate', onPop);
      try { history.pushState = push; history.replaceState = replace; } catch { /* ignore */ }
    };
  }, []);

  // Close drawer on route change
  useEffect(() => {
    if (drawerOpen) closeDrawer();
  }, [pathname, view]);

  if (Platform.OS !== 'web' || !user) return null;

  // Active state helpers
  const starts = (p) => (pathname ? pathname.startsWith(p) : false);
  const isPath = (...pres) => pres.some((p) => starts(p) || pathname === p);
  const onDashboard = isPath('/dashboard', '/(tabs)/dashboard') || pathname === '/';
  const onCertsPage = isPath('/certs');

  const active = {
    dashboard: onDashboard && (!view || view === 'dashboard' || view === 'search'),
    shortcuts: onDashboard && view === 'shortcuts',
    tasks:     onDashboard && view === 'tasks',
    certs:     onCertsPage || (onDashboard && view === 'certs'),
    hire:      onDashboard && view === 'hire',
    inventory: isPath('/inventory', '/Inventory', '/(tabs)/Inventory'),
    maps:      isPath('/maps', '/(tabs)/maps'),
    activity:  isPath('/activity'),
    admin:     isPath('/admin'),
    profile:   isPath('/profile'),
  };

  const taskBadge = taskCount > 0 ? (taskCount > 99 ? '99+' : String(taskCount)) : undefined;

  const handleLogout = async () => {
    closeDrawer(async () => {
      try {
        await auth.signOut();
        if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.href = '/';
      } catch { /* ignore */ }
    });
  };

  // ── Nav items config (shared by topbar and drawer) ──────────────────────────
  const navItems = [
    { id: 'dashboard', href: '/(tabs)/dashboard',          label: 'Dashboard', icon: 'dashboard',            isActive: active.dashboard },
    { id: 'inventory', href: '/(tabs)/Inventory',          label: 'Inventory', icon: 'inventory-2',          isActive: active.inventory },
    { id: 'tasks',     href: '/(tabs)/dashboard?view=tasks', label: 'Tasks',   icon: 'assignment',           isActive: active.tasks,    badge: taskBadge },
    { id: 'maps',      href: '/(tabs)/maps',               label: 'Maps',    icon: 'map',                    isActive: active.maps },
    { id: 'activity',  href: '/activity',                   label: 'Activity', icon: 'history',              isActive: active.activity },
    { id: 'certs',     href: '/certs',                      label: 'Certs',    icon: 'verified',             isActive: active.certs },
    // Hire is admin-only — only shown when the current user has admin privileges
    ...(isAdmin ? [{ id: 'hire', href: '/(tabs)/dashboard?view=hire', label: 'Hire', icon: 'local-shipping', isActive: active.hire }] : []),
  ];

  const rightItems = [
    ...(isAdmin ? [{ id: 'admin',   href: '/admin/users',   label: 'Admin',   icon: 'admin-panel-settings', isActive: active.admin }] : []),
    {             id: 'profile', href: '/profile', label: 'Profile', icon: 'person',               isActive: active.profile },
  ];

  // ── MOBILE — hamburger + slide-in drawer ────────────────────────────────────
  if (isMobile) {
    return (
      <>
        <TourTarget id="web-navbar">
          <View style={s.topbar}>
            {/* Brand */}
            <Text style={s.brand}>
              <Text style={s.brandAccent}>Gear</Text>Ops
            </Text>

            {/* Hamburger */}
            <TouchableOpacity
              style={s.hamburger}
              onPress={openDrawer}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialIcons name="menu" size={24} color="#FFFFFF" />
              {taskBadge && (
                <View style={s.hamburgerBadge}>
                  <Text style={s.hamburgerBadgeText}>{taskBadge}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </TourTarget>

        {/* Drawer Modal */}
        <Modal
          visible={drawerOpen}
          transparent
          animationType="none"
          onRequestClose={() => closeDrawer()}
          statusBarTranslucent
        >
          {/* Overlay */}
          <Animated.View style={[s.drawerOverlay, { opacity: overlayAnim }]}>
            <Pressable style={{ flex: 1 }} onPress={() => closeDrawer()} />
          </Animated.View>

          {/* Drawer panel */}
          <Animated.View style={[s.drawer, { transform: [{ translateX: slideAnim }] }]}>
            {/* Drawer header */}
            <View style={s.drawerHeader}>
              <Text style={s.drawerBrand}>
                <Text style={s.brandAccent}>Gear</Text>Ops
              </Text>
              <TouchableOpacity onPress={() => closeDrawer()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MaterialIcons name="close" size={22} color="rgba(255,255,255,0.7)" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {/* Main nav */}
              <View style={s.drawerSection}>
                {navItems.map((item) => (
                  <DrawerItem key={item.id} {...item} onPress={() => closeDrawer()} />
                ))}
              </View>

              {/* Divider */}
              <View style={s.drawerDivider} />

              {/* Right nav (admin, profile) */}
              <View style={s.drawerSection}>
                {rightItems.map((item) => (
                  <DrawerItem key={item.id} {...item} onPress={() => closeDrawer()} />
                ))}
              </View>

              {/* Logout */}
              <View style={[s.drawerSection, { paddingBottom: 32 }]}>
                <TouchableOpacity style={s.drawerLogout} onPress={handleLogout}>
                  <MaterialIcons name="logout" size={20} color="rgba(255,255,255,0.6)" />
                  <Text style={s.drawerLogoutText}>LOG OUT</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </Animated.View>
        </Modal>
      </>
    );
  }

  // ── TABLET — icons only, no labels ──────────────────────────────────────────
  // ── DESKTOP — full labels ────────────────────────────────────────────────────
  const showLabel = !isTablet;

  return (
    <TourTarget id="web-navbar">
      <View style={s.topbar}>
        {/* Brand */}
        <View style={[s.brandWrap, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
          <Image
            source={require('../assets/images/gearops-logo.png')}
            style={{ width: 28, height: 28, borderRadius: 7 }}
            resizeMode="contain"
          />
          <Text style={s.brand}>
            <Text style={s.brandAccent}>Gear</Text>Ops
          </Text>
        </View>

        {/* Primary Navigation */}
        <View style={s.navSection}>
          {navItems.map((item) => (
            <NavItem key={item.id} {...item} showLabel={showLabel} />
          ))}
        </View>

        {/* Right section */}
        <View style={s.rightSection}>
          {rightItems.map((item) => (
            <NavItem key={item.id} {...item} showLabel={showLabel} />
          ))}

          <View style={s.divider} />

          <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
            <MaterialIcons name="logout" size={14} color="rgba(255,255,255,0.7)" />
            {showLabel && <Text style={s.logoutText}>LOG OUT</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </TourTarget>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  // ── Topbar (tablet + desktop) ───────────────────────────────────────────────
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.primary,
    paddingHorizontal: 16,
    height: 52,
    borderBottomWidth: 2,
    borderBottomColor: C.accent,
  },
  brandWrap: { marginRight: 20 },
  brand: {
    fontSize: sf(16),
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.3,
    textTransform: 'uppercase',
  },
  brandAccent: { color: C.accent },

  navSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flex: 1,
    flexWrap: 'nowrap',
    overflow: 'hidden',
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 9,
    borderRadius: Radius.sm,
  },
  navItemActive: { backgroundColor: C.accent },
  navText: {
    fontSize: sf(12),
    fontWeight: '700',
    color: 'rgba(255,255,255,0.85)',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    whiteSpace: 'nowrap',
  },
  navTextActive: { color: '#FFFFFF', fontWeight: '800' },
  badge: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: Radius.sm,
    marginLeft: 2,
  },
  badgeText: { fontSize: sf(9), fontWeight: '800', color: '#FFFFFF' },

  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: 'auto',
  },
  divider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginHorizontal: 8,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 9,
    borderRadius: Radius.sm,
  },
  logoutText: {
    fontSize: sf(11),
    fontWeight: '800',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 0.5,
  },

  // ── Hamburger (mobile) ──────────────────────────────────────────────────────
  hamburger: {
    marginLeft: 'auto',
    padding: 8,
    position: 'relative',
  },
  hamburgerBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: C.accent,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  hamburgerBadgeText: { fontSize: 9, fontWeight: '800', color: '#FFFFFF' },

  // ── Drawer (mobile) ─────────────────────────────────────────────────────────
  drawerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  drawer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: 268,
    backgroundColor: C.primary,
    borderRightWidth: 2,
    borderRightColor: C.accent,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 24,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    height: 52,
  },
  drawerBrand: {
    fontSize: sf(16),
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.3,
    textTransform: 'uppercase',
  },
  drawerSection: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  drawerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: Radius.md,
    marginBottom: 2,
  },
  drawerItemActive: {
    backgroundColor: 'rgba(234,88,12,0.18)',
    borderLeftWidth: 3,
    borderLeftColor: C.accent,
  },
  drawerText: {
    fontSize: sf(13),
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 0.2,
  },
  drawerTextActive: {
    color: C.accent,
    fontWeight: '800',
  },
  drawerDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginHorizontal: 20,
    marginVertical: 4,
  },
  drawerLogout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: Radius.md,
    marginTop: 4,
  },
  drawerLogoutText: {
    fontSize: sf(13),
    fontWeight: '700',
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
