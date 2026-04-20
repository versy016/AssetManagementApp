/**
 * Fetches task count for the current user (for tab badge).
 * Delegates all computation to GET /assets/tasks/count on the backend.
 * Previously this file contained 132 lines of N+1 client-side logic.
 */
import { API_BASE_URL } from '../inventory-api/apiBase';
import { auth } from '../firebaseConfig';

/**
 * @param {string|null} _userId  - kept for backwards compatibility, unused
 * @param {boolean} _canAdmin    - kept for backwards compatibility, unused
 * @returns {Promise<number>}
 */
export async function fetchTaskCount(_userId, _canAdmin) {
  try {
    const user = auth.currentUser;
    if (!user) return 0;

    const token = await user.getIdToken();
    const res = await fetch(`${API_BASE_URL}/assets/tasks/count`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) return 0;
    const json = await res.json();
    return typeof json?.count === 'number' ? json.count : 0;
  } catch {
    return 0;
  }
}
