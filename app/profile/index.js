// app/profile/index.js
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { onAuthStateChanged, updateProfile, sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../../firebaseConfig';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import { MaterialIcons } from '@expo/vector-icons';

export default function ProfileScreen() {
  const router = useRouter();

  const [fbUser, setFbUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('USER');

  // show reset only for email/password accounts
  const usesPasswordProvider = useMemo(() => {
    const providers = fbUser?.providerData?.map(p => p.providerId) || [];
    return providers.includes('password');
  }, [fbUser]);

  // Load Firebase user
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setFbUser(u || null);
    });
    return unsub;
  }, []);

  // Load DB profile + admin claim when fbUser is ready
  useEffect(() => {
    const load = async () => {
      if (!fbUser) {
        setLoading(false);
        return;
      }
      try {
        // Refresh token so new custom claims (e.g., admin) are visible
        await fbUser.getIdToken(true);
        const tokenResult = await fbUser.getIdTokenResult();
        const isAdminClaim = !!tokenResult?.claims?.admin;

        // Pull profile from your backend
        const res = await fetch(`${API_BASE_URL}/users/${fbUser.uid}`);
        if (!res.ok) throw new Error('Failed to fetch profile');
        const dbUser = await res.json();

        setName(dbUser?.name || fbUser.displayName || '');
        setEmail(dbUser?.useremail || fbUser.email || '');
        setRole(isAdminClaim ? 'ADMIN' : (dbUser?.role || 'USER'));
      } catch (e) {
        console.error(e);
        Alert.alert('Error', 'Could not load your profile.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [fbUser]);

  const onSave = async () => {
    if (!fbUser) return;
    if (!name?.trim()) {
      Alert.alert('Validation', 'Please enter your full name.');
      return;
    }
    setSaving(true);
    try {
      // Update Firebase displayName for consistency
      await updateProfile(fbUser, { displayName: name.trim() });
      

      // Update DB user record
      const res = await fetch(`${API_BASE_URL}/users/${fbUser.uid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) throw new Error('Failed to update profile');

      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (e) {
      console.error(e);
      Alert.alert('Error', e.message || 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  const onResetPassword = async () => {
    if (!email) return;
    try {
      await sendPasswordResetEmail(auth, email);
      Alert.alert('Email sent', 'Check your inbox for the reset link.');
    } catch (e) {
      Alert.alert('Error', e.message || 'Failed to send reset email.');
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Loading profile…</Text>
      </View>
    );
  }

  if (!fbUser) {
    return (
      <View style={styles.center}>
        <Text style={{ fontSize: 16, marginBottom: 12 }}>You’re not signed in.</Text>
        <TouchableOpacity onPress={() => router.replace('/(auth)/login')} style={styles.button}>
          <Text style={styles.buttonText}>Go to Login</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
      <View style={styles.topbar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <MaterialIcons name="arrow-back" size={24} color="#0B63CE" />
        </TouchableOpacity>
        <Text style={styles.topbarTitle}>My Profile</Text>
        <View style={{ width: 24 }} />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Full Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Your full name"
          style={styles.input}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Email</Text>
        <TextInput value={email} editable={false} style={[styles.input, styles.readonly]} />
        <Text style={styles.hint}>Email is managed by your account provider.</Text>
      </View>

      <View style={styles.badgeRow}>
        <Text style={styles.badgeLabel}>Role:</Text>
        <Text style={[styles.badge, role === 'ADMIN' ? styles.admin : styles.user]}>
          {role}
        </Text>
      </View>

      <TouchableOpacity onPress={onSave} disabled={saving} style={[styles.button, { opacity: saving ? 0.7 : 1 }]}>
        <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
      </TouchableOpacity>

      {usesPasswordProvider ? (
        <TouchableOpacity onPress={onResetPassword} style={[styles.buttonSecondary, { marginTop: 12 }]}>
          <Text style={styles.buttonSecondaryText}>Send Password Reset Email</Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.note}>
          Password reset isn’t available for {fbUser?.providerData?.[0]?.providerId} accounts.
        </Text>
      )}

      {role === 'ADMIN' && (
        <TouchableOpacity onPress={() => router.push('/admin')} style={[styles.buttonGhost, { marginTop: 24 }]}>
          <Text style={styles.buttonGhostText}>Admin Controls</Text>
        </TouchableOpacity>
      )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', padding: 20 },
  container: { flex: 1, padding: 20, backgroundColor: '#fff' },
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 16 },
  field: { marginBottom: 16 },
  label: { fontSize: 14, color: '#444', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 16 },
  readonly: { backgroundColor: '#f6f6f6' },
  hint: { fontSize: 12, color: '#777', marginTop: 6 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, marginBottom: 20, gap: 8 },
  badgeLabel: { fontSize: 14, color: '#555' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: 'hidden', fontWeight: '700' },
  admin: { backgroundColor: '#E7F3FF', color: '#0B63CE' },
  user: { backgroundColor: '#F5F5F5', color: '#444' },
  button: { backgroundColor: '#0B63CE', padding: 14, borderRadius: 10, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  buttonSecondary: { borderWidth: 1, borderColor: '#0B63CE', padding: 14, borderRadius: 10, alignItems: 'center' },
  buttonSecondaryText: { color: '#0B63CE', fontWeight: '700', fontSize: 16 },
  buttonGhost: { padding: 14, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: '#ddd' },
  buttonGhostText: { color: '#333', fontWeight: '700', fontSize: 16 },
  note: { color: '#666', marginTop: 10 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  topbarTitle: { fontSize: 22, fontWeight: '700', color: '#111' },
  backBtn: { padding: 6, marginRight: 6 },
});
