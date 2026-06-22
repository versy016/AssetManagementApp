// [id].js -- Clean Light Theme Check‑In / Transfer Screen

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  FlatList,
  Animated,
  Platform,
  ScrollView,
  InteractionManager,
  KeyboardAvoidingView,
  Switch,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import ActionsForm from '../../components/ActionsForm';
import ConfirmModal from '../../components/ui/ConfirmModal';
import StatusBadge, { normalizeStatus } from '../../components/ui/StatusBadge';
import PriorityNotesBanner from '../../components/PriorityNotesBanner';
import { getAuthHeaders } from '../../utils/authHeaders';
import { getImageFileFromPicker, ALLOWED_IMAGE_MIME_TYPES, revokeImageUri } from '../../utils/getFormFileFromPicker';
// NOTE: Avoid static import of expo-location to prevent SSR/import loops on web.
// We'll require it dynamically at runtime when needed.
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as LinkingExpo from 'expo-linking';

import { API_BASE_URL } from '../../inventory-api/apiBase';
import { FIELD_LIMITS } from '../../constants/fieldLimits';
import logger from '../../utils/logger';
import { pickOfficeInventoryAssignee } from '../../utils/ShortcutExecutor';
import { isAssetIdAwaitingQr } from '../../utils/assetId';

// True when an API row is an unused 8-char sticker (valid target for assigning an awaiting-QR import).
function isBlankPhysicalQrSticker(a) {
  if (!a) return false;
  const id = String(a.id || '');
  if (!/^[A-Z0-9]{8}$/i.test(id)) return false;
  const hasDyn = a.fields && Object.keys(a.fields || {}).length > 0;
  const status = String(a?.status || '').toLowerCase();
  return !a.serial_number && !a.model && !a.assigned_to_id && !a.type_id && !a.documentation_url && !a.image_url && !a.other_id && !hasDyn && (status === 'available');
}

// ---------- Import Theme Constants ----------
import { Colors, Radius, Shadows, sf } from '../../constants/uiTheme';

