/**
 * Fetches task count for the current user (for tab badge).
 * Reuses the same logic as the Tasks screen so the count matches.
 */
import { API_BASE_URL } from '../inventory-api/apiBase';

const TOP_DATE_LABELS = {
  next_service_date: 'Next Service',
  service_due: 'Service',
  service_date: 'Service',
  maintenance_due: 'Maintenance',
  maintenance_date: 'Maintenance',
  repair_due: 'Repair',
  repair_date: 'Repair',
  certificate_expiry: 'Certificate Expiry',
  cert_expiry: 'Certificate Expiry',
  calibration_due: 'Calibration',
  calibration_date: 'Calibration',
  inspection_due: 'Inspection',
  inspection_date: 'Inspection',
  expiry: 'Expiry',
  expires_at: 'Expiry',
};
const keysOfInterest = Object.keys(TOP_DATE_LABELS);

function isDateLike(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00');
  const d = new Date(s);
  return Number.isNaN(+d) ? null : d;
}

function hasQrAssigned(asset) {
  const id = String(asset?.id || '');
  const looksShort = /^[A-Z0-9]{6,12}$/i.test(id);
  const notReserved = String(asset?.description || '').toLowerCase() !== 'qr reserved asset';
  return looksShort && notReserved;
}

export async function fetchTaskCount(userId, canAdmin) {
  try {
    const [assetsRes, signoffRes] = await Promise.all([
      fetch(`${API_BASE_URL}/assets`),
      fetch(`${API_BASE_URL}/assets/actions/pending-signoff`),
    ]);
    const list = Array.isArray(await assetsRes.json()) ? await assetsRes.json() : [];
    const signoffJson = await signoffRes.json().catch(() => ({}));
    const signoffItems = Array.isArray(signoffJson?.items) ? signoffJson.items : [];
    const me = userId || null;
    const viewingAsAdmin = !!canAdmin;
    const mine = signoffItems.filter((it) => {
      if (viewingAsAdmin) return true;
      if (!me) return false;
      if (!it.assigned_to_id) return true;
      return String(it.assigned_to_id) === String(me);
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const typeIds = Array.from(new Set(list.map((a) => a.type_id).filter(Boolean)));
    const defsCache = {};
    for (const tId of typeIds) {
      try {
        const r = await fetch(`${API_BASE_URL}/assets/asset-types/${tId}/fields`);
        const arr = await r.json();
        defsCache[tId] = Array.isArray(arr) ? arr : [];
      } catch {
        defsCache[tId] = [];
      }
    }
    const leadDaysMap = {};
    for (const [tId, defs] of Object.entries(defsCache)) {
      const per = {};
      for (const d of defs) {
        try {
          const vr =
            d.validation_rules && typeof d.validation_rules === 'object'
              ? d.validation_rules
              : d.validation_rules
                ? JSON.parse(d.validation_rules)
                : null;
          const n = vr && (vr.reminder_lead_days || vr.reminderDays || vr.reminder_days);
          const v = Number(n);
          if (Number.isFinite(v) && v > 0) per[String(d.slug || '').toLowerCase()] = Math.floor(v);
        } catch {}
      }
      leadDaysMap[tId] = per;
    }

    const seen = new Set();
    for (const a of list) {
      if (!hasQrAssigned(a)) continue;
      if (!viewingAsAdmin) {
        if (!me) continue;
        if (a?.assigned_to_id && String(a.assigned_to_id) !== String(me)) continue;
      }
      const tId = a.type_id || a.typeId || null;

      for (const k of keysOfInterest) {
        const d = isDateLike(a?.[k]);
        if (!d || d >= today) continue;
        seen.add(`${a.id}|top|${k}|${+d}`);
      }

      const f = a?.fields && typeof a.fields === 'object' ? a.fields : null;
      if (f) {
        for (const k of Object.keys(f)) {
          if (!keysOfInterest.includes(k) && !/date|due|expiry|expires/i.test(k)) continue;
          const d = isDateLike(f[k]);
          if (!d) continue;
          const daysLead = (leadDaysMap[tId] || {})[String(k).toLowerCase()] || 0;
          if (d < today) seen.add(`${a.id}|field|${k}|${+d}`);
          else if (daysLead > 0) {
            const windowEnd = new Date(today.getTime() + daysLead * 24 * 60 * 60 * 1000);
            if (d >= today && d <= windowEnd) seen.add(`${a.id}|field|${k}|soon|${+d}`);
          }
        }
      }
    }
    for (const it of mine) {
      const baseKey = it.actionId ? `action:${it.actionId}` : `${it.assetId || ''}|${it.title || ''}|${it.due ? +new Date(it.due) : ''}`;
      seen.add(baseKey);
    }
    return seen.size;
  } catch {
    return 0;
  }
}
