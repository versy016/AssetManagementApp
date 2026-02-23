// tasks.js - Tasks tab screen (iOS & Android); moved from dashboard

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Animated,
  Dimensions,
  Modal,
  Platform,
  Image,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { BlurView } from 'expo-blur';
import { DatePickerModal } from 'react-native-paper-dates';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { auth } from '../../firebaseConfig';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import ScreenWrapper from '../../components/ui/ScreenWrapper';
import AppTextInput from '../../components/ui/AppTextInput';
import { useTheme } from 'react-native-paper';

export default function TasksScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [dbAdmin, setDbAdmin] = useState(false);
  const [tasks, setTasks] = useState({ items: [], loading: true });
  const [taskFilter, setTaskFilter] = useState('all');
  const [taskIndex, setTaskIndex] = useState(0);
  const [taskWidth, setTaskWidth] = useState(Math.max(1, Dimensions.get('window')?.width - 48));
  const taskListRef = useRef(null);
  const scrollX = useRef(new Animated.Value(0)).current;

  const [dateOpen, setDateOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);
  const [actionTask, setActionTask] = useState(null);
  const [actionNextDate, setActionNextDate] = useState(new Date().toISOString().slice(0, 10));
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionDocSlug, setActionDocSlug] = useState('');
  const [actionDocFieldId, setActionDocFieldId] = useState(null);
  const [actionDocPicked, setActionDocPicked] = useState(null);
  const [actionNote, setActionNote] = useState('');
  const [signoffReport, setSignoffReport] = useState(null);
  const [signoffChoice, setSignoffChoice] = useState('yes');
  const [actionNeedsNextService, setActionNeedsNextService] = useState(false);

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

  useEffect(() => {
    if (!user?.uid) {
      setDbAdmin(false);
      return;
    }
    let ignore = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/users/${user.uid}`);
        if (!res.ok) throw new Error('Failed to load user');
        const data = await res.json();
        if (!ignore) {
          const role = String(data?.role || '').toUpperCase();
          setDbAdmin(role === 'ADMIN');
        }
      } catch {
        if (!ignore) setDbAdmin(false);
      }
    })();
    return () => { ignore = true; };
  }, [user?.uid]);

  const canAdmin = dbAdmin;

  // Build tasks from assets
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setTasks((prev) => ({ ...prev, loading: true }));
        const res = await fetch(`${API_BASE_URL}/assets`);
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        const me = auth?.currentUser?.uid || null;
        const viewingAsAdmin = !!canAdmin;
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
              if (
                !keysOfInterest.includes(k) &&
                !/date|due|expiry|expires/i.test(k)
              )
                continue;
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
                const windowEnd = new Date(
                  today.getTime() + daysLead * 24 * 60 * 60 * 1000
                );
                if (d >= today && d <= windowEnd) {
                  const label =
                    TOP_DATE_LABELS[k] ||
                    k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                  items.push({
                    assetId: a.id,
                    title: `${label} Reminder`,
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
        if (!cancelled) setTasks({ items: [], loading: false });
      }
    })();
    return () => { cancelled = true; };
  }, [user, canAdmin]);

  // Pending sign-off tasks — fetch full asset details by assetId so we show model, type, serial
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_BASE_URL}/assets/actions/pending-signoff`);
        const j = await r.json();
        const me = auth?.currentUser?.uid || null;
        const arr = Array.isArray(j?.items) ? j.items : [];
        const mine = arr.filter((it) => {
          if (canAdmin) return true;
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
            } catch (_) {}
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
                : it.key ||
                  `${it.assetId || ''}|${it.title || ''}|${it.due ? +new Date(it.due) : ''}`;
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
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, [user, canAdmin]);

  const prettyDate = (d) => {
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

  const setNextMonths = (months) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const next = addMonthsSafe(today, months);
    setActionNextDate(toISO(next));
  };

  const openTaskAction = async (task) => {
    setActionTask(task);
    setActionDocSlug('');
    setActionDocPicked(null);
    setActionDocFieldId(null);
    setActionNeedsNextService(false);
    setNextMonths(6);
    setSignoffChoice('yes');
    setSignoffReport(null);
    try {
      // For signoff tasks, fetch asset actions to get fresh action images (in case list was stale)
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
        } catch (_) {}
      }
      if (task?.typeId) {
        const defsRes = await fetch(
          `${API_BASE_URL}/assets/asset-types/${task.typeId}/fields`
        );
        const defs = await defsRes.json();
        const arr = Array.isArray(defs) ? defs : [];
        if (task.fieldKey) {
          const def = arr.find(
            (d) =>
              String(d.slug || '').toLowerCase() ===
              String(task.fieldKey).toLowerCase()
          );
          if (def) {
            try {
              const vr =
                (def.validation_rules && typeof def.validation_rules === 'object') ||
                (def.validation_rules ? JSON.parse(def.validation_rules) : null);
              const link = vr && (vr.requires_document_slug || vr.require_document_slug);
              const slug = Array.isArray(link) ? link[0] || '' : link || '';
              if (slug) setActionDocSlug(String(slug));
              const docDef = arr.find(
                (d) =>
                  String(d.slug || '').toLowerCase() === String(slug).toLowerCase()
              );
              if (docDef?.id) setActionDocFieldId(String(docDef.id));
            } catch {}
          }
        }
        try {
          const nextDef = arr.find(
            (d) => String(d.slug || '').toLowerCase() === 'next_service_date'
          );
          if (
            nextDef &&
            String(nextDef?.field_type?.slug || nextDef?.field_type?.name || '')
              .toLowerCase() === 'date'
          ) {
            setActionNeedsNextService(true);
          }
        } catch {}
      }
    } catch {}
    setActionOpen(true);
  };

  const handleSubmitTaskAction = async () => {
    if (!actionTask) {
      setActionOpen(false);
      return;
    }
    try {
      setActionSubmitting(true);
      if (actionTask.kind === 'signoff') {
        const userHeaders = {};
        try {
          const u = auth?.currentUser;
          if (u?.uid) {
            userHeaders['X-User-Id'] = String(u.uid);
            userHeaders['X-User-Email'] = u.email || '';
            userHeaders['X-User-Name'] =
              u.displayName || (u.email ? u.email.split('@')[0] : '');
          }
        } catch {}

        if (
          signoffChoice === 'yes' &&
          String(actionTask.actionType || '').toUpperCase() === 'MAINTENANCE'
        ) {
          if (!actionNextDate) {
            Alert.alert('Missing date', 'Please select the next service date.');
            setActionSubmitting(false);
            return;
          }
        }

        const signoffRes = await fetch(
          `${API_BASE_URL}/assets/${actionTask.assetId}/actions/${actionTask.actionId}/signoff`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...userHeaders },
            body: JSON.stringify({
              completed: signoffChoice === 'yes',
              note: actionNote,
            }),
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
            console.warn('Failed to update next service date on sign-off', e);
          }
        }

        if (signoffChoice === 'yes') {
          const hasReportFile = !!signoffReport?.uri;
          if (hasReportFile) {
            try {
              let fileObj;
              if (Platform.OS === 'web') {
                const resp = await fetch(signoffReport.uri);
                const blob = await resp.blob();
                fileObj = new File(
                  [blob],
                  signoffReport.name || 'report.pdf',
                  {
                    type:
                      signoffReport.mimeType ||
                      blob.type ||
                      'application/pdf',
                  }
                );
              } else {
                fileObj = {
                  uri: signoffReport.uri,
                  name: signoffReport.name || 'report.pdf',
                  type: signoffReport.mimeType || 'application/pdf',
                };
              }
              const fd = new FormData();
              fd.append('file', fileObj);
              const label =
                String(actionTask.actionType || '').toUpperCase() === 'REPAIR'
                  ? 'Repair Report'
                  : 'Service Report';
              fd.append('title', label);
              fd.append('kind', label);
              fd.append('related_date_label', label);
              fd.append('related_date', new Date().toISOString());
              await fetch(
                `${API_BASE_URL}/assets/${actionTask.assetId}/documents/upload`,
                { method: 'POST', headers: userHeaders, body: fd }
              );
            } catch (e) {
              console.warn('Failed to upload sign-off report', e);
            }
          }
        }

        const upperType = String(actionTask.actionType || '').toUpperCase();
        const shouldResetStatus =
          signoffChoice === 'yes' &&
          (upperType === 'MAINTENANCE' || upperType === 'REPAIR');
        if (shouldResetStatus) {
          try {
            await fetch(`${API_BASE_URL}/assets/${actionTask.assetId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', ...userHeaders },
              body: JSON.stringify({ status: 'In Service' }),
            });
          } catch (e) {
            console.warn('Failed to reset status after sign-off', e);
          }
          try {
            await fetch(
              `${API_BASE_URL}/assets/${actionTask.assetId}/actions`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...userHeaders,
                },
                body: JSON.stringify({
                  type: 'STATUS_CHANGE',
                  note: `${
                    upperType === 'REPAIR' ? 'Repair' : 'Service'
                  } signed off`,
                  details: {
                    signed_off: true,
                    status: 'In Service',
                    source_action_id: actionTask.actionId,
                  },
                  occurred_at: new Date().toISOString(),
                }),
              }
            );
          } catch (e) {
            console.warn('Failed to log sign-off status change', e);
          }
        }

        if (signoffChoice === 'yes') {
          setTasks((prev) => {
            const assetId = actionTask.assetId || actionTask.asset_id || null;
            const items = (prev.items || []).filter((t) => {
              if (t === actionTask) return false;
              if (!assetId) return true;
              const tid = t.assetId || t.asset_id || null;
              if (!tid || String(tid) !== String(assetId)) return true;
              const k = String(t.fieldKey || '').toLowerCase();
              const title = String(t.title || '').toLowerCase();
              if (k.includes('service') || k.includes('maint')) return false;
              if (/service|maint|maintenance/.test(title)) return false;
              return true;
            });
            return { items, loading: false };
          });
        }
        setActionOpen(false);
        setActionSubmitting(false);
        return;
      }

      const targetAssetId = actionTask.assetId || actionTask.asset_id;
      if (!targetAssetId) throw new Error('Missing asset id for task action');
      const url = `${API_BASE_URL}/assets/${targetAssetId}`;
      const headers = { 'Content-Type': 'application/json' };
      try {
        const u = auth?.currentUser;
        if (u?.uid) {
          headers['X-User-Id'] = String(u.uid);
          headers['X-User-Email'] = u.email || '';
          headers['X-User-Name'] =
            u.displayName || (u.email ? u.email.split('@')[0] : '');
        }
      } catch {}

      let body = { fields: {} };
      const k = String(actionTask.fieldKey || '').toLowerCase();
      const scope = actionTask.scope || 'field';
      if (actionTask.fieldKey) body.fields[actionTask.fieldKey] = actionNextDate;
      if (k === 'next_service_date') body.next_service_date = actionNextDate;
      if (
        !actionTask.fieldKey &&
        scope === 'top' &&
        k === 'next_service_date'
      )
        body.next_service_date = actionNextDate;
      if (
        actionNeedsNextService &&
        !body.fields.next_service_date
      ) {
        body.fields.next_service_date = actionNextDate;
        if (!body.next_service_date) body.next_service_date = actionNextDate;
      }

      if (actionDocSlug && actionDocPicked) {
        try {
          let fileObj;
          if (Platform.OS === 'web') {
            const resp = await fetch(actionDocPicked.uri);
            const blob = await resp.blob();
            fileObj = new File(
              [blob],
              actionDocPicked.name || 'document.pdf',
              {
                type:
                  actionDocPicked.mimeType ||
                  blob.type ||
                  'application/pdf',
              }
            );
          } else {
            fileObj = {
              uri: actionDocPicked.uri,
              name: actionDocPicked.name || 'document.pdf',
              type: actionDocPicked.mimeType || 'application/pdf',
            };
          }
          const fd = new FormData();
          fd.append('file', fileObj);
          if (actionDocFieldId)
            fd.append('asset_type_field_id', String(actionDocFieldId));
          const toTitle = (s) => {
            const txt = String(s || '')
              .replace(/[_-]+/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            return txt
              .split(' ')
              .map((w) =>
                w ? w.charAt(0).toUpperCase() + w.slice(1) : ''
              )
              .join(' ');
          };
          const niceName = toTitle(actionDocSlug);
          fd.append('title', niceName);
          fd.append('kind', niceName);
          fd.append(
            'related_date_label',
            String(actionTask.title || actionTask.fieldKey || 'Date').replace(
              /_/g,
              ' '
            )
          );
          fd.append('related_date', actionNextDate);
          const up = await fetch(
            `${API_BASE_URL}/assets/${actionTask.assetId}/documents/upload`,
            { method: 'POST', body: fd }
          );
          const upj = await up.json().catch(() => ({}));
          if (up.ok && upj?.document?.url) {
            body.fields[actionDocSlug] = upj.document.url;
            body.documentation_url = upj.document.url;
          }
        } catch {}
      }

      if (actionNote && String(actionNote).trim()) {
        body.notes = String(actionNote).trim();
      }

      const res = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Update failed (${res.status})`);

      let actionType = 'STATUS_CHANGE';
      if (k.includes('repair')) actionType = 'REPAIR';
      else if (k.includes('service') || k.includes('maint'))
        actionType = 'MAINTENANCE';
      let note = `${(actionTask.title || '')
        .replace(/\s*Overdue$/, '')} completed; next on ${prettyDate(
        new Date(actionNextDate)
      )}`;
      if (actionNote && String(actionNote).trim())
        note += ` — ${String(actionNote).trim()}`;
      try {
        await fetch(`${API_BASE_URL}/assets/${actionTask.assetId}/actions`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: actionType,
            note,
            occurred_at: new Date().toISOString(),
          }),
        });
      } catch {}

      setTasks((prev) => {
        const rest = (prev.items || []).filter((t) =>
          t.key
            ? t.key !== actionTask.key
            : !(
                t.assetId === actionTask.assetId &&
                +new Date(t.due) === +new Date(actionTask.due)
              )
        );
        return { items: rest, loading: false };
      });
      setActionOpen(false);
    } catch (e) {
      Alert.alert('Failed to save', e?.message || 'Please try again.');
    } finally {
      setActionSubmitting(false);
    }
  };

  const taskItems = tasks?.items || [];
  const todayMid = React.useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  const getTaskDueTime = (item) => {
    if (!item?.due) return null;
    const d = new Date(item.due);
    const ts = d.getTime();
    return Number.isNaN(ts) ? null : ts;
  };
  const getTaskTitle = (item) => String(item?.title || '').toLowerCase();
  const getTaskActionType = (item) =>
    String(item?.actionType || '').toUpperCase();
  const isRepairTask = (item) => {
    const type = getTaskActionType(item);
    const title = getTaskTitle(item);
    if (type === 'REPAIR') return true;
    return /repair/.test(title);
  };
  const isServiceTask = (item) => {
    const type = getTaskActionType(item);
    const title = getTaskTitle(item);
    if (type === 'MAINTENANCE') return true;
    return /service|maint|maintenance/.test(title);
  };
  const isOverdueTask = (item) => {
    const ts = getTaskDueTime(item);
    if (ts == null) return false;
    return ts < todayMid.getTime();
  };
  const isReminderTask = (item) => {
    const ts = getTaskDueTime(item);
    if (ts == null) return false;
    return (
      ts >= todayMid.getTime() && /reminder/i.test(String(item?.title || ''))
    );
  };

  const overdueCount = taskItems.filter(isOverdueTask).length;
  const reminderCount = taskItems.filter(isReminderTask).length;
  const maintenanceCount = taskItems.filter(
    (item) => isServiceTask(item) || isRepairTask(item)
  ).length;
  const repairCount = taskItems.filter(isRepairTask).length;
  const hireCount = taskItems.filter((item) => {
    const type = getTaskActionType(item);
    const title = getTaskTitle(item);
    if (type === 'HIRE') return true;
    return /hire/.test(title);
  }).length;
  const totalTasks = taskItems.length;

  const filteredTaskItems = React.useMemo(() => {
    if (taskFilter === 'overdue') return taskItems.filter(isOverdueTask);
    if (taskFilter === 'reminder') return taskItems.filter(isReminderTask);
    if (taskFilter === 'maintenance')
      return taskItems.filter(
        (item) => isServiceTask(item) || isRepairTask(item)
      );
    if (taskFilter === 'repair') return taskItems.filter(isRepairTask);
    if (taskFilter === 'hire')
      return taskItems.filter((item) => {
        const type = getTaskActionType(item);
        const title = getTaskTitle(item);
        if (type === 'HIRE') return true;
        return /hire/.test(title);
      });
    return taskItems;
  }, [taskFilter, taskItems]);

  if (loading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color="#1E90FF" />
      </View>
    );
  }

  return (
    <ScreenWrapper style={styles.safeArea}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 120 }]}
        >
          <View style={styles.toDoList}>
            <View style={styles.tasksHeaderRow}>
              <Text style={styles.sectionTitle}>Tasks</Text>
              {totalTasks > 0 && (
                <View style={styles.tasksHeaderChip}>
                  <MaterialIcons
                    name="assignment-turned-in"
                    size={14}
                    color="#2563EB"
                  />
                  <Text style={styles.tasksHeaderChipText}>
                    {totalTasks} open
                  </Text>
                </View>
              )}
            </View>

            {tasks.loading ? (
              <View style={styles.toDoCard}>
                <ActivityIndicator color="#2563EB" />
              </View>
            ) : filteredTaskItems.length === 0 ? (
              <View style={[styles.toDoCard, styles.emptyStateCard]}>
                <View style={styles.emptyStateIconWrap}>
                  <MaterialIcons name="celebration" size={26} color="#1D4ED8" />
                </View>
                <Text style={styles.emptyStateTitle}>You're all caught up</Text>
                <Text style={styles.emptyStateSubtitle}>
                  No {taskFilter === 'all' ? '' : `${taskFilter} `}tasks right
                  now. Enjoy the calm or jump into something else.
                </Text>
                <Text style={styles.emptyStateHint}>
                  Tip: Scan an asset to log new work.
                </Text>
              </View>
            ) : (
              <View
                style={[
                  styles.toDoCard,
                  {
                    paddingHorizontal: Platform.OS === 'web' ? 16 : 0,
                    paddingVertical: 12,
                    ...(Platform.OS === 'web' && {
                      height: Math.min(
                        420,
                        (Dimensions.get('window').height || 600) * 0.55
                      ),
                    }),
                  },
                ]}
                onLayout={
                  Platform.OS !== 'web'
                    ? (e) => {
                        const w = e?.nativeEvent?.layout?.width || 0;
                        if (w && w !== taskWidth) setTaskWidth(w);
                      }
                    : undefined
                }
              >
                <Animated.FlatList
                  style={Platform.OS === 'web' ? { flex: 1 } : undefined}
                  data={filteredTaskItems}
                  ref={taskListRef}
                  keyExtractor={(t, idx) => {
                    if (t.key) return String(t.key);
                    if (t.actionId) return `action-${t.actionId}`;
                    if (t.id) return `task-${t.id}`;
                    const aid = t.assetId || t.asset_id || 'asset';
                    const duePart = t.due ? +new Date(t.due) : 'nodue';
                    return `${aid}-${duePart}-${idx}`;
                  }}
                  horizontal={Platform.OS !== 'web'}
                  pagingEnabled={Platform.OS !== 'web'}
                  snapToInterval={
                    Platform.OS !== 'web' ? taskWidth : undefined
                  }
                  decelerationRate="fast"
                  showsHorizontalScrollIndicator={false}
                  getItemLayout={
                    Platform.OS !== 'web' && taskWidth
                      ? (_, index) => ({
                          length: taskWidth,
                          offset: taskWidth * index,
                          index,
                        })
                      : undefined
                  }
                  extraData={
                    Platform.OS === 'web' ? null : taskWidth
                  }
                  ItemSeparatorComponent={
                    Platform.OS === 'web'
                      ? () => <View style={{ height: 12 }} />
                      : null
                  }
                  contentContainerStyle={
                    Platform.OS === 'web' ? { paddingBottom: 16 } : undefined
                  }
                  renderItem={({ item }) => {
                    const todayMidLocal = (() => {
                      const t = new Date();
                      t.setHours(0, 0, 0, 0);
                      return t;
                    })();
                    const isReminder = isReminderTask(item);
                    const isOverdue = isOverdueTask(item);
                    const isMaintenance = isRepairTask(item);
                    const isService =
                      isServiceTask(item) && !isMaintenance;
                    const isSignoff = item.kind === 'signoff';
                    const hasDue = !!item.due;

                    let statusLabel = 'Upcoming task';
                    let statusIcon = 'event';
                    let statusBg = '#E5E7EB';
                    let statusBorder = '#CBD5F5';
                    let statusText = '#111827';
                    let statusIconColor = '#2563EB';

                    if (isSignoff) {
                      statusLabel = 'Pending sign-off';
                      statusIcon = 'assignment-turned-in';
                      statusBg = '#EEF2FF';
                      statusBorder = '#C7D2FE';
                      statusText = '#3730A3';
                      statusIconColor = '#4F46E5';
                    } else if (isMaintenance) {
                      statusLabel = 'Repair';
                      statusIcon = 'build';
                      statusBg = '#ECFEFF';
                      statusBorder = '#A5F3FC';
                      statusText = '#0F766E';
                      statusIconColor = '#0F766E';
                    } else if (isOverdue) {
                      statusLabel = 'Overdue task';
                      statusIcon = 'error-outline';
                      statusBg = '#FEF2F2';
                      statusBorder = '#FCA5A5';
                      statusText = '#B91C1C';
                      statusIconColor = '#B91C1C';
                    } else if (isReminder) {
                      statusLabel = 'Reminder';
                      statusIcon = 'notifications-active';
                      statusBg = '#EFF6FF';
                      statusBorder = '#BFDBFE';
                      statusText = '#1D4ED8';
                      statusIconColor = '#1D4ED8';
                    }

                    const dueText = hasDue
                      ? prettyDate(new Date(item.due))
                      : 'No due date';

                    return (
                      <View
                        style={
                          Platform.OS === 'web'
                            ? { paddingHorizontal: 8 }
                            : {
                                width: Math.max(1, taskWidth),
                                paddingHorizontal: 24,
                              }
                        }
                      >
                        <View style={styles.taskCard}>
                          <View style={styles.taskCardHeaderRow}>
                            <View
                              style={[
                                styles.statusChip,
                                {
                                  backgroundColor: statusBg,
                                  borderColor: statusBorder,
                                },
                              ]}
                            >
                              <MaterialIcons
                                name={statusIcon}
                                size={14}
                                color={statusIconColor}
                              />
                              <Text
                                style={[styles.statusChipText, { color: statusText }]}
                                numberOfLines={1}
                              >
                                {statusLabel}
                              </Text>
                            </View>
                            {hasDue && (
                              <View style={styles.duePill}>
                                <MaterialIcons
                                  name="event"
                                  size={14}
                                  color="#0F172A"
                                />
                                <Text
                                  style={styles.duePillText}
                                  numberOfLines={1}
                                >
                                  {dueText}
                                </Text>
                              </View>
                            )}
                          </View>

                          <View style={styles.taskMainRow}>
                            {(item.actionImages?.[0] || item.imageUrl) ? (
                              <Image
                                source={{ uri: item.actionImages?.[0] || item.imageUrl }}
                                style={styles.taskAssetThumb}
                                resizeMode="cover"
                              />
                            ) : (
                              <View style={styles.taskAssetThumbPlaceholder}>
                                <MaterialIcons
                                  name="inventory"
                                  size={22}
                                  color="#2563EB"
                                />
                              </View>
                            )}
                            <View style={{ flex: 1 }}>
                              <Text
                                style={styles.taskAssetTitle}
                                numberOfLines={1}
                              >
                                {[item.model, item.assetTypeName || 'Asset', `ID: ${item.assetId}`].filter(Boolean).join(' · ')}
                              </Text>
                              <Text
                                style={styles.taskAssetSerial}
                                numberOfLines={1}
                              >
                                Serial: {item.serialNumber != null && String(item.serialNumber).trim() !== '' ? String(item.serialNumber) : 'N/A'}
                              </Text>
                              <Text
                                style={styles.taskTitle}
                                numberOfLines={2}
                              >
                                {item.title}
                              </Text>
                              <View style={styles.taskMetaRow}>
                                {isService && (
                                  <View
                                    style={[
                                      styles.smallTag,
                                      styles.smallTagSignoff,
                                    ]}
                                  >
                                    <MaterialIcons
                                      name="build-circle"
                                      size={12}
                                      color="#4F46E5"
                                    />
                                    <Text style={styles.smallTagText}>
                                      Service
                                    </Text>
                                  </View>
                                )}
                                {isMaintenance && (
                                  <View
                                    style={[
                                      styles.smallTag,
                                      styles.smallTagMaintenance,
                                    ]}
                                  >
                                    <MaterialIcons
                                      name="build"
                                      size={12}
                                      color="#0F766E"
                                    />
                                    <Text style={styles.smallTagText}>
                                      Repair
                                    </Text>
                                  </View>
                                )}
                              </View>
                            </View>
                          </View>

                          <View style={styles.taskFooterRow}>
                            <View style={styles.taskTagRow}>
                              {isOverdue && (
                                <View
                                  style={[
                                    styles.smallTag,
                                    styles.smallTagOverdue,
                                  ]}
                                >
                                  <MaterialIcons
                                    name="priority-high"
                                    size={12}
                                    color="#B91C1C"
                                  />
                                  <Text style={styles.smallTagText}>
                                    High priority
                                  </Text>
                                </View>
                              )}
                              {isReminder && !isOverdue && (
                                <View
                                  style={[
                                    styles.smallTag,
                                    styles.smallTagReminder,
                                  ]}
                                >
                                  <MaterialIcons
                                    name="notifications-active"
                                    size={12}
                                    color="#1D4ED8"
                                  />
                                  <Text style={styles.smallTagText}>
                                    Reminder
                                  </Text>
                                </View>
                              )}
                              {isMaintenance && (
                                <View
                                  style={[
                                    styles.smallTag,
                                    styles.smallTagMaintenance,
                                  ]}
                                >
                                  <MaterialIcons
                                    name="build"
                                    size={12}
                                    color="#0F766E"
                                  />
                                  <Text style={styles.smallTagText}>
                                    Repair
                                  </Text>
                                </View>
                              )}
                            </View>
                            <TouchableOpacity
                              style={[
                                styles.toDoButton,
                                styles.taskPrimaryButton,
                              ]}
                              onPress={() => openTaskAction(item)}
                            >
                              <Text style={styles.toDoButtonText}>
                                {isSignoff
                                  ? 'Review & sign off'
                                  : 'Action Task'}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    );
                  }}
                  onScroll={
                    Platform.OS !== 'web'
                      ? Animated.event(
                          [
                            {
                              nativeEvent: {
                                contentOffset: { x: scrollX },
                              },
                            },
                          ],
                          { useNativeDriver: false }
                        )
                      : undefined
                  }
                  onMomentumScrollEnd={
                    Platform.OS !== 'web'
                      ? (e) => {
                          const { contentOffset } = e.nativeEvent;
                          const idx = taskWidth
                            ? Math.round(contentOffset.x / taskWidth)
                            : 0;
                          if (idx !== taskIndex) setTaskIndex(idx);
                        }
                      : undefined
                  }
                />

                {Platform.OS !== 'web' &&
                  filteredTaskItems.length > 1 && (
                    <View
                      pointerEvents="box-none"
                      style={{
                        position: 'absolute',
                        top: '40%',
                        left: 8,
                        right: 8,
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                      }}
                    >
                      <TouchableOpacity
                        onPress={() => {
                          const next = Math.max(0, taskIndex - 1);
                          setTaskIndex(next);
                          try {
                            taskListRef.current?.scrollToIndex({
                              index: next,
                              animated: true,
                            });
                          } catch {}
                        }}
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 16,
                          backgroundColor: '#EAF1FF',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderWidth: 1,
                          borderColor: '#D6E8FF',
                        }}
                      >
                        <MaterialIcons
                          name="chevron-left"
                          size={20}
                          color="#2563EB"
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          const total = filteredTaskItems.length || 0;
                          if (!total) return;
                          const next = (taskIndex + 1) % total;
                          setTaskIndex(next);
                          try {
                            taskListRef.current?.scrollToIndex({
                              index: next,
                              animated: true,
                            });
                          } catch {}
                        }}
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 16,
                          backgroundColor: '#EAF1FF',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderWidth: 1,
                          borderColor: '#D6E8FF',
                        }}
                      >
                        <MaterialIcons
                          name="chevron-right"
                          size={20}
                          color="#2563EB"
                        />
                      </TouchableOpacity>
                    </View>
                  )}

                {Platform.OS !== 'web' && (
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'center',
                      gap: 6,
                      marginTop: 10,
                    }}
                  >
                    {filteredTaskItems.map((_, i) => {
                      const inputRange = [
                        taskWidth * (i - 1),
                        taskWidth * i,
                        taskWidth * (i + 1),
                      ];
                      const scale = scrollX.interpolate({
                        inputRange,
                        outputRange: [1, 1.4, 1],
                        extrapolate: 'clamp',
                      });
                      const opacity = scrollX.interpolate({
                        inputRange,
                        outputRange: [0.5, 1, 0.5],
                        extrapolate: 'clamp',
                      });
                      return (
                        <Animated.View
                          key={`dot-${i}`}
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: '#2563EB',
                            opacity,
                            transform: [{ scale }],
                          }}
                        />
                      );
                    })}
                  </View>
                )}
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>

      <Modal
        visible={actionOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setActionOpen(false)}
      >
        <View
          style={[
            styles.menuOverlay,
            { justifyContent: 'center', alignItems: 'center' },
          ]}
        >
          <BlurView
            intensity={60}
            tint="dark"
            style={StyleSheet.absoluteFill}
          />
          <TouchableOpacity
            style={styles.menuBackdrop}
            onPress={() => setActionOpen(false)}
          />
          <View style={styles.taskModalCard}>
            <Text
              style={{
                fontSize: 18,
                fontWeight: '900',
                marginBottom: 6,
              }}
            >
              {actionTask?.title || 'Action Task'}
            </Text>
            <Text
              style={{ color: '#6B7280', marginBottom: 12 }}
            >
              {actionTask?.subtitle || ''}
            </Text>

            {actionTask?.kind === 'signoff' && (
              <View style={{ marginBottom: 20, alignItems: 'center' }}>
                <Text style={{ color: '#6B7280', fontSize: 12, marginBottom: 10, fontWeight: '600' }}>Work photo(s)</Text>
                {Array.isArray(actionTask?.actionImages) && actionTask.actionImages.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', justifyContent: 'center' }}>
                    {actionTask.actionImages.map((url, idx) => (
                      <Image key={`work-img-${idx}`} source={{ uri: url }} style={{ width: 220, height: 220, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', marginRight: idx < actionTask.actionImages.length - 1 ? 12 : 0 }} resizeMode="cover" />
                    ))}
                  </ScrollView>
                ) : (
                  <Text style={{ color: '#9CA3AF', fontSize: 13 }}>No work photos attached</Text>
                )}
              </View>
            )}

            {actionTask?.kind === 'signoff' ? (
              <>
                <View style={{ marginBottom: 10 }}>
                  <Text
                    style={{
                      color: '#6B7280',
                      fontSize: 12,
                      marginBottom: 6,
                    }}
                  >
                    Has this work been completed?
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity
                      onPress={() => setSignoffChoice('yes')}
                      style={[
                        styles.quickDateChip,
                        {
                          backgroundColor:
                            signoffChoice === 'yes' ? '#DBEAFE' : '#fff',
                          borderColor:
                            signoffChoice === 'yes' ? '#93C5FD' : '#E5E7EB',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.quickDateChipText,
                          {
                            color:
                              signoffChoice === 'yes' ? '#1D4ED8' : '#374151',
                          },
                        ]}
                      >
                        Yes
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setSignoffChoice('no')}
                      style={[
                        styles.quickDateChip,
                        {
                          backgroundColor:
                            signoffChoice === 'no' ? '#FEE2E2' : '#fff',
                          borderColor:
                            signoffChoice === 'no' ? '#FCA5A5' : '#E5E7EB',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.quickDateChipText,
                          {
                            color:
                              signoffChoice === 'no' ? '#B91C1C' : '#374151',
                          },
                        ]}
                      >
                        No
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {signoffChoice === 'yes' &&
                  String(actionTask?.actionType || '').toUpperCase() ===
                    'MAINTENANCE' && (
                    <>
                      <View style={{ marginBottom: 10 }}>
                        <Text
                          style={{
                            color: '#6B7280',
                            fontSize: 12,
                            marginBottom: 6,
                          }}
                        >
                          Next Service Date
                        </Text>
                        <TouchableOpacity onPress={() => setDateOpen(true)}>
                          <View
                            style={{
                              borderWidth: 1,
                              borderColor: '#E5E7EB',
                              borderRadius: 10,
                              paddingVertical: 10,
                              paddingHorizontal: 12,
                            }}
                          >
                            <Text style={{ color: '#111827' }}>
                              {prettyDate(new Date(actionNextDate))}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      </View>
                      <View style={styles.quickDateRow}>
                        <TouchableOpacity
                          onPress={() => setNextMonths(3)}
                          style={styles.quickDateChip}
                        >
                          <Text style={styles.quickDateChipText}>
                            +3 months
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setNextMonths(6)}
                          style={styles.quickDateChip}
                        >
                          <Text style={styles.quickDateChipText}>
                            +6 months
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setNextMonths(12)}
                          style={styles.quickDateChip}
                        >
                          <Text style={styles.quickDateChipText}>
                            +12 months
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}

                {signoffChoice === 'yes' &&
                  (String(actionTask?.actionType || '').toUpperCase() ===
                    'MAINTENANCE' ||
                    String(actionTask?.actionType || '').toUpperCase() ===
                      'REPAIR') && (
                    <View style={{ marginTop: 10 }}>
                      <Text
                        style={{
                          color: '#6B7280',
                          fontSize: 12,
                          marginBottom: 6,
                        }}
                      >
                        {String(actionTask.actionType || '').toUpperCase() ===
                        'REPAIR'
                          ? 'Upload Repair Report (optional)'
                          : 'Upload Service Report (optional)'}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <TouchableOpacity
                          style={[styles.btn, styles.btnGhost, { flex: 1 }]}
                          onPress={async () => {
                            try {
                              const res =
                                await DocumentPicker.getDocumentAsync({
                                  type: [
                                    'application/pdf',
                                    'application/msword',
                                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                                    'image/*',
                                  ],
                                  multiple: false,
                                });
                              if (res.canceled) return;
                              const asset = res.assets?.[0];
                              if (!asset) return;
                              setSignoffReport(asset);
                            } catch (e) {
                              Alert.alert(
                                'Error',
                                e.message || 'Failed to select document'
                              );
                            }
                          }}
                        >
                          <Text
                            style={{
                              fontWeight: '700',
                              color: '#2563EB',
                            }}
                          >
                            {signoffReport
                              ? 'Replace Report'
                              : 'Upload Report'}
                          </Text>
                        </TouchableOpacity>
                        {signoffReport && (
                          <TouchableOpacity
                            style={[
                              styles.btn,
                              { flex: 1, backgroundColor: '#FEE2E2' },
                            ]}
                            onPress={() => setSignoffReport(null)}
                          >
                            <Text
                              style={{
                                fontWeight: '700',
                                color: '#B91C1C',
                              }}
                            >
                              Remove
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      {signoffReport && (
                        <Text
                          style={{
                            marginTop: 4,
                            fontSize: 12,
                            color: '#6B7280',
                          }}
                        >
                          Attached: {signoffReport.name || 'document'}
                        </Text>
                      )}
                    </View>
                  )}
              </>
            ) : (
              <>
                <View style={{ marginBottom: 10 }}>
                  <Text
                    style={{
                      color: '#6B7280',
                      fontSize: 12,
                      marginBottom: 6,
                    }}
                  >
                    Select next date
                  </Text>
                  <TouchableOpacity onPress={() => setDateOpen(true)}>
                    <View
                      style={{
                        borderWidth: 1,
                        borderColor: '#E5E7EB',
                        borderRadius: 10,
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                      }}
                    >
                      <Text style={{ color: '#111827' }}>
                        {prettyDate(new Date(actionNextDate))}
                      </Text>
                    </View>
                  </TouchableOpacity>
                </View>
                <View style={styles.quickDateRow}>
                  <TouchableOpacity
                    onPress={() => setNextMonths(3)}
                    style={styles.quickDateChip}
                  >
                    <Text style={styles.quickDateChipText}>+3 months</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setNextMonths(6)}
                    style={styles.quickDateChip}
                  >
                    <Text style={styles.quickDateChipText}>+6 months</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setNextMonths(12)}
                    style={styles.quickDateChip}
                  >
                    <Text style={styles.quickDateChipText}>+12 months</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            <View style={{ marginTop: 8 }}>
              <Text
                style={{
                  color: '#6B7280',
                  fontSize: 12,
                  marginBottom: 6,
                }}
              >
                Note (optional)
              </Text>
              <AppTextInput
                style={{
                  minHeight: 44,
                  backgroundColor: theme.colors.surface,
                }}
                placeholder="Add a note"
                value={actionNote}
                onChangeText={setActionNote}
                multiline
              />
            </View>

            {actionDocSlug ? (
              <View style={{ marginTop: 10 }}>
                <Text
                  style={{
                    color: '#6B7280',
                    fontSize: 12,
                    marginBottom: 6,
                  }}
                >
                  Linked document category:{' '}
                  {String(actionDocSlug).replace(/_/g, ' ')}
                </Text>
                {actionDocPicked ? (
                  <Text
                    style={{
                      marginBottom: 6,
                      fontStyle: 'italic',
                      color: '#374151',
                    }}
                  >
                    Attached: {actionDocPicked.name || 'document'}
                  </Text>
                ) : null}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity
                    style={[
                      styles.btn,
                      styles.btnGhost,
                      { paddingVertical: 10, flex: 1 },
                    ]}
                    onPress={async () => {
                      try {
                        const res =
                          await DocumentPicker.getDocumentAsync({
                            type: [
                              'application/pdf',
                              'application/msword',
                              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                            ],
                            multiple: false,
                          });
                        if (res.canceled) return;
                        const asset = res.assets?.[0];
                        if (!asset) return;
                        setActionDocPicked(asset);
                      } catch (e) {
                        Alert.alert(
                          'Error',
                          e.message || 'Failed to select document'
                        );
                      }
                    }}
                  >
                    <Text
                      style={{
                        fontWeight: '700',
                        color: '#2563EB',
                      }}
                    >
                      {actionDocPicked
                        ? 'Replace Document'
                        : 'Upload Document'}
                    </Text>
                  </TouchableOpacity>
                  {actionDocPicked ? (
                    <TouchableOpacity
                      style={[
                        styles.btn,
                        {
                          paddingVertical: 10,
                          backgroundColor: '#fdecea',
                          flex: 1,
                        },
                      ]}
                      onPress={() => setActionDocPicked(null)}
                    >
                      <Text style={{ color: '#b00020' }}>Remove</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : null}

            <View
              style={{
                flexDirection: 'row',
                gap: 10,
                marginTop: 8,
              }}
            >
              <TouchableOpacity
                onPress={() => setActionOpen(false)}
                style={[styles.btn, styles.btnGhost, { flex: 1 }]}
              >
                <Text style={styles.menuText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={actionSubmitting}
                onPress={async () => {
                  await handleSubmitTaskAction();
                }}
                style={[
                  styles.btn,
                  styles.btnPrimary,
                  {
                    flex: 1,
                    opacity: actionSubmitting ? 0.7 : 1,
                  },
                ]}
              >
                <MaterialIcons name="check-circle" size={18} color="#fff" />
                <Text
                  style={[
                    styles.menuText,
                    { color: '#fff', fontWeight: '800' },
                  ]}
                >
                  {actionSubmitting
                    ? 'Saving...'
                    : actionTask?.kind === 'signoff'
                      ? String(actionTask?.actionType || '').toUpperCase() ===
                        'MAINTENANCE'
                        ? 'Sign off Service'
                        : 'Sign Off'
                      : 'Mark Done'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        <DatePickerModal
          locale="en-GB"
          mode="single"
          visible={dateOpen}
          onDismiss={() => setDateOpen(false)}
          date={new Date(actionNextDate)}
          onConfirm={({ date }) => {
            setDateOpen(false);
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            setActionNextDate(`${y}-${m}-${d}`);
          }}
        />
      </Modal>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7FAFF' },
  safeArea: { flex: 1, backgroundColor: '#F7FAFF' },
  scrollContent: { padding: 16, paddingBottom: 40 },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    flex: 1,
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  menuBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  taskModalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    width: '92%',
    maxWidth: 520,
    borderWidth: 1,
    borderColor: '#E9F1FF',
  },
  menuText: { fontSize: 16, color: '#333' },
  btn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  btnPrimary: { backgroundColor: '#2563EB' },
  btnGhost: { borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFF' },
  toDoList: { marginTop: 0 },
  toDoCard: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  tasksHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#D97706',
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  tasksHeaderChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    gap: 6,
  },
  tasksHeaderChipText: { fontSize: 12, fontWeight: '700', color: '#1D4ED8' },
  toDoButton: {
    backgroundColor: '#1E90FF',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  taskPrimaryButton: { borderRadius: 999, paddingHorizontal: 22 },
  toDoButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  taskCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: Platform.OS === 'web' ? 22 : 14,
    paddingHorizontal: Platform.OS === 'web' ? 20 : 14,
    borderWidth: 1,
    borderColor: '#E5EDFF',
    shadowColor: '#1D4ED8',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
    ...(Platform.OS === 'web' ? { minHeight: 210 } : null),
  },
  taskCardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 10,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    gap: 6,
  },
  statusChipText: { fontSize: 12, fontWeight: '700' },
  duePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#F3F4F6',
    gap: 6,
  },
  duePillText: { fontSize: 12, fontWeight: '600', color: '#111827' },
  taskMainRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  taskAssetThumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  taskAssetThumbPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#EEF5FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  taskAssetTitle: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  taskAssetSerial: { fontSize: 13, color: '#6B7280', marginTop: 2, fontWeight: '500' },
  taskTitle: { fontSize: 14, fontWeight: '600', color: '#1D4ED8', marginTop: 4 },
  taskMetaRow: { marginTop: 6, gap: 4 },
  taskMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  taskMetaText: { fontSize: 12, color: '#6B7280' },
  taskFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    gap: 12,
  },
  taskTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  smallTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    gap: 4,
  },
  smallTagOverdue: { backgroundColor: '#FEE2E2' },
  smallTagReminder: { backgroundColor: '#DBEAFE' },
  smallTagSignoff: { backgroundColor: '#E0E7FF' },
  smallTagText: { fontSize: 11, fontWeight: '600', color: '#111827' },
  smallTagMaintenance: { backgroundColor: '#CCFBF1' },
  emptyStateCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    gap: 10,
  },
  emptyStateIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyStateTitle: { fontSize: 16, fontWeight: '800', color: '#111827' },
  emptyStateSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    marginHorizontal: 10,
  },
  emptyStateHint: {
    marginTop: 6,
    fontSize: 11,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  quickDateRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
    marginBottom: 4,
  },
  quickDateChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
  },
  quickDateChipText: { color: '#2563EB', fontWeight: '800' },
});
