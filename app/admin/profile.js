// profile.js - Enhanced Admin/User profile page with photo upload and password reset

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Avatar } from 'react-native-elements';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { auth } from '../../firebaseConfig';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage, db } from '../../firebaseConfig';
import { doc, getDoc, updateDoc } from 'firebase/firestore';

// Utility to get initials from name
const getInitials = (name) => name ? name.split(' ').map(n => n[0]).join('').toUpperCase() : '';

// Account component renders user profile with upload/reset features
const Account = () => {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState({ name: '', phone: '', photoURL: '' });
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        // Try to get extra info from Firestore if available
        try {
          const docRef = doc(db, 'users', firebaseUser.uid);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            setProfile({
              name: data.name || firebaseUser.displayName || '',
              phone: data.phone || firebaseUser.phoneNumber || '',
              photoURL: data.photoURL || firebaseUser.photoURL || '',
            });
          } else {
            setProfile({
              name: firebaseUser.displayName || '',
              phone: firebaseUser.phoneNumber || '',
              photoURL: firebaseUser.photoURL || '',
            });
          }
        } catch (e) {
          setProfile({
            name: firebaseUser.displayName || '',
            phone: firebaseUser.phoneNumber || '',
            photoURL: firebaseUser.photoURL || '',
          });
        }
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const pickImageAndUpload = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
      if (!result.canceled && result.assets && result.assets[0].uri) {
        setUploading(true);
        const uri = result.assets[0].uri;
        const response = await fetch(uri);
        const blob = await response.blob();
        const storageRef = ref(storage, `profilePhotos/${user.uid}.jpg`);
        await uploadBytes(storageRef, blob);
        const downloadURL = await getDownloadURL(storageRef);
        // Update user profile in Auth and Firestore
        await user.updateProfile({ photoURL: downloadURL });
        await updateDoc(doc(db, 'users', user.uid), { photoURL: downloadURL });
        setProfile((p) => ({ ...p, photoURL: downloadURL }));
        Alert.alert('Success', 'Profile photo updated!');
      }
    } catch (e) {
      Alert.alert('Error', e.message || 'Failed to upload photo');
    } finally {
      setUploading(false);
    }
  };


  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#1E90FF" /></View>;
  }

  return (
    <View style={styles.container}>
      {/* Header with back button and screen title */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.push('/dashboard')}>
          <MaterialIcons name="arrow-back" size={24} color="#1E90FF" />
        </TouchableOpacity>
        <Text style={styles.title}>Profile</Text>
      </View>
      {/* Profile section with avatar and name/role */}
      <View style={styles.profile}>
        <Avatar
          rounded
          size="xlarge"
          title="SV"
          source={{ uri: 'https://your-avatar-url.com/avatar.png' }} // Placeholder if no image is provided
          containerStyle={styles.avatar}
        />
        <Text style={styles.name}>{profile.name || user?.displayName || 'User'}</Text>
        <Text style={styles.role}>{user?.email}</Text> 
      </View>
      {/* Contact information section */}
      <View style={styles.contactInfo}>
        <Text style={styles.email}>{user?.email}</Text>
        <Text style={styles.phone}>{profile.phone || 'No phone set'}</Text>
        <TouchableOpacity style={styles.resetBtn} onPress={() => router.push('/admin/ResetPassword')}>
          <Text style={styles.resetBtnText}>Reset Password</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// Styles for the profile and contact info UI
const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  profile: {
    alignItems: 'center',
    marginBottom: 30,
  },
  avatar: {
    backgroundColor: '#1E90FF',
    marginBottom: 20,
  },
  name: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  role: {
    fontSize: 16,
    color: '#888',
  },
  contactInfo: {
    alignItems: 'center',
  },
  email: {
    fontSize: 16,
    color: '#555',
    marginBottom: 10,
  },
  phone: {
    fontSize: 16,
    color: '#555',
    marginBottom: 20,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
    marginTop: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 12,
    color: '#1E90FF',
  },
  uploadBtn: {
    backgroundColor: '#1E90FF',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 20,
    marginBottom: 10,
    marginTop: 10,
  },
  uploadBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  resetBtn: {
    backgroundColor: '#FF6347',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 20,
    marginTop: 20,
  },
  resetBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  resetBtn: {
    backgroundColor: '#1E90FF',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 20,
    marginTop: 20,
  },
  resetBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

// Handler for password reset
const handleResetPassword = async (user) => {
  if (!user?.email) {
    Alert.alert('Error', 'No email available for password reset.');
    return;
  }
  try {
    await auth.sendPasswordResetEmail(user.email);
    Alert.alert('Reset Email Sent', 'Check your inbox for password reset instructions.');
  } catch (e) {
    Alert.alert('Error', e.message || 'Failed to send reset email');
  }
};

export default Account;
