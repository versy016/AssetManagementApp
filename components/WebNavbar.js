// components/WebNavbar.js
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Platform, TouchableOpacity } from 'react-native';
import { Link, usePathname, useLocalSearchParams } from 'expo-router';
import { auth } from '../firebaseConfig';
import { useTheme } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { API_BASE_URL } from '../inventory-api/apiBase';
// Theme options for navbar (keep only Golden Amber for consistency)
const THEME_OPTIONS = [
  {
    id: 'golden',
    name: 'Golden Amber',
    colors: {
      primary: '#F59E0B',
      primaryDark: '#D97706',
      primaryLight: '#FEF3C7',
      border: '#FBBF24',
      text: '#D97706',
      background: '#FFFFFF',
    },
  },
];
const NavLink = ({ href, label, isActive, theme }) => (
  <Link href={href} style={{ textDecoration: 'none' }}>
    <View style={[
      styles.navItem,
      isActive && {
        backgroundColor: '#FEF3C7',
        borderWidth: 1,
        borderColor: '#FBBF24',
      }
    ]}>
      <Text style={[
        styles.navText,
        { color: isActive ? '#D97706' : '#64748B' }
      ]}>
        {label}
      </Text>
    </View>
  </Link>
);

export default function WebNavbar() {
  const pathname = usePathname();
  const { view: viewParam } = useLocalSearchParams();
  const [isAdmin, setIsAdmin] = useState(false);
  const [user, setUser] = useState(null);
  const [searchVersion, setSearchVersion] = useState(0);
  const theme = useTheme();
  const selectedTheme = THEME_OPTIONS[0];

  // Subscribe to auth and read custom claims + DB role to determine admin visibility
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (currentUser) => {
      try {
        setUser(currentUser);
        if (!currentUser) {
          setIsAdmin(false);
          return;
        }
        // Check Firebase custom claims
        await currentUser.getIdToken(true);
        const tr = await currentUser.getIdTokenResult();
        const role = String(tr?.claims?.role || '').toUpperCase();
        const adminClaim = !!tr?.claims?.admin || role === 'ADMIN';
        
        // Also check database role for more reliable admin check
        let dbAdmin = false;
        try {
          const res = await fetch(`${API_BASE_URL}/users/${currentUser.uid}`);
          if (res.ok) {
            const dbUser = await res.json();
            dbAdmin = String(dbUser?.role || '').toUpperCase() === 'ADMIN';
          }
        } catch (e) {
          console.warn('Failed to check DB role:', e);
        }
        
        setIsAdmin(!!adminClaim || dbAdmin);
      } catch {
        setIsAdmin(false);
        setUser(null);
      }
    });
    return unsub;
  }, []);

  // Resolve `view` consistently on web by also reading window.location.search
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

  // Force re-compute on client-side navigation that only changes search params
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    const onPop = () => setSearchVersion((v) => v + 1);
    window.addEventListener('popstate', onPop);
    const push = history.pushState;
    const replace = history.replaceState;
    const wrap = (fn) => function () { const r = fn.apply(this, arguments); try { setSearchVersion((v) => v + 1); } catch { } return r; };
    try {
      history.pushState = wrap(push);
      history.replaceState = wrap(replace);
    } catch { }
    return () => {
      window.removeEventListener('popstate', onPop);
      try { history.pushState = push; history.replaceState = replace; } catch { }
    };
  }, []);
  if (Platform.OS !== 'web' || !user) {
    return null;
  }
  const starts = (p) => (pathname ? pathname.startsWith(p) : false);
  const isPath = (...pres) => pres.some((p) => starts(p) || pathname === p);
  // Dashboard when path starts with dashboard routes OR exactly root '/'
  const onDashboard = isPath('/dashboard', '/(tabs)/dashboard') || pathname === '/';
  const onCertsPage = isPath('/certs');
  const active = {
    dashboard: onDashboard && (!view || view === 'dashboard' || view === 'search'),
    shortcuts: onDashboard && view === 'shortcuts',
    tasks: onDashboard && view === 'tasks',
    certs: onCertsPage || (onDashboard && view === 'certs'),
    inventory: isPath('/inventory', '/Inventory', '/(tabs)/Inventory'),
    activity: isPath('/activity'),
    admin: isPath('/admin'),
    profile: isPath('/profile'),
  };

  const handleLogout = async () => {
    try {
      await auth.signOut();
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.location.href = '/';
      }
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <View style={[styles.wrap, { borderBottomColor: selectedTheme.colors.border, backgroundColor: selectedTheme.colors.background, shadowColor: selectedTheme.colors.primary }]}>
      <View style={styles.brandWrap}>
        <Text style={[styles.brand, { color: theme.colors.primary }]}>Asset Manager</Text>
      </View>
      <View style={styles.navCenter}>
        <NavLink href="/(tabs)/dashboard" label="Dashboard" isActive={active.dashboard} theme={theme} />
        <NavLink href="/(tabs)/dashboard?view=shortcuts" label="Shortcuts" isActive={active.shortcuts} theme={theme} />
        <NavLink href="/(tabs)/dashboard?view=tasks" label="My Tasks" isActive={active.tasks} theme={theme} />
        <NavLink href="/activity" label="Activity" isActive={active.activity} theme={theme} />
        <NavLink href="/certs" label="Certs" isActive={active.certs} theme={theme} />
        <NavLink href="/(tabs)/Inventory" label="Inventory" isActive={active.inventory} theme={theme} />
        {isAdmin ? (<NavLink href="/admin" label="Admin Controls" isActive={active.admin} theme={theme} />) : null}
      </View>
      <View style={styles.navRight}>
        <NavLink href="/profile" label="Profile" isActive={active.profile} theme={theme} />
        <TouchableOpacity
          onPress={handleLogout}
          style={[styles.logoutButton, { borderColor: selectedTheme.colors.border }]}
        >
          <Feather name="log-out" size={16} color={selectedTheme.colors.text} />
          <Text style={[styles.logoutText, { color: selectedTheme.colors.text }]}>Logout</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 3,
    borderBottomColor: '#FBBF24',
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    shadowColor: '#F59E0B',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  brandWrap: { paddingRight: 8 },
  brand: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0B63CE',
  },
  navCenter: { flex: 1, flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  navRight: { flexDirection: 'row', gap: 8, marginLeft: 'auto', alignItems: 'center' },
  navItem: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    transition: 'all 0.2s ease',
  },
  navText: { fontWeight: '700', fontSize: 14 },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
  logoutText: {
    fontWeight: '700',
    fontSize: 14,
    color: '#D97706',
  },
  themeSwitcher: { flexDirection: 'row', gap: 8, marginRight: 8 },
  themeButton: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 4, borderWidth: 1 },
  themeButtonText: { color: '#FFFFFF', fontSize: 12 },
});
