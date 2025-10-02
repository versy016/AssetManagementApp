// dashboard.js - Main dashboard screen for authenticated users

import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { auth } from '../../firebaseConfig';
import { useRouter } from 'expo-router';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import PropTypes from 'prop-types';
import { API_BASE_URL } from '../../inventory-api/apiBase';

const Dashboard = ({ isAdmin }) => {
  const router = useRouter();
  const [shortcuts, setShortcuts] = useState([]);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [adminClaim, setAdminClaim] = useState(false); // <-- derived from Firebase custom claims
  const [summary, setSummary] = useState({ total: 0, in_service: 0, repair: 0, maintenance: 0, end_of_life: 0 });
  const [recent, setRecent] = useState({ items: [], loading: true });
  const SHOW_RECENT = false;

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

  const canAdmin = isAdmin || adminClaim; // allow prop override if you still pass it

  // Build quick numeric stats for the hero cards
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/assets`);
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        const norm = (s) => {
          if (!s) return 'in_service';
          const key = String(s).toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
          const map = { available: 'in_service', reserved: 'in_service', in_use: 'in_service', lost: 'end_of_life', retired: 'end_of_life' };
          return map[key] || key;
        };
        const agg = { total: list.length, in_service: 0, repair: 0, maintenance: 0, end_of_life: 0 };
        for (const a of list) { const k = norm(a?.status); if (k in agg) agg[k] += 1; }
        if (!cancelled) setSummary(agg);
      } catch {
        if (!cancelled) setSummary({ total: 0, in_service: 0, repair: 0, maintenance: 0, end_of_life: 0 });
      }
    })();
    return () => { cancelled = true; };
  }, []);

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

  const iconForType = (t) => {
    switch (String(t || '').toUpperCase()) {
      case 'REPAIR': return 'build';
      case 'MAINTENANCE': return 'build-circle';
      case 'END_OF_LIFE': return 'block';
      case 'CHECK_IN': return 'assignment-turned-in';
      case 'CHECK_OUT': return 'assignment-return';
      case 'TRANSFER': return 'swap-horiz';
      case 'STATUS_CHANGE': return 'sync';
      case 'HIRE': return 'work-outline';
      case 'LOST': return 'help-outline';
      case 'STOLEN': return 'report';
      default: return 'event-note';
    }
  };

  const prettyWhen = (iso) => {
    try {
      const d = new Date(iso);
      if (Number.isNaN(+d)) return '';
      return d.toISOString().slice(0, 16).replace('T', ' ');
    } catch { return ''; }
  };

  const addShortcut = () => {
    if (shortcuts.length < 4) {
      setShortcuts([...shortcuts, `Shortcut ${shortcuts.length + 1}`]);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      router.replace('/(auth)/login');
    } catch (error) {
      Alert.alert('Logout Error', error.message);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color="#1E90FF" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.dashboard}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Hero */}
          <View style={styles.hero}>
            <View style={styles.heroTopRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroTitle}>Welcome, {user?.displayName || user?.email?.split('@')[0] || 'User'} 👋</Text>
                <Text style={styles.heroSub}>Your one place for assets and actions</Text>
              </View>
              <TouchableOpacity onPress={() => setShowProfileMenu(!showProfileMenu)}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {(user?.displayName || user?.email || 'US').substring(0, 2).toUpperCase()}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
            {showProfileMenu && (
              <View style={styles.profileMenu}>
                {canAdmin && (
                  <TouchableOpacity style={styles.menuItem} onPress={() => { setShowProfileMenu(false); router.push('/admin'); }}>
                    <Text style={styles.menuText}>Admin Console</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.menuItem} onPress={() => { setShowProfileMenu(false); router.push('/profile'); }}>
                  <Text style={styles.menuText}>Profile</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.menuItem, styles.menuItemLast]} onPress={handleLogout}>
                  <Text style={[styles.menuText, styles.logoutText]}>Logout</Text>
                </TouchableOpacity>
              </View>
            )}
            <View style={styles.statsRow}>
              <View style={styles.statCard}><MaterialIcons name="inventory-2" size={18} color="#fff" /><Text style={styles.statValue}>{summary.total}</Text><Text style={styles.statLabel}>Total</Text></View>
              <View style={styles.statCard}><MaterialIcons name="build-circle" size={18} color="#fff" /><Text style={styles.statValue}>{summary.in_service}</Text><Text style={styles.statLabel}>In Service</Text></View>
              <View style={styles.statCard}><MaterialIcons name="build" size={18} color="#fff" /><Text style={styles.statValue}>{summary.repair}</Text><Text style={styles.statLabel}>Repair</Text></View>
              <View style={styles.statCard}><MaterialIcons name="build" size={18} color="#fff" /><Text style={styles.statValue}>{summary.maintenance}</Text><Text style={styles.statLabel}>Maintenance</Text></View>
            </View>
          </View>

          {/* (removed duplicate profile dropdown; single instance lives in hero) */}

          {/* Quick actions */}
          <View style={styles.quickRow}>
            <TouchableOpacity style={styles.quickCard} onPress={() => router.push('/qr-scanner')}>
              <MaterialIcons name="qr-code-scanner" size={22} color="#2563EB" />
              <Text style={styles.quickText}>Scan</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickCard} onPress={() => router.push('/qr-scanner?mode=multi')}>
              <MaterialIcons name="sync-alt" size={20} color="#2563EB" />
              <Text style={styles.quickText}>Multi-Scan</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickCard} onPress={() => router.push('/search')}>
              <MaterialIcons name="search" size={20} color="#2563EB" />
              <Text style={styles.quickText}>Search</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickCard} onPress={() => router.push('/asset/assets')}>
              <MaterialIcons name="inventory" size={20} color="#2563EB" />
              <Text style={styles.quickText}>My Assets</Text>
            </TouchableOpacity>
            {canAdmin ? (
              <TouchableOpacity style={styles.quickCard} onPress={() => router.push('/admin')}>
                <MaterialIcons name="qr-code-2" size={20} color="#2563EB" />
                <Text style={styles.quickText}>Generate QR</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Shortcuts */}
          <View style={styles.shortcutsSection}>
            <Text style={styles.sectionTitle}>SHORTCUTS</Text>
            <View style={styles.shortcutsGrid}>
              {shortcuts.map((shortcut, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.shortcutCard}
                  onPress={() => Alert.alert('Shortcut', `Pressed ${shortcut}`)}
                >
                  <Text style={styles.shortcutText}>{shortcut}</Text>
                </TouchableOpacity>
              ))}
              {shortcuts.length < 4 && (
                <TouchableOpacity style={[styles.shortcutCard, styles.addShortcutCard]} onPress={addShortcut}>
                  <MaterialIcons name="add" size={36} color="#1E90FF" />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Recent Activity (hidden for now) */}
          {SHOW_RECENT && (
            <View style={styles.recentSection}>
              <Text style={styles.sectionTitle}>Recent Activity</Text>
              {recent.loading ? (
                <ActivityIndicator color="#2563EB" />
              ) : recent.items.length === 0 ? (
                <Text style={{ color: '#666' }}>No recent actions.</Text>
              ) : (
                recent.items.map((it, idx) => (
                  <View key={`${it.asset?.id}-${idx}`} style={styles.recentRow}>
                    <View style={styles.recentIconWrap}>
                      <MaterialIcons name={iconForType(it.action?.type)} size={18} color="#2563EB" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.recentTitle} numberOfLines={1}>
                        {it.action?.type?.replace(/_/g, ' ')} · {it.asset?.name || it.asset?.model || it.asset?.id}
                      </Text>
                      <Text style={styles.recentSub} numberOfLines={2}>
                        {it.action?.details?.summary || it.action?.note || '—'}
                      </Text>
                    </View>
                    <Text style={styles.recentWhen}>{prettyWhen(it.action?.occurred_at)}</Text>
                  </View>
                ))
              )}
            </View>
          )}

          {/* To Do */}
          <View style={styles.toDoList}>
            <Text style={styles.sectionTitle}>TO DO LIST</Text>
            <View style={styles.toDoCard}>
              <Text style={styles.toDoTitle}>Assigned To Me (1)</Text>
              <Text style={styles.toDoText}>Complete equipment survey</Text>
              <TouchableOpacity style={styles.toDoButton} onPress={() => router.push('/(app)/tasks')}>
                <Text style={styles.toDoButtonText}>Open</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
};

Dashboard.propTypes = {
  isAdmin: PropTypes.bool,
};

Dashboard.defaultProps = {
  isAdmin: false,
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F7FAFF' },
  dashboard: { flex: 1, backgroundColor: '#F7FAFF' },
  scrollContent: { padding: 16, paddingBottom: 40 },
  loadingContainer: { justifyContent: 'center', alignItems: 'center', flex: 1 },
  hero: { backgroundColor: '#0B63CE', padding: 16, borderRadius: 16, marginBottom: 14 },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  heroTitle: { fontSize: 20, fontWeight: '900', color: '#fff' },
  heroSub: { color: '#D6E8FF', marginTop: 2 },
  avatar: {
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 25, width: 46, height: 46, justifyContent: 'center', alignItems: 'center', elevation: 2,
  },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  profileMenu: {
    backgroundColor: '#fff', position: 'absolute', top: 70, right: 20, borderRadius: 8,
    paddingVertical: 8, paddingHorizontal: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 4, elevation: 5, zIndex: 10, minWidth: 180,
  },
  menuItem: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  menuItemLast: { borderBottomWidth: 0 },
  menuText: { fontSize: 16, color: '#333' },
  logoutText: { color: '#ff4444' },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'flex-start', gap: 4 },
  statValue: { fontSize: 18, fontWeight: '900', color: '#fff' },
  statLabel: { color: '#E7F3FF', fontWeight: '700', fontSize: 12 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8, marginBottom: 18 },
  quickCard: { flexBasis: '48%', backgroundColor: '#fff', borderRadius: 12, paddingVertical: 16, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#E9F1FF', shadowColor: '#0B63CE', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  quickText: { color: '#2563EB', fontWeight: '800' },
  recentSection: { marginTop: 6, marginBottom: 16 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EFF4FF' },
  recentIconWrap: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#EEF5FF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#DDEBFF' },
  recentTitle: { color: '#111', fontWeight: '800' },
  recentSub: { color: '#666', fontSize: 12, marginTop: 2 },
  recentWhen: { color: '#888', fontSize: 11, marginLeft: 8 },
  shortcutsSection: { marginBottom: 25 },
  sectionTitle: { fontSize: 14, fontWeight: '900', color: '#666', marginBottom: 12, letterSpacing: 0.5 },
  shortcutsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  shortcutCard: {
    backgroundColor: '#fff', padding: 18, borderRadius: 12, width: '48%', alignItems: 'center', justifyContent: 'center',
    marginBottom: 15, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2, height: 100,
  },
  addShortcutCard: { borderWidth: 1, borderColor: '#1E90FF', borderStyle: 'dashed', backgroundColor: 'transparent' },
  shortcutText: { color: '#333', fontSize: 15 },
  toDoList: { marginTop: 10 },
  toDoCard: { backgroundColor: '#fff', padding: 20, borderRadius: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  toDoTitle: { fontSize: 17, fontWeight: '600', color: '#333', marginBottom: 8 },
  toDoText: { color: '#666', marginBottom: 15, fontSize: 15 },
  toDoButton: { backgroundColor: '#1E90FF', paddingVertical: 8, paddingHorizontal: 20, borderRadius: 6, alignSelf: 'flex-start' },
  toDoButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});

export default Dashboard;
