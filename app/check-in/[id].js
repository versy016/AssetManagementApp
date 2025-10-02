// [id].js — Clean Light Theme Check‑In / Transfer Screen

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  FlatList,
  Animated,
  Platform,
  ScrollView,
  InteractionManager,
} from 'react-native';
import { getAuth } from 'firebase/auth';
import ActionsForm from '../../components/ActionsForm';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { API_BASE_URL } from '../../inventory-api/apiBase';

// ---------- Helpers (Light Theme) ----------
const Colors = {
  bg: '#FFFFFF',
  card: '#FFFFFF',
  border: '#E5E7EB',
  text: '#111827',
  subtle: '#6B7280',
  muted: '#9CA3AF',
  green: '#16A34A',
  blue:  '#2563EB',
  slate: '#64748B',
  red:   '#DC2626',
  // Add these two:
  amber: '#F59E0B',
  purple:'#7C3AED',
};

const badgeTone = (status) => {
  const s = String(status || '').toLowerCase();
  if (s.includes('repair')) return { bg: '#FFF7ED', fg: '#9A3412' };
  if (s.includes('maintenance')) return { bg: '#F5F3FF', fg: '#6D28D9' };
  if (s.includes('end of life')) return { bg: '#FEF2F2', fg: '#B91C1C' };
  if (s.includes('in service')) return { bg: '#ECFDF5', fg: '#065F46' };
  return { bg: '#F3F4F6', fg: '#374151' };
};

const Chip = ({ label, tone }) => (
  <View style={[styles.chip, { backgroundColor: tone?.bg, borderColor: Colors.border }]}> 
    <Text style={[styles.chipText, { color: tone?.fg }]}>{label}</Text>
  </View>
);

const AvatarCircle = ({ name, email }) => {
  const initials = useMemo(() => {
    const source = name || email || '?';
    const matches = source
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((x) => x[0]?.toUpperCase())
      .join('');
    return matches || '?';
  }, [name, email]);
  return (
    <View style={styles.avatar}>
      <Text style={{ color: Colors.text, fontWeight: '700' }}>{initials}</Text>
    </View>
  );
};

