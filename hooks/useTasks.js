// hooks/useTasks.js
// All data-fetching, state, and business logic for the Tasks screen.
// Extracted from app/(tabs)/tasks.js to keep that file as a thin orchestrator.

import { useState, useEffect, useRef } from 'react';
import { Platform, Alert } from 'react-native';
import React from 'react';
import { auth } from '../firebaseConfig';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { API_BASE_URL } from '../inventory-api/apiBase';
import { fetchFields } from './useAssetTypeFields';
import { useTasksCount } from '../contexts/TasksCountContext';
import { showError, showSuccess } from '../utils/showError';
import logger from '../utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (pure, no state)
// ─────────────────────────────────────────────────────────────────────────────

export const prettyDate = (d) => {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
      .format(d)
      .replace(/\u00A0/g, ' ');
  } catch {
    return '';
  }
};

export const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(+d)) return iso;
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
};

const toISO = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const addMonthsSafe = (date, months) => {
  const base = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const target = new Date(base.getFullYear(), base.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(base.getDate(), last));
  return target;
};

// A service may be scheduled no more than this many months ahead.
export const SERVICE_WINDOW_MONTHS = 6;

// True when an ISO date (YYYY-MM-DD) is between today and today+6 months inclusive.
export const isWithinServiceWindow = (isoDate) => {
  if (!isoDate) return false;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return false;
  d.setHours(0, 0, 0, 0);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = addMonthsSafe(start, SERVICE_WINDOW_MONTHS);
  end.setHours(23, 59, 59, 999);
  return d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
};

// ─────────────────────────────────────────────────────────────────────────────
// Task classification helpers
// ─────────────────────────────────────────────────────────────────────────────

const getTaskDueTime = (item) => {
  if (!item?.due) return null;
  const d = new Date(item.due);
  const ts = d.getTime();
  return Number.isNaN(ts) ? null : ts;
};

const getTaskTitle = (item) => String(item?.title || '').toLowerCase();
const getTaskActionType = (item) => String(item?.actionType || '').toUpperCase();

export const isRepairTask = (item) => {
  const type = getTaskActionType(item);
  const title = getTaskTitle(item);
  if (type === 'REPAIR') return true;
  return /repair/.test(title);
};

export const isServiceTask = (item) => {
  const type = getTaskActionType(item);
  const title = getTaskTitle(item);
  if (type === 'MAINTENANCE') return true;
  return /service|maint|maintenance/.test(title);
};

export const isOverdueTask = (item, todayMidMs) => {
  const ts = getTaskDueTime(item);
  if (ts == null) return false;
  return ts < todayMidMs;
};

