// app/admin/settings.js — Admin-editable app settings.
// Currently: the Maintenance Due lead time (how many days before an asset's next
// service date it auto-flags as Maintenance Due).
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { auth } from '../../firebaseConfig';
import { onAuthStateChanged } from 'firebase/auth';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import { getAuthHeaders } from '../../utils/authHeaders';
import { Colors, Radius, sf } from '../../constants/uiTheme';
import ScreenHeader from '../../components/ui/ScreenHeader';

export default function AdminSettings() {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [leadDays, setLeadDays] = useState('28');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE_URL}/settings`, { headers });
      if (res.ok) {
        const data = await res.json();
        const v = data?.settings?.maintenance_due_lead_days;
        if (v != null) setLeadDays(String(v));
      }
    } catch { /* keep default */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { setIsAdmin(false); setLoading(false); return; }
      try {
        const res = await fetch(`${API_BASE_URL}/users/${u.uid}`);
        const dbUser = res.ok ? await res.json() : null;
        const admin = String(dbUser?.role || '').toUpperCase() === 'ADMIN';
        setIsAdmin(admin);
        if (admin) await load(); else setLoading(false);
      } catch { setIsAdmin(false); setLoading(false); }
    });
    return unsub;
  }, [load]);

  const save = async () => {
    const n = Number(leadDays);
    if (!Number.isFinite(n) || n < 0 || n > 365) {
      Alert.alert('Invalid value', 'Enter a number of days between 0 and 365.');
      return;
    }
    setSaving(true);
    try {
      const headers = { 'Content-Type': 'application/json', ...(await getAuthHeaders()) };
      const res = await fetch(`${API_BASE_URL}/settings/maintenance_due_lead_days`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ value: String(Math.round(n)) }),
      });
      if (!res.ok) throw new Error((await res.text()) || 'Failed to save');
      const msg = 'Settings saved.';
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.alert(msg); else Alert.alert('Saved', msg);
    } catch (e) {
      Alert.alert('Error', e?.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <View style={s.center}><ActivityIndicator color={Colors.primary} /></View>;
  }
  if (!isAdmin) {
    return (
      <View style={s.center}>
        <MaterialIcons name="lock" size={40} color={Colors.sub2} />
        <Text style={s.lockText}>Admin access required.</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScreenHeader title="Settings" backLabel="Admin" />
      <View style={s.body}>
        <View style={s.card}>
          <Text style={s.cardTitle}>Maintenance Due lead time</Text>
          <Text style={s.cardSub}>
            How many days before an asset's next service date it is automatically
            flagged as <Text style={{ fontWeight: '800' }}>Maintenance due</Text>. Default is 28 (4 weeks).
          </Text>
          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              value={leadDays}
              onChangeText={(t) => setLeadDays(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              maxLength={3}
            />
            <Text style={s.suffix}>days</Text>
          </View>
          <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveText}>Save</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10, backgroundColor: Colors.bg },
  lockText: { fontSize: sf(16), color: Colors.text, fontWeight: '700' },
  body: { padding: 16 },
  card: { backgroundColor: Colors.card, borderRadius: Radius.lg, borderWidth: 2, borderColor: Colors.line, padding: 18, gap: 10, maxWidth: 520, width: '100%', alignSelf: 'center' },
  cardTitle: { fontSize: sf(16), fontWeight: '900', color: Colors.text },
  cardSub: { fontSize: sf(13), color: Colors.sub, lineHeight: sf(19) },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  input: { borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: sf(16), fontWeight: '800', color: Colors.text, backgroundColor: Colors.bg, width: 110, textAlign: 'center' },
  suffix: { fontSize: sf(15), fontWeight: '700', color: Colors.sub },
  saveBtn: { marginTop: 8, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#fff', fontWeight: '900', fontSize: sf(15) },
});
