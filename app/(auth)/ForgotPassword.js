// ForgotPassword.js - Allows user to request a password reset email using Firebase Auth

import React, { useState } from 'react';
import { View, TextInput, Button, Text, Alert, StyleSheet } from 'react-native';
import { getAuth, sendPasswordResetEmail } from 'firebase/auth';
import { useRouter } from 'expo-router';

export default function ForgotPasswordScreen() {
  // State to store the user's email input
  const [email, setEmail] = useState('');
  // State to show confirmation message
  const [success, setSuccess] = useState(false);
  // Router for navigation
  const router = useRouter();

  // Handler for sending the reset email
  const handleReset = async () => {
    const auth = getAuth(); // Get Firebase Auth instance
    try {
      await sendPasswordResetEmail(auth, email); // Send reset email
      setSuccess(true); // Show confirmation message
      setTimeout(() => {
        router.replace('/(auth)/login'); // Redirect to login after 2 seconds
      }, 2000);
    } catch (error) {
      // Show error message using Alert for mobile, and inline for web
      if (typeof window !== 'undefined' && window.alert) {
        window.alert(error.message);
      } else {
        Alert.alert('Error', error.message);
      }
    }
  };

  return (
    <View style={styles.container}>
      {/* Screen title */}
      <Text style={styles.title}>Forgot Password</Text>
      {/* Success message */}
      {success ? (
        <Text style={styles.successMsg}>
          A password reset email has been sent. Redirecting to login...
        </Text>
      ) : (
        <>
          {/* Email input field */}
          <TextInput
            placeholder="Enter your email"
            value={email}
            onChangeText={setEmail}
            style={styles.input}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          {/* Button to send reset email */}
          <Button title="Send Reset Email" onPress={handleReset} />
        </>
      )}
    </View>
  );
}

// Styles for the forgot password screen
const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 20 },
  input: { borderWidth: 1, borderColor: '#ccc', padding: 12, marginBottom: 20, borderRadius: 6 },
  successMsg: { color: 'green', fontSize: 16, textAlign: 'center', marginBottom: 20 },
});
