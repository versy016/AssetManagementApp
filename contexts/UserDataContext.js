// contexts/UserDataContext.js
//
// Caches the current Firebase user's profile (/users/<uid>) and favourite
// asset types (/users/<uid>/favourites) for the whole app, so every consumer
// (WebNavbar, TourGuide, dashboard, search/index, …) hits one shared copy
// instead of re-fetching on every mount.
//
// Why this exists:
// * A perf trace of "back to dashboard" showed /users/<uid> fetched 4× and
//   /users/<uid>/favourites fetched 2× — wasting ~350 ms per navigation.
// * Putting the result behind a context means each user-changing event
//   triggers ONE fetch; consumers re-render off the same snapshot.
//
// Public API:
//   useUserData() → {
//     uid,                     // Firebase UID (or null)
//     profile,                 // { id, name, useremail, role, … } | null
//     profileLoading,          // boolean
//     isAdmin,                 // derived from token claims OR DB role
//     favouriteTypes,          // string[]  (max 3)
//     setFavouriteTypes,       // (next) => void — optimistic local update +
//                              //                   PUT /users/<uid>/favourites
//     refreshProfile,          // () => void  (forces a re-fetch)
//   }

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { auth } from '../firebaseConfig';
import { API_BASE_URL } from '../inventory-api/apiBase';
import logger from '../utils/logger';

const UserDataContext = createContext(null);

export const UserDataProvider = ({ children }) => {
  const [uid, setUid] = useState(() => auth.currentUser?.uid || null);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [favouriteTypes, _setFavouriteTypes] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);

  // Track in-flight promises so two consumers don't both fire the same fetch.
  const profileFetchRef = useRef(null);
  const favFetchRef = useRef(null);
  // Suppress the immediate write back to the server after loading from it.
  const favHydratedRef = useRef(false);
  const favSaveTimerRef = useRef(null);
  // Clear any pending favourites-save timer on unmount so it can't fire after.
  useEffect(() => () => { if (favSaveTimerRef.current) clearTimeout(favSaveTimerRef.current); }, []);

  // ── Listen to Firebase auth ────────────────────────────────────────────
  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => setUid(u?.uid || null));
    return () => { try { unsub?.(); } catch { /* ignore */ } };
  }, []);

  // ── Load profile + admin flag once per uid ─────────────────────────────
  const loadProfile = useCallback(async (currentUid) => {
    if (!currentUid) {
      setProfile(null);
      setIsAdmin(false);
      return;
    }
    if (profileFetchRef.current) return profileFetchRef.current;
    setProfileLoading(true);
    const p = (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/users/${encodeURIComponent(currentUid)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setProfile(data || null);
        // Admin: prefer the DB role, fall back to Firebase token claims.
        const dbAdmin = String(data?.role || '').toUpperCase() === 'ADMIN';
        let claimAdmin = false;
        try {
          const u = auth.currentUser;
          if (u) {
            const tr = await u.getIdTokenResult();
            claimAdmin = !!tr?.claims?.admin || String(tr?.claims?.role || '').toUpperCase() === 'ADMIN';
          }
        } catch { /* ignore */ }
        setIsAdmin(dbAdmin || claimAdmin);
      } catch (e) {
        logger?.warn?.('[UserData] profile load failed', e?.message || e);
        setProfile(null);
        setIsAdmin(false);
      } finally {
        setProfileLoading(false);
        profileFetchRef.current = null;
      }
    })();
    profileFetchRef.current = p;
    return p;
  }, []);

  // ── Load favourite types once per uid ──────────────────────────────────
  const loadFavourites = useCallback(async (currentUid) => {
    favHydratedRef.current = false;
    if (!currentUid) {
      _setFavouriteTypes([]);
      favHydratedRef.current = true;
      return;
    }
    if (favFetchRef.current) return favFetchRef.current;
    const p = (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/users/${encodeURIComponent(currentUid)}/favourites`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json().catch(() => ({}));
        const arr = Array.isArray(j?.favouriteTypes) ? j.favouriteTypes.map(String) : [];
        _setFavouriteTypes(arr.slice(0, 3));
      } catch (e) {
        logger?.warn?.('[UserData] favourites load failed', e?.message || e);
        _setFavouriteTypes([]);
      } finally {
        favHydratedRef.current = true;
        favFetchRef.current = null;
      }
    })();
    favFetchRef.current = p;
    return p;
  }, []);

  useEffect(() => {
    loadProfile(uid);
    loadFavourites(uid);
  }, [uid, loadProfile, loadFavourites]);

  // ── Setter for favourites — optimistic update + server PUT ─────────────
  const setFavouriteTypes = useCallback((next) => {
    const arr = Array.isArray(next) ? next.slice(0, 3).map(String) : [];
    _setFavouriteTypes(arr);
    if (!uid || !favHydratedRef.current) return;
    // Debounce slightly so rapid edits collapse to one PUT.
    if (favSaveTimerRef.current) clearTimeout(favSaveTimerRef.current);
    favSaveTimerRef.current = setTimeout(() => {
      fetch(`${API_BASE_URL}/users/${encodeURIComponent(uid)}/favourites`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favouriteTypes: arr }),
      }).catch((e) => logger?.warn?.('[UserData] favourites save failed', e?.message || e));
    }, 250);
  }, [uid]);

  // Manual refresh — used by Profile page after admin/role changes
  const refreshProfile = useCallback(() => {
    profileFetchRef.current = null;
    loadProfile(uid);
  }, [uid, loadProfile]);

  const value = useMemo(() => ({
    uid,
    profile,
    profileLoading,
    isAdmin,
    favouriteTypes,
    setFavouriteTypes,
    refreshProfile,
  }), [uid, profile, profileLoading, isAdmin, favouriteTypes, setFavouriteTypes, refreshProfile]);

  return (
    <UserDataContext.Provider value={value}>
      {children}
    </UserDataContext.Provider>
  );
};

export const useUserData = () => {
  const ctx = useContext(UserDataContext);
  // Safe fallback so components don't crash if the provider isn't mounted
  // (e.g. on the public check-in page).
  return ctx || {
    uid: null,
    profile: null,
    profileLoading: false,
    isAdmin: false,
    favouriteTypes: [],
    setFavouriteTypes: () => {},
    refreshProfile: () => {},
  };
};