export const isReminderTask = (item, todayMidMs) => {
  const ts = getTaskDueTime(item);
  if (ts == null) return false;
  return ts >= todayMidMs && /reminder/i.test(String(item?.title || ''));
};

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useTasks() {
  const router = useRouter();
  const { setTaskCount } = useTasksCount();

  // ── Sub-tab ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('tasks');
  const [hires, setHires] = useState([]);
  const [hiresLoading, setHiresLoading] = useState(false);

  // ── Core data ────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [dbAdmin, setDbAdmin] = useState(false);
  const [tasks, setTasks] = useState({ items: [], loading: true });
  const [taskFilter, setTaskFilter] = useState('all');

  // ── Modal / action state ─────────────────────────────────────────────────
  const actionScrollRef = useRef(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);
  const [actionTask, setActionTask] = useState(null);
  const [actionNextDate, setActionNextDate] = useState(new Date().toISOString().slice(0, 10));
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionDocSlug, setActionDocSlug] = useState('');
  const [actionDocFieldId, setActionDocFieldId] = useState(null);
  const [actionDocPicked, setActionDocPicked] = useState(null);
  const [actionPhoto, setActionPhoto] = useState(null);
  const [actionNote, setActionNote] = useState('');
  const [signoffReport, setSignoffReport] = useState(null);
  const [signoffChoice, setSignoffChoice] = useState('yes');
  const [relevantDocName, setRelevantDocName] = useState('');
  const [actionNeedsNextService, setActionNeedsNextService] = useState(false);

  // ── Auth watch ───────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      if (!currentUser) {
        router.replace('/(auth)/login');
        setUser(null);
      } else {
        setUser(currentUser);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  // ── Hire fetch ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'hire') return;
    let cancelled = false;
    (async () => {
      setHiresLoading(true);
      try {
        const res = await fetch(`${API_BASE_URL}/hire-disclaimer/hires`);
        if (!res.ok) throw new Error('Failed to fetch hires');
        const json = await res.json();
        if (!cancelled) setHires(Array.isArray(json.hires) ? json.hires : []);
      } catch (e) {
        logger.error('useTasks: hires fetch failed', e?.message || e);
        if (!cancelled) setHires([]);
      } finally {
        if (!cancelled) setHiresLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab]);

  // ── Task build: assets → overdue/reminder items ──────────────────────────
  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    (async () => {
      try {
        setTasks((prev) => ({ ...prev, loading: true }));

        const [assetsRes, userRes] = await Promise.all([
          fetch(`${API_BASE_URL}/assets`),
          fetch(`${API_BASE_URL}/users/${user.uid}`),
        ]);
        if (cancelled) return;

        const [data, userData] = await Promise.all([
          assetsRes.json(),
          userRes.ok ? userRes.json() : Promise.resolve({}),
        ]);
        if (cancelled) return;

        const role = String(userData?.role || '').toUpperCase();
        const resolvedAdmin = role === 'ADMIN';
        setDbAdmin(resolvedAdmin);

        const list = Array.isArray(data) ? data : [];
        const me = auth?.currentUser?.uid || null;
        const viewingAsAdmin = resolvedAdmin;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const isDateLike = (v) => {
          if (!v) return null;
          if (v instanceof Date) return v;
          const s = String(v).trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00');
          const d = new Date(s);
          return Number.isNaN(+d) ? null : d;
        };

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

        const typeIds = Array.from(new Set(list.map((a) => a.type_id).filter(Boolean)));
        const defsCache = {};
        await Promise.all(typeIds.map(async (tId) => {
          try {
            defsCache[tId] = await fetchFields(tId);
          } catch (e) {
            logger.warn('useTasks: type fields fetch failed', { tId, message: e?.message || e });
            defsCache[tId] = [];
          }
        }));
        if (cancelled) return;

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
              if (Number.isFinite(v) && v > 0)
                per[String(d.slug || '').toLowerCase()] = Math.floor(v);
            } catch {}
          }
          leadDaysMap[tId] = per;
        }

        const hasQrAssigned = (asset) => {
          const id = String(asset?.id || '');
          const looksShort = /^[A-Z0-9]{6,12}$/i.test(id);
          const notReserved =
            String(asset?.description || '').toLowerCase() !== 'qr reserved asset';
          return looksShort && notReserved;
        };

        const fromAsset = (a) => {
          const root = a?.asset && typeof a.asset === 'object' ? a.asset : a;
          const model = root?.model ?? root?.name ?? root?.asset_name ?? null;
          const serial = root?.serial_number ?? root?.serialNumber ?? null;
          const typeName = root?.asset_types?.name ?? root?.asset_type ?? root?.assetTypeName ?? (typeof root?.type === 'string' ? root.type : null);
          return {
            model: model && String(model).trim() ? String(model).trim() : null,
            serialNumber: serial != null && String(serial).trim() !== '' ? String(serial) : null,
            assetTypeName: typeName && String(typeName).trim() ? String(typeName).trim() : null,
          };
        };

        let items = [];
        for (const a of list) {
          if (!hasQrAssigned(a)) continue;
          if (!viewingAsAdmin) {
            if (!me) continue;
            if (a?.assigned_to_id && String(a.assigned_to_id) !== String(me)) continue;
          }

          const { model, serialNumber, assetTypeName } = fromAsset(a);
          const subtitle = model || assetTypeName || a.id;

          for (const k of keysOfInterest) {
            const d = isDateLike(a?.[k]);
            if (!d || d >= today) continue;
            const label = TOP_DATE_LABELS[k] || k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
            items.push({
              assetId: a.id,
              title: `${label} Overdue`,
              subtitle,
              model,
              assetTypeName,
              serialNumber,
              due: d,
              fieldKey: k,
              scope: 'top',
              key: `${a.id}|top||`,
              imageUrl: a.image_url || a.imageUrl || null,
              typeId: a.type_id || a.typeId || null,
            });
          }

          const f = a?.fields && typeof a.fields === 'object' ? a.fields : null;
          if (f) {
            for (const k of Object.keys(f)) {
              if (!keysOfInterest.includes(k) && !/date|due|expiry|expires/i.test(k)) continue;
              const d = isDateLike(f[k]);
              if (!d) continue;
              const tId = a.type_id || a.typeId || null;
              const daysLead = (leadDaysMap[tId] || {})[String(k).toLowerCase()] || 0;

              if (d < today) {
                const label =
                  TOP_DATE_LABELS[k] ||
                  k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                items.push({
                  assetId: a.id,
                  title: `${label} Overdue`,
                  subtitle,
                  model,
                  assetTypeName,
                  serialNumber,
                  due: d,
                  fieldKey: k,
                  scope: 'field',
                  key: `${a.id}|field|${k}|${+d}`,
                  imageUrl: a.image_url || a.imageUrl || null,
                  typeId: tId,
                });
              } else if (daysLead > 0) {
                const windowEnd = new Date(today.getTime() + daysLead * 24 * 60 * 60 * 1000);
                if (d >= today && d <= windowEnd) {
                  const label =
                    TOP_DATE_LABELS[k] ||
                    k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                  items.push({
                    assetId: a.id,
                    title: label,
                    subtitle,
                    model,
                    assetTypeName,
                    serialNumber,
                    due: d,
                    fieldKey: k,
                    scope: 'field',
                    key: `${a.id}|field|${k}|soon|${+d}`,
                    imageUrl: a.image_url || a.imageUrl || null,
                    typeId: tId,
                  });
                }
              }
            }
          }
        }

        if (!cancelled) {
          setTasks((prev) => {
            const existing = Array.isArray(prev.items) ? prev.items : [];
            const existingSignoffs = existing.filter((it) => it && it.kind === 'signoff');
            const merged = [...items, ...existingSignoffs];
            const seen = new Set();
            const deduped = merged
              .filter((it) => {
                const baseKey = it.actionId
                  ? `action:${it.actionId}`
                  : it.key || `${it.assetId || ''}|${it.title || ''}|${it.due ? +new Date(it.due) : ''}`;
                if (seen.has(baseKey)) return false;
                seen.add(baseKey);
                return true;
              })
              .sort((a, b) => {
                const da = a.due ? +new Date(a.due) : 0;
                const db = b.due ? +new Date(b.due) : 0;
                return da - db;
              });
            return { loading: false, items: deduped };
          });
        }
      } catch (e) {
        logger.error('useTasks: main tasks fetch failed', e?.message || e);
        if (!cancelled) setTasks({ items: [], loading: false });
      }
    })();
    return () => { cancelled = true; };
  }, [user?.uid]);

  // ── Pending sign-offs ────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    (async () => {
      try {
        const [signoffRes, userRes] = await Promise.all([
          fetch(`${API_BASE_URL}/assets/actions/pending-signoff`),
          fetch(`${API_BASE_URL}/users/${user.uid}`),
        ]);
        if (cancelled) return;
        const [j, userData] = await Promise.all([
          signoffRes.json(),
          userRes.ok ? userRes.json() : Promise.resolve({}),
        ]);
        if (cancelled) return;
        const role = String(userData?.role || '').toUpperCase();
        const resolvedAdmin = role === 'ADMIN';
        const me = auth?.currentUser?.uid || null;
        const arr = Array.isArray(j?.items) ? j.items : [];
        const mine = arr.filter((it) => {
          if (resolvedAdmin) return true;
          if (!me) return false;
          if (!it.assigned_to_id) return true;
          return String(it.assigned_to_id) === String(me);
        });

        const assetIds = [...new Set(mine.map((it) => it.assetId).filter(Boolean))];
        const assetMap = {};
        await Promise.all(
          assetIds.map(async (aid) => {
            if (cancelled) return;
            try {
              const res = await fetch(`${API_BASE_URL}/assets/${encodeURIComponent(aid)}`);
              if (!res.ok) return;
              const asset = await res.json();
              if (cancelled) return;
              assetMap[aid] = {
                model: asset.model ?? asset.name ?? asset.asset_name ?? null,
                serialNumber: asset.serial_number ?? asset.serialNumber ?? null,
                assetTypeName: asset.asset_types?.name ?? asset.asset_type ?? null,
              };
            } catch {}
          })
        );

        const enrichedMine = mine.map((it) => ({
          ...it,
          model: assetMap[it.assetId]?.model ?? it.model ?? null,
          serialNumber: assetMap[it.assetId]?.serialNumber ?? it.serialNumber ?? null,
          assetTypeName: assetMap[it.assetId]?.assetTypeName ?? it.assetTypeName ?? null,
        }));

        if (cancelled) return;
        setTasks((prev) => {
          const merged = [...(prev.items || []), ...enrichedMine];
          const seen = new Set();
          const deduped = merged
            .filter((it) => {
              const baseKey = it.actionId
                ? `action:${it.actionId}`
                : it.key || `${it.assetId || ''}|${it.title || ''}|${it.due ? +new Date(it.due) : ''}`;
              if (seen.has(baseKey)) return false;
              seen.add(baseKey);
              return true;
            })
            .sort((a, b) => {
              const da = a?.due ? new Date(a.due).getTime() : 0;
              const db = b?.due ? new Date(b.due).getTime() : 0;
              return da - db;
            });
          return { ...prev, items: deduped };
        });
      } catch (e) {
        logger.error('useTasks: pending signoff merge failed', e?.message || e);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.uid]);

  // ── Sync task count to context/badge ─────────────────────────────────────
  useEffect(() => {
    setTaskCount(tasks?.items?.length ?? 0);
  }, [tasks?.items?.length, setTaskCount]);

  // ─────────────────────────────────────────────────────────────────────────
  // Derived state
  // ─────────────────────────────────────────────────────────────────────────

  const todayMid = React.useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  const todayMidMs = todayMid.getTime();

  const taskItems = tasks?.items || [];
  const totalTasks = taskItems.length;

  const overdueCount     = taskItems.filter((i) => isOverdueTask(i, todayMidMs)).length;
  const reminderCount    = taskItems.filter((i) => isReminderTask(i, todayMidMs)).length;
  const maintenanceCount = taskItems.filter((i) => isServiceTask(i) || isRepairTask(i)).length;
  const repairCount      = taskItems.filter(isRepairTask).length;
  const hireCount        = taskItems.filter((i) => {
    const type = getTaskActionType(i);
    const title = getTaskTitle(i);
    if (type === 'HIRE') return true;
    return /hire/.test(title);
  }).length;

  const filteredTaskItems = React.useMemo(() => {
    if (taskFilter === 'overdue')      return taskItems.filter((i) => isOverdueTask(i, todayMidMs));
    if (taskFilter === 'reminder')     return taskItems.filter((i) => isReminderTask(i, todayMidMs));
    if (taskFilter === 'maintenance')  return taskItems.filter((i) => isServiceTask(i) || isRepairTask(i));
    if (taskFilter === 'repair')       return taskItems.filter(isRepairTask);
    if (taskFilter === 'hire')
      return taskItems.filter((i) => {
        const type = getTaskActionType(i);
        const title = getTaskTitle(i);
        if (type === 'HIRE') return true;
        return /hire/.test(title);
      });
    return taskItems;
  }, [taskFilter, taskItems, todayMidMs]);

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers exposed to UI
  // ─────────────────────────────────────────────────────────────────────────

  const setNextMonths = (months) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    setActionNextDate(toISO(addMonthsSafe(today, months)));
  };

  const openTaskAction = async (task) => {
    setActionTask(task);
    setActionDocSlug('');
    setActionDocPicked(null);
    setActionDocFieldId(null);
    setActionNeedsNextService(false);
    setActionPhoto(null);
    setNextMonths(6);
    setSignoffChoice('yes');
    setSignoffReport(null);
    setRelevantDocName('');
    setActionNote('');
    try {
      if (task?.kind === 'signoff' && task?.actionId && task?.assetId) {
        try {
          const actRes = await fetch(`${API_BASE_URL}/assets/${encodeURIComponent(task.assetId)}/actions`);
          if (actRes.ok) {
            const j = await actRes.json();
            const arr = Array.isArray(j?.actions) ? j.actions : [];
            const found = arr.find((a) => a.id === task.actionId);
            const images = Array.isArray(found?.data?.images) ? found.data.images : [];
            setActionTask((prev) => (prev ? { ...prev, actionImages: images } : prev));
          }
        } catch (e) {
          logger.warn('useTasks: action images fetch failed', e?.message || e);
        }
      }
      if (task?.typeId) {
        const arr = await fetchFields(task.typeId).catch((e) => {
          logger.warn('useTasks: openActionModal fields fetch failed', e?.message || e);
          return [];
        });
        let linkedSlug = '';
        let linkedFieldId = null;
        if (task.fieldKey) {
          const def = arr.find(
            (d) => String(d.slug || '').toLowerCase() === String(task.fieldKey).toLowerCase()
          );
          if (def) {
            try {
              const vr =
                (def.validation_rules && typeof def.validation_rules === 'object')
                  ? def.validation_rules
                  : (def.validation_rules ? JSON.parse(def.validation_rules) : null);
              const opts = (def.options && typeof def.options === 'object') ? def.options : null;
              const link = (vr && (vr.requires_document_slug || vr.require_document_slug)) ||
                (opts && (opts.requires_document_slug || opts.require_document_slug));
              const slug = Array.isArray(link) ? link[0] || '' : link || '';
              if (slug) { linkedSlug = String(slug); }
              const docDef = arr.find((d) => {
                const linkNorm = String(linkedSlug).toLowerCase().replace(/\s+/g, '_');
                const dSlug = String(d.slug || '').toLowerCase();
                const dName = String(d.name || '').toLowerCase();
                const linkLower = String(linkedSlug).toLowerCase();
                return dSlug === linkNorm || dSlug === linkLower || dName === linkLower;
              });
              if (docDef?.id) linkedFieldId = String(docDef.id);
            } catch {}
          }
        }
        if (!linkedSlug) {
          try {
            const urlTypeFields = arr.filter(
              (d) => String(d?.field_type?.slug || d?.field_type?.name || '').toLowerCase() === 'url'
            );
            const dateSlug = String(task.fieldKey || '').toLowerCase();
            for (const u of urlTypeFields) {
              const uOpts = (u.options && typeof u.options === 'object') ? u.options : null;
              const uVr = (u.validation_rules && typeof u.validation_rules === 'object') ? u.validation_rules : (u.validation_rules ? JSON.parse(u.validation_rules) : null);
              const relatedDate = (uOpts && (uOpts.related_date_slug || uOpts.linked_date_slug || uOpts.requires_date_slug)) ||
                (uVr && (uVr.related_date_slug || uVr.linked_date_slug || uVr.requires_date_slug));
              const rel = Array.isArray(relatedDate) ? relatedDate[0] : relatedDate;
              if (rel && String(rel).toLowerCase() === dateSlug) {
                linkedSlug = String(u.slug || u.name || '');
                if (u.id) linkedFieldId = String(u.id);
                break;
              }
            }
          } catch (e) {
            logger.warn('useTasks: linked doc field lookup failed', e?.message || e);
          }
        }
        if (linkedSlug) setActionDocSlug(linkedSlug);
        if (linkedFieldId) setActionDocFieldId(linkedFieldId);
        try {
          const nextDef = arr.find(
            (d) => String(d.slug || '').toLowerCase() === 'next_service_date'
          );
          if (
            nextDef &&
            String(nextDef?.field_type?.slug || nextDef?.field_type?.name || '').toLowerCase() === 'date'
          ) {
            setActionNeedsNextService(true);
          }
        } catch (e) {
          logger.warn('useTasks: next service date field lookup failed', e?.message || e);
        }
      }
    } catch (e) {
      logger.warn('useTasks: openActionModal setup failed', e?.message || e);
    }
    setActionOpen(true);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Submit handler
  // ─────────────────────────────────────────────────────────────────────────

  const handleSubmitTaskAction = async () => {
    if (!actionTask) { setActionOpen(false); return; }

    if (actionTask.scope === 'field' && actionDocSlug && !actionDocPicked) {
      Alert.alert('Document required', 'Please attach the relevant document (e.g. updated certificate) for this task.');
      return;
    }
    try {
      setActionSubmitting(true);

      // ── Sign-off path ──────────────────────────────────────────────────
      if (actionTask.kind === 'signoff') {
        const userHeaders = {};
        try {
          const u = auth?.currentUser;
          if (u?.uid) {
            userHeaders['X-User-Id'] = String(u.uid);
            userHeaders['X-User-Email'] = u.email || '';
            userHeaders['X-User-Name'] = u.displayName || (u.email ? u.email.split('@')[0] : '');
          }
        } catch {}

        if (signoffChoice === 'yes' && String(actionTask.actionType || '').toUpperCase() === 'MAINTENANCE') {
          if (!actionNextDate) {
            Alert.alert('Missing date', 'Please select the next service date.');
            setActionSubmitting(false);
            return;
          }
          // A service may only be booked up to 6 months ahead.
          if (!isWithinServiceWindow(actionNextDate)) {
            Alert.alert('Date too far ahead', 'The next service can be scheduled at most 6 months from today.');
            setActionSubmitting(false);
            return;
          }
        }

        const signoffRes = await fetch(
          `${API_BASE_URL}/assets/${actionTask.assetId}/actions/${actionTask.actionId}/signoff`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...userHeaders },
            body: JSON.stringify({ completed: signoffChoice === 'yes', note: actionNote }),
          }
        );
        if (!signoffRes.ok) throw new Error('Failed to sign off');

        if (
          signoffChoice === 'yes' &&
          String(actionTask.actionType || '').toUpperCase() === 'MAINTENANCE' &&
          actionNextDate
        ) {
          try {
            const body = { fields: {} };
            if (actionNeedsNextService) {
              body.fields.next_service_date = actionNextDate;
              body.next_service_date = actionNextDate;
            } else {
              body.next_service_date = actionNextDate;
            }
            await fetch(`${API_BASE_URL}/assets/${actionTask.assetId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', ...userHeaders },
              body: JSON.stringify(body),
            });
          } catch (e) {
            logger.warn('Failed to update next service date on sign-off', e);
          }
        }

        if (signoffChoice === 'yes') {
          if (signoffReport?.uri) {
            try {
              let fileObj;
              if (Platform.OS === 'web') {
                const resp = await fetch(signoffReport.uri);
                const blob = await resp.blob();
                fileObj = new File([blob], signoffReport.name || 'report.pdf', {
                  type: signoffReport.mimeType || blob.type || 'application/pdf',
                });
              } else {
                fileObj = { uri: signoffReport.uri, name: signoffReport.name || 'report.pdf', type: signoffReport.mimeType || 'application/pdf' };
              }
              const fd = new FormData();
              fd.append('file', fileObj);
              const label = String(actionTask.actionType || '').toUpperCase() === 'REPAIR' ? 'Repair Report' : 'Service Report';
              fd.append('title', label);
              fd.append('kind', label);
              fd.append('related_date_label', label);
              const reportValidUntil = (actionNextDate && String(actionNextDate).trim()) ? String(actionNextDate).trim().slice(0, 10) : new Date().toISOString().slice(0, 10);
              fd.append('related_date', reportValidUntil);
              await fetch(`${API_BASE_URL}/assets/${actionTask.assetId}/documents/upload`, { method: 'POST', headers: userHeaders, body: fd });
            } catch (e) {
              logger.warn('Failed to upload sign-off report', e);
            }
          }

          if (actionPhoto?.uri) {
            try {
              const fd = new FormData();
              if (Platform.OS === 'web') {
                const resp = await fetch(actionPhoto.uri);
                const blob = await resp.blob();
                const file = new File([blob], actionPhoto.name || 'task-photo.jpg', { type: actionPhoto.mimeType || blob.type || 'image/jpeg' });
                fd.append('file', file, file.name);
              } else {
                fd.append('file', { uri: actionPhoto.uri, name: actionPhoto.name || 'task-photo.jpg', type: actionPhoto.mimeType || 'image/jpeg' });
              }
              const photoLabel = String(actionTask.actionType || '').toUpperCase() === 'REPAIR' ? 'Repair photos' : 'Service photos';
              fd.append('title', photoLabel);
              fd.append('kind', photoLabel);
              await fetch(`${API_BASE_URL}/assets/${actionTask.assetId}/documents/upload`, { method: 'POST', headers: userHeaders, body: fd });
            } catch (e) {
              logger.warn('Failed to upload task photo', e);
            }
          }

          if (actionDocPicked?.uri) {
            try {
              let fileObj;
              if (Platform.OS === 'web') {
                const resp = await fetch(actionDocPicked.uri);
                const blob = await resp.blob();
                fileObj = new File([blob], actionDocPicked.name || 'document.pdf', { type: actionDocPicked.mimeType || blob.type || 'application/pdf' });
              } else {
                fileObj = { uri: actionDocPicked.uri, name: actionDocPicked.name || 'document.pdf', type: actionDocPicked.mimeType || 'application/pdf' };
              }
              const fd = new FormData();
              fd.append('file', fileObj);
              if (actionDocFieldId) fd.append('asset_type_field_id', String(actionDocFieldId));
              const docLabel = (relevantDocName && relevantDocName.trim())
                ? String(relevantDocName).trim()
                : (actionDocSlug ? String(actionDocSlug).replace(/_/g, ' ') : 'Other relevant document');
              fd.append('title', docLabel);
              fd.append('kind', docLabel);
              await fetch(`${API_BASE_URL}/assets/${actionTask.assetId}/documents/upload`, { method: 'POST', headers: userHeaders, body: fd });
            } catch (e) {
              logger.warn('Failed to upload relevant document', e);
            }
          }
        }

        const upperType = String(actionTask.actionType || '').toUpperCase();
        const shouldResetStatus = signoffChoice === 'yes' && (upperType === 'MAINTENANCE' || upperType === 'REPAIR');
        if (shouldResetStatus) {
          try {
            await fetch(`${API_BASE_URL}/assets/${actionTask.assetId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', ...userHeaders },
              body: JSON.stringify({ status: 'In Service' }),
            });
          } catch (e) {
            logger.warn('Failed to reset status after sign-off', e);
          }
          try {
            await fetch(`${API_BASE_URL}/assets/${actionTask.assetId}/actions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...userHeaders },
              body: JSON.stringify({
                type: 'STATUS_CHANGE',
                note: `${upperType === 'REPAIR' ? 'Repair' : 'Service'} signed off`,
                details: { signed_off: true, status: 'In Service', source_action_id: actionTask.actionId },
                occurred_at: new Date().toISOString(),
              }),
            });
          } catch (e) {
            logger.warn('Failed to log sign-off status change', e);
          }
        }

        if (signoffChoice === 'yes') {
          const completedAssetId = actionTask.assetId || actionTask.asset_id || null;
          const completedActionId = actionTask.actionId || null;
          setTasks((prev) => {
            const items = (prev.items || []).filter((t) => {
              if (t === actionTask) return false;
              if (t.kind === 'signoff' && completedActionId != null && completedAssetId != null) {
                const tid = t.assetId || t.asset_id || null;
                if (String(tid) === String(completedAssetId) && String(t.actionId || '') === String(completedActionId)) return false;
              }
              if (!completedAssetId) return true;
              const tid = t.assetId || t.asset_id || null;
              if (!tid || String(tid) !== String(completedAssetId)) return true;
              const k = String(t.fieldKey || '').toLowerCase();
              const title = String(t.title || '').toLowerCase();
              if (k.includes('service') || k.includes('maint')) return false;
              if (/service|maint|maintenance/.test(title)) return false;
              return true;
            });
            return { items, loading: false };
          });
        }

        if (signoffChoice === 'yes') {
          const actionTypeLabel = String(actionTask.actionType || '').toUpperCase() === 'REPAIR' ? 'Repair' : 'Service';
          showSuccess(
            `${actionTypeLabel} has been signed off successfully.`,
            'Signed off',
            [{ text: 'OK', onPress: () => { setActionOpen(false); setActionSubmitting(false); } }]
          );
        } else {
          setActionOpen(false);
          setActionSubmitting(false);
        }
        return;
      }

      // ── Regular task path ──────────────────────────────────────────────
      const targetAssetId = actionTask.assetId || actionTask.asset_id;
      if (!targetAssetId) throw new Error('Missing asset id for task action');
      const url = `${API_BASE_URL}/assets/${targetAssetId}`;
      const headers = { 'Content-Type': 'application/json' };
      try {
        const u = auth?.currentUser;
        if (u?.uid) {
          headers['X-User-Id'] = String(u.uid);
          headers['X-User-Email'] = u.email || '';
          headers['X-User-Name'] = u.displayName || (u.email ? u.email.split('@')[0] : '');
        }
      } catch (e) {
        logger.warn('useTasks: auth header build failed', e?.message || e);
      }

      let body = { fields: {} };
      const k = String(actionTask.fieldKey || '').toLowerCase();
      const scope = actionTask.scope || 'field';
      if (actionTask.fieldKey) body.fields[actionTask.fieldKey] = actionNextDate;
      if (k === 'next_service_date') body.next_service_date = actionNextDate;
      if (!actionTask.fieldKey && scope === 'top' && k === 'next_service_date') body.next_service_date = actionNextDate;
      if (actionNeedsNextService && !body.fields.next_service_date) {
        body.fields.next_service_date = actionNextDate;
        if (!body.next_service_date) body.next_service_date = actionNextDate;
      }

      if (actionDocPicked) {
        try {
          let fileObj;
          if (Platform.OS === 'web') {
            const resp = await fetch(actionDocPicked.uri);
            const blob = await resp.blob();
            fileObj = new File([blob], actionDocPicked.name || 'document.pdf', {
              type: actionDocPicked.mimeType || blob.type || 'application/pdf',
            });
          } else {
            fileObj = { uri: actionDocPicked.uri, name: actionDocPicked.name || 'document.pdf', type: actionDocPicked.mimeType || 'application/pdf' };
          }
          const fd = new FormData();
          fd.append('file', fileObj);
          if (actionDocFieldId) fd.append('asset_type_field_id', String(actionDocFieldId));
          const toTitle = (s) => {
            const txt = String(s || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
            return txt.split(' ').map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : '')).join(' ');
          };
          const niceName = actionDocSlug
            ? toTitle(actionDocSlug)
            : toTitle(actionTask?.fieldKey || actionTask?.title) || 'Task document';
          fd.append('title', niceName);
          fd.append('kind', niceName);
          fd.append('related_date_label', String(actionTask.title || actionTask.fieldKey || 'Date').replace(/_/g, ' '));
          fd.append('related_date', actionNextDate);
          const uploadHeaders = { ...headers };
          delete uploadHeaders['Content-Type'];
          const up = await fetch(`${API_BASE_URL}/assets/${actionTask.assetId}/documents/upload`, { method: 'POST', headers: uploadHeaders, body: fd });
          const upj = await up.json().catch(() => ({}));
          if (up.ok && upj?.document?.url) {
            if (actionDocSlug) {
              body.fields[actionDocSlug] = upj.document.url;
              body.documentation_url = upj.document.url;
            }
          }
        } catch (e) {
          logger.warn('useTasks: document upload failed (non-fatal)', e?.message || e);
        }
      }

      if (actionNote && String(actionNote).trim()) body.notes = String(actionNote).trim();
      body.skip_required_documents = true;

      const res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`Update failed (${res.status})`);

      let actionType = 'STATUS_CHANGE';
      if (k.includes('repair')) actionType = 'REPAIR';
      else if (k.includes('service') || k.includes('maint')) actionType = 'MAINTENANCE';
      let note = `${(actionTask.title || '').replace(/\s*Overdue$/, '')} completed; next on ${prettyDate(new Date(actionNextDate))}`;
      if (actionNote && String(actionNote).trim()) note += ` — ${String(actionNote).trim()}`;
      try {
        await fetch(`${API_BASE_URL}/assets/${actionTask.assetId}/actions`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: actionType, note, occurred_at: new Date().toISOString() }),
        });
      } catch (e) {
        logger.warn('useTasks: action record failed (non-fatal)', e?.message || e);
      }

      if (actionPhoto?.uri) {
        try {
          const photoHeaders = { ...headers };
          delete photoHeaders['Content-Type'];
          const u = auth?.currentUser;
          if (u?.uid) photoHeaders['X-User-Id'] = String(u.uid);
          const fd = new FormData();
          if (Platform.OS === 'web') {
            const resp = await fetch(actionPhoto.uri);
            const blob = await resp.blob();
            const file = new File([blob], actionPhoto.name || 'task-photo.jpg', { type: actionPhoto.mimeType || blob.type || 'image/jpeg' });
            fd.append('file', file, file.name);
          } else {
            fd.append('file', { uri: actionPhoto.uri, name: actionPhoto.name || 'task-photo.jpg', type: actionPhoto.mimeType || 'image/jpeg' });
          }
          const photoLabel = String(actionTask.actionType || '').toUpperCase() === 'REPAIR' ? 'Repair photos' : 'Service photos';
          fd.append('title', photoLabel);
          fd.append('kind', photoLabel);
          await fetch(`${API_BASE_URL}/assets/${actionTask.assetId}/documents/upload`, { method: 'POST', headers: photoHeaders, body: fd });
        } catch (e) {
          logger.warn('Failed to upload task photo', e);
        }
      }

      setTasks((prev) => {
        const rest = (prev.items || []).filter((t) =>
          t.key
            ? t.key !== actionTask.key
            : !(t.assetId === actionTask.assetId && +new Date(t.due) === +new Date(actionTask.due))
        );
        return { items: rest, loading: false };
      });
      setActionOpen(false);
    } catch (e) {
      showError(e, 'Please try again.', 'Failed to save');
    } finally {
      setActionSubmitting(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Return everything the UI needs
  // ─────────────────────────────────────────────────────────────────────────

  return {
    // Core state
    loading,
    user,
    canAdmin: dbAdmin,
    tasks,
    activeTab,
    setActiveTab,
    hires,
    hiresLoading,
    taskFilter,
    setTaskFilter,

    // Derived counts
    totalTasks,
    overdueCount,
    reminderCount,
    maintenanceCount,
    repairCount,
    hireCount,
    filteredTaskItems,

    // Task classification helpers (bound to todayMidMs)
    isOverdueTask: (item) => isOverdueTask(item, todayMidMs),
    isReminderTask: (item) => isReminderTask(item, todayMidMs),
    isRepairTask,
    isServiceTask,

    // Modal / action state
    actionScrollRef,
    dateOpen,
    setDateOpen,
    actionOpen,
    setActionOpen,
    actionTask,
    actionNextDate,
    setActionNextDate,
    actionSubmitting,
    actionDocSlug,
    actionDocPicked,
    setActionDocPicked,
    actionPhoto,
    setActionPhoto,
    actionNote,
    setActionNote,
    signoffReport,
    setSignoffReport,
    signoffChoice,
    setSignoffChoice,
    relevantDocName,
    setRelevantDocName,
    actionNeedsNextService,

    // Actions
    openTaskAction,
    handleSubmitTaskAction,
    setNextMonths,
  };
}
