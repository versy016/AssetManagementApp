import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { getAuth } from 'firebase/auth';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import ActionsForm from '../../components/ActionsForm';

export default function ScannedAssetsList() {
  const router = useRouter();
  const { items: itemsParam, checkedIn: checkedInParam } = useLocalSearchParams();
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [checkedInAssets, setCheckedInAssets] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [users, setUsers] = useState([]);
  const [myUserId, setMyUserId] = useState(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showUserPicker, setShowUserPicker] = useState(false);
  const [showOtherPicker, setShowOtherPicker] = useState(false);
  const [actionsFormOpen, setActionsFormOpen] = useState(false);
  const [actionsFormType, setActionsFormType] = useState(null);
  const [bulkActionTargetIds, setBulkActionTargetIds] = useState([]);
  const [userSearch, setUserSearch] = useState('');

  // Parse the scanned items and checked-in assets from the URL params
  useEffect(() => {
    const fetchAssets = async () => {
      if (itemsParam) {
        try {
          setLoading(true);
          const parsedItems = JSON.parse(decodeURIComponent(itemsParam));
          const parsedCheckedIn = checkedInParam ? JSON.parse(decodeURIComponent(checkedInParam)) : [];

          const assetsWithDetails = await Promise.all(
            parsedItems.map(async (id) => {
              try {
                const response = await fetch(`${API_BASE_URL}/assets/${id}`);
                if (!response.ok) throw new Error('Failed to fetch asset details');
                const data = await response.json();
                return {
                  id,
                  name: data.model || data.asset_types?.name || `Asset ${id}`,
                  assetType: data.asset_types?.name || null,
                  status: 'pending',
                };
              } catch (error) {
                console.error(`Error fetching asset ${id}:`, error);
                return { id, name: `Asset ${id}`, assetType: null, status: 'error' };
              }
            })
          );

          setAssets(assetsWithDetails);
          setCheckedInAssets(parsedCheckedIn);
          setSelectedIds([]);
        } catch (e) {
          console.error('Error parsing items:', e);
          Alert.alert('Error', 'Failed to load scanned items');
        } finally {
          setLoading(false);
        }
      }
    };

    fetchAssets();
  }, [itemsParam, checkedInParam]);

  // Fetch users and resolve current user's DB id
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/users`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
        if (!res.ok || cancelled) return;
        const list = await res.json();
        if (!cancelled) setUsers(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setUsers([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const isAdmin = (() => {
    const auth = getAuth();
    const u = auth?.currentUser;
    if (!u?.email || !users.length) return false;
    const email = (u.email || '').toLowerCase();
    const me = users.find((x) => (x.useremail || '').toLowerCase() === email);
    return String(me?.role || '').toUpperCase() === 'ADMIN';
  })();

  useEffect(() => {
    const auth = getAuth();
    const u = auth?.currentUser;
    if (!u?.email || !users.length) {
      setMyUserId(null);
      return;
    }
    const email = (u.email || '').toLowerCase();
    const me = users.find((x) => (x.useremail || '').toLowerCase() === email);
    setMyUserId(me?.id ?? null);
  }, [users]);

  const toggleSelectAll = useCallback(() => {
    const pendingIds = assets.filter((a) => !checkedInAssets.includes(a.id)).map((a) => a.id);
    const allPendingSelected = pendingIds.length > 0 && pendingIds.every((id) => selectedIds.includes(id));
    setSelectedIds(allPendingSelected ? [] : pendingIds);
  }, [assets, checkedInAssets, selectedIds]);

  const toggleSelection = useCallback((assetId) => {
    if (checkedInAssets.includes(assetId)) return;
    setSelectedIds((prev) =>
      prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId]
    );
  }, [checkedInAssets]);

  const buildAuthHeaders = useCallback(async () => {
    const auth = getAuth();
    const u = auth?.currentUser;
    const headers = { 'Content-Type': 'application/json' };
    try {
      if (u?.getIdToken) {
        const token = await u.getIdToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      }
    } catch {}
    if (u?.uid) headers['X-User-Id'] = u.uid;
    if (u?.displayName) headers['X-User-Name'] = u.displayName;
    if (u?.email) headers['X-User-Email'] = u.email;
    return headers;
  }, []);

  const performBulkTransfer = useCallback(
    async (type, selectedUser = null) => {
      const ids = selectedIds.length ? selectedIds : assets.filter((a) => !checkedInAssets.includes(a.id)).map((a) => a.id);
      if (ids.length === 0) {
        Alert.alert('No selection', 'Select at least one asset or use "Select all".');
        return;
      }
      if (type === 'transferToUser' && !selectedUser) return;
      if (type === 'transferToMe' && !myUserId) {
        Alert.alert('Error', 'Your user record was not found. You must be logged in.');
        return;
      }

      setBulkLoading(true);
      setShowUserPicker(false);
      const headers = await buildAuthHeaders();
      const failed = [];
      let payload;
      if (type === 'transferToMe') {
        payload = { assigned_to_id: myUserId };
      } else if (type === 'transferToOffice') {
        payload = { assign_to_admin: true, status: 'In Service' };
      } else if (type === 'transferToUser' && selectedUser) {
        payload = { assigned_to_id: selectedUser.id, status: 'In Service' };
      } else {
        setBulkLoading(false);
        return;
      }

      for (const assetId of ids) {
        try {
          const res = await fetch(`${API_BASE_URL}/assets/${assetId}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(payload),
          });
          if (!res.ok) failed.push(assetId);
        } catch {
          failed.push(assetId);
        }
      }

      setBulkLoading(false);
      const successCount = ids.length - failed.length;
      setCheckedInAssets((prev) => [...new Set([...prev, ...ids])]);
      setSelectedIds([]);

      if (failed.length > 0) {
        Alert.alert(
          'Partial success',
          `${successCount} asset(s) transferred. ${failed.length} failed: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? '…' : ''}`
        );
      } else {
        Alert.alert('Done', `${successCount} asset(s) transferred successfully.`);
      }
    },
    [selectedIds, assets, checkedInAssets, myUserId, buildAuthHeaders]
  );

  const performBulkOther = useCallback(
    async (actionType) => {
      const ids = selectedIds.length ? selectedIds : assets.filter((a) => !checkedInAssets.includes(a.id)).map((a) => a.id);
      if (ids.length === 0) {
        Alert.alert('No selection', 'Select at least one asset or use "Select all".');
        return;
      }
      if (['Hire', 'End of Life'].includes(actionType) && !isAdmin) {
        Alert.alert('Admins only', 'Please contact an administrator for this action.');
        return;
      }
      setBulkLoading(true);
      setShowOtherPicker(false);
      const headers = await buildAuthHeaders();
      const failed = [];
      const today = new Date().toISOString().slice(0, 10);

      const actionEnum = {
        'Hire': 'HIRE',
        'End of Life': 'END_OF_LIFE',
        'Report Lost': 'LOST',
        'Report Stolen': 'STOLEN',
      }[actionType];
      const actionNote = `Bulk: ${actionType}`;

      for (const assetId of ids) {
        try {
          if (actionType === 'End of Life') {
            const putRes = await fetch(`${API_BASE_URL}/assets/${assetId}`, {
              method: 'PUT',
              headers,
              body: JSON.stringify({ status: 'End of Life' }),
            });
            if (!putRes.ok) {
              failed.push(assetId);
              continue;
            }
          }
          if (actionEnum) {
            const postRes = await fetch(`${API_BASE_URL}/assets/${assetId}/actions`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                type: actionEnum,
                note: actionNote,
                details: {},
                occurred_at: today,
              }),
            });
            if (!postRes.ok) failed.push(assetId);
          }
        } catch {
          failed.push(assetId);
        }
      }

      setBulkLoading(false);
      const successCount = ids.length - failed.length;
      setCheckedInAssets((prev) => [...new Set([...prev, ...ids])]);
      setSelectedIds([]);

      if (failed.length > 0) {
        Alert.alert(
          'Partial success',
          `${successCount} asset(s) updated. ${failed.length} failed: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? '…' : ''}`
        );
      } else {
        Alert.alert('Done', `${successCount} asset(s) updated successfully.`);
      }
    },
    [selectedIds, assets, checkedInAssets, isAdmin, buildAuthHeaders]
  );

  const handleCheckIn = async (assetId) => {
    try {
      setLoading(true);
      const updatedCheckedIn = [...new Set([...checkedInAssets, assetId])];
      const url = `/multi-scan/list?items=${encodeURIComponent(JSON.stringify(assets.map((a) => a.id)))}&checkedIn=${encodeURIComponent(JSON.stringify(updatedCheckedIn))}`;
      router.push({ pathname: `/check-in/${assetId}`, params: { returnTo: url } });
    } catch (error) {
      console.error('Error navigating to check-in:', error);
      Alert.alert('Error', 'Failed to navigate to check-in');
    } finally {
      setLoading(false);
    }
  };

  const pendingIds = assets.filter((a) => !checkedInAssets.includes(a.id)).map((a) => a.id);
  const allPendingSelected = pendingIds.length > 0 && pendingIds.every((id) => selectedIds.includes(id));
  const effectiveSelected = selectedIds.length > 0 ? selectedIds : (allPendingSelected ? pendingIds : []);
  const showBulkBar = effectiveSelected.length > 0;
  const filteredUsers = userSearch.trim()
    ? users.filter(
        (u) =>
          (u.name || '').toLowerCase().includes(userSearch.toLowerCase()) ||
          (u.useremail || '').toLowerCase().includes(userSearch.toLowerCase())
      )
    : users;

  const renderItem = ({ item }) => {
    const isProcessed = checkedInAssets.includes(item.id);
    const isSelected = selectedIds.includes(item.id);
    return (
      <View style={styles.card}>
        {!isProcessed && (
          <TouchableOpacity
            style={styles.checkboxWrap}
            onPress={() => toggleSelection(item.id)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons
              name={isSelected ? 'check-box' : 'check-box-outline-blank'}
              size={24}
              color={isSelected ? '#1E90FF' : '#999'}
            />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.cardContent}
          onPress={() => !loading && handleCheckIn(item.id)}
          disabled={loading}
        >
          <Image source={{ uri: 'https://via.placeholder.com/50' }} style={styles.image} />
          <View style={styles.info}>
            <Text style={styles.idLine}>
              ID: {item.id}{item.assetType ? ` · ${item.assetType}` : ''}
            </Text>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.status}>
              Status: {isProcessed ? 'Processed' : 'Pending'}
            </Text>
          </View>
          {isProcessed ? (
            <MaterialIcons name="check-circle" size={24} color="green" />
          ) : (
            <MaterialIcons name="arrow-forward-ios" size={16} color="#666" />
          )}
        </TouchableOpacity>
      </View>
    );
  };

  const allCheckedIn = assets.length > 0 && assets.every((asset) => checkedInAssets.includes(asset.id));

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <MaterialIcons name="arrow-back" size={24} color="#1E90FF" />
          </TouchableOpacity>
          <Text style={styles.title}>Scanned Assets</Text>
        </View>

        {assets.length > 0 && !loading && (
          <TouchableOpacity style={styles.selectAllRow} onPress={toggleSelectAll}>
            <MaterialIcons
              name={allPendingSelected ? 'check-box' : 'check-box-outline-blank'}
              size={22}
              color={allPendingSelected ? '#1E90FF' : '#666'}
            />
            <Text style={styles.selectAllText}>
              {allPendingSelected ? 'Deselect all' : 'Select all'} ({pendingIds.length} pending)
            </Text>
          </TouchableOpacity>
        )}

        {loading || bulkLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#1E90FF" />
            {bulkLoading && <Text style={styles.bulkLoadingText}>Updating…</Text>}
          </View>
        ) : (
          <FlatList
            data={assets}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
          />
        )}

        {showBulkBar && !bulkLoading && (
          <View style={styles.bulkBar}>
            <Text style={styles.bulkBarLabel}>{effectiveSelected.length} selected</Text>
            <View style={styles.bulkActions}>
              <TouchableOpacity
                style={[styles.bulkBtn, styles.bulkBtnPrimary]}
                onPress={() => performBulkTransfer('transferToMe')}
                disabled={!myUserId}
              >
                <MaterialIcons name="person" size={18} color="#fff" />
                <Text style={styles.bulkBtnText}>Transfer to me</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.bulkBtn, styles.bulkBtnPrimary]}
                onPress={() => performBulkTransfer('transferToOffice')}
              >
                <MaterialIcons name="business" size={18} color="#fff" />
                <Text style={styles.bulkBtnText}>Transfer to office</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.bulkBtn, styles.bulkBtnPrimary]}
                onPress={() => setShowUserPicker(true)}
              >
                <MaterialIcons name="person-add" size={18} color="#fff" />
                <Text style={styles.bulkBtnText}>Transfer to user</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.bulkBtn, styles.bulkBtnSecondary]}
                onPress={() => setShowOtherPicker(true)}
              >
                <MaterialIcons name="more-horiz" size={18} color="#1E90FF" />
                <Text style={styles.bulkBtnTextSecondary}>Other</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {allCheckedIn && (
          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => router.replace('/(tabs)/dashboard')}
          >
            <Text style={styles.doneButtonText}>Back to Dashboard</Text>
          </TouchableOpacity>
        )}
      </View>

      <Modal visible={showOtherPicker} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setShowOtherPicker(false)}
        />
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Other actions</Text>
            <TouchableOpacity onPress={() => setShowOtherPicker(false)}>
              <MaterialIcons name="close" size={24} color="#333" />
            </TouchableOpacity>
          </View>
          <View style={styles.otherActionsList}>
            {isAdmin && (
              <>
                <TouchableOpacity
                  style={styles.otherActionRow}
                  onPress={() => {
                    setBulkActionTargetIds(effectiveSelected);
                    setShowOtherPicker(false);
                    setActionsFormType('Hire');
                    setActionsFormOpen(true);
                  }}
                >
                  <MaterialIcons name="work-outline" size={22} color="#0369A1" />
                  <Text style={styles.otherActionLabel}>Hire</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.otherActionRow}
                  onPress={() => {
                    setBulkActionTargetIds(effectiveSelected);
                    setShowOtherPicker(false);
                    setActionsFormType('End of Life');
                    setActionsFormOpen(true);
                  }}
                >
                  <MaterialIcons name="remove-circle-outline" size={22} color="#B91C1C" />
                  <Text style={styles.otherActionLabel}>End of Life</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity
              style={styles.otherActionRow}
              onPress={() => {
                setBulkActionTargetIds(effectiveSelected);
                setShowOtherPicker(false);
                setActionsFormType('Report Lost');
                setActionsFormOpen(true);
              }}
            >
              <MaterialIcons name="lost-and-found" size={22} color="#D97706" />
              <Text style={styles.otherActionLabel}>Report Lost</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.otherActionRow}
              onPress={() => {
                setBulkActionTargetIds(effectiveSelected);
                setShowOtherPicker(false);
                setActionsFormType('Report Stolen');
                setActionsFormOpen(true);
              }}
            >
              <MaterialIcons name="warning-amber" size={22} color="#DC2626" />
              <Text style={styles.otherActionLabel}>Report Stolen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {bulkActionTargetIds.length > 0 && actionsFormType && (
        <ActionsForm
          visible={actionsFormOpen}
          onClose={() => {
            setActionsFormOpen(false);
            setActionsFormType(null);
          }}
          asset={{ id: bulkActionTargetIds[0] }}
          action={actionsFormType}
          additionalAssetIds={bulkActionTargetIds.slice(1)}
          apiBaseUrl={API_BASE_URL}
          users={users}
          onSubmitted={() => {
            setCheckedInAssets((prev) => [...new Set([...prev, ...bulkActionTargetIds])]);
            setSelectedIds([]);
            setActionsFormOpen(false);
            setActionsFormType(null);
            setBulkActionTargetIds([]);
            Alert.alert('Done', `${bulkActionTargetIds.length} asset(s) updated successfully.`);
          }}
        />
      )}

      <Modal visible={showUserPicker} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setShowUserPicker(false)}
        />
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Transfer to user</Text>
            <TouchableOpacity onPress={() => setShowUserPicker(false)}>
              <MaterialIcons name="close" size={24} color="#333" />
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.userSearchInput}
            placeholder="Search by name or email…"
            value={userSearch}
            onChangeText={setUserSearch}
            placeholderTextColor="#999"
          />
          <ScrollView style={styles.userList}>
            {filteredUsers.map((u) => (
              <TouchableOpacity
                key={u.id}
                style={styles.userRow}
                onPress={() => performBulkTransfer('transferToUser', u)}
              >
                <Text style={styles.userName}>{u.name || u.useremail || `User ${u.id}`}</Text>
                {u.useremail ? <Text style={styles.userEmail}>{u.useremail}</Text> : null}
              </TouchableOpacity>
            ))}
            {filteredUsers.length === 0 && (
              <Text style={styles.emptyUserText}>No users match</Text>
            )}
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  backButton: {
    marginRight: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  selectAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  selectAllText: {
    fontSize: 15,
    color: '#333',
    marginLeft: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bulkLoadingText: {
    marginTop: 8,
    fontSize: 14,
    color: '#666',
  },
  list: {
    paddingBottom: 120,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 8,
    paddingVertical: 12,
    paddingRight: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  checkboxWrap: {
    paddingLeft: 12,
    paddingRight: 8,
    justifyContent: 'center',
  },
  cardContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  image: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 16,
    backgroundColor: '#f0f0f0',
  },
  info: {
    flex: 1,
  },
  idLine: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 2,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  status: {
    fontSize: 14,
    color: '#666',
  },
  bulkBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  bulkBarLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
  },
  bulkActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  bulkBtn: {
    minWidth: '48%',
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
  },
  bulkBtnPrimary: {
    backgroundColor: '#1E90FF',
  },
  bulkBtnSecondary: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#1E90FF',
  },
  bulkBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  bulkBtnTextSecondary: {
    color: '#1E90FF',
    fontWeight: '600',
    fontSize: 14,
  },
  otherActionsList: {
    padding: 12,
  },
  otherActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    gap: 12,
  },
  otherActionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  doneButton: {
    backgroundColor: '#1E90FF',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  doneButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    marginHorizontal: 24,
    marginVertical: 80,
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  userSearchInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    margin: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  userList: {
    maxHeight: 280,
  },
  userRow: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  userEmail: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  emptyUserText: {
    padding: 16,
    color: '#666',
    textAlign: 'center',
  },
});
