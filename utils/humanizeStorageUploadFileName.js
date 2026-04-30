/**
 * API stores uploads as "{timestampMs}-{random6}-{originalFileName}" (see inventory-api safeS3Key / safeKey).
 * The URL's last segment includes that prefix; strip it for display only — the S3 object key is unchanged.
 */
export default function humanizeStorageUploadFileName(name) {
  const t = String(name || '').trim();
  if (!t || t === 'View document') return t || 'View document';
  const m = t.match(/^(\d{10,16})-([a-z0-9]{4,10})-(.+)$/i);
  if (m && m[3]) {
    const rest = m[3].replace(/_/g, ' ').trim();
    return rest || t;
  }
  return t;
}
