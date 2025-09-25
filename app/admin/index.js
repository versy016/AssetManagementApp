// app/admin/index.js
import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, FlatList, Linking, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { auth } from '../../firebaseConfig';
import { onAuthStateChanged } from 'firebase/auth';
import { MaterialIcons } from '@expo/vector-icons';
import { API_BASE_URL } from '../../inventory-api/apiBase';

export default function AdminConsole() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  // UI state
  const [tab, setTab] = useState('roles'); // 'roles' | 'qr'
  const [targetEmail, setTargetEmail] = useState('');
  const [working, setWorking] = useState(false);

  // QR gen (sheet-based only)
  const [sheetCount, setSheetCount] = useState('1'); // 1–5 sheets
  const SHEET_SIZE = 65;
  const MAX_SHEETS = 5;
  const [qrResults, setQrResults] = useState([]);
  const [qrSheets, setQrSheets] = useState([]);
  const [allSheets, setAllSheets] = useState([]);
  const authHeader = async () => {
    const u = auth.currentUser;
    if (!u) throw new Error('No current user');
    const token = await u.getIdToken(true);
    console.log('[Admin] using idToken len=', token?.length);
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      // Help the dev server auth middleware when running locally
      'X-User-Id': u.uid,
    };
  };

  const resolveUserIdByEmail = async (email) => {
    const headers = await authHeader();
    const uidParam = currentUser?.uid ? `&uid=${encodeURIComponent(currentUser.uid)}` : '';
    const url = `${API_BASE_URL}/users/lookup/by-email?email=${encodeURIComponent(email)}${uidParam}`;
    const res = await fetch(url, { headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Lookup failed');
    return data.id; // Firebase UID stored as users.id
  };

  // Auth + admin check via DB role
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      try {
        if (!u) {
          router.replace('/login');
          return;
        }
        setCurrentUser(u);
        const res = await fetch(`${API_BASE_URL}/users/${u.uid}`);
        const dbUser = res.ok ? await res.json() : null;
        setIsAdmin(dbUser?.role === 'ADMIN');
      } catch (e) {
        console.error(e);
        Alert.alert('Error', 'Failed to verify admin privileges.');
      } finally {
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  const promote = async () => {
    if (!targetEmail.trim()) return Alert.alert('Validation', 'Enter an email');
    setWorking(true);
    try {
      const uid = await resolveUserIdByEmail(targetEmail.trim().toLowerCase());
      const headers = await authHeader();
      const uidParam = currentUser?.uid ? `?uid=${encodeURIComponent(currentUser.uid)}` : '';
      const res = await fetch(`${API_BASE_URL}/users/${uid}/promote${uidParam}`, { method: 'POST', headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to promote');
      Alert.alert('Success', 'User promoted to ADMIN.');
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setWorking(false);
    }
  };

  const demote = async () => {
    if (!targetEmail.trim()) return Alert.alert('Validation', 'Enter an email');
    setWorking(true);
    try {
      const uid = await resolveUserIdByEmail(targetEmail.trim().toLowerCase());
      const headers = await authHeader();
      const uidParam = currentUser?.uid ? `?uid=${encodeURIComponent(currentUser.uid)}` : '';
      const res = await fetch(`${API_BASE_URL}/users/${uid}/demote${uidParam}`, { method: 'POST', headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to demote');
      Alert.alert('Success', 'User demoted to USER.');
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setWorking(false);
    }
  };

  // 🎯 Generate by sheets: sheets × 65 (no prefix, no length, no format)
 const generateQRCodes = async () => {
  const sheets = Number(sheetCount);
  if (!Number.isFinite(sheets) || sheets < 1 || sheets > MAX_SHEETS) {
    return Alert.alert('Validation', `Sheets must be between 1 and ${MAX_SHEETS}.`);
  }
  const total = sheets * SHEET_SIZE;

  setWorking(true);
  try {
    const headers = await authHeader();
    const uidParam = currentUser?.uid ? `?uid=${encodeURIComponent(currentUser.uid)}` : '';
    const res = await fetch(`${API_BASE_URL}/users/qr/generate${uidParam}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ count: total }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Failed to generate QR codes');
    setQrResults(data?.codes || []);
    setQrSheets(data?.sheets || []);
    // Refresh persistent sheet list after generation
    await refreshSheets();
    Alert.alert(
      'Success',
      `Generated ${data?.codes?.length || 0} QR codes (${sheets} × ${SHEET_SIZE}).`
    );
  } catch (e) {
    Alert.alert('Error', e.message);
  } finally {
    setWorking(false);
  }
};

    // const refreshSheets = async () => {
    // const headers = await authHeader();
    // const uidParam = currentUser?.uid ? `?uid=${encodeURIComponent(currentUser.uid)}` : '';
  // const url = `${API_BASE_URL}/users/qr/sheets${uidParam}`;
    const refreshSheets = async () => {
    const url = `${API_BASE_URL}/users/qr/sheets`;
    const t0 = Date.now();
    try {
        console.log('[Admin] refreshSheets →', url);
        const res = await fetch(url); // public; no headers
        const raw = await res.text();
        console.log('[Admin] refreshSheets status', res.status, res.ok, 'in', Date.now() - t0, 'ms');
        console.log('[Admin] refreshSheets body (first 500):', raw.slice(0, 500));
        const data = JSON.parse(raw);
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        console.log('[Admin] refreshSheets parsed sheets:', data?.sheets?.length ?? 0);
        setAllSheets(data?.sheets || []);
      } catch (e) {
        console.warn('[Admin] refreshSheets error:', e?.message || e);
      }
    };

  useEffect(() => {
    if (isAdmin && currentUser) {
      refreshSheets();
    }
  }, [isAdmin, currentUser]);


  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Checking admin access…</Text>
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={styles.center}>
        <MaterialIcons name="lock" size={40} color="#999" />
        <Text style={{ marginTop: 10, fontSize: 16, color: '#333' }}>
          Admin access required.
        </Text>
        <TouchableOpacity onPress={() => router.replace('/')} style={[styles.button, { marginTop: 16 }]}>
          <Text style={styles.buttonText}>Go Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const sheetsNum = Number(sheetCount) || 0;
  const totalCodes = sheetsNum * SHEET_SIZE;

  return (
      <SafeAreaView style={styles.safe}>
        <ScrollView
          style={styles.wrapper}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.topbar}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <MaterialIcons name="arrow-back" size={24} color="#0B63CE" />
            </TouchableOpacity>
            <Text style={styles.topbarTitle}>Admin Console</Text>
            <View style={{ width: 24 }} />
          </View>
      {/* Segmented tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          onPress={() => setTab('roles')}
          style={[styles.tab, tab === 'roles' && styles.tabActive]}
        >
          <Text style={[styles.tabText, tab === 'roles' && styles.tabTextActive]}>Manage Roles</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setTab('qr')}
          style={[styles.tab, tab === 'qr' && styles.tabActive]}
        >
          <Text style={[styles.tabText, tab === 'qr' && styles.tabTextActive]}>Generate QR</Text>
        </TouchableOpacity>
      </View>

      {tab === 'roles' ? (
        <View style={styles.card}>
          <Text style={styles.label}>User Email</Text>
          <TextInput
            value={targetEmail}
            onChangeText={setTargetEmail}
            placeholder="Enter user email"
            autoCapitalize="none"
            keyboardType="email-address"
            style={styles.input}
          />

          <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
            <TouchableOpacity onPress={promote} disabled={working} style={[styles.button, { flex: 1, opacity: working ? 0.7 : 1 }]}>
              <Text style={styles.buttonText}>Promote to Admin</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={demote} disabled={working} style={[styles.buttonOutline, { flex: 1, opacity: working ? 0.7 : 1 }]}>
              <Text style={styles.buttonOutlineText}>Demote to User</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.helpText}>
            Tip: After changing a role, the user may need to sign out/in or refresh their token to see new access.
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.label}>How many sheets? (1–5)</Text>
          <TextInput
            value={sheetCount}
            onChangeText={setSheetCount}
            keyboardType={Platform.OS === 'web' ? 'numeric' : 'number-pad'}
            placeholder="e.g. 3"
            style={styles.input}
            maxLength={2}
          />

          {/* Live math display */}
          <Text style={{ marginTop: 6, color: '#555' }}>
            Total codes: <Text style={{ fontWeight: '700' }}>{sheetsNum || 0}</Text> × {SHEET_SIZE} = <Text style={{ fontWeight: '700' }}>{totalCodes || 0}</Text>
          </Text>

          <TouchableOpacity onPress={generateQRCodes} disabled={working} style={[styles.button, { marginTop: 16, opacity: working ? 0.7 : 1 }]}>
            <Text style={styles.buttonText}>{working ? 'Generating…' : 'Generate'}</Text>
          </TouchableOpacity>

          {qrResults?.length > 0 && (
            <View style={{ marginTop: 20 }}>
              <Text style={styles.subTitle}>Generated ({qrResults.length})</Text>
              <FlatList
                data={qrResults}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <View style={styles.qrRow}>
                    <Text style={styles.qrCode}>{item.id}</Text>
                    <TouchableOpacity onPress={() => Linking.openURL(item.url)}>
                      <Text style={styles.link}>Open</Text>
                    </TouchableOpacity>
                  </View>
                )}
                scrollEnabled={false}
                nestedScrollEnabled
                contentContainerStyle={{ paddingBottom: 8 }}
                  />
                  {qrSheets?.length > 0 && (
               <View style={{ marginTop: 16 }}>
                 <Text style={styles.subTitle}>Download Sheets (PDF, 65 per page)</Text>
                 {qrSheets.map((s, idx) => (
                   <View key={idx} style={styles.qrRow}>
                     <Text style={{ fontSize: 14, color: '#333' }}>Sheet {s.index}</Text>
                     <TouchableOpacity onPress={() => Linking.openURL(s.url)}>
                       <Text style={styles.link}>Download PDF</Text>
                     </TouchableOpacity>
                   </View>
                 ))}
               </View>
             )}
            </View>
            
          )}

          {/* Persistent: All Sheets */}
          <View style={{ marginTop: 24 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.subTitle}>All Sheets ({allSheets.length})</Text>
              <TouchableOpacity onPress={refreshSheets} disabled={working}>
                <Text style={styles.link}>Refresh</Text>
              </TouchableOpacity>
            </View>
            {allSheets.length === 0 ? (
              <Text style={{ color: '#666' }}>No sheets found yet.</Text>
            ) : (
              allSheets.map((s, idx) => (
                <View key={`${s.name}-${idx}`} style={styles.qrRow}>
                  <Text style={{ fontSize: 14, color: '#333' }}>{s.name}</Text>
                  <TouchableOpacity onPress={() => Linking.openURL(s.url)}>
                    <Text style={styles.link}>Download PDF</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>
        </View>
      )}
        </ScrollView>
      </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: '#fff' },
  wrapper: { flex: 1, padding: 20, backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: '800', marginBottom: 12 },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  tab: { flex: 1, paddingVertical: 10, borderWidth: 1, borderColor: '#ddd', borderRadius: 10, alignItems: 'center' },
  tabActive: { backgroundColor: '#0B63CE1A', borderColor: '#0B63CE' },
  tabText: { color: '#555', fontWeight: '700' },
  tabTextActive: { color: '#0B63CE' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#eee' },
  label: { fontSize: 13, color: '#444', marginTop: 8, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 16 },
  button: { backgroundColor: '#0B63CE', padding: 14, borderRadius: 10, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  buttonOutline: { borderWidth: 1, borderColor: '#0B63CE', padding: 14, borderRadius: 10, alignItems: 'center' },
  buttonOutlineText: { color: '#0B63CE', fontWeight: '700', fontSize: 16 },
  helpText: { color: '#666', marginTop: 10, fontSize: 12 },
  subTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  qrRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f2f2f2' },
  qrCode: { fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo', fontSize: 14, color: '#333' },
    link: { color: '#0B63CE', fontWeight: '700' },
   topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
   topbarTitle: { fontSize: 22, fontWeight: '800', color: '#111' },
   backBtn: { padding: 6, marginRight: 6 },
});
