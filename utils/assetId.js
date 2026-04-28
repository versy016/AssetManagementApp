/**
 * True when the asset row still uses a UUID primary id (no physical QR sticker id yet).
 * Matches search "QR awaiting" / "Only QR awaiting" filtering.
 */
export function isAssetIdAwaitingQr(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''));
}
