import { auth } from '../../firebaseConfig';
import { sendEmailVerification, signOut } from 'firebase/auth';
import React, { useState, useEffect } from 'react';
import { View, Text, Alert, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { Colors, Radius, sf } from '../../constants/uiTheme';
import AuthLayout from '../../components/ui/AuthLayout';
import AppButton from '../../components/ui/AppButton';
import ErrorMessage from '../../components/ui/ErrorMessage';

export default function VerifyEmail() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (firebaseUser) => {
      if (!firebaseUser) { router.replace('/(auth)/login'); return; }
      try {
        await firebaseUser.reload();
        setUser(firebaseUser);
        if (firebaseUser.emailVerified) router.replace('/(tabs)/dashboard');
      } catch {
        setErrorMessage('Failed to check verification status.');
      } finally {
        setChecking(false);
      }
    });
    return unsubscribe;
  }, [router]);

  const handleResendVerification = async () => {
    if (!user) return;
    setResending(true);
    setErrorMessage('');
    try {
      await sendEmailVerification(user);
      Alert.alert('Verification Email Sent', 'Please check your email and click the verification link. The link expires in 1 hour.', [{ text: 'OK' }]);
    } catch (error) {
      setErrorMessage(
        error.code === 'auth/too-many-requests'
          ? 'Too many requests. Please wait a few minutes before trying again.'
          : 'Failed to send verification email.'
      );
    } finally {
      setResending(false);
    }
  };

  const handleCheckVerification = async () => {
    if (!user) return;
    setLoading(true);
    setErrorMessage('');
    try {
      await user.reload();
      if (user.emailVerified) {
        Alert.alert('Email Verified', 'Your email has been verified!', [
          { text: 'Continue', onPress: () => router.replace('/(tabs)/dashboard') },
        ]);
      } else {
        Alert.alert('Not Verified Yet', 'Please check your inbox and click the verification link.');
      }
    } catch {
      setErrorMessage('Failed to check verification status.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    try { await signOut(auth); router.replace('/(auth)/login'); }
    catch { setErrorMessage('Failed to sign out.'); }
  };

  if (checking) {
    return (
      <AuthLayout subtitle="Checking Status">
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={s.checkingText}>Checking verification status…</Text>
        </View>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout subtitle="Email Verification">
      <View style={s.iconWrap}>
        <MaterialIcons name="mark-email-unread" size={40} color={Colors.accent} />
      </View>

      <Text style={s.heading}>Verify Your Email</Text>
      <Text style={s.sub}>Check your inbox and click the link we sent you</Text>

      <View style={s.emailBox}>
        <Text style={s.emailLabel}>Email sent to</Text>
        <Text style={s.emailValue}>{user?.email}</Text>
      </View>

      <Text style={s.instructions}>
        The verification link will expire in 1 hour. Once verified, tap the button below to continue.
      </Text>

      <ErrorMessage error={errorMessage} visible={!!errorMessage} />

      <View style={s.btnStack}>
        <AppButton mode="contained" onPress={handleCheckVerification} loading={loading}>
          I've Verified My Email
        </AppButton>
        <AppButton mode="outlined" onPress={handleResendVerification} loading={resending}>
          Resend Verification Email
        </AppButton>
      </View>

      <TouchableOpacity onPress={handleSignOut} style={s.signOutRow}>
        <Text style={s.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </AuthLayout>
  );
}

const s = StyleSheet.create({
  center: {
    alignItems: 'center',
    paddingTop: 40,
    gap: 16,
  },
  checkingText: {
    fontSize: sf(15),
    color: Colors.sub,
    fontWeight: '500',
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.accentLight,
    borderWidth: 2,
    borderColor: Colors.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  heading: {
    fontSize: sf(24),
    fontWeight: '900',
    color: Colors.text,
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 4,
  },
  sub: {
    fontSize: sf(14),
    color: Colors.sub,
    textAlign: 'center',
    marginBottom: 20,
    fontWeight: '500',
  },
  emailBox: {
    backgroundColor: Colors.primaryLight,
    borderWidth: 2,
    borderColor: Colors.line,
    borderRadius: Radius.lg,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  emailLabel: {
    fontSize: sf(11),
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: Colors.sub2,
    marginBottom: 4,
  },
  emailValue: {
    fontSize: sf(15),
    fontWeight: '700',
    color: Colors.primary,
  },
  instructions: {
    fontSize: sf(13),
    color: Colors.sub,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  btnStack: {
    gap: 10,
  },
  signOutRow: {
    alignItems: 'center',
    marginTop: 24,
  },
  signOutText: {
    color: Colors.accent,
    fontWeight: '700',
    fontSize: sf(14),
  },
});
