// app/check-in/public.js
// Public fallback page shown when an unauthenticated user scans a GearOps QR
// code in a web browser (no app installed).
//
// Exposes two self-contained forms:
//   1. Lost & Found  — records where the item was found, notifies office
//   2. Transfer to Office — requests manual return, notifies office
//
// No authentication. Talks directly to the /public API endpoints.

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Image,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { API_BASE_URL } from '../../inventory-api/apiBase';

// ---------- Colours (inline — this page is self-contained) ------------------
const C = {
  bg:         '#F8FAFC',
  card:       '#FFFFFF',
  primary:    '#1E40AF', // blue
  accent:     '#EA580C', // orange
  text:       '#1E293B',
  sub:        '#64748B',
  line:       '#E2E8F0',
  success:    '#166534',
  successBg:  '#DCFCE7',
  errorBg:    '#FEF2F2',
  errorFg:    '#991B1B',
  inputBg:    '#F8FAFC',
  placeholder:'#94A3B8',
};

// ---------- Helpers ---------------------------------------------------------

const PUBLIC_API = API_BASE_URL;

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${PUBLIC_API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// ---------- Sub-components --------------------------------------------------

function StatusBadge({ status }) {
  const s  = String(status || '').toLowerCase();
  const bg = s.includes('lost') || s.includes('stolen') ? '#FEF2F2'
           : s.includes('hire') || s.includes('service') ? '#EFF6FF'
           : s.includes('repair') || s.includes('maintenance') ? '#FFFBEB'
           : '#F0FDF4';
  const fg = s.includes('lost') || s.includes('stolen') ? '#991B1B'
           : s.includes('hire') || s.includes('service') ? '#1D4ED8'
           : s.includes('repair') || s.includes('maintenance') ? '#92400E'
           : '#166534';
  return (
    <View style={[ss.badge, { backgroundColor: bg }]}>
      <Text style={[ss.badgeText, { color: fg }]}>{status}</Text>
    </View>
  );
}

function Field({ label, value, onChangeText, placeholder, multiline, required, maxLength }) {
  return (
    <View style={ss.fieldWrap}>
      <Text style={ss.label}>
        {label}
        {required && <Text style={{ color: C.accent }}> *</Text>}
      </Text>
      <TextInput
        style={[ss.input, multiline && ss.inputMulti]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.placeholder}
        multiline={multiline}
        numberOfLines={multiline ? 4 : 1}
        maxLength={maxLength || (multiline ? 1000 : 300)}
        autoCapitalize="sentences"
        autoCorrect
      />
    </View>
  );
}

function SuccessCard({ title, body, onReset }) {
  return (
    <View style={ss.successCard}>
      <Text style={ss.successIcon}>✓</Text>
      <Text style={ss.successTitle}>{title}</Text>
      <Text style={ss.successBody}>{body}</Text>
      <TouchableOpacity style={ss.resetBtn} onPress={onReset}>
        <Text style={ss.resetBtnText}>Go back</Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------- Lost & Found form -----------------------------------------------

function LostAndFoundForm({ assetId, assetName }) {
  const [foundAt,       setFoundAt]       = useState('');
  const [finderName,    setFinderName]    = useState('');
  const [finderContact, setFinderContact] = useState('');
  const [notes,         setNotes]         = useState('');
  const [submitting,    setSubmitting]    = useState(false);
  const [error,         setError]         = useState(null);
  const [done,          setDone]          = useState(false);

  const submit = useCallback(async () => {
    setError(null);
    if (!foundAt.trim()) { setError('Please enter where the item was found.'); return; }

    setSubmitting(true);
    try {
      await apiFetch(`/public/assets/${assetId}/lost-and-found`, {
        method: 'POST',
        body: JSON.stringify({
          found_at:        foundAt.trim(),
          finder_name:     finderName.trim()     || undefined,
          finder_contact:  finderContact.trim()  || undefined,
          notes:           notes.trim()          || undefined,
          _hp:             '',  // honeypot — left blank by real users
        }),
      });
      setDone(true);
    } catch (e) {
      setError(e.message || 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [assetId, foundAt, finderName, finderContact, notes]);

  if (done) {
    return (
      <SuccessCard
        title="Report submitted"
        body={`Thank you. Our team has been notified that ${assetName || 'this item'} was found and will follow up shortly.`}
        onReset={() => { setDone(false); setFoundAt(''); setFinderName(''); setFinderContact(''); setNotes(''); }}
      />
    );
  }

  return (
    <View style={ss.formCard}>
      <View style={[ss.formHeader, { backgroundColor: '#EFF6FF' }]}>
        <Text style={ss.formIcon}>📍</Text>
        <View>
          <Text style={[ss.formTitle, { color: C.primary }]}>Lost & Found</Text>
          <Text style={ss.formSub}>Found this item? Let us know where.</Text>
        </View>
      </View>

      <View style={ss.formBody}>
        <Field
          label="Where was it found?"
          value={foundAt}
          onChangeText={setFoundAt}
          placeholder="e.g. Site office, corner of King & George St"
          required
        />
        <Field
          label="Your name"
          value={finderName}
          onChangeText={setFinderName}
          placeholder="Optional"
          maxLength={150}
        />
        <Field
          label="Your contact (phone or email)"
          value={finderContact}
          onChangeText={setFinderContact}
          placeholder="Optional"
          maxLength={150}
        />
        <Field
          label="Additional notes"
          value={notes}
          onChangeText={setNotes}
          placeholder="Any other details…"
          multiline
        />

        {error && (
          <View style={ss.errorBox}>
            <Text style={ss.errorText}>{error}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[ss.submitBtn, { backgroundColor: C.primary }, submitting && ss.btnDisabled]}
          onPress={submit}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator color="#fff" />
            : <Text style={ss.submitBtnText}>Submit Report</Text>
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ---------- Transfer to Office form -----------------------------------------

function TransferToOfficeForm({ assetId, assetName }) {
  const [location,   setLocation]   = useState('');
  const [yourName,   setYourName]   = useState('');
  const [contact,    setContact]    = useState('');
  const [notes,      setNotes]      = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState(null);
  const [done,       setDone]       = useState(false);

  const submit = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch(`/public/assets/${assetId}/transfer-to-office`, {
        method: 'POST',
        body: JSON.stringify({
          current_location:   location.trim()  || undefined,
          submitter_name:     yourName.trim()  || undefined,
          submitter_contact:  contact.trim()   || undefined,
          notes:              notes.trim()     || undefined,
          _hp:                '',
        }),
      });
      setDone(true);
    } catch (e) {
      setError(e.message || 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [assetId, location, yourName, contact, notes]);

  if (done) {
    return (
      <SuccessCard
        title="Request received"
        body={`Our team has been notified and will arrange collection of ${assetName || 'the item'}. Thank you.`}
        onReset={() => { setDone(false); setLocation(''); setYourName(''); setContact(''); setNotes(''); }}
      />
    );
  }

  return (
    <View style={ss.formCard}>
      <View style={[ss.formHeader, { backgroundColor: '#FFF7ED' }]}>
        <Text style={ss.formIcon}>🏢</Text>
        <View>
          <Text style={[ss.formTitle, { color: C.accent }]}>Transfer to Office</Text>
          <Text style={ss.formSub}>Returning this equipment to base? Let us know.</Text>
        </View>
      </View>

      <View style={ss.formBody}>
        <Field
          label="Where is it now?"
          value={location}
          onChangeText={setLocation}
          placeholder="Current location (optional)"
        />
        <Field
          label="Your name"
          value={yourName}
          onChangeText={setYourName}
          placeholder="Optional"
          maxLength={150}
        />
        <Field
          label="Your contact (phone or email)"
          value={contact}
          onChangeText={setContact}
          placeholder="Optional"
          maxLength={150}
        />
        <Field
          label="Notes"
          value={notes}
          onChangeText={setNotes}
          placeholder="Any extra details…"
          multiline
        />

        {error && (
          <View style={ss.errorBox}>
            <Text style={ss.errorText}>{error}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[ss.submitBtn, { backgroundColor: C.accent }, submitting && ss.btnDisabled]}
          onPress={submit}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator color="#fff" />
            : <Text style={ss.submitBtnText}>Submit Request</Text>
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ---------- Main page -------------------------------------------------------

export default function PublicCheckInPage() {
  const { id } = useLocalSearchParams();
  const assetId = String(id || '').trim().toUpperCase();

  const [loading, setLoading] = useState(true);
  const [asset,   setAsset]   = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!assetId) { setNotFound(true); setLoading(false); return; }

    apiFetch(`/public/assets/${assetId}`)
      .then((data) => { setAsset(data.asset); setLoading(false); })
      .catch(() => { setNotFound(true); setLoading(false); });
  }, [assetId]);

  const assetName = asset ? [asset.type, asset.model].filter(Boolean).join(' — ') : null;

  return (
    <ScrollView
      style={ss.root}
      contentContainerStyle={ss.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={ss.header}>
        <Text style={ss.logo}>GearOps</Text>
        <Text style={ss.logoSub}>Engineering Surveys</Text>
      </View>

      {/* Asset card */}
      {loading ? (
        <View style={ss.centred}>
          <ActivityIndicator color={C.primary} size="large" />
          <Text style={[ss.sub, { marginTop: 12 }]}>Looking up asset…</Text>
        </View>
      ) : notFound ? (
        <View style={[ss.centred, ss.notFound]}>
          <Text style={ss.notFoundIcon}>⚠️</Text>
          <Text style={ss.notFoundTitle}>Asset not found</Text>
          <Text style={ss.sub}>This QR code may be invalid or the asset may have been removed.</Text>
        </View>
      ) : (
        <>
          {/* Asset summary */}
          <View style={ss.assetCard}>
            {asset.image_url ? (
              <Image source={{ uri: asset.image_url }} style={ss.assetImg} resizeMode="cover" />
            ) : (
              <View style={[ss.assetImg, ss.assetImgPlaceholder]}>
                <Text style={{ fontSize: 36 }}>🔧</Text>
              </View>
            )}
            <View style={ss.assetInfo}>
              <Text style={ss.assetId}>ID: {asset.id}</Text>
              {asset.type  && <Text style={ss.assetType}>{asset.type}</Text>}
              {asset.model && <Text style={ss.assetModel}>{asset.model}</Text>}
              {asset.status && <StatusBadge status={asset.status} />}
            </View>
          </View>

          {/* Divider */}
          <Text style={ss.sectionLabel}>What would you like to do?</Text>

          {/* Forms */}
          <LostAndFoundForm   assetId={assetId} assetName={assetName} />
          <TransferToOfficeForm assetId={assetId} assetName={assetName} />

          {/* Footer */}
          <View style={ss.footer}>
            <Text style={ss.footerText}>Have the GearOps app?</Text>
            <TouchableOpacity
              onPress={() => {
                if (Platform.OS === 'web') {
                  window.location.href = `gearops://check-in/${assetId}`;
                }
              }}
            >
              <Text style={ss.footerLink}>Open in app →</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </ScrollView>
  );
}

// ---------- Styles ----------------------------------------------------------

const ss = StyleSheet.create({
  root:    { flex: 1, backgroundColor: C.bg },
  content: { padding: 20, paddingBottom: 60, maxWidth: 600, alignSelf: 'center', width: '100%' },

  // Header
  header:    { alignItems: 'center', paddingVertical: 24, marginBottom: 4 },
  logo:      { fontSize: 28, fontWeight: '800', color: C.primary, letterSpacing: -0.5 },
  logoSub:   { fontSize: 13, color: C.sub, marginTop: 2 },

  // Loading / error states
  centred:    { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  notFound:   { gap: 8 },
  notFoundIcon:  { fontSize: 40, textAlign: 'center' },
  notFoundTitle: { fontSize: 20, fontWeight: '700', color: C.text, textAlign: 'center' },
  sub:        { fontSize: 14, color: C.sub, textAlign: 'center' },

  // Asset card
  assetCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  assetImg: { width: 80, height: 80, borderRadius: 12, backgroundColor: C.line },
  assetImgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  assetInfo: { flex: 1, gap: 4 },
  assetId:   { fontSize: 11, color: C.sub, fontFamily: Platform.OS === 'web' ? 'monospace' : 'Courier' },
  assetType: { fontSize: 12, color: C.sub, textTransform: 'uppercase', letterSpacing: 0.5 },
  assetModel:{ fontSize: 17, fontWeight: '700', color: C.text },
  badge:     { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginTop: 2 },
  badgeText: { fontSize: 12, fontWeight: '600' },

  // Section label
  sectionLabel: { fontSize: 13, fontWeight: '600', color: C.sub, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 },

  // Form cards
  formCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  formHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  formIcon:   { fontSize: 28 },
  formTitle:  { fontSize: 17, fontWeight: '700' },
  formSub:    { fontSize: 13, color: C.sub, marginTop: 2 },
  formBody:   { padding: 16, gap: 14 },

  // Fields
  fieldWrap: { gap: 6 },
  label:     { fontSize: 14, fontWeight: '600', color: C.text },
  input: {
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: C.text,
  },
  inputMulti: { minHeight: 100, textAlignVertical: 'top', paddingTop: 11 },

  // Error
  errorBox:  { backgroundColor: C.errorBg, borderRadius: 8, padding: 12 },
  errorText: { color: C.errorFg, fontSize: 14, fontWeight: '500' },

  // Submit
  submitBtn: {
    borderRadius: 12,
    padding: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  btnDisabled:   { opacity: 0.6 },

  // Success
  successCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  successIcon:  { fontSize: 40, marginBottom: 4 },
  successTitle: { fontSize: 20, fontWeight: '700', color: C.text },
  successBody:  { fontSize: 14, color: C.sub, textAlign: 'center', lineHeight: 21 },
  resetBtn:     { marginTop: 12, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: C.line },
  resetBtnText: { fontSize: 14, color: C.sub, fontWeight: '600' },

  // Footer
  footer:     { alignItems: 'center', marginTop: 24, gap: 4 },
  footerText: { fontSize: 13, color: C.sub },
  footerLink: { fontSize: 13, color: C.primary, fontWeight: '600' },
});
