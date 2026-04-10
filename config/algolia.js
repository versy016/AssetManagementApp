// Public Algolia search credentials (safe for frontend)
export const ALGOLIA_APP_ID = 'ENGDR4U6W2';
export const ALGOLIA_SEARCH_KEY = '22d7addd0f220bff6a0f83b8a7f4e287';

// Index names
export const ALGOLIA_INDEX_CLIENTS = 'clients';
export const ALGOLIA_INDEX_PROJECTS = 'projects';

/**
 * Human-readable label for a hit (client/project indexes use different field names).
 */
export function algoliaHitDisplay(hit) {
  if (!hit || typeof hit !== 'object') return '';
  const keys = [
    'name',
    'title',
    'label',
    'companyName',
    'clientName',
    'legalName',
    'displayName',
    'company',
    'customerName',
    'client',
    'projectName',
    'code',
    'description',
  ];
  for (let i = 0; i < keys.length; i += 1) {
    const v = hit[keys[i]];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  if (hit.objectID != null && String(hit.objectID).trim()) return String(hit.objectID).trim();
  return '';
}

/**
 * Full search result (for UI: nbHits vs hits.length, dev logging).
 * @returns {{ hits: object[], nbHits: number, processingTimeMS?: number, query: string }}
 */
export async function algoliaQuery(indexName, query, opts = {}) {
  const appId = ALGOLIA_APP_ID;
  const apiKey = ALGOLIA_SEARCH_KEY;
  const q = String(query || '');
  const body = {
    query: q,
    hitsPerPage: opts.hitsPerPage ?? 20,
  };
  if (opts.attributesToRetrieve != null) {
    body.attributesToRetrieve = opts.attributesToRetrieve;
  }
  const headers = {
    'Content-Type': 'application/json',
    'X-Algolia-Application-Id': appId,
    'X-Algolia-API-Key': apiKey,
  };
  const bases = [
    `https://${appId}-dsn.algolia.net`,
    `https://${appId}.algolia.net`,
  ];
  let lastErr = null;
  for (let b = 0; b < bases.length; b += 1) {
    const url = `${bases[b]}/1/indexes/${encodeURIComponent(indexName)}/query`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        lastErr = new Error(t || `Algolia search failed (${res.status})`);
        continue;
      }
      const json = await res.json();
      const hits = Array.isArray(json?.hits) ? json.hits : [];
      const nbHits = typeof json?.nbHits === 'number' ? json.nbHits : hits.length;
      return {
        hits,
        nbHits,
        processingTimeMS: json?.processingTimeMS,
        query: json?.query != null ? String(json.query) : q,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Algolia search failed');
}

/** @returns {Promise<object[]>} */
export async function algoliaSearch(indexName, query, opts = {}) {
  const { hits } = await algoliaQuery(indexName, query, opts);
  return hits;
}

