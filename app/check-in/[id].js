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
  KeyboardAvoidingView,
} from 'react-native';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import ActionsForm from '../../components/ActionsForm';
// NOTE: Avoid static import of expo-location to prevent SSR/import loops on web.
// We'll require it dynamically at runtime when needed.
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as LinkingExpo from 'expo-linking';

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
  const [isAdmin, setIsAdmin] = useState(false);
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
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapIdInput, setSwapIdInput] = useState('');
  const [lookup, setLookup] = useState({ model: '', type: '', assigned: '' });
  const [lookupResults, setLookupResults] = useState([]);
  const [lookupSelected, setLookupSelected] = useState(null);
  const [allAssets, setAllAssets] = useState([]);
  const swapScrollRef = useRef(null);
  const lookupSectionYRef = useRef(0);
  const modelYRef = useRef(0);
  const typeYRef = useRef(0);
  const assignedYRef = useRef(0);
  const [lookupFocus, setLookupFocus] = useState(null); // 'model' | 'type' | 'assigned'
  // Assign Imported Asset modal state
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignQuery, setAssignQuery] = useState('');
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignResults, setAssignResults] = useState([]);
  const [assignSelected, setAssignSelected] = useState(null);
  // When true, immediately open user picker after assigning imported asset and prevent dismiss
  const [forceUserAssign, setForceUserAssign] = useState(false);
  // Free-form action note captured during check-in/transfer
  const [actionNote, setActionNote] = useState('');
  // EOL detection: hide actions for decommissioned QRs
  const isEOL = React.useMemo(() => {
    const s = String(asset?.status || '').toLowerCase();
    return s === 'end of life';
  }, [asset]);
  
  const isAssignedToAdmin = React.useMemo(() => {
    try {
      if (!asset?.assigned_to_id) {
        console.log('No assigned_to_id, not assigned to admin');
        return false;
      }

      // If we don't have the users list yet, we can't determine if user is admin
      if (!Array.isArray(users) || users.length === 0) {
        console.log('Users list not loaded yet, assuming not admin');
        return false;
      }

      // Find the assigned user in our users list
      const assignedUser = users.find(u => String(u.id) === String(asset.assigned_to_id));
      
      if (!assignedUser) {
        console.log('Assigned user not found in users list, assuming not admin');
        return false;
      }

      // Check if user email contains 'admin@' (case insensitive)
      const userEmail = String(assignedUser.useremail || '').toLowerCase();
      const isAdmin = userEmail.startsWith('admin@');

      console.log('Assigned user check:', {
        userId: assignedUser.id,
        name: assignedUser.name,
        email: userEmail,
        isAdmin: isAdmin
      });

      return isAdmin;
    } catch (error) {
      console.error('Error checking if assigned to admin:', error);
      return false; // On error, default to not admin
    }
  }, [asset, users]);
  // Multi-scan context parsed from returnTo
  const multiScanCtx = useMemo(() => {
    if (!returnTo) return null;
    try {
      const url = new URL('https://x' + String(returnTo));
      const itemsRaw = url.searchParams.get('items') || '[]';
      const checkedRaw = url.searchParams.get('checkedIn') || '[]';
      const items = JSON.parse(decodeURIComponent(itemsRaw));
      const checked = JSON.parse(decodeURIComponent(checkedRaw));
      const allChecked = Array.isArray(items) && items.length > 0 && items.every((v) => (checked || []).includes(v));
      return { items: Array.isArray(items) ? items : [], checked: Array.isArray(checked) ? checked : [], allChecked };
    } catch {
      return { items: [], checked: [], allChecked: false };
    }
  }, [returnTo]);
  const handleBackToScanned = React.useCallback(() => {
    if (!returnTo) return;
    if (forceUserAssign) {
      Alert.alert('Required', 'Please select a user to assign this asset before leaving.');
      return;
    }
    try { router.replace(String(returnTo)); } catch { router.back(); }
  }, [returnTo, forceUserAssign]);

  // Reset lookup results whenever the swap sheet is opened
  useEffect(() => {
    if (swapOpen) { setLookupResults([]); setLookupSelected(null); }
  }, [swapOpen]);

  // Preload assets list when opening the swap sheet (for live suggestions)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!swapOpen) return;
      if (allAssets.length) return;
      try {
        const r = await fetch(`${API_BASE_URL}/assets`);
        const data = await r.json();
        if (!cancelled) setAllAssets(Array.isArray(data) ? data : []);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [swapOpen]);

  // Live filter suggestions as user types
  useEffect(() => {
    if (!swapOpen) return;
    const hasAny = [lookup.model, lookup.type, lookup.assigned].some(v => String(v || '').trim().length >= 2);
    if (!hasAny) { setLookupResults([]); setLookupSelected(null); return; }
    const q = {
      model: String(lookup.model || '').trim().toLowerCase(),
      type: String(lookup.type || '').trim().toLowerCase(),
      assigned: String(lookup.assigned || '').trim().toLowerCase(),
    };
    const idIsQR = (s) => /^[A-Z0-9]{8}$/i.test(String(s || ''));
    const isPlaceholder = (it) => {
      const hasDyn = it && it.fields && Object.keys(it.fields || {}).length > 0;
      return !it?.serial_number && !it?.model && !it?.assigned_to_id && !it?.type_id && !it?.documentation_url && !it?.image_url && !hasDyn;
    };
    const matches = (allAssets || [])
      .filter((it) => {
        // Only show real 8-char QR IDs, exclude placeholders or temp/imported records
        if (!idIsQR(it?.id)) return false;               // must be 8-char QR id
        if (!it?.type_id) return false;                  // must be a real asset type
        if (!it?.model && !it?.serial_number) return false; // require some concrete identity
        if (isPlaceholder(it)) return false;             // defensive guard
        const model = String(it?.model || '').toLowerCase();
        const type  = String(it?.asset_types?.name || it?.type || '').toLowerCase();
        const assigned = String(it?.users?.name || it?.users?.useremail || '').toLowerCase();
        return (!q.model || model.includes(q.model)) && (!q.type || type.includes(q.type)) && (!q.assigned || assigned.includes(q.assigned));
      })
      .slice(0, 10);
    setLookupResults(matches);
    // clear any selected if it no longer appears
    if (lookupSelected && !matches.find(m => m.id === lookupSelected.id)) setLookupSelected(null);
  }, [lookup, allAssets, swapOpen]);

  const scrollToLookup = () => {
    try {
      const y = typeof lookupSectionYRef.current === 'number' ? lookupSectionYRef.current : 0;
      if (swapScrollRef.current?.scrollTo) {
        swapScrollRef.current.scrollTo({ y: Math.max(0, y - 12), animated: true });
      }
    } catch {}
  };

  const scrollToLookupField = (which) => {
    try {
      const yMap = { model: modelYRef.current, type: typeYRef.current, assigned: assignedYRef.current };
      const y = Number.isFinite(yMap[which]) ? yMap[which] : lookupSectionYRef.current;
      if (swapScrollRef.current?.scrollTo) {
        swapScrollRef.current.scrollTo({ y: Math.max(0, y - 12), animated: true });
      }
    } catch {}
  };

  // When results appear while typing, bring the lookup block into view
  useEffect(() => {
    if (!swapOpen) return;
    if (lookupResults && lookupResults.length) scrollToLookup();
  }, [lookupResults, swapOpen]);

  const renderLookupSuggestions = () => (
    <View style={{ marginTop: 12 }}>
      <Text style={styles.fieldLabel}>Select a match to swap</Text>
      <ScrollView style={{ maxHeight: 260 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
        {lookupResults.map((it) => (
          <TouchableOpacity
            key={it.id}
            style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: lookupSelected?.id === it.id ? '#EEF2FF' : 'transparent' }}
            onPress={() => setLookupSelected(it)}
          >
            <Text style={{ fontWeight: '600', color: Colors.text }}>{it.id}</Text>
            <Text style={{ color: Colors.subtle }}>
              {(it.asset_types?.name || 'Type?')} • {(it.model || 'Model?')} • {(it.users?.name || it.users?.useremail || 'Unassigned')}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {lookupSelected && (
        <View style={[styles.btnRow, { marginTop: 12 }]}>
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={async () => {
              try {
                const confirmed = await new Promise((resolve) => {
                  Alert.alert(
                    'Confirm Swap',
                    `Swap QR from ${lookupSelected.id} to ${asset?.id}?`,
                    [
                      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                      { text: 'Confirm', style: 'destructive', onPress: () => resolve(true) },
                    ]
                  );
                });
                if (!confirmed) return;
                setLoading(true);
                await performSwap(lookupSelected.id, asset?.id);
                setSwapOpen(false);
                if (returnTo) {
                  try { router.replace(String(returnTo)); } catch { router.back(); }
                } else {
                  router.replace(`/check-in/${asset?.id}`);
                }
                Alert.alert('Success', 'QR swapped successfully.');
              } catch (e) {
                Alert.alert('Error', e.message || 'Swap failed');
              } finally {
                setLoading(false);
              }
            }}
          >
            <MaterialIcons name="swap-horiz" size={18} color="#fff" />
            <Text style={styles.btnPrimaryText}>Swap Selected</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
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

  useEffect(() => {
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, async (u) => {
      try {
        if (!u) { setIsAdmin(false); return; }
        const res = await fetch(`${API_BASE_URL}/users/${u.uid}`);
        if (!res.ok) { setIsAdmin(false); return; }
        const dbUser = await res.json();
        const role = String(dbUser?.role || '').toUpperCase();
        setIsAdmin(role === 'ADMIN');
      } catch {
        setIsAdmin(false);
      }
    });
    return unsub;
  }, []);

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
        console.log("🌐 API_BASE_URL:", API_BASE_URL);

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

        // Fetch asset details with retry logic
        let assetRes;
        let retries = 3;
        let lastError;
        
        while (retries > 0) {
          try {
            assetRes = await fetch(`${API_BASE_URL}/assets/${id}`, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
              },
            });
            break; // Success, exit retry loop
          } catch (fetchError) {
            lastError = fetchError;
            retries--;
            if (retries > 0) {
              console.warn(`⚠️ Fetch failed, retrying... (${retries} attempts left)`);
              await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
            }
          }
        }

        if (!assetRes) {
          throw new Error(
            lastError?.message || 
            `Network request failed. Please check your connection and ensure the API is accessible at ${API_BASE_URL}`
          );
        }

        const contentType = assetRes.headers.get('content-type');
        if (!assetRes.ok) {
          const text = await assetRes.text();
          throw new Error(
            `API request failed (${assetRes.status}): ${text || 'Unknown error'}\n` +
            `URL: ${API_BASE_URL}/assets/${id}`
          );
        }
        
        if (!contentType?.includes('application/json')) {
          const text = await assetRes.text();
          throw new Error(`Unexpected response type: ${contentType}\nResponse: ${text}`);
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
        const errorMessage = err.message || 'Unknown error occurred';
        const detailedError = `${errorMessage}\n\nAPI URL: ${API_BASE_URL}\nAsset ID: ${id}`;
        setError(detailedError);
      } finally {
        setLoading(false); // Hide loading spinner
      }
    };

    fetchData(); // Run on mount
    // Fetch all users when component mounts
    const fetchUsers = async () => {
      try {
        let response;
        let retries = 3;
        let lastError;
        
        while (retries > 0) {
          try {
            response = await fetch(`${API_BASE_URL}/users`, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
              },
            });
            break; // Success, exit retry loop
          } catch (fetchError) {
            lastError = fetchError;
            retries--;
            if (retries > 0) {
              console.warn(`⚠️ Users fetch failed, retrying... (${retries} attempts left)`);
              await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
            }
          }
        }

        if (!response) {
          console.error('Error fetching users:', lastError);
          console.error(`Failed URL: ${API_BASE_URL}/users`);
          return; // Don't set error state, just log - users list is not critical for initial load
        }

        if (response.ok) {
          const userList = await response.json();
          setUsers(userList);
          setFilteredUsers(userList);
        } else {
          console.warn(`Users API returned ${response.status}: ${await response.text()}`);
        }
      } catch (err) {
        console.error('Error fetching users:', err);
        console.error(`Failed URL: ${API_BASE_URL}/users`);
        // Don't set error state - users list failure shouldn't block the screen
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

  // --------- copy helpers & placeholder detection ---------
  const copyText = async (text, okMsg = 'Copied') => {
    try {
      if (Platform.OS === 'web') {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(String(text));
        } else {
          const el = document.createElement('textarea');
          el.value = String(text);
          el.setAttribute('readonly', '');
          el.style.position = 'absolute';
          el.style.left = '-9999px';
          document.body.appendChild(el);
          el.select();
          document.execCommand('copy');
          document.body.removeChild(el);
        }
        window.alert(okMsg);
      } else {
        if (Clipboard?.setStringAsync) await Clipboard.setStringAsync(String(text));
        else if (Clipboard?.setString) Clipboard.setString(String(text));
        Alert.alert('Copied', okMsg);
      }
    } catch (e) {
      Platform.OS === 'web'
        ? window.prompt('Copy this text:', String(text))
        : Alert.alert('Copy failed', 'Could not copy to clipboard.');
    }
  };
  const copyId = () => asset?.id && copyText(asset.id, 'Asset ID copied');
  const copyLink = () => {
    let link = '';
    if (Platform.OS === 'web' && typeof window !== 'undefined') link = window.location.href;
    else link = LinkingExpo.createURL(`check-in/${id}`);
    copyText(link, 'Check-in link copied');
  };

  // Perform a swap with fallback when target QR is not an empty placeholder
  const performSwap = async (fromId, toId) => {
    const auth = getAuth && getAuth();
    const u = auth?.currentUser || null;
    let headers = { 'Content-Type': 'application/json' };
    try {
      if (u && typeof u.getIdToken === 'function') {
        const tk = await u.getIdToken();
        if (tk) headers.Authorization = `Bearer ${tk}`;
      }
    } catch {}
    if (u?.uid) headers['X-User-Id'] = u.uid;
    if (u?.displayName) headers['X-User-Name'] = u.displayName;
    if (u?.email) headers['X-User-Email'] = u.email;

    // Check if target is empty
    const chk = await fetch(`${API_BASE_URL}/assets/${encodeURIComponent(toId)}`);
    if (!chk.ok) throw new Error('Target QR not found');
    const tgt = await chk.json();
    const hasDyn = tgt && tgt.fields && Object.keys(tgt.fields || {}).length > 0;
    const status = String(tgt?.status || '').toLowerCase();
    if (status === 'end of life') throw new Error('This QR is End of Life and cannot be used for swaps.');
    const toIsEmpty = !tgt?.serial_number && !tgt?.model && !tgt?.assigned_to_id && !tgt?.type_id && !tgt?.documentation_url && !tgt?.image_url && !tgt?.other_id && !hasDyn && (status === 'available');

    if (toIsEmpty) {
      const r = await fetch(`${API_BASE_URL}/assets/swap-qr`, { method: 'POST', headers, body: JSON.stringify({ from_id: fromId, to_id: toId }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b?.error || 'Swap failed');
      return true;
    }

    // 3-step using a spare placeholder
    const optsRes = await fetch(`${API_BASE_URL}/assets/asset-options`);
    const opts = optsRes.ok ? await optsRes.json() : null;
    const placeholders = Array.isArray(opts?.assetIds) ? opts.assetIds : [];
    const tempId = placeholders.find((pid) => typeof pid === 'string' && pid !== fromId && pid !== toId);
    if (!tempId) throw new Error('No blank QR available to complete swap');

    // A=toId, B=fromId, P=tempId
    let r1 = await fetch(`${API_BASE_URL}/assets/swap-qr`, { method: 'POST', headers, body: JSON.stringify({ from_id: toId, to_id: tempId }) });
    let b1 = await r1.json().catch(() => ({}));
    if (!r1.ok) throw new Error(b1?.error || 'Swap step 1 failed');
    let r2 = await fetch(`${API_BASE_URL}/assets/swap-qr`, { method: 'POST', headers, body: JSON.stringify({ from_id: fromId, to_id: toId }) });
    let b2 = await r2.json().catch(() => ({}));
    if (!r2.ok) throw new Error(b2?.error || 'Swap step 2 failed');
    let r3 = await fetch(`${API_BASE_URL}/assets/swap-qr`, { method: 'POST', headers, body: JSON.stringify({ from_id: tempId, to_id: fromId }) });
    let b3 = await r3.json().catch(() => ({}));
    if (!r3.ok) throw new Error(b3?.error || 'Swap step 3 failed');
    return true;
  };

  const isPlaceholder = React.useMemo(() => {
    if (!asset) return false;
    const hasDyn = asset && asset.fields && Object.keys(asset.fields || {}).length > 0;
    const status = String(asset?.status || '').toLowerCase();
    // Mirror server-side placeholder criteria: empty + Available status
    const emptyLike = !asset.serial_number && !asset.model && !asset.assigned_to_id && !asset.type_id && !asset.documentation_url && !asset.image_url && !asset.other_id && !hasDyn && (status === 'available');
    return emptyLike;
  }, [asset]);

  // Helper: load imported assets (UUID ids, not placeholders)
  const loadImportedAssets = async () => {
    try {
      setAssignLoading(true);
      const res = await fetch(`${API_BASE_URL}/assets`);
      if (!res.ok) throw new Error('Failed to fetch assets');
      const list = await res.json();
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const cleaned = (list || [])
        .filter(a => uuidRe.test(String(a?.id || '')))
        .filter(a => String(a?.description || '').toLowerCase() !== 'qr reserved asset');
      setAssignResults(cleaned);
    } catch (e) {
      Alert.alert('Error', e?.message || 'Failed to load imported assets');
    } finally {
      setAssignLoading(false);
    }
  };

  const filteredAssignResults = useMemo(() => {
    const q = (assignQuery || '').toLowerCase().trim();
    if (!q) return assignResults;
    return assignResults.filter(a => {
      const t = [
        a?.model,
        a?.asset_types?.name,
        a?.serial_number,
        a?.other_id,
        a?.notes,
      ].map(x => (x || '').toLowerCase());
      return t.some(s => s.includes(q));
    });
  }, [assignQuery, assignResults]);

  const handleAssignToPlaceholder = async (fromId) => {
    try {
      setAssignLoading(true);
      
      // Get Firebase auth token
      const auth = getAuth();
      const currentUser = auth?.currentUser;
      let headers = {
        'Content-Type': 'application/json',
      };
      
      // Add Authorization Bearer token
      try {
        if (currentUser && typeof currentUser.getIdToken === 'function') {
          const token = await currentUser.getIdToken();
          if (token) {
            headers.Authorization = `Bearer ${token}`;
          }
        }
      } catch (tokenError) {
        console.warn('Failed to get auth token:', tokenError);
      }
      
      // Add user info headers
      if (currentUser?.uid) headers['X-User-Id'] = currentUser.uid;
      if (currentUser?.displayName) headers['X-User-Name'] = currentUser.displayName;
      if (currentUser?.email) headers['X-User-Email'] = currentUser.email;
      
      const resp = await fetch(`${API_BASE_URL}/assets/swap-qr`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ from_id: fromId, to_id: asset?.id }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const { to } = await resp.json();
      setAssignOpen(false);
      setAssignQuery('');
      setAssignSelected(null);
      // Replace local asset with the assigned one now on this QR id
      setAsset(prev => ({ ...(prev || {}), ...(to || {}) }));
      // Require assigning to a user immediately
      setForceUserAssign(true);
      setShowUserModal(true);
      Alert.alert('Success', 'Imported asset assigned. Please choose a user to assign this asset to.');
    } catch (e) {
      Alert.alert('Error', e?.message || 'Failed to assign imported asset');
    } finally {
      setAssignLoading(false);
    }
  };

  // Handle transfer to selected user
  const handleTransferToUser = async (selectedUser) => {
  try {
    setLoading(true);

    // Get Firebase auth token
    const auth = getAuth();
    const currentUser = auth?.currentUser;
    let headers = {
      'Content-Type': 'application/json',
    };
    
    // Add Authorization Bearer token
    try {
      if (currentUser && typeof currentUser.getIdToken === 'function') {
        const token = await currentUser.getIdToken();
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }
      }
    } catch (tokenError) {
      console.warn('Failed to get auth token:', tokenError);
    }
    
    // Add user info headers
    if (currentUser?.uid) headers['X-User-Id'] = currentUser.uid;
    if (currentUser?.displayName) headers['X-User-Name'] = currentUser.displayName;
    if (currentUser?.email) headers['X-User-Email'] = currentUser.email;

    const updateResponse = await fetch(`${API_BASE_URL}/assets/${id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        assigned_to_id: selectedUser.id,
        status: 'In Service', // allowed value
        action_note: actionNote || undefined,
      }),
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      throw new Error(errorText || 'Failed to transfer asset');
    }

    // Optimistic local update
    applyAssetPatch({ assigned_to_id: selectedUser.id, status: 'In Service' });
    setShowUserModal(false);
    setForceUserAssign(false);
    setLoading(false);
    postActionAlert({
      message: `Asset transferred to ${selectedUser.name || selectedUser.useremail}`,
    });
    // If part of multi-scan, go back to the list to process the rest
    if (returnTo) {
      try { router.replace(String(returnTo)); } catch { router.back(); }
    }
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

  // Try to capture last scanned device location and turn into human-friendly text
  const getLastScannedLocation = async () => {
    try {
      let ExpoLocation;
      try { ExpoLocation = require('expo-location'); } catch { return null; }
      const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (status !== 'granted') return null;
      const pos = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy?.Balanced || 3 });
      if (!pos?.coords) return null;
      const { latitude, longitude } = pos.coords;
      // Prefer server-backed Google Geocoding for a high-quality address
      try {
        const resp = await fetch(`${API_BASE_URL}/places/reverse-geocode?lat=${latitude}&lng=${longitude}`);
        if (resp.ok) {
          const j = await resp.json();
          if (j?.formatted_address) return j.formatted_address;
        }
      } catch {}
      // Fallback to native reverse geocode
      try {
        const geos = await ExpoLocation.reverseGeocodeAsync({ latitude, longitude });
        const first = Array.isArray(geos) ? geos[0] : null;
        if (first) {
          const parts = [first.name, first.street, first.city, first.region, first.country].filter(Boolean);
          const addr = parts.join(', ');
          if (addr) return addr;
        }
      } catch {}
      return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    } catch { return null; }
  };

  try {
    setLoading(true);

    if (type === 'checkin') {
      // assign to office admin via server flag and mark usable
      payload = {
        assign_to_admin: true,
        status: 'In Service', // was "Available"
        action_note: actionNote || undefined,
      };
      const loc = await getLastScannedLocation();
      if (loc) payload.location = loc;
      successMessage = 'Asset checked in successfully';
    } else if (type === 'transferToMe') {
      if (!myUserId) throw new Error('Your user record was not found');

      payload = {
        assigned_to_id: myUserId,
        // Leave status unchanged. If you must set one, use 'In Service'
        // status: 'In Service',
        action_note: actionNote || undefined,
      };
      const loc = await getLastScannedLocation();
      if (loc) payload.location = loc;
      successMessage = 'Asset assigned to you';
    } else {
      throw new Error(`Unknown action: ${type}`);
    }

    // Get Firebase auth token
    const auth = getAuth();
    const currentUser = auth?.currentUser;
    let headers = {
      'Content-Type': 'application/json',
    };
    
    // Add Authorization Bearer token
    try {
      if (currentUser && typeof currentUser.getIdToken === 'function') {
        const token = await currentUser.getIdToken();
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }
      }
    } catch (tokenError) {
      console.warn('Failed to get auth token:', tokenError);
    }
    
    // Add user info headers
    if (currentUser?.uid) headers['X-User-Id'] = currentUser.uid;
    if (currentUser?.displayName) headers['X-User-Name'] = currentUser.displayName;
    if (currentUser?.email) headers['X-User-Email'] = currentUser.email;

    const res = await fetch(`${API_BASE_URL}/assets/${id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || 'Failed to update asset');
    }

     // Optimistic local update so UI reflects immediately
    applyAssetPatch(payload);
    // Optional: tiny success hint
    setLoading(false); // stop spinner first
    postActionAlert({ message: successMessage });
    if (returnTo) {
      try { router.replace(String(returnTo)); } catch { router.back(); }
    }
    return;  
  } catch (err) {
    console.error('Error in handleAction:', err);
    Alert.alert('Error', err.message || 'An error occurred');
  } finally {
    setLoading(false);
  }
};

  const openTransferMenu = React.useCallback(() => {
    if (!id) return;
    const target = returnTo ? String(returnTo) : `/check-in/${id}`;
    router.push({
      pathname: '/transfer/[assetId]',
      params: {
        assetId: String(id),
        returnTo: target,
      },
    });
  }, [id, returnTo, router]);

 const handleOtherAction = (key) => {
   if (!isAdmin && (key === 'hire' || key === 'eol')) {
     Alert.alert('Admins only', 'Please contact an administrator for this action.');
     return;
   }
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
      action_note: actionNote || undefined,
    };

    // Get Firebase auth token
    const auth = getAuth();
    const currentUser = auth?.currentUser;
    let headers = {
      'Content-Type': 'application/json',
    };
    
    // Add Authorization Bearer token
    try {
      if (currentUser && typeof currentUser.getIdToken === 'function') {
        const token = await currentUser.getIdToken();
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }
      }
    } catch (tokenError) {
      console.warn('Failed to get auth token:', tokenError);
    }
    
    // Add user info headers
    if (currentUser?.uid) headers['X-User-Id'] = currentUser.uid;
    if (currentUser?.displayName) headers['X-User-Name'] = currentUser.displayName;
    if (currentUser?.email) headers['X-User-Email'] = currentUser.email;

    const res = await fetch(`${API_BASE_URL}/assets/${id}`, {
      method: 'PUT',
      headers,
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
    <Modal
      visible={showUserModal}
      animationType="slide"
      transparent
      onRequestClose={() => {
        if (forceUserAssign) {
          Alert.alert('Required', 'Please select a user to assign this asset.');
        } else {
          setShowUserModal(false);
        }
      }}
    >
      <View style={styles.sheetBackdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0} style={{ width: '100%' }}>
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{forceUserAssign ? 'Assign to User (required)' : 'Transfer to User'}</Text>
            {!forceUserAssign && (
              <TouchableOpacity onPress={() => setShowUserModal(false)}>
                <MaterialIcons name="close" size={24} color={Colors.subtle} />
              </TouchableOpacity>
            )}
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
            contentContainerStyle={{ paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
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
        </KeyboardAvoidingView>
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
          {isAdmin && (
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => handleOtherAction('hire')}
              disabled={loading}
            >
              <MaterialIcons name="person-add-alt" size={22} color={Colors.blue} />
              <Text style={styles.actionText}>Hire</Text>
            </TouchableOpacity>
          )}

          {/* End of Life */}
          {isAdmin && (
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => handleOtherAction('eol')}
              disabled={loading}
            >
              <MaterialIcons name="do-not-disturb" size={22} color={Colors.red} />
              <Text style={styles.actionText}>End of Life</Text>
            </TouchableOpacity>
          )}

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
          <MaterialIcons name="error-outline" size={48} color={Colors.red} />
          <Text style={[styles.title, { marginTop: 16, fontSize: 20, fontWeight: '700' }]}>Connection Error</Text>
          <Text style={{ color: Colors.subtle, textAlign: 'center', marginTop: 8, marginHorizontal: 24 }}>
            {error}
          </Text>
          <TouchableOpacity
            style={[styles.btnPrimary, { marginTop: 24 }]}
            onPress={() => {
              setError(null);
              setLoading(true);
              // Retry by re-running the effect
              const fetchData = async () => {
                try {
                  const auth = getAuth();
                  const currentUser = auth.currentUser;
                  if (currentUser) setUser(currentUser);
                  else setUser({ uid: "guest" });
                  
                  if (!id) {
                    setError("Invalid asset ID");
                    setLoading(false);
                    return;
                  }
                  
                  const assetRes = await fetch(`${API_BASE_URL}/assets/${id}`);
                  if (!assetRes.ok) {
                    const text = await assetRes.text();
                    throw new Error(`API error (${assetRes.status}): ${text}`);
                  }
                  const assetData = await assetRes.json();
                  setAsset(assetData);
                  setError(null);
                } catch (err) {
                  setError(err.message || 'Failed to load asset');
                } finally {
                  setLoading(false);
                }
              };
              fetchData();
            }}
          >
            <MaterialIcons name="refresh" size={18} color="#fff" />
            <Text style={styles.btnPrimaryText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btnGhost, { marginTop: 12 }]}
            onPress={() => router.back()}
          >
            <Text style={styles.btnGhostText}>Go Back</Text>
          </TouchableOpacity>
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

          {/* Multi-scan navigation helper */}
          {returnTo ? (
            <View style={{ alignItems: 'flex-end', marginTop: 6 }}>
              <TouchableOpacity
                onPress={handleBackToScanned}
                style={styles.backToScanBtn}
              >
                <Text style={styles.backToScanText} numberOfLines={2}>
                  {`Back to Scanned Assets (${(multiScanCtx?.checked || []).length} of ${(multiScanCtx?.items || []).length} scanned)`}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

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


          {/* Check-in / Transfer Notes */}
          <View style={{ marginTop: 8, marginBottom: 6 }}>
            <Text style={styles.fieldLabel}>Notes (optional)</Text>
            <TextInput
              placeholder="Add a note for this action"
              value={actionNote}
              onChangeText={setActionNote}
              style={[styles.input, { minHeight: 42 }]}
              placeholderTextColor={Colors.subtle}
              multiline
            />
          </View>

          {/* Quick Actions (adjusted for Placeholder/EOL) */}
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.tileGrid}>

            {isEOL ? (
              // End of Life: only show Back to Dashboard
              <>
                <TouchableOpacity
                  style={[styles.tile, { backgroundColor: '#F9FAFB' }]}
                  onPress={() => router.replace('/(tabs)/dashboard')}
                  disabled={loading}
                >
                  <Text style={[styles.tileText, { color: Colors.slate }]} numberOfLines={2}>
                    Back to Dashboard
                  </Text>
                </TouchableOpacity>
              </>
            ) : isPlaceholder ? (
              <>
                {/* Transfer to Office - Always show for unassigned assets */}
                {(!asset?.assigned_to_id || !isAssignedToAdmin) && (
                  <TouchableOpacity
                    testID="transfer-to-office-button"
                    style={[styles.tile, { backgroundColor: '#F0FDF4' }]}
                    onPress={() => handleAction('checkin')}
                    disabled={loading}
                  >
                    <Text style={[styles.tileText, { color: Colors.green }]} numberOfLines={2}>
                      {loading ? 'Loading...' : 'Transfer to Office'}
                    </Text>
                  </TouchableOpacity>
                )}
                
                {/* Swap */}
                <TouchableOpacity
                  style={[styles.tile, { backgroundColor: '#EFF6FF' }]}
                  onPress={() => setSwapOpen(true)}
                  disabled={loading}
                >
                  <Text style={[styles.tileText, { color: Colors.blue }]} numberOfLines={2}>
                    Swap
                  </Text>
                </TouchableOpacity>

                {/* Assign Imported Asset */}
                {!!asset?.id && (
                  <TouchableOpacity
                    style={[styles.tile, { backgroundColor: '#FFF7ED' }]}
                    onPress={() => { setAssignSelected(null); setAssignQuery(''); setAssignOpen(true); if (!assignResults.length) loadImportedAssets(); }}
                    disabled={loading}
                  >
                    <Text style={[styles.tileText, { color: Colors.amber }]} numberOfLines={2}>
                      Assign Imported Asset
                    </Text>
                  </TouchableOpacity>
                )}

                {/* Create Asset */}
                {!!asset?.id && (
                  <TouchableOpacity
                    style={[styles.tile, { backgroundColor: '#F0FDF4' }]}
                    onPress={() => router.push({ pathname: '/asset/new', params: { preselectId: asset.id, returnTo: returnTo || '' } })}
                    disabled={loading}
                  >
                    <Text style={[styles.tileText, { color: Colors.green }]} numberOfLines={2}>
                      Create Asset
                    </Text>
                  </TouchableOpacity>
                )}

                {/* Back to Dashboard */}
                <TouchableOpacity
                  style={[styles.tile, styles.backToDashboardTile]}
                  onPress={() => router.replace('/(tabs)/dashboard')}
                >
                  <Text style={[styles.tileText, styles.backToDashboardText]} numberOfLines={2}>
                    Back to Dashboard
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {/* Always show Transfer to Office button */}
                {(!asset?.assigned_to_id || !isAssignedToAdmin) && (
                  <TouchableOpacity
                    testID="transfer-to-office-button"
                    style={[styles.tile, { 
                      backgroundColor: '#F0FDF4',
                      opacity: loading ? 0.7 : 1
                    }]}
                    onPress={() => handleAction('checkin')}
                    disabled={loading}
                  >
                    <Text style={[styles.tileText, { color: Colors.green }]} numberOfLines={2}>
                      {loading ? 'Loading...' : 'Transfer to Office'}
                    </Text>
                  </TouchableOpacity>
                )}

                {/* Transfer */}
                <TouchableOpacity
                  style={[styles.tile, { backgroundColor: '#EFF6FF' }]}
                  onPress={openTransferMenu}
                  disabled={loading}
                >
                  <Text style={[styles.tileText, { color: Colors.blue }]} numberOfLines={2}>
                    Transfer
                  </Text>
                </TouchableOpacity>

                {/* Transfer to Me */}
                {(myUserId && asset.assigned_to_id !== myUserId) && (
                  <TouchableOpacity
                    style={[styles.tile, { backgroundColor: '#EFF6FF' }]}
                    onPress={() => handleAction('transferToMe')}
                    disabled={loading}
                  >
                    <Text style={[styles.tileText, { color: Colors.blue }]} numberOfLines={2}>
                      Transfer to Me
                    </Text>
                  </TouchableOpacity>
                )}

                {/* Back to Dashboard */}
                <TouchableOpacity
                  style={[styles.tile, { backgroundColor: '#F9FAFB' }]}
                  onPress={() => router.replace('/(tabs)/dashboard')}
                >
                  <Text style={[styles.tileText, { color: Colors.slate }]} numberOfLines={2}>
                    Back to Dashboard
                  </Text>
                </TouchableOpacity>

                {/* Copy Asset */}
                {!!asset?.id && (
                  <TouchableOpacity
                    style={[styles.tile, { backgroundColor: '#EFF6FF' }]}
                    onPress={() => router.push({ pathname: '/asset/new', params: { fromAssetId: asset.id, returnTo: returnTo || '' } })}
                    disabled={loading}
                  >
                    <Text style={[styles.tileText, { color: Colors.blue }]} numberOfLines={2}>
                      Copy Asset
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}

          </View>

        </ScrollView>

        {/* Sticky Footer Bar (hide for placeholders and EOL) */}
        {!isPlaceholder && !isEOL && (
          <View style={styles.footerBar}>
            <TouchableOpacity
              style={[styles.footerBtn, { backgroundColor: Colors.amber }]}
              onPress={() => { setActionsFormType('Repair'); setActionsFormOpen(true); }}
            >
              <Text style={styles.footerBtnText} numberOfLines={2}>
                Repair Required
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.footerBtn, { backgroundColor: Colors.purple }]}
              onPress={() => { setActionsFormType('Maintenance'); setActionsFormOpen(true); }}
            >
              <Text style={styles.footerBtnText} numberOfLines={2}>
                Log Service
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.footerBtn, { backgroundColor: Colors.slate }]}
              onPress={() => setShowOtherModal(true)}
            >
              <Text style={styles.footerBtnText} numberOfLines={2}>
                Other Actions
              </Text>
            </TouchableOpacity>
          </View>
        )}

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
      {swapOpen && (
        <Modal transparent animationType="slide" visible={swapOpen} onRequestClose={() => setSwapOpen(false)}>
          <View style={styles.sheetBackdrop}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0} style={{ width: '100%' }}>
            <View style={[styles.sheet, { maxHeight: '85%' }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Swap QR to Existing Asset</Text>
                <TouchableOpacity onPress={() => setSwapOpen(false)}>
                  <MaterialIcons name="close" size={20} color={Colors.subtle} />
                </TouchableOpacity>
              </View>

              <ScrollView ref={swapScrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 240, gap: 14 }}>
                {/* Option 1: Asset ID */}
                <View style={styles.optionCard}>
                  <View style={styles.optionHeaderRow}>
                    <MaterialIcons name="tag" size={18} color={Colors.blue} />
                    <Text style={styles.optionTitle}>Find by Asset ID</Text>
                  </View>
                  <Text style={styles.optionDesc}>Enter the existing Asset ID (QR code or UUID) and we will move that asset onto this QR.</Text>
                  <Text style={styles.fieldLabel}>Asset ID</Text>
                  <TextInput
                    placeholder="e.g. ABCD1234"
                    value={swapIdInput}
                    onChangeText={(t) => setSwapIdInput((t || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0,8))}
                    style={styles.input}
                    placeholderTextColor={Colors.subtle}
                    autoCapitalize="characters"
                    maxLength={8}
                  />
                  <Text style={styles.fieldHint}>Tip: You can paste the ID from the asset page or scan its QR and copy.</Text>
                  <View style={styles.btnRow}>
                    <TouchableOpacity
                      style={[styles.btnPrimary, { opacity: swapIdInput.trim() ? 1 : 0.6 }]}
                      disabled={!swapIdInput.trim() || loading}
                      onPress={async () => {
                        try {
                          const idTrim = swapIdInput.trim();
                          const qrLike = /^[A-Z0-9]{8}$/;
                          if (!qrLike.test(idTrim)) throw new Error('Asset ID must be 8 characters (A–Z, 0–9).');
                          const confirmed = await new Promise((resolve) => {
                            Alert.alert('Confirm Swap', `Swap assets between ${idTrim} and ${asset?.id}?`, [
                              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                              { text: 'Confirm', style: 'destructive', onPress: () => resolve(true) },
                            ]);
                          });
                          if (!confirmed) return;
                          setLoading(true);
                          await performSwap(idTrim, asset?.id);
                          setSwapOpen(false);
                          if (returnTo) { try { router.replace(String(returnTo)); } catch { router.back(); } }
                          else { router.replace(`/check-in/${asset?.id}`); }
                          Alert.alert('Success', 'QR swapped successfully.');
                        } catch (e) {
                          Alert.alert('Error', e.message || 'Failed to swap');
                        } finally { setLoading(false); }
                      }}
                    >
                      <MaterialIcons name="swap-horiz" size={18} color="#fff" />
                      <Text style={styles.btnPrimaryText}>Swap Now</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Option 2: Scan QR */}
                <View style={styles.optionCard}>
                  <View style={styles.optionHeaderRow}>
                    <MaterialIcons name="qr-code-scanner" size={18} color={Colors.blue} />
                    <Text style={styles.optionTitle}>Scan QR</Text>
                  </View>
                  <Text style={styles.optionDesc}>Scan the QR of an existing asset and we will move it onto this QR.</Text>
                  <View style={styles.btnRow}>
                    <TouchableOpacity
                      style={[styles.btnGhost]}
                      onPress={() => router.push({ pathname: '/qr-scanner', params: { intent: 'swap-target', placeholderId: asset?.id, returnTo: returnTo || '' } })}
                    >
                      <MaterialIcons name="qr-code" size={18} color={Colors.blue} />
                      <Text style={styles.btnGhostText}>Open Scanner</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Option 3: Lookup */}
                <View style={styles.optionCard} onLayout={(e) => { lookupSectionYRef.current = e.nativeEvent.layout.y; }}>
                  <View style={styles.optionHeaderRow}>
                    <MaterialIcons name="search" size={18} color={Colors.blue} />
                    <Text style={styles.optionTitle}>Lookup by Details</Text>
                  </View>
                  <Text style={styles.optionDesc}>Use any combination. We’ll use the first close match (top 10).</Text>
                  <Text style={styles.fieldLabel}>Model</Text>
                  <View onLayout={(e) => { modelYRef.current = e.nativeEvent.layout.y; }}>
                    <TextInput
                      placeholder="e.g. DJI Mavic 3"
                      value={lookup.model}
                      onFocus={() => { setLookupFocus('model'); scrollToLookupField('model'); }}
                      onChangeText={(t)=>setLookup(prev=>({ ...prev, model: t }))}
                      style={styles.input}
                      placeholderTextColor={Colors.subtle}
                    />
                  </View>
                  {lookupResults.length > 0 && lookupFocus === 'model' && renderLookupSuggestions()}
                  <Text style={styles.fieldLabel}>Type</Text>
                  <View onLayout={(e) => { typeYRef.current = e.nativeEvent.layout.y; }}>
                    <TextInput
                      placeholder="e.g. Drone"
                      value={lookup.type}
                      onFocus={() => { setLookupFocus('type'); scrollToLookupField('type'); }}
                      onChangeText={(t)=>setLookup(prev=>({ ...prev, type: t }))}
                      style={styles.input}
                      placeholderTextColor={Colors.subtle}
                    />
                  </View>
                  {lookupResults.length > 0 && lookupFocus === 'type' && renderLookupSuggestions()}
                  <Text style={styles.fieldLabel}>Assigned (email or name)</Text>
                  <View onLayout={(e) => { assignedYRef.current = e.nativeEvent.layout.y; }}>
                    <TextInput
                      placeholder="e.g. alex@company.com or Alex"
                      value={lookup.assigned}
                      onFocus={() => { setLookupFocus('assigned'); scrollToLookupField('assigned'); }}
                      onChangeText={(t)=>setLookup(prev=>({ ...prev, assigned: t }))}
                      style={styles.input}
                      placeholderTextColor={Colors.subtle}
                    />
                  </View>
                  {lookupResults.length > 0 && lookupFocus === 'assigned' && renderLookupSuggestions()}
                  <Text style={styles.fieldHint}>Example: Model "ThinkPad", Type "Laptop", Assigned "sam@company.com".</Text>
                  {/* Suggestions are now rendered inline under the focused field via renderLookupSuggestions() */}
                </View>

                <View style={{ height: 8 }} />
                <TouchableOpacity style={[styles.btnGhost, { alignSelf: 'center' }]} onPress={() => setSwapOpen(false)}>
                  <MaterialIcons name="close" size={18} color={Colors.slate} />
                  <Text style={styles.btnGhostText}>Close</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
            </KeyboardAvoidingView>
          </View>
        </Modal>
      )}

      {assignOpen && (
        <Modal transparent animationType="slide" visible={assignOpen} onRequestClose={() => setAssignOpen(false)}>
          <View style={styles.sheetBackdrop}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0} style={{ width: '100%' }}>
            <View style={[styles.sheet, { maxHeight: '85%' }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Assign Imported Asset</Text>
                <TouchableOpacity onPress={() => setAssignOpen(false)}>
                  <MaterialIcons name="close" size={20} color={Colors.subtle} />
                </TouchableOpacity>
              </View>

              <ScrollView 
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, gap: 14 }}
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.optionCard}>
                  <View style={styles.optionHeaderRow}>
                    <MaterialIcons name="search" size={18} color={Colors.blue} />
                    <Text style={styles.optionTitle}>Find Imported Asset</Text>
                  </View>
                  <Text style={styles.optionDesc}>Pick an imported asset (UUID id) to assign to this QR. We will move its data onto this QR id and reset the original record to a placeholder.</Text>
                  <TextInput
                    placeholder="Search by model, type, serial, other id, notes"
                    value={assignQuery}
                    onChangeText={setAssignQuery}
                    style={styles.input}
                    placeholderTextColor={Colors.subtle}
                  />
                  <View style={{ marginTop: 8 }}>
                    {assignLoading ? (
                      <ActivityIndicator />
                    ) : (
                      <FlatList
                        data={filteredAssignResults}
                        keyExtractor={(item) => String(item.id)}
                        style={{ maxHeight: 300 }}
                        contentContainerStyle={{ paddingBottom: 8 }}
                        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                        scrollEnabled={filteredAssignResults.length > 3}
                        renderItem={({ item }) => (
                          <TouchableOpacity
                            style={[
                              styles.optionCard,
                              { padding: 12, borderColor: assignSelected?.id === item.id ? Colors.amber : Colors.border },
                            ]}
                            onPress={() => setAssignSelected(item)}
                          >
                            <Text style={{ fontWeight: '600', color: Colors.text }}>{item.model || 'Unnamed'}</Text>
                            <Text style={{ color: Colors.subtle, marginTop: 2 }}>
                              {(item.asset_types?.name || 'Unknown type')} · {(item.serial_number || item.other_id || 'No SN')}
                            </Text>
                            <Text style={{ color: Colors.muted, marginTop: 2 }}>ID: {item.id}</Text>
                          </TouchableOpacity>
                        )}
                        ListEmptyComponent={() => (
                          <Text style={{ color: Colors.muted, textAlign: 'center', paddingVertical: 16 }}>No matches</Text>
                        )}
                      />
                    )}
                  </View>
                </View>
              </ScrollView>

              {/* Confirm bar - Fixed at bottom */}
              <View style={{ 
                flexDirection: 'row', 
                gap: 10, 
                paddingHorizontal: 16, 
                paddingTop: 12,
                paddingBottom: Platform.OS === 'ios' ? 20 : 14,
                backgroundColor: Colors.card,
                borderTopWidth: 1,
                borderTopColor: Colors.border,
              }}>
                <TouchableOpacity
                  style={[styles.footerBtn, { backgroundColor: Colors.slate, flex: 1, opacity: assignLoading ? 0.6 : 1 }]}
                  disabled={assignLoading}
                  onPress={() => { setAssignOpen(false); setAssignSelected(null); }}
                >
                  <MaterialIcons name="close" size={20} color="#FFFFFF" />
                  <Text style={styles.footerBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.footerBtn, { backgroundColor: Colors.amber, flex: 1, opacity: (!assignSelected || assignLoading) ? 0.6 : 1 }]}
                  disabled={!assignSelected || assignLoading}
                  onPress={() => assignSelected && handleAssignToPlaceholder(assignSelected.id)}
                >
                  <MaterialIcons name="qr-code" size={20} color="#FFFFFF" />
                  <Text style={styles.footerBtnText}>Assign</Text>
                </TouchableOpacity>
              </View>
            </View>
            </KeyboardAvoidingView>
          </View>
        </Modal>
      )}
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
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    flexBasis: '48%',
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 60,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  tileText: {
    color: Colors.text,
    fontWeight: '700',
    fontSize: Platform.select({
      ios: 13,
      android: 13,
      default: 14,
    }),
    textAlign: 'center',
    includeFontPadding: false, // Android: remove extra padding
  },
  backToDashboardTile: {
    backgroundColor: '#E5E7EB',
    borderColor: '#9CA3AF',
    paddingHorizontal: 12,
  },
  backToDashboardText: {
    color: Colors.blue,
  },
  backToScanBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    maxWidth: '100%',
  },
  backToScanText: {
    color: Colors.blue,
    fontWeight: '700',
    fontSize: Platform.select({
      ios: 12,
      android: 12,
      default: 13,
    }),
    textAlign: 'center',
    includeFontPadding: false,
  },

  footerBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 8,
    padding: 10,
    backgroundColor: Colors.bg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  footerBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  footerBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: Platform.select({
      ios: 11,
      android: 11,
      default: 12,
    }),
    textAlign: 'center',
    flexShrink: 1,
    includeFontPadding: false, // Android: remove extra padding
  },

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
  fieldLabel: { color: Colors.subtle, fontSize: 12, marginTop: 6, marginBottom: 4, letterSpacing: 0.3 },
  fieldHint: { color: Colors.subtle, fontSize: 12, marginTop: 6 },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    color: Colors.text,
  },
  optionCard: {
    backgroundColor: '#FBFDFF',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 14,
  },
  optionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  optionTitle: { color: Colors.text, fontWeight: '800', fontSize: 14 },
  optionDesc: { color: Colors.subtle, marginBottom: 8 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  btnPrimary: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.blue, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14,
  },
  btnPrimaryText: { color: '#fff', fontWeight: '800' },
  btnGhost: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 14,
  },
  btnGhostText: { color: Colors.blue, fontWeight: '800' },
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
