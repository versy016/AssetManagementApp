/**
 * utils/authHeaders.js
 *
 * Returns the correct Authorization header for API requests.
 *
 * In production the backend requires `Authorization: Bearer <Firebase ID token>`.
 * In development it also accepts `X-User-Id` as a convenience, but we always
 * prefer the token when available so the same code path works in both environments.
 *
 * Usage:
 *   import { getAuthHeaders } from '../../utils/authHeaders';
 *
 *   const headers = await getAuthHeaders();
 *   const res = await fetch(`${API_BASE_URL}/assets`, { method: 'POST', headers, body: ... });
 *
 *   // Merge with extra headers:
 *   const headers = { 'Content-Type': 'application/json', ...(await getAuthHeaders()) };
 */

import { getAuth } from 'firebase/auth';

/**
 * Resolves the best available auth header for the current user.
 *
 * @returns {Promise<Record<string, string>>}
 *   `{ Authorization: 'Bearer <token>' }` when an ID token is available,
 *   `{ 'X-User-Id': uid }` as a dev-only fallback,
 *   or `{}` when no user is signed in.
 */
export async function getAuthHeaders() {
  try {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) return {};

    const token = await user.getIdToken();
    if (token) return { Authorization: `Bearer ${token}` };

    // Dev fallback — accepted by the backend only outside production
    if (user.uid) return { 'X-User-Id': user.uid };
  } catch {
    // Network error, token refresh failed, etc. — return empty and let the
    // API respond with 401 so the caller can handle it.
  }
  return {};
}

/**
 * Set auth headers on an existing XMLHttpRequest instance.
 * Preferred over getAuthHeaders() when using XHR for upload progress tracking.
 *
 * @param {XMLHttpRequest} xhr
 * @returns {Promise<void>}
 */
export async function setXHRAuthHeaders(xhr) {
  const headers = await getAuthHeaders();
  for (const [key, value] of Object.entries(headers)) {
    xhr.setRequestHeader(key, value);
  }
}
