// hooks/useAssetTypeFields.js
// Cached hook for fetching asset type field definitions.
//
// Results are cached in memory for the session so repeated calls with the same
// typeId don't fire multiple network requests.  The cache is intentionally not
// persisted to AsyncStorage — it lives only while the app is running and is
// invalidated by a full reload.
//
// Usage:
//   const { fields, loading, error, refetch } = useAssetTypeFields(typeId);

import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../inventory-api/apiBase';
import logger from '../utils/logger';
import { getAuthHeaders } from '../utils/authHeaders';

// ─── Module-level cache ───────────────────────────────────────────────────────
// Map<typeId: string, { fields: FieldDef[], ts: number }>
const _cache = new Map();
// In-flight promises — prevents duplicate parallel fetches for the same typeId
const _inflight = new Map();

/** Cache TTL: 5 minutes (fields rarely change mid-session). */
const TTL_MS = 5 * 60 * 1000;

/**
 * Return cached fields if fresh, otherwise null.
 */
function getCached(typeId) {
  const hit = _cache.get(typeId);
  if (!hit) return null;
  if (Date.now() - hit.ts > TTL_MS) {
    _cache.delete(typeId);
    return null;
  }
  return hit.fields;
}

/**
 * Imperative fetch — reuses in-flight promise to prevent concurrent duplicates.
 * Returns the field array on success.  Throws on network or HTTP error.
 * Exported so non-hook async code (callbacks, effects) can share the same cache.
 */
export async function fetchFields(typeId) {
  const cached = getCached(typeId);
  if (cached) return cached;

  if (_inflight.has(typeId)) return _inflight.get(typeId);

  const promise = (async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE_URL}/assets/asset-types/${encodeURIComponent(typeId)}/fields`, {
        headers,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const fields = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
      _cache.set(typeId, { fields, ts: Date.now() });
      return fields;
    } finally {
      _inflight.delete(typeId);
    }
  })();

  _inflight.set(typeId, promise);
  return promise;
}

/**
 * Manually invalidate the cached entry for a type (e.g. after admin edits fields).
 */
export function invalidateAssetTypeFields(typeId) {
  if (typeId) {
    _cache.delete(typeId);
    logger.info('useAssetTypeFields: cache invalidated', { typeId });
  } else {
    _cache.clear();
    logger.info('useAssetTypeFields: full cache cleared');
  }
}

/**
 * Hook — fetches and caches field definitions for a given asset type id.
 *
 * @param {string|null|undefined} typeId  – the asset_types.id to load fields for
 * @returns {{ fields: FieldDef[], loading: boolean, error: string|null, refetch: () => void }}
 */
export default function useAssetTypeFields(typeId) {
  const [fields, setFields] = useState(() => (typeId ? getCached(typeId) ?? [] : []));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (force = false) => {
    if (!typeId) {
      setFields([]);
      setLoading(false);
      setError(null);
      return;
    }

    if (!force) {
      const hit = getCached(typeId);
      if (hit) {
        setFields(hit);
        setLoading(false);
        setError(null);
        return;
      }
    } else {
      _cache.delete(typeId);
    }

    setLoading(true);
    setError(null);
    try {
      const result = await fetchFields(typeId);
      setFields(result);
    } catch (e) {
      logger.error('useAssetTypeFields: fetch failed', { typeId, message: e?.message || e });
      setError(e?.message || 'Failed to load field definitions');
      setFields([]);
    } finally {
      setLoading(false);
    }
  }, [typeId]);

  useEffect(() => {
    load();
  }, [load]);

  const refetch = useCallback(() => load(true), [load]);

  return { fields, loading, error, refetch };
}

/**
 * Convenience: get fields as a slug → definition map.
 * Useful for O(1) lookups by slug name.
 */
export function useAssetTypeFieldsBySlug(typeId) {
  const { fields, loading, error, refetch } = useAssetTypeFields(typeId);
  const bySlug = {};
  for (const f of fields) {
    const slug = String(f.slug || f.name || '').toLowerCase().replace(/\s+/g, '_');
    if (slug) bySlug[slug] = f;
  }
  return { bySlug, fields, loading, error, refetch };
}
