// components/WebNavbar.js — Bold Industrial Top Navigation Bar (Web Desktop)
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Platform, TouchableOpacity } from 'react-native';
import { Link, usePathname, useLocalSearchParams } from 'expo-router';
import { auth } from '../firebaseConfig';
import { MaterialIcons } from '@expo/vector-icons';
import { API_BASE_URL } from '../inventory-api/apiBase';
import { TourTarget } from './TourGuide';
import { Colors, Radius, Shadows } from '../constants/uiTheme';

const C = Colors;

const NavItem = ({ href, label, icon, isActive, badge }) => (
  <Link href={href} style={{ textDecoration: 'none' }}>
    <View style={[s.navItem, isActive && s.navItemActive]}>
      <MaterialIcons name={icon} size={16} color={isActive ? '#FFFFFF' : 'rgba(255,255,255,0.85)'} />
      <Text style={[s.navText, isActive && s.navTextActive]}>{label}</Text>
      {badge ? (
        <View style={s.badge}>
          <Text style={s.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </View>
  </Link>
);

export default function WebNavbar() {
  const pathname = usePathname();
  const { view: viewParam } = useLocalSearchParams();
  const [isAdmin, setIsAdmin] = useState(false);
  const [user, setUser] = useState(null);
  const [searchVersion, setSearchVersion] = useState(0);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (currentUser) => {
      try {
        setUser(currentUser);
        if (!currentUser) { setIsAdmin(false); return; }
        await currentUser.getIdToken(true);
        const tr = await currentUser.getIdTokenResult();
        const role = String(tr?.claims?.role || '').toUpperCase();
        const adminClaim = !!tr?.claims?.admin || role === 'ADMIN';
        let dbAdmin = false;
        try {
          const res = await fetch(`${API_BASE_URL}/users/${currentUser.uid}`);
          if (res.ok) {
            const dbUser = await res.json();
            dbAdmin = String(dbUser?.role || '').toUpperCase() === 'ADMIN';
          }
        } catch (e) { console.warn('Failed to check DB role:', e); }
        setIsAdmin(!!adminClaim || dbAdmin);
      } catch { setIsAdmin(false); setUser(null); }
    });
    return unsub;
  }, []);

  const view = useMemo(() => {
    const fromParams = (typeof viewParam === 'string' ? viewParam : Array.isArray(viewParam) ? viewParam[0] : '') || '';
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        const q = new URLSearchParams(window.location.search);
        return (q.get('view') || fromParams || '').toString();
      } catch { }
    }
    return fromParams;
  }, [viewParam, pathname, searchVersion]);

  const preset = useMemo(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try { return new URLSearchParams(window.location.search).get('preset') || ''; } catch { }
    }
    return '';
  }, [pathname, searchVersion]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    const onPop = () => setSearchVersion((v) => v + 1);
    window.addEventListener('popstate', onPop);
    const push = history.pushState;
    const replace = history.replaceState;
    const wrap = (fn) => function () { const r = fn.apply(this, arguments); try { setSearchVersion((v) => v + 1); } catch { } return r; };
    try { history.pushState = wrap(push); history.replaceState = wrap(replace); } catch { }
    return () => {
      window.removeEventListener('popstate', onPop);
      try { history.pushState = push; history.replaceState = replace; } catch { }
    };
  }, []);

  if (Platform.OS !== 'web' || !user) return null;

  const starts = (p) => (pathname ? pathname.startsWith(p) : false);
  const isPath = (...pres) => pres.some((p) => starts(p) || pathname === p);
  const onDashboard = isPath('/dashboard', '/(tabs)/dashboard') || pathname === '/';
  const onCertsPage = isPath('/certs');

      const active = {
    dashboard: onDashboard && (!view || view === 'dashboard' || view === 'search'),
    shortcuts: onDashboard && view === 'shortcuts',
    tasks: onDashboard && view === 'tasks',
    certs: onCertsPage || (onDashboard && view === 'certs'),
    hire: onDashboard && view === 'hire',
    inventory: isPath('/inventory', '/Inventory', '/(tabs)/Inventory'),
    myAssets: isPath('/search') && preset === 'mine',
    activity: isPath('/activity'),
    admin: isPath('/admin'),
    profile: isPath('/profile'),
  };

  const handleLogout = async () => {
    try {
      await auth.signOut();
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.href = '/';
    } catch (error) { console.error('Logout error:', error); }
  };

  return (
    <TourTarget id="web-navbar">
      <View style={s.topbar}>
        {/* Brand */}
        <View style={s.brandWrap}>
          <Text style={s.brand}>
            <Text style={s.brandAccent}>Gear</Text>Ops
          </Text>
        </View>

        {/* Primary Navigation */}
        <View style={s.navSection}>
          <TourTarget id="web-nav-dashboard">
            <NavItem href="/(tabs)/dashboard" label="Dashboard" icon="dashboard" isActive={active.dashboard} />
          </TourTarget>
          <TourTarget id="nav-inventory-tab">
            <NavItem href="/(tabs)/Inventory" label="Inventory" icon="inventory-2" isActive={active.inventory} />
          </TourTarget>
          <TourTarget id="web-nav-tasks">
            <NavItem href="/(tabs)/dashboard?view=tasks" label="Tasks" icon="assignment" isActive={active.tasks} badge="3" />
          </TourTarget>
          <NavItem href="/search?preset=mine" label="My Assets" icon="inventory" isActive={active.myAssets} />
          <TourTarget id="web-nav-activity">
            <NavItem href="/activity" label="Activity" icon="history" isActive={active.activity} />
          </TourTarget>
          <TourTarget id="web-nav-certs">
            <NavItem href="/certs" label="Certs" icon="verified" isActive={active.certs} />
          </TourTarget>
          <TourTarget id="web-nav-hire">
            <NavItem href="/(tabs)/dashboard?view=hire" label="Hire" icon="local-shipping" isActive={active.hire} />
          </TourTarget>
        </View>

        {/* Right-side: Admin + Profile + Logout */}
        <View style={s.rightSection}>
          {isAdmin && (
            <TourTarget id="web-nav-admin">
              <NavItem href="/admin" label="Admin" icon="admin-panel-settings" isActive={active.admin} />
            </TourTarget>
          )}
          <TourTarget id="web-nav-profile">
            <NavItem href="/profile" label="Profile" icon="person" isActive={active.profile} />
          </TourTarget>

          <View style={s.divider} />

          <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
            <MaterialIcons name="logout" size={14} color="rgba(255,255,255,0.7)" />
            <Text style={s.logoutText}>LOG OUT</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TourTarget>
  );
}

const s = StyleSheet.create({
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.primary,
    paddingVertical: 0,
    paddingHorizontal: 16,
    height: 52,
    borderBottomWidth: 2,
    borderBottomColor: C.accent,
  },
  brandWrap: {
    marginRight: 24,
  },
  brand: {
    fontSize: 16,
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
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: Radius.sm,
  },
  navItemActive: {
    backgroundColor: C.accent,
  },
  navText: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.85)',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  navTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  badge: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: Radius.sm,
    marginLeft: 2,
  },
  badgeText: { fontSize: 9, fontWeight: '800', color: '#FFFFFF' },

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
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: Radius.sm,
  },
  logoutText: {
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 0.5,
  },
});
