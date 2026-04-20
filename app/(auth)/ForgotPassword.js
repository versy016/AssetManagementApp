import React, { useState } from 'react';
import { View, Text, Alert, StyleSheet, TouchableOpacity } from 'react-native';
import { getAuth, sendPasswordResetEmail } from 'firebase/auth';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { Colors, Radius, sf } from '../../constants/uiTheme';
import AuthLayout from '../../components/ui/AuthLayout';
import AppTextInput from '../../components/ui/AppTextInput';
import AppButton from '../../components/ui/AppButton';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleReset = async () => {
    if (!email) return;
    setLoading(true);
    const auth = getAuth();
    try {
      await sendPasswordResetEmail(auth, email);
      setSuccess(true);
      setTimeout(() => router.replace('/(auth)/login'), 3000);
    } catch (error) {
      if (typeof window !== 'undefined' && window.alert) {
        window.alert(error.message);
      } else {
        Alert.alert('Error', error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout subtitle="Password Recovery">
      <Text style={s.heading}>Forgot Password</Text>
      <Text style={s.sub}>Enter your email and we'll send you a reset link</Text>

      {success ? (
        <View style={s.successBox}>
          <MaterialIcons name="mark-email-read" size={40} color={Colors.successFg} />
          <Text style={s.successTitle}>Email Sent!</Text>
          <Text style={s.successMsg}>
            A password reset link has been sent to{'\n'}{email}
          </Text>
          <Text style={s.redirectNote}>Redirecting to login…</Text>
        </View>
      ) : (
        <View style={s.form}>
          <AppTextInput
            label="Email address"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <View style={s.btnGap} />

          <AppButton mode="contained" onPress={handleReset} loading={loading}>
            Send Reset Email
          </AppButton>

          <TouchableOpacity onPress={() => router.back()} style={s.cancelRow}>
            <Text style={s.cancelText}>← Back to Login</Text>
          </TouchableOpacity>
        </View>
      )}
    </AuthLayout>
  );
}

const s = StyleSheet.create({
  heading: {
    fontSize: sf(28),
    fontWeight: '900',
    color: Colors.text,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  sub: {
    fontSize: sf(14),
    color: Colors.sub,
    marginBottom: 28,
    fontWeight: '500',
  },
  form: {
    gap: 4,
  },
  btnGap: { height: 8 },
  cancelRow: {
    alignItems: 'center',
    marginTop: 16,
  },
  cancelText: {
    color: Colors.accent,
    fontWeight: '700',
    fontSize: sf(14),
  },
  successBox: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 12,
  },
  successTitle: {
    fontSize: sf(22),
    fontWeight: '900',
    color: Colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  successMsg: {
    fontSize: sf(14),
    color: Colors.sub,
    textAlign: 'center',
    lineHeight: 22,
  },
  redirectNote: {
    fontSize: sf(12),
    color: Colors.sub2,
    fontStyle: 'italic',
    marginTop: 4,
  },
});
