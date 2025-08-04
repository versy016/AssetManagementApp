// Register.js - User registration screen for the app

// Import Firebase authentication and Firestore utilities
import { auth } from '../../firebaseConfig'; // Firebase authentication instance
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth'; // Firebase Auth functions
import { doc, getDoc, getFirestore } from 'firebase/firestore'; // Firestore database functions
// Import React and hooks for state, refs, and effects
import React, { useState, useRef, useEffect } from 'react'; // React library
// Import UI components from React Native
import {
  View,
  TextInput,
  Button,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native'; // React Native UI components
// Import Expo Router for navigation
import { useRouter } from 'expo-router'; // Expo Router for navigation

// Initialize Firestore database
const db = getFirestore(); // Firestore database instance

// Main Register component
export default function Register() {
  const router = useRouter(); // Router instance for navigation
  const isMountedRef = useRef(true); // To avoid state updates on unmounted component

  // Cleanup effect to set ref false on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []); // Empty dependency array means this effect runs only once

  // State variables for form fields and UI feedback
  const [name, setName] = useState(''); // User's full name
  const [email, setEmail] = useState(''); // User's email address
  const [password, setPassword] = useState(''); // User's password
  const [errorMessage, setErrorMessage] = useState(''); // Error message to display
  const [loading, setLoading] = useState(false); // Loading spinner state

  // Helper function to check if the email's domain is allowed (in Firestore)
  const isEmailAllowed = async (email) => {
    const domain = email.split('@')[1]?.toLowerCase();
    const docRef = doc(db, 'allowedDomains', domain);
    const docSnap = await getDoc(docRef);
    return docSnap.exists();
  }; // Returns true if email domain is allowed, false otherwise

  // Handles registration logic when user presses the register button
  const handleRegister = async () => {
    // Validate input
    if (!name || !email || !password) {
      if (isMountedRef.current) {
        setErrorMessage('Please enter your name, email, and password.');
      }
      return;
    }

    setLoading(true); // Show loading spinner
    setErrorMessage(''); // Clear previous errors

    // Check if email domain is allowed
    const allowed = await isEmailAllowed(email);
    if (!allowed) {
      if (isMountedRef.current) {
        setErrorMessage('Your email domain is not allowed.');
        setLoading(false);
      }
      return;
    }

    try {
      // Create user with Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      // Set user's display name
      await updateProfile(userCredential.user, { displayName: name });

      // Register user in backend API
      await fetch('http://ec2-13-239-139-73.ap-southeast-2.compute.amazonaws.com:3000/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', // ← this is required
        },
        body: JSON.stringify({
          id: userCredential.user.uid,
          name,
          useremail: email,
        }),
      });

      // Show success and navigate to dashboard
      if (isMountedRef.current) {
        Alert.alert('Success', 'Registration successful!');
        router.replace('/(tabs)/dashboard');
      }
    } catch (error) {
      // Display any registration errors
      if (isMountedRef.current) {
        setErrorMessage(error.message);
      }
    } finally {
      // Hide loading spinner
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }; // Handles registration logic and navigation

  // Render the registration form UI
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.container}>
          <Text style={styles.title}>Register</Text>

          {/* Name input field */}
          <TextInput
            style={styles.input}
            placeholder="Full Name"
            onChangeText={setName}
            value={name}
            placeholderTextColor="#888"
          />

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

          {/* Password input field */}
          <TextInput
            style={styles.input}
            placeholder="Password"
            onChangeText={setPassword}
            value={password}
            secureTextEntry
            placeholderTextColor="#888"
          />

          {/* Show loading spinner or register button */}
          {loading ? (
            <ActivityIndicator size="large" color="#1E90FF" />
          ) : (
            <Button title="Register" onPress={handleRegister} color="#1E90FF" />
          )}

          {/* Show error message if exists */}
          {!!errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

          {/* Link to login screen */}
          <TouchableOpacity onPress={() => router.replace('/(auth)/login')}>
            <Text style={styles.loginLink}>Already have an account? Login</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Styles for the registration screen
const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#fff',
    justifyContent: 'center',
  },
  title: {
    fontSize: 26,
    marginBottom: 25,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#1E90FF',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 12,
    borderRadius: 8,
    marginBottom: 15,
    fontSize: 16,
    color: '#000',
  },
  error: {
    color: 'red',  
    marginTop: 10,
    textAlign: 'center',
  },
  loginLink: {
    marginTop: 20,
    textAlign: 'center',
    color: '#1E90FF',
    fontWeight: '500',
  },
});
