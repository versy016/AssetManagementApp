// ForgotPassword.js - Allows user to request a password reset email using Firebase Auth

import React, { useState } from 'react';
import { View, Text, Alert, StyleSheet } from 'react-native';
import { getAuth, sendPasswordResetEmail } from 'firebase/auth';
import { useRouter } from 'expo-router';
import { useTheme } from 'react-native-paper';

import ScreenWrapper from '../../components/ui/ScreenWrapper';
import AppTextInput from '../../components/ui/AppTextInput';
import AppButton from '../../components/ui/AppButton';

export default function ForgotPasswordScreen() {
  const theme = useTheme();
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
      setTimeout(() => {
        router.replace('/(auth)/login');
      }, 2000);
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
    <ScreenWrapper style={styles.container}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: theme.colors.primary }]}>Forgot Password</Text>

        {success ? (
          <Text style={[styles.successMsg, { color: theme.colors.primary }]}>
            A password reset email has been sent. Redirecting to login...
          </Text>
        ) : (
          <>
            <AppTextInput
              label="Enter your email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />

            <AppButton
              mode="contained"
              onPress={handleReset}
              loading={loading}
            >
              Send Reset Email
            </AppButton>

            <AppButton
              mode="text"
              onPress={() => router.back()}
            >
              Cancel
            </AppButton>
          </>
        )}
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
  },
  content: {
    padding: 24,
    justifyContent: 'center',
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 24,
    textAlign: 'center',
  },
  successMsg: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
});