// ---------- Main Screen ----------
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
  const [myUserId, setMyUserId] = useState(null);
  const nameForUser = (dbUserId) => {
    const u = users.find(x => x.id === dbUserId);
    return (u?.name || u?.useremail || (dbUserId ? `User ${dbUserId}` : 'Unassigned'));
  };
  const [showOtherModal, setShowOtherModal] = useState(false);
  const [actionsFormOpen, setActionsFormOpen] = useState(false);
  const [actionsFormType, setActionsFormType] = useState(null); 
  const applyAssetPatch = (patch) => {
    setAsset(prev => {
      const next = { ...prev, ...patch };
      if (Object.prototype.hasOwnProperty.call(patch, 'assigned_to_id')) {
        next.assigned_user_name = nameForUser(patch.assigned_to_id);
      }
      return next;
    });
  };
  useEffect(() => {
    const email = (user?.email || '').toLowerCase();
    if (!email || !users?.length) return;
    const me = users.find(u => u.useremail?.toLowerCase() === email);
    setMyUserId(me?.id ?? null);
  }, [user, users]);

  // subtle page fade‑in
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, [fade]);

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
    if (!searchQuery.trim()) return setFilteredUsers(users);
    const q = searchQuery.toLowerCase();
    setFilteredUsers(
      users.filter((u) => u.name?.toLowerCase().includes(q) || u.useremail?.toLowerCase().includes(q))
    );
  }, [searchQuery, users]);

  // Handle transfer to selected user
 const handleTransferToUser = async (selectedUser) => {
  try {
    setLoading(true);

    const updateResponse = await fetch(`${API_BASE_URL}/assets/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(user?.uid ? { 'X-User-Id': user.uid } : {}) },
      body: JSON.stringify({
        assigned_to_id: selectedUser.id,
        status: 'In Service', // allowed value
      }),
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      throw new Error(errorText || 'Failed to transfer asset');
    }

    // Optimistic local update
    applyAssetPatch({ assigned_to_id: selectedUser.id, status: 'In Service' });
    setShowUserModal(false);
    setLoading(false);
    postActionAlert({
      message: `Asset transferred to ${selectedUser.name || selectedUser.useremail}`,
    });
  } catch (err) {
    console.error('Error in transfer:', err);
    Alert.alert('Error', err.message || 'Failed to transfer asset');
  } finally {
    setLoading(false);
  }
};


  // Handle check-in or transfer button actions
const handleAction = async (type) => {
  if (!asset || !user) return;

  let payload = {};
  let successMessage = '';

  try {
    setLoading(true);

    if (type === 'checkin') {
      // assign back to office admin and mark usable
      const adminUser = users.find(u => u.useremail?.toLowerCase() === 'admin@engsurveys.com.au');
      if (!adminUser) throw new Error('Admin user not found');

      payload = {
        assigned_to_id: adminUser.id,
        status: 'In Service',          // was "Available"
      };
      successMessage = 'Asset checked in successfully';
    } else if (type === 'transferToMe') {
      if (!myUserId) throw new Error('Your user record was not found');

      payload = {
        assigned_to_id: myUserId,
        // Leave status unchanged. If you must set one, use 'In Service'
        // status: 'In Service',
      };
      successMessage = 'Asset assigned to you';
    } else if (type === 'transfer') {
      // handled via modal (handleTransferToUser)
      return;
    } else {
      throw new Error(`Unknown action: ${type}`);
    }

    const res = await fetch(`${API_BASE_URL}/assets/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(user?.uid ? { 'X-User-Id': user.uid } : {}) },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || 'Failed to update asset');
    }

     // Optimistic local update so UI reflects immediately
    applyAssetPatch(payload);
    // Optional: tiny success hint; stays on page
    setLoading(false); // stop spinner first
    postActionAlert({ message: successMessage });
    return;   
  } catch (err) {
    console.error('Error in handleAction:', err);
    Alert.alert('Error', err.message || 'An error occurred');
  } finally {
    setLoading(false);
  }
};

 const handleOtherAction = (key) => {
   // Map keys from the list to the EXACT action labels ActionsForm expects
   const map = {
     hire: 'Hire',
     eol: 'End of Life',
     lost: 'Report Lost',
     stolen: 'Report Stolen',
   };
   setShowOtherModal(false);
   setActionsFormType(map[key]);
   setActionsFormOpen(true);
 };


  // ----- Status updaters (footer buttons) -----
