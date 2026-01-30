// Login.js - User login screen for the app

import { auth } from '../../firebaseConfig';
import { signInWithEmailAndPassword } from 'firebase/auth';
import React, { useState } from 'react';
import { View, Text, Alert, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from 'react-native-paper';

import ScreenWrapper from '../../components/ui/ScreenWrapper';
import AppTextInput from '../../components/ui/AppTextInput';
import AppButton from '../../components/ui/AppButton';
import ErrorMessage from '../../components/ui/ErrorMessage';

export default function Login() {
  const router = useRouter();
  const theme = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleForgotPassword = () => {
    router.push('/(auth)/ForgotPassword');
  };

  const handleLogin = async () => {
    if (!email || !password) {
      setErrorMessage('Please enter both email and password');
      return;
    }

    setLoading(true);
    setErrorMessage('');

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);

      // Check if email is verified
      await userCredential.user.reload();
      if (!userCredential.user.emailVerified) {
        // Sign out to prevent access
        await auth.signOut();

        // Show error message in UI
        setErrorMessage('Your email address has not been verified. Please check your inbox and click the verification link in the email we sent you. Once verified, you can log in.');

        // Also show alert for better visibility
        Alert.alert(
          'Email Verification Required',
          'Please verify your email address before accessing the app. Check your inbox (and spam folder) for the verification email we sent you. Click the verification link in that email to verify your account, then try logging in again.',
          [
            {
              text: 'OK',
              onPress: () => {
                // Stay on login page - user needs to verify via email
              },
            },
          ],
          { cancelable: false }
        );

        setLoading(false);
        return;
      }

      // Email is verified, proceed to dashboard
      router.replace('/(tabs)/dashboard');
    } catch (error) {
      let errorMsg = 'Login failed';
      switch (error.code) {
        case 'auth/invalid-email':
          errorMsg = 'Invalid email address';
          break;
        case 'auth/user-disabled':
          errorMsg = 'Account disabled';
          break;
        case 'auth/user-not-found':
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
          errorMsg = 'Invalid email or password';
          break;
        default:
          errorMsg = error.message;
      }
      setErrorMessage(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenWrapper style={styles.container} withScrollView>
      <View style={styles.content}>
        <Text style={[styles.title, { color: theme.colors.primary }]}>Login</Text>

        <AppTextInput
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <AppTextInput
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity onPress={handleForgotPassword} style={styles.forgotPassword}>
          <Text style={{ color: theme.colors.primary, fontWeight: '600' }}>Forgot Password?</Text>
        </TouchableOpacity>

        <ErrorMessage error={errorMessage} visible={!!errorMessage} />

        <AppButton
          mode="contained"
          onPress={handleLogin}
          loading={loading}
        >
          Login
        </AppButton>

        <TouchableOpacity
          onPress={() => router.push('/(auth)/register')}
          disabled={loading}
          style={styles.registerLink}
        >
          <Text style={{ color: theme.colors.primary, fontWeight: '500' }}>
            Don't have an account? Register
          </Text>
        </TouchableOpacity>
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
  },
  content: {
    padding: 20,
    justifyContent: 'center',
    flex: 1,
    minHeight: 500, // Ensure vertical centering on larger screens
  },
  title: {
    fontSize: 32,
    marginBottom: 32,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    marginBottom: 24,
  },
  registerLink: {
    marginTop: 24,
    alignItems: 'center',
  },
});
