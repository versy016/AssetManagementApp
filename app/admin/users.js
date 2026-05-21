// app/admin/users.js
// Admin User Management — domain-scoped, ADMIN-only.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { auth } from '../../firebaseConfig';
import { onAuthStateChanged } from 'firebase/auth';
import { MaterialIcons } from '@expo/vector-icons';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import { Colors, Radius, Shadows, sf } from '../../constants/uiTheme';
import ConfirmModal from '../../components/ui/ConfirmModal';
import logger from '../../utils/logger';
import { TourTarget } from '../../components/TourGuide';

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function buildHeaders() {
  const u = auth.currentUser;
  if (!u) throw new Error('Not authenticated');
  // getIdToken() returns the cached token instantly and auto-refreshes when expired.
  const token = await u.getIdToken();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-User-Id': u.uid };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isWeb = Platform.OS === 'web';

// ─── Chips ────────────────────────────────────────────────────────────────────
const STATUS_META = {
  ACTIVE:   { dot: '#16A34A', fg: '#15803D', bg: '#F0FDF4', border: '#BBF7D0', label: 'Active'   },
  INVITED:  { dot: '#2563EB', fg: '#1D4ED8', bg: '#EFF6FF', border: '#BFDBFE', label: 'Invited'  },
  DISABLED: { dot: '#9CA3AF', fg: '#6B7280', bg: '#F9FAFB', border: '#E5E7EB', label: 'Disabled' },
};
const ROLE_META = {
  ADMIN: { fg: '#C2410C', bg: '#FFF7ED', border: '#FED7AA', label: 'Admin' },
  USER:  { fg: Colors.sub, bg: Colors.bg,  border: Colors.line, label: 'User'  },
};

function StatusChip({ status }) {
  const m = STATUS_META[status] || STATUS_META.DISABLED;
  return (
    <View style={[chip.base, { backgroundColor: m.bg, borderColor: m.border }]}>
      <View style={[chip.dot, { backgroundColor: m.dot }]} />
      <Text style={[chip.txt, { color: m.fg }]}>{m.label}</Text>
    </View>
  );
}

function RoleChip({ role }) {
  const m = ROLE_META[role] || ROLE_META.USER;
  return (
    <View style={[chip.base, { backgroundColor: m.bg, borderColor: m.border }]}>
      <Text style={[chip.txt, { color: m.fg }]}>{m.label}</Text>
    </View>
  );
}

const chip = StyleSheet.create({
  base: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start',                   // ← KEY: never stretch to parent width
    paddingHorizontal: 9, paddingVertical: 4,
    borderRadius: Radius.pill, borderWidth: 1.5,
  },
  dot:  { width: 6, height: 6, borderRadius: 3 },
  txt:  { fontSize: sf(11), fontWeight: '700', letterSpacing: 0.3 },
});

