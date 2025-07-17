// ResetPassword.js - For logged-in users to send themselves a password reset email (no redirect)
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { auth } from '../../firebaseConfig';
import { sendPasswordResetEmail } from 'firebase/auth';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

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
          <MaterialIcons name="arrow-back" size={28} color="#1E90FF" />
          <Text style={styles.headerText}>Back to Profile</Text>
        </View>
      </TouchableOpacity>
      
      {/* Centered content */}
      <View style={styles.content}>
        <Text style={styles.title}>Reset Password</Text>
        <Text style={styles.info}>A password reset email will be sent to:</Text>
        <Text style={styles.email}>{user?.email}</Text>
        {success ? (
          <Text style={styles.successMsg}>A password reset email has been sent! Please check your inbox.</Text>
        ) : (
          <TouchableOpacity style={styles.button} onPress={handleReset} disabled={sending}>
            {sending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Send Reset Email</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
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
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
    color: '#1E90FF',
  },
    content: {
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
        },
    title: {
        fontSize: 22,
        fontWeight: 'bold',
        color: '#1E90FF',
        marginBottom: 18,
    },
    info: { fontSize: 16, marginBottom: 10, color: '#555' },
    email: { fontSize: 16, marginBottom: 24, color: '#1E90FF', fontWeight: 'bold' },
    button: { backgroundColor: '#1E90FF', paddingVertical: 12, paddingHorizontal: 32, borderRadius: 24 },
    buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
    successMsg: { color: 'green', fontSize: 16, textAlign: 'center', marginTop: 20 },

});
