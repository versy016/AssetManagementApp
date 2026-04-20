// ResetPassword.js - For logged-in users to send themselves a password reset email (no redirect)
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { auth } from '../../firebaseConfig';
import { sendPasswordResetEmail } from 'firebase/auth';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, Shadows, sf } from '../../constants/uiTheme';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const user = auth.currentUser;
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleReset = async () => {
    if (!user?.email) {
      Alert.alert('Error', 'No email available for password reset.');
      return;
    }
    setSending(true);
    try {
      await sendPasswordResetEmail(auth, user.email);
      setSuccess(true);
    } catch (e) {
      Alert.alert('Error', e.message || 'Failed to send reset email');
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Absolute-positioned back button at top left */}
      <TouchableOpacity style={styles.backBtn} onPress={() => router.push('/admin/profile')}>
        <View style={styles.headerRow}>
          <MaterialIcons name="arrow-back" size={28} color={Colors.primary} />
          <Text style={styles.headerText}>Back to Profile</Text>
        </View>
      </TouchableOpacity>

      {/* Centered content */}
      <View style={styles.content}>
        <Text style={styles.title}>Reset Password</Text>
        <View style={styles.card}>
          <Text style={styles.info}>A password reset email will be sent to:</Text>
          <Text style={styles.email}>{user?.email}</Text>
          {success ? (
            <Text style={styles.successMsg}>A password reset email has been sent! Please check your inbox.</Text>
          ) : (
            <TouchableOpacity style={styles.button} onPress={handleReset} disabled={sending}>
              {sending ? (
                <ActivityIndicator color={Colors.card} />
              ) : (
                <Text style={styles.buttonText}>Send Reset Email</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backBtn: {
    position: 'absolute',
    top: 40,
    left: 20,
    padding: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerText: {
    fontSize: sf(18),
    fontWeight: '700',
    marginLeft: 8,
    color: Colors.primary,
    textTransform: 'uppercase',
  },
  content: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: sf(22),
    fontWeight: '900',
    textTransform: 'uppercase',
    color: Colors.text,
    marginBottom: 24,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: 20,
    borderWidth: 2,
    borderColor: Colors.line,
    width: '100%',
    ...Shadows.card,
  },
  info: {
    fontSize: sf(14),
    marginBottom: 10,
    color: Colors.text,
    fontWeight: '500',
  },
  email: {
    fontSize: sf(16),
    marginBottom: 24,
    color: Colors.primary,
    fontWeight: '700',
  },
  button: {
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  buttonText: {
    color: Colors.card,
    fontWeight: '700',
    fontSize: sf(16),
    textTransform: 'uppercase',
  },
  successMsg: {
    color: Colors.successFg,
    fontSize: sf(16),
    textAlign: 'center',
    marginTop: 20,
    fontWeight: '600',
  },
});
