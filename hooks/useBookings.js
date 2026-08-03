// hooks/useBookings.js
// Data + actions for the Bookings screen (Work ▸ Bookings). Talks to the
// /bookings API: list (upcoming/past), create, cancel, and per-asset availability.
import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL } from '../inventory-api/apiBase';
import { auth } from '../firebaseConfig';

async function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const u = auth?.currentUser;
  if (u?.uid) headers['X-User-Id'] = u.uid;
  if (u?.displayName) headers['X-User-Name'] = u.displayName;
  if (u?.email) headers['X-User-Email'] = u.email;
  try {
    if (u && typeof u.getIdToken === 'function') {
      const t = await u.getIdToken();
      if (t) headers.Authorization = `Bearer ${t}`;
    }
  } catch { /* non-fatal */ }
  return headers;
}

export function useBookings() {
  const [items, setItems] = useState([]);
  const [calItems, setCalItems] = useState([]); // bookings within a date window (calendar)
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState('upcoming'); // 'upcoming' | 'past'
  const [isAdmin, setIsAdmin] = useState(false);
  const lastRangeRef = useRef(null); // last calendar window loaded, for refresh

  const load = useCallback(async (sc) => {
    const which = sc || scope;
    setLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE_URL}/bookings?scope=${encodeURIComponent(which)}`, { headers });
      const json = await res.json().catch(() => ({}));
      setItems(Array.isArray(json.items) ? json.items : []);
      setIsAdmin(!!json.isAdmin);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { load(scope); }, [scope, load]);

  // Bookings overlapping a date window — for the calendar view.
  const loadRange = useCallback(async (fromYmd, toYmd) => {
    lastRangeRef.current = { from: fromYmd, to: toYmd };
    try {
      const headers = await authHeaders();
      const qs = new URLSearchParams();
      if (fromYmd) qs.set('from', fromYmd);
      if (toYmd) qs.set('to', toYmd);
      const res = await fetch(`${API_BASE_URL}/bookings?${qs.toString()}`, { headers });
      const json = await res.json().catch(() => ({}));
      setCalItems(Array.isArray(json.items) ? json.items : []);
      setIsAdmin(!!json.isAdmin);
      return Array.isArray(json.items) ? json.items : [];
    } catch { setCalItems([]); return []; }
  }, []);

  // Refresh whatever's on screen — the list and the last-loaded calendar window.
  const refreshAll = useCallback(async () => {
    await load(scope);
    const r = lastRangeRef.current;
    if (r) await loadRange(r.from, r.to);
  }, [load, scope, loadRange]);

  const createBooking = useCallback(async (payload) => {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE_URL}/bookings`, {
        method: 'POST', headers, body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: json?.error || 'Failed to create booking', conflict: json?.conflict };
      await refreshAll();
      return { ok: true, booking: json };
    } catch (e) {
      return { ok: false, error: e?.message || 'Failed to create booking' };
    }
  }, [refreshAll]);

  const updateBooking = useCallback(async (id, payload) => {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE_URL}/bookings/${id}`, {
        method: 'PATCH', headers, body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: json?.error || 'Failed to update booking', conflict: json?.conflict };
      await refreshAll();
      return { ok: true, booking: json };
    } catch (e) {
      return { ok: false, error: e?.message || 'Failed to update booking' };
    }
  }, [refreshAll]);

  const cancelBooking = useCallback(async (id) => {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE_URL}/bookings/${id}`, { method: 'DELETE', headers });
      if (res.ok) { setItems((prev) => prev.filter((b) => b.id !== id)); await refreshAll(); }
      return res.ok;
    } catch { return false; }
  }, [refreshAll]);

  // POST /bookings/:id/<action> then refresh (approve/reject/checkout/return).
  const decide = useCallback(async (id, action) => {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE_URL}/bookings/${id}/${action}`, { method: 'POST', headers });
      if (res.ok) await refreshAll();
      return res.ok;
    } catch { return false; }
  }, [refreshAll]);

  // Busy windows for an asset (bookings + hires) — used by the create flow.
  const getAvailability = useCallback(async (assetId) => {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE_URL}/bookings/availability?asset_id=${encodeURIComponent(assetId)}`, { headers });
      const json = await res.json().catch(() => ({}));
      return { windows: Array.isArray(json.windows) ? json.windows : [], asset: json.asset || null };
    } catch { return { windows: [], asset: null }; }
  }, []);

  return {
    items, loading, scope, setScope, isAdmin,
    reload: () => load(scope),
    createBooking, updateBooking, cancelBooking, getAvailability,
    calItems, loadRange,
    approveBooking: (id) => decide(id, 'approve'),
    rejectBooking: (id) => decide(id, 'reject'),
    checkoutBooking: (id) => decide(id, 'checkout'),
    returnBooking: (id) => decide(id, 'return'),
  };
}

export default useBookings;
