// app/admin/qr.js — Generate QR / Excel sheets (admin only)
import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Linking, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { auth } from '../../firebaseConfig';
import { onAuthStateChanged } from 'firebase/auth';
import { MaterialIcons } from '@expo/vector-icons';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import { TourTarget } from '../../components/TourGuide';
import { Colors, Radius, Shadows, sf } from '../../constants/uiTheme';
import logger from '../../utils/logger';

export default function AdminQrSheets() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [working, setWorking] = useState(false);

  const [qrCount, setQrCount] = useState('100');
  const MAX_QR_COUNT = 2000;
  const [excelFile, setExcelFile] = useState(null);
  const [allSheets, setAllSheets] = useState([]);

  const authHeader = async () => {
    const u = auth.currentUser;
    if (!u) throw new Error('No current user');
    const token = await u.getIdToken();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-User-Id': u.uid,
    };
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      try {
        if (!u) {
          router.replace('/login');
          return;
        }
        const res = await fetch(`${API_BASE_URL}/users/${u.uid}`);
        const dbUser = res.ok ? await res.json() : null;
        setIsAdmin(dbUser?.role === 'ADMIN');
      } catch (e) {
        logger.error(e);
        Alert.alert('Error', 'Failed to verify admin privileges.');
      } finally {
        setLoading(false);
      }
    });
    return unsub;
  }, [router]);

  const refreshSheets = async () => {
    const url = `${API_BASE_URL}/users/qr/sheets`;
    try {
      const res = await fetch(url);
      const raw = await res.text();
      const data = JSON.parse(raw);
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setAllSheets(data?.sheets || []);
    } catch (e) {
      logger.warn('[AdminQr] refreshSheets error:', e?.message || e);
    }
  };

  useEffect(() => {
    if (isAdmin) refreshSheets();
  }, [isAdmin]);

  const generateQRCodes = async () => {
    const count = Number(qrCount);
    if (!Number.isFinite(count) || count < 1 || count > MAX_QR_COUNT) {
      return Alert.alert('Validation', `Number of QR codes must be between 1 and ${MAX_QR_COUNT}.`);
    }
    setWorking(true);
    try {
      const headers = await authHeader();
      const excelRes = await fetch(`${API_BASE_URL}/users/qr/generate-excel`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ count }),
      });
      const excel = await excelRes.json();
      if (!excelRes.ok) throw new Error(excel?.error || 'Failed to generate Excel file');
      setExcelFile(excel?.file || null);
      await refreshSheets();
      Alert.alert('Success', `Generated ${count} QR codes in Excel file.`);
    } catch (e) {
      logger.error('[AdminQr] generateQRCodes → Error:', e);
      Alert.alert('Error', e.message || 'Failed to generate Excel file');
    } finally {
      setWorking(false);
    }
  };

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
        <MaterialIcons name="lock" size={40} color={Colors.sub2} />
        <Text style={{ marginTop: 10, fontSize: sf(16), color: Colors.text }}>Admin access required.</Text>
        <TouchableOpacity onPress={() => router.replace('/')} style={[styles.button, { marginTop: 16 }]}>
          <Text style={styles.buttonText}>Go Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const qrCountNum = Number(qrCount) || 0;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.wrapper}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topbar}>
          {Platform.OS !== 'web' && (
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <MaterialIcons name="arrow-back" size={24} color={Colors.primary} />
            </TouchableOpacity>
          )}
          <Text style={styles.topbarTitle}>QR code sheets</Text>
          {Platform.OS !== 'web' && <View style={{ width: 24 }} />}
        </View>

        <View style={styles.subNav}>
          <TouchableOpacity onPress={() => router.push('/admin/users')} style={styles.subNavBtn}>
            <MaterialIcons name="group" size={18} color={Colors.primary} />
            <Text style={styles.subNavBtnText}>User management</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <TourTarget id="web-admin-qr-tab">
            <Text style={styles.screenHint}>
              Create Excel sheets of new asset IDs and QR codes for printing labels.
            </Text>
          </TourTarget>

          <Text style={styles.label}>Number of QR Codes (1–{MAX_QR_COUNT})</Text>
            <TextInput
              value={qrCount}
              onChangeText={setQrCount}
              keyboardType={Platform.OS === 'web' ? 'numeric' : 'number-pad'}
              placeholder="e.g. 100"
              style={styles.input}
              maxLength={4}
            />
            <Text style={{ marginTop: 6, color: Colors.sub }}>
              Will generate: <Text style={{ fontWeight: '700' }}>{qrCountNum || 0}</Text> QR codes
            </Text>

            <TourTarget id="web-admin-qr-generate-btn">
              <TouchableOpacity onPress={generateQRCodes} disabled={working} style={[styles.button, { marginTop: 16, opacity: working ? 0.7 : 1 }]}>
                <Text style={styles.buttonText}>{working ? 'Generating…' : 'Generate Excel'}</Text>
              </TouchableOpacity>
            </TourTarget>

            {excelFile && (
              <View style={{ marginTop: 20 }}>
                <Text style={styles.subTitle}>Generated Excel File</Text>
                <TourTarget id="web-admin-qr-download-btn">
                  <View style={styles.qrRow}>
                    <Text style={{ fontSize: sf(14), color: Colors.text }}>{excelFile.name}</Text>
                    <TouchableOpacity onPress={() => Linking.openURL(excelFile.url)}>
                      <Text style={styles.link}>Download Excel</Text>
                    </TouchableOpacity>
                  </View>
                </TourTarget>
              </View>
            )}

            <View style={{ marginTop: 24 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.subTitle}>All Generated Files ({allSheets.length})</Text>
                <TouchableOpacity onPress={refreshSheets} disabled={working}>
                  <Text style={styles.link}>Refresh</Text>
                </TouchableOpacity>
              </View>
              {allSheets.length === 0 ? (
                <Text style={{ color: Colors.sub }}>No files found yet.</Text>
              ) : (
                allSheets.map((s, idx) => (
                  <View key={`${s.name}-${idx}`} style={styles.qrRow}>
                    <Text style={{ fontSize: sf(14), color: Colors.text }}>{s.name}</Text>
                    <TouchableOpacity onPress={() => Linking.openURL(s.url)}>
                      <Text style={styles.link}>{s.name.endsWith('.xlsx') ? 'Download Excel' : 'Download'}</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </View>
          </View>
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: Colors.bg },
  wrapper: { flex: 1, padding: 20, backgroundColor: Colors.bg },
  scrollContent: { paddingBottom: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  topbarTitle: { fontSize: sf(22), fontWeight: '900', textTransform: 'uppercase', color: Colors.text },
  backBtn: { padding: 6, marginRight: 6 },
  subNav: { marginBottom: 16 },
  subNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: Radius.md,
    borderWidth: 2,
    borderColor: Colors.line,
    backgroundColor: Colors.card,
  },
  subNavBtnText: { fontSize: sf(14), fontWeight: '700', color: Colors.primary },
  screenHint: { fontSize: sf(13), color: Colors.sub, marginBottom: 14, lineHeight: 20 },
  card: { backgroundColor: Colors.card, borderRadius: Radius.lg, padding: 16, borderWidth: 2, borderColor: Colors.line, ...Shadows.card },
  label: { fontSize: sf(13), color: Colors.text, fontWeight: '700', textTransform: 'uppercase', marginTop: 8, marginBottom: 6 },
  input: { borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.md, padding: 12, fontSize: sf(16), backgroundColor: Colors.card, color: Colors.text },
  button: { backgroundColor: Colors.primary, padding: 14, borderRadius: Radius.md, alignItems: 'center' },
  buttonText: { color: Colors.card, fontWeight: '700', fontSize: sf(16), textTransform: 'uppercase' },
  subTitle: { fontSize: sf(16), fontWeight: '900', textTransform: 'uppercase', marginBottom: 8, color: Colors.text },
  qrRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.line },
  link: { color: Colors.accent, fontWeight: '700' },
});
