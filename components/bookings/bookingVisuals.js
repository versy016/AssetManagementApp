// components/bookings/bookingVisuals.js
// Shared visual tokens + helpers for the bookings calendar, gantt and detail modal,
// so colours, status styling and date formatting stay consistent across all three.
import { Colors } from '../../constants/uiTheme';

// Warm paper palette used by the calendar / gantt chrome.
export const P = {
  ink: '#2A2320', muted: '#8A7E6B', faint: '#BCAF98',
  card: '#FBF6EE', cell: '#FCF8F1', wknd: '#F3EBDD',
  line: '#E1D5C0', lineStrong: '#D8C9AF',
  accent: '#EA580C', accentSoft: '#FCEBDD',
};

// Distinct, saturated colours so different assets read as different bars. Colour is
// stable per asset (hashed from its id), so the same asset is always the same colour.
const PALETTE = ['#4F46E5', '#0891B2', '#059669', '#CA8A04', '#DC2626', '#DB2777', '#7C3AED', '#EA580C', '#0D9488', '#65A30D', '#2563EB', '#9333EA'];
export const colorForAsset = (id) => {
  let h = 0; const str = String(id || '');
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
};
export const initialsOf = (name) => {
  const p = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?';
};

export const STATUS_LABEL = {
  CONFIRMED: 'Confirmed', REQUESTED: 'Needs approval', ACTIVE: 'Out',
  COMPLETED: 'Completed', CANCELLED: 'Cancelled', REJECTED: 'Rejected',
};
export const STATUS_STYLE = {
  CONFIRMED: { icon: 'event-available', bg: Colors.infoBg, fg: Colors.infoFg, bd: Colors.infoBorder },
  REQUESTED: { icon: 'schedule', bg: Colors.warningBg, fg: Colors.warningFg, bd: Colors.warningBorder },
  ACTIVE: { icon: 'play-arrow', bg: Colors.successBg, fg: Colors.successFg, bd: Colors.successFg },
  COMPLETED: { icon: 'check', bg: Colors.chip, fg: Colors.sub, bd: Colors.line },
  CANCELLED: { icon: 'block', bg: Colors.dangerBg, fg: Colors.dangerFg, bd: Colors.dangerBorder },
  REJECTED: { icon: 'block', bg: Colors.dangerBg, fg: Colors.dangerFg, bd: Colors.dangerBorder },
};
export const HIDDEN_STATUSES = new Set(['CANCELLED', 'REJECTED']);

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
export const todayUtc = () => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); };
export const parseYmd = (y) => new Date(`${y}T00:00:00Z`);
export const dayDiff = (a, b) => Math.round((parseYmd(a) - parseYmd(b)) / 86400000);
export const fmtD = (y) => {
  if (!y) return '';
  const d = parseYmd(y);
  return Number.isNaN(+d) ? y : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};
export const fmtLong = (y) => {
  if (!y) return '';
  const d = parseYmd(y);
  return Number.isNaN(+d) ? y : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
};
