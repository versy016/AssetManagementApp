// dashboard.js - Main dashboard screen for authenticated users

import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, FlatList, Animated, Dimensions, Modal, Platform, Image, useWindowDimensions } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { BlurView } from 'expo-blur';
import { DatePickerModal } from 'react-native-paper-dates';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { auth } from '../../firebaseConfig';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import PropTypes from 'prop-types';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import SearchScreen from '../search';
import InventoryScreen from './Inventory';
import CertsView from '../../components/CertsView';
import ErrorBoundary from '../../components/ErrorBoundary';
import { useTheme } from 'react-native-paper';
import ScreenWrapper from '../../components/ui/ScreenWrapper';
import AppTextInput from '../../components/ui/AppTextInput';
import AddShortcutModal from '../../components/AddShortcutModal';
import { getShortcutType } from '../../constants/ShortcutTypes';
import ShortcutManager from '../../utils/ShortcutManager';
import { executeShortcut } from '../../utils/ShortcutExecutor';
import { TourStep, TourContext, shouldShowTour, resetTour } from '../../components/TourGuide';
import AsyncStorage from '@react-native-async-storage/async-storage';

const Dashboard = ({ isAdmin }) => {
  const router = useRouter();
  const theme = useTheme();
  const [shortcuts, setShortcuts] = useState([]);
  const [shortcutModalVisible, setShortcutModalVisible] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [adminClaim, setAdminClaim] = useState(false); // <-- derived from Firebase custom claims
  const [dbAdmin, setDbAdmin] = useState(false);
  // Removed: numeric overview cards
  const [recent, setRecent] = useState({ items: [], loading: true });
  const [tasks, setTasks] = useState({ items: [], loading: true });
  const [taskIndex, setTaskIndex] = useState(0);
  const [taskWidth, setTaskWidth] = useState(Math.max(1, Dimensions.get('window')?.width - 48));
  const taskListRef = React.useRef(null);
  const scrollX = React.useRef(new Animated.Value(0)).current;
  const { width: windowWidth } = useWindowDimensions();
  const SHOW_RECENT = true;
  const isDesktopWeb = Platform.OS === 'web' && ((windowWidth || Dimensions.get('window')?.width || 0) >= 1024);
  const isIos = Platform.OS === 'ios';

  const [dateOpen, setDateOpen] = useState(false);

  // Task action modal
  const [actionOpen, setActionOpen] = useState(false);
  const [actionTask, setActionTask] = useState(null); // { assetId, title, subtitle, due, fieldKey, scope, key }
  const [actionNextDate, setActionNextDate] = useState(new Date().toISOString().slice(0, 10));
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionDocSlug, setActionDocSlug] = useState('');
  const [actionDocFieldId, setActionDocFieldId] = useState(null);
  const [actionDocPicked, setActionDocPicked] = useState(null);
  const [actionNote, setActionNote] = useState('');
  const [signoffReport, setSignoffReport] = useState(null);
  const [signoffChoice, setSignoffChoice] = useState('yes'); // 'yes' | 'no'
  // For types where Next Service Date is a required dynamic field, ensure we always send it
  const [actionNeedsNextService, setActionNeedsNextService] = useState(false);
  const { view: viewParam } = useLocalSearchParams();
  const [mobileView, setMobileView] = useState('dashboard');
  const webViewKey = String(viewParam || '').toLowerCase() || 'dashboard';

  // Auth state + fetch custom claims (admin)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      try {
        if (!currentUser) {
          router.replace('/(auth)/login');
          setUser(null);
          setAdminClaim(false);
        } else {
          setUser(currentUser);
          // refresh token to get latest custom claims
          await currentUser.getIdToken(true);
          const tokenResult = await currentUser.getIdTokenResult();
          setAdminClaim(!!tokenResult?.claims?.admin);
        }
      } catch (err) {
        console.error('Auth/claims error:', err);
      } finally {
        setLoading(false);
      }
    });
    return unsubscribe;
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

  const canAdmin = isAdmin || adminClaim || dbAdmin; // allow prop override if you still pass it

  // Removed: numeric overview fetch

  // Recent activity (best-effort, lightweight aggregation)
  useEffect(() => {
    if (!SHOW_RECENT) return;
    let cancelled = false;
    (async () => {
      try {
        setRecent((r) => ({ ...r, loading: true }));
        const res = await fetch(`${API_BASE_URL}/assets`);
        const data = await res.json();
        const list = (Array.isArray(data) ? data : [])
          .filter(a => (a?.description || '').toLowerCase() !== 'qr reserved asset');
        // Sort by updated/last_updated desc and take first 25
        const sorted = list.sort((a, b) => {
          const av = new Date(a?.updated_at || a?.last_updated || a?.date_purchased || 0).getTime();
          const bv = new Date(b?.updated_at || b?.last_updated || b?.date_purchased || 0).getTime();
          return bv - av;
        }).slice(0, 25);

        const actionsBatches = await Promise.allSettled(
          sorted.map(async (a) => {
            const r = await fetch(`${API_BASE_URL}/assets/${a.id}/actions`);
            if (!r.ok) return null;
            const j = await r.json();
            const arr = Array.isArray(j?.actions) ? j.actions : [];
            const first = arr[0];
            if (!first) return null;
            return { asset: a, action: first };
          })
        );

        const merged = actionsBatches
          .map(x => (x.status === 'fulfilled' ? x.value : null))
          .filter(Boolean)
          .sort((a, b) => new Date(b.action?.occurred_at || 0) - new Date(a.action?.occurred_at || 0))
          .slice(0, 10);

        if (!cancelled) setRecent({ items: merged, loading: false });
      } catch {
        if (!cancelled) setRecent({ items: [], loading: false });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Build simple "My Tasks" from assets with overdue dates
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
        const today = new Date(); today.setHours(0, 0, 0, 0);

        const isDateLike = (v) => {
          if (!v) return null;
          if (v instanceof Date) return v;
          const s = String(v).trim();
          // Accept YYYY-MM-DD or ISO
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00');
          const d = new Date(s);
          return Number.isNaN(+d) ? null : d;
        };

        // Candidate date keys and friendly labels
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

        // Fetch field definitions per type to get reminder lead times
        const typeIds = Array.from(new Set(list.map(a => a.type_id).filter(Boolean)));
        const defsCache = {};
        for (const tId of typeIds) {
          try {
            const r = await fetch(`${API_BASE_URL}/assets/asset-types/${tId}/fields`);
            const arr = await r.json();
            defsCache[tId] = Array.isArray(arr) ? arr : [];
          } catch { defsCache[tId] = []; }
        }
        const leadDaysMap = {}; // { typeId: { slug: days } }
        for (const [tId, defs] of Object.entries(defsCache)) {
          const per = {};
          for (const d of defs) {
            try {
              const vr = d.validation_rules && typeof d.validation_rules === 'object'
                ? d.validation_rules
                : (d.validation_rules ? JSON.parse(d.validation_rules) : null);
              const n = vr && (vr.reminder_lead_days || vr.reminderDays || vr.reminder_days);
              const v = Number(n);
              if (Number.isFinite(v) && v > 0) per[String(d.slug || '').toLowerCase()] = Math.floor(v);
            } catch { }
          }
          leadDaysMap[tId] = per;
        }

        const hasQrAssigned = (asset) => {
          const id = String(asset?.id || '');
          const looksShort = /^[A-Z0-9]{6,12}$/i.test(id);
          const notReserved = String(asset?.description || '').toLowerCase() !== 'qr reserved asset';
          return looksShort && notReserved;
        };

        let items = [];
        for (const a of list) {
          if (!hasQrAssigned(a)) continue; // show tasks only for assets with QR assigned
          if (!viewingAsAdmin) {
            if (!me) continue;
            // If the asset has an assignee and it's not me, skip it.
            // Unassigned assets are still included so their service/maintenance
            // dates appear in My Tasks.
            if (a?.assigned_to_id && String(a.assigned_to_id) !== String(me)) continue;
          }

          // 1) Known top-level dates (use label from key)
          for (const k of keysOfInterest) {
            const d = isDateLike(a?.[k]);
            if (!d || d >= today) continue;
            const label = TOP_DATE_LABELS[k] || k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const key = `${a.id}|top||`;
            items.push({
              assetId: a.id,
              title: `${label} Overdue`,
              subtitle: a.model || a.name || a.id,
              due: d,
              fieldKey: k,
              scope: 'top',
              key,
              imageUrl: a.image_url || a.imageUrl || null,
              typeId: a.type_id || a.typeId || null,
            });
          }

          // 2) Custom fields (if present)
          const f = a?.fields && typeof a.fields === 'object' ? a.fields : null;
          if (f) {
            for (const k of Object.keys(f)) {
              if (!keysOfInterest.includes(k) && !/date|due|expiry|expires/i.test(k)) continue;
              const d = isDateLike(f[k]);
              if (!d) continue;
              // Determine reminder lead for this field/type
              const tId = a.type_id || a.typeId || null;
              const daysLead = (leadDaysMap[tId] || {})[String(k).toLowerCase()] || 0;

              if (d < today) {
                const label = TOP_DATE_LABELS[k] || k.replace(/_/g, ' ').replace(new RegExp('\\b\\w', 'g'), c => c.toUpperCase());
                // Past dates should always read as "Overdue", even if a reminder lead was configured.
                items.push({
                  assetId: a.id,
                  title: `${label} Overdue`,
                  subtitle: a.model || a.name || a.id,
                  due: d,
                  fieldKey: k,
                  scope: 'field',
                  key: `${a.id}|field|${k}|${+d}`,
                  imageUrl: a.image_url || a.imageUrl || null,
                  typeId: tId,
                });
              } else {
                // Due-soon window based on type field reminder_lead_days
                if (daysLead > 0) {
                  const windowEnd = new Date(today.getTime() + daysLead * 24 * 60 * 60 * 1000);
                  if (d >= today && d <= windowEnd) {
                    const label = TOP_DATE_LABELS[k] || k.replace(/_/g, ' ').replace(new RegExp('\\b\\w', 'g'), c => c.toUpperCase());
                    items.push({
                      assetId: a.id,
                      title: `${label} Reminder`,
                      subtitle: a.model || a.name || a.id,
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
        }

        // De-duplicate and order by most overdue first, and preserve any existing
        // sign-off tasks that may have been fetched separately.
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
                  : (it.key || `${it.assetId || it.asset_id || ''}|${it.title || ''}|${it.due ? +new Date(it.due) : ''}`);
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
        console.warn('[Dashboard] tasks build failed:', e?.message || e);
        if (!cancelled) setTasks({ items: [], loading: false });
      }
    })();
    return () => { cancelled = true; };
  }, [user, canAdmin]);
  // Also include pending sign-off tasks (Service/Repair/Hire)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_BASE_URL}/assets/actions/pending-signoff`);
        const j = await r.json();
        const me = auth?.currentUser?.uid || null;
        const arr = Array.isArray(j?.items) ? j.items : [];
        const mine = arr.filter(it => {
          if (canAdmin) return true;
          if (!me) return false;
          // If the action has an explicit assignee, respect it.
          // Otherwise, show unassigned sign-off work to the current user.
          if (!it.assigned_to_id) return true;
          return String(it.assigned_to_id) === String(me);
        });
        setTasks(prev => {
          const merged = [...(prev.items || []), ...mine];
          const seen = new Set();
          const deduped = merged.filter(it => {
            const baseKey = it.actionId
              ? `action:${it.actionId}`
              : (it.key || `${it.assetId || it.asset_id || ''}|${it.title || ''}|${it.due ? +new Date(it.due) : ''}`);
            if (seen.has(baseKey)) return false;
            seen.add(baseKey);
            return true;
          }).sort((a, b) => {
            const da = a?.due ? new Date(a.due).getTime() : 0;
            const db = b?.due ? new Date(b.due).getTime() : 0;
            const safeA = Number.isFinite(da) ? da : 0;
            const safeB = Number.isFinite(db) ? db : 0;
            return safeA - safeB;
          });
          return { loading: false, items: deduped };
        });
      } catch { }
    })();
    return () => { cancelled = true; };
  }, [user, canAdmin]);

  const prettyDate = (d) => {
    try {
      return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(d).replace(/\u00A0/g, ' ');
    } catch { return ''; }
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
      if (task?.typeId) {
        const defsRes = await fetch(`${API_BASE_URL}/assets/asset-types/${task.typeId}/fields`);
        const defs = await defsRes.json();
        const arr = Array.isArray(defs) ? defs : [];

        // If this task is tied to a specific dynamic field, resolve any linked document slug.
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
              const link = vr && (vr.requires_document_slug || vr.require_document_slug);
              const slug = Array.isArray(link) ? (link[0] || '') : (link || '');
              if (slug) setActionDocSlug(String(slug));
              const docDef = arr.find(
                (d) => String(d.slug || '').toLowerCase() === String(slug).toLowerCase()
              );
              if (docDef?.id) setActionDocFieldId(String(docDef.id));
            } catch { }
          }
        }

        // Detect if this asset type defines a dynamic 'next_service_date' field (of date type).
        // This should also work for sign-off tasks which don't have a specific fieldKey.
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
        } catch { }
      }
    } catch { }
    setActionOpen(true);
  };

  const handleSubmitTaskAction = async () => {
    if (!actionTask) { setActionOpen(false); return; }
    try {
      setActionSubmitting(true);
      // Branch: sign-off task
      if (actionTask.kind === 'signoff') {
        // Basic user headers reused across requests
        const userHeaders = {};
        try {
          const u = auth?.currentUser;
          if (u?.uid) {
            userHeaders['X-User-Id'] = String(u.uid);
            userHeaders['X-User-Email'] = u.email || '';
            userHeaders['X-User-Name'] = u.displayName || (u.email ? u.email.split('@')[0] : '');
          }
        } catch { }

        // For Maintenance sign-off, require Next Service Date when marking complete
        if (signoffChoice === 'yes' && String(actionTask.actionType || '').toUpperCase() === 'MAINTENANCE') {
          if (!actionNextDate) {
            Alert.alert('Missing date', 'Please select the next service date.');
            setActionSubmitting(false);
            return;
          }
        }

        // 1) Update sign-off flags on the action itself
        const signoffRes = await fetch(`${API_BASE_URL}/assets/${actionTask.assetId}/actions/${actionTask.actionId}/signoff`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...userHeaders },
          body: JSON.stringify({ completed: signoffChoice === 'yes', note: actionNote })
        });
        if (!signoffRes.ok) throw new Error('Failed to sign off');

        // 2) For completed maintenance, update Next Service Date on the asset
        if (signoffChoice === 'yes' && String(actionTask.actionType || '').toUpperCase() === 'MAINTENANCE' && actionNextDate) {
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

        // 3) Optional service/repair report upload on sign-off
        if (signoffChoice === 'yes') {
          const hasReportFile = !!signoffReport?.uri;
          if (hasReportFile) {
            try {
              let fileObj;
              if (Platform.OS === 'web') {
                // expo-document-picker on web provides a URI; fetch the blob and wrap as File
                const resp = await fetch(signoffReport.uri);
                const blob = await resp.blob();
                fileObj = new File(
                  [blob],
                  signoffReport.name || 'report.pdf',
                  { type: signoffReport.mimeType || blob.type || 'application/pdf' },
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
              const label = String(actionTask.actionType || '').toUpperCase() === 'REPAIR'
                ? 'Repair Report'
                : 'Service Report';
              fd.append('title', label);
              fd.append('kind', label);
              // For document history, use the report submission date (now),
              // not the next service date.
              fd.append('related_date_label', label);
              fd.append('related_date', new Date().toISOString());
              await fetch(`${API_BASE_URL}/assets/${actionTask.assetId}/documents/upload`, {
                method: 'POST',
                headers: userHeaders,
                body: fd,
              });
            } catch (e) {
              console.warn('Failed to upload sign-off report', e);
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
            console.warn('Failed to reset status after sign-off', e);
          }
          try {
            await fetch(`${API_BASE_URL}/assets/${actionTask.assetId}/actions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...userHeaders },
              body: JSON.stringify({
                type: 'STATUS_CHANGE',
                note: `${upperType === 'REPAIR' ? 'Repair' : 'Service'} signed off`,
                details: {
                  signed_off: true,
                  status: 'In Service',
                  source_action_id: actionTask.actionId,
                },
                occurred_at: new Date().toISOString(),
              }),
            });
          } catch (e) {
            console.warn('Failed to log sign-off status change', e);
          }
        }

        // Remove task on successful completion
        if (signoffChoice === 'yes') {
          setTasks((prev) => {
            const assetId = actionTask.assetId || actionTask.asset_id || null;
            const items = (prev.items || []).filter((t) => {
              // Always remove the exact task we just acted on
              if (t === actionTask) return false;
              if (!assetId) return true;
              const tid = t.assetId || t.asset_id || null;
              if (!tid || String(tid) !== String(assetId)) return true;
              const k = String(t.fieldKey || '').toLowerCase();
              const title = String(t.title || '').toLowerCase();
              // For this asset, also clear any date-based service/maintenance tasks
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
          headers['X-User-Name'] = u.displayName || (u.email ? u.email.split('@')[0] : '');
        }
      } catch { }

      let body = { fields: {} };
      const k = String(actionTask.fieldKey || '').toLowerCase();
      const scope = actionTask.scope || 'field';
      // Always update the dynamic field if we have a fieldKey
      if (actionTask.fieldKey) body.fields[actionTask.fieldKey] = actionNextDate;
      // Also mirror to top-level when the key is a known top-level column
      if (k === 'next_service_date') body.next_service_date = actionNextDate;
      // If this is a purely top-level task with no fieldKey, still update the top-level column
      if (!actionTask.fieldKey && scope === 'top' && k === 'next_service_date') body.next_service_date = actionNextDate;
      // If this type requires next_service_date dynamically but it isn't the current fieldKey, include it too
      if (actionNeedsNextService && !body.fields.next_service_date) {
        body.fields.next_service_date = actionNextDate;
        if (!body.next_service_date) body.next_service_date = actionNextDate;
      }

      // If there is a linked document and user picked one, upload to asset_documents and set the URL (for back-compat)
      if (actionDocSlug && actionDocPicked) {
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
          const toTitle = (s) => {
            const txt = String(s || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
            return txt.split(' ').map(w => (w ? w.charAt(0).toUpperCase() + w.slice(1) : '')).join(' ');
          };
          const niceName = toTitle(actionDocSlug);
          fd.append('title', niceName);
          fd.append('kind', niceName);
          fd.append('related_date_label', String(actionTask.title || actionTask.fieldKey || 'Date').replace(/_/g, ' '));
          fd.append('related_date', actionNextDate);
          const up = await fetch(`${API_BASE_URL}/assets/${actionTask.assetId}/documents/upload`, { method: 'POST', body: fd });
          const upj = await up.json().catch(() => ({}));
          if (up.ok && upj?.document?.url) {
            const url = upj.document.url;
            body.fields[actionDocSlug] = url;
            body.documentation_url = url;
          }
        } catch { }
      }

      // Optional note update on asset itself
      if (actionNote && String(actionNote).trim()) {
        body.notes = String(actionNote).trim();
      }

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
          body: JSON.stringify({ type: actionType, note, occurred_at: new Date().toISOString() })
        });
      } catch { }

      setTasks((prev) => {
        const rest = (prev.items || []).filter((t) => t.key ? t.key !== actionTask.key : !(t.assetId === actionTask.assetId && +new Date(t.due) === +new Date(actionTask.due)));
        return { items: rest, loading: false };
      });
      setActionOpen(false);
    } catch (e) {
      Alert.alert('Failed to save', e?.message || 'Please try again.');
    } finally {
      setActionSubmitting(false);
    }
  }; const iconForType = (t) => {
    switch (String(t || '').toUpperCase()) {
      case 'REPAIR': return 'build';
      case 'MAINTENANCE': return 'build-circle';
      case 'END_OF_LIFE': return 'block';
      case 'CHECK_IN': return 'assignment-turned-in';
      case 'CHECK_OUT': return 'assignment-return';
      case 'TRANSFER': return 'swap-horiz';
      case 'STATUS_CHANGE': return 'sync';
      case 'HIRE': return 'work-outline';
      case 'LOST': return 'help-outline';
      case 'STOLEN': return 'report';
      default: return 'event-note';
    }
  };

  const prettyWhen = (iso) => {
    try {
      const d = new Date(iso);
      if (Number.isNaN(+d)) return '';
      return new Intl.DateTimeFormat('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      }).format(d).replace(/\u00A0/g, ' ').replace(',', '');
    } catch { return ''; }
  };

  // Load shortcuts from AsyncStorage
  useEffect(() => {
    if (!user?.uid) return;
    (async () => {
      const loaded = await ShortcutManager.loadShortcuts(user.uid, canAdmin);
      setShortcuts(loaded);
    })();
  }, [user?.uid, canAdmin]);

  const handleAddShortcut = async (shortcutType) => {
    if (!user?.uid) return;
    const success = await ShortcutManager.addShortcut(user.uid, shortcutType, canAdmin);
    if (success) {
      const updated = await ShortcutManager.loadShortcuts(user.uid, canAdmin);
      setShortcuts(updated);
    } else {
      Alert.alert('Error', 'Could not add shortcut. You may have reached the maximum limit.');
    }
  };

  const handleRemoveShortcut = async (shortcutId) => {
    if (!user?.uid) return;
    Alert.alert(
      'Remove Shortcut',
      'Are you sure you want to remove this shortcut?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const success = await ShortcutManager.removeShortcut(user.uid, shortcutId);
            if (success) {
              const updated = await ShortcutManager.loadShortcuts(user.uid, canAdmin);
              setShortcuts(updated);
            }
          },
        },
      ]
    );
  };

  const handleExecuteShortcut = (shortcutType) => {
    if (!user) {
      Alert.alert('Error', 'You must be logged in to use shortcuts');
      return;
    }
    executeShortcut(shortcutType, router, user);
  };

  const quickActions = React.useMemo(() => {
    const goToSearch = () => router.push('/search');
    const goToCerts = () => router.push('/certs');
    const base = [
      { key: 'scan', label: 'Scan Asset', icon: 'qr-code-scanner', subtitle: 'Open camera scanner', onPress: () => router.push('/qr-scanner') },
      { key: 'multi', label: 'Multi-Scan', icon: 'sync-alt', subtitle: 'Batch check-in / out', onPress: () => router.push('/qr-scanner?mode=multi') },
      { key: 'search', label: 'Search', icon: 'search', subtitle: 'Find any asset fast', onPress: () => router.push('/search') },
      { key: 'assets', label: 'My Assets', icon: 'inventory', subtitle: 'Everything assigned to you', onPress: () => router.push('/asset/assets') },
      { key: 'activity', label: 'Activity', icon: 'history', subtitle: 'Recent asset activity', onPress: () => router.push('/activity') },
      { key: 'certs', label: 'Certs', icon: 'verified', subtitle: 'View certifications', onPress: () => router.push('/certs') },
    ];
    return base;
  }, [canAdmin, router]);

  // Web-only nav is now provided by the global WebNavbar component.

  const handleLogout = async () => {
    try {
      await signOut(auth);
      router.replace('/(auth)/login');
    } catch (error) {
      Alert.alert('Logout Error', error.message);
    }
  };

  const userName = user?.displayName || user?.email?.split('@')[0] || 'User';
  const userInitials = (user?.displayName || user?.email || 'US').substring(0, 2).toUpperCase();
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
  const getTaskActionType = (item) => String(item?.actionType || '').toUpperCase();
  const isRepairTask = (item) => {
    const type = getTaskActionType(item);
    const title = getTaskTitle(item);
    if (type === 'REPAIR') return true;
    return /repair/.test(title);
  };
  const isServiceTask = (item) => {
    const type = getTaskActionType(item);
    const title = getTaskTitle(item);
    // Treat MAINTENANCE actions and any title mentioning service/maint/maintenance
    // as "maintenance work" – we don't separate Service vs Maintenance buckets.
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
    // Only treat as "reminder" if due today or in the future
    return ts >= todayMid.getTime() && /reminder/i.test(String(item?.title || ''));
  };

  const overdueCount = taskItems.filter(isOverdueTask).length;
  const reminderCount = taskItems.filter(isReminderTask).length;
  // "Maintenance" bucket includes both service and repair work
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

  const [taskFilter, setTaskFilter] = useState('all'); // 'all' | 'overdue' | 'reminder' | 'maintenance' | 'repair' | 'hire'

  const filteredTaskItems = React.useMemo(() => {
    if (taskFilter === 'overdue') return taskItems.filter(isOverdueTask);
    if (taskFilter === 'reminder') return taskItems.filter(isReminderTask);
    if (taskFilter === 'maintenance') {
      return taskItems.filter((item) => isServiceTask(item) || isRepairTask(item));
    }
    if (taskFilter === 'repair') return taskItems.filter(isRepairTask);
    if (taskFilter === 'hire') {
      return taskItems.filter((item) => {
        const type = getTaskActionType(item);
        const title = getTaskTitle(item);
        if (type === 'HIRE') return true;
        return /hire/.test(title);
      });
    }
    return taskItems;
  }, [taskFilter, taskItems]);

  const renderShortcutsSection = () => {
    const canAddMore = ShortcutManager.canAddMoreShortcuts(shortcuts);

    return (
      <View style={styles.shortcutsSection}>
        <View style={styles.shortcutsHeaderRow}>
          <Text style={styles.sectionTitle}>Shortcuts</Text>
          <TouchableOpacity
            style={styles.manageShortcutsBtn}
            onPress={() => setShortcutModalVisible(true)}
          >
            <MaterialIcons name="tune" size={16} color="#1D4ED8" />
            <Text style={styles.manageShortcutsBtnText}>
              {shortcuts.length ? 'Manage' : 'Add shortcuts'}
            </Text>
          </TouchableOpacity>
        </View>
        {shortcuts.length === 0 ? (
          <TouchableOpacity
            style={styles.shortcutsEmptyCard}
            onPress={() => setShortcutModalVisible(true)}
          >
            <MaterialIcons name="add-circle-outline" size={32} color="#1D4ED8" />
            <Text style={styles.shortcutsEmptyTitle}>Add your first shortcut</Text>
            <Text style={styles.shortcutsEmptySubtitle}>Scan, transfer and more actions in one tap</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.shortcutsGrid}>
            {shortcuts.map((shortcut) => {
              const shortcutType = getShortcutType(shortcut.type);
              if (!shortcutType) return null;

              return (
                <TouchableOpacity
                  key={shortcut.id}
                  style={[
                    styles.shortcutCard,
                    { backgroundColor: shortcutType.bgColor }
                  ]}
                  onPress={() => handleExecuteShortcut(shortcut.type)}
                  onLongPress={() => handleRemoveShortcut(shortcut.id)}
                >
                  <MaterialIcons
                    name={shortcutType.icon}
                    size={20}
                    color={shortcutType.color}
                  />
                  <Text
                    style={[styles.shortcutText, { color: shortcutType.color }]}
                    numberOfLines={1}
                  >
                    {shortcutType.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {canAddMore && (
              <TouchableOpacity
                style={[styles.shortcutCard, styles.addShortcutCard]}
                onPress={() => setShortcutModalVisible(true)}
              >
                <MaterialIcons name="add" size={24} color="#1E90FF" />
                <Text style={styles.shortcutAddText}>Add shortcut</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    );
  };

  const renderTasksTimeline = () => {
    if (!taskItems.length) return null;
    const top = taskItems.slice(0, 4);
    return (
      <View style={styles.tasksTimelineSection}>
        <Text style={styles.sectionTitle}>UPCOMING</Text>
        {top.map((item, idx) => (
          <View key={idx} style={styles.tasksTimelineRow}>
            <View style={styles.tasksTimelineDot} />
            <View style={{ flex: 1 }}>
              <Text style={styles.tasksTimelineTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.tasksTimelineSub} numberOfLines={1}>
                {item.due ? prettyDate(new Date(item.due)) : 'No due date'}
              </Text>
            </View>
          </View>
        ))}
      </View>
    );
  };

  const renderTasksSection = ({ showSummary = false } = {}) => (
    <View style={styles.toDoList}>
      <View style={styles.tasksHeaderRow}>
        <Text style={styles.sectionTitle}>Tasks</Text>
        {totalTasks > 0 && (
          <View style={styles.tasksHeaderChip}>
            <MaterialIcons name="assignment-turned-in" size={14} color="#2563EB" />
            <Text style={styles.tasksHeaderChipText}>{totalTasks} open</Text>
          </View>
        )}
      </View>
      {showSummary && (
        <View style={styles.taskSummaryRow}>
          <View style={[styles.taskSummaryCard, { backgroundColor: '#E7F3FF' }]}>
            <View style={styles.taskSummaryIconWrap}>
              <MaterialIcons name="assignment-turned-in" size={18} color="#1D4ED8" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.taskSummaryValue}>{totalTasks}</Text>
              <Text style={styles.taskSummaryLabel}>Open</Text>
            </View>
          </View>
          <View style={[styles.taskSummaryCard, { backgroundColor: '#FFE4E6' }]}>
            <View style={styles.taskSummaryIconWrap}>
              <MaterialIcons name="error-outline" size={18} color="#B91C1C" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.taskSummaryValue}>{overdueCount}</Text>
              <Text style={styles.taskSummaryLabel}>Overdue</Text>
            </View>
          </View>
          <View style={[styles.taskSummaryCard, { backgroundColor: '#FFF7DB' }]}>
            <View style={styles.taskSummaryIconWrap}>
              <MaterialIcons name="notifications-active" size={18} color="#D97706" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.taskSummaryValue}>{reminderCount}</Text>
              <Text style={styles.taskSummaryLabel}>Reminders</Text>
            </View>
          </View>
          <View style={[styles.taskSummaryCard, { backgroundColor: '#ECFEFF' }]}>
            <View style={styles.taskSummaryIconWrap}>
              <MaterialIcons name="build" size={18} color="#0891B2" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.taskSummaryValue}>{maintenanceCount}</Text>
              <Text style={styles.taskSummaryLabel}>Maintenance</Text>
            </View>
          </View>
          <View style={[styles.taskSummaryCard, { backgroundColor: '#FFE4C4' }]}>
            <View style={styles.taskSummaryIconWrap}>
              <MaterialIcons name="build" size={18} color="#C05621" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.taskSummaryValue}>{repairCount}</Text>
              <Text style={styles.taskSummaryLabel}>Repair</Text>
            </View>
          </View>
          <View style={[styles.taskSummaryCard, { backgroundColor: '#E0F2FE' }]}>
            <View style={styles.taskSummaryIconWrap}>
              <MaterialIcons name="work-outline" size={18} color="#0369A1" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.taskSummaryValue}>{hireCount}</Text>
              <Text style={styles.taskSummaryLabel}>On Hire</Text>
            </View>
          </View>
        </View>
      )}

      <View style={styles.taskFiltersRow}>
        {[
          { key: 'all', label: 'All', count: totalTasks },
          { key: 'overdue', label: 'Overdue', count: overdueCount },
          { key: 'reminder', label: 'Reminders', count: reminderCount },
          { key: 'maintenance', label: 'Maintenance', count: maintenanceCount },
          { key: 'repair', label: 'Repair', count: repairCount },
          { key: 'hire', label: 'On Hire', count: hireCount },
        ].map((filter) => {
          const selected = taskFilter === filter.key;
          return (
            <TouchableOpacity
              key={filter.key}
              style={[
                styles.taskFilterChip,
                selected && styles.taskFilterChipSelected,
                !filter.count && !selected && styles.taskFilterChipEmpty,
              ]}
              onPress={() => setTaskFilter(filter.key)}
            >
              <Text
                style={[
                  styles.taskFilterChipText,
                  selected && styles.taskFilterChipTextSelected,
                ]}
              >
                {filter.label} {typeof filter.count === 'number' ? `· ${filter.count}` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {tasks.loading ? (
        <View style={styles.toDoCard}><ActivityIndicator color="#2563EB" /></View>
      ) : filteredTaskItems.length === 0 ? (
        <View style={[styles.toDoCard, styles.emptyStateCard]}>
          <View style={styles.emptyStateIconWrap}>
            <MaterialIcons name="celebration" size={26} color="#1D4ED8" />
          </View>
          <Text style={styles.emptyStateTitle}>You’re all caught up</Text>
          <Text style={styles.emptyStateSubtitle}>
            No {taskFilter === 'all' ? '' : `${taskFilter} `}tasks right now. Enjoy the calm or jump into something else.
          </Text>
          <View style={styles.emptyStateActionsRow}>
            <TouchableOpacity
              style={[styles.emptyStateButton, styles.emptyStateButtonPrimary]}
              onPress={() => router.push('/asset/assets')}
            >
              <MaterialIcons name="inventory" size={16} color="#FFFFFF" />
              <Text style={styles.emptyStateButtonText}>View my assets</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.emptyStateButton, styles.emptyStateButtonGhost]}
              onPress={() => router.push('/activity')}
            >
              <MaterialIcons name="history" size={16} color="#1D4ED8" />
              <Text style={styles.emptyStateButtonGhostText}>Recent activity</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.emptyStateHint}>
            Tip: switch filters above to explore other task types, or scan an asset to log new work.
          </Text>
        </View>
      ) : (
        <View
          style={[styles.toDoCard, { paddingHorizontal: 0, paddingVertical: 12 }]}
          onLayout={(e) => {
            const w = e?.nativeEvent?.layout?.width || 0;
            if (w && w !== taskWidth) setTaskWidth(w);
          }}
        >
          <Animated.FlatList
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
            horizontal
            pagingEnabled
            snapToInterval={taskWidth}
            decelerationRate="fast"
            showsHorizontalScrollIndicator={false}
            getItemLayout={(_, index) => ({ length: taskWidth, offset: taskWidth * index, index })}
            extraData={taskWidth}
            renderItem={({ item }) => {
              const todayMidLocal = (() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; })();
              const isReminder = isReminderTask(item);
              const isOverdue = isOverdueTask(item);
              const isMaintenance = isRepairTask(item);
              const isService = isServiceTask(item) && !isMaintenance;
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

              const dueText = hasDue ? prettyDate(new Date(item.due)) : 'No due date';

              return (
                <View style={{ width: Math.max(1, taskWidth), paddingHorizontal: 24 }}>
                  <View style={styles.taskCard}>
                    <View style={styles.taskCardHeaderRow}>
                      <View style={[styles.statusChip, { backgroundColor: statusBg, borderColor: statusBorder }]}>
                        <MaterialIcons name={statusIcon} size={14} color={statusIconColor} />
                        <Text style={[styles.statusChipText, { color: statusText }]} numberOfLines={1}>
                          {statusLabel}
                        </Text>
                      </View>
                      {hasDue && (
                        <View style={styles.duePill}>
                          <MaterialIcons name="event" size={14} color="#0F172A" />
                          <Text style={styles.duePillText} numberOfLines={1}>
                            {dueText}
                          </Text>
                        </View>
                      )}
                    </View>

                    <View style={styles.taskMainRow}>
                      {item.imageUrl ? (
                        <Image source={{ uri: item.imageUrl }} style={styles.taskAssetThumb} resizeMode="cover" />
                      ) : (
                        <View style={styles.taskAssetThumbPlaceholder}>
                          <MaterialIcons name="inventory" size={22} color="#2563EB" />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.taskAssetTitle} numberOfLines={1}>
                          {item.subtitle || 'Asset'}
                        </Text>
                        <Text style={styles.taskTitle} numberOfLines={2}>
                          {item.title}
                        </Text>
                        <View style={styles.taskMetaRow}>
                          <View style={styles.taskMetaItem}>
                            <MaterialIcons name="tag" size={14} color="#9CA3AF" />
                            <Text style={styles.taskMetaText} numberOfLines={1}>
                              Asset ID: {item.assetId}
                            </Text>
                          </View>
                          {isService && (
                            <View style={[styles.smallTag, styles.smallTagSignoff]}>
                              <MaterialIcons name="build-circle" size={12} color="#4F46E5" />
                              <Text style={styles.smallTagText}>Service</Text>
                            </View>
                          )}
                          {isMaintenance && (
                            <View style={[styles.smallTag, styles.smallTagMaintenance]}>
                              <MaterialIcons name="build" size={12} color="#0F766E" />
                              <Text style={styles.smallTagText}>Repair</Text>
                            </View>
                          )}
                        </View>
                      </View>
                    </View>

                    <View style={styles.taskFooterRow}>
                      <View style={styles.taskTagRow}>
                        {isOverdue && (
                          <View style={[styles.smallTag, styles.smallTagOverdue]}>
                            <MaterialIcons name="priority-high" size={12} color="#B91C1C" />
                            <Text style={styles.smallTagText}>High priority</Text>
                          </View>
                        )}
                        {isReminder && !isOverdue && (
                          <View style={[styles.smallTag, styles.smallTagReminder]}>
                            <MaterialIcons name="notifications-active" size={12} color="#1D4ED8" />
                            <Text style={styles.smallTagText}>Reminder</Text>
                          </View>
                        )}
                        {isMaintenance && (
                          <View style={[styles.smallTag, styles.smallTagMaintenance]}>
                            <MaterialIcons name="build" size={12} color="#0F766E" />
                            <Text style={styles.smallTagText}>Repair</Text>
                          </View>
                        )}
                      </View>
                      <TouchableOpacity
                        style={[styles.toDoButton, styles.taskPrimaryButton]}
                        onPress={() => openTaskAction(item)}
                      >
                        <Text style={styles.toDoButtonText}>
                          {isSignoff ? 'Review & sign off' : 'Action Task'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            }}
            onScroll={Animated.event([
              { nativeEvent: { contentOffset: { x: scrollX } } }
            ], { useNativeDriver: false })}
            onMomentumScrollEnd={(e) => {
              const { contentOffset } = e.nativeEvent;
              const idx = taskWidth ? Math.round(contentOffset.x / taskWidth) : 0;
              if (idx !== taskIndex) setTaskIndex(idx);
            }}
          />

          {filteredTaskItems.length > 1 && (
            <View pointerEvents="box-none" style={{ position: 'absolute', top: '40%', left: 8, right: 8, flexDirection: 'row', justifyContent: 'space-between' }}>
              <TouchableOpacity
                onPress={() => {
                  const next = Math.max(0, taskIndex - 1);
                  setTaskIndex(next);
                  try { taskListRef.current?.scrollToIndex({ index: next, animated: true }); } catch { }
                }}
                style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#EAF1FF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#D6E8FF' }}
              >
                <MaterialIcons name="chevron-left" size={20} color="#2563EB" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const total = filteredTaskItems.length || 0;
                  if (!total) return;
                  const next = (taskIndex + 1) % total;
                  setTaskIndex(next);
                  try { taskListRef.current?.scrollToIndex({ index: next, animated: true }); } catch { }
                }}
                style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#EAF1FF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#D6E8FF' }}
              >
                <MaterialIcons name="chevron-right" size={20} color="#2563EB" />
              </TouchableOpacity>
            </View>
          )}

          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 }}>
            {filteredTaskItems.map((_, i) => {
              const inputRange = [taskWidth * (i - 1), taskWidth * i, taskWidth * (i + 1)];
              const scale = scrollX.interpolate({ inputRange, outputRange: [1, 1.4, 1], extrapolate: 'clamp' });
              const opacity = scrollX.interpolate({ inputRange, outputRange: [0.5, 1, 0.5], extrapolate: 'clamp' });
              return (
                <Animated.View key={`dot-${i}`} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#2563EB', opacity, transform: [{ scale }] }} />
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
  const renderHeroMobile = () => (
    <View style={styles.hero}>
      <View style={styles.heroTopRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.heroTitle}>Hi {userName},</Text>
          <Text style={styles.heroSub}>
            {isIos ? 'Quick actions for your assets.' : "Here's what needs your attention today."}
          </Text>
        </View>
        <TouchableOpacity onPress={() => setShowProfileMenu(!showProfileMenu)}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{userInitials}</Text>
          </View>
        </TouchableOpacity>
      </View>
      {!isIos && (
        <View style={styles.heroStatsRow}>
          <View style={styles.heroStatCard}>
            <Text style={styles.heroStatValue}>{overdueCount}</Text>
            <Text style={styles.heroStatLabel}>Overdue</Text>
          </View>
          <View style={styles.heroStatCard}>
            <Text style={styles.heroStatValue}>{reminderCount}</Text>
            <Text style={styles.heroStatLabel}>Reminders</Text>
          </View>
          <View style={styles.heroStatCard}>
            <Text style={styles.heroStatValue}>{totalTasks}</Text>
            <Text style={styles.heroStatLabel}>Open Tasks</Text>
          </View>
        </View>
      )}
    </View>
  );

  const renderWebContent = () => {
    const key = webViewKey;
    if (!key || key === 'dashboard' || key === 'search') {
      return (
        <View style={styles.webPane}>
          <SearchScreen embed />
        </View>
      );
    }
    if (key === 'certs') {
      return (
        <View style={styles.webPane}>
          <ErrorBoundary>
            <CertsView visible />
          </ErrorBoundary>
        </View>
      );
    }
    if (key === 'inventory') {
      return (
        <View style={styles.webPane}>
          <InventoryScreen />
        </View>
      );
    }
    if (key === 'shortcuts' || key === 'tasks') {
      return (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {key === 'shortcuts' ? renderShortcutsSection() : null}
          {key === 'tasks' ? renderTasksSection({ showSummary: true }) : null}
        </ScrollView>
      );
    }
    return (
      <View style={styles.webPane}>
        <SearchScreen embed />
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color="#1E90FF" />
      </View>
    );
  }

  return (
    <ScreenWrapper style={styles.safeArea}>
      <View style={styles.dashboard}>
        {isDesktopWeb ? (
          <View style={styles.webContent}>{renderWebContent()}</View>
        ) : (
          <ScrollView contentContainerStyle={styles.scrollContent}>
            {renderHeroMobile()}
            <TourStep
              stepId="quick-actions"
              order={1}
              title="Quick Actions"
              description="Use these quick action buttons to quickly access common features like scanning QR codes, creating new assets, or viewing your inventory."
            >
              <View style={styles.quickRow}>
                {quickActions.map((action) => (
                  <TouchableOpacity
                    key={action.key}
                    style={styles.quickCard}
                    onPress={action.onPress}
                  >
                    <MaterialIcons name={action.icon} size={20} color="#2563EB" />
                    <Text style={styles.quickText}>{action.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </TourStep>
            <TourStep
              stepId="tasks"
              order={2}
              title="Tasks & Reminders"
              description="This section shows your upcoming tasks and reminders. Swipe through to see items that need your attention, like maintenance due dates or document renewals."
            >
              {renderTasksSection()}
            </TourStep>
            <TourStep
              stepId="shortcuts"
              order={3}
              title="Shortcuts"
              description="Create custom shortcuts to quickly access your frequently used assets, documents, or features. Tap the + button to add new shortcuts."
            >
              {renderShortcutsSection()}
            </TourStep>
          </ScrollView>
        )}
      </View>

      {showProfileMenu && (
        <View style={styles.menuOverlay} pointerEvents="box-none">
          <TouchableOpacity style={styles.menuBackdrop} onPress={() => setShowProfileMenu(false)} />
          <View style={styles.profileMenuFixed}>
            {canAdmin && (
              <TouchableOpacity style={styles.menuItem} onPress={() => { setShowProfileMenu(false); router.push('/admin'); }}>
                <Text style={styles.menuText}>Admin Console</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.menuItem} onPress={() => { setShowProfileMenu(false); router.push('/profile'); }}>
              <Text style={styles.menuText}>Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={handleRestartTour}>
              <Text style={styles.menuText}>Restart Tour</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.menuItem, styles.menuItemLast]} onPress={handleLogout}>
              <Text style={[styles.menuText, styles.logoutText]}>Logout</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Modal visible={actionOpen} transparent animationType="fade" onRequestClose={() => setActionOpen(false)}>
        <View style={[styles.menuOverlay, { justifyContent: 'center', alignItems: 'center' }]}>
          <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />
          <TouchableOpacity style={styles.menuBackdrop} onPress={() => setActionOpen(false)} />
          <View style={styles.taskModalCard}>
            <Text style={{ fontSize: 18, fontWeight: '900', marginBottom: 6 }}>{actionTask?.title || 'Action Task'}</Text>
            <Text style={{ color: '#6B7280', marginBottom: 12 }}>{actionTask?.subtitle || ''}</Text>

            {actionTask?.kind === 'signoff' ? (
              <>
                <View style={{ marginBottom: 10 }}>
                  <Text style={{ color: '#6B7280', fontSize: 12, marginBottom: 6 }}>Has this work been completed?</Text>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity onPress={() => setSignoffChoice('yes')} style={[styles.quickDateChip, { backgroundColor: signoffChoice === 'yes' ? '#DBEAFE' : '#fff', borderColor: signoffChoice === 'yes' ? '#93C5FD' : '#E5E7EB' }]}>
                      <Text style={[styles.quickDateChipText, { color: signoffChoice === 'yes' ? '#1D4ED8' : '#374151' }]}>Yes</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setSignoffChoice('no')} style={[styles.quickDateChip, { backgroundColor: signoffChoice === 'no' ? '#FEE2E2' : '#fff', borderColor: signoffChoice === 'no' ? '#FCA5A5' : '#E5E7EB' }]}>
                      <Text style={[styles.quickDateChipText, { color: signoffChoice === 'no' ? '#B91C1C' : '#374151' }]}>No</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* For Maintenance sign-off, capture next service date when completing */}
                {signoffChoice === 'yes' && String(actionTask?.actionType || '').toUpperCase() === 'MAINTENANCE' && (
                  <>
                    <View style={{ marginBottom: 10 }}>
                      <Text style={{ color: '#6B7280', fontSize: 12, marginBottom: 6 }}>Next Service Date</Text>
                      <TouchableOpacity onPress={() => setDateOpen(true)}>
                        <View style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 }}>
                          <Text style={{ color: '#111827' }}>{prettyDate(new Date(actionNextDate))}</Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.quickDateRow}>
                      <TouchableOpacity onPress={() => setNextMonths(3)} style={styles.quickDateChip}>
                        <Text style={styles.quickDateChipText}>+3 months</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setNextMonths(6)} style={styles.quickDateChip}>
                        <Text style={styles.quickDateChipText}>+6 months</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setNextMonths(12)} style={styles.quickDateChip}>
                        <Text style={styles.quickDateChipText}>+12 months</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}

                {/* Service / Repair report upload on sign-off */}
                {signoffChoice === 'yes' && (String(actionTask?.actionType || '').toUpperCase() === 'MAINTENANCE' || String(actionTask?.actionType || '').toUpperCase() === 'REPAIR') && (
                  <View style={{ marginTop: 10 }}>
                    <Text style={{ color: '#6B7280', fontSize: 12, marginBottom: 6 }}>
                      {String(actionTask.actionType || '').toUpperCase() === 'REPAIR' ? 'Upload Repair Report (optional)' : 'Upload Service Report (optional)'}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <TouchableOpacity
                        style={[styles.btn, styles.btnGhost, { flex: 1 }]}
                        onPress={async () => {
                          try {
                            const res = await DocumentPicker.getDocumentAsync({
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
                            Alert.alert('Error', e.message || 'Failed to select document');
                          }
                        }}
                      >
                        <Text style={{ fontWeight: '700', color: '#2563EB' }}>
                          {signoffReport ? 'Replace Report' : 'Upload Report'}
                        </Text>
                      </TouchableOpacity>
                      {signoffReport && (
                        <TouchableOpacity
                          style={[styles.btn, { flex: 1, backgroundColor: '#FEE2E2' }]}
                          onPress={() => setSignoffReport(null)}
                        >
                          <Text style={{ fontWeight: '700', color: '#B91C1C' }}>Remove</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    {signoffReport && (
                      <Text style={{ marginTop: 4, fontSize: 12, color: '#6B7280' }}>
                        Attached: {signoffReport.name || 'document'}
                      </Text>
                    )}
                  </View>
                )}
              </>
            ) : (
              <>
                <View style={{ marginBottom: 10 }}>
                  <Text style={{ color: '#6B7280', fontSize: 12, marginBottom: 6 }}>Select next date</Text>
                  <TouchableOpacity onPress={() => setDateOpen(true)}>
                    <View style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 }}>
                      <Text style={{ color: '#111827' }}>{prettyDate(new Date(actionNextDate))}</Text>
                    </View>
                  </TouchableOpacity>
                </View>
                <View style={styles.quickDateRow}>
                  <TouchableOpacity onPress={() => setNextMonths(3)} style={styles.quickDateChip}>
                    <Text style={styles.quickDateChipText}>+3 months</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setNextMonths(6)} style={styles.quickDateChip}>
                    <Text style={styles.quickDateChipText}>+6 months</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setNextMonths(12)} style={styles.quickDateChip}>
                    <Text style={styles.quickDateChipText}>+12 months</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* Optional Note */}
            <View style={{ marginTop: 8 }}>
              <Text style={{ color: '#6B7280', fontSize: 12, marginBottom: 6 }}>Note (optional)</Text>
              <AppTextInput
                style={{ minHeight: 44, backgroundColor: theme.colors.surface }}
                placeholder="Add a note"
                value={actionNote}
                onChangeText={setActionNote}
                multiline
              />
            </View>

            {actionDocSlug ? (
              <View style={{ marginTop: 10 }}>
                <Text style={{ color: '#6B7280', fontSize: 12, marginBottom: 6 }}>Linked document category: {String(actionDocSlug).replace(/_/g, ' ')}</Text>
                {actionDocPicked ? (
                  <Text style={{ marginBottom: 6, fontStyle: 'italic', color: '#374151' }}>Attached: {actionDocPicked.name || 'document'}</Text>
                ) : null}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnGhost, { paddingVertical: 10, flex: 1 }]}
                    onPress={async () => {
                      try {
                        const res = await DocumentPicker.getDocumentAsync({
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
                        Alert.alert('Error', e.message || 'Failed to select document');
                      }
                    }}
                  >
                    <Text style={{ fontWeight: '700', color: '#2563EB' }}>{actionDocPicked ? 'Replace Document' : 'Upload Document'}</Text>
                  </TouchableOpacity>
                  {actionDocPicked ? (
                    <TouchableOpacity style={[styles.btn, { paddingVertical: 10, backgroundColor: '#fdecea', flex: 1 }]} onPress={() => setActionDocPicked(null)}>
                      <Text style={{ color: '#b00020' }}>Remove</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
              <TouchableOpacity onPress={() => setActionOpen(false)} style={[styles.btn, styles.btnGhost, { flex: 1 }]}>
                <Text style={styles.menuText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={actionSubmitting} onPress={async () => { await handleSubmitTaskAction(); }} style={[styles.btn, styles.btnPrimary, { flex: 1, opacity: actionSubmitting ? 0.7 : 1 }]}>
                <MaterialIcons name="check-circle" size={18} color="#fff" />
                <Text style={[styles.menuText, { color: '#fff', fontWeight: '800' }]}>
                  {actionSubmitting
                    ? 'Saving...'
                    : (actionTask?.kind === 'signoff'
                      ? (String(actionTask?.actionType || '').toUpperCase() === 'MAINTENANCE'
                        ? 'Sign off Service'
                        : 'Sign Off')
                      : 'Mark Done')}
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

      {/* Add Shortcut Modal */}
      <AddShortcutModal
        visible={shortcutModalVisible}
        onClose={() => setShortcutModalVisible(false)}
        onAddShortcut={handleAddShortcut}
        onRemoveShortcut={handleRemoveShortcut}
        existingShortcuts={shortcuts}
        isAdmin={canAdmin}
      />
    </ScreenWrapper>
  );
};

Dashboard.propTypes = {
  isAdmin: PropTypes.bool,
};

Dashboard.defaultProps = {
  isAdmin: false,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7FAFF' },
  safeArea: { flex: 1, backgroundColor: '#F7FAFF' },
  dashboard: { flex: 1, backgroundColor: '#F7FAFF' },
  scrollContent: { padding: 16, paddingBottom: 40 },
  loadingContainer: { justifyContent: 'center', alignItems: 'center', flex: 1 },
  hero: {
    backgroundColor: '#0B63CE',
    padding: 16,
    borderRadius: 16,
    marginBottom: 14,
    shadowColor: '#F59E0B',
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
    borderBottomWidth: 3,
    borderBottomColor: '#FBBF24',
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  heroTitle: { fontSize: 22, fontWeight: '900', color: '#fff' },
  heroSub: { color: '#D6E8FF', marginTop: 2, fontSize: 13 },
  heroStatsRow: { flexDirection: 'row', marginTop: 6, gap: 10 },
  heroStatCard: {
    flex: 1,
    backgroundColor: 'rgba(251,191,36,0.15)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.3)',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(191,219,254,0.45)',
  },
  heroStatValue: { fontSize: 18, fontWeight: '800', color: '#FFFFFF' },
  heroStatLabel: { fontSize: 11, fontWeight: '600', color: '#E0ECFF', marginTop: 2, textTransform: 'uppercase' },
  avatar: {
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 25, width: 46, height: 46, justifyContent: 'center', alignItems: 'center', elevation: 2,
  },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  profileMenu: { display: 'none' },
  menuOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 },
  menuBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  profileMenuFixed: {
    position: 'absolute', top: 70, right: 20, backgroundColor: '#fff', borderRadius: 8,
    paddingVertical: 8, paddingHorizontal: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 4, elevation: 8, minWidth: 180, borderWidth: 1, borderColor: '#E9F1FF'
  },
  menuItem: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  menuItemLast: { borderBottomWidth: 0 },
  menuText: { fontSize: 16, color: '#333' },
  logoutText: { color: '#ff4444' },
  overdueBadgeText: { color: '#B91C1C', fontWeight: '800', marginLeft: 6 },
  reminderBadge: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#DBEAFE', borderWidth: 1, borderColor: '#BFDBFE',
    borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8,
  },
  reminderBadgeText: { color: '#1D4ED8', fontWeight: '800', marginLeft: 6 },
  neutralBadge: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8,
  },
  neutralBadgeText: { color: '#374151', fontWeight: '800', marginLeft: 6 },
  taskModalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    width: '92%',
    maxWidth: 520,
    borderWidth: 1,
    borderColor: '#E9F1FF'
  },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8, marginBottom: 18 },
  quickCard: { flexBasis: '48%', backgroundColor: '#fff', borderRadius: 12, paddingVertical: 16, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#E9F1FF', shadowColor: '#0B63CE', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  quickText: { color: '#2563EB', fontWeight: '800' },
  webContent: { flex: 1 },
  webPane: { flex: 1, minHeight: 0, overflow: 'auto' },
  recentSection: { marginTop: 6, marginBottom: 16 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EFF4FF' },
  recentIconWrap: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#EEF5FF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#DDEBFF' },
  recentTitle: { color: '#111', fontWeight: '800' },
  recentSub: { color: '#666', fontSize: 12, marginTop: 2 },
  recentWhen: { color: '#888', fontSize: 11, marginLeft: 8 },
  shortcutsSection: { marginTop: 16, marginBottom: 20 },
  shortcutsHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '900', color: '#D97706', marginBottom: 12, letterSpacing: 0.5 },
  errorText: { color: '#B91C1C', marginTop: 8 },
  emptyText: { color: '#6B7280', marginTop: 8 },
  shortcutsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  shortcutCard: {
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 12,
    width: '48%',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
    minHeight: 86,
    gap: 6,
  },
  addShortcutCard: { borderWidth: 1, borderColor: '#1E90FF', borderStyle: 'dashed', backgroundColor: 'transparent' },
  shortcutText: { color: '#111827', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  shortcutAddText: { marginTop: 2, fontSize: 12, color: '#1D4ED8', fontWeight: '600' },
  manageShortcutsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#DBEAFE',
    backgroundColor: '#F8FAFF',
  },
  manageShortcutsBtnText: { fontSize: 12, color: '#1D4ED8', fontWeight: '700' },
  shortcutsEmptyCard: {
    borderWidth: 1,
    borderColor: '#DBEAFE',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 24,
    alignItems: 'center',
    backgroundColor: '#F8FAFF',
    gap: 6,
  },
  shortcutsEmptyTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  shortcutsEmptySubtitle: { fontSize: 13, color: '#475569', textAlign: 'center' },
  toDoList: { marginTop: 16 },
  toDoCard: { backgroundColor: '#fff', padding: 20, borderRadius: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  tasksHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
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
  taskSummaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 18 },
  taskSummaryCard: {
    flexGrow: 1,
    flexBasis: '48%',
    minWidth: 140,
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  taskSummaryIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskSummaryValue: { fontSize: 20, fontWeight: '800', color: '#0F172A' },
  taskSummaryLabel: { fontSize: 12, fontWeight: '600', color: '#475569' },
  toDoTitle: { fontSize: 17, fontWeight: '600', color: '#333', marginBottom: 8 },
  toDoText: { color: '#666', marginBottom: 15, fontSize: 15 },
  toDoButton: { backgroundColor: '#1E90FF', paddingVertical: 8, paddingHorizontal: 20, borderRadius: 6, alignSelf: 'flex-start' },
  taskPrimaryButton: { borderRadius: 999, paddingHorizontal: 22 },
  toDoButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  btnPrimary: { backgroundColor: '#2563EB' },
  btnGhost: { borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFF' },
  overdueBadge: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FEE2E2', borderWidth: 1, borderColor: '#FCA5A5',
    borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8,
  },
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
  taskCardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 10 },
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
  taskHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  taskAssetThumb: { width: 56, height: 56, borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF' },
  taskAssetThumbPlaceholder: { width: 56, height: 56, borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#EEF5FF', justifyContent: 'center', alignItems: 'center' },
  taskAssetTitle: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  taskTitle: { fontSize: 14, fontWeight: '600', color: '#1D4ED8', marginTop: 2 },
  taskMetaRow: { marginTop: 6, gap: 4 },
  taskMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  taskMetaText: { fontSize: 12, color: '#6B7280' },
  taskFooterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, gap: 12 },
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
  emptyStateSubtitle: { fontSize: 13, color: '#6B7280', textAlign: 'center', marginHorizontal: 10 },
  emptyStateActionsRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  emptyStateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  emptyStateButtonPrimary: { backgroundColor: '#1D4ED8' },
  emptyStateButtonGhost: { backgroundColor: '#EFF6FF' },
  emptyStateButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  emptyStateButtonGhostText: { color: '#1D4ED8', fontWeight: '700', fontSize: 13 },
  emptyStateHint: { marginTop: 6, fontSize: 11, color: '#9CA3AF', textAlign: 'center' },
  taskFiltersRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 4,
    marginBottom: 6,
    marginTop: 2,
    display: Platform.OS === 'web' ? 'flex' : 'none',
  },
  taskFilterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingVertical: 3,
    paddingHorizontal: 8,
    backgroundColor: '#FFFFFF',
  },
  taskFilterChipSelected: {
    backgroundColor: '#1D4ED8',
    borderColor: '#1D4ED8',
  },
  taskFilterChipEmpty: {
    opacity: 0.45,
  },
  taskFilterChipText: { fontSize: 11, fontWeight: '600', color: '#4B5563' },
  taskFilterChipTextSelected: { color: '#FFFFFF' },
  tasksTimelineSection: { marginTop: 10 },
  tasksTimelineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4 },
  tasksTimelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
    backgroundColor: '#2563EB',
  },
  tasksTimelineTitle: { fontSize: 13, fontWeight: '600', color: '#111827' },
  tasksTimelineSub: { fontSize: 11, color: '#6B7280' },

  quickDateRow: { flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 4 },
  quickDateChip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#F9FAFB' },
  quickDateChipText: { color: '#2563EB', fontWeight: '800' },
});

export default Dashboard;
