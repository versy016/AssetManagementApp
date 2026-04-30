// app/admin/index.js — entry opens User Management by default; QR tools live at /admin/qr
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { auth } from '../../firebaseConfig';
import { onAuthStateChanged } from 'firebase/auth';
import { MaterialIcons } from '@expo/vector-icons';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import { Colors, sf } from '../../constants/uiTheme';
import logger from '../../utils/logger';

export default function AdminIndex() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      try {
        if (!u) {
          router.replace('/login');
          return;
        }
        const res = await fetch(`${API_BASE_URL}/users/${u.uid}`);
        const dbUser = res.ok ? await res.json() : null;
        if (dbUser?.role === 'ADMIN') {
          setIsAdmin(true);
          setLoading(false);
          router.replace('/admin/users');
          return;
        }
        setIsAdmin(false);
      } catch (e) {
        logger.error(e);
        Alert.alert('Error', 'Failed to verify admin privileges.');
        setIsAdmin(false);
      } finally {
        setLoading(false);
      }
    });
    return unsub;
  }, [router]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8, color: Colors.sub }}>Opening admin…</Text>
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

  return (
    <View style={styles.center}>
      <ActivityIndicator />
      <Text style={{ marginTop: 8, color: Colors.sub }}>Redirecting…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: Colors.bg },
  button: { backgroundColor: Colors.primary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: sf(15) },
});
