import { auth } from '../../firebaseConfig';
import { createUserWithEmailAndPassword, updateProfile, sendEmailVerification } from 'firebase/auth';
import { doc, getDoc, getFirestore } from 'firebase/firestore';
import React, { useState, useRef, useEffect } from 'react';
import { View, Alert, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { Colors, Radius, sf } from '../../constants/uiTheme';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import AuthLayout from '../../components/ui/AuthLayout';
import AppTextInput from '../../components/ui/AppTextInput';
import AppButton from '../../components/ui/AppButton';
import ErrorMessage from '../../components/ui/ErrorMessage';

const db = getFirestore();

export default function Register() {
  const router = useRouter();
  const isMountedRef = useRef(true);
  const redirectTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    };
  }, []);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');

  // Live mismatch indicator — only surfaces once the user has typed in the
  // confirm field, so the field doesn't show an error the moment it appears.
  const confirmTouched = confirmPassword.length > 0;
  const confirmMismatch = confirmTouched && confirmPassword !== password;

  const isEmailAllowed = async (email) => {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return false;
    const docRef = doc(db, 'allowedDomains', domain);
    const docSnap = await getDoc(docRef);
    return docSnap.exists();
  };

  const getFirebaseErrorMessage = (error) => {
    if (!error?.code) return error?.message || 'An unexpected error occurred';
    switch (error.code) {
      case 'auth/email-already-in-use':  return 'This email is already registered. Try logging in instead.';
      case 'auth/invalid-email':         return 'Please enter a valid email address.';
      case 'auth/weak-password':         return 'Password is too weak. Use at least 6 characters.';
      case 'auth/operation-not-allowed': return 'Email/password accounts are not enabled. Contact support.';
      case 'auth/network-request-failed':return 'Network error. Check your connection and try again.';
      case 'auth/too-many-requests':     return 'Too many attempts. Please try again later.';
      default:
        if (error.message?.includes('Firebase:')) {
          return error.message.replace(/^Firebase:\s*Error\s*\([^)]+\)\s*:?\s*/i, '').trim() || 'An error occurred.';
        }
        return error.message || 'An error occurred during registration.';
    }
  };

  const handleRegister = async () => {
    if (!name || !email || !password || !confirmPassword) {
      if (isMountedRef.current) setErrorMessage('Please fill in every field, including Confirm Password.');
      return;
    }
    if (password !== confirmPassword) {
      if (isMountedRef.current) setErrorMessage('Passwords do not match. Please re-enter them.');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    try {
      const allowed = await isEmailAllowed(email);
      if (!allowed) throw new Error('Your email domain is not allowed.');

      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(userCredential.user, { displayName: name });
      await sendEmailVerification(userCredential.user);

      try {
        await fetch(`${API_BASE_URL}/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: userCredential.user.uid, name, useremail: email }),
        });
      } catch { /* DB failure doesn't block registration */ }

      const registeredEmailValue = email;
      await auth.signOut();
      await new Promise(resolve => setTimeout(resolve, 200));

      if (isMountedRef.current) {
        setRegistrationSuccess(true);
        setRegisteredEmail(registeredEmailValue);
        setLoading(false);
        setName(''); setPassword(''); setConfirmPassword(''); setEmail('');
        redirectTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) router.replace('/(auth)/login');
        }, 10000);
      }
    } catch (error) {
      if (isMountedRef.current) {
        setErrorMessage(getFirebaseErrorMessage(error));
        setLoading(false);
      }
    }
  };

  if (registrationSuccess && registeredEmail) {
    return (
      <AuthLayout subtitle="Account Created">
        <View style={s.successBox}>
          <View style={s.successIconWrap}>
            <MaterialIcons name="mark-email-read" size={40} color={Colors.successFg} />
          </View>
          <Text style={s.successTitle}>Registration Successful!</Text>
          <Text style={s.successMsg}>We've sent a verification email to:</Text>
          <Text style={s.successEmail}>{registeredEmail}</Text>

          <View style={s.stepsBox}>
            <Text style={s.stepsTitle}>Next Steps</Text>
            <Text style={s.stepsText}>
              1. Check your email inbox (and spam folder){'\n'}
              2. Click the verification link in the email{'\n'}
              3. The link will expire in 1 hour{'\n'}
              4. Once verified, you can log in
            </Text>
          </View>

          <AppButton mode="contained" onPress={() => router.replace('/(auth)/login')}>
            Go to Login
          </AppButton>
          <Text style={s.redirectNote}>Redirecting to login in a few seconds…</Text>
        </View>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout subtitle="Create Account">
      <Text style={s.heading}>Register</Text>
      <Text style={s.sub}>Create your GearOps account below</Text>

      <View style={s.form}>
        <AppTextInput label="Full Name" value={name} onChangeText={setName} />
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
          autoComplete="new-password"
          textContentType="newPassword"
        />

        <AppTextInput
          label="Confirm Password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          error={confirmMismatch ? 'Passwords do not match' : null}
          onSubmitEditing={handleRegister}
          returnKeyType="go"
        />
        {confirmTouched && !confirmMismatch && (
          <Text style={s.matchHint}>✓ Passwords match</Text>
        )}

        <ErrorMessage error={errorMessage} visible={!!errorMessage} />

        <View style={s.btnGap} />
        <AppButton
          variant="primary"
          size="lg"
          onPress={handleRegister}
          loading={loading}
          disabled={loading || confirmMismatch}
        >
          Create Account
        </AppButton>
      </View>

      <View style={s.footer}>
        <Text style={s.footerText}>Already have an account?</Text>
        <TouchableOpacity onPress={() => router.replace('/(auth)/login')}>
          <Text style={s.footerLink}> Login</Text>
        </TouchableOpacity>
      </View>
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
  matchHint: {
    fontSize: sf(12),
    color: Colors.successFg,
    fontWeight: '700',
    marginTop: -4,
    marginBottom: 4,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 28,
  },
  footerText: { color: Colors.sub, fontSize: sf(14) },
  footerLink: { color: Colors.accent, fontWeight: '700', fontSize: sf(14) },
  successBox: {
    alignItems: 'center',
    gap: 12,
  },
  successIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.successBg,
    borderWidth: 2,
    borderColor: Colors.successBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  successTitle: {
    fontSize: sf(22),
    fontWeight: '900',
    color: Colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  successMsg: {
    fontSize: sf(14),
    color: Colors.sub,
    textAlign: 'center',
  },
  successEmail: {
    fontSize: sf(15),
    fontWeight: '700',
    color: Colors.accent,
    textAlign: 'center',
  },
  stepsBox: {
    backgroundColor: Colors.accentLight,
    borderWidth: 2,
    borderColor: Colors.accentMuted,
    borderRadius: Radius.lg,
    padding: 16,
    width: '100%',
    marginVertical: 4,
  },
  stepsTitle: {
    fontSize: sf(13),
    fontWeight: '800',
    color: Colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  stepsText: {
    fontSize: sf(13),
    color: Colors.sub,
    lineHeight: 22,
  },
  redirectNote: {
    fontSize: sf(12),
    color: Colors.sub2,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 4,
  },
});
