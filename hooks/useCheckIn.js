// hooks/useCheckIn.js
// All state, effects, and action handlers for the check-in / transfer screen.
// Extracted from app/check-in/[id].js to keep that file as a thin orchestrator.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, InteractionManager, Platform } from 'react-native';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import * as Clipboard from 'expo-clipboard';
import * as LinkingExpo from 'expo-linking';
import { useRouter } from 'expo-router';
import { API_BASE_URL } from '../inventory-api/apiBase';
import logger from '../utils/logger';
import { showError, showSuccess, confirm } from '../utils/showError';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper: build auth request headers (Firebase token + user info)
// ─────────────────────────────────────────────────────────────────────────────

async function buildAuthHeaders(base = { 'Content-Type': 'application/json' }) {
  const auth = getAuth();
  const u = auth?.currentUser || null;
  const headers = { ...base };
  try {
    if (u && typeof u.getIdToken === 'function') {
      const token = await u.getIdToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
  } catch {}
  if (u?.uid)         headers['X-User-Id']    = String(u.uid);
  if (u?.displayName) headers['X-User-Name']  = u.displayName;
  if (u?.email)       headers['X-User-Email'] = u.email;
  return headers;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper: get current device location as a human-readable address
// ─────────────────────────────────────────────────────────────────────────────

async function getCurrentAddress() {
  try {
    let ExpoLocation;
    try { ExpoLocation = require('expo-location'); } catch { return null; }
    const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const pos = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy?.Balanced || 3 });
    if (!pos?.coords) return null;
    const { latitude, longitude } = pos.coords;
    try {
      const resp = await fetch(`${API_BASE_URL}/places/reverse-geocode?lat=${latitude}&lng=${longitude}`);
      if (resp.ok) {
        const j = await resp.json();
        if (j?.formatted_address) return j.formatted_address;
      }
    } catch {}
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useCheckIn({ id, returnTo }) {
  const router = useRouter();

  // ── Core data ────────────────────────────────────────────────────────────
  const [loading,  setLoading]  = useState(true);
  const [user,     setUser]     = useState(null);
  const [isAdmin,  setIsAdmin]  = useState(false);
  const [asset,    setAsset]    = useState(null);
  const [error,    setError]    = useState(null);

  // ── User list / user modal ────────────────────────────────────────────────
  const [users,          setUsers]          = useState([]);
  const [filteredUsers,  setFilteredUsers]  = useState([]);
  const [searchQuery,    setSearchQuery]    = useState('');
  const [myUserId,       setMyUserId]       = useState(null);
  const [showUserModal,  setShowUserModal]  = useState(false);

  // ── Other actions modal ───────────────────────────────────────────────────
  const [showOtherModal,   setShowOtherModal]   = useState(false);
  const [actionsFormOpen,  setActionsFormOpen]  = useState(false);
  const [actionsFormType,  setActionsFormType]  = useState(null);

  // ── Swap sheet ────────────────────────────────────────────────────────────
  const [swapOpen,        setSwapOpen]        = useState(false);
  const [swapIdInput,     setSwapIdInput]     = useState('');
  const [lookup,          setLookup]          = useState({ model: '', type: '', assigned: '' });
  const [lookupResults,   setLookupResults]   = useState([]);
  const [lookupSelected,  setLookupSelected]  = useState(null);
  const [allAssets,       setAllAssets]       = useState([]);
  const [lookupFocus,     setLookupFocus]     = useState(null);

  const swapScrollRef       = useRef(null);
  const lookupSectionYRef   = useRef(0);
  const modelYRef           = useRef(0);
  const typeYRef            = useRef(0);
  const assignedYRef        = useRef(0);

  // ── Assign imported asset modal ───────────────────────────────────────────
  const [assignOpen,      setAssignOpen]      = useState(false);
  const [assignQuery,     setAssignQuery]     = useState('');
  const [assignLoading,   setAssignLoading]   = useState(false);
  const [assignResults,   setAssignResults]   = useState([]);
  const [assignSelected,  setAssignSelected]  = useState(null);
  const [forceUserAssign, setForceUserAssign] = useState(false);

  // ── Misc action state ─────────────────────────────────────────────────────
  const [actionNote,           setActionNote]           = useState('');
  const [showCreateNoteInput,  setShowCreateNoteInput]  = useState(false);
  const [createNoteText,       setCreateNoteText]       = useState('');
  const [createNoteSubmitting, setCreateNoteSubmitting] = useState(false);

  // ─────────────────────────────────────────────────────────────────────────
  // Derived values
  // ─────────────────────────────────────────────────────────────────────────

  const isEOL = useMemo(() => String(asset?.status || '').toLowerCase() === 'end of life', [asset]);

  const isAssignedToAdmin = useMemo(() => {
    try {
      if (!asset?.assigned_to_id) return false;
      if (!Array.isArray(users) || !users.length) return false;
      const assignedUser = users.find((u) => String(u.id) === String(asset.assigned_to_id));
      if (!assignedUser) return false;
      return String(assignedUser.role || '').toUpperCase() === 'ADMIN';
    } catch { return false; }
  }, [asset, users]);

  const multiScanCtx = useMemo(() => {
    if (!returnTo) return null;
    try {
      const url = new URL('https://x' + String(returnTo));
      const items   = JSON.parse(decodeURIComponent(url.searchParams.get('items')     || '[]'));
      const checked = JSON.parse(decodeURIComponent(url.searchParams.get('checkedIn') || '[]'));
      const allChecked = Array.isArray(items) && items.length > 0 && items.every((v) => (checked || []).includes(v));
      return {
        items:   Array.isArray(items)   ? items   : [],
        checked: Array.isArray(checked) ? checked : [],
        allChecked,
      };
    } catch {
      return { items: [], checked: [], allChecked: false };
    }
  }, [returnTo]);

  const isPlaceholder = useMemo(() => {
    if (!asset) return false;
    const hasDyn = asset.fields && Object.keys(asset.fields || {}).length > 0;
    const status = String(asset?.status || '').toLowerCase();
    return !asset.serial_number && !asset.model && !asset.assigned_to_id && !asset.type_id &&
           !asset.documentation_url && !asset.image_url && !asset.other_id && !hasDyn && status === 'available';
  }, [asset]);

  const isQRReserved = useMemo(() => {
    if (!asset) return false;
    return String(asset?.description || '').toLowerCase().includes('qr reserved');
  }, [asset]);

  const filteredAssignResults = useMemo(() => {
    const q = (assignQuery || '').toLowerCase().trim();
    if (!q) return assignResults;
    return assignResults.filter((a) => {
      const tokens = [a?.model, a?.asset_types?.name, a?.serial_number, a?.other_id, a?.notes]
        .map((x) => (x || '').toLowerCase());
      return tokens.some((s) => s.includes(q));
    });
  }, [assignQuery, assignResults]);

  // ─────────────────────────────────────────────────────────────────────────
  // Effects
  // ─────────────────────────────────────────────────────────────────────────

  // Admin role watch
  useEffect(() => {
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, async (u) => {
      try {
        if (!u) { setIsAdmin(false); return; }
        const res = await fetch(`${API_BASE_URL}/users/${u.uid}`);
        if (!res.ok) { setIsAdmin(false); return; }
        const dbUser = await res.json();
        setIsAdmin(String(dbUser?.role || '').toUpperCase() === 'ADMIN');
      } catch { setIsAdmin(false); }
    });
    return unsub;
  }, []);

  // Resolve myUserId whenever user/users changes
  useEffect(() => {
    const email = (user?.email || '').toLowerCase();
    if (!email || !users?.length) return;
    const me = users.find((u) => u.useremail?.toLowerCase() === email);
    setMyUserId(me?.id ?? null);
  }, [user, users]);

  // Asset + users initial fetch
  useEffect(() => {
    // Guard against setState-after-unmount: this effect retries with 1s sleeps
    // (up to ~3s in flight), during which the user can navigate away.
    let cancelled = false;
    const fetchData = async () => {
      try {
        const auth = getAuth();
        const currentUser = auth.currentUser;
        logger.log('Current user:', currentUser?.uid);

        if (!cancelled) setUser(currentUser || { uid: 'guest' });

        if (!id) { if (!cancelled) { setError('Invalid asset ID'); setLoading(false); } return; }

        let assetRes;
        let retries = 3;
        let lastError;
        while (retries > 0) {
          try {
            assetRes = await fetch(`${API_BASE_URL}/assets/${id}`, {
              method: 'GET',
              headers: { 'Content-Type': 'application/json' },
            });
            break;
          } catch (fetchError) {
            lastError = fetchError;
            retries--;
            if (retries > 0) await new Promise((r) => setTimeout(r, 1000));
          }
        }
        if (!assetRes) throw new Error(lastError?.message || `Network request failed at ${API_BASE_URL}`);

        const contentType = assetRes.headers.get('content-type');
        if (!assetRes.ok) {
          const text = await assetRes.text();
          throw new Error(`API error (${assetRes.status}): ${text}\nURL: ${API_BASE_URL}/assets/${id}`);
        }
        if (!contentType?.includes('application/json')) {
          const text = await assetRes.text();
          throw new Error(`Unexpected content type: ${contentType}\n${text}`);
        }

        const assetData = await assetRes.json();
        if (assetData.assigned_to_id && assetData.users) {
          assetData.assigned_user_name = assetData.users.name || assetData.users.useremail || `User ${assetData.assigned_to_id}`;
        } else if (assetData.assigned_to_id) {
          try {
            const userRes = await fetch(`${API_BASE_URL}/users/${assetData.assigned_to_id}`);
            if (userRes.ok) {
              const userData = await userRes.json();
              assetData.assigned_user_name = userData.name || userData.useremail || `User ${assetData.assigned_to_id}`;
            }
          } catch (e) {
            assetData.assigned_user_name = `User ${assetData.assigned_to_id}`;
          }
        }
        logger.log('Asset data:', assetData?.id);
        if (!cancelled) setAsset(assetData);
      } catch (err) {
        if (!cancelled) setError(`${err.message || 'Unknown error'}\n\nAPI URL: ${API_BASE_URL}\nAsset ID: ${id}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const fetchUsers = async () => {
      let response;
      let retries = 3;
      let lastError;
      while (retries > 0) {
        try {
          response = await fetch(`${API_BASE_URL}/users`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
          break;
        } catch (fetchError) {
          lastError = fetchError;
          retries--;
          if (retries > 0) await new Promise((r) => setTimeout(r, 1000));
        }
      }
      if (!response) { logger.error('Error fetching users:', lastError); return; }
      if (response.ok) {
        const list = await response.json();
        if (!cancelled) { setUsers(list); setFilteredUsers(list); }
      }
    };

    fetchData();
    fetchUsers();
    return () => { cancelled = true; };
  }, [id]);

  // Filter users by search query
  useEffect(() => {
    if (!searchQuery.trim()) return setFilteredUsers(users);
    const q = searchQuery.toLowerCase();
    setFilteredUsers(users.filter((u) => u.name?.toLowerCase().includes(q) || u.useremail?.toLowerCase().includes(q)));
  }, [searchQuery, users]);

  // Reset swap lookup on open
  useEffect(() => {
    if (swapOpen) { setLookupResults([]); setLookupSelected(null); }
  }, [swapOpen]);

  // Preload asset list for swap lookup suggestions
  useEffect(() => {
    let cancelled = false;
    if (!swapOpen || allAssets.length) return;
    (async () => {
      try {
        const r = await fetch(`${API_BASE_URL}/assets`);
        const data = await r.json();
        if (!cancelled) setAllAssets(Array.isArray(data) ? data : []);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [swapOpen]);

  // Live lookup suggestions when typing in swap sheet
  useEffect(() => {
    if (!swapOpen) return;
    const hasAny = [lookup.model, lookup.type, lookup.assigned].some((v) => String(v || '').trim().length >= 2);
    if (!hasAny) { setLookupResults([]); setLookupSelected(null); return; }
    const q = {
      model:    String(lookup.model    || '').trim().toLowerCase(),
      type:     String(lookup.type     || '').trim().toLowerCase(),
      assigned: String(lookup.assigned || '').trim().toLowerCase(),
    };
    const idIsQR = (s) => /^[A-Z0-9]{8}$/i.test(String(s || ''));
    const isPlaceholderAsset = (it) => {
      const hasDyn = it && it.fields && Object.keys(it.fields || {}).length > 0;
      return !it?.serial_number && !it?.model && !it?.assigned_to_id && !it?.type_id &&
             !it?.documentation_url && !it?.image_url && !hasDyn;
    };
    const matches = (allAssets || [])
      .filter((it) => {
        if (!idIsQR(it?.id)) return false;
        if (!it?.type_id) return false;
        if (!it?.model && !it?.serial_number) return false;
        if (isPlaceholderAsset(it)) return false;
        const model    = String(it?.model || '').toLowerCase();
        const type     = String(it?.asset_types?.name || it?.type || '').toLowerCase();
        const assigned = String(it?.users?.name || it?.users?.useremail || '').toLowerCase();
        return (!q.model || model.includes(q.model)) && (!q.type || type.includes(q.type)) && (!q.assigned || assigned.includes(q.assigned));
      })
      .slice(0, 10);
    setLookupResults(matches);
    if (lookupSelected && !matches.find((m) => m.id === lookupSelected.id)) setLookupSelected(null);
  }, [lookup, allAssets, swapOpen]);

  // Scroll swap sheet to lookup results when they appear
  useEffect(() => {
    if (!swapOpen) return;
    if (lookupResults?.length) scrollToLookup();
  }, [lookupResults, swapOpen]);

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  const nameForUser = (dbUserId) => {
    const u = users.find((x) => x.id === dbUserId);
    return u?.name || u?.useremail || (dbUserId ? `User ${dbUserId}` : 'Unassigned');
  };

  const applyAssetPatch = (patch) => {
    setAsset((prev) => {
      const next = { ...prev, ...patch };
      if (Object.prototype.hasOwnProperty.call(patch, 'assigned_to_id')) {
        next.assigned_user_name = nameForUser(patch.assigned_to_id);
      }
      return next;
    });
  };

  const scrollToLookup = () => {
    try {
      const y = typeof lookupSectionYRef.current === 'number' ? lookupSectionYRef.current : 0;
      swapScrollRef.current?.scrollTo?.({ y: Math.max(0, y - 12), animated: true });
    } catch {}
  };

  const scrollToLookupField = (which) => {
    try {
      const yMap = { model: modelYRef.current, type: typeYRef.current, assigned: assignedYRef.current };
      const y = Number.isFinite(yMap[which]) ? yMap[which] : lookupSectionYRef.current;
      swapScrollRef.current?.scrollTo?.({ y: Math.max(0, y - 12), animated: true });
    } catch {}
  };

  const postActionAlert = ({ title = 'Success', message = 'Action completed.', stayLabel = 'Stay here', goLabel = 'Go to Dashboard', onStay, onGo } = {}) => {
    const goToDashboard = () => router.replace('/dashboard');
    if (Platform.OS === 'web') {
      const go = window.confirm(`${title}\n\n${message}\n\nPress "OK" to ${goLabel.toLowerCase()}, or "Cancel" to ${stayLabel.toLowerCase()}.`);
      if (go) (onGo || goToDashboard)();
      else    (onStay || (() => {}))();
    } else {
      InteractionManager.runAfterInteractions(() => {
        Alert.alert(title, message, [
          { text: stayLabel, style: 'default', onPress: onStay || (() => {}) },
          { text: goLabel,   style: 'default', onPress: onGo   || goToDashboard },
        ]);
      });
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Clipboard
  // ─────────────────────────────────────────────────────────────────────────

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

  const copyId   = () => asset?.id && copyText(asset.id, 'Asset ID copied');
  const copyLink = () => {
    let link = '';
    if (Platform.OS === 'web' && typeof window !== 'undefined') link = window.location.href;
    else link = LinkingExpo.createURL(`check-in/${id}`);
    copyText(link, 'Check-in link copied');
  };

  // ─────────────────────────────────────────────────────────────────────────
  // QR Swap
  // ─────────────────────────────────────────────────────────────────────────

  const performSwap = async (fromId, toId) => {
    const headers = await buildAuthHeaders();

    const chk = await fetch(`${API_BASE_URL}/assets/${encodeURIComponent(toId)}`);
    if (!chk.ok) throw new Error('Target QR not found');
    const tgt = await chk.json();
    const hasDyn  = tgt && tgt.fields && Object.keys(tgt.fields || {}).length > 0;
    const status  = String(tgt?.status || '').toLowerCase();
    if (status === 'end of life') throw new Error('This QR is End of Life and cannot be used for swaps.');
    const toIsEmpty = !tgt?.serial_number && !tgt?.model && !tgt?.assigned_to_id && !tgt?.type_id &&
                      !tgt?.documentation_url && !tgt?.image_url && !tgt?.other_id && !hasDyn && status === 'available';

    if (toIsEmpty) {
      const r = await fetch(`${API_BASE_URL}/assets/swap-qr`, { method: 'POST', headers, body: JSON.stringify({ from_id: fromId, to_id: toId }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b?.error || 'Swap failed');
      return true;
    }

    // 3-step swap using a spare placeholder
    const optsRes = await fetch(`${API_BASE_URL}/assets/asset-options`);
    const opts = optsRes.ok ? await optsRes.json() : null;
    const placeholders = Array.isArray(opts?.assetIds) ? opts.assetIds : [];
    const tempId = placeholders.find((pid) => typeof pid === 'string' && pid !== fromId && pid !== toId);
    if (!tempId) throw new Error('No blank QR available to complete swap');

    for (const [from, to] of [[toId, tempId], [fromId, toId], [tempId, fromId]]) {
      const r = await fetch(`${API_BASE_URL}/assets/swap-qr`, { method: 'POST', headers, body: JSON.stringify({ from_id: from, to_id: to }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b?.error || `Swap step failed (${from}→${to})`);
    }
    return true;
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Action handlers
  // ─────────────────────────────────────────────────────────────────────────

  const handleBackToScanned = () => {
    if (!returnTo) return;
    if (forceUserAssign) { Alert.alert('Required', 'Please select a user to assign this asset before leaving.'); return; }
    try { router.replace(String(returnTo)); } catch { router.back(); }
  };

  const loadImportedAssets = async () => {
    try {
      setAssignLoading(true);
      const res = await fetch(`${API_BASE_URL}/assets`);
      if (!res.ok) throw new Error('Failed to fetch assets');
      const list = await res.json();
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      setAssignResults(
        (list || [])
          .filter((a) => uuidRe.test(String(a?.id || '')))
          .filter((a) => String(a?.description || '').toLowerCase() !== 'qr reserved asset')
      );
    } catch (e) {
      showError(e, 'Failed to load imported assets');
    } finally {
      setAssignLoading(false);
    }
  };

  const handleAssignToPlaceholder = async (fromId) => {
    try {
      setAssignLoading(true);
      const headers = await buildAuthHeaders();
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
      setAsset((prev) => ({ ...(prev || {}), ...(to || {}) }));
      setForceUserAssign(true);
      setShowUserModal(true);
      Alert.alert('Success', 'Imported asset assigned. Please choose a user to assign this asset to.');
    } catch (e) {
      showError(e, 'Failed to assign imported asset');
    } finally {
      setAssignLoading(false);
    }
  };

  const handleTransferToUser = async (selectedUser) => {
    try {
      setLoading(true);
      const headers = await buildAuthHeaders();
      const updateResponse = await fetch(`${API_BASE_URL}/assets/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          assigned_to_id: selectedUser.id,
          status: 'In Service',
          action_note: actionNote || undefined,
        }),
      });
      if (!updateResponse.ok) throw new Error((await updateResponse.text()) || 'Failed to transfer asset');
      applyAssetPatch({ assigned_to_id: selectedUser.id, status: 'In Service' });
      setShowUserModal(false);
      setForceUserAssign(false);
      setLoading(false);
      postActionAlert({ message: `Asset transferred to ${selectedUser.name || selectedUser.useremail}` });
      if (returnTo) { try { router.replace(String(returnTo)); } catch { router.back(); } }
    } catch (err) {
      showError(err, 'Failed to transfer asset');
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (type) => {
    if (!asset || !user) return;
    let payload = {};
    let successMessage = '';
    try {
      setLoading(true);
      if (type === 'checkin') {
        payload = { assign_to_admin: true, status: 'In Service', action_note: actionNote || undefined };
        const loc = await getCurrentAddress();
        if (loc) payload.location = loc;
        successMessage = 'Asset Transferred';
      } else if (type === 'transferToMe') {
        if (!myUserId) throw new Error('Your user record was not found');
        payload = { assigned_to_id: myUserId, action_note: actionNote || undefined };
        const loc = await getCurrentAddress();
        if (loc) payload.location = loc;
        successMessage = 'Asset Transferred';
      } else {
        throw new Error(`Unknown action: ${type}`);
      }

      const headers = await buildAuthHeaders();
      const res = await fetch(`${API_BASE_URL}/assets/${id}`, { method: 'PUT', headers, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error((await res.text()) || 'Failed to update asset');

      applyAssetPatch(payload);
      setLoading(false);
      postActionAlert({ message: successMessage });
      if (returnTo) { try { router.replace(String(returnTo)); } catch { router.back(); } }
    } catch (err) {
      showError(err, 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const openTransferMenu = () => {
    if (!id) return;
    const target = returnTo ? String(returnTo) : `/check-in/${id}`;
    router.push({ pathname: '/transfer/[assetId]', params: { assetId: String(id), returnTo: target } });
  };

  const handleOtherAction = (key) => {
    if (!isAdmin && (key === 'hire' || key === 'eol')) {
      Alert.alert('Admins only', 'Please contact an administrator for this action.');
      return;
    }
    setShowOtherModal(false);
    if (key === 'hire') {
      router.push({ pathname: '/hire', params: asset?.id ? { assetId: asset.id } : {} });
      return;
    }
    const map = { eol: 'End of Life', lost: 'Report Lost', stolen: 'Report Stolen' };
    setActionsFormType(map[key]);
    setActionsFormOpen(true);
  };

  const submitCreateNote = async () => {
    const note = (createNoteText || '').trim();
    if (!note) { Alert.alert('Note required', 'Please enter a note.'); return; }
    if (!asset?.id) return;
    setCreateNoteSubmitting(true);
    try {
      const headers = await buildAuthHeaders();
      const res = await fetch(`${API_BASE_URL}/assets/${encodeURIComponent(asset.id)}/actions`, {
        method: 'POST',
        headers,
        // note_only + user_note_text mark this as a plain note (not a status
        // transition) so it shows under Notes and is labelled "Note" in history.
        body: JSON.stringify({ type: 'STATUS_CHANGE', note, data: { user_note_text: note, note_only: true } }),
      });
      if (!res.ok) throw new Error((await res.text()) || 'Failed to save note');
      setCreateNoteText('');
      setShowCreateNoteInput(false);
      Alert.alert('Success', 'Note saved.');
    } catch (e) {
      showError(e, 'Failed to save note');
    } finally {
      setCreateNoteSubmitting(false);
    }
  };

  const updateStatus = async (newStatus) => {
    try {
      setLoading(true);
      const headers = await buildAuthHeaders();
      const res = await fetch(`${API_BASE_URL}/assets/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ status: newStatus, assigned_to_id: asset?.assigned_to_id ?? null, action_note: actionNote || undefined }),
      });
      if (!res.ok) throw new Error((await res.text()) || `Failed to set status: ${newStatus}`);
      applyAssetPatch({ status: newStatus });
      setLoading(false);
      postActionAlert({ message: `Status updated to "${newStatus}"` });
    } catch (e) {
      showError(e, 'Failed to update status');
    } finally {
      setLoading(false);
    }
  };

  const retryLoad = () => {
    setError(null);
    setLoading(true);
    (async () => {
      try {
        const auth = getAuth();
        const currentUser = auth.currentUser;
        if (currentUser) setUser(currentUser);
        else setUser({ uid: 'guest' });
        if (!id) { setError('Invalid asset ID'); setLoading(false); return; }
        const assetRes = await fetch(`${API_BASE_URL}/assets/${id}`);
        if (!assetRes.ok) throw new Error(`API error (${assetRes.status}): ${await assetRes.text()}`);
        setAsset(await assetRes.json());
      } catch (err) {
        setError(err.message || 'Failed to load asset');
      } finally {
        setLoading(false);
      }
    })();
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Return everything the screen needs
  // ─────────────────────────────────────────────────────────────────────────

  return {
    // Core
    loading, setLoading,
    user,
    isAdmin,
    asset, setAsset,
    error,
    retryLoad,

    // Derived
    isEOL,
    isAssignedToAdmin,
    isPlaceholder,
    isQRReserved,
    multiScanCtx,
    filteredAssignResults,

    // User modal
    showUserModal, setShowUserModal,
    users,
    filteredUsers,
    searchQuery, setSearchQuery,
    myUserId,
    forceUserAssign, setForceUserAssign,

    // Other actions modal
    showOtherModal, setShowOtherModal,
    actionsFormOpen, setActionsFormOpen,
    actionsFormType, setActionsFormType,

    // Swap sheet
    swapOpen, setSwapOpen,
    swapIdInput, setSwapIdInput,
    lookup, setLookup,
    lookupResults,
    lookupSelected, setLookupSelected,
    lookupFocus, setLookupFocus,
    swapScrollRef,
    lookupSectionYRef, modelYRef, typeYRef, assignedYRef,
    scrollToLookupField,

    // Assign imported modal
    assignOpen, setAssignOpen,
    assignQuery, setAssignQuery,
    assignLoading,
    assignResults,
    assignSelected, setAssignSelected,

    // Misc
    actionNote, setActionNote,
    showCreateNoteInput, setShowCreateNoteInput,
    createNoteText, setCreateNoteText,
    createNoteSubmitting,

    // Actions
    handleBackToScanned,
    loadImportedAssets,
    handleAssignToPlaceholder,
    handleTransferToUser,
    handleAction,
    openTransferMenu,
    handleOtherAction,
    submitCreateNote,
    updateStatus,
    performSwap,
    postActionAlert,
    copyId,
    copyLink,
  };
}
