// components/work/AssetWorkPanel.js
// "Current work" + "History" panels shared by the Repair and Maintenance screens.
//
// Current work gathers everything still open for this asset in the given kind:
//   • open manual tasks (category REPAIR, or SERVICE/MAINTENANCE/INSPECTION)
//   • actions awaiting sign-off (data.requires_signoff && !data.completed)
//   • the bare asset flag (needs_repair / maintenance_due) when nothing above covers it
//
// Each item offers View (full detail), Edit, Photo and Sign off.
//   • Sign off closes the underlying work AND completes the task that raised it:
//       task   → POST /tasks/:id/complete   (server writes history + clears the flag)
//       action → POST /assets/:id/actions/:actionId/signoff, then completes open tasks
//       flag   → writes the completed action + clears the flag, then completes open tasks
//     Only one history row is written per sign-off — the task path is left to the
//     server so we never double-log.
//   • Edit is task-only: PATCH /tasks/:id. The API has no update route for an
//     asset_action, so those are view-only (the card says so).
//   • Photos upload to the asset's documents (there is no endpoint that appends an
//     image to an existing action). A photo added to a TASK is remembered and passed
//     as `image_url` on sign-off, so it lands on the resulting history row.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, Modal, ScrollView, Image, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { DatePickerModal } from 'react-native-paper-dates';
import { getAuth } from 'firebase/auth';
import { Colors, Radius, Shadows, sf } from '../../constants/uiTheme';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import ConfirmModal from '../ui/ConfirmModal';
import { pickAssetImage, pickAssetImages, revokeImageUri } from '../../utils/getFormFileFromPicker';
import logger from '../../utils/logger';

const TASK_CATEGORIES = {
  REPAIR: ['REPAIR'],
  MAINTENANCE: ['SERVICE', 'MAINTENANCE', 'INSPECTION'],
};
const FLAG_FOR = { REPAIR: 'needs_repair', MAINTENANCE: 'maintenance_due' };
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];
const MAX_PHOTOS = 5;
const WORD = {
  REPAIR: {
    work: 'repair', Work: 'Repair',
    current: 'Current repair work', history: 'Repair history',
    photoKind: 'Repair photos', photoKinds: ['Repair photos'],
  },
  MAINTENANCE: {
    work: 'maintenance', Work: 'Maintenance',
    current: 'Current maintenance work', history: 'Maintenance history',
    // 'Service photos' is the legacy label written by the older sign-off flow.
    photoKind: 'Maintenance photos', photoKinds: ['Maintenance photos', 'Service photos'],
  },
};

// Server convention (mirrored from routes/tasks.js + routes/assets.js): an action is
// awaiting sign-off when it asks for one and hasn't been completed. Both spellings
// are accepted because older rows use the underscore variants.
const needsSignoff = (data) => {
  const d = data || {};
  const need = d.requires_signoff === true || d.requires_sign_off === true;
  const done = d.completed === true || d.signed_off === true;
  return need && !done;
};

const cap = (v) => (v ? String(v).charAt(0) + String(v).slice(1).toLowerCase() : '');

// Task priorities are LOW/MEDIUM/HIGH; action priorities add NORMAL/CRITICAL.
const priorityChip = (p) => {
  const v = String(p || '').toUpperCase();
  if (v === 'HIGH' || v === 'CRITICAL') return { box: s.prioHigh, text: s.prioHighText };
  if (v === 'LOW') return { box: s.prioLow, text: s.prioLowText };
  return { box: s.prioMed, text: s.prioMedText };
};

function prettyDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
  } catch { return String(iso); }
}
// "Overdue by 5 days" / "Due today" / "Due in 12 days" — null when there's no date.
function dueStatus(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d - today) / 86400000);
  const plural = (n) => (Math.abs(n) === 1 ? 'day' : 'days');
  if (days < 0) return { text: `Overdue by ${Math.abs(days)} ${plural(days)}`, overdue: true };
  if (days === 0) return { text: 'Due today', overdue: true };
  return { text: `Due in ${days} ${plural(days)}`, overdue: false };
}
function toDateOnly(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function authHeaders(json = true) {
  const headers = json ? { 'Content-Type': 'application/json' } : {};
  try {
    const current = getAuth()?.currentUser;
    if (current?.uid) headers['X-User-Id'] = current.uid;
    if (current?.displayName) headers['X-User-Name'] = current.displayName;
    if (current?.email) headers['X-User-Email'] = current.email;
    if (current && typeof current.getIdToken === 'function') {
      const token = await current.getIdToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
  } catch (_) { /* unauthenticated fallthrough */ }
  return headers;
}

export default function AssetWorkPanel({ asset, assetId, kind, reloadKey, onChanged }) {
  const words = WORD[kind] || WORD.REPAIR;
  const flagKey = FLAG_FOR[kind];
  const categories = TASK_CATEGORIES[kind] || [];

  const [actions, setActions] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0); // local refresh after a mutation

  const [viewItem, setViewItem] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [signTarget, setSignTarget] = useState(null);

  // Edit form
  const [eTitle, setETitle] = useState('');
  const [eDetail, setEDetail] = useState('');
  const [ePriority, setEPriority] = useState('MEDIUM');
  const [eDue, setEDue] = useState(null);
  const [eDateOpen, setEDateOpen] = useState(false);

  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [busyPhoto, setBusyPhoto] = useState(null); // item key currently uploading
  const [shotFor, setShotFor] = useState({});       // itemKey -> [uploaded photo urls]
  const [resultUi, setResultUi] = useState(null);

  const load = useCallback(async () => {
    if (!assetId) { setLoading(false); return; }
    setLoading(true);
    try {
      const headers = await authHeaders(true);
      const [actRes, taskRes, docRes] = await Promise.all([
        fetch(`${API_BASE_URL}/assets/${assetId}/actions`, { headers }),
        fetch(`${API_BASE_URL}/tasks?status=OPEN`, { headers }),
        fetch(`${API_BASE_URL}/asset-documents/documents?assetId=${encodeURIComponent(assetId)}`, { headers }),
      ]);
      const actJson = actRes.ok ? await actRes.json() : { actions: [] };
      const taskJson = taskRes.ok ? await taskRes.json() : { items: [] };
      const docJson = docRes.ok ? await docRes.json() : { items: [] };
      setActions(Array.isArray(actJson?.actions) ? actJson.actions : []);
      // The tasks API has no asset filter — narrow to this asset client-side.
      setTasks((Array.isArray(taskJson?.items) ? taskJson.items : [])
        .filter((t) => String(t.asset_id) === String(assetId))
        .filter((t) => categories.includes(String(t.category || '').toUpperCase())));
      setDocs((Array.isArray(docJson?.items) ? docJson.items : [])
        .filter((d) => words.photoKinds.includes(String(d.kind || ''))));
    } catch (e) {
      logger.error('AssetWorkPanel: load failed', e);
    } finally {
      setLoading(false);
    }
  }, [assetId, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load, reloadKey, tick]);

  const kindActions = useMemo(
    () => actions.filter((a) => String(a.type || '').toUpperCase() === kind),
    [actions, kind],
  );
  const pendingActions = useMemo(() => kindActions.filter((a) => needsSignoff(a.data)), [kindActions]);
  const history = useMemo(() => kindActions.filter((a) => !needsSignoff(a.data)), [kindActions]);

  const currentWork = useMemo(() => {
    const items = [];
    // No `who` on tasks: repair/maintenance are raised without an assignee, and the
    // API silently defaults one to the creator — showing it would be misleading.
    tasks.forEach((t) => items.push({
      key: `task-${t.id}`, kind: 'task', id: t.id, raw: t,
      title: t.title,
      detail: t.description,
      due: t.due_date,
      priority: t.priority,
      created: t.created_at,
      images: [],
    }));
    pendingActions.forEach((a) => items.push({
      key: `action-${a.id}`, kind: 'action', id: a.id, raw: a,
      title: a.details?.summary || a.note || `${words.Work} awaiting sign-off`,
      detail: a.details?.notes,
      due: a.details?.date || a.occurred_at,
      priority: a.details?.priority,
      who: a.performer?.name,
      created: a.occurred_at,
      cost: a.details?.estimated_cost,
      images: Array.isArray(a.data?.images) ? a.data.images : [],
    }));
    if (asset?.[flagKey] && items.length === 0) {
      items.push({
        key: 'flag', kind: 'flag', raw: null,
        title: kind === 'REPAIR' ? 'Repair needed' : 'Maintenance due',
        // The flag carries no record of its own, so surface what the asset knows.
        due: kind === 'MAINTENANCE' ? asset?.next_service_date : null,
        lastDone: history.find((a) => a.data?.completed === true)?.details?.date
          || history.find((a) => a.data?.completed === true)?.occurred_at
          || null,
        images: [],
      });
    }
    return items;
  }, [tasks, pendingActions, history, asset, flagKey, kind, words.Work]);

  // Photos on the item itself, plus asset-level photos filed under this kind (that's
  // where uploads land — see the header note). Only document-backed ones carry a
  // docId; images baked into an action record have no delete endpoint.
  const photosFor = useCallback((item) => {
    const out = [];
    (item?.images || []).forEach((u) => { if (u) out.push({ url: u, docId: null }); });
    docs.forEach((d) => { if (d.url) out.push({ url: d.url, docId: d.id }); });
    const seen = new Set();
    return out.filter((p) => (seen.has(p.url) ? false : (seen.add(p.url), true)));
  }, [docs]);

  // ── Photos: add / remove / replace ────────────────────────────────────────
  const uploadPicked = useCallback(async (picked) => {
    const headers = await authHeaders(true);
    delete headers['Content-Type']; // let fetch set the multipart boundary
    const fd = new FormData();
    if (Platform.OS === 'web') {
      const file = picked.file
        || new File([await (await fetch(picked.uri)).blob()], picked.name || 'photo.jpg', { type: picked.type || 'image/jpeg' });
      fd.append('file', file, file.name || picked.name || 'photo.jpg');
    } else {
      fd.append('file', { uri: picked.uri, name: picked.name || 'photo.jpg', type: picked.type || 'image/jpeg' });
    }
    fd.append('title', words.photoKind);
    fd.append('kind', words.photoKind);
    const res = await fetch(`${API_BASE_URL}/assets/${assetId}/documents/upload`, {
      method: 'POST', headers, body: fd,
    });
    if (!res.ok) throw new Error((await res.text()) || 'Upload failed');
    const json = await res.json();
    return json?.document?.url || null;
  }, [assetId, words]);

  const deleteDoc = useCallback(async (docId) => {
    const headers = await authHeaders(true);
    const res = await fetch(`${API_BASE_URL}/assets/${assetId}/documents/${docId}`, {
      method: 'DELETE', headers,
    });
    if (!res.ok) throw new Error((await res.text()) || 'Failed to remove the photo');
  }, [assetId]);

  const addPhotos = useCallback(async (item, remaining) => {
    if (busyPhoto) return;
    if (remaining <= 0) {
      setResultUi({ title: 'Photo limit reached', message: `You can attach up to ${MAX_PHOTOS} photos. Remove one to add another.`, error: true });
      return;
    }
    let picked = [];
    try { picked = await pickAssetImages(remaining); } catch (e) {
      setResultUi({ title: 'Error', message: e?.message || 'Failed to pick photos', error: true });
      return;
    }
    if (!picked.length) return;
    const batch = picked.slice(0, remaining);
    const skipped = picked.length - batch.length;
    setBusyPhoto('add');
    const urls = [];
    let failed = 0;
    for (const p of batch) {
      try {
        const url = await uploadPicked(p);
        if (url) urls.push(url);
      } catch (e) {
        failed += 1;
        logger.error('AssetWorkPanel: photo upload failed', e);
      } finally {
        if (Platform.OS === 'web' && p?.uri) revokeImageUri(p.uri);
      }
    }
    if (urls.length && item) setShotFor((m) => ({ ...m, [item.key]: [...(m[item.key] || []), ...urls] }));
    setTick((n) => n + 1);
    setBusyPhoto(null);
    if (failed || skipped) {
      setResultUi({
        title: failed ? 'Some photos failed' : 'Photo limit reached',
        message: [
          urls.length ? `${urls.length} added.` : null,
          failed ? `${failed} failed to upload.` : null,
          skipped ? `${skipped} skipped — the limit is ${MAX_PHOTOS}.` : null,
        ].filter(Boolean).join(' '),
        error: !!failed,
      });
    }
  }, [busyPhoto, uploadPicked]);

  const removePhoto = useCallback(async (photo) => {
    if (busyPhoto || !photo?.docId) return;
    setBusyPhoto(photo.docId);
    try {
      await deleteDoc(photo.docId);
      // Drop it from the sign-off passthrough too, so we don't send a dead URL.
      setShotFor((m) => {
        const next = {};
        Object.keys(m).forEach((k) => { next[k] = (m[k] || []).filter((u) => u !== photo.url); });
        return next;
      });
      setTick((n) => n + 1);
    } catch (e) {
      setResultUi({ title: 'Error', message: e?.message || 'Failed to remove the photo', error: true });
    } finally {
      setBusyPhoto(null);
    }
  }, [busyPhoto, deleteDoc]);

  const replacePhoto = useCallback(async (photo, item) => {
    if (busyPhoto || !photo?.docId) return;
    let picked = null;
    try { picked = await pickAssetImage(); } catch (e) {
      setResultUi({ title: 'Error', message: e?.message || 'Failed to pick a photo', error: true });
      return;
    }
    if (!picked) return;
    setBusyPhoto(photo.docId);
    try {
      // Upload first, then drop the old one — a failed upload leaves the original intact.
      const url = await uploadPicked(picked);
      await deleteDoc(photo.docId);
      setShotFor((m) => {
        const next = {};
        Object.keys(m).forEach((k) => { next[k] = (m[k] || []).filter((u) => u !== photo.url); });
        if (url && item) next[item.key] = [...(next[item.key] || []), url];
        return next;
      });
      setTick((n) => n + 1);
    } catch (e) {
      setResultUi({ title: 'Error', message: e?.message || 'Failed to replace the photo', error: true });
    } finally {
      if (Platform.OS === 'web' && picked?.uri) revokeImageUri(picked.uri);
      setBusyPhoto(null);
    }
  }, [busyPhoto, uploadPicked, deleteDoc]);

  // ── Edit (tasks only) ─────────────────────────────────────────────────────
  const openEdit = useCallback((item) => {
    setETitle(item.raw?.title || '');
    setEDetail(item.raw?.description || '');
    setEPriority(String(item.raw?.priority || 'MEDIUM').toUpperCase());
    setEDue(item.raw?.due_date ? String(item.raw.due_date).slice(0, 10) : null);
    setEditItem(item);
  }, []);

  const saveEdit = useCallback(async () => {
    if (submitting || !editItem) return;
    if (!eTitle.trim()) {
      setResultUi({ title: 'Missing title', message: 'Please give the work a title.', error: true });
      return;
    }
    setSubmitting(true);
    try {
      const headers = await authHeaders(true);
      const res = await fetch(`${API_BASE_URL}/tasks/${editItem.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          title: eTitle.trim(),
          description: eDetail.trim(),
          priority: ePriority,
          due_date: eDue || '',
        }),
      });
      if (!res.ok) throw new Error((await res.text()) || 'Failed to save changes');
      setEditItem(null);
      setTick((n) => n + 1);
      setResultUi({ title: 'Saved', message: 'The work has been updated.' });
    } catch (e) {
      setResultUi({ title: 'Error', message: e?.message || 'Failed to save changes', error: true });
    } finally {
      setSubmitting(false);
    }
  }, [submitting, editItem, eTitle, eDetail, ePriority, eDue]);

  // ── Sign off ──────────────────────────────────────────────────────────────
  const completeOpenTasks = useCallback(async (headers, text) => {
    for (const t of tasks) {
      try {
        await fetch(`${API_BASE_URL}/tasks/${t.id}/complete`, {
          method: 'POST', headers, body: JSON.stringify({ note: text }),
        });
      } catch (e) { logger.error('AssetWorkPanel: task complete failed', e); }
    }
  }, [tasks]);

  const submitSignoff = useCallback(async () => {
    if (submitting || !signTarget) return;
    const text = note.trim();
    if (!text) {
      setResultUi({ title: 'Add a note', message: `Please describe the ${words.work} before signing off.`, error: true });
      return;
    }
    setSubmitting(true);
    try {
      const headers = await authHeaders(true);

      if (signTarget.kind === 'task') {
        // Pass a photo through so it lands on the history row the server writes.
        const shot = (shotFor[signTarget.key] || [])[0] || null;
        const body = shot ? { note: text, image_url: shot } : { note: text };
        const res = await fetch(`${API_BASE_URL}/tasks/${signTarget.id}/complete`, {
          method: 'POST', headers, body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error((await res.text()) || 'Failed to sign off the task');
      } else if (signTarget.kind === 'action') {
        const res = await fetch(`${API_BASE_URL}/assets/${assetId}/actions/${signTarget.id}/signoff`, {
          method: 'POST', headers, body: JSON.stringify({ completed: true, note: text }),
        });
        if (!res.ok) throw new Error((await res.text()) || 'Failed to sign off');
        await completeOpenTasks(headers, text);
      } else {
        await fetch(`${API_BASE_URL}/assets/${assetId}/actions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            type: kind,
            note: text,
            occurred_at: new Date().toISOString(),
            details: {
              action: kind === 'REPAIR' ? 'Repair' : 'Maintenance',
              date: toDateOnly(new Date()),
              summary: text,
            },
            data: { requires_signoff: false, completed: true },
          }),
        });
        const putRes = await fetch(`${API_BASE_URL}/assets/${assetId}`, {
          method: 'PUT', headers, body: JSON.stringify({ [flagKey]: false, skip_required_documents: true }),
        });
        if (!putRes.ok) throw new Error((await putRes.text()) || 'Failed to clear the flag');
        await completeOpenTasks(headers, text);
      }

      setSignTarget(null);
      setNote('');
      setTick((n) => n + 1);
      onChanged?.({ [flagKey]: false });
      setResultUi({ title: `${words.Work} signed off`, message: 'Recorded and closed out. It no longer shows as outstanding.' });
    } catch (e) {
      setResultUi({ title: 'Error', message: e?.message || 'Failed to sign off', error: true });
    } finally {
      setSubmitting(false);
    }
  }, [submitting, signTarget, note, assetId, kind, flagKey, words, completeOpenTasks, onChanged, shotFor]);

  const MetaRow = ({ item }) => (
    <View style={s.metaRow}>
      {item.due ? (
        <View style={s.metaItem}>
          <MaterialIcons name="event" size={13} color={Colors.sub2} />
          <Text style={s.metaText}>
            {item.kind === 'task' || item.kind === 'flag' ? `Due ${prettyDate(item.due)}` : prettyDate(item.due)}
          </Text>
        </View>
      ) : null}
      {item.lastDone ? (
        <View style={s.metaItem}>
          <MaterialIcons name="history" size={13} color={Colors.sub2} />
          <Text style={s.metaText}>Last done {prettyDate(item.lastDone)}</Text>
        </View>
      ) : null}
      {/* Priority lives in the chip beside the title — not repeated here. */}
      {item.who ? (
        <View style={s.metaItem}><MaterialIcons name="person" size={13} color={Colors.sub2} /><Text style={s.metaText} numberOfLines={1}>{item.who}</Text></View>
      ) : null}
      {item.cost && Number(item.cost) > 0 ? (
        <View style={s.metaItem}><MaterialIcons name="payments" size={13} color={Colors.sub2} /><Text style={s.metaText}>{Number(item.cost).toFixed(2)}</Text></View>
      ) : null}
    </View>
  );

  return (
    <>
      {/* ── Current work ─────────────────────────────────────────────────── */}
      <View style={s.section}>
        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>{words.current}</Text>
          {currentWork.length ? <View style={s.countChip}><Text style={s.countText}>{currentWork.length}</Text></View> : null}
        </View>

        {loading ? (
          <View style={s.loadingBox}><ActivityIndicator color={Colors.primary} /></View>
        ) : currentWork.length === 0 ? (
          <View style={s.emptyBox}>
            <MaterialIcons name="check-circle-outline" size={18} color={Colors.successFg} />
            <Text style={s.emptyText}>Nothing outstanding — no open {words.work} for this asset.</Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {currentWork.map((item) => {
              const shots = photosFor(item);
              return (
                <View key={item.key} style={s.workCard}>
                  <View style={s.workTop}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.workTitle} numberOfLines={2}>{item.title}</Text>
                      {item.detail ? <Text style={s.workDetail} numberOfLines={3}>{item.detail}</Text> : null}
                    </View>
                    {item.priority ? (
                      <View style={[s.kindChip, priorityChip(item.priority).box]}>
                        <Text style={[s.kindChipText, priorityChip(item.priority).text]}>{cap(item.priority)}</Text>
                      </View>
                    ) : item.kind === 'action' ? (
                      <View style={[s.kindChip, s.kindAction]}>
                        <Text style={s.kindChipText}>Awaiting sign-off</Text>
                      </View>
                    ) : null}
                  </View>

                  {(() => {
                    const ds = item.kind === 'history' ? null : dueStatus(item.due);
                    return ds ? (
                      <View style={[s.duePill, ds.overdue ? s.duePillOver : s.duePillSoon]}>
                        <MaterialIcons
                          name={ds.overdue ? 'error-outline' : 'schedule'}
                          size={13}
                          color={ds.overdue ? Colors.dangerFg : Colors.infoFg}
                        />
                        <Text style={[s.duePillText, { color: ds.overdue ? Colors.dangerFg : Colors.infoFg }]}>{ds.text}</Text>
                      </View>
                    ) : null;
                  })()}

                  <MetaRow item={item} />

                  {shots.length ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                      {shots.slice(0, 8).map((p) => (
                        <Image key={p.url} source={{ uri: p.url }} style={s.thumb} resizeMode="cover" />
                      ))}
                    </ScrollView>
                  ) : null}

                  {/* View / Edit / Sign off — equal widths across one row.
                      Photos are managed inside Edit. */}
                  <View style={s.btnRow}>
                    <TouchableOpacity style={s.rowBtnGhost} activeOpacity={0.85} onPress={() => setViewItem(item)}>
                      <MaterialIcons name="visibility" size={15} color={Colors.text} />
                      <Text style={s.rowBtnGhostText}>View</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={s.rowBtnGhost} activeOpacity={0.85} onPress={() => openEdit(item)}>
                      <MaterialIcons name="edit" size={15} color={Colors.text} />
                      <Text style={s.rowBtnGhostText}>Edit</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={s.rowBtnSign}
                      activeOpacity={0.85}
                      onPress={() => { setNote(''); setSignTarget(item); }}
                    >
                      <MaterialIcons name="check-circle" size={15} color="#fff" />
                      <Text style={s.rowBtnSignText}>Sign off</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* ── History ──────────────────────────────────────────────────────── */}
      <View style={s.section}>
        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>{words.history}</Text>
          {history.length ? <View style={s.countChip}><Text style={s.countText}>{history.length}</Text></View> : null}
        </View>

        {loading ? (
          <View style={s.loadingBox}><ActivityIndicator color={Colors.primary} /></View>
        ) : history.length === 0 ? (
          <View style={s.emptyBox}>
            <MaterialIcons name="history" size={18} color={Colors.sub2} />
            <Text style={s.emptyText}>No {words.work} recorded yet.</Text>
          </View>
        ) : (
          <View style={s.historyCard}>
            {history.map((a, i) => {
              const scheduled = a.data?.scheduled === true && a.data?.completed !== true;
              const imgs = Array.isArray(a.data?.images) ? a.data.images : [];
              const item = {
                key: `hist-${a.id}`, kind: 'history', raw: a,
                title: a.details?.summary || a.note || words.Work,
                detail: a.details?.notes,
                due: a.details?.date || a.occurred_at,
                priority: a.details?.priority,
                who: a.performer?.name,
                cost: a.details?.estimated_cost,
                images: imgs,
                scheduled,
              };
              return (
                <TouchableOpacity
                  key={a.id}
                  activeOpacity={0.7}
                  onPress={() => setViewItem(item)}
                  style={[s.histRow, i > 0 && s.histRowBorderTop]}
                >
                  <View style={[s.histDot, scheduled ? s.histDotSched : s.histDotDone]} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={s.histTopRow}>
                      <Text style={s.histTitle} numberOfLines={2}>{item.title}</Text>
                      {scheduled ? <Text style={s.histSched}>Scheduled</Text> : null}
                      {imgs.length ? <MaterialIcons name="photo" size={14} color={Colors.sub2} /> : null}
                    </View>
                    {item.detail ? <Text style={s.histNotes} numberOfLines={2}>{item.detail}</Text> : null}
                    <MetaRow item={item} />
                  </View>
                  <MaterialIcons name="chevron-right" size={20} color={Colors.sub2} />
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      {/* ── View: full details ───────────────────────────────────────────── */}
      <Modal visible={!!viewItem} transparent animationType="fade" onRequestClose={() => setViewItem(null)}>
        <View style={s.backdrop}>
          <View style={s.sheet}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle} numberOfLines={2}>{viewItem?.title}</Text>
              <TouchableOpacity onPress={() => setViewItem(null)} style={s.sheetClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MaterialIcons name="close" size={20} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ padding: 16, gap: 4 }}>
              {viewItem ? (
                <>
                  <DetailRow label="Status" value={
                    viewItem.kind === 'task' ? 'Reported — still open'
                      : viewItem.kind === 'action' ? 'Awaiting sign-off'
                      : viewItem.kind === 'history' ? (viewItem.scheduled ? 'Scheduled' : 'Completed')
                      : 'Due'
                  } />
                  {viewItem.detail ? <DetailRow label="Details" value={viewItem.detail} /> : null}
                  {viewItem.due ? <DetailRow label={viewItem.kind === 'task' || viewItem.kind === 'flag' ? 'Due' : 'Date'} value={prettyDate(viewItem.due)} /> : null}
                  {viewItem.lastDone ? <DetailRow label={`Last ${words.work}`} value={prettyDate(viewItem.lastDone)} /> : null}
                  {viewItem.priority ? <DetailRow label="Priority" value={cap(viewItem.priority)} /> : null}
                  {viewItem.who ? <DetailRow label="Performed by" value={viewItem.who} /> : null}
                  {viewItem.cost && Number(viewItem.cost) > 0 ? <DetailRow label="Cost" value={Number(viewItem.cost).toFixed(2)} /> : null}
                  {viewItem.raw?.category ? <DetailRow label="Category" value={cap(viewItem.raw.category)} /> : null}
                  {viewItem.raw?.creatorName ? <DetailRow label="Raised by" value={viewItem.raw.creatorName} /> : null}
                  {viewItem.raw?.created_at || viewItem.created ? (
                    <DetailRow label="Raised" value={prettyDate(viewItem.raw?.created_at || viewItem.created)} />
                  ) : null}
                  {viewItem.raw?.completion_note ? <DetailRow label="Sign-off note" value={viewItem.raw.completion_note} /> : null}
                  {viewItem.raw?.data?.signed_off_note ? <DetailRow label="Sign-off note" value={viewItem.raw.data.signed_off_note} /> : null}
                  {viewItem.raw?.data?.signed_off_at ? <DetailRow label="Signed off" value={prettyDate(viewItem.raw.data.signed_off_at)} /> : null}

                  <Text style={[s.detailLabel, { marginTop: 12 }]}>Photos</Text>
                  {photosFor(viewItem).length ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 6 }}>
                      {photosFor(viewItem).map((p) => (
                        <Image key={p.url} source={{ uri: p.url }} style={s.bigPhoto} resizeMode="cover" />
                      ))}
                    </ScrollView>
                  ) : (
                    <Text style={s.detailValue}>No photos attached.</Text>
                  )}
                </>
              ) : null}
            </ScrollView>

            <View style={s.sheetFoot}>
              {viewItem && viewItem.kind !== 'history' ? (
                <TouchableOpacity style={s.footBtnGhost} onPress={() => { const it = viewItem; setViewItem(null); openEdit(it); }}>
                  <MaterialIcons name="edit" size={15} color={Colors.text} />
                  <Text style={s.footBtnGhostText}>Edit</Text>
                </TouchableOpacity>
              ) : null}
              <View style={{ flex: 1 }} />
              <TouchableOpacity style={s.footBtnPrimary} onPress={() => setViewItem(null)}>
                <Text style={s.footBtnPrimaryText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Edit (tasks only) ────────────────────────────────────────────── */}
      <Modal visible={!!editItem} transparent animationType="fade" onRequestClose={() => setEditItem(null)}>
        <View style={s.backdrop}>
          <View style={s.sheet}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>Edit {words.work}</Text>
              <TouchableOpacity onPress={() => setEditItem(null)} style={s.sheetClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MaterialIcons name="close" size={20} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ padding: 16 }}>
              {editItem?.kind === 'task' ? (
                <>
                  <Text style={s.fieldLabel}>Title *</Text>
                  <TextInput style={s.input} value={eTitle} onChangeText={setETitle} maxLength={200} placeholderTextColor={Colors.muted} />

                  <Text style={s.fieldLabel}>Description</Text>
                  <TextInput
                    style={[s.input, s.inputTall]}
                    value={eDetail}
                    onChangeText={setEDetail}
                    multiline
                    maxLength={2000}
                    placeholder="Optional"
                    placeholderTextColor={Colors.muted}
                  />

                  <Text style={s.fieldLabel}>Priority</Text>
                  <View style={s.chipRow}>
                    {PRIORITIES.map((p) => (
                      <TouchableOpacity
                        key={p}
                        style={[s.chip, ePriority === p && (p === 'HIGH' ? s.chipDanger : s.chipOn)]}
                        onPress={() => setEPriority(p)}
                      >
                        <Text style={[s.chipText, ePriority === p && s.chipTextOn]}>{cap(p)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={s.fieldLabel}>Due date</Text>
                  <View style={s.dateRow}>
                    <TouchableOpacity style={[s.dateInput, { flex: 1 }]} onPress={() => setEDateOpen(true)}>
                      <MaterialIcons name="event" size={18} color={Colors.sub} />
                      <Text style={[s.dateText, !eDue && { color: Colors.muted }]}>{eDue ? prettyDate(eDue) : 'No date set'}</Text>
                    </TouchableOpacity>
                    {eDue ? (
                      <TouchableOpacity onPress={() => setEDue(null)} style={s.clearBtn}><Text style={s.clearText}>Clear</Text></TouchableOpacity>
                    ) : null}
                  </View>
                  <DatePickerModal
                    locale="en-GB"
                    mode="single"
                    visible={eDateOpen}
                    onDismiss={() => setEDateOpen(false)}
                    date={eDue ? new Date(eDue) : new Date()}
                    onConfirm={({ date }) => { setEDateOpen(false); setEDue(toDateOnly(date)); }}
                  />
                </>
              ) : (
                <Text style={s.fieldHint}>
                  {editItem?.kind === 'action'
                    ? 'This is a recorded entry — its details can’t be changed, but you can manage its photos below.'
                    : 'There are no details to edit here, but you can attach photos below.'}
                </Text>
              )}

              {/* Photos — add, replace or remove. Saved as you go. */}
              <Text style={s.fieldLabel}>Photos ({photosFor(editItem).length}/{MAX_PHOTOS})</Text>
              <View style={s.photoGrid}>
                {photosFor(editItem).map((p) => (
                  <View key={p.url} style={s.photoTile}>
                    <Image source={{ uri: p.url }} style={s.photoTileImg} resizeMode="cover" />
                    {busyPhoto === p.docId ? (
                      <View style={s.photoBusy}><ActivityIndicator color="#fff" /></View>
                    ) : null}
                    {p.docId ? (
                      <>
                        <TouchableOpacity
                          style={s.photoRemove}
                          onPress={() => removePhoto(p)}
                          disabled={!!busyPhoto}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <MaterialIcons name="close" size={14} color="#fff" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={s.photoReplace}
                          onPress={() => replacePhoto(p, editItem)}
                          disabled={!!busyPhoto}
                        >
                          <Text style={s.photoReplaceText}>Replace</Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <View style={s.photoLocked}><Text style={s.photoReplaceText}>On record</Text></View>
                    )}
                  </View>
                ))}

                {photosFor(editItem).length < MAX_PHOTOS ? (
                  <TouchableOpacity
                    style={s.photoAdd}
                    onPress={() => addPhotos(editItem, MAX_PHOTOS - photosFor(editItem).length)}
                    disabled={!!busyPhoto}
                    activeOpacity={0.85}
                  >
                    {busyPhoto === 'add' ? (
                      <ActivityIndicator color={Colors.primary} />
                    ) : (
                      <>
                        <MaterialIcons name="add-a-photo" size={20} color={Colors.primary} />
                        <Text style={s.photoAddText}>Add</Text>
                      </>
                    )}
                  </TouchableOpacity>
                ) : null}
              </View>
              <Text style={s.fieldHint}>
                {photosFor(editItem).length >= MAX_PHOTOS
                  ? `Limit of ${MAX_PHOTOS} photos reached — remove one to add another.`
                  : `Pick several at once, up to ${MAX_PHOTOS}. Photos are saved to this asset as soon as you add them.`}
              </Text>
            </ScrollView>

            <View style={s.sheetFoot}>
              <View style={{ flex: 1 }} />
              {editItem?.kind === 'task' ? (
                <>
                  <TouchableOpacity style={s.footBtnGhost} onPress={() => setEditItem(null)} disabled={submitting}>
                    <Text style={s.footBtnGhostText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.footBtnPrimary, submitting && { opacity: 0.6 }]} onPress={saveEdit} disabled={submitting}>
                    {submitting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.footBtnPrimaryText}>Save</Text>}
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity style={s.footBtnPrimary} onPress={() => setEditItem(null)}>
                  <Text style={s.footBtnPrimaryText}>Done</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* Sign-off sheet — a note is required (the tasks API rejects an empty one) */}
      <ConfirmModal
        visible={!!signTarget}
        phase="confirm"
        title={`Sign off ${words.work}`}
        message={signTarget?.title || ''}
        confirmLabel={submitting ? 'Signing off…' : 'Sign off'}
        cancelLabel="Cancel"
        onConfirm={submitSignoff}
        onCancel={() => { if (!submitting) { setSignTarget(null); setNote(''); } }}
        onDismiss={() => { if (!submitting) { setSignTarget(null); setNote(''); } }}
      >
        <View style={{ marginTop: 10 }}>
          <Text style={s.fieldLabel}>What was done? *</Text>
          <TextInput
            style={[s.input, s.inputTall]}
            placeholder={kind === 'REPAIR' ? 'e.g. Replaced the screen and tested' : 'e.g. Serviced and calibrated'}
            placeholderTextColor={Colors.muted}
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={2000}
          />
          <Text style={s.fieldHint}>This closes the {words.work} and completes the task it raised.</Text>
        </View>
      </ConfirmModal>

      <ConfirmModal
        visible={!!resultUi}
        phase="result"
        title={resultUi?.title || ''}
        message={resultUi?.message || ''}
        resultError={!!resultUi?.error}
        onConfirm={() => setResultUi(null)}
        onCancel={() => setResultUi(null)}
        onDismiss={() => setResultUi(null)}
      />
    </>
  );
}

function DetailRow({ label, value }) {
  return (
    <View style={s.detailRow}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={s.detailValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  section: { gap: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  sectionTitle: { fontSize: sf(13), fontWeight: '800', color: Colors.sub, textTransform: 'uppercase', letterSpacing: 0.5 },
  countChip: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: sf(11), fontWeight: '900', color: Colors.primary },

  loadingBox: { paddingVertical: 20, alignItems: 'center' },
  emptyBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderRadius: Radius.lg, borderWidth: 2, borderColor: Colors.line, backgroundColor: Colors.card },
  emptyText: { flex: 1, fontSize: sf(12.5), color: Colors.sub, fontWeight: '600' },

  workCard: { padding: 14, borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.lg, backgroundColor: Colors.card, gap: 10, ...Shadows.card },
  workTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  workTitle: { fontSize: sf(14.5), fontWeight: '800', color: Colors.text },
  workDetail: { fontSize: sf(12.5), color: Colors.sub, marginTop: 3, lineHeight: sf(17) },
  kindChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  kindTask: { backgroundColor: Colors.infoBg, borderColor: Colors.infoBorder },
  kindAction: { backgroundColor: Colors.warningBg, borderColor: Colors.warningBorder },
  kindFlag: { backgroundColor: Colors.dangerBg, borderColor: Colors.dangerBorder },
  kindChipText: { fontSize: sf(10.5), fontWeight: '800', color: Colors.text },
  prioHigh: { backgroundColor: Colors.dangerBg, borderColor: Colors.dangerBorder },
  prioHighText: { color: Colors.dangerFg },
  prioMed: { backgroundColor: Colors.warningBg, borderColor: Colors.warningBorder },
  prioMedText: { color: Colors.warningFg },
  prioLow: { backgroundColor: Colors.chip, borderColor: Colors.line },
  prioLowText: { color: Colors.sub },

  duePill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
  duePillOver: { backgroundColor: Colors.dangerBg, borderColor: Colors.dangerBorder },
  duePillSoon: { backgroundColor: Colors.infoBg, borderColor: Colors.infoBorder },
  duePillText: { fontSize: sf(12), fontWeight: '800' },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: sf(12), color: Colors.sub2, fontWeight: '600' },

  thumb: { width: 54, height: 54, borderRadius: 8, backgroundColor: Colors.chip },
  bigPhoto: { width: 220, height: 220, borderRadius: 12, backgroundColor: Colors.chip },

  // Equal thirds: same flex basis and height, so View / Edit / Sign off match exactly.
  btnRow: { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  rowBtnGhost: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height: 42, paddingHorizontal: 8, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.line, backgroundColor: Colors.chip },
  rowBtnGhostText: { fontSize: sf(12.5), fontWeight: '800', color: Colors.text },
  rowBtnSign: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height: 42, paddingHorizontal: 8, borderRadius: Radius.md, backgroundColor: Colors.successFg },
  rowBtnSignText: { fontSize: sf(12.5), fontWeight: '800', color: '#fff' },

  // Modal footer buttons — matched heights.
  footBtnGhost: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height: 42, paddingHorizontal: 18, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.line, backgroundColor: Colors.chip },
  footBtnGhostText: { fontSize: sf(13), fontWeight: '800', color: Colors.text },
  footBtnPrimary: { alignItems: 'center', justifyContent: 'center', height: 42, paddingHorizontal: 22, borderRadius: Radius.md, backgroundColor: Colors.primary },
  footBtnPrimaryText: { color: '#fff', fontWeight: '800', fontSize: sf(13) },

  // Photo manager (inside Edit)
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoTile: { width: 96, height: 96, borderRadius: 10, overflow: 'hidden', backgroundColor: Colors.chip, borderWidth: 1.5, borderColor: Colors.line },
  photoTileImg: { width: '100%', height: '100%' },
  photoBusy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  photoRemove: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  photoReplace: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingVertical: 5, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center' },
  photoLocked: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingVertical: 5, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center' },
  photoReplaceText: { color: '#fff', fontSize: sf(10.5), fontWeight: '800' },
  photoAdd: { width: 96, height: 96, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.line, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', gap: 4 },
  photoAddText: { fontSize: sf(11.5), fontWeight: '800', color: Colors.primary },

  historyCard: { borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.lg, backgroundColor: Colors.card, overflow: 'hidden' },
  histRow: { flexDirection: 'row', gap: 10, padding: 14, alignItems: 'center' },
  histRowBorderTop: { borderTopWidth: 1, borderTopColor: Colors.line },
  histDot: { width: 9, height: 9, borderRadius: 4.5, marginTop: 5, alignSelf: 'flex-start' },
  histDotDone: { backgroundColor: Colors.successFg },
  histDotSched: { backgroundColor: Colors.infoFg },
  histTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  histTitle: { flex: 1, fontSize: sf(13.5), fontWeight: '800', color: Colors.text },
  histSched: { fontSize: sf(10.5), fontWeight: '800', color: Colors.infoFg, textTransform: 'uppercase', letterSpacing: 0.4 },
  histNotes: { fontSize: sf(12.5), color: Colors.sub, marginTop: 3, marginBottom: 2, lineHeight: sf(17) },

  backdrop: { flex: 1, backgroundColor: 'rgba(28,25,23,0.5)', alignItems: 'center', justifyContent: 'center', padding: 18 },
  sheet: { width: '100%', maxWidth: 520, maxHeight: '86%', backgroundColor: Colors.card, borderRadius: Radius.lg, overflow: 'hidden', ...Shadows.card },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.line },
  sheetTitle: { flex: 1, fontSize: sf(16), fontWeight: '900', color: Colors.text },
  sheetClose: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.chip },
  sheetFoot: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: Colors.line },
  detailRow: { paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: Colors.line },
  detailLabel: { fontSize: sf(10.5), fontWeight: '800', color: Colors.sub2, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 },
  detailValue: { fontSize: sf(13.5), color: Colors.text, fontWeight: '600', lineHeight: sf(19) },

  fieldLabel: { fontSize: sf(13), fontWeight: '700', color: Colors.text, marginTop: 10, marginBottom: 6 },
  input: { borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.md, padding: 12, color: Colors.text, backgroundColor: Colors.card },
  inputTall: { height: 88, textAlignVertical: 'top' },
  fieldHint: { fontSize: sf(11), color: Colors.sub2, marginTop: 6, lineHeight: sf(16) },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1.5, borderColor: Colors.line, backgroundColor: Colors.chip },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipDanger: { backgroundColor: Colors.dangerFg, borderColor: Colors.dangerFg },
  chipText: { fontWeight: '700', color: Colors.sub, fontSize: sf(12.5) },
  chipTextOn: { color: '#fff' },

  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateInput: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.md, padding: 12, backgroundColor: Colors.card },
  dateText: { color: Colors.text, fontWeight: '600' },
  clearBtn: { paddingHorizontal: 12, paddingVertical: 12 },
  clearText: { fontSize: sf(12.5), fontWeight: '700', color: Colors.sub },
});
