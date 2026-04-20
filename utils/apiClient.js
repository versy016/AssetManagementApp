/**
 * utils/apiClient.js — GearOps shared API fetch wrapper
 *
 * Centralises:
 *  - Firebase auth token injection (Authorization: Bearer <token>)
 *  - response.ok checking — throws on 4xx/5xx so callers don't need to
 *  - JSON parsing
 *  - consistent error messages
 *
 * Usage:
 *   import { apiGet, apiPost, apiPatch, apiDelete } from '../../utils/apiClient';
 *
 *   // GET
 *   const user = await apiGet(`/users/${uid}`);
 *
 *   // POST with body
 *   const asset = await apiPost('/assets', { name: 'Trimble', status: 'Available' });
 *
 *   // PATCH
 *   await apiPatch(`/assets/${id}`, { status: 'In Service' });
 *
 *   // DELETE
 *   await apiDelete(`/assets/${id}`);
 *
 *   // Raw (multipart, custom headers, etc.)
 *   const res = await apiRequest('POST', '/assets/upload', body, { json: false });
 */

import { getAuth } from '@react-native-firebase/auth';
import { API_BASE_URL } from '../inventory-api/apiBase';

// ─── Token helper ─────────────────────────────────────────────────────────────
async function getToken() {
  try {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  } catch {
    return null;
  }
}

// ─── Core request ─────────────────────────────────────────────────────────────
/**
 * @param {'GET'|'POST'|'PATCH'|'PUT'|'DELETE'} method
 * @param {string} path   — e.g. '/assets/123'  (no base URL)
 * @param {any}    body   — plain object, FormData, or null
 * @param {{ json?: boolean, signal?: AbortSignal }} opts
 * @returns {Promise<any>}  parsed JSON response
 * @throws  {ApiError}      on non-2xx responses
 */
export async function apiRequest(method, path, body = null, opts = {}) {
  const { json = true, signal } = opts;

  const token = await getToken();

  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (json && body !== null && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const init = {
    method,
    headers,
    signal,
  };

  if (body !== null) {
    init.body = json && !(body instanceof FormData)
      ? JSON.stringify(body)
      : body;
  }

  let res;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, init);
  } catch (networkErr) {
    throw new ApiError(0, 'Network error — check your connection', path);
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const errBody = await res.json();
      message = errBody?.error || errBody?.message || message;
    } catch { /* body wasn't JSON */ }
    throw new ApiError(res.status, message, path);
  }

  // 204 No Content — return null instead of trying to parse empty body
  if (res.status === 204) return null;

  try {
    return await res.json();
  } catch {
    return null;
  }
}

// ─── Convenience methods ──────────────────────────────────────────────────────
export const apiGet    = (path, opts)       => apiRequest('GET',    path, null, opts);
export const apiPost   = (path, body, opts) => apiRequest('POST',   path, body, opts);
export const apiPatch  = (path, body, opts) => apiRequest('PATCH',  path, body, opts);
export const apiPut    = (path, body, opts) => apiRequest('PUT',    path, body, opts);
export const apiDelete = (path, opts)       => apiRequest('DELETE', path, null, opts);

// ─── Error class ──────────────────────────────────────────────────────────────
export class ApiError extends Error {
  /**
   * @param {number} status   HTTP status code (0 = network error)
   * @param {string} message  Human-readable message from the server
   * @param {string} path     The API path that failed
   */
  constructor(status, message, path) {
    super(message);
    this.name    = 'ApiError';
    this.status  = status;
    this.path    = path;
  }

  get isUnauthorized()  { return this.status === 401; }
  get isForbidden()     { return this.status === 403; }
  get isNotFound()      { return this.status === 404; }
  get isServerError()   { return this.status >= 500; }
  get isNetworkError()  { return this.status === 0; }
}
