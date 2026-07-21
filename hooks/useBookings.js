// hooks/useBookings.js
// Data + actions for the Bookings screen (Work ▸ Bookings). Talks to the
// /bookings API: list (upcoming/past), create, cancel, and per-asset availability.
import { useState, useEffect, useCallback } from 'react';
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
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState('upcoming'); // 'upcoming' | 'past'
  const [isAdmin, setIsAdmin] = useState(false);

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

  const createBooking = useCallback(async (payload) => {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE_URL}/bookings`, {
        method: 'POST', headers, body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: json?.error || 'Failed to create booking', conflict: json?.conflict };
      await load(scope);
      return { ok: true, booking: json };
    } catch (e) {
      return { ok: false, error: e?.message || 'Failed to create booking' };
    }
  }, [load, scope]);

  const cancelBooking = useCallback(async (id) => {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE_URL}/bookings/${id}`, { method: 'DELETE', headers });
      if (res.ok) setItems((prev) => prev.filter((b) => b.id !== id));
      return res.ok;
    } catch { return false; }
  }, []);

  // Admin approve / reject a REQUESTED (long) booking.
  const decide = useCallback(async (id, action) => {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE_URL}/bookings/${id}/${action}`, { method: 'POST', headers });
      if (res.ok) await load(scope);
      return res.ok;
    } catch { return false; }
  }, [load, scope]);

  // Busy windows for an asset (bookings + hires) — used by the create flow.
  const getAvailability = useCallback(async (assetId) => {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE_URL}/bookings/availability?asset_id=${encodeURIComponent(assetId)}`, { headers });
      const json = await res.json().catch(() => ({}));
      return Array.isArray(json.windows) ? json.windows : [];
    } catch { return []; }
  }, []);

  return {
    items, loading, scope, setScope, isAdmin,
    reload: () => load(scope),
    createBooking, cancelBooking, getAvailability,
    approveBooking: (id) => decide(id, 'approve'),
    rejectBooking: (id) => decide(id, 'reject'),
  };
}

export default useBookings;
