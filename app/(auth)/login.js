import { auth } from '../../firebaseConfig';
import { signInWithEmailAndPassword } from 'firebase/auth';
import React, { useState } from 'react';
import { View, Text, Alert, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Radius, Shadows, sf } from '../../constants/uiTheme';
import AuthLayout from '../../components/ui/AuthLayout';
import AppTextInput from '../../components/ui/AppTextInput';
import AppButton from '../../components/ui/AppButton';
import ErrorMessage from '../../components/ui/ErrorMessage';

export default function Login() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      setErrorMessage('Please enter both email and password');
      return;
    }

    setLoading(true);
    setErrorMessage('');

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      await userCredential.user.reload();

      if (!userCredential.user.emailVerified) {
        await auth.signOut();
        setErrorMessage(
          'Your email address has not been verified. Please check your inbox and click the verification link before logging in.'
        );
        Alert.alert(
          'Email Verification Required',
          'Please verify your email address before accessing the app. Check your inbox (and spam folder) for the verification email.',
          [{ text: 'OK' }],
          { cancelable: false }
        );
        setLoading(false);
        return;
      }

      router.replace('/(tabs)/dashboard');
    } catch (error) {
      let errorMsg = 'Login failed';
      switch (error.code) {
        case 'auth/invalid-email':       errorMsg = 'Invalid email address'; break;
        case 'auth/user-disabled':       errorMsg = 'Account disabled'; break;
        case 'auth/user-not-found':
        case 'auth/wrong-password':
        case 'auth/invalid-credential':  errorMsg = 'Invalid email or password'; break;
        default:                         errorMsg = error.message;
      }
      setErrorMessage(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <Text style={s.heading}>Sign In</Text>

      <View style={s.form}>
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

        <TouchableOpacity
          onPress={() => router.push('/(auth)/ForgotPassword')}
          style={s.forgotRow}
        >
          <Text style={s.forgotText}>Forgot Password?</Text>
        </TouchableOpacity>

        <ErrorMessage error={errorMessage} visible={!!errorMessage} />

        <AppButton mode="contained" onPress={handleLogin} loading={loading}>
          Login
        </AppButton>
      </View>

      <View style={s.footer}>
        <Text style={s.footerText}>Don't have an account?</Text>
        <TouchableOpacity onPress={() => router.push('/(auth)/register')} disabled={loading}>
          <Text style={s.footerLink}> Register</Text>
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
    marginBottom: 28,
  },
  form: {
    gap: 4,
  },
  forgotRow: {
    alignSelf: 'flex-end',
    marginBottom: 8,
    marginTop: 4,
  },
  forgotText: {
    color: Colors.accent,
    fontWeight: '700',
    fontSize: sf(14),
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 28,
  },
  footerText: {
    color: Colors.sub,
    fontSize: sf(14),
  },
  footerLink: {
    color: Colors.accent,
    fontWeight: '700',
    fontSize: sf(14),
  },
});
