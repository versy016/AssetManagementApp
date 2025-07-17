// dashboard.js - Main dashboard screen for authenticated users

// Import React and hooks for state and effect management
import React, { useState, useEffect } from 'react';
// Import core UI components from React Native
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
// Import MaterialIcons for icons
import { MaterialIcons } from '@expo/vector-icons';
// Import Firebase Auth instance
import { auth } from '../../firebaseConfig';
// Import router for navigation
import { useRouter } from 'expo-router';
// Import Firebase auth helpers
import { onAuthStateChanged, signOut } from 'firebase/auth';
// Import PropTypes for prop validation
import PropTypes from 'prop-types';

// Dashboard component displays user info, quick actions, shortcuts, and to-do list
const Dashboard = ({ isAdmin }) => {
  const router = useRouter(); // Router for navigation
  const [shortcuts, setShortcuts] = useState([]); // User-defined dashboard shortcuts
  const [showProfileMenu, setShowProfileMenu] = useState(false); // Show/hide profile dropdown
  const [loading, setLoading] = useState(true); // Loading state for auth check
  const [user, setUser] = useState(null); // Current authenticated user

  // On mount, check Firebase auth state and redirect if not logged in
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (!currentUser) {
        router.replace('/(auth)/login'); // Redirect to login if not authenticated
      } else {
        setUser(currentUser); // Save user info
      }
      setLoading(false); // Stop loading spinner
    });
    return unsubscribe;
  }, []);

  // Add a new shortcut card (up to 4)
  const addShortcut = () => {
    if (shortcuts.length < 4) {
      setShortcuts([...shortcuts, `Shortcut ${shortcuts.length + 1}`]);
    }
  };

  // Handle user logout and redirect
  const handleLogout = async () => {
    try {
      await signOut(auth);
      router.replace('/(auth)/login');
    } catch (error) {
      Alert.alert('Logout Error', error.message);
    }
  };

  // Show loading spinner while checking auth state
  if (loading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color="#1E90FF" />
      </View>
    );
  }

  // Main dashboard UI
  return (
    <View style={styles.dashboard}>
      {/* Main scrollable dashboard area */}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header with greeting and user avatar */}
        <View style={styles.header}>
          <Text style={styles.greetingText}>
            Hello, {user?.displayName || user?.email?.split('@')[0] || 'User'}!
          </Text>
          {/* Avatar button toggles profile menu */}
          <TouchableOpacity onPress={() => setShowProfileMenu(!showProfileMenu)}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {user?.displayName?.substring(0, 2) || 
                 user?.email?.substring(0, 2).toUpperCase() || 
                 'US'}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Profile dropdown menu for admin/profile/logout */}
        {showProfileMenu && (
          <View style={styles.profileMenu}>
            {isAdmin && (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setShowProfileMenu(false);
                  // Navigate to admin console
                  router.push('/(admin)/console'); 
                }}
              >
                <Text style={styles.menuText}>Admin Console</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setShowProfileMenu(false);
                // Navigate to profile page
                router.push('/admin/profile'); 
              }}
            >
              <Text style={styles.menuText}>Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleLogout}
            >
              <Text style={[styles.menuText, styles.logoutText]}>Logout</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Welcome message */}
        <Text style={styles.welcomeText}>Welcome to Eng Surveys</Text>

        {/* Quick action buttons for scanning, searching, assets */}
        <View style={styles.quickActions}>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => router.push('/(app)/scan')}
          >
            <MaterialIcons name="qr-code-scanner" size={35} color="#1E90FF" />
            <Text style={styles.actionText}>Scan</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => router.push('/(app)/multi-scan')}
          >
            <MaterialIcons name="sync-alt" size={30} color="#1E90FF" />
            <Text style={styles.actionText}>Multi-Scan</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => router.push('/(app)/search')}
          >
            <MaterialIcons name="search" size={30} color="#1E90FF" />
            <Text style={styles.actionText}>Search</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => router.push('/asset/assets')}
          >
            <MaterialIcons name="construction" size={30} color="#1E90FF" />
            <Text style={styles.actionText}>My Assets</Text>
          </TouchableOpacity>
        </View>

        {/* Shortcuts section - user can add up to four shortcuts */}
        <View style={styles.shortcutsSection}>
          <Text style={styles.sectionTitle}>SHORTCUTS</Text>
          <View style={styles.shortcutsGrid}>
            {shortcuts.map((shortcut, index) => (
              <TouchableOpacity 
                key={index} 
                style={styles.shortcutCard}
                onPress={() => Alert.alert('Shortcut', `Pressed ${shortcut}`)}
              >
                <Text style={styles.shortcutText}>{shortcut}</Text>
              </TouchableOpacity>
            ))}
            {shortcuts.length < 4 && (
              <TouchableOpacity 
                style={[styles.shortcutCard, styles.addShortcutCard]} 
                onPress={addShortcut}
              >
                <MaterialIcons name="add" size={36} color="#1E90FF" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* To Do List section - tasks assigned to the user */}
        <View style={styles.toDoList}>
          <Text style={styles.sectionTitle}>TO DO LIST</Text>
          <View style={styles.toDoCard}>
            <Text style={styles.toDoTitle}>Assigned To Me (1)</Text>
            <Text style={styles.toDoText}>Complete equipment survey</Text>
            <TouchableOpacity 
              style={styles.toDoButton}
              onPress={() => router.push('/(app)/tasks')}
            >
              <Text style={styles.toDoButtonText}>Open</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

// Prop types for Dashboard (isAdmin determines admin menu visibility)
Dashboard.propTypes = {
  isAdmin: PropTypes.bool
};

Dashboard.defaultProps = {
  isAdmin: false
};

// Styles for the dashboard screen and components
const styles = StyleSheet.create({
  dashboard: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  greetingText: {
    fontSize: 18,
    color: '#333',
    fontWeight: '500',
  },
  avatar: {
    backgroundColor: '#1E90FF',
    borderRadius: 25,
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
  },
  avatarText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  profileMenu: {
    backgroundColor: '#fff',
    position: 'absolute',
    top: 70,
    right: 20,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 10,
    minWidth: 160,
  },
  menuItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  menuItemLast: {
    borderBottomWidth: 0,
  },
  menuText: {
    fontSize: 16,
    color: '#333',
  },
  logoutText: {
    color: '#ff4444',
  },
  welcomeText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 25,
  },
  quickActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 25,
  },
  actionButton: {
    backgroundColor: '#fff',
    padding: 18,
    borderRadius: 12,
    width: '48%',
    alignItems: 'center',
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  actionText: {
    color: '#1E90FF',
    marginTop: 8,
    fontSize: 15,
    fontWeight: '500',
  },
  shortcutsSection: {
    marginBottom: 25,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#666',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  shortcutsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  shortcutCard: {
    backgroundColor: '#fff',
    padding: 18,
    borderRadius: 12,
    width: '48%',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    height: 100,
  },
  addShortcutCard: {
    borderWidth: 1,
    borderColor: '#1E90FF',
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  shortcutText: {
    color: '#333',
    fontSize: 15,
  },
  toDoList: {
    marginTop: 10,
  },
  toDoCard: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  toDoTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  toDoText: {
    color: '#666',
    marginBottom: 15,
    fontSize: 15,
  },
  toDoButton: {
    backgroundColor: '#1E90FF',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  toDoButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
});

export default Dashboard;