// Quick-action grid: two columns that wrap. Colour is purely positional —
// the LEFT column is always blue (filled) and the RIGHT column always orange
// (outlined), regardless of which action lands there. Pass an array of action
// descriptors; falsy entries are skipped so conditional buttons don't break the
// left/right alternation.
function QuickActionRow({ actions, styles }) {
  const items = (actions || []).filter(Boolean);
  return (
    <View style={styles.quickActionBar}>
      {items.map((a, i) => {
        const isLeft = i % 2 === 0;
        const iconColor = isLeft ? '#FFFFFF' : Colors.accent;
        return (
          <TouchableOpacity
            key={a.key || i}
            testID={a.testID}
            style={[
              styles.quickActionBtn,
              isLeft ? styles.quickActionBtnPrimary : styles.quickActionBtnSecondary,
              a.disabled ? { opacity: 0.7 } : null,
            ]}
            onPress={a.onPress}
            disabled={a.disabled}
          >
            <MaterialIcons name={a.icon} size={a.iconSize || 18} color={iconColor} />
            <Text
              style={[isLeft ? styles.quickActionBtnText : styles.quickActionBtnTextSecondary, { flexShrink: 1 }]}
              numberOfLines={a.numberOfLines || 2}
              adjustsFontSizeToFit={a.adjustsFontSizeToFit}
              minimumFontScale={a.minimumFontScale}
            >
              {a.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const badgeTone = (status) => {
  const s = String(status || '').toLowerCase();
  if (s.includes('repair')) return { bg: Colors.warningBg, fg: Colors.warningFg };
  if (s.includes('maintenance')) return { bg: Colors.infoBg, fg: Colors.infoFg };
  if (s.includes('end of life')) return { bg: Colors.dangerBg, fg: Colors.dangerFg };
  if (s.includes('in service')) return { bg: Colors.successBg, fg: Colors.successFg };
  return { bg: Colors.chip, fg: Colors.sub };
};

// Short, locale-friendly "last updated" formatting (12-hour clock).
const fmtWhen = (iso) => {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let h = d.getHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${String(d.getDate()).padStart(2, '0')} ${m[d.getMonth()]} ${d.getFullYear()}, ${h}:${mm} ${ampm}`;
  } catch { return ''; }
};

const Chip = ({ label, tone }) => (
  <View style={[styles.chip, { backgroundColor: tone?.bg, borderColor: Colors.line }]}>
    <Text style={[styles.chipText, { color: tone?.fg }]}>{label}</Text>
  </View>
);

const AvatarCircle = ({ name, email }) => {
  const initials = useMemo(() => {
    const source = name || email || '?';
    const matches = source
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((x) => x[0]?.toUpperCase())
      .join('');
    return matches || '?';
  }, [name, email]);
  return (
    <View style={styles.avatar}>
      <Text style={{ color: Colors.text, fontWeight: '700' }}>{initials}</Text>
    </View>
  );
};

// Asset image with an inline add/replace flow, shown inside the asset card.
// When there is no image it shows a clear placeholder plus an Add-image button;
// after a successful upload it offers to jump back to the scanner.
const AssetImageBlock = ({ imageUrl, uploading, justAdded, onAdd, onScanAnother, canAdd = true }) => (
  <View style={ab.wrap}>
    <View style={ab.imageBox}>
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={ab.image} resizeMode="contain" />
      ) : (
        <View style={ab.noImage}>
          <MaterialIcons name="image-not-supported" size={32} color={Colors.sub2} />
          <Text style={ab.noImageText}>No image available</Text>
        </View>
      )}
      {uploading ? (
        <View style={ab.overlay} pointerEvents="none">
          <ActivityIndicator color="#fff" />
          <Text style={ab.overlayText}>Uploading…</Text>
        </View>
      ) : null}
    </View>

    {justAdded ? (
      <View style={ab.addedRow}>
        <View style={ab.addedBanner}>
          <MaterialIcons name="check-circle" size={15} color={Colors.successFg} />
          <Text style={ab.addedText}>Image added</Text>
        </View>
        <TouchableOpacity style={ab.scanBtn} onPress={onScanAnother} activeOpacity={0.85}>
          <MaterialIcons name="qr-code-scanner" size={15} color={Colors.primary} />
          <Text style={ab.scanText}>Scan another</Text>
        </TouchableOpacity>
      </View>
    ) : (!imageUrl && canAdd) ? (
      // Only offer Add when there is no image — no replace control once set.
      <TouchableOpacity
        style={[ab.addBtn, uploading && { opacity: 0.6 }]}
        onPress={onAdd}
        disabled={uploading}
        activeOpacity={0.85}
      >
        <MaterialIcons name="add-a-photo" size={16} color="#fff" />
        <Text style={ab.addText}>Add image</Text>
      </TouchableOpacity>
    ) : null}
  </View>
);

// Priority-note toggle styling (banner itself is the shared PriorityNotesBanner).
const pn = StyleSheet.create({
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: Radius.md, borderWidth: 2, borderColor: Colors.line, backgroundColor: Colors.card },
  toggleRowOn: { borderColor: Colors.dangerFg, backgroundColor: Colors.dangerBg },
  toggleLabel: { fontSize: sf(15), fontWeight: '800', color: Colors.text },
  toggleHint: { fontSize: sf(12), color: Colors.sub, marginTop: 2, lineHeight: sf(16) },
});

// A single label / value detail row — icon, muted uppercase label, bold value.
// `highlight` gives the row an accent-tinted band (used for Assigned).
const DetailRow = ({ icon, label, value, last, highlight, valueLines = 3 }) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return (
    <View style={[dl.row, highlight && dl.rowHi, last && !highlight && { borderBottomWidth: 0 }]}>
      <MaterialIcons name={icon} size={15} color={highlight ? Colors.accent : Colors.sub2} style={dl.rowIcon} />
      <Text style={[dl.label, highlight && { color: Colors.accentDark }]}>{label}</Text>
      <Text style={[dl.value, highlight && dl.valueHi]} numberOfLines={valueLines}>{String(value)}</Text>
    </View>
  );
};

// Description row with a "See more / See less" toggle for long text.
const DescriptionRow = ({ value }) => {
  const [expanded, setExpanded] = useState(false);
  const v = value == null ? '' : String(value).trim();
  if (!v) return null;
  const longish = v.length > 100; // roughly more than ~2 lines
  return (
    <View style={dl.row}>
      <MaterialIcons name="notes" size={15} color={Colors.sub2} style={dl.rowIcon} />
      <Text style={dl.label}>Description</Text>
      <View style={{ flex: 1 }}>
        <Text style={dl.value} numberOfLines={expanded ? undefined : 2}>{v}</Text>
        {longish ? (
          <TouchableOpacity onPress={() => setExpanded((x) => !x)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Text style={dl.seeMore}>{expanded ? 'See less' : 'See more'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

const dl = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 2 },
  titleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  seeMore: { color: Colors.accent, fontWeight: '800', fontSize: sf(12), marginTop: 3 },
  title: { fontSize: sf(17), fontWeight: '900', color: Colors.text },
  idChip: { backgroundColor: Colors.primary, paddingHorizontal: 7, paddingVertical: 2, borderRadius: Radius.sm },
  idChipText: { color: '#fff', fontSize: sf(10), fontWeight: '800', letterSpacing: 0.5 },
  list: { marginTop: 6, borderTopWidth: 1, borderTopColor: Colors.line },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 5, gap: 10, borderBottomWidth: 1, borderBottomColor: Colors.line },
  rowHi: { backgroundColor: Colors.accentMuted, borderBottomWidth: 0, borderRadius: 8, paddingHorizontal: 8, marginVertical: 3 },
  rowIcon: { width: 19, marginTop: 1 },
  label: { width: 86, fontSize: sf(10), fontWeight: '800', color: Colors.sub2, textTransform: 'uppercase', letterSpacing: 0.4, paddingTop: 1 },
  value: { flex: 1, fontSize: sf(14), fontWeight: '700', color: Colors.text, lineHeight: sf(18) },
  valueHi: { color: Colors.accentDark, fontWeight: '900' },
});

const ab = StyleSheet.create({
  wrap: { marginBottom: 8, gap: 7 },
  imageBox: {
    height: 200, borderRadius: Radius.md, borderWidth: 2, borderColor: Colors.line,
    backgroundColor: Colors.card, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  noImage: { alignItems: 'center', justifyContent: 'center', gap: 6 },
  noImageText: { color: Colors.sub2, fontWeight: '700', fontSize: sf(13) },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', gap: 6 },
  overlayText: { color: '#fff', fontWeight: '700' },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 11, borderRadius: Radius.md, backgroundColor: Colors.accent },
  addText: { color: '#fff', fontWeight: '800', fontSize: sf(14) },
  replaceBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10, borderRadius: Radius.md, borderWidth: 2, borderColor: Colors.line, backgroundColor: Colors.chip },
  replaceText: { color: Colors.text, fontWeight: '800', fontSize: sf(13) },
  addedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addedBanner: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 10, borderRadius: Radius.md, backgroundColor: Colors.successBg, borderWidth: 1, borderColor: Colors.successFg },
  addedText: { color: Colors.successFg, fontWeight: '800', fontSize: sf(13) },
  scanBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 12, borderRadius: Radius.md, borderWidth: 2, borderColor: Colors.primary, backgroundColor: Colors.card },
  scanText: { color: Colors.primary, fontWeight: '800', fontSize: sf(13) },
});

// ---------- Main Screen ----------
export default function CheckInScreen() {
  const { id, returnTo } = useLocalSearchParams(); // Get asset ID and return URL from route params
  const router = useRouter();

  // State for loading spinner
  const [loading, setLoading] = useState(true);
  // State for current user info
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  // State for asset details
  const [asset, setAsset] = useState(null);
  // Inline asset-image add/replace state
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageJustAdded, setImageJustAdded] = useState(false);
  // State for error messages
  const [error, setError] = useState(null);
  // State for user selection modal
  const [showUserModal, setShowUserModal] = useState(false);
  const [users, setUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [myUserId, setMyUserId] = useState(null);
  const nameForUser = (dbUserId) => {
    const u = users.find(x => x.id === dbUserId);
    return (u?.name || u?.useremail || (dbUserId ? `User ${dbUserId}` : 'Unassigned'));
  };

  // ── Inline asset-image add / replace ───────────────────────────────────
  const uploadAssetImage = async (picked) => {
    const aid = asset?.id || id;
    if (!picked || !aid) return;
    setUploadingImage(true);
    try {
      const fd = new FormData();
      if (picked.file && typeof File !== 'undefined' && picked.file instanceof File) {
        fd.append('image', picked.file, picked.file.name || 'upload.jpg');
      } else if (picked.uri) {
        fd.append('image', { uri: picked.uri, name: picked.name || 'upload.jpg', type: picked.type || 'image/jpeg' });
      } else {
        throw new Error('Could not read the selected image.');
      }
      const headers = await getAuthHeaders(); // no Content-Type → multipart boundary auto-set
      const res = await fetch(`${API_BASE_URL}/assets/${encodeURIComponent(aid)}/files`, { method: 'PUT', headers, body: fd });
      if (!res.ok) throw new Error((await res.text()) || `Upload failed (HTTP ${res.status}).`);
      try {
        const r = await fetch(`${API_BASE_URL}/assets/${encodeURIComponent(aid)}`);
        if (r.ok) {
          const fresh = await r.json();
          setAsset((prev) => ({ ...(prev || {}), ...fresh }));
        }
      } catch { /* upload already succeeded */ }
      setImageJustAdded(true);
    } catch (e) {
      Alert.alert('Could not add image', e?.message || 'Please try again.');
    } finally {
      try { revokeImageUri(picked?.uri); } catch { /* ignore */ }
      setUploadingImage(false);
    }
  };

  const addAssetImage = async () => {
    if (uploadingImage) return;
    try {
      if (Platform.OS === 'web') {
        const result = await getImageFileFromPicker();
        if (result) await uploadAssetImage(result);
        return;
      }
      Alert.alert('Add asset image', 'Choose how to add a photo of this asset.', [
        {
          text: 'Take Photo',
          onPress: async () => {
            const { status } = await ImagePicker.requestCameraPermissionsAsync();
            if (status !== 'granted') { Alert.alert('Permission required', 'Camera permission is required to take photos.'); return; }
            const { assets, canceled } = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.7 });
            if (canceled || !assets?.length) return;
            const a = assets[0];
            const type = (a.mimeType || 'image/jpeg').replace(/jpg/i, 'jpeg');
            if (!ALLOWED_IMAGE_MIME_TYPES.includes(type)) { Alert.alert('Unsupported image', 'Please use a JPG, PNG or WEBP image.'); return; }
            const name = a.fileName || `photo_${Date.now()}.jpg`;
            await uploadAssetImage({ uri: a.uri, file: { uri: a.uri, name, type }, name, type });
          },
        },
        {
          text: 'Choose from Library',
          onPress: async () => { const result = await getImageFileFromPicker(); if (result) await uploadAssetImage(result); },
        },
        { text: 'Cancel', style: 'cancel' },
      ], { cancelable: true });
    } catch (e) {
      Alert.alert('Could not add image', e?.message || 'Please try again.');
    }
  };

  const goToScanner = () => {
    try { router.replace('/qr-scanner'); } catch { router.push('/qr-scanner'); }
  };
  const [postActionUi, setPostActionUi] = useState(null); // { title, message, onGo, onStay }
  const [showOtherModal, setShowOtherModal] = useState(false);
  const [actionsFormOpen, setActionsFormOpen] = useState(false);
  const [actionsFormType, setActionsFormType] = useState(null);
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapIdInput, setSwapIdInput] = useState('');
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupResults, setLookupResults] = useState([]);
  const [lookupSelected, setLookupSelected] = useState(null);
  const [allAssets, setAllAssets] = useState([]);
  const swapScrollRef = useRef(null);
  const lookupSectionYRef = useRef(0);
  const modelYRef = useRef(0);
  const typeYRef = useRef(0);
  const assignedYRef = useRef(0);
  const [lookupFocus, setLookupFocus] = useState(null); // 'model' | 'type' | 'assigned'
  // Assign Imported Asset modal state
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignQuery, setAssignQuery] = useState('');
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignResults, setAssignResults] = useState([]);
  const [assignSelected, setAssignSelected] = useState(null);
  // When true, immediately open user picker after assigning imported asset and prevent dismiss
  const [forceUserAssign, setForceUserAssign] = useState(false);
  // Pick a blank physical QR (8-char id) to attach an imported "awaiting QR" asset (UUID id)
  const [assignPhysicalOpen, setAssignPhysicalOpen] = useState(false);
  const [assignPhysicalQuery, setAssignPhysicalQuery] = useState('');
  const [assignPhysicalList, setAssignPhysicalList] = useState([]);
  const [assignPhysicalSelected, setAssignPhysicalSelected] = useState(null);
  const [assignPhysicalLoading, setAssignPhysicalLoading] = useState(false);
  // Free-form action note captured during check-in/transfer
  const [actionNote, setActionNote] = useState('');
  // Create note only (no transfer): show input and submit to POST /assets/:id/actions
  const [showCreateNoteInput, setShowCreateNoteInput] = useState(false);
  const [createNoteText, setCreateNoteText] = useState('');
  const [createNoteImportant, setCreateNoteImportant] = useState(false);
  const [createNoteSubmitting, setCreateNoteSubmitting] = useState(false);
  // Priority (pinned) notes shown prominently on this asset.
  const [priorityNotes, setPriorityNotes] = useState([]);
  const loadPriorityNotes = useCallback(async () => {
    const aid = asset?.id || id;
    if (!aid) return;
    try {
      const res = await fetch(`${API_BASE_URL}/assets/${encodeURIComponent(aid)}/actions`);
      if (!res.ok) return;
      const j = await res.json();
      const arr = Array.isArray(j?.actions) ? j.actions : [];
      const notes = arr
        .filter((a) => a?.data?.important && typeof a?.data?.user_note_text === 'string' && a.data.user_note_text.trim())
        .map((a) => ({
          id: a.id,
          note: a.data.user_note_text.trim(),
          who: a.performer?.name || a.performer?.useremail || a.performed_by || 'System',
        }));
      setPriorityNotes(notes);
    } catch { /* non-fatal */ }
  }, [asset?.id, id]);
  useEffect(() => { loadPriorityNotes(); }, [loadPriorityNotes]);

  // Demote a priority note back to a normal note (kept, just unpinned).
  const removePriorityNote = useCallback(() => {
    const aid = asset?.id || id;
    if (!aid) return;
    Alert.alert(
      'Make this a normal note?',
      'It will no longer be a priority note.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Make normal',
          onPress: async () => {
            try {
              const auth = getAuth();
              const headers = {};
              const u = auth?.currentUser;
              if (u?.uid) headers['X-User-Id'] = u.uid;
              try {
                if (u && typeof u.getIdToken === 'function') {
                  const token = await u.getIdToken();
                  if (token) headers.Authorization = `Bearer ${token}`;
                }
              } catch {}
              const res = await fetch(`${API_BASE_URL}/assets/${encodeURIComponent(aid)}/priority-note`, { method: 'DELETE', headers });
              if (!res.ok) throw new Error(await res.text());
              loadPriorityNotes();
            } catch (e) {
              Alert.alert('Error', e.message || 'Failed to update note');
            }
          },
        },
      ]
    );
  }, [asset?.id, id, loadPriorityNotes]);

  // EOL detection: hide actions for decommissioned QRs
  const isEOL = React.useMemo(() => {
    const s = String(asset?.status || '').toLowerCase();
    return s === 'end of life';
  }, [asset]);

  /** True only when assignee is the designated office inventory user (not "any admin"). */
  const isAssignedToOffice = React.useMemo(() => {
    try {
      if (!asset?.assigned_to_id) return false;
      const aid = String(asset.assigned_to_id);
      const officeUser = pickOfficeInventoryAssignee(users);
      return !!(officeUser?.id && String(officeUser.id) === aid);
    } catch {
      return false;
    }
  }, [asset?.assigned_to_id, users]);
  // Multi-scan context parsed from returnTo
  const multiScanCtx = useMemo(() => {
    if (!returnTo) return null;
    try {
      const url = new URL('https://x' + String(returnTo));
      const itemsRaw = url.searchParams.get('items') || '[]';
      const checkedRaw = url.searchParams.get('checkedIn') || '[]';
      const items = JSON.parse(decodeURIComponent(itemsRaw));
      const checked = JSON.parse(decodeURIComponent(checkedRaw));
      const allChecked = Array.isArray(items) && items.length > 0 && items.every((v) => (checked || []).includes(v));
      return { items: Array.isArray(items) ? items : [], checked: Array.isArray(checked) ? checked : [], allChecked };
    } catch {
      return { items: [], checked: [], allChecked: false };
    }
  }, [returnTo]);
  const handleBackToScanned = React.useCallback(() => {
    if (!returnTo) return;
    if (forceUserAssign) {
      Alert.alert('Required', 'Please select a user to assign this asset before leaving.');
      return;
    }
    try { router.replace(String(returnTo)); } catch { router.back(); }
  }, [returnTo, forceUserAssign]);

  // Reset lookup results whenever the swap sheet is opened
  useEffect(() => {
    if (swapOpen) { setLookupResults([]); setLookupSelected(null); setLookupQuery(''); }
  }, [swapOpen]);

  // Preload assets list when opening the swap sheet (for live suggestions)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!swapOpen) return;
      if (allAssets.length) return;
      try {
        const r = await fetch(`${API_BASE_URL}/assets`);
        const data = await r.json();
        if (!cancelled) setAllAssets(Array.isArray(data) ? data : []);
      } catch { }
    })();
    return () => { cancelled = true; };
  }, [swapOpen]);

  // Live filter suggestions as user types
  useEffect(() => {
    if (!swapOpen) return;
    const q = String(lookupQuery || '').trim().toLowerCase();
    if (q.length < 2) { setLookupResults([]); setLookupSelected(null); return; }
    const idIsQR = (s) => /^[A-Z0-9]{8}$/i.test(String(s || ''));
    const isPlaceholder = (it) => {
      const hasDyn = it && it.fields && Object.keys(it.fields || {}).length > 0;
      return !it?.serial_number && !it?.model && !it?.assigned_to_id && !it?.type_id && !it?.documentation_url && !it?.image_url && !hasDyn;
    };
    const matches = (allAssets || [])
      .filter((it) => {
        // Only show real 8-char QR IDs, exclude placeholders or temp/imported records
        if (!idIsQR(it?.id)) return false;               // must be 8-char QR id
        if (!it?.type_id) return false;                  // must be a real asset type
        if (!it?.model && !it?.serial_number) return false; // require some concrete identity
        if (isPlaceholder(it)) return false;             // defensive guard
        // Common search across all relevant fields (like the main search).
        const hay = [
          it?.id, it?.model, it?.serial_number, it?.other_id,
          it?.asset_types?.name, it?.type, it?.description,
          it?.users?.name, it?.users?.useremail,
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 10);
    setLookupResults(matches);
    // clear any selected if it no longer appears
    if (lookupSelected && !matches.find(m => m.id === lookupSelected.id)) setLookupSelected(null);
  }, [lookupQuery, allAssets, swapOpen]);

  const scrollToLookup = () => {
    try {
      const y = typeof lookupSectionYRef.current === 'number' ? lookupSectionYRef.current : 0;
      if (swapScrollRef.current?.scrollTo) {
        swapScrollRef.current.scrollTo({ y: Math.max(0, y - 12), animated: true });
      }
    } catch { }
  };

  const scrollToLookupField = (which) => {
    try {
      const yMap = { model: modelYRef.current, type: typeYRef.current, assigned: assignedYRef.current };
      const y = Number.isFinite(yMap[which]) ? yMap[which] : lookupSectionYRef.current;
      if (swapScrollRef.current?.scrollTo) {
        swapScrollRef.current.scrollTo({ y: Math.max(0, y - 12), animated: true });
      }
    } catch { }
  };

  // When results appear while typing, bring the lookup block into view
  useEffect(() => {
    if (!swapOpen) return;
    if (lookupResults && lookupResults.length) scrollToLookup();
  }, [lookupResults, swapOpen]);

  const renderLookupSuggestions = () => (
    <View style={{ marginTop: 12 }}>
      <Text style={styles.fieldLabel}>Select a match to swap</Text>
      <ScrollView style={{ maxHeight: 260 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
        {lookupResults.map((it) => (
          <TouchableOpacity
            key={it.id}
            style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.line, backgroundColor: lookupSelected?.id === it.id ? Colors.accentLight : 'transparent' }}
            onPress={() => setLookupSelected(it)}
          >
            <Text style={{ fontWeight: '700', color: Colors.text }}>{it.id}</Text>
            <Text style={{ color: Colors.sub }}>
              {(it.asset_types?.name || 'Type?')} • {(it.model || 'Model?')} • {(it.users?.name || it.users?.useremail || 'Unassigned')}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {lookupSelected && (
        <View style={[styles.btnRow, { marginTop: 12 }]}>
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={async () => {
              try {
                const confirmed = await new Promise((resolve) => {
                  Alert.alert(
                    'Confirm Swap',
                    `Swap QR from ${lookupSelected.id} to ${asset?.id}?`,
                    [
                      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                      { text: 'Confirm', style: 'destructive', onPress: () => resolve(true) },
                    ]
                  );
                });
                if (!confirmed) return;
                setLoading(true);
                await performSwap(lookupSelected.id, asset?.id);
                setSwapOpen(false);
                if (returnTo) {
                  try { router.replace(String(returnTo)); } catch { router.back(); }
                } else {
                  router.replace(`/check-in/${asset?.id}`);
                }
                Alert.alert('Success', 'QR swapped successfully.');
              } catch (e) {
                Alert.alert('Error', e.message || 'Swap failed');
              } finally {
                setLoading(false);
              }
            }}
          >
            <MaterialIcons name="swap-horiz" size={18} color="#fff" />
            <Text style={styles.btnPrimaryText}>Swap Selected</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
  const applyAssetPatch = (patch) => {
    setAsset(prev => {
      const next = { ...prev, ...patch };
      if (Object.prototype.hasOwnProperty.call(patch, 'assigned_to_id')) {
        next.assigned_user_name = nameForUser(patch.assigned_to_id);
      }
      return next;
    });
  };
  useEffect(() => {
    const email = (user?.email || '').toLowerCase();
    if (!email || !users?.length) return;
    const me = users.find(u => u.useremail?.toLowerCase() === email);
    setMyUserId(me?.id ?? null);
  }, [user, users]);

  useEffect(() => {
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, async (u) => {
      try {
        if (!u) { setIsAdmin(false); return; }
        const res = await fetch(`${API_BASE_URL}/users/${u.uid}`);
        if (!res.ok) { setIsAdmin(false); return; }
        const dbUser = await res.json();
        const role = String(dbUser?.role || '').toUpperCase();
        setIsAdmin(role === 'ADMIN');
      } catch {
        setIsAdmin(false);
      }
    });
    return unsub;
  }, []);

  // subtle page fade‑in
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, [fade]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Get Firebase Auth and current user
        const auth = getAuth();
        const currentUser = auth.currentUser;
        logger.log('Current user:', currentUser?.uid);
        logger.log('API_BASE_URL:', API_BASE_URL);

        if (currentUser) {
          setUser(currentUser); // Set user state if logged in
        } else {
          // Unauthenticated: redirect to public page on web, login on native
          if (Platform.OS === 'web') {
            // Public fallback page with Lost & Found / Transfer to Office forms
            router.replace(`/check-in/public?id=${encodeURIComponent(id)}`);
          } else {
            // On native, send to login and carry the deep-link destination so the
            // user lands back on this screen after signing in.
            router.replace(`/login?redirect=${encodeURIComponent(`/check-in/${id}`)}`);
          }
          return; // stop loading — navigation is already happening
        }

        // Fetch asset details from backend
        if (!id) {
          setError("Invalid asset ID");
          setLoading(false);
          return;
        }

        // Fetch asset details with retry logic
        let assetRes;
        let retries = 3;
        let lastError;

        while (retries > 0) {
          try {
            assetRes = await fetch(`${API_BASE_URL}/assets/${id}`, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
              },
            });
            break; // Success, exit retry loop
          } catch (fetchError) {
            lastError = fetchError;
            retries--;
            if (retries > 0) {
              console.warn(`⚠️ Fetch failed, retrying... (${retries} attempts left)`);
              await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
            }
          }
        }

        if (!assetRes) {
          throw new Error(
            lastError?.message ||
            `Network request failed. Please check your connection and ensure the API is accessible at ${API_BASE_URL}`
          );
        }

        const contentType = assetRes.headers.get('content-type');
        if (!assetRes.ok) {
          const text = await assetRes.text();
          throw new Error(
            `API request failed (${assetRes.status}): ${text || 'Unknown error'}\n` +
            `URL: ${API_BASE_URL}/assets/${id}`
          );
        }

        if (!contentType?.includes('application/json')) {
          const text = await assetRes.text();
          throw new Error(`Unexpected response type: ${contentType}\nResponse: ${text}`);
        }

        const assetData = await assetRes.json();

        // If asset has an assigned user, use the nested user data
        if (assetData.assigned_to_id && assetData.users) {
          // Use the nested user data if available
          assetData.assigned_user_name = assetData.users.name ||
            assetData.users.useremail ||
            `User ${assetData.assigned_to_id}`;
        } else if (assetData.assigned_to_id) {
          // Fallback to fetching user details if not in the nested data
          try {
            const userRes = await fetch(`${API_BASE_URL}/users/${assetData.assigned_to_id}`);
            if (userRes.ok) {
              const userData = await userRes.json();
              assetData.assigned_user_name = userData.name ||
                userData.useremail ||
                `User ${assetData.assigned_to_id}`;
            }
          } catch (userError) {
            console.error('Error fetching user details:', userError);
            assetData.assigned_user_name = `User ${assetData.assigned_to_id}`;
          }
        }

        logger.log('Asset data:', assetData?.id);
        setAsset(assetData); // Store asset info with user name
      } catch (err) {
        // Handle fetch or network errors
        console.error("❌ Error in Check-In screen:", err);
        const errorMessage = err.message || 'Unknown error occurred';
        const detailedError = `${errorMessage}\n\nAPI URL: ${API_BASE_URL}\nAsset ID: ${id}`;
        setError(detailedError);
      } finally {
        setLoading(false); // Hide loading spinner
      }
    };

    fetchData(); // Run on mount
    // Fetch all users when component mounts
    const fetchUsers = async () => {
      try {
        let response;
        let retries = 3;
        let lastError;

        while (retries > 0) {
          try {
            response = await fetch(`${API_BASE_URL}/users`, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
              },
            });
            break; // Success, exit retry loop
          } catch (fetchError) {
            lastError = fetchError;
            retries--;
            if (retries > 0) {
              console.warn(`⚠️ Users fetch failed, retrying... (${retries} attempts left)`);
              await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
            }
          }
        }

        if (!response) {
          console.error('Error fetching users:', lastError);
          console.error(`Failed URL: ${API_BASE_URL}/users`);
          return; // Don't set error state, just log - users list is not critical for initial load
        }

        if (response.ok) {
          const userList = await response.json();
          setUsers(userList);
          setFilteredUsers(userList);
        } else {
          console.warn(`Users API returned ${response.status}: ${await response.text()}`);
        }
      } catch (err) {
        console.error('Error fetching users:', err);
        console.error(`Failed URL: ${API_BASE_URL}/users`);
        // Don't set error state - users list failure shouldn't block the screen
      }
    };

    fetchUsers();
  }, [id]);

  // Filter users based on search query
  useEffect(() => {
    if (!searchQuery.trim()) return setFilteredUsers(users);
    const q = searchQuery.toLowerCase();
    setFilteredUsers(
      users.filter((u) => u.name?.toLowerCase().includes(q) || u.useremail?.toLowerCase().includes(q))
    );
  }, [searchQuery, users]);

  // --------- copy helpers & placeholder detection ---------
  const copyText = async (text, okMsg = 'Copied') => {
    try {
      if (Platform.OS === 'web') {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(String(text));
        } else {
          const el = document.createElement('textarea');
          el.value = String(text);
          el.setAttribute('readonly', '');
          el.style.position = 'absolute';
          el.style.left = '-9999px';
          document.body.appendChild(el);
          el.select();
          document.execCommand('copy');
          document.body.removeChild(el);
        }
        window.alert(okMsg);
      } else {
        if (Clipboard?.setStringAsync) await Clipboard.setStringAsync(String(text));
        else if (Clipboard?.setString) Clipboard.setString(String(text));
        Alert.alert('Copied', okMsg);
      }
    } catch (e) {
      Platform.OS === 'web'
        ? window.prompt('Copy this text:', String(text))
        : Alert.alert('Copy failed', 'Could not copy to clipboard.');
    }
  };
  const copyId = () => asset?.id && copyText(asset.id, 'Asset ID copied');
  const copyLink = () => {
    let link = '';
    if (Platform.OS === 'web' && typeof window !== 'undefined') link = window.location.href;
    else link = LinkingExpo.createURL(`check-in/${id}`);
    copyText(link, 'Check-in link copied');
  };

  // Perform a swap with fallback when target QR is not an empty placeholder
  const performSwap = async (fromId, toId) => {
    const auth = getAuth && getAuth();
    const u = auth?.currentUser || null;
    let headers = { 'Content-Type': 'application/json' };
    try {
      if (u && typeof u.getIdToken === 'function') {
        const tk = await u.getIdToken();
        if (tk) headers.Authorization = `Bearer ${tk}`;
      }
    } catch { }
    if (u?.uid) headers['X-User-Id'] = u.uid;
    if (u?.displayName) headers['X-User-Name'] = u.displayName;
    if (u?.email) headers['X-User-Email'] = u.email;

    // Check if target is empty
    const chk = await fetch(`${API_BASE_URL}/assets/${encodeURIComponent(toId)}`);
    if (!chk.ok) throw new Error('Target QR not found');
    const tgt = await chk.json();
    const hasDyn = tgt && tgt.fields && Object.keys(tgt.fields || {}).length > 0;
    const status = String(tgt?.status || '').toLowerCase();
    if (status === 'end of life') throw new Error('This QR is End of Life and cannot be used for swaps.');
    const toIsEmpty = !tgt?.serial_number && !tgt?.model && !tgt?.assigned_to_id && !tgt?.type_id && !tgt?.documentation_url && !tgt?.image_url && !tgt?.other_id && !hasDyn && (status === 'available');

    if (toIsEmpty) {
      const r = await fetch(`${API_BASE_URL}/assets/swap-qr`, { method: 'POST', headers, body: JSON.stringify({ from_id: fromId, to_id: toId }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b?.error || 'Swap failed');
      return true;
    }

    // 3-step using a spare placeholder
    const optsRes = await fetch(`${API_BASE_URL}/assets/asset-options`);
    const opts = optsRes.ok ? await optsRes.json() : null;
    const placeholders = Array.isArray(opts?.assetIds) ? opts.assetIds : [];
    const tempId = placeholders.find((pid) => typeof pid === 'string' && pid !== fromId && pid !== toId);
    if (!tempId) throw new Error('No blank QR available to complete swap');

    // A=toId, B=fromId, P=tempId
    let r1 = await fetch(`${API_BASE_URL}/assets/swap-qr`, { method: 'POST', headers, body: JSON.stringify({ from_id: toId, to_id: tempId }) });
    let b1 = await r1.json().catch(() => ({}));
    if (!r1.ok) throw new Error(b1?.error || 'Swap step 1 failed');
    let r2 = await fetch(`${API_BASE_URL}/assets/swap-qr`, { method: 'POST', headers, body: JSON.stringify({ from_id: fromId, to_id: toId }) });
    let b2 = await r2.json().catch(() => ({}));
    if (!r2.ok) throw new Error(b2?.error || 'Swap step 2 failed');
    let r3 = await fetch(`${API_BASE_URL}/assets/swap-qr`, { method: 'POST', headers, body: JSON.stringify({ from_id: tempId, to_id: fromId }) });
    let b3 = await r3.json().catch(() => ({}));
    if (!r3.ok) throw new Error(b3?.error || 'Swap step 3 failed');
    return true;
  };

  const isPlaceholder = React.useMemo(() => {
    if (!asset) return false;
    const hasDyn = asset && asset.fields && Object.keys(asset.fields || {}).length > 0;
    const status = String(asset?.status || '').toLowerCase();
    // Mirror server-side placeholder criteria: empty + Available status
    const emptyLike = !asset.serial_number && !asset.model && !asset.assigned_to_id && !asset.type_id && !asset.documentation_url && !asset.image_url && !asset.other_id && !hasDyn && (status === 'available');
    return emptyLike;
  }, [asset]);

  const isQRReserved = React.useMemo(() => {
    if (!asset) return false;
    const desc = String(asset?.description || '').toLowerCase();
    return desc.includes('qr reserved');
  }, [asset]);

  const isAwaitingQr = React.useMemo(
    () => !!(asset && isAssetIdAwaitingQr(String(asset.id || ''))),
    [asset]
  );

  const filteredAssignPhysicalList = React.useMemo(() => {
    const q = (assignPhysicalQuery || '').toUpperCase().trim();
    if (!q) return assignPhysicalList;
    return assignPhysicalList.filter((a) => String(a.id || '').toUpperCase().includes(q));
  }, [assignPhysicalQuery, assignPhysicalList]);

  // Helper: load imported assets (UUID ids, not placeholders)
  const loadImportedAssets = async () => {
    try {
      setAssignLoading(true);
      const res = await fetch(`${API_BASE_URL}/assets`);
      if (!res.ok) throw new Error('Failed to fetch assets');
      const list = await res.json();
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const cleaned = (list || [])
        .filter(a => uuidRe.test(String(a?.id || '')))
        .filter(a => String(a?.description || '').toLowerCase() !== 'qr reserved asset');
      setAssignResults(cleaned);
    } catch (e) {
      Alert.alert('Error', e?.message || 'Failed to load imported assets');
    } finally {
      setAssignLoading(false);
    }
  };

  const loadBlankPhysicalQrStickers = async () => {
    try {
      setAssignPhysicalLoading(true);
      const res = await fetch(`${API_BASE_URL}/assets`);
      if (!res.ok) throw new Error('Failed to fetch assets');
      const list = await res.json();
      const cleaned = (list || [])
        .filter(isBlankPhysicalQrSticker)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
      setAssignPhysicalList(cleaned);
    } catch (e) {
      Alert.alert('Error', e?.message || 'Failed to load blank QR codes');
    } finally {
      setAssignPhysicalLoading(false);
    }
  };

  const filteredAssignResults = useMemo(() => {
    const q = (assignQuery || '').toLowerCase().trim();
    if (!q) return assignResults;
    return assignResults.filter(a => {
      const t = [
        a?.model,
        a?.asset_types?.name,
        a?.serial_number,
        a?.other_id,
        a?.notes,
      ].map(x => (x || '').toLowerCase());
      return t.some(s => s.includes(q));
    });
  }, [assignQuery, assignResults]);

  const handleAssignToPlaceholder = async (fromId) => {
    try {
      setAssignLoading(true);

      // Get Firebase auth token
      const auth = getAuth();
      const currentUser = auth?.currentUser;
      let headers = {
        'Content-Type': 'application/json',
      };

      // Add Authorization Bearer token
      try {
        if (currentUser && typeof currentUser.getIdToken === 'function') {
          const token = await currentUser.getIdToken();
          if (token) {
            headers.Authorization = `Bearer ${token}`;
          }
        }
      } catch (tokenError) {
        console.warn('Failed to get auth token:', tokenError);
      }

      // Add user info headers
      if (currentUser?.uid) headers['X-User-Id'] = currentUser.uid;
      if (currentUser?.displayName) headers['X-User-Name'] = currentUser.displayName;
      if (currentUser?.email) headers['X-User-Email'] = currentUser.email;

      const resp = await fetch(`${API_BASE_URL}/assets/swap-qr`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ from_id: fromId, to_id: asset?.id }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const { to } = await resp.json();
      setAssignOpen(false);
      setAssignQuery('');
      setAssignSelected(null);
      // Replace local asset with the assigned one now on this QR id
      setAsset(prev => ({ ...(prev || {}), ...(to || {}) }));
      // Require assigning to a user immediately
      setForceUserAssign(true);
      setShowUserModal(true);
      Alert.alert('Success', 'Imported asset assigned. Please choose a user to assign this asset to.');
    } catch (e) {
      Alert.alert('Error', e?.message || 'Failed to assign imported asset');
    } finally {
      setAssignLoading(false);
    }
  };

  const handleAssignPhysicalToSticker = async (physicalId) => {
    const raw = String(physicalId || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(raw)) {
      Alert.alert('Invalid QR', 'Choose an 8-character asset ID.');
      return;
    }
    try {
      setAssignPhysicalLoading(true);
      await performSwap(asset?.id, raw);
      setAssignPhysicalOpen(false);
      setAssignPhysicalQuery('');
      setAssignPhysicalSelected(null);
      Alert.alert('Success', `Asset is now on QR ${raw}.`);
      if (returnTo) {
        try { router.replace(String(returnTo)); } catch { router.back(); }
      } else {
        router.replace(`/asset/${raw}`);
      }
    } catch (e) {
      Alert.alert('Error', e?.message || 'Failed to assign QR');
    } finally {
      setAssignPhysicalLoading(false);
    }
  };

  // Handle transfer to selected user
  const handleTransferToUser = async (selectedUser) => {
    try {
      setLoading(true);

      // Get Firebase auth token
      const auth = getAuth();
      const currentUser = auth?.currentUser;
      let headers = {
        'Content-Type': 'application/json',
      };

      // Add Authorization Bearer token
      try {
        if (currentUser && typeof currentUser.getIdToken === 'function') {
          const token = await currentUser.getIdToken();
          if (token) {
            headers.Authorization = `Bearer ${token}`;
          }
        }
      } catch (tokenError) {
        console.warn('Failed to get auth token:', tokenError);
      }

      // Add user info headers
      if (currentUser?.uid) headers['X-User-Id'] = currentUser.uid;
      if (currentUser?.displayName) headers['X-User-Name'] = currentUser.displayName;
      if (currentUser?.email) headers['X-User-Email'] = currentUser.email;

      const updateResponse = await fetch(`${API_BASE_URL}/assets/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          // Transfers must NOT change the asset's status (a Maintenance/Repair
          // asset stays in that status when reassigned).
          assigned_to_id: selectedUser.id,
          action_note: actionNote || undefined,
        }),
      });

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        throw new Error(errorText || 'Failed to transfer asset');
      }

      // Optimistic local update
      applyAssetPatch({ assigned_to_id: selectedUser.id });
      setShowUserModal(false);
      setForceUserAssign(false);
      setLoading(false);
      postActionAlert({
        message: `Asset transferred to ${selectedUser.name || selectedUser.useremail}`,
      });
      // If part of multi-scan, go back to the list to process the rest
      if (returnTo) {
        try { router.replace(String(returnTo)); } catch { router.back(); }
      }
    } catch (err) {
      console.error('Error in transfer:', err);
      Alert.alert('Error', err.message || 'Failed to transfer asset');
    } finally {
      setLoading(false);
    }
  };


  // Handle check-in or transfer button actions
  const handleAction = async (type) => {
    if (!asset || !user) return;

    let payload = {};
    let successMessage = '';

    // Try to capture last scanned device location and turn into human-friendly text
    const getLastScannedLocation = async () => {
      try {
        let ExpoLocation;
        try { ExpoLocation = require('expo-location'); } catch { return null; }
        const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
        if (status !== 'granted') return null;
        const pos = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy?.Balanced || 3 });
        if (!pos?.coords) return null;
        const { latitude, longitude } = pos.coords;
        // Prefer server-backed Google Geocoding for a high-quality address
        try {
          const resp = await fetch(`${API_BASE_URL}/places/reverse-geocode?lat=${latitude}&lng=${longitude}`);
          if (resp.ok) {
            const j = await resp.json();
            if (j?.formatted_address) return j.formatted_address;
          }
        } catch { }
        // Fallback to native reverse geocode
        try {
          const geos = await ExpoLocation.reverseGeocodeAsync({ latitude, longitude });
          const first = Array.isArray(geos) ? geos[0] : null;
          if (first) {
            const parts = [first.name, first.street, first.city, first.region, first.country].filter(Boolean);
            const addr = parts.join(', ');
            if (addr) return addr;
          }
        } catch { }
        return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      } catch { return null; }
    };

    try {
      setLoading(true);

      let optimisticAssignedToId = null;
      if (type === 'checkin') {
        // assign to office admin via server flag and mark usable
        payload = {
          // Returning to office is a transfer — keep the current status (don't
          // reset a Maintenance/Repair asset to In Service).
          assign_to_admin: true,
          action_note: actionNote || undefined,
        };
        const loc = await getLastScannedLocation();
        if (loc) payload.location = loc;
        // The server resolves the office user from assign_to_admin (so the
        // payload has no assigned_to_id). Mirror that locally so the assignee,
        // isAssignedToOffice and the action buttons update live without a refresh.
        const officeUser = pickOfficeInventoryAssignee(users);
        if (officeUser?.id) optimisticAssignedToId = officeUser.id;
        successMessage = 'Asset Transferred';
      } else if (type === 'transferToMe') {
        if (!myUserId) throw new Error('Your user record was not found');

        payload = {
          assigned_to_id: myUserId,
          // Leave status unchanged. If you must set one, use 'In Service'
          // status: 'In Service',
          action_note: actionNote || undefined,
        };
        const loc = await getLastScannedLocation();
        if (loc) payload.location = loc;
        successMessage = 'Asset Transferred';
      } else {
        throw new Error(`Unknown action: ${type}`);
      }

      // Get Firebase auth token
      const auth = getAuth();
      const currentUser = auth?.currentUser;
      let headers = {
        'Content-Type': 'application/json',
      };

      // Add Authorization Bearer token
      try {
        if (currentUser && typeof currentUser.getIdToken === 'function') {
          const token = await currentUser.getIdToken();
          if (token) {
            headers.Authorization = `Bearer ${token}`;
          }
        }
      } catch (tokenError) {
        console.warn('Failed to get auth token:', tokenError);
      }

      // Add user info headers
      if (currentUser?.uid) headers['X-User-Id'] = currentUser.uid;
      if (currentUser?.displayName) headers['X-User-Name'] = currentUser.displayName;
      if (currentUser?.email) headers['X-User-Email'] = currentUser.email;

      const res = await fetch(`${API_BASE_URL}/assets/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || 'Failed to update asset');
      }

      // Optimistic local update so UI reflects immediately. Strip the server-only
      // flag and apply the resolved assignee so the assignment shows live.
      const optimisticPatch = { ...payload };
      delete optimisticPatch.assign_to_admin;
      if (optimisticAssignedToId) optimisticPatch.assigned_to_id = optimisticAssignedToId;
      applyAssetPatch(optimisticPatch);
      // Optional: tiny success hint
      setLoading(false); // stop spinner first
      postActionAlert({ message: successMessage });
      if (returnTo) {
        try { router.replace(String(returnTo)); } catch { router.back(); }
      }
      return;
    } catch (err) {
      console.error('Error in handleAction:', err);
      Alert.alert('Error', err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const openTransferMenu = React.useCallback(() => {
    if (!id) return;
    const target = returnTo ? String(returnTo) : `/check-in/${id}`;
    router.push({
      pathname: '/transfer/[assetId]',
      params: {
        assetId: String(id),
        returnTo: target,
      },
    });
  }, [id, returnTo, router]);

  const handleOtherAction = (key) => {
    if (!isAdmin && (key === 'hire' || key === 'eol')) {
      Alert.alert('Admins only', 'Please contact an administrator for this action.');
      return;
    }
    setShowOtherModal(false);

    // Hire uses the full Equipment Hire Lease Disclaimer form (full-screen route)
    if (key === 'hire') {
      router.push({
        pathname: '/hire',
        params: asset?.id ? { assetId: asset.id } : {},
      });
      return;
    }

    // Other actions use the existing ActionsForm modal
    const map = {
      eol: 'End of Life',
      lost: 'Report Lost',
      stolen: 'Report Stolen',
    };
    setActionsFormType(map[key]);
    setActionsFormOpen(true);
  };

  // Build auth headers for note requests.
  const buildNoteHeaders = async () => {
    const auth = getAuth();
    const currentUser = auth?.currentUser;
    const headers = { 'Content-Type': 'application/json' };
    if (currentUser?.uid) headers['X-User-Id'] = currentUser.uid;
    if (currentUser?.displayName) headers['X-User-Name'] = currentUser.displayName;
    if (currentUser?.email) headers['X-User-Email'] = currentUser.email;
    try {
      if (currentUser && typeof currentUser.getIdToken === 'function') {
        const token = await currentUser.getIdToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      }
    } catch (e) { console.warn('Token error:', e); }
    return headers;
  };

  const finishNoteSaved = () => {
    setCreateNoteText('');
    setShowCreateNoteInput(false);
    setCreateNoteImportant(false);
    loadPriorityNotes(); // refresh the pinned-note banner
    Alert.alert('Success', 'Note saved.');
  };

  // Claim the single priority slot. Handles the "priority note already exists"
  // confirmation: 409 -> prompt overwrite/cancel -> retry with overwrite:true.
  const submitPriorityNote = async (note, headers, overwrite) => {
    const res = await fetch(`${API_BASE_URL}/assets/${encodeURIComponent(asset.id)}/priority-note`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ note, overwrite: !!overwrite }),
    });
    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      const existing = body?.existing;
      setCreateNoteSubmitting(false);
      Alert.alert(
        'Priority note already exists',
        `This asset already has a priority note:\n\n"${existing?.note || ''}"${existing?.who ? `\n— ${existing.who}` : ''}\n\nOverwrite it with your new note?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Overwrite',
            style: 'destructive',
            onPress: async () => {
              setCreateNoteSubmitting(true);
              try {
                await submitPriorityNote(note, headers, true);
              } catch (e) {
                Alert.alert('Error', e.message || 'Failed to save note');
              } finally {
                setCreateNoteSubmitting(false);
              }
            },
          },
        ]
      );
      return;
    }
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || 'Failed to save note');
    }
    finishNoteSaved();
  };

  // Submit note only (no transfer). Priority notes go through /priority-note
  // (single-slot, prompts on overwrite); normal notes via POST /actions.
  const submitCreateNote = async () => {
    const note = (createNoteText || '').trim();
    if (!note) {
      Alert.alert('Note required', 'Please enter a note.');
      return;
    }
    if (!asset?.id) return;
    setCreateNoteSubmitting(true);
    try {
      const headers = await buildNoteHeaders();
      if (createNoteImportant) {
        await submitPriorityNote(note, headers, false);
        return;
      }
      const res = await fetch(`${API_BASE_URL}/assets/${encodeURIComponent(asset.id)}/actions`, {
        method: 'POST',
        headers,
        // note_only + user_note_text mark this as a real Note (matches the Quick
        // Note shortcut) so it shows under Notes and is labelled "Note" in history.
        body: JSON.stringify({ type: 'STATUS_CHANGE', note, data: { user_note_text: note, note_only: true } }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || 'Failed to save note');
      }
      finishNoteSaved();
    } catch (e) {
      console.error('submitCreateNote error', e);
      Alert.alert('Error', e.message || 'Failed to save note');
    } finally {
      setCreateNoteSubmitting(false);
    }
  };

  // ----- Status updaters (footer buttons) -----
  const updateStatus = async (newStatus) => {
    try {
      setLoading(true);
      const body = {
        status: newStatus,
        // preserve current assignment; backend should upsert only fields sent
        assigned_to_id: asset?.assigned_to_id ?? null,
        action_note: actionNote || undefined,
      };

      // Get Firebase auth token
      const auth = getAuth();
      const currentUser = auth?.currentUser;
      let headers = {
        'Content-Type': 'application/json',
      };

      // Add Authorization Bearer token
      try {
        if (currentUser && typeof currentUser.getIdToken === 'function') {
          const token = await currentUser.getIdToken();
          if (token) {
            headers.Authorization = `Bearer ${token}`;
          }
        }
      } catch (tokenError) {
        console.warn('Failed to get auth token:', tokenError);
      }

      // Add user info headers
      if (currentUser?.uid) headers['X-User-Id'] = currentUser.uid;
      if (currentUser?.displayName) headers['X-User-Name'] = currentUser.displayName;
      if (currentUser?.email) headers['X-User-Email'] = currentUser.email;

      const res = await fetch(`${API_BASE_URL}/assets/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `Failed to set status: ${newStatus}`);
      }

      applyAssetPatch({ status: newStatus });
      setLoading(false); // stop spinner first
      postActionAlert({ message: `Status updated to "${newStatus}"` });
    } catch (e) {
      console.error('updateStatus error', e);
      Alert.alert('Error', e.message || 'Failed to update status');
    } finally {
      setLoading(false);
    }
  };

  const markRepair = () => updateStatus('Repair');
  const markMaintenance = () => updateStatus('Maintenance');


  // Reusable post-action alert (cross-platform)
  // On web: uses ConfirmModal; on native: uses Alert.
  const postActionAlert = ({
    title = 'Success',
    message = 'Action completed.',
    stayLabel = 'Stay here',
    goLabel = 'Go to Dashboard',
    onStay,
    onGo,
  } = {}) => {
    const goToDashboard = () => router.replace('/dashboard');

    if (Platform.OS === 'web') {
      setPostActionUi({
        title,
        message,
        goLabel,
        stayLabel,
        onGo: onGo || goToDashboard,
        onStay: onStay || (() => {}),
      });
    } else {
      InteractionManager.runAfterInteractions(() => {
        Alert.alert(title, message, [
          { text: stayLabel, style: 'default', onPress: onStay || (() => {}) },
          { text: goLabel, style: 'default', onPress: onGo || goToDashboard },
        ]);
      });
    }
  };


  // Render user selection modal
  const renderUserModal = () => (
    <Modal
      visible={showUserModal}
      animationType="slide"
      transparent
      onRequestClose={() => {
        if (forceUserAssign) {
          Alert.alert('Required', 'Please select a user to assign this asset.');
        } else {
          setShowUserModal(false);
        }
      }}
    >
      <View style={styles.sheetBackdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0} style={{ width: '100%' }}>
          <View style={[styles.sheet, styles.userModalSheet]}>
            <View style={styles.sheetHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{forceUserAssign ? 'Assign to User (required)' : 'Transfer to User'}</Text>
              {!forceUserAssign && (
                <TouchableOpacity onPress={() => setShowUserModal(false)}>
                  <MaterialIcons name="close" size={24} color={Colors.subtle} />
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.searchContainer}>
              <MaterialIcons name="search" size={20} color={Colors.muted} style={{ marginRight: 8 }} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search name or email"
                placeholderTextColor={Colors.muted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
              />
            </View>
            <FlatList
              data={filteredUsers}
              keyExtractor={(item) => String(item.id)}
              contentContainerStyle={{ paddingBottom: 24 }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.userRow} onPress={() => handleTransferToUser(item)} disabled={loading}>
                  <AvatarCircle name={item.name} email={item.useremail} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.userName}>{item.name || 'No Name'}</Text>
                    <Text style={styles.userEmail}>{item.useremail}</Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={22} color={Colors.muted} />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={{ padding: 24, alignItems: 'center' }}>
                  <Text style={{ color: Colors.muted }}>No users found</Text>
                </View>
              }
            />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );

  const renderOtherActionsModal = () => (
    <Modal
      visible={showOtherModal}
      animationType="slide"
      transparent
      onRequestClose={() => setShowOtherModal(false)}
    >
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Other Actions</Text>
            <TouchableOpacity onPress={() => setShowOtherModal(false)}>
              <MaterialIcons name="close" size={24} color={Colors.subtle} />
            </TouchableOpacity>
          </View>

          <View style={{ paddingVertical: 8 }}>
            {isAdmin && (
              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => handleOtherAction('hire')}
                disabled={loading}
              >
                <MaterialIcons name="work-outline" size={22} color="#0369A1" />
                <Text style={styles.actionText}>Hire</Text>
              </TouchableOpacity>
            )}
            {isAdmin && (
              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => handleOtherAction('eol')}
                disabled={loading}
              >
                <MaterialIcons name="remove-circle-outline" size={22} color="#B91C1C" />
                <Text style={styles.actionText}>End of Life</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => handleOtherAction('lost')}
              disabled={loading}
            >
              <MaterialIcons name="lost-and-found" size={22} color="#D97706" />
              <Text style={styles.actionText}>Report Lost</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => handleOtherAction('stolen')}
              disabled={loading}
            >
              <MaterialIcons name="warning-amber" size={22} color="#DC2626" />
              <Text style={styles.actionText}>Report Stolen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  const renderCreateNoteModal = () => (
    <Modal
      visible={showCreateNoteInput}
      animationType="fade"
      transparent
      onRequestClose={() => setShowCreateNoteInput(false)}
    >
      <View style={[styles.sheetBackdrop, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0} style={{ width: '100%', maxWidth: 360, alignSelf: 'center' }}>
          <View style={[styles.sheet, styles.createNoteSheet]}>
            <View style={styles.sheetHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{isPlaceholder ? 'Create a note for this asset' : 'Create note'}</Text>
              <TouchableOpacity onPress={() => setShowCreateNoteInput(false)}>
                <MaterialIcons name="close" size={24} color={Colors.subtle} />
              </TouchableOpacity>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.createNoteContent}
              showsVerticalScrollIndicator={false}
            >
              <TextInput
                placeholder="Create a note for this asset"
                value={createNoteText}
                onChangeText={setCreateNoteText}
                style={[styles.input, { minHeight: 80 }]}
                placeholderTextColor={Colors.subtle}
                multiline
                maxLength={FIELD_LIMITS.NOTES}
                editable={!createNoteSubmitting}
              />

              {/* Priority toggle — pins the note + shows it on scan */}
              <View style={[pn.toggleRow, createNoteImportant && pn.toggleRowOn]}>
                <MaterialIcons name="priority-high" size={20} color={createNoteImportant ? Colors.dangerFg : Colors.sub} />
                <View style={{ flex: 1 }}>
                  <Text style={pn.toggleLabel}>Priority note</Text>
                  <Text style={pn.toggleHint}>Pin to the top and show it when this asset is scanned.</Text>
                </View>
                <Switch value={createNoteImportant} onValueChange={setCreateNoteImportant} disabled={createNoteSubmitting} />
              </View>

              <TouchableOpacity
                style={[styles.btnPrimary, styles.createNoteSubmitBtn, createNoteSubmitting && { opacity: 0.7 }]}
                onPress={submitCreateNote}
                disabled={createNoteSubmitting}
              >
                <MaterialIcons name="check-circle" size={18} color="#fff" />
                <Text style={styles.btnPrimaryText} numberOfLines={1}>
                  {createNoteSubmitting ? 'Saving...' : 'Submit'}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );

  // ---------- Render ----------
  if (loading && !showUserModal) {
    return (
      <SafeAreaView style={[styles.safeArea, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={Colors.blue} />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerBox}>
          <MaterialIcons name="error-outline" size={48} color={Colors.red} />
          <Text style={[styles.title, { marginTop: 16, fontSize: sf(20), fontWeight: '700' }]}>Connection Error</Text>
          <Text style={{ color: Colors.subtle, textAlign: 'center', marginTop: 8, marginHorizontal: 24 }}>
            {error}
          </Text>
          <TouchableOpacity
            style={[styles.btnPrimary, { marginTop: 24 }]}
            onPress={() => {
              setError(null);
              setLoading(true);
              // Retry by re-running the effect
              const fetchData = async () => {
                try {
                  const auth = getAuth();
                  const currentUser = auth.currentUser;
                  if (currentUser) setUser(currentUser);
                  else setUser({ uid: "guest" });

                  if (!id) {
                    setError("Invalid asset ID");
                    setLoading(false);
                    return;
                  }

                  const assetRes = await fetch(`${API_BASE_URL}/assets/${id}`);
                  if (!assetRes.ok) {
                    const text = await assetRes.text();
                    throw new Error(`API error (${assetRes.status}): ${text}`);
                  }
                  const assetData = await assetRes.json();
                  setAsset(assetData);
                  setError(null);
                } catch (err) {
                  setError(err.message || 'Failed to load asset');
                } finally {
                  setLoading(false);
                }
              };
              fetchData();
            }}
          >
            <MaterialIcons name="refresh" size={18} color="#fff" />
            <Text style={styles.btnPrimaryText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btnGhost, { marginTop: 12 }]}
            onPress={() => router.back()}
          >
            <Text style={styles.btnGhostText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!asset || !user) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerBox}>
          <Text style={{ color: Colors.subtle }}>Missing asset or user data.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const tone = badgeTone(asset.status);

  return (
    <SafeAreaView style={styles.safeArea}>
      <Animated.View style={{ flex: 1, opacity: fade }}>
        {/* ─── WEB two-column layout ─── */}
        {Platform.OS === 'web' && (
          <ScrollView contentContainerStyle={styles.webContainer}>
            {/* Page header */}
            <View style={styles.webPageHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={styles.heroIconWrap}>
                  <MaterialIcons name="inventory-2" size={26} color={Colors.text} />
                </View>
                <View>
                  <Text style={styles.pageTitle}>Asset Actions</Text>
                  <Text style={styles.pageSubtitle}>Quick actions for this asset</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <TouchableOpacity style={styles.webNavBtn} onPress={() => router.replace('/(tabs)/dashboard')}>
                  <MaterialIcons name="home" size={16} color={Colors.primary} />
                  <Text style={styles.webNavBtnText}>Dashboard</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Priority (pinned) notes */}
            <PriorityNotesBanner notes={priorityNotes} onRemovePriority={removePriorityNote} />

            {/* Two-column body */}
            <View style={styles.webBody}>
              {/* ── Left: Asset info panel ── */}
              <View style={styles.webInfoPanel}>
                <Text style={styles.webSectionLabel}>ASSET DETAILS</Text>
                <View style={styles.webInfoCard}>
                  {/* Asset image (or add-image when missing) */}
                  <AssetImageBlock
                    imageUrl={asset.image_url}
                    uploading={uploadingImage}
                    justAdded={imageJustAdded}
                    onAdd={addAssetImage}
                    onScanAnother={goToScanner}
                    canAdd={!isQRReserved}
                  />
                  {/* Header — type + ID inline, status */}
                  <View style={dl.headerRow}>
                    <View style={dl.titleWrap}>
                      <Text style={dl.title} numberOfLines={2}>
                        {asset.asset_types?.name || asset.asset_type || 'Asset'}
                      </Text>
                      <View style={dl.idChip}><Text style={dl.idChipText}>{asset.id}</Text></View>
                    </View>
                    <StatusBadge status={normalizeStatus(asset.status)} />
                  </View>
                  {isAwaitingQr ? (
                    <Text style={{ color: Colors.subtle, fontSize: sf(12), marginTop: 4, fontWeight: '600' }}>
                      Awaiting physical QR
                    </Text>
                  ) : null}

                  {/* Detail list */}
                  <View style={dl.list}>
                    <DetailRow icon="confirmation-number" label="Serial" value={asset.serial_number || 'N/A'} />
                    <DetailRow icon="devices-other" label="Model" value={asset.model} />
                    <DescriptionRow value={asset.description} />
                    <DetailRow icon="schedule" label="Updated" value={fmtWhen(asset.last_updated)} />
                    <DetailRow icon="person" label="Assigned" value={asset.assigned_user_name || 'Unassigned'} highlight />
                  </View>
                </View>
              </View>

              {/* ── Right: Actions panel ── */}
              <View style={styles.webActionsPanel}>
                {isEOL ? (
                  <View style={styles.webActionGroup}>
                    <Text style={styles.webSectionLabel}>STATUS</Text>
                    <View style={styles.webInfoCard}>
                      <Text style={styles.webEolNote}>
                        This asset has been marked as End of Life and is no longer active.
                      </Text>
                    </View>
                  </View>
                ) : isAwaitingQr ? (
                  <View style={styles.webActionGroup}>
                    <Text style={styles.webSectionLabel}>QR ASSIGNMENT</Text>
                    <View style={styles.webInfoCard}>
                      <Text style={{ color: Colors.subtle, lineHeight: 20 }}>
                        This asset still uses a temporary id. Choose an unused 8-character QR sticker to move this record onto a physical label.
                      </Text>
                    </View>
                    <View style={styles.webActionCard}>
                      <TouchableOpacity
                        style={styles.webActionRow}
                        onPress={() => {
                          setAssignPhysicalSelected(null);
                          setAssignPhysicalQuery('');
                          setAssignPhysicalOpen(true);
                          if (!assignPhysicalList.length) loadBlankPhysicalQrStickers();
                        }}
                        disabled={loading || assignPhysicalLoading}
                      >
                        <View style={[styles.webActionIcon, { backgroundColor: Colors.accentLight }]}>
                          <MaterialIcons name="qr-code-2" size={20} color={Colors.accent} />
                        </View>
                        <View style={styles.webActionInfo}>
                          <Text style={styles.webActionLabel}>Assign physical QR</Text>
                          <Text style={styles.webActionDesc}>Pick a blank sticker from the list</Text>
                        </View>
                        <MaterialIcons name="chevron-right" size={20} color={Colors.subtle} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.webActionRow, styles.webActionRowLast]}
                        onPress={() => router.replace('/(tabs)/dashboard')}
                      >
                        <View style={[styles.webActionIcon, { backgroundColor: Colors.chip }]}>
                          <MaterialIcons name="home" size={20} color={Colors.primary} />
                        </View>
                        <View style={styles.webActionInfo}>
                          <Text style={styles.webActionLabel}>Dashboard</Text>
                          <Text style={styles.webActionDesc}>Leave without assigning</Text>
                        </View>
                        <MaterialIcons name="chevron-right" size={20} color={Colors.subtle} />
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : isQRReserved ? (
                  <View style={styles.webActionGroup}>
                    <Text style={styles.webSectionLabel}>QR MANAGEMENT</Text>
                    <View style={styles.webActionCard}>
                      {!!asset?.id && (
                        <TouchableOpacity
                          style={styles.webActionRow}
                          onPress={() => { setAssignSelected(null); setAssignQuery(''); setAssignOpen(true); if (!assignResults.length) loadImportedAssets(); }}
                          disabled={loading}
                        >
                          <View style={[styles.webActionIcon, { backgroundColor: Colors.accentLight }]}>
                            <MaterialIcons name="assignment" size={20} color={Colors.accent} />
                          </View>
                          <View style={styles.webActionInfo}>
                            <Text style={styles.webActionLabel}>Assign Imported Asset</Text>
                            <Text style={styles.webActionDesc}>Link an imported asset to this QR</Text>
                          </View>
                          <MaterialIcons name="chevron-right" size={20} color={Colors.subtle} />
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity style={styles.webActionRow} onPress={() => setSwapOpen(true)} disabled={loading}>
                        <View style={[styles.webActionIcon, { backgroundColor: Colors.chip }]}>
                          <MaterialIcons name="swap-horiz" size={20} color={Colors.primary} />
                        </View>
                        <View style={styles.webActionInfo}>
                          <Text style={styles.webActionLabel}>Swap QR</Text>
                          <Text style={styles.webActionDesc}>Move asset data to a different QR</Text>
                        </View>
                        <MaterialIcons name="chevron-right" size={20} color={Colors.subtle} />
                      </TouchableOpacity>
                      {!!asset?.id && (
                        <TouchableOpacity
                          style={[styles.webActionRow, styles.webActionRowLast]}
                          onPress={() => router.push({ pathname: '/asset/new', params: { preselectId: asset.id, returnTo: returnTo || '' } })}
                          disabled={loading}
                        >
                          <View style={[styles.webActionIcon, { backgroundColor: Colors.chip }]}>
                            <MaterialIcons name="add-circle-outline" size={20} color={Colors.primary} />
                          </View>
                          <View style={styles.webActionInfo}>
                            <Text style={styles.webActionLabel}>Create Asset</Text>
                            <Text style={styles.webActionDesc}>Register a new asset on this QR</Text>
                          </View>
                          <MaterialIcons name="chevron-right" size={20} color={Colors.subtle} />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                ) : isPlaceholder ? (
                  <>
                    <View style={styles.webActionGroup}>
                      <Text style={styles.webSectionLabel}>TRANSFERS</Text>
                      <View style={styles.webActionCard}>
                        {!isAssignedToOffice ? (
                          <TouchableOpacity
                            testID="transfer-to-office-button"
                            style={styles.webActionRow}
                            onPress={() => handleAction('checkin')}
                            disabled={loading}
                          >
                            <View style={[styles.webActionIcon, { backgroundColor: Colors.chip }]}>
                              <MaterialIcons name="business" size={20} color={Colors.primary} />
                            </View>
                            <View style={styles.webActionInfo}>
                              <Text style={styles.webActionLabel}>Transfer to Office</Text>
                              <Text style={styles.webActionDesc}>Check this asset back in to the office</Text>
                            </View>
                            <MaterialIcons name="chevron-right" size={20} color={Colors.subtle} />
                          </TouchableOpacity>
                        ) : myUserId && String(asset.assigned_to_id) !== String(myUserId) ? (
                          <TouchableOpacity
                            testID="transfer-to-me-button"
                            style={styles.webActionRow}
                            onPress={() => handleAction('transferToMe')}
                            disabled={loading}
                          >
                            <View style={[styles.webActionIcon, { backgroundColor: Colors.chip }]}>
                              <MaterialIcons name="person" size={20} color={Colors.primary} />
                            </View>
                            <View style={styles.webActionInfo}>
                              <Text style={styles.webActionLabel}>Transfer to Me</Text>
                              <Text style={styles.webActionDesc}>Assign this asset to yourself</Text>
                            </View>
                            <MaterialIcons name="chevron-right" size={20} color={Colors.subtle} />
                          </TouchableOpacity>
                        ) : null}
                        <TouchableOpacity
                          style={[styles.webActionRow, styles.webActionRowLast]}
                          onPress={() => setSwapOpen(true)}
                          disabled={loading}
                        >
                          <View style={[styles.webActionIcon, { backgroundColor: Colors.chip }]}>
                            <MaterialIcons name="swap-horiz" size={20} color={Colors.primary} />
                          </View>
                          <View style={styles.webActionInfo}>
                            <Text style={styles.webActionLabel}>Swap QR</Text>
                            <Text style={styles.webActionDesc}>Move asset data to a different QR</Text>
                          </View>
                          <MaterialIcons name="chevron-right" size={20} color={Colors.subtle} />
                        </TouchableOpacity>
                      </View>
                    </View>
                    {!!asset?.id && (
                      <View style={styles.webActionGroup}>
                        <Text style={styles.webSectionLabel}>ASSET MANAGEMENT</Text>
                        <View style={styles.webActionCard}>
                          <TouchableOpacity
                            style={styles.webActionRow}
                            onPress={() => { setAssignSelected(null); setAssignQuery(''); setAssignOpen(true); if (!assignResults.length) loadImportedAssets(); }}
                            disabled={loading}
                          >
                            <View style={[styles.webActionIcon, { backgroundColor: Colors.accentLight }]}>
                              <MaterialIcons name="assignment" size={20} color={Colors.accent} />
                            </View>
                            <View style={styles.webActionInfo}>
                              <Text style={styles.webActionLabel}>Assign Imported Asset</Text>
                              <Text style={styles.webActionDesc}>Link an imported asset to this QR</Text>
                            </View>
                            <MaterialIcons name="chevron-right" size={20} color={Colors.subtle} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.webActionRow}
                            onPress={() => router.push({ pathname: '/asset/new', params: { preselectId: asset.id, returnTo: returnTo || '' } })}
                            disabled={loading}
                          >
                            <View style={[styles.webActionIcon, { backgroundColor: Colors.chip }]}>
                              <MaterialIcons name="add-circle-outline" size={20} color={Colors.primary} />
                            </View>
                            <View style={styles.webActionInfo}>
                              <Text style={styles.webActionLabel}>Create Asset</Text>
                              <Text style={styles.webActionDesc}>Register a new asset on this QR</Text>
                            </View>
                            <MaterialIcons name="chevron-right" size={20} color={Colors.subtle} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.webActionRow, styles.webActionRowLast]}
                            onPress={() => setShowCreateNoteInput(true)}
                            disabled={loading}
                          >
                            <View style={[styles.webActionIcon, { backgroundColor: Colors.chip }]}>
                              <MaterialIcons name="note-add" size={20} color={Colors.primary} />
                            </View>
                            <View style={styles.webActionInfo}>
                              <Text style={styles.webActionLabel}>Create Note</Text>
                              <Text style={styles.webActionDesc}>Add a note to this asset's history</Text>
                            </View>
                            <MaterialIcons name="chevron-right" size={20} color={Colors.subtle} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  </>
                ) : (
                  <>
                    {/* Transfers */}
                    <View style={styles.webActionGroup}>
                      <Text style={styles.webSectionLabel}>TRANSFERS</Text>
                      <View style={styles.webActionCard}>
                        {!isAssignedToOffice ? (
                          <TouchableOpacity
                            testID="transfer-to-office-button"
                            style={styles.webActionRow}
                            onPress={() => handleAction('checkin')}
                            disabled={loading}
                          >
                            <View style={[styles.webActionIcon, { backgroundColor: Colors.chip }]}>
                              <MaterialIcons name="business" size={20} color={Colors.primary} />
                            </View>
                            <View style={styles.webActionInfo}>
                              <Text style={styles.webActionLabel}>Transfer to Office</Text>
                              <Text style={styles.webActionDesc}>Check this asset back in to the office</Text>
                            </View>
                            <MaterialIcons name="chevron-right" size={20} color={Colors.subtle} />
                          </TouchableOpacity>
                        ) : myUserId && String(asset.assigned_to_id) !== String(myUserId) ? (
                          <TouchableOpacity
                            testID="transfer-to-me-button"
                            style={styles.webActionRow}
                            onPress={() => handleAction('transferToMe')}
                            disabled={loading}
                          >
                            <View style={[styles.webActionIcon, { backgroundColor: Colors.chip }]}>
                              <MaterialIcons name="person" size={20} color={Colors.primary} />
                            </View>
                            <View style={styles.webActionInfo}>
                              <Text style={styles.webActionLabel}>Transfer to Me</Text>
                              <Text style={styles.webActionDesc}>Assign this asset to yourself</Text>
                            </View>
                            <MaterialIcons name="chevron-right" size={20} color={Colors.subtle} />
                          </TouchableOpacity>
                        ) : null}
                        <TouchableOpacity
                          style={styles.webActionRow}
                          onPress={openTransferMenu}
                          disabled={loading}
                        >
                          <View style={[styles.webActionIcon, { backgroundColor: Colors.chip }]}>
                            <MaterialIcons name="person-add" size={20} color={Colors.primary} />
                          </View>
                          <View style={styles.webActionInfo}>
                            <Text style={styles.webActionLabel}>Transfer to User</Text>
                            <Text style={styles.webActionDesc}>Assign this asset to a specific person</Text>
                          </View>
                          <MaterialIcons name="chevron-right" size={20} color={Colors.subtle} />
                        </TouchableOpacity>
                        {myUserId && String(asset.assigned_to_id) !== String(myUserId) && !isAssignedToOffice && (
                          <TouchableOpacity
                            style={[styles.webActionRow, styles.webActionRowLast]}
                            onPress={() => handleAction('transferToMe')}
                            disabled={loading}
                          >
                            <View style={[styles.webActionIcon, { backgroundColor: Colors.chip }]}>
                              <MaterialIcons name="person" size={20} color={Colors.primary} />
                            </View>
                            <View style={styles.webActionInfo}>
                              <Text style={styles.webActionLabel}>Transfer to Me</Text>
                              <Text style={styles.webActionDesc}>Assign this asset to yourself</Text>
                            </View>
                            <MaterialIcons name="chevron-right" size={20} color={Colors.subtle} />
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>

                    {/* Maintenance */}
                    <View style={styles.webActionGroup}>
                      <Text style={styles.webSectionLabel}>MAINTENANCE</Text>
                      <View style={styles.webActionCard}>
                        <TouchableOpacity
                          style={styles.webActionRow}
                          onPress={() => { setActionsFormType('Repair'); setActionsFormOpen(true); }}
                        >
                          <View style={[styles.webActionIcon, { backgroundColor: Colors.warningBg }]}>
                            <MaterialIcons name="build" size={20} color={Colors.warningFg} />
                          </View>
                          <View style={styles.webActionInfo}>
                            <Text style={styles.webActionLabel}>Repair Required</Text>
                            <Text style={styles.webActionDesc}>Log that this asset needs repair</Text>
                          </View>
                          <MaterialIcons name="chevron-right" size={20} color={Colors.subtle} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.webActionRow, styles.webActionRowLast]}
                          onPress={() => { setActionsFormType('Maintenance'); setActionsFormOpen(true); }}
                        >
                          <View style={[styles.webActionIcon, { backgroundColor: Colors.infoBg }]}>
                            <MaterialIcons name="build-circle" size={20} color={Colors.infoFg} />
                          </View>
                          <View style={styles.webActionInfo}>
                            <Text style={styles.webActionLabel}>Log Service</Text>
                            <Text style={styles.webActionDesc}>Record a maintenance / service event</Text>
                          </View>
                          <MaterialIcons name="chevron-right" size={20} color={Colors.subtle} />
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* Other */}
                    <View style={styles.webActionGroup}>
                      <Text style={styles.webSectionLabel}>OTHER</Text>
                      <View style={styles.webActionCard}>
                        {!!asset?.id && (
                          <TouchableOpacity
                            style={styles.webActionRow}
                            onPress={() => router.push({ pathname: '/asset/new', params: { fromAssetId: asset.id, returnTo: returnTo || '' } })}
                            disabled={loading}
                          >
                            <View style={[styles.webActionIcon, { backgroundColor: Colors.chip }]}>
                              <MaterialIcons name="content-copy" size={20} color={Colors.primary} />
                            </View>
                            <View style={styles.webActionInfo}>
                              <Text style={styles.webActionLabel}>Copy Asset</Text>
                              <Text style={styles.webActionDesc}>Duplicate this asset's details to a new QR</Text>
                            </View>
                            <MaterialIcons name="chevron-right" size={20} color={Colors.subtle} />
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={styles.webActionRow}
                          onPress={() => setShowCreateNoteInput(true)}
                          disabled={loading}
                        >
                          <View style={[styles.webActionIcon, { backgroundColor: Colors.chip }]}>
                            <MaterialIcons name="note-add" size={20} color={Colors.primary} />
                          </View>
                          <View style={styles.webActionInfo}>
                            <Text style={styles.webActionLabel}>Create Note</Text>
                            <Text style={styles.webActionDesc}>Add a note to this asset's history</Text>
                          </View>
                          <MaterialIcons name="chevron-right" size={20} color={Colors.subtle} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.webActionRow, styles.webActionRowLast]}
                          onPress={() => setShowOtherModal(true)}
                        >
                          <View style={[styles.webActionIcon, { backgroundColor: Colors.dangerBg }]}>
                            <MaterialIcons name="more-horiz" size={20} color={Colors.dangerFg} />
                          </View>
                          <View style={styles.webActionInfo}>
                            <Text style={[styles.webActionLabel, { color: Colors.dangerFg }]}>Other Actions</Text>
                            <Text style={styles.webActionDesc}>Status changes: EOL, Lost, Stolen…</Text>
                          </View>
                          <MaterialIcons name="chevron-right" size={20} color={Colors.subtle} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </>
                )}
              </View>
            </View>
          </ScrollView>
        )}
        {/* ─── MOBILE layout ─── */}
        {Platform.OS !== 'web' && (<>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
          {/* Header Card */}
          <View style={styles.headerCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={styles.heroIconWrap}>
                <MaterialIcons name="inventory-2" size={26} color={Colors.text} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.pageTitle}>Asset actions</Text>
                <Text style={styles.pageSubtitle}>Quick actions for this asset</Text>
              </View>
            </View>
          </View>

          {/* Multi-scan navigation helper */}
          {returnTo ? (
            <View style={{ alignItems: 'flex-end', marginTop: 6 }}>
              <TouchableOpacity
                onPress={handleBackToScanned}
                style={styles.backToScanBtn}
              >
                <MaterialIcons name="qr-code-scanner" size={16} color={Colors.accent} />
                <Text style={styles.backToScanText} numberOfLines={2}>
                  {`Back to Scanned Assets (${(multiScanCtx?.checked || []).length} of ${(multiScanCtx?.items || []).length} scanned)`}
                </Text>
                <MaterialIcons name="arrow-forward-ios" size={12} color={Colors.accent} />
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Priority (pinned) notes */}
          <PriorityNotesBanner notes={priorityNotes} onRemovePriority={removePriorityNote} />

          {/* Asset Overview */}
          <View style={styles.card}>
            {/* Asset image (or add-image when missing) */}
            <AssetImageBlock
              imageUrl={asset.image_url}
              uploading={uploadingImage}
              justAdded={imageJustAdded}
              onAdd={addAssetImage}
              onScanAnother={goToScanner}
              canAdd={!isQRReserved}
            />
            {/* Header — type + ID inline, status */}
            <View style={dl.headerRow}>
              <View style={dl.titleWrap}>
                <Text style={dl.title} numberOfLines={2}>
                  {asset.asset_types?.name || asset.asset_type || 'Asset'}
                </Text>
                <View style={dl.idChip}><Text style={dl.idChipText}>{asset.id}</Text></View>
              </View>
              <StatusBadge status={normalizeStatus(asset.status)} />
            </View>

            {/* Detail list */}
            <View style={dl.list}>
              <DetailRow icon="confirmation-number" label="Serial" value={asset.serial_number || 'N/A'} />
              <DetailRow icon="devices-other" label="Model" value={asset.model} />
              <DescriptionRow value={asset.description} />
              <DetailRow icon="schedule" label="Updated" value={fmtWhen(asset.last_updated)} />
              <DetailRow icon="person" label="Assigned" value={asset.assigned_user_name || 'Unassigned'} highlight />
            </View>
          </View>


          {/* Quick Actions (adjusted for Placeholder/EOL) */}
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.tileGrid}>

            {isEOL ? (
              <QuickActionRow
                styles={styles}
                actions={[
                  isAdmin && {
                    key: 'restore',
                    icon: 'restart-alt',
                    label: loading ? 'Loading…' : 'Bring back in service',
                    disabled: loading,
                    onPress: () => {
                      Alert.alert(
                        'Bring back in service',
                        'Restore this asset to In Service? It will no longer be marked End of Life.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Restore', onPress: () => updateStatus('In Service') },
                        ]
                      );
                    },
                  },
                  {
                    key: 'dash',
                    icon: 'home',
                    label: 'Back to Dashboard',
                    disabled: loading,
                    onPress: () => router.replace('/(tabs)/dashboard'),
                  },
                ]}
              />
            ) : isAwaitingQr ? (
              <QuickActionRow
                styles={styles}
                actions={[
                  {
                    key: 'scan',
                    icon: 'qr-code-scanner',
                    label: 'Scan QR to assign',
                    disabled: loading,
                    onPress: () => router.push({
                      pathname: '/qr-scanner',
                      params: {
                        intent: 'assign-awaiting-qr',
                        awaitingAssetId: String(asset.id),
                        returnTo: returnTo || '',
                      },
                    }),
                  },
                  {
                    key: 'dash',
                    icon: 'home',
                    label: 'Back to Dashboard',
                    numberOfLines: 1,
                    onPress: () => router.replace('/(tabs)/dashboard'),
                  },
                ]}
              />
            ) : isQRReserved ? (
              <QuickActionRow
                styles={styles}
                actions={[
                  {
                    key: 'swap',
                    icon: 'swap-horiz',
                    label: 'Swap',
                    disabled: loading,
                    onPress: () => setSwapOpen(true),
                  },
                  !!asset?.id && {
                    key: 'assign',
                    icon: 'assignment',
                    label: 'Assign Imported Asset',
                    numberOfLines: 1,
                    adjustsFontSizeToFit: true,
                    minimumFontScale: 0.7,
                    disabled: loading,
                    onPress: () => { setAssignSelected(null); setAssignQuery(''); setAssignOpen(true); if (!assignResults.length) loadImportedAssets(); },
                  },
                  !!asset?.id && {
                    key: 'create-asset',
                    icon: 'add-circle-outline',
                    label: 'Create Asset',
                    disabled: loading,
                    onPress: () => router.push({ pathname: '/asset/new', params: { preselectId: asset.id, returnTo: returnTo || '' } }),
                  },
                  {
                    key: 'dash',
                    icon: 'home',
                    label: 'Back to Dashboard',
                    numberOfLines: 1,
                    onPress: () => router.replace('/(tabs)/dashboard'),
                  },
                ]}
              />
            ) : isPlaceholder ? (
              <QuickActionRow
                styles={styles}
                actions={[
                  !isAssignedToOffice
                    ? {
                        key: 'to-office',
                        testID: 'transfer-to-office-button',
                        icon: 'business',
                        label: loading ? 'Loading...' : 'Transfer to office',
                        disabled: loading,
                        onPress: () => handleAction('checkin'),
                      }
                    : (myUserId && String(asset.assigned_to_id) !== String(myUserId)) && {
                        key: 'to-me',
                        testID: 'transfer-to-me-button',
                        icon: 'person',
                        label: loading ? 'Loading...' : 'Transfer to me',
                        disabled: loading,
                        onPress: () => handleAction('transferToMe'),
                      },
                  {
                    key: 'swap',
                    icon: 'swap-horiz',
                    label: 'Swap',
                    disabled: loading,
                    onPress: () => setSwapOpen(true),
                  },
                  !!asset?.id && {
                    key: 'assign',
                    icon: 'assignment',
                    label: 'Assign Imported Asset',
                    disabled: loading,
                    onPress: () => { setAssignSelected(null); setAssignQuery(''); setAssignOpen(true); if (!assignResults.length) loadImportedAssets(); },
                  },
                  !!asset?.id && {
                    key: 'create-asset',
                    icon: 'add-circle-outline',
                    label: 'Create Asset',
                    disabled: loading,
                    onPress: () => router.push({ pathname: '/asset/new', params: { preselectId: asset.id, returnTo: returnTo || '' } }),
                  },
                  {
                    key: 'note',
                    icon: 'note-add',
                    label: 'Create note',
                    disabled: loading,
                    onPress: () => setShowCreateNoteInput(true),
                  },
                  {
                    key: 'dash',
                    icon: 'home',
                    label: 'Back to Dashboard',
                    numberOfLines: 1,
                    onPress: () => router.replace('/(tabs)/dashboard'),
                  },
                ]}
              />
            ) : (
              /* Quick actions: same style and placement as multi-scan */
              <QuickActionRow
                styles={styles}
                actions={[
                  !isAssignedToOffice
                    ? {
                        key: 'to-office',
                        testID: 'transfer-to-office-button',
                        icon: 'business',
                        label: loading ? 'Loading...' : 'Transfer to office',
                        disabled: loading,
                        onPress: () => handleAction('checkin'),
                      }
                    : (myUserId && String(asset.assigned_to_id) !== String(myUserId)) && {
                        key: 'to-me',
                        testID: 'transfer-to-me-button',
                        icon: 'person',
                        label: loading ? 'Loading...' : 'Transfer to me',
                        disabled: loading,
                        onPress: () => handleAction('transferToMe'),
                      },
                  {
                    key: 'to-user',
                    icon: 'person-add',
                    label: 'Transfer to user',
                    disabled: loading,
                    onPress: openTransferMenu,
                  },
                  (myUserId && String(asset.assigned_to_id) !== String(myUserId) && !isAssignedToOffice) && {
                    key: 'to-me-2',
                    icon: 'person',
                    label: 'Transfer to me',
                    disabled: loading,
                    onPress: () => handleAction('transferToMe'),
                  },
                  !!asset?.id && {
                    key: 'copy',
                    icon: 'content-copy',
                    label: 'Copy Asset',
                    disabled: loading,
                    onPress: () => router.push({ pathname: '/asset/new', params: { fromAssetId: asset.id, returnTo: returnTo || '' } }),
                  },
                  {
                    key: 'note',
                    icon: 'note-add',
                    label: 'Create note',
                    disabled: loading,
                    onPress: () => setShowCreateNoteInput(true),
                  },
                  {
                    key: 'dash',
                    icon: 'home',
                    label: 'Back to Dashboard',
                    numberOfLines: 1,
                    onPress: () => router.replace('/(tabs)/dashboard'),
                  },
                ]}
              />
            )}

          </View>

        </ScrollView>

        {/* Sticky Footer Bar (hide for placeholders, QR Reserved, and EOL) */}
        {!isPlaceholder && !isEOL && !isQRReserved && !isAwaitingQr && (
          <View style={styles.footerBar}>
            <TouchableOpacity
              style={[styles.footerBtn, styles.footerBtnPrimary]}
              onPress={() => { setActionsFormType('Repair'); setActionsFormOpen(true); }}
            >
              <MaterialIcons name="build" size={18} color="#fff" />
              <Text style={styles.footerBtnText} numberOfLines={2}>
                Repair Required
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.footerBtn, styles.footerBtnPrimary]}
              onPress={() => { setActionsFormType('Maintenance'); setActionsFormOpen(true); }}
            >
              <MaterialIcons name="build-circle" size={18} color="#fff" />
              <Text style={styles.footerBtnText} numberOfLines={2}>
                Log Service
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.footerBtn, styles.footerBtnSecondary]}
              onPress={() => setShowOtherModal(true)}
            >
              <MaterialIcons name="more-horiz" size={18} color={Colors.accent} />
              <Text style={[styles.footerBtnText, { color: Colors.accent }]} numberOfLines={2}>
                Other Actions
              </Text>
            </TouchableOpacity>
          </View>
        )}
        </>)}

      </Animated.View>
      <ActionsForm
        visible={actionsFormOpen}
        onClose={() => setActionsFormOpen(false)}
        asset={asset}
        action={actionsFormType}
        apiBaseUrl={API_BASE_URL}
        users={users}
        onSubmitted={(updatedPartial, meta) => {
          // Optimistic UI update
          if (updatedPartial && Object.keys(updatedPartial).length) {
            setAsset(prev => ({ ...prev, ...updatedPartial }));
          }
          postActionAlert({ message: 'Asset updated successfully' });
        }}
      />

      {renderUserModal()}
      {renderOtherActionsModal()}
      {renderCreateNoteModal()}

      {/* Post-action success modal (web) */}
      <ConfirmModal
        visible={!!postActionUi}
        phase="confirm"
        title={postActionUi?.title || 'Success'}
        message={postActionUi?.message || ''}
        confirmLabel={postActionUi?.goLabel || 'Go to Dashboard'}
        confirmTone="primary"
        cancelLabel={postActionUi?.stayLabel || 'Stay here'}
        onConfirm={() => { setPostActionUi(null); postActionUi?.onGo?.(); }}
        onCancel={() => { setPostActionUi(null); postActionUi?.onStay?.(); }}
      />
      {swapOpen && (
        <Modal transparent animationType="slide" visible={swapOpen} onRequestClose={() => setSwapOpen(false)}>
          <View style={styles.sheetBackdrop}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0} style={{ width: '100%' }}>
              <View style={[styles.sheet, { maxHeight: '85%' }]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Swap QR to Existing Asset</Text>
                  <TouchableOpacity onPress={() => setSwapOpen(false)}>
                    <MaterialIcons name="close" size={20} color={Colors.subtle} />
                  </TouchableOpacity>
                </View>

                <ScrollView ref={swapScrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 240, gap: 14 }}>
                  {/* Common search — find an asset by anything */}
                  <View style={styles.optionCard} onLayout={(e) => { lookupSectionYRef.current = e.nativeEvent.layout.y; }}>
                    <View style={styles.optionHeaderRow}>
                      <MaterialIcons name="search" size={18} color={Colors.blue} />
                      <Text style={styles.optionTitle}>Search for an asset</Text>
                    </View>
                    <Text style={styles.optionDesc}>Search by name, type, model, serial, ID or assignee — top 10 matches.</Text>
                    <TextInput
                      placeholder="Search assets…"
                      value={lookupQuery}
                      onChangeText={setLookupQuery}
                      onFocus={scrollToLookup}
                      style={styles.input}
                      placeholderTextColor={Colors.subtle}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    {lookupResults.length > 0 ? renderLookupSuggestions() : null}
                  </View>

                  {/* Option: Asset ID */}
                  <View style={styles.optionCard}>
                    <View style={styles.optionHeaderRow}>
                      <MaterialIcons name="tag" size={18} color={Colors.blue} />
                      <Text style={styles.optionTitle}>Find by Asset ID</Text>
                    </View>
                    <Text style={styles.optionDesc}>Enter the existing Asset ID (QR code or UUID) and we will move that asset onto this QR.</Text>
                    <Text style={styles.fieldLabel}>Asset ID</Text>
                    <TextInput
                      placeholder="e.g. ABCD1234"
                      value={swapIdInput}
                      onChangeText={(t) => setSwapIdInput((t || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
                      style={styles.input}
                      placeholderTextColor={Colors.subtle}
                      autoCapitalize="characters"
                      maxLength={8}
                    />
                    <Text style={styles.fieldHint}>Tip: You can paste the ID from the asset page or scan its QR and copy.</Text>
                    <View style={styles.btnRow}>
                      <TouchableOpacity
                        style={[styles.btnPrimary, { opacity: swapIdInput.trim() ? 1 : 0.6 }]}
                        disabled={!swapIdInput.trim() || loading}
                        onPress={async () => {
                          try {
                            const idTrim = swapIdInput.trim();
                            const qrLike = /^[A-Z0-9]{8}$/;
                            if (!qrLike.test(idTrim)) throw new Error('Asset ID must be 8 characters (A–Z, 0–9).');
                            const confirmed = await new Promise((resolve) => {
                              Alert.alert('Confirm Swap', `Swap assets between ${idTrim} and ${asset?.id}?`, [
                                { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                                { text: 'Confirm', style: 'destructive', onPress: () => resolve(true) },
                              ]);
                            });
                            if (!confirmed) return;
                            setLoading(true);
                            await performSwap(idTrim, asset?.id);
                            setSwapOpen(false);
                            if (returnTo) { try { router.replace(String(returnTo)); } catch { router.back(); } }
                            else { router.replace(`/check-in/${asset?.id}`); }
                            Alert.alert('Success', 'QR swapped successfully.');
                          } catch (e) {
                            Alert.alert('Error', e.message || 'Failed to swap');
                          } finally { setLoading(false); }
                        }}
                      >
                        <MaterialIcons name="swap-horiz" size={18} color="#fff" />
                        <Text style={styles.btnPrimaryText}>Swap Now</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Option 2: Scan QR */}
                  <View style={styles.optionCard}>
                    <View style={styles.optionHeaderRow}>
                      <MaterialIcons name="qr-code-scanner" size={18} color={Colors.blue} />
                      <Text style={styles.optionTitle}>Scan QR</Text>
                    </View>
                    <Text style={styles.optionDesc}>Scan the QR of an existing asset and we will move it onto this QR.</Text>
                    <View style={styles.btnRow}>
                      <TouchableOpacity
                        style={[styles.btnGhost]}
                        onPress={() => router.push({ pathname: '/qr-scanner', params: { intent: 'swap-target', placeholderId: asset?.id, returnTo: returnTo || '' } })}
                      >
                        <MaterialIcons name="qr-code" size={18} color={Colors.blue} />
                        <Text style={styles.btnGhostText}>Open Scanner</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={{ height: 8 }} />
                  <TouchableOpacity style={[styles.btnGhost, { alignSelf: 'center' }]} onPress={() => setSwapOpen(false)}>
                    <MaterialIcons name="close" size={18} color={Colors.slate} />
                    <Text style={styles.btnGhostText}>Close</Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>
            </KeyboardAvoidingView>
          </View>
        </Modal>
      )}

      {assignOpen && (
        <Modal transparent animationType="slide" visible={assignOpen} onRequestClose={() => setAssignOpen(false)}>
          <View style={styles.sheetBackdrop}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0} style={{ width: '100%' }}>
              <View style={[styles.sheet, { maxHeight: '85%' }]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Assign Imported Asset</Text>
                  <TouchableOpacity onPress={() => setAssignOpen(false)}>
                    <MaterialIcons name="close" size={20} color={Colors.subtle} />
                  </TouchableOpacity>
                </View>

                <ScrollView
                  contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, gap: 14 }}
                  keyboardShouldPersistTaps="always"
                  keyboardDismissMode="none"
                >
                  <View style={styles.optionCard}>
                    <View style={styles.optionHeaderRow}>
                      <MaterialIcons name="search" size={18} color={Colors.blue} />
                      <Text style={styles.optionTitle}>Find Imported Asset</Text>
                    </View>
                    <Text style={styles.optionDesc}>Pick an imported asset (UUID id) to assign to this QR. We will move its data onto this QR id and reset the original record to a placeholder.</Text>
                    <TextInput
                      placeholder="Search by model, type, serial, other id, notes"
                      value={assignQuery}
                      onChangeText={setAssignQuery}
                      style={[styles.input, { borderColor: Colors.amber, borderWidth: 2, backgroundColor: '#FFFBF0' }]}
                      placeholderTextColor={Colors.subtle}
                      autoFocus={true}
                    />
                    <View style={{ marginTop: 8 }}>
                      {assignLoading ? (
                        <ActivityIndicator />
                      ) : (
                        <FlatList
                          data={filteredAssignResults}
                          keyExtractor={(item) => String(item.id)}
                          style={{ maxHeight: 500 }}
                          contentContainerStyle={{ paddingBottom: 8 }}
                          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                          scrollEnabled={filteredAssignResults.length > 5}
                          keyboardShouldPersistTaps="always"
                          keyboardDismissMode="none"
                          renderItem={({ item }) => (
                            <TouchableOpacity
                              style={[
                                styles.optionCard,
                                { padding: 12, borderColor: assignSelected?.id === item.id ? Colors.amber : Colors.border },
                              ]}
                              onPress={() => {
                                setAssignSelected(item);
                              }}
                              activeOpacity={0.7}
                              delayPressIn={0}
                            >
                              <Text style={{ fontWeight: '700', color: Colors.text }}>{item.model || 'Unnamed'}</Text>
                              <Text style={{ fontWeight: '700', color: Colors.subtle, marginTop: 2 }}>
                                {(item.asset_types?.name || 'Unknown type')}
                              </Text>
                              {item.serial_number ? (
                                <Text style={{ fontWeight: '700', color: Colors.subtle, marginTop: 2 }}>SN: {item.serial_number}</Text>
                              ) : null}
                              {item.other_id ? (
                                <Text style={{ fontWeight: '700', color: Colors.muted, marginTop: 2 }}>Other ID: {item.other_id}</Text>
                              ) : null}
                            </TouchableOpacity>
                          )}
                          ListEmptyComponent={() => (
                            <Text style={{ color: Colors.muted, textAlign: 'center', paddingVertical: 16 }}>No matches</Text>
                          )}
                        />
                      )}
                    </View>
                  </View>
                </ScrollView>

                {/* Confirm bar - Fixed at bottom */}
                <View style={{
                  flexDirection: 'row',
                  gap: 10,
                  paddingHorizontal: 16,
                  paddingTop: 12,
                  paddingBottom: Platform.OS === 'ios' ? 20 : 14,
                  backgroundColor: Colors.card,
                  borderTopWidth: 1,
                  borderTopColor: Colors.border,
                }}>
                  <TouchableOpacity
                    style={[styles.footerBtn, { backgroundColor: Colors.slate, flex: 1, opacity: assignLoading ? 0.6 : 1 }]}
                    disabled={assignLoading}
                    onPress={() => { setAssignOpen(false); setAssignSelected(null); }}
                  >
                    <MaterialIcons name="close" size={20} color="#FFFFFF" />
                    <Text style={styles.footerBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.footerBtn, { backgroundColor: Colors.amber, flex: 1, opacity: (!assignSelected || assignLoading) ? 0.6 : 1 }]}
                    disabled={!assignSelected || assignLoading}
                    onPress={() => assignSelected && handleAssignToPlaceholder(assignSelected.id)}
                  >
                    <MaterialIcons name="qr-code" size={20} color="#FFFFFF" />
                    <Text style={styles.footerBtnText}>Assign</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAvoidingView>
          </View>
        </Modal>
      )}

      {assignPhysicalOpen && (
        <Modal transparent animationType="slide" visible={assignPhysicalOpen} onRequestClose={() => setAssignPhysicalOpen(false)}>
          <View style={styles.sheetBackdrop}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0} style={{ width: '100%' }}>
              <View style={[styles.sheet, { maxHeight: '85%' }]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Choose blank QR</Text>
                  <TouchableOpacity onPress={() => setAssignPhysicalOpen(false)}>
                    <MaterialIcons name="close" size={20} color={Colors.subtle} />
                  </TouchableOpacity>
                </View>

                <ScrollView
                  contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, gap: 14 }}
                  keyboardShouldPersistTaps="always"
                  keyboardDismissMode="none"
                >
                  <View style={styles.optionCard}>
                    <View style={styles.optionHeaderRow}>
                      <MaterialIcons name="search" size={18} color={Colors.blue} />
                      <Text style={styles.optionTitle}>Unused 8-character IDs</Text>
                    </View>
                    <Text style={styles.optionDesc}>
                      Only blank stickers (no model, type, or assignment yet) are listed. Select one to move this asset onto that QR.
                    </Text>
                    <TextInput
                      placeholder="Filter by ID…"
                      value={assignPhysicalQuery}
                      onChangeText={setAssignPhysicalQuery}
                      style={[styles.input, { borderColor: Colors.accent, borderWidth: 2, backgroundColor: Colors.accentLight }]}
                      placeholderTextColor={Colors.subtle}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      autoFocus
                    />
                    <View style={{ marginTop: 8 }}>
                      {assignPhysicalLoading ? (
                        <ActivityIndicator />
                      ) : (
                        <FlatList
                          data={filteredAssignPhysicalList}
                          keyExtractor={(item) => String(item.id)}
                          style={{ maxHeight: 500 }}
                          contentContainerStyle={{ paddingBottom: 8 }}
                          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                          scrollEnabled={filteredAssignPhysicalList.length > 5}
                          keyboardShouldPersistTaps="always"
                          keyboardDismissMode="none"
                          renderItem={({ item }) => (
                            <TouchableOpacity
                              style={[
                                styles.optionCard,
                                { padding: 12, borderColor: assignPhysicalSelected?.id === item.id ? Colors.accent : Colors.border },
                              ]}
                              onPress={() => setAssignPhysicalSelected(item)}
                              activeOpacity={0.7}
                              delayPressIn={0}
                            >
                              <Text style={{ fontWeight: '800', color: Colors.text, fontSize: sf(16) }}>{item.id}</Text>
                              <Text style={{ color: Colors.subtle, marginTop: 4 }}>Blank · Available</Text>
                            </TouchableOpacity>
                          )}
                          ListEmptyComponent={() => (
                            <Text style={{ color: Colors.muted, textAlign: 'center', paddingVertical: 16 }}>
                              {assignPhysicalList.length === 0 && !assignPhysicalLoading
                                ? 'No blank QR codes found. Generate stickers in admin, then refresh.'
                                : 'No matches for this filter.'}
                            </Text>
                          )}
                        />
                      )}
                    </View>
                  </View>
                </ScrollView>

                <View style={{
                  flexDirection: 'row',
                  gap: 10,
                  paddingHorizontal: 16,
                  paddingTop: 12,
                  paddingBottom: Platform.OS === 'ios' ? 20 : 14,
                  backgroundColor: Colors.card,
                  borderTopWidth: 1,
                  borderTopColor: Colors.border,
                }}>
                  <TouchableOpacity
                    style={[styles.footerBtn, { backgroundColor: Colors.slate, flex: 1, opacity: assignPhysicalLoading ? 0.6 : 1 }]}
                    disabled={assignPhysicalLoading}
                    onPress={() => { setAssignPhysicalOpen(false); setAssignPhysicalSelected(null); }}
                  >
                    <MaterialIcons name="close" size={20} color="#FFFFFF" />
                    <Text style={styles.footerBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.footerBtn, { backgroundColor: Colors.accent, flex: 1, opacity: (!assignPhysicalSelected || assignPhysicalLoading) ? 0.6 : 1 }]}
                    disabled={!assignPhysicalSelected || assignPhysicalLoading}
                    onPress={() => assignPhysicalSelected && handleAssignPhysicalToSticker(assignPhysicalSelected.id)}
                  >
                    <MaterialIcons name="qr-code-2" size={20} color="#FFFFFF" />
                    <Text style={styles.footerBtnText}>Assign</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAvoidingView>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

// ---------- Styles ----------
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.bg },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },

  headerCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.line,
    padding: 16,
    marginBottom: 12,
    ...Shadows.card,
  },
  heroIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.line,
  },
  pageTitle: { color: Colors.text, fontSize: sf(20), fontWeight: '800' },
  pageSubtitle: { color: Colors.subtle, fontSize: sf(13), marginTop: 2 },

  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.line,
    padding: 16,
    marginBottom: 16,
    ...Shadows.card,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  assetTitle: { color: Colors.text, fontSize: sf(18), fontWeight: '700' },
  assetSerial: { color: Colors.subtle, fontSize: sf(14), marginTop: 4, fontWeight: '500' },
  idPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primary,
    borderWidth: 0,
  },
  idPillText: { color: '#FFFFFF', fontWeight: '700', letterSpacing: 0.4, fontSize: sf(12) },

  infoGrid: { flexDirection: 'row', marginTop: 14 },
  infoCell: { flex: 1, paddingRight: 12 },
  infoLabel: { color: Colors.subtle, fontSize: sf(12), letterSpacing: 0.4 },
  infoValue: { color: Colors.text, fontSize: sf(15), fontWeight: '700', marginTop: 2, flexShrink: 1 },

  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: sf(12), fontWeight: '800', letterSpacing: 0.4 },

  sectionTitle: { color: Colors.subtle, fontSize: sf(14), fontWeight: '700', marginBottom: 10, marginTop: 6, letterSpacing: 0.5 },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    flexBasis: '48%',
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.line,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 60,
    ...Shadows.card,
  },
  /* Multi-scan style: primary and secondary action buttons */
  quickActionBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  quickActionBtn: {
    width: '47%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
  },
  quickActionBtnPrimary: { backgroundColor: Colors.primary },
  quickActionBtnSecondary: { backgroundColor: Colors.card, borderWidth: 2, borderColor: Colors.accent },
  quickActionBtnNeutral: {
    backgroundColor: Colors.primary,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  quickActionBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: sf(14), flexShrink: 1, textAlign: 'center' },
  quickActionBtnTextSecondary: { color: Colors.accent, fontWeight: '800', fontSize: sf(14), letterSpacing: 0.2, flexShrink: 1, textAlign: 'center' },
  quickActionBtnTextNeutral: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: sf(14),
    flexShrink: 1,
    textAlign: 'center',
    flexShrink: 1,
    minWidth: 0,
  },
  tileText: {
    color: Colors.text,
    fontWeight: '700',
    fontSize: Platform.select({
      ios: sf(13),
      android: sf(13),
      default: sf(14),
    }),
    textAlign: 'center',
    includeFontPadding: false, // Android: remove extra padding
  },
  backToDashboardTile: {
    backgroundColor: Colors.chip,
    borderColor: Colors.lineStrong,
    paddingHorizontal: 12,
  },
  backToDashboardText: {
    color: Colors.primary,
  },
  backToScanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 2,
    borderColor: Colors.accent,
    backgroundColor: Colors.accentLight,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    maxWidth: '100%',
    ...Shadows.card,
  },
  backToScanText: {
    color: Colors.accent,
    fontWeight: '800',
    fontSize: Platform.select({
      ios: sf(12),
      android: sf(12),
      default: sf(13),
    }),
    textAlign: 'center',
    includeFontPadding: false,
    letterSpacing: 0.3,
    flexShrink: 1,
  },

  footerBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    backgroundColor: Colors.bg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  footerBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  footerBtnPrimary: { backgroundColor: Colors.primary },
  footerBtnSecondary: { backgroundColor: Colors.card, borderWidth: 2, borderColor: Colors.accent },
  footerBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: Platform.select({
      ios: sf(12),
      android: sf(12),
      default: sf(14),
    }),
    textAlign: 'center',
    flexShrink: 1,
    includeFontPadding: false, // Android: remove extra padding
  },

  // Modal / Bottom Sheet (light)
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    maxHeight: '80%',
  },
  userModalSheet: {
    maxHeight: '90%',
  },
  createNoteSheet: {
    borderRadius: 18,
    width: '100%',
    minHeight: 317,
    maxHeight: '90%',
    overflow: 'hidden',
  },
  createNoteContent: {
    paddingHorizontal: 16,
    paddingBottom: 28,
    paddingTop: 4,
  },
  createNoteSubmitBtn: {
    marginTop: 12,
    alignSelf: 'flex-start',
    maxWidth: 160,
  },
  sheetHandle: {
    width: 44,
    height: 5,
    backgroundColor: Colors.border,
    borderRadius: 999,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  modalTitle: { color: Colors.text, fontSize: sf(16), fontWeight: '800' },
  fieldLabel: { color: Colors.subtle, fontSize: sf(12), marginTop: 6, marginBottom: 4, letterSpacing: 0.3 },
  fieldHint: { color: Colors.subtle, fontSize: sf(12), marginTop: 6 },
  input: {
    borderWidth: 2,
    borderColor: Colors.line,
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    color: Colors.text,
  },
  optionCard: {
    backgroundColor: Colors.card,
    borderWidth: 2,
    borderColor: Colors.line,
    borderRadius: Radius.lg,
    padding: 14,
  },
  optionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  optionTitle: { color: Colors.text, fontWeight: '800', fontSize: sf(14) },
  optionDesc: { color: Colors.subtle, marginBottom: 8 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  btnPrimary: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 10, paddingHorizontal: 14,
  },
  btnPrimaryText: { color: '#fff', fontWeight: '800' },
  btnGhost: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 2, borderColor: Colors.line, borderRadius: Radius.md,
    paddingVertical: 10, paddingHorizontal: 14,
  },
  btnGhostText: { color: Colors.primary, fontWeight: '800' },
  searchContainer: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: Radius.pill,
    borderWidth: 2,
    borderColor: Colors.line,
    backgroundColor: Colors.chip,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchInput: { flex: 1, height: 40, color: Colors.text },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  userName: { color: Colors.text, fontWeight: '700' },
  userEmail: { color: Colors.subtle, marginTop: 2, fontSize: sf(12) },

  avatar: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    backgroundColor: Colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.line,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
  },

  infoCell: {
    flex: 1,
    paddingRight: 12,
  },

  infoCellRight: {
    alignItems: 'flex-end',   // <-- key: push content to the right
    paddingRight: 0,
  },

  textRight: {
    textAlign: 'right',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  actionText: {
    color: Colors.text,
    fontWeight: '700',
    fontSize: sf(16),
  },

  // ─── Web two-column layout ───
  webContainer: {
    maxWidth: 1100,
    width: '100%',
    alignSelf: 'center',
    padding: 28,
    paddingBottom: 48,
    minHeight: '100%',
  },
  webPageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
    flexWrap: 'wrap',
    gap: 12,
  },
  webNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.md,
    borderWidth: 2,
    borderColor: Colors.line,
    backgroundColor: Colors.card,
  },
  webNavBtnText: {
    color: Colors.primary,
    fontWeight: '700',
    fontSize: sf(14),
  },
  webBody: {
    flexDirection: 'row',
    gap: 20,
    alignItems: 'flex-start',
  },
  webInfoPanel: {
    width: 280,
    flexShrink: 0,
  },
  webActionsPanel: {
    flex: 1,
    gap: 0,
  },
  webSectionLabel: {
    color: Colors.subtle,
    fontSize: sf(11),
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 2,
  },
  webInfoCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.line,
    padding: 18,
    ...Shadows.card,
  },
  webAssetType: {
    color: Colors.text,
    fontSize: sf(18),
    fontWeight: '800',
    marginBottom: 4,
  },
  webAssetId: {
    color: Colors.primary,
    fontSize: sf(13),
    fontWeight: '700',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  webAssetSerial: {
    color: Colors.subtle,
    fontSize: sf(13),
    fontWeight: '500',
  },
  webInfoDivider: {
    height: 1,
    backgroundColor: Colors.line,
    marginVertical: 14,
  },
  webInfoLabel: {
    color: Colors.subtle,
    fontSize: sf(12),
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  webInfoValue: {
    color: Colors.text,
    fontSize: sf(15),
    fontWeight: '700',
    flexShrink: 1,
  },
  webEolNote: {
    color: Colors.subtle,
    fontSize: sf(14),
    lineHeight: 20,
  },
  webActionGroup: {
    marginBottom: 20,
  },
  webActionCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.line,
    overflow: 'hidden',
    ...Shadows.card,
  },
  webActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  webActionRowLast: {
    borderBottomWidth: 0,
  },
  webActionIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  webActionInfo: {
    flex: 1,
    gap: 2,
  },
  webActionLabel: {
    color: Colors.text,
    fontSize: sf(15),
    fontWeight: '700',
  },
  webActionDesc: {
    color: Colors.subtle,
    fontSize: sf(12),
    fontWeight: '400',
  },

});
