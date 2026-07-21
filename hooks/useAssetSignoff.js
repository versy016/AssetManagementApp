// hooks/useAssetSignoff.js
// Drives the shared <TaskActionModal> to sign off an asset's open Needs-repair /
// Maintenance-due task straight from the check-in (scan) screen, using the exact
// same modal + backend calls as the Tasks tab. Kept separate from useTasks() so it
// doesn't run the Tasks feed load, auth watcher, or task-count writes a second time.

import { useState, useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import { auth } from '../firebaseConfig';
import { API_BASE_URL } from '../inventory-api/apiBase';
import { showError } from '../utils/showError';
import logger from '../utils/logger';

// today + N months, as YYYY-MM-DD (matches useTasks.setNextMonths behaviour).
const monthsFromNow = (m) => {
  const d = new Date();
  d.setMonth(d.getMonth() + m);
  return d.toISOString().slice(0, 10);
};

/**
 * @param {object}   asset   the asset being viewed on the check-in screen
 * @param {object}   opts
 * @param {function} opts.onDone  called after a successful sign-off with the asset
 *                                patch (e.g. `{ needs_repair: false }`) so the
 *                                caller can update state and stay on the scan menu.
 */
export function useAssetSignoff(asset, { onDone } = {}) {
  const actionScrollRef = useRef(null);
  const [actionOpen, setActionOpen] = useState(false);
  const [actionTask, setActionTask] = useState(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);

  const [dateOpen, setDateOpen] = useState(false);
  const [actionNextDate, setActionNextDate] = useState(monthsFromNow(6));
  const [actionPhoto, setActionPhoto] = useState(null);
  const [actionNote, setActionNote] = useState('');

  // Props TaskActionModal reads but that don't apply to a flag sign-off — provided
  // as inert state so the shared component renders without special-casing.
  const [actionDocPicked, setActionDocPicked] = useState(null);
  const [signoffReport, setSignoffReport] = useState(null);
  const [signoffChoice, setSignoffChoice] = useState('yes');
  const [relevantDocName, setRelevantDocName] = useState('');

  const setNextMonths = useCallback((m) => setActionNextDate(monthsFromNow(m)), []);

  const buildSubtitle = () => {
    const model = asset?.asset_types?.model || asset?.model || asset?.name || 'Asset';
    const id = asset?.asset_id ? `ID: ${asset.asset_id}` : null;
    return [model, id].filter(Boolean).join(' · ');
  };

  // Open the sign-off modal for this asset's repair or maintenance flag task.
  const open = useCallback((which) => {
    const isRepair = which === 'repair';
    const flag = isRepair ? 'needs_repair' : 'maintenance_due';
    setActionTask({
      kind: 'flag',
      flag,
      type: isRepair ? 'REPAIR' : 'MAINTENANCE',
      assetId: asset?.id,
      key: `flag:${flag}:${asset?.id}`,
      title: isRepair ? 'Sign off repair' : 'Sign off maintenance',
      subtitle: buildSubtitle(),
    });
    // reset per-open state
    setActionNote('');
    setActionPhoto(null);
    setActionDocPicked(null);
    setSignoffReport(null);
    setSignoffChoice('yes');
    setRelevantDocName('');
    setActionNextDate(monthsFromNow(6));
    setActionOpen(true);
  }, [asset?.id]);

  const handleSubmitTaskAction = useCallback(async () => {
    if (actionSubmitting || !actionTask) return;
    setActionSubmitting(true);
    try {
      const headers = { 'Content-Type': 'application/json' };
      try {
        const u = auth?.currentUser;
        if (u?.uid) {
          headers['X-User-Id'] = String(u.uid);
          headers['X-User-Email'] = u.email || '';
          headers['X-User-Name'] = u.displayName || (u.email ? u.email.split('@')[0] : '');
        }
      } catch {}

      const enumType = String(actionTask.type || '').toUpperCase() === 'REPAIR' ? 'REPAIR' : 'MAINTENANCE';
      const nowIso = new Date().toISOString();
      const note = (actionNote || '').trim();

      // 1) Log the completed work to Maintenance history (best-effort).
      try {
        await fetch(`${API_BASE_URL}/assets/${actionTask.assetId}/actions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            type: enumType,
            note: note || `${enumType === 'REPAIR' ? 'Repair' : 'Maintenance'} completed`,
            occurred_at: nowIso,
            data: { completed: true, requires_signoff: false },
            details: {
              action: enumType === 'REPAIR' ? 'Repair' : 'Maintenance',
              date: nowIso.slice(0, 10),
              summary: enumType === 'REPAIR' ? 'Repair completed' : 'Maintenance completed',
              notes: note || undefined,
            },
          }),
        });
      } catch (e) {
        logger.warn('useAssetSignoff: history log failed (non-fatal)', e?.message || e);
      }

      // 2) Clear the flag (advance next service date for maintenance).
      const patch = { [actionTask.flag]: false };
      if (actionTask.flag === 'maintenance_due' && actionNextDate) patch.next_service_date = actionNextDate;
      const putRes = await fetch(`${API_BASE_URL}/assets/${actionTask.assetId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(patch),
      });
      if (!putRes.ok) throw new Error((await putRes.text()) || 'Failed to complete task');

      // 3) Attach the work photo, if one was added (best-effort).
      if (actionPhoto?.uri) {
        try {
          const photoHeaders = { ...headers };
          delete photoHeaders['Content-Type'];
          const fd = new FormData();
          if (Platform.OS === 'web') {
            const resp = await fetch(actionPhoto.uri);
            const blob = await resp.blob();
            const file = new File([blob], actionPhoto.name || 'task-photo.jpg', {
              type: actionPhoto.mimeType || blob.type || 'image/jpeg',
            });
            fd.append('file', file, file.name);
          } else {
            fd.append('file', { uri: actionPhoto.uri, name: actionPhoto.name || 'task-photo.jpg', type: actionPhoto.mimeType || 'image/jpeg' });
          }
          const photoLabel = enumType === 'REPAIR' ? 'Repair photos' : 'Service photos';
          fd.append('title', photoLabel);
          fd.append('kind', photoLabel);
          await fetch(`${API_BASE_URL}/assets/${actionTask.assetId}/documents/upload`, { method: 'POST', headers: photoHeaders, body: fd });
        } catch (e) {
          logger.warn('useAssetSignoff: photo upload failed (non-fatal)', e?.message || e);
        }
      }

      setActionOpen(false);
      // Hand the flag patch back so the check-in screen updates + stays on the scan menu.
      onDone?.(patch);
    } catch (e) {
      showError(e, 'Please try again.', 'Failed to sign off');
    } finally {
      setActionSubmitting(false);
    }
  }, [actionSubmitting, actionTask, actionNote, actionNextDate, actionPhoto, onDone]);

  // Everything <TaskActionModal> needs, ready to spread.
  const modalProps = {
    actionScrollRef,
    actionOpen,
    setActionOpen,
    actionTask,
    dateOpen,
    setDateOpen,
    actionNextDate,
    setActionNextDate,
    setNextMonths,
    actionDocSlug: '',
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
    actionSubmitting,
    handleSubmitTaskAction,
  };

  return { open, actionOpen, modalProps };
}

export default useAssetSignoff;
