// Public Algolia search credentials (safe for frontend)
export const ALGOLIA_APP_ID = 'ENGDR4U6W2';
export const ALGOLIA_SEARCH_KEY = '22d7addd0f220bff6a0f83b8a7f4e287';

// Index names
export const ALGOLIA_INDEX_CLIENTS = 'clients';
export const ALGOLIA_INDEX_PROJECTS = 'projects';

// Minimal search helper using REST API
export async function algoliaSearch(indexName, query, opts = {}) {
  const appId = ALGOLIA_APP_ID;
  const apiKey = ALGOLIA_SEARCH_KEY;
  const url = `https://${appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(indexName)}/query`;
  const body = {
    query: String(query || ''),
    hitsPerPage: opts.hitsPerPage ?? 20,
    attributesToRetrieve: opts.attributesToRetrieve ?? ['objectID', 'name', 'title', 'label'],
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Algolia-Application-Id': appId,
      'X-Algolia-API-Key': apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(t || `Algolia search failed (${res.status})`);
  }
  const json = await res.json();
  return json?.hits || [];
}

