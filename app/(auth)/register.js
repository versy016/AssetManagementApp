// Register.js - User registration screen for the app

import { auth } from '../../firebaseConfig';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, getDoc, getFirestore } from 'firebase/firestore';
import React, { useState, useRef, useEffect } from 'react';
import { View, Alert, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from 'react-native-paper';

import { API_BASE_URL } from '../../inventory-api/apiBase';
import ScreenWrapper from '../../components/ui/ScreenWrapper';
import AppTextInput from '../../components/ui/AppTextInput';
import AppButton from '../../components/ui/AppButton';
import ErrorMessage from '../../components/ui/ErrorMessage';

const db = getFirestore();

export default function Register() {
  const router = useRouter();
  const theme = useTheme();
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const isEmailAllowed = async (email) => {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return false;
    const docRef = doc(db, 'allowedDomains', domain);
    const docSnap = await getDoc(docRef);
    return docSnap.exists();
  };

  const getFirebaseErrorMessage = (error) => {
    if (!error || !error.code) {
      return error?.message || 'An unexpected error occurred';
    }

    switch (error.code) {
      case 'auth/email-already-in-use':
        return 'This email address is already registered. Please use a different email or try logging in.';
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/weak-password':
        return 'Password is too weak. Please use at least 6 characters.';
      case 'auth/operation-not-allowed':
        return 'Email/password accounts are not enabled. Please contact support.';
      case 'auth/network-request-failed':
        return 'Network error. Please check your internet connection and try again.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Please try again later.';
      case 'auth/invalid-credential':
        return 'Invalid credentials. Please check your information and try again.';
      default:
        // For non-Firebase errors or unknown Firebase errors, return a cleaner message
        if (error.message && error.message.includes('Firebase:')) {
          // Remove "Firebase: Error" prefix if present
          return error.message.replace(/^Firebase:\s*Error\s*\([^)]+\)\s*:?\s*/i, '').trim() || 'An error occurred during registration.';
        }
        return error.message || 'An error occurred during registration.';
    }
  };

  const handleRegister = async () => {
    if (!name || !email || !password) {
      if (isMountedRef.current) {
        setErrorMessage('Please enter your name, email, and password.');
      }
      return;
    }

    setLoading(true);
    setErrorMessage('');

    try {
      // Check if email domain is allowed
      const allowed = await isEmailAllowed(email);
      if (!allowed) {
        throw new Error('Your email domain is not allowed.');
      }

      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(userCredential.user, { displayName: name });

      await fetch(`${API_BASE_URL}/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: userCredential.user.uid,
          name,
          useremail: email,
        }),
      });

      if (isMountedRef.current) {
        Alert.alert('Success', 'Registration successful!');
        router.replace('/(tabs)/dashboard');
      }
    } catch (error) {
      if (isMountedRef.current) {
        const friendlyMessage = getFirebaseErrorMessage(error);
        setErrorMessage(friendlyMessage);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  return (
    <ScreenWrapper style={styles.container} withScrollView>
      <View style={styles.content}>
        <Text style={[styles.title, { color: theme.colors.primary }]}>Register</Text>

        <AppTextInput
          label="Full Name"
          value={name}
          onChangeText={setName}
        />

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

        <ErrorMessage error={errorMessage} visible={!!errorMessage} />

        <AppButton
          mode="contained"
          onPress={handleRegister}
          loading={loading}
        >
          Register
        </AppButton>

        <TouchableOpacity
          onPress={() => router.replace('/(auth)/login')}
          style={styles.loginLink}
        >
          <Text style={{ color: theme.colors.primary, fontWeight: '500' }}>
            Already have an account? Login
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
    minHeight: 500,
  },
  title: {
    fontSize: 32,
    marginBottom: 32,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  loginLink: {
    marginTop: 24,
    alignItems: 'center',
  },
});
