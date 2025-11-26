// utils/date.js
// Shared date formatting helpers for display-only formatting.

function coerceDate(d) {
  try {
    if (!d) return null;
    if (d instanceof Date) return isNaN(+d) ? null : d;
    if (typeof d === 'string') {
      const s = d.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const [y, m, day] = s.split('-').map(Number);
        return new Date(y, m - 1, day); // interpret as local date
      }
      const t = new Date(s);
      return isNaN(+t) ? null : t;
    }
    const t = new Date(d);
    return isNaN(+t) ? null : t;
  } catch {
    return null;
  }
}

export function formatDisplayDate(d, fallback = '—') {
  const dt = coerceDate(d);
  if (!dt) return fallback;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    }).format(dt).replace(/\u00A0/g, ' ');
  } catch {
    return fallback;
  }
}

export function formatDisplayDateTime(d, fallback = '') {
  const dt = coerceDate(d);
  if (!dt) return fallback;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).format(dt).replace(/\u00A0/g, ' ').replace(',', '');
  } catch {
    return fallback;
  }
}