const updateStatus = async (newStatus) => {
  try {
    setLoading(true);
    const body = {
      status: newStatus,
      // preserve current assignment; backend should upsert only fields sent
      assigned_to_id: asset?.assigned_to_id ?? null,
    };

    const res = await fetch(`${API_BASE_URL}/assets/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || `Failed to set status: ${newStatus}`);
    }

    applyAssetPatch({ status: newStatus });
    setLoading(false); // stop spinner first
    postActionAlert({ message: `Status updated to "${newStatus}"` });
  } catch (e) {
    console.error('updateStatus error', e);
    Alert.alert('Error', e.message || 'Failed to update status');
  } finally {
    setLoading(false);
  }
};

const markRepair = () => updateStatus('Repair');
const markMaintenance = () => updateStatus('Maintenance');


// Reusable post-action alert (waits for UI to settle)
// Reusable post-action alert (cross-platform)
const postActionAlert = ({
  title = 'Success',
  message = 'Action completed.',
  stayLabel = 'Stay here',
  goLabel = 'Go to Dashboard',
  onStay,
  onGo,
} = {}) => {
  const goToDashboard = () => router.replace('/dashboard');

  // Ensure UI is idle before showing native alert (Android/iOS)
  const showNativeAlert = () => {
    InteractionManager.runAfterInteractions(() => {
      Alert.alert(title, message, [
        { text: stayLabel, style: 'default', onPress: onStay || (() => {}) },
        { text: goLabel,  style: 'default', onPress: onGo || goToDashboard },
      ]);
    });
  };

  if (Platform.OS === 'web') {
    // Use a reliable browser confirm dialog on web
    const go = window.confirm(
      `${title}\n\n${message}\n\nPress "OK" to ${goLabel.toLowerCase()}, or "Cancel" to ${stayLabel.toLowerCase()}.`
    );
    if (go) (onGo || goToDashboard)();
    else    (onStay || (() => {}))();
  } else {
    showNativeAlert();
  }
};


  // Render user selection modal
  const renderUserModal = () => (
    <Modal visible={showUserModal} animationType="slide" transparent onRequestClose={() => setShowUserModal(false)}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Transfer to User</Text>
            <TouchableOpacity onPress={() => setShowUserModal(false)}>
              <MaterialIcons name="close" size={24} color={Colors.subtle} />
            </TouchableOpacity>
          </View>
          <View style={styles.searchContainer}>
            <MaterialIcons name="search" size={20} color={Colors.muted} style={{ marginRight: 8 }} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search name or email"
              placeholderTextColor={Colors.muted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
            />
          </View>
          <FlatList
            data={filteredUsers}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ paddingBottom: 16 }}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.userRow} onPress={() => handleTransferToUser(item)} disabled={loading}>
                <AvatarCircle name={item.name} email={item.useremail} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.userName}>{item.name || 'No Name'}</Text>
                  <Text style={styles.userEmail}>{item.useremail}</Text>
                </View>
                <MaterialIcons name="chevron-right" size={22} color={Colors.muted} />
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={{ padding: 24, alignItems: 'center' }}>
                <Text style={{ color: Colors.muted }}>No users found</Text>
              </View>
            }
          />
        </View>
      </View>
    </Modal>
  );

  const renderOtherActionsModal = () => (
  <Modal
    visible={showOtherModal}
    animationType="slide"
    transparent
    onRequestClose={() => setShowOtherModal(false)}
  >
    <View style={styles.sheetBackdrop}>
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Other Actions</Text>
          <TouchableOpacity onPress={() => setShowOtherModal(false)}>
            <MaterialIcons name="close" size={24} color={Colors.subtle} />
          </TouchableOpacity>
        </View>

        <View style={{ paddingVertical: 8 }}>
          {/* Hire (opens transfer picker) */}
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => handleOtherAction('hire')}
            disabled={loading}
          >
            <MaterialIcons name="person-add-alt" size={22} color={Colors.blue} />
            <Text style={styles.actionText}>Hire</Text>
          </TouchableOpacity>

          {/* End of Life */}
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => handleOtherAction('eol')}
            disabled={loading}
          >
            <MaterialIcons name="do-not-disturb" size={22} color={Colors.red} />
            <Text style={styles.actionText}>End of Life</Text>
          </TouchableOpacity>

          {/* Report lost */}
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => handleOtherAction('lost')}
            disabled={loading}
          >
            <MaterialIcons name="report-gmailerrorred" size={22} color={Colors.slate} />
            <Text style={styles.actionText}>Report lost</Text>
          </TouchableOpacity>

          {/* Report stolen */}
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => handleOtherAction('stolen')}
            disabled={loading}
          >
            <MaterialIcons name="report" size={22} color={Colors.slate} />
            <Text style={styles.actionText}>Report stolen</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  </Modal>
);


  // ---------- Render ----------
  if (loading && !showUserModal) {
    return (
      <SafeAreaView style={[styles.safeArea, { justifyContent: 'center', alignItems: 'center' }]}> 
        <ActivityIndicator size="large" color={Colors.blue} />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerBox}>
          <MaterialIcons name="error-outline" size={28} color={Colors.red} />
          <Text style={[styles.title, { marginTop: 8 }]}>Something went wrong</Text>
          <Text style={{ color: Colors.subtle, textAlign: 'center' }}>{error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!asset || !user) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerBox}>
          <Text style={{ color: Colors.subtle }}>Missing asset or user data.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const tone = badgeTone(asset.status);

  return (
    <SafeAreaView style={styles.safeArea}>
      <Animated.View style={{ flex: 1, opacity: fade }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
          {/* Header Card */}
          <View style={styles.headerCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={styles.heroIconWrap}>
                <MaterialIcons name="inventory-2" size={26} color={Colors.text} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.pageTitle}>Check‑In / Transfer</Text>
                <Text style={styles.pageSubtitle}>Fast actions for this asset</Text>
              </View>
            </View>
          </View>

       {/* Asset Overview */}
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.assetTitle}>{asset.model || 'Asset'}</Text>
            <View style={styles.idPill}>
              <Text style={styles.idPillText}>#{asset.id}</Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            {/* Assigned to (left) */}
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Assigned to</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                <AvatarCircle name={asset.assigned_user_name} email={asset.assigned_user_email} />
                <Text style={styles.infoValue} numberOfLines={1}>
                  {asset.assigned_user_name || 'Unassigned'}
                </Text>
              </View>
            </View>

            {/* Current Status (right) */}
            <View style={[styles.infoCell, styles.infoCellRight]}>
              <Text style={[styles.infoLabel, styles.textRight]}>Current Status</Text>
              <View style={{ marginTop: 6, alignSelf: 'flex-end' }}>
                <Chip label={asset.status || 'N/A'} tone={badgeTone(asset.status)} />
              </View>
            </View>
          </View>
        </View>


          {/* Quick Actions (as requested) */}
          {/* Quick Actions */}
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.tileGrid}>

            {/* Transfer to Office (was "Check In") */}
            <TouchableOpacity
              style={[styles.tile, { backgroundColor: '#F0FDF4' }]}
              onPress={() => handleAction('checkin')}
              disabled={loading}
            >
              <MaterialIcons name="assignment-turned-in" size={20} color={Colors.green} />
              <Text style={[styles.tileText, { color: Colors.green }]}>Transfer to Office</Text>
            </TouchableOpacity>

            {/* Transfer (ALWAYS visible) */}
            <TouchableOpacity
              style={[styles.tile, { backgroundColor: '#EFF6FF' }]}
              onPress={() => setShowUserModal(true)}
              disabled={loading}
            >
              <MaterialIcons name="swap-horiz" size={20} color={Colors.blue} />
              <Text style={[styles.tileText, { color: Colors.blue }]}>Transfer</Text>
            </TouchableOpacity>

            {/* Transfer to Me (only if logged in AND not already assigned to me) */}
            {(myUserId && asset.assigned_to_id !== myUserId) && (
              <TouchableOpacity
                style={[styles.tile, { backgroundColor: '#EFF6FF' }]}
                onPress={() => handleAction('transferToMe')}
                disabled={loading}
              >
                <MaterialIcons name="person-add" size={20} color={Colors.blue} />
                <Text style={[styles.tileText, { color: Colors.blue }]}>Transfer to Me</Text>
              </TouchableOpacity>
            )}

            {/* Back to Dashboard */}
            <TouchableOpacity
              style={[styles.tile, { backgroundColor: '#F9FAFB' }]}
              onPress={() => router.replace('/dashboard')}
            >
              <MaterialIcons name="dashboard" size={20} color={Colors.slate} />
              <Text style={[styles.tileText, { color: Colors.slate }]}>Back to Dashboard</Text>
            </TouchableOpacity>

          </View>

        </ScrollView>

        {/* Sticky Footer Bar (Repair & Maintenance only) */}
        <View style={styles.footerBar}>
          <TouchableOpacity
            style={[styles.footerBtn, { backgroundColor: Colors.amber }]}
            onPress={() => { setActionsFormType('Repair'); setActionsFormOpen(true); }}
          >
            <MaterialIcons name="build" size={20} color="#FFFFFF" />
            <Text style={styles.footerBtnText}>Repair</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.footerBtn, { backgroundColor: Colors.purple }]}
            onPress={() => { setActionsFormType('Maintenance'); setActionsFormOpen(true); }}
          >
            <MaterialIcons name="build-circle" size={20} color="#FFFFFF" />
            <Text style={styles.footerBtnText}>Maintenance</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.footerBtn, { backgroundColor: Colors.slate }]}
              onPress={() => setShowOtherModal(true)}          >
            <MaterialIcons name="more-horiz" size={20} color="#FFFFFF" />
            <Text style={styles.footerBtnText}>Other Actions</Text>
          </TouchableOpacity>
        </View>

      </Animated.View>
          <ActionsForm
            visible={actionsFormOpen}
            onClose={() => setActionsFormOpen(false)}
            asset={asset}
            action={actionsFormType}
            apiBaseUrl={API_BASE_URL}
            users={users}
            onSubmitted={(updatedPartial, meta) => {
              // Optimistic UI update
              if (updatedPartial && Object.keys(updatedPartial).length) {
                setAsset(prev => ({ ...prev, ...updatedPartial }));
              }
              postActionAlert({ message: 'Asset updated successfully' });
            }}
          />

      {renderUserModal()}
      {renderOtherActionsModal()}
    </SafeAreaView>
  );
}

// ---------- Styles ----------
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.bg },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },

  headerCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  heroIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pageTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' },
  pageSubtitle: { color: Colors.subtle, fontSize: 13, marginTop: 2 },

  card: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 16,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  assetTitle: { color: Colors.text, fontSize: 18, fontWeight: '700' },
  idPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  idPillText: { color: Colors.slate, fontWeight: '700', letterSpacing: 0.4 },

  infoGrid: { flexDirection: 'row', marginTop: 14 },
  infoCell: { flex: 1, paddingRight: 12 },
  infoLabel: { color: Colors.subtle, fontSize: 12, letterSpacing: 0.4 },
  infoValue: { color: Colors.text, fontSize: 15, fontWeight: '700', marginTop: 2, flexShrink: 1 },

  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },

  sectionTitle: { color: Colors.subtle, fontSize: 14, fontWeight: '700', marginBottom: 10, marginTop: 6, letterSpacing: 0.5 },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: {
    flexBasis: '48%',
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 16,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  tileText: { color: Colors.text, fontWeight: '800' },

  footerBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    backgroundColor: Colors.bg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  footerBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  footerBtnText: { color: '#FFFFFF', fontWeight: '800' },

  // Modal / Bottom Sheet (light)
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    maxHeight: '80%',
  },
  sheetHandle: {
    width: 44,
    height: 5,
    backgroundColor: Colors.border,
    borderRadius: 999,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  modalTitle: { color: Colors.text, fontSize: 16, fontWeight: '800' },
  searchContainer: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchInput: { flex: 1, height: 40, color: Colors.text },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  userName: { color: Colors.text, fontWeight: '700' },
  userEmail: { color: Colors.subtle, marginTop: 2, fontSize: 12 },

  avatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  infoRow: {
  flexDirection: 'row',
  alignItems: 'center',
  marginTop: 14,
},

infoCell: {
  flex: 1,
  paddingRight: 12,
},

infoCellRight: {
  alignItems: 'flex-end',   // <-- key: push content to the right
  paddingRight: 0,
},

textRight: {
  textAlign: 'right',
},
actionRow: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 12,
  paddingHorizontal: 16,
  paddingVertical: 14,
  borderTopWidth: 1,
  borderTopColor: Colors.border,
},
actionText: {
  color: Colors.text,
  fontWeight: '700',
},

});
