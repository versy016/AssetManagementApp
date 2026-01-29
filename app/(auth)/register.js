// Register.js - User registration screen for the app

import { auth } from '../../firebaseConfig';
import { createUserWithEmailAndPassword, updateProfile, sendEmailVerification } from 'firebase/auth';
import { doc, getDoc, getFirestore } from 'firebase/firestore';
import React, { useState, useRef, useEffect } from 'react';
import { View, Alert, StyleSheet, Text, TouchableOpacity, Platform } from 'react-native';
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
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');
  const redirectTimerRef = useRef(null);

  // Cleanup redirect timer on unmount
  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
      }
    };
  }, []);

  // Debug: Log state changes
  useEffect(() => {
    if (registrationSuccess) {
      console.log('Registration success state is true, email:', registeredEmail);
    }
  }, [registrationSuccess, registeredEmail]);

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

      // Send email verification
      await sendEmailVerification(userCredential.user);

      // Create user in database (don't fail registration if this fails)
      try {
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
      } catch (dbError) {
        console.warn('Failed to create user in database:', dbError);
        // Continue with registration success even if DB call fails
      }

      // Store email before signing out
      const registeredEmailValue = email;

      // Sign out immediately to prevent navbar from showing
      await auth.signOut();

      // Small delay to ensure signOut completes and state updates
      await new Promise(resolve => setTimeout(resolve, 200));

      if (isMountedRef.current) {
        console.log('Setting registration success state');
        // Show success state on the page - use functional updates to ensure state is set
        setRegistrationSuccess(true);
        setRegisteredEmail(registeredEmailValue);
        setLoading(false);

        // Clear form
        setName('');
        setPassword('');
        setEmail('');

        // Auto-redirect to login after 5 seconds
        redirectTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            router.replace('/(auth)/login');
          }
        }, 5000);
      } else {
        console.warn('Component unmounted before setting success state');
      }
    } catch (error) {
      console.error('Registration error:', error);
      if (isMountedRef.current) {
        const friendlyMessage = getFirebaseErrorMessage(error);
        setErrorMessage(friendlyMessage);
        setLoading(false);
      }
    }
  };

  // Show success message if registration was successful
  if (registrationSuccess && registeredEmail) {
    console.log('Rendering success screen for:', registeredEmail);
    return (
      <ScreenWrapper style={styles.container} withScrollView>
        <View style={styles.content}>
          <View style={styles.successContainer}>
            <Text style={[styles.successIcon, { color: theme.colors.primary }]}>✓</Text>
            <Text style={[styles.successTitle, { color: theme.colors.primary }]}>
              Registration Successful!
            </Text>
            <Text style={[styles.successMessage, { color: theme.colors.text }]}>
              We've sent a verification email to:
            </Text>
            <Text style={[styles.successEmail, { color: theme.colors.primary }]}>
              {registeredEmail}
            </Text>
            <View style={styles.instructionsBox}>
              <Text style={[styles.instructionsTitle, { color: theme.colors.text }]}>
                Next Steps:
              </Text>
              <Text style={[styles.instructionsText, { color: theme.colors.text }]}>
                1. Check your email inbox (and spam folder){'\n'}
                2. Click the verification link in the email{'\n'}
                3. The link will expire in 1 hour{'\n'}
                4. Once verified, you can log in to your account
              </Text>
            </View>
            <AppButton
              mode="contained"
              onPress={() => router.replace('/(auth)/login')}
              style={styles.goToLoginButton}
            >
              Go to Login
            </AppButton>
            <Text style={[styles.autoRedirectText, { color: theme.colors.text }]}>
              Redirecting to login in a few seconds...
            </Text>
          </View>
        </View>
      </ScreenWrapper>
    );
  }

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
  successContainer: {
    alignItems: 'center',
    width: '100%',
  },
  successIcon: {
    fontSize: 64,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  successTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  successMessage: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 8,
  },
  successEmail: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 24,
  },
  instructionsBox: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 16,
    marginBottom: 24,
    width: '100%',
  },
  instructionsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  instructionsText: {
    fontSize: 14,
    lineHeight: 22,
  },
  goToLoginButton: {
    marginBottom: 12,
    minWidth: 200,
  },
  autoRedirectText: {
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
  },
});
