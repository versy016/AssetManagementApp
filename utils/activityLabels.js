/**
 * Shared labels for activity feeds (CHECK_IN / CHECK_OUT / TRANSFER).
 * DB action types stay CHECK_IN, CHECK_OUT, TRANSFER — only display strings change.
 */

/**
 * @param {{ name?: string, useremail?: string, email?: string } | null | undefined} toUser
 * @param {{ email?: string | null, displayName?: string | null } | null | undefined} firebaseUser
 */
export function transferRecipientMatchesFirebaseUser(toUser, firebaseUser) {
  if (!firebaseUser || !toUser) return false;
  const fe = String(firebaseUser.email || '').trim().toLowerCase();
  const te = String(toUser.useremail || toUser.email || '').trim().toLowerCase();
  if (fe && te && fe === te) return true;
  const fd = String(firebaseUser.displayName || '').trim().toLowerCase();
  const tn = String(toUser.name || '').trim().toLowerCase();
  if (fd && tn && fd === tn) return true;
  return false;
}

/**
 * When the feed only has a display string for `to` (name or email).
 * @param {string | null | undefined} toLabel
 * @param {{ email?: string | null, displayName?: string | null } | null | undefined} firebaseUser
 */
export function activityToLabelStringIsCurrentUser(toLabel, firebaseUser) {
  if (!toLabel || !firebaseUser) return false;
  const t = String(toLabel).trim().toLowerCase();
  const e = String(firebaseUser.email || '').trim().toLowerCase();
  if (e && t === e) return true;
  const d = String(firebaseUser.displayName || '').trim().toLowerCase();
  if (d && t === d) return true;
  return false;
}

/**
 * Headline for activity list rows (uppercase, matches existing Activity screen style).
 * @param {string} actionType
 * @param {{ firebaseUser?: { email?: string | null, displayName?: string | null } | null, toUser?: object | null, toLabel?: string | null }} [ctx]
 */
export function formatActivityListTitle(actionType, ctx = {}) {
  const t = String(actionType || '').toUpperCase();
  const { firebaseUser, toUser, toLabel } = ctx;
  if (t === 'CHECK_IN') return 'TRANSFER TO OFFICE';
  if (t === 'CHECK_OUT') return 'TRANSFER OUT OF OFFICE';
  if (t === 'TRANSFER') {
    const toMe = toUser
      ? transferRecipientMatchesFirebaseUser(toUser, firebaseUser)
      : activityToLabelStringIsCurrentUser(toLabel, firebaseUser);
    return toMe ? 'TRANSFER TO ME' : 'TRANSFER';
  }
  return t.replace(/_/g, ' ');
}
