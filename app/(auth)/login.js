// Login.js - User login screen for the app

// Import authentication instance and sign-in method from Firebase
import { auth } from '../../firebaseConfig';
import { signInWithEmailAndPassword } from 'firebase/auth';
// Import React and hooks for state and effect management
import React, { useState, useEffect } from 'react';
// Import UI components from React Native
import { View, TextInput, Button, Text, Alert, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
// Import Expo Router for navigation
import { useRouter } from 'expo-router';

// Main Login component
export default function Login() {
  const router = useRouter(); // Router instance for navigation
  // State for user input and UI feedback
  const [email, setEmail] = useState(''); // Stores the email input
  const [password, setPassword] = useState(''); // Stores the password input
  const [errorMessage, setErrorMessage] = useState(''); // Error message to display
  const [loading, setLoading] = useState(false); // Loading spinner state

  // Handles navigation to Forgot Password screen
  const handleForgotPassword = () => {
    router.push('/(auth)/ForgotPassword');
  };

  // Handles login logic when user presses the login button
  const handleLogin = async () => {
    // Validate input
    if (!email || !password) {
      setErrorMessage('Please enter both email and password');
      return;
    }

    setLoading(true); // Show loading spinner
    setErrorMessage(''); // Clear previous errors

    try {
      // Attempt to sign in using Firebase authentication
      await signInWithEmailAndPassword(auth, email, password);
      Alert.alert('Login Success', 'You have logged in successfully!');
      // Navigate to dashboard tab after successful login
      router.replace('/(tabs)/dashboard');
    } catch (error) {
      // Handle and display specific authentication errors
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
          errorMsg = 'Invalid email or password';
          break;
        default:
          errorMsg = error.message;
      }
      setErrorMessage(errorMsg);
    } finally {
      setLoading(false); // Hide loading spinner
    }
  };

  // Render the login form UI
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Login</Text>

      {/* Email input field */}
      <TextInput
        style={styles.input}
        placeholder="Email"
        onChangeText={setEmail}
        value={email}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholderTextColor="#888"
    />

    <TextInput
      style={styles.input}
      placeholder="Password"
      onChangeText={setPassword}
      value={password}
      secureTextEntry
      placeholderTextColor="#888"
    />

    {/* Forgot Password link */}
    <TouchableOpacity onPress={handleForgotPassword} style={{ alignSelf: 'flex-end', marginBottom: 16 }}>
      <Text style={{ color: '#1E90FF', fontWeight: '600' }}>Forgot Password?</Text>
    </TouchableOpacity>

    <Button 
      title="Login" 
      onPress={handleLogin} 
      color="#007BFF" 
      disabled={loading}
    />

    {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

    <TouchableOpacity 
      onPress={() => router.push('/(auth)/register')}
      disabled={loading}
    >
      <Text style={styles.registerLink}>Don't have an account? Register</Text>
    </TouchableOpacity>

    {/* Full-screen overlay loader */}
    {loading && (
      <View style={styles.loaderOverlay}>
        <ActivityIndicator size="large" color="#1E90FF" />
      </View>
    )}
  </View>
);

}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    marginBottom: 20,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 12,
    borderRadius: 5,
    marginBottom: 15,
    color: '#000',
  },
  error: {
    color: 'red',
    marginTop: 10,
    textAlign: 'center',
  },
  registerLink: {
    marginTop: 20,
    textAlign: 'center',
    color: '#1E90FF',
    fontWeight: '500',
  },
  loaderOverlay: {
  ...StyleSheet.absoluteFillObject,
  backgroundColor: 'rgba(255,255,255,0.8)',
  justifyContent: 'center',
  alignItems: 'center',
  zIndex: 10,
},

});