// ─── Invite modal ─────────────────────────────────────────────────────────────
function InviteModal({ visible, domain, onClose, onInvited }) {
  const [email, setEmail] = useState('');
  const [name,  setName]  = useState('');
  const [role,  setRole]  = useState('USER');
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState('');

  const reset = () => { setEmail(''); setName(''); setRole('USER'); setError(''); setBusy(false); };
  const close  = () => { reset(); onClose(); };

  const submit = async () => {
    setError('');
    const e = email.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) { setError('Enter a valid email address.'); return; }
    setBusy(true);
    try {
      const h = await buildHeaders();
      const r = await fetch(`${API_BASE_URL}/admin/users/invite`, {
        method: 'POST', headers: h,
        body: JSON.stringify({ email: e, name: name.trim() || undefined, role }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Invite failed');
      reset(); onInvited(d.user);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <KeyboardAvoidingView style={im.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={close} />
        <View style={im.card}>
          {/* Header */}
          <View style={im.hdr}>
            <View>
              <Text style={im.title}>Invite team member</Text>
              {!!domain && <Text style={im.domTxt}>Invites restricted to @{domain}</Text>}
            </View>
            <TouchableOpacity onPress={close} hitSlop={10}><MaterialIcons name="close" size={20} color={Colors.sub2} /></TouchableOpacity>
          </View>

          <Text style={im.label}>Email *</Text>
          <TextInput style={im.input} value={email} onChangeText={setEmail}
            placeholder={`name@${domain || 'company.com'}`}
            autoCapitalize="none" keyboardType="email-address" autoCorrect={false} />

          <Text style={im.label}>Display name (optional)</Text>
          <TextInput style={im.input} value={name} onChangeText={setName}
            placeholder="Full name" autoCapitalize="words" />

          <Text style={im.label}>Role</Text>
          <View style={im.roleRow}>
            {[
              { key: 'USER',  icon: 'person',                label: 'Standard user', desc: 'Can view & manage assets' },
              { key: 'ADMIN', icon: 'admin-panel-settings',  label: 'Admin',         desc: 'Full admin access' },
            ].map((r) => (
              <TouchableOpacity key={r.key} onPress={() => setRole(r.key)}
                style={[im.roleOpt, role === r.key && im.roleOptOn]}>
                <MaterialIcons name={r.icon} size={18} color={role === r.key ? Colors.accent : Colors.sub2} />
                <View style={{ flex: 1 }}>
                  <Text style={[im.roleLabel, role === r.key && { color: Colors.accent }]}>{r.label}</Text>
                  <Text style={im.roleDesc}>{r.desc}</Text>
                </View>
                {role === r.key && <MaterialIcons name="check-circle" size={16} color={Colors.accent} />}
              </TouchableOpacity>
            ))}
          </View>

          {!!error && (
            <View style={im.errBox}>
              <MaterialIcons name="error-outline" size={15} color={Colors.dangerFg} />
              <Text style={im.errTxt}>{error}</Text>
            </View>
          )}

          <View style={im.btns}>
            <TouchableOpacity onPress={close} style={im.cancelBtn} disabled={busy}>
              <Text style={im.cancelTxt}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={submit} style={[im.sendBtn, busy && { opacity: 0.6 }]} disabled={busy}>
              {busy
                ? <ActivityIndicator size="small" color="#fff" />
                : <><MaterialIcons name="send" size={15} color="#fff" /><Text style={im.sendTxt}>Send invite</Text></>
              }
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const im = StyleSheet.create({
  overlay:   { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(15,23,42,0.55)', padding: 20 },
  card:      { backgroundColor: Colors.card, borderRadius: Radius.xl, padding: 24, width: '100%', maxWidth: 460, borderWidth: 1.5, borderColor: Colors.line, ...Shadows.lg, zIndex: 10 },
  hdr:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 },
  title:     { fontSize: sf(16), fontWeight: '900', color: Colors.primary, marginBottom: 2 },
  domTxt:    { fontSize: sf(11), color: Colors.sub2 },
  label:     { fontSize: sf(11), fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, color: Colors.sub2, marginBottom: 5, marginTop: 14 },
  input:     { borderWidth: 1.5, borderColor: Colors.line, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: sf(14), color: Colors.text, backgroundColor: Colors.bg, ...(isWeb ? { outlineStyle: 'none' } : {}) },
  roleRow:   { gap: 8 },
  roleOpt:   { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.line, backgroundColor: Colors.bg },
  roleOptOn: { borderColor: Colors.accent, backgroundColor: '#FFF7ED' },
  roleLabel: { fontSize: sf(13), fontWeight: '700', color: Colors.text, marginBottom: 1 },
  roleDesc:  { fontSize: sf(11), color: Colors.sub2 },
  errBox:    { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 12, backgroundColor: Colors.dangerBg, borderRadius: Radius.md, padding: 10, borderWidth: 1, borderColor: Colors.dangerBorder },
  errTxt:    { flex: 1, fontSize: sf(13), color: Colors.dangerFg, lineHeight: 18 },
  btns:      { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelBtn: { flex: 1, paddingVertical: 11, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.line, alignItems: 'center', backgroundColor: Colors.bg },
  cancelTxt: { fontSize: sf(13), fontWeight: '700', color: Colors.sub },
  sendBtn:   { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: Radius.md, backgroundColor: Colors.primary },
  sendTxt:   { fontSize: sf(13), fontWeight: '800', color: '#fff' },
});

// ─── Action configs ───────────────────────────────────────────────────────────
const ACTION = {
  promote: { title: 'Promote to Admin?', msg: (u) => `${u.name || u.useremail} will gain admin access.`,          label: 'Promote',   tone: 'primary', loading: 'Promoting…',   method: 'PATCH', url: (u) => `${API_BASE_URL}/admin/users/${u.id}/role`,   body: () => ({ role: 'ADMIN' })        },
  demote:  { title: 'Remove Admin?',     msg: (u) => `${u.name || u.useremail} will become a standard user.`,     label: 'Demote',    tone: 'danger',  loading: 'Demoting…',    method: 'PATCH', url: (u) => `${API_BASE_URL}/admin/users/${u.id}/role`,   body: () => ({ role: 'USER' })         },
  disable: { title: 'Disable account?', msg: (u) => `${u.name || u.useremail} won't be able to log in.`,          label: 'Disable',   tone: 'danger',  loading: 'Disabling…',   method: 'PATCH', url: (u) => `${API_BASE_URL}/admin/users/${u.id}/status`, body: () => ({ status: 'DISABLED' })   },
  enable:  { title: 'Re-enable account?',msg: (u) => `${u.name || u.useremail} will regain login access.`,        label: 'Re-enable', tone: 'primary', loading: 'Re-enabling…', method: 'PATCH', url: (u) => `${API_BASE_URL}/admin/users/${u.id}/status`, body: () => ({ status: 'ACTIVE' })     },
};

// ─── Row action buttons ───────────────────────────────────────────────────────
function ActionButtons({ user, onAction, compact = false }) {
  const off = user.status === 'DISABLED';
  const S = compact ? ab.compact : ab.normal;
  return (
    <View style={ab.row}>
      {!off && (
        user.role === 'ADMIN'
          ? <TouchableOpacity onPress={() => onAction('demote',  user)} style={[S, ab.warn]}>
              <MaterialIcons name="arrow-downward" size={compact ? 12 : 13} color="#92400E" />
              <Text style={[ab.txt, { color: '#92400E' }]}>Demote</Text>
            </TouchableOpacity>
          : <TouchableOpacity onPress={() => onAction('promote', user)} style={[S, ab.blue]}>
              <MaterialIcons name="arrow-upward"   size={compact ? 12 : 13} color={Colors.primary} />
              <Text style={[ab.txt, { color: Colors.primary }]}>Promote</Text>
            </TouchableOpacity>
      )}
      {off
        ? <TouchableOpacity onPress={() => onAction('enable',  user)} style={[S, ab.green]}>
            <MaterialIcons name="play-circle-outline" size={compact ? 12 : 13} color="#15803D" />
            <Text style={[ab.txt, { color: '#15803D' }]}>Re-enable</Text>
          </TouchableOpacity>
        : <TouchableOpacity onPress={() => onAction('disable', user)} style={[S, ab.red]}>
            <MaterialIcons name="block"               size={compact ? 12 : 13} color={Colors.dangerFg} />
            <Text style={[ab.txt, { color: Colors.dangerFg }]}>Disable</Text>
          </TouchableOpacity>
      }
    </View>
  );
}
const ab = StyleSheet.create({
  row:     { flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  normal:  { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.md, borderWidth: 1.5 },
  compact: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9,  paddingVertical: 5, borderRadius: Radius.md, borderWidth: 1.5 },
  txt:     { fontSize: sf(12), fontWeight: '700' },
  blue:    { borderColor: Colors.primaryLight, backgroundColor: Colors.primaryPill },
  warn:    { borderColor: '#FDE68A',           backgroundColor: '#FFFBEB' },
  green:   { borderColor: '#BBF7D0',           backgroundColor: '#F0FDF4' },
  red:     { borderColor: Colors.dangerBorder, backgroundColor: Colors.dangerBg  },
});

// ─── Avatar helper ────────────────────────────────────────────────────────────
function initials(user) {
  const src = user.name || user.useremail || '?';
  return src.split(/[\s@]+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

// ─── Web table ────────────────────────────────────────────────────────────────
// Fixed-width Role + Status columns so chips never stretch.
const COL = { user: { flex: 1 }, role: { width: 100 }, status: { width: 120 }, actions: { width: 220 } };

function WebTableHeader() {
  return (
    <View style={wt.hdr}>
      <Text style={[wt.hdrTxt, COL.user]}>User</Text>
      <Text style={[wt.hdrTxt, COL.role]}>Role</Text>
      <Text style={[wt.hdrTxt, COL.status]}>Status</Text>
      <Text style={[wt.hdrTxt, COL.actions, { textAlign: 'right' }]}>Actions</Text>
    </View>
  );
}

function WebRow({ user, currentUserId, onAction, odd }) {
  const self = user.id === currentUserId;
  return (
    <View style={[wt.row, odd && wt.odd]}>
      {/* User */}
      <View style={[wt.cell, COL.user, { flexDirection: 'row', alignItems: 'center', gap: 11 }]}>
        <View style={wt.av}>
          <Text style={wt.avTxt}>{initials(user)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={wt.name} numberOfLines={1}>{user.name || '—'}</Text>
            {self && <Text style={wt.selfTag}>you</Text>}
          </View>
          <Text style={wt.email} numberOfLines={1}>{user.useremail}</Text>
          {user.invitedBy && <Text style={wt.invBy} numberOfLines={1}>Invited by {user.invitedBy.name || user.invitedBy.useremail}</Text>}
        </View>
      </View>
      {/* Role */}
      <View style={[wt.cell, COL.role]}><RoleChip role={user.role} /></View>
      {/* Status */}
      <View style={[wt.cell, COL.status]}><StatusChip status={user.status} /></View>
      {/* Actions */}
      <View style={[wt.cell, COL.actions, { justifyContent: 'flex-end' }]}>
        {self
          ? <Text style={wt.selfNote}>Your account</Text>
          : <ActionButtons user={user} onAction={onAction} compact />
        }
      </View>
    </View>
  );
}

const wt = StyleSheet.create({
  hdr:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 20, backgroundColor: '#F1F5F9', borderBottomWidth: 1.5, borderBottomColor: Colors.line },
  hdrTxt:  { fontSize: sf(10), fontWeight: '800', color: Colors.sub2, textTransform: 'uppercase', letterSpacing: 0.7 },
  row:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: Colors.line, minHeight: 58 },
  odd:     { backgroundColor: '#FAFAFA' },
  cell:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingRight: 12 },
  av:      { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avTxt:   { fontSize: sf(12), fontWeight: '900', color: Colors.primary },
  name:    { fontSize: sf(13), fontWeight: '700', color: Colors.text },
  selfTag: { fontSize: sf(10), color: Colors.sub2, backgroundColor: Colors.chip, paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.pill },
  email:   { fontSize: sf(12), color: Colors.sub, marginTop: 1 },
  invBy:   { fontSize: sf(11), color: Colors.sub2 },
  selfNote:{ fontSize: sf(12), color: Colors.sub2, fontStyle: 'italic' },
});

// ─── Mobile card ──────────────────────────────────────────────────────────────
function MobileCard({ user, currentUserId, onAction }) {
  const self = user.id === currentUserId;
  return (
    <View style={mc.card}>
      <View style={mc.top}>
        <View style={mc.av}>
          <Text style={mc.avTxt}>{initials(user)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text style={mc.name} numberOfLines={1}>{user.name || '—'}</Text>
            {self && <Text style={mc.selfTag}>you</Text>}
          </View>
          <Text style={mc.email} numberOfLines={1}>{user.useremail}</Text>
          {user.invitedBy && <Text style={mc.invBy}>Invited by {user.invitedBy.name || user.invitedBy.useremail}</Text>}
        </View>
        {/* Chips stacked right */}
        <View style={mc.chips}>
          <RoleChip role={user.role} />
          <StatusChip status={user.status} />
        </View>
      </View>
      {!self && (
        <View style={mc.foot}>
          <ActionButtons user={user} onAction={onAction} />
        </View>
      )}
    </View>
  );
}
const mc = StyleSheet.create({
  card:    { backgroundColor: Colors.card, borderRadius: Radius.lg, marginHorizontal: 14, marginBottom: 8, borderWidth: 1.5, borderColor: Colors.line, overflow: 'hidden', ...Shadows.card },
  top:     { flexDirection: 'row', alignItems: 'flex-start', gap: 11, padding: 14 },
  av:      { width: 42, height: 42, borderRadius: 21, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avTxt:   { fontSize: sf(14), fontWeight: '900', color: Colors.primary },
  name:    { fontSize: sf(14), fontWeight: '800', color: Colors.text },
  selfTag: { fontSize: sf(10), color: Colors.sub2, backgroundColor: Colors.chip, paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.pill },
  email:   { fontSize: sf(12), color: Colors.sub, marginTop: 2 },
  invBy:   { fontSize: sf(11), color: Colors.sub2, marginTop: 2 },
  chips:   { gap: 5, alignItems: 'flex-end', flexShrink: 0 },
  foot:    { flexDirection: 'row', gap: 8, flexWrap: 'wrap', paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: Colors.line, backgroundColor: Colors.bg },
});

// ─── Filter pill ──────────────────────────────────────────────────────────────
function Pill({ label, active, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={[fp.pill, active && fp.on]}>
      <Text style={[fp.txt, active && fp.txtOn]}>{label}</Text>
    </TouchableOpacity>
  );
}
const fp = StyleSheet.create({
  pill: { paddingHorizontal: 13, paddingVertical: 5, borderRadius: Radius.pill, borderWidth: 1.5, borderColor: Colors.line, backgroundColor: Colors.bg },
  on:   { backgroundColor: Colors.primary, borderColor: Colors.primaryDark },
  txt:  { fontSize: sf(12), fontWeight: '700', color: Colors.sub },
  txtOn:{ color: '#fff' },
});

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function AdminUsers() {
  const router = useRouter();
  const [loading,       setLoading]       = useState(true);
  const [isAdmin,       setIsAdmin]       = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [domain,        setDomain]        = useState('');

  const [users,    setUsers]    = useState([]);
  const [counts,   setCounts]   = useState(null);
  const [fetching, setFetching] = useState(false);
  const [search,   setSearch]   = useState('');
  const [sfilt,    setSfilt]    = useState('');   // status filter
  const [rfilt,    setRfilt]    = useState('');   // role filter
  const timer = useRef(null);

  const [showInvite, setShowInvite] = useState(false);
  const [confirmUi,  setConfirmUi]  = useState(null);

  // ── Auth ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      try {
        if (!u) { router.replace('/login'); return; }
        setCurrentUserId(u.uid);
        const r = await fetch(`${API_BASE_URL}/users/${u.uid}`);
        const db = r.ok ? await r.json() : null;
        if (db?.role !== 'ADMIN') { setLoading(false); return; }
        setIsAdmin(true);
        setDomain(db.domain || (db.useremail ? db.useremail.split('@')[1] : '') || '');
      } catch (e) { logger.error('[AdminUsers] auth:', e); }
      finally { setLoading(false); }
    });
    return unsub;
  }, []);

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const fetchUsers = useCallback(async (s, sf, rf) => {
    setFetching(true);
    try {
      const h = await buildHeaders();
      const p = new URLSearchParams();
      if (s)  p.set('search', s);
      if (sf) p.set('status', sf);
      if (rf) p.set('role',   rf);
      const qs = p.toString();
      const r = await fetch(`${API_BASE_URL}/admin/users${qs ? '?' + qs : ''}`, { headers: h });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Failed to load users');
      setUsers(d.users || []);
      setCounts(d.counts || null);
    } catch (e) { logger.error('[AdminUsers] fetch:', e); }
    finally { setFetching(false); }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fetchUsers(search, sfilt, rfilt), search ? 300 : 0);
    return () => clearTimeout(timer.current);
  }, [isAdmin, search, sfilt, rfilt, fetchUsers]);

  // ── Actions ─────────────────────────────────────────────────────────────────
  const handleAction = (key, user) => {
    const c = ACTION[key];
    setConfirmUi({ phase: 'confirm', title: c.title, message: c.msg(user), confirmLabel: c.label, tone: c.tone, loadingMessage: c.loading, key, user });
  };

  const execAction = async () => {
    const { key, user } = confirmUi;
    const c = ACTION[key];
    setConfirmUi((p) => ({ ...p, phase: 'loading' }));
    try {
      const h = await buildHeaders();
      const r = await fetch(c.url(user), { method: c.method, headers: h, body: JSON.stringify(c.body()) });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Failed');
      setUsers((prev) => prev.map((u) => u.id === d.user?.id ? { ...u, ...d.user } : u));
      setConfirmUi({ phase: 'result', title: 'Done', message: d.message || 'Updated.' });
    } catch (e) {
      setConfirmUi({ phase: 'result', title: 'Error', message: e.message, resultError: true });
    }
  };

  // ── Guards ──────────────────────────────────────────────────────────────────
  if (loading) return (
    <View style={s.center}><ActivityIndicator size="large" color={Colors.primary} /><Text style={s.loadTxt}>Checking access…</Text></View>
  );
  if (!isAdmin) return (
    <View style={s.center}>
      <MaterialIcons name="lock-outline" size={48} color={Colors.sub2} />
      <Text style={s.deniedTxt}>Admin access required</Text>
      <TouchableOpacity onPress={() => router.replace('/')} style={s.homeBtn}><Text style={s.homeTxt}>Go Home</Text></TouchableOpacity>
    </View>
  );

  // ── Render ──────────────────────────────────────────────────────────────────
  const renderItem = ({ item, index }) =>
    isWeb
      ? <WebRow user={item} currentUserId={currentUserId} onAction={handleAction} odd={index % 2 !== 0} />
      : <MobileCard user={item} currentUserId={currentUserId} onAction={handleAction} />;

  return (
    <SafeAreaView style={s.safe}>

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <TourTarget id="web-admin-users-tour">
      <View style={s.bar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={{ padding: 2 }}>
          <MaterialIcons name="arrow-back" size={22} color={Colors.primary} />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <Text style={s.barTitle}>User Management</Text>
          {!!domain && <Text style={s.barSub}>@{domain}</Text>}
        </View>

        {/* Stats (web inline, mobile separate strip) */}
        {isWeb && counts && (
          <View style={s.stats}>
            {[
              { k: 'total',    v: counts.total,    fg: Colors.text,      label: 'Total'    },
              { k: 'active',   v: counts.ACTIVE,   fg: '#16A34A',        label: 'Active'   },
              { k: 'invited',  v: counts.INVITED,  fg: '#2563EB',        label: 'Invited'  },
              { k: 'disabled', v: counts.DISABLED, fg: Colors.sub2,      label: 'Disabled' },
            ].map((item, i) => (
              <React.Fragment key={item.k}>
                {i > 0 && <View style={s.statDiv} />}
                <View style={s.stat}>
                  <Text style={[s.statVal, { color: item.fg }]}>{item.v ?? 0}</Text>
                  <Text style={s.statLbl}>{item.label}</Text>
                </View>
              </React.Fragment>
            ))}
          </View>
        )}

        <TourTarget id="web-admin-qr-link">
          <TouchableOpacity onPress={() => router.push('/admin/qr')} style={s.qrSheetsBtn}>
            <MaterialIcons name="qr-code-2" size={18} color={Colors.primary} />
            {isWeb && <Text style={s.qrSheetsBtnTxt}>QR sheets</Text>}
          </TouchableOpacity>
        </TourTarget>

        <TouchableOpacity onPress={() => setShowInvite(true)} style={s.invBtn}>
          <MaterialIcons name="person-add" size={16} color="#fff" />
          {isWeb && <Text style={s.invTxt}>Invite User</Text>}
        </TouchableOpacity>
      </View>
      </TourTarget>

      {/* ── Stats strip (mobile) ─────────────────────────────────────────── */}
      {!isWeb && counts && (
        <View style={s.mStats}>
          {[
            { v: counts.total,    fg: Colors.text, label: 'Total'    },
            { v: counts.ACTIVE,   fg: '#16A34A',   label: 'Active'   },
            { v: counts.INVITED,  fg: '#2563EB',   label: 'Invited'  },
            { v: counts.DISABLED, fg: Colors.sub2, label: 'Disabled' },
          ].map((item, i) => (
            <React.Fragment key={item.label}>
              {i > 0 && <View style={s.mStatDiv} />}
              <View style={s.mStat}>
                <Text style={[s.mStatVal, { color: item.fg }]}>{item.v ?? 0}</Text>
                <Text style={s.mStatLbl}>{item.label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      )}

      {/* ── Search + filter toolbar ──────────────────────────────────────── */}
      <View style={s.toolbar}>
        <View style={s.searchWrap}>
          <MaterialIcons name="search" size={17} color={Colors.sub2} />
          <TextInput
            style={s.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name or email…"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
              <MaterialIcons name="close" size={15} color={Colors.sub2} />
            </TouchableOpacity>
          )}
        </View>
        <View style={s.pills}>
          {[{ v: '', l: 'All' }, { v: 'ACTIVE', l: 'Active' }, { v: 'INVITED', l: 'Invited' }, { v: 'DISABLED', l: 'Disabled' }]
            .map((p) => <Pill key={p.v} label={p.l} active={sfilt === p.v} onPress={() => setSfilt(p.v)} />)}
          <View style={s.pillSep} />
          {[{ v: '', l: 'All roles' }, { v: 'ADMIN', l: 'Admin' }, { v: 'USER', l: 'User' }]
            .map((p) => <Pill key={p.v} label={p.l} active={rfilt === p.v} onPress={() => setRfilt(p.v)} />)}
        </View>
      </View>

      {/* ── Web table header ─────────────────────────────────────────────── */}
      {isWeb && <WebTableHeader />}

      {/* ── List ─────────────────────────────────────────────────────────── */}
      <FlatList
        style={{ flex: 1 }}
        data={users}
        keyExtractor={(u) => u.id}
        renderItem={renderItem}
        contentContainerStyle={[{ paddingTop: isWeb ? 0 : 10, paddingBottom: 40 }, users.length === 0 && { flex: 1 }]}
        ListEmptyComponent={
          <View style={s.empty}>
            {fetching
              ? <ActivityIndicator size="large" color={Colors.primary} />
              : <>
                  <View style={s.emptyIcon}><MaterialIcons name="group" size={28} color={Colors.sub2} /></View>
                  <Text style={s.emptyTitle}>No users found</Text>
                  <Text style={s.emptySub}>
                    {search || sfilt || rfilt
                      ? 'Try adjusting your search or filters.'
                      : 'Invite your first team member to get started.'}
                  </Text>
                  {!search && !sfilt && !rfilt && (
                    <TouchableOpacity onPress={() => setShowInvite(true)} style={s.emptyBtn}>
                      <MaterialIcons name="person-add" size={15} color="#fff" />
                      <Text style={s.emptyBtnTxt}>Invite User</Text>
                    </TouchableOpacity>
                  )}
                </>
            }
          </View>
        }
        refreshing={fetching}
        onRefresh={() => fetchUsers(search, sfilt, rfilt)}
      />

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      <InviteModal
        visible={showInvite}
        domain={domain}
        onClose={() => setShowInvite(false)}
        onInvited={(u) => {
          setUsers((p) => [u, ...p]);
          setCounts((c) => c ? { ...c, INVITED: (c.INVITED || 0) + 1, total: (c.total || 0) + 1 } : c);
          setShowInvite(false);
        }}
      />
      <ConfirmModal
        visible={!!confirmUi}
        phase={confirmUi?.phase || 'confirm'}
        title={confirmUi?.title}
        message={confirmUi?.message}
        confirmLabel={confirmUi?.confirmLabel || 'Confirm'}
        confirmTone={confirmUi?.tone || 'primary'}
        loadingMessage={confirmUi?.loadingMessage}
        resultError={confirmUi?.resultError}
        onConfirm={execAction}
        onCancel={() => setConfirmUi(null)}
        onDismiss={() => setConfirmUi(null)}
      />
    </SafeAreaView>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: Colors.bg },
  loadTxt:   { marginTop: 12, fontSize: sf(14), color: Colors.sub },
  deniedTxt: { marginTop: 10, fontSize: sf(16), fontWeight: '800', color: Colors.text },
  homeBtn:   { marginTop: 14, backgroundColor: Colors.primary, paddingHorizontal: 22, paddingVertical: 10, borderRadius: Radius.md },
  homeTxt:   { color: '#fff', fontWeight: '800', fontSize: sf(13) },

  // Top bar
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10,
    backgroundColor: Colors.card,
    borderBottomWidth: 1.5, borderBottomColor: Colors.line,
    ...(isWeb ? Shadows.card : {}),
  },
  barTitle: { fontSize: sf(15), fontWeight: '900', color: Colors.primary },
  barSub:   { fontSize: sf(11), color: Colors.sub2, marginTop: 1 },

  // Web inline stats
  stats:    { flexDirection: 'row', alignItems: 'center', marginRight: 10 },
  statDiv:  { width: 1, height: 28, backgroundColor: Colors.line, marginHorizontal: 12 },
  stat:     { alignItems: 'center' },
  statVal:  { fontSize: sf(17), fontWeight: '900', lineHeight: 20 },
  statLbl:  { fontSize: sf(10), color: Colors.sub2, fontWeight: '600', textTransform: 'uppercase', marginTop: 1 },

  qrSheetsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 2, borderColor: Colors.line, backgroundColor: Colors.bg,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.md,
  },
  qrSheetsBtnTxt: { color: Colors.primary, fontWeight: '800', fontSize: sf(13) },

  // Invite button
  invBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.accent, paddingHorizontal: 14, paddingVertical: 9, borderRadius: Radius.md },
  invTxt: { color: '#fff', fontWeight: '800', fontSize: sf(13) },

  // Mobile stats strip
  mStats:   { flexDirection: 'row', backgroundColor: Colors.card, borderBottomWidth: 1, borderBottomColor: Colors.line, paddingVertical: 10 },
  mStat:    { flex: 1, alignItems: 'center' },
  mStatVal: { fontSize: sf(17), fontWeight: '900' },
  mStatLbl: { fontSize: sf(10), color: Colors.sub2, fontWeight: '600', textTransform: 'uppercase', marginTop: 1 },
  mStatDiv: { width: 1, backgroundColor: Colors.line, marginVertical: 6 },

  // Toolbar
  toolbar: {
    backgroundColor: Colors.card,
    borderBottomWidth: 1.5, borderBottomColor: Colors.line,
    paddingHorizontal: 16, paddingTop: 11, paddingBottom: 10, gap: 10,
  },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.bg, borderRadius: Radius.md,
    borderWidth: 1.5, borderColor: Colors.line,
    paddingHorizontal: 11, paddingVertical: isWeb ? 8 : 7,
  },
  searchInput: { flex: 1, fontSize: sf(13), color: Colors.text, ...(isWeb ? { outlineStyle: 'none' } : {}) },
  pills:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  pillSep: { width: 1, height: 16, backgroundColor: Colors.line, marginHorizontal: 2 },

  // Empty state
  empty:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 8 },
  emptyIcon:  { width: 60, height: 60, borderRadius: 30, backgroundColor: Colors.chip, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  emptyTitle: { fontSize: sf(15), fontWeight: '800', color: Colors.text },
  emptySub:   { fontSize: sf(13), color: Colors.sub, textAlign: 'center', lineHeight: 20 },
  emptyBtn:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, backgroundColor: Colors.accent, paddingHorizontal: 18, paddingVertical: 10, borderRadius: Radius.md },
  emptyBtnTxt:{ color: '#fff', fontWeight: '800', fontSize: sf(13) },
});
