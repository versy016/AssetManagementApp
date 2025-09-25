// [id].js - Asset check-in/transfer screen

// Import navigation and parameter hooks from Expo Router
import { useLocalSearchParams } from 'expo-router'; // For route parameters
// Import React and state/effect hooks
import React, { useEffect, useState } from 'react';
// Import core React Native UI components
import {
  View, Text, ActivityIndicator, Button, StyleSheet, TouchableOpacity, Alert, Modal, TextInput, FlatList, SafeAreaView
} from 'react-native';
// Import Firebase Auth for user authentication
import { getAuth } from 'firebase/auth';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

const router = useRouter();

import { API_BASE_URL } from '../../inventory-api/apiBase';

// Main component for asset check-in and transfer actions
export default function CheckInScreen() {
  const { id, returnTo } = useLocalSearchParams(); // Get asset ID and return URL from route params
  const router = useRouter();

  // State for loading spinner
  const [loading, setLoading] = useState(true);
  // State for current user info
  const [user, setUser] = useState(null);
  // State for asset details
  const [asset, setAsset] = useState(null);
  // State for error messages
  const [error, setError] = useState(null);
  // State for user selection modal
  const [showUserModal, setShowUserModal] = useState(false);
  const [users, setUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch user and asset data when component mounts
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Get Firebase Auth and current user
        const auth = getAuth();
        const currentUser = auth.currentUser;
        console.log("👤 Current user:", currentUser);

        if (currentUser) {
          setUser(currentUser); // Set user state if logged in
        } else {
          // For development: allow preview if not logged in
          console.warn("⚠️ Not logged in - allowing preview for dev");
          setUser({ uid: "guest" });
        }

        // Fetch asset details from backend
        if (!id) {
          setError("Invalid asset ID");
          setLoading(false);
          return;
        }

        // Fetch asset details
        const assetRes = await fetch(`${API_BASE_URL}/assets/${id}`);
        const contentType = assetRes.headers.get('content-type');
        if (!assetRes.ok || !contentType?.includes('application/json')) {
          const text = await assetRes.text();
          throw new Error(`Unexpected response: ${text}`);
        }
        const assetData = await assetRes.json();
        
        // If asset has an assigned user, use the nested user data
        if (assetData.assigned_to_id && assetData.users) {
          // Use the nested user data if available
          assetData.assigned_user_name = assetData.users.name || 
                                       assetData.users.useremail || 
                                       `User ${assetData.assigned_to_id}`;
        } else if (assetData.assigned_to_id) {
          // Fallback to fetching user details if not in the nested data
          try {
            const userRes = await fetch(`${API_BASE_URL}/users/${assetData.assigned_to_id}`);
            if (userRes.ok) {
              const userData = await userRes.json();
              assetData.assigned_user_name = userData.name || 
                                           userData.useremail || 
                                           `User ${assetData.assigned_to_id}`;
            }
          } catch (userError) {
            console.error('Error fetching user details:', userError);
            assetData.assigned_user_name = `User ${assetData.assigned_to_id}`;
          }
        }

        console.log("📦 Asset data:", assetData);
        setAsset(assetData); // Store asset info with user name
      } catch (err) {
        // Handle fetch or network errors
        console.error("❌ Error in Check-In screen:", err);
        setError(err.message);
      } finally {
        setLoading(false); // Hide loading spinner
      }
    };

    fetchData(); // Run on mount
    // Fetch all users when component mounts
    const fetchUsers = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/users`);
        if (response.ok) {
          const userList = await response.json();
          setUsers(userList);
          setFilteredUsers(userList);
        }
      } catch (err) {
        console.error('Error fetching users:', err);
      }
    };

    fetchUsers();
  }, [id]);

  // Filter users based on search query
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredUsers(users);
    } else {
      const filtered = users.filter(user => 
        user.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.useremail?.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredUsers(filtered);
    }
  }, [searchQuery, users]);

  // Handle transfer to selected user
  const handleTransferToUser = async (selectedUser) => {
    try {
      setLoading(true);
      
      const updateResponse = await fetch(`${API_BASE_URL}/assets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigned_to_id: selectedUser.id,
          status: 'In Use'
        }),
      });

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        throw new Error(errorText || 'Failed to transfer asset');
      }

      setShowUserModal(false);
      Alert.alert('Success', `Asset transferred to ${selectedUser.name || selectedUser.useremail} successfully`, [
        {
          text: 'OK',
          onPress: () => {
            if (returnTo) {
              router.replace(returnTo);
            } else {
              router.replace('/(tabs)/Inventory');
            }
          },
        },
      ]);
    } catch (err) {
      console.error('Error in transfer:', err);
      Alert.alert('Error', err.message || 'Failed to transfer asset');
    } finally {
      setLoading(false);
    }
  };

  // Handle check-in or transfer button actions
  const handleAction = async (type) => {
    if (!asset || !user) return; // Guard: must have asset and user

    let assignedToId = null; // Will hold the user ID to assign asset to
    let status = '';
    let successMessage = '';

    try {
      setLoading(true);

      if (type === 'checkin') {
        // For check-in, assign asset to admin user
        const response = await fetch(`${API_BASE_URL}/users`);
        const users = await response.json();
        const adminUser = users.find(u => u.useremail === 'admin@engsurveys.com.au');
        if (!adminUser) {
          alert('Admin user not found');
          return;
        }
        assignedToId = adminUser.id;
        status = 'Available';
        successMessage = 'Asset checked in successfully';
      } else if (type === 'transfer') {
        // For transfer, assign asset to current user
        assignedToId = user?.uid;
        status = 'In Use';
        successMessage = 'Asset transferred to you successfully';
      }

      // Update the asset
      const updateResponse = await fetch(`${API_BASE_URL}/assets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigned_to_id: assignedToId,
          status: status
        }),
      });

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        throw new Error(errorText || 'Failed to update asset');
      }

      // Show success message and navigate back
      Alert.alert('Success', successMessage, [
        {
          text: 'OK',
          onPress: () => {
            if (returnTo) {
              // If returnTo is provided, navigate there
              router.replace(returnTo);
            } else {
              // Otherwise, go to inventory
              router.replace('/(tabs)/Inventory');
            }
          },
        },
      ]);
    } catch (err) {
      console.error('Error in handleAction:', err);
      Alert.alert('Error', err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  // Render user selection modal
  const renderUserModal = () => (
    <Modal
      visible={showUserModal}
      animationType="slide"
      transparent={false}
      onRequestClose={() => setShowUserModal(false)}
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select User</Text>
            <TouchableOpacity onPress={() => setShowUserModal(false)}>
              <MaterialIcons name="close" size={24} color="#000" />
            </TouchableOpacity>
          </View>
          
          <View style={styles.searchContainer}>
            <MaterialIcons name="search" size={20} color="#999" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search users..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
            />
          </View>

          <FlatList
            data={filteredUsers}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity 
                style={styles.userItem}
                onPress={() => handleTransferToUser(item)}
                disabled={loading}
              >
                <View>
                  <Text style={styles.userName}>{item.name || 'No Name'}</Text>
                  <Text style={styles.userEmail}>{item.useremail}</Text>
                </View>
                {loading && <ActivityIndicator size="small" />}
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text>No users found</Text>
              </View>
            }
          />
        </View>
      </SafeAreaView>
    </Modal>
  );

  // Show loading spinner while fetching data
  if (loading && !showUserModal) return <ActivityIndicator style={{ flex: 1 }} size="large" />;

  // Show error message if fetch failed
  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>⚠️ Error</Text>
        <Text style={{ color: 'red' }}>{error}</Text>
      </View>
    );
  }

  // Show fallback if asset or user is missing
  if (!asset || !user) {
    return (
      <View style={styles.container}>
        <Text style={{ color: 'red' }}>Missing asset or user data.</Text>
      </View>
    );
  }

  // Main UI for check-in/transfer actions
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Screen title */}
        <Text style={styles.title}>Check-In / Transfer</Text>
        {/* Asset info */}
        <Text style={styles.subtext}>Asset ID: {asset.id}</Text>
        <Text style={styles.subtext}>Model: {asset.model || '—'}</Text>
        {asset.assigned_to_id && (
          <Text style={styles.subtext}>
            Assigned to: {asset.assigned_user_name || `User ${asset.assigned_to_id}`}
          </Text>
        )}
        {/* Action buttons */}
        <View style={{ marginTop: 30 }}>
          <Text style={styles.optionTitle}>Choose an action:</Text>
          {/* Button to check in asset to admin */}
          <TouchableOpacity
            style={[styles.button, { backgroundColor: 'green' }]}
            onPress={() => handleAction('checkin')}
          >
            <Text style={styles.buttonText}>Check In to Office</Text>
          </TouchableOpacity>

          {asset.assigned_to_id === user?.uid ? (
            <TouchableOpacity
              style={[styles.button, { backgroundColor: 'blue' }]}
              onPress={() => setShowUserModal(true)}
            >
              <Text style={styles.buttonText}>Transfer Asset</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.button, { backgroundColor: 'blue' }]}
              onPress={() => handleAction('transfer')}
            >
              <Text style={styles.buttonText}>Transfer to Me</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.button, { backgroundColor: 'gray' }]}
            onPress={() => router.replace('/dashboard')}
          >
            <Text style={styles.buttonText}>Go Back to Dashboard</Text>
          </TouchableOpacity>
        </View>

        {renderUserModal()}
      </View>
    </SafeAreaView>
  );
}

// Styles for the check-in/transfer screen
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  container: {
    flex: 1,                   // Take full height
    padding: 20,               // Padding around content
    justifyContent: 'center',  // Center content vertically
    backgroundColor: '#ffffff', // White background

  },
  title: {
    fontSize: 22,              // Large font for title
    fontWeight: 'bold',        // Bold font
    marginBottom: 10,          // Space below title
  },
  subtext: {
    fontSize: 16,              // Subtext font size
    marginVertical: 3,         // Vertical margin for subtext
  },
  optionTitle: {
    fontSize: 18,              // Font size for action title
    marginBottom: 8,           // Space below action title
    fontWeight: '600',         // Semi-bold
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginVertical: 5,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    height: 40,
    fontSize: 16,
  },
  userItem: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  userName: {
    fontSize: 16,
    fontWeight: '500',
  },
  userEmail: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
});
