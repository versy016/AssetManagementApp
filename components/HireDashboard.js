// components/HireDashboard.js – Hire dashboard: list of hired assets + "View hire form" button
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
  Animated,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { API_BASE_URL } from '../inventory-api/apiBase';
import { Colors, Radius, Shadows, sf } from '../constants/uiTheme';
import ConfirmModal from './ui/ConfirmModal';
import TableIconButton from './ui/TableIconButton';
import TablePagination from './ui/TablePagination';
import SearchInput from './ui/SearchInput';

// Column flex so table fills full width (keeps CertsView look)
const COL_FLEX = {
  assetId: 1,
  serial: 0.8,
  type: 1,
  contact: 1,
  phone: 0.9,
  email: 1.2,
  from: 0.85,
  to: 0.85,
  status: 0.9,
  /** Wide enough for view / download / edit / delete / copy / DocuSign icon row */
  action: 1.35,
};

/** Ensures the grid is wide enough for all action icons; parent pane scrolls horizontally if needed. */
const HIRE_TABLE_MIN_INNER_WIDTH = 1020;

function formatDate(s) {
  if (!s || typeof s !== 'string') return '—';
  const d = s.slice(0, 10);
  if (d.length < 10) return s;
  const [y, m, day] = d.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mn = months[parseInt(m, 10) - 1] || m;
  return `${day} ${mn} ${y}`;
}

function StatusBadge({ hire }) {
  const signed = hire.signatureStatus === 'signed';
  const label = hire.signatureStatusLabel || (signed ? 'Signed' : 'Pending signature');
  return (
    <View style={[styles.statusPill, signed ? styles.statusPillSigned : styles.statusPillPending]}>
      <Text style={[styles.statusPillText, signed ? styles.statusPillTextSigned : styles.statusPillTextPending]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

function triggerBlobDownload(blob, filename) {
  if (typeof window === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'hire_document';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function HireDashboard({ onViewForm, onEditHire, onCopyHire, highlightId, onHighlightDone }) {
  const [hires, setHires] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hoverRowId, setHoverRowId] = useState(null);
  const [docusignEnabled, setDocusignEnabled] = useState(false);
  const [docusignSendingId, setDocusignSendingId] = useState(null);
  /** Delete flow: confirm → loading → result (replaces window.confirm / window.alert on web). */
  const [deleteUi, setDeleteUi] = useState(null);

  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  /** Highlight flash for newly saved/sent hire rows. */
  const flashAnim = useRef(new Animated.Value(0)).current;
  const highlightedRowRef = useRef(null);
  const [activeHighlightId, setActiveHighlightId] = useState(null);

  useEffect(() => {
    if (!highlightId) return;
    setActiveHighlightId(highlightId);
    flashAnim.setValue(1);
    // Scroll to the highlighted row after a brief tick so the list has rendered
    const scrollTimer = setTimeout(() => {
      highlightedRowRef.current?.measureLayout?.(
        highlightedRowRef.current,
        () => {},
        () => {}
      );
    }, 80);
    // Fade the highlight out over 2.5s, then notify parent to clear the ID
    const anim = Animated.timing(flashAnim, {
      toValue: 0,
      duration: 2500,
      delay: 800,
      useNativeDriver: false,
    });
    anim.start(({ finished }) => {
      if (finished) {
        setActiveHighlightId(null);
        if (typeof onHighlightDone === 'function') onHighlightDone();
      }
    });
    return () => {
      clearTimeout(scrollTimer);
      anim.stop();
    };
  }, [highlightId]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchHires = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/hire-disclaimer/hires`);
      if (!res.ok) throw new Error(res.statusText || 'Failed to load');
      const data = await res.json();
      setHires(data.hires || []);
      setPage(1);
    } catch (e) {
      setHires([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const filteredHires = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return hires;
    return hires.filter((h) =>
      [h.assetId, h.serial, h.assetType, h.contactName, h.phone, h.email, h.signatureStatusLabel]
        .some((v) => v && String(v).toLowerCase().includes(q))
    );
  }, [hires, query]);

  const paginatedHires = useMemo(() => {
    if (pageSize === 'All') return filteredHires;
    const start = (page - 1) * pageSize;
    return filteredHires.slice(start, start + pageSize);
  }, [filteredHires, page, pageSize]);

  useEffect(() => {
    fetchHires();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [query]);

  // Listen for postMessage from the DocuSign signing tab (sent by the /docusign/return page)
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const handler = (event) => {
      if (!event.data || event.data.type !== 'hire_signed') return;
      // Refresh the list to pick up the new status + signed doc
      fetchHires();
      // Re-highlight the row that was just signed
      if (event.data.hireId) {
        setActiveHighlightId(event.data.hireId);
        flashAnim.setValue(1);
        const anim = Animated.timing(flashAnim, {
          toValue: 0,
          duration: 2500,
          delay: 800,
          useNativeDriver: false,
        });
        anim.start(({ finished }) => {
          if (finished) {
            setActiveHighlightId(null);
            if (typeof onHighlightDone === 'function') onHighlightDone();
          }
        });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/hire-disclaimer/docusign/status`);
        if (!res.ok) return;
        const j = await res.json();
        if (!cancelled && j.enabled) setDocusignEnabled(true);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchHires();
  };

  const handleCopy = (hire) => {
    if (typeof onCopyHire === 'function') {
      onCopyHire(hire);
      return;
    }
    Alert.alert('Copy', 'Copy to new form is not available.');
  };

  const handleEdit = (hire) => {
    if (typeof onEditHire === 'function') onEditHire(hire);
    else Alert.alert('Edit', 'Edit is not available.');
  };

  const handleDelete = (hire) => {
    setDeleteUi({ phase: 'confirm', hire });
  };

  const closeDeleteModal = () => {
    setDeleteUi(null);
  };

  const runDeleteConfirmed = async (hire) => {
    if (!hire?.id) return;
    setDeleteUi({ phase: 'loading', hire });
    try {
      const res = await fetch(`${API_BASE_URL}/hire-disclaimer/hires/${encodeURIComponent(hire.id)}`, {
        method: 'DELETE',
      });
      const errBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(errBody.error || res.statusText || 'Delete failed');
      }
      await fetchHires();
      setDeleteUi({
        phase: 'result',
        title: 'Deleted',
        message: 'This hire record was removed.',
        error: false,
      });
    } catch (e) {
      setDeleteUi({
        phase: 'result',
        title: 'Delete failed',
        message: e?.message || 'Could not delete hire.',
        error: true,
      });
    }
  };


  const docUrl = (hireId, { inline } = {}) => {
    const q = inline ? '?view=1' : '';
    return `${API_BASE_URL}/hire-disclaimer/hires/${encodeURIComponent(hireId)}/document${q}`;
  };

  const handleDownload = async (hire) => {
    try {
      const url = `${API_BASE_URL}/hire-disclaimer/hires/${encodeURIComponent(hire.id)}/document?pdf=1`;
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || res.statusText || 'Download failed');
      }
      const blob = await res.blob();
      // Prefer server filename from Content-Disposition; fall back to pattern built from hire data.
      const disposition = res.headers.get('Content-Disposition');
      const match = disposition && disposition.match(/filename="?([^";]+)"?/);
      const assetPart = (hire.serial || hire.assetId || 'asset').replace(/[^\w\-_.]/g, '_').replace(/\s+/g, '_');
      const hirerPart = (hire.contactName || 'hire').replace(/[^\w\-_.]/g, '_').replace(/\s+/g, '_');
      const fallbackName = `${assetPart}_${hirerPart}_hire.pdf`;
      const filename = match ? match[1] : fallbackName;
      if (Platform.OS === 'web') {
        triggerBlobDownload(blob, filename);
      } else {
        Alert.alert('Download', 'Open this screen on web to download the document, or use Share from your browser.');
      }
    } catch (e) {
      Alert.alert('Download failed', e?.message || 'Could not download document.');
    }
  };

  const handleViewDocument = (hire) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(docUrl(hire.id, { inline: true }), '_blank', 'noopener,noreferrer');
      return;
    }
    Alert.alert('View document', 'Opening the document in a new tab is available on web. On mobile, use Download.');
  };

  const lesseeEmailOk = (hire) => {
    const e = hire.email && String(hire.email).trim();
    return e && e !== '—' && e.includes('@');
  };

  const handleDocusignEmail = async (hire) => {
    if (!lesseeEmailOk(hire)) {
      Alert.alert('DocuSign', 'This hire needs a valid lessee email on the record.');
      return;
    }
    setDocusignSendingId(hire.id);
    try {
      const res = await fetch(
        `${API_BASE_URL}/hire-disclaimer/hires/${encodeURIComponent(hire.id)}/docusign/send`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deliveryMethod: 'email' }),
        }
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || res.statusText || 'Request failed');
      await fetchHires();
      Alert.alert(
        'DocuSign',
        'An email was sent to the lessee with a link to review and sign the lease.'
      );
    } catch (e) {
      Alert.alert('DocuSign failed', e?.message || 'Could not send envelope.');
    } finally {
      setDocusignSendingId(null);
    }
  };


  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading hires…</Text>
      </View>
    );
  }

  const hireToolbar = (
    <View style={styles.toolbarSurface}>
      <View style={styles.toolbarRow}>
        <SearchInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by asset, contact, email, serial…"
          autoCapitalize="none"
          autoCorrect={false}
          style={{ flex: 1 }}
          inputStyle={{ fontSize: sf(16) }}
        />
      </View>
      {onViewForm ? (
        <View style={[styles.quickRow, { marginTop: 8, justifyContent: 'flex-end' }]}>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}
            onPress={onViewForm}
            activeOpacity={0.85}
          >
            <MaterialIcons name="add" size={20} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700' }}>New hire</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.container}>
      {hires.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyScroll}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.primary]} />
          }
        >
          {hireToolbar}
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No hires yet</Text>
            <Text style={styles.emptySub}>
              Create a hire from an asset action (Hire) or use the form to generate a lease document.
            </Text>
          </View>
        </ScrollView>
      ) : (
        <View style={styles.tableOuter}>
          {hireToolbar}
          <View style={styles.tableWrap}>
            <View style={styles.tableScrollWrapper}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator
              contentContainerStyle={styles.tableScrollContent}
            >
            <View style={styles.tableInnerWide}>
              <View style={styles.tableHeader}>
                <View style={[styles.th, { flex: COL_FLEX.assetId }]}><Text style={styles.thText} numberOfLines={2}>Asset ID</Text></View>
                <View style={[styles.th, { flex: COL_FLEX.serial }]}><Text style={styles.thText} numberOfLines={2}>Serial</Text></View>
                <View style={[styles.th, { flex: COL_FLEX.type }]}><Text style={styles.thText} numberOfLines={2}>Asset type</Text></View>
                <View style={[styles.th, { flex: COL_FLEX.contact }]}><Text style={styles.thText} numberOfLines={2}>Contact name</Text></View>
                <View style={[styles.th, { flex: COL_FLEX.phone }]}><Text style={styles.thText} numberOfLines={2}>Phone</Text></View>
                <View style={[styles.th, { flex: COL_FLEX.email }]}><Text style={styles.thText} numberOfLines={2}>Email</Text></View>
                <View style={[styles.th, { flex: COL_FLEX.from }]}><Text style={styles.thText} numberOfLines={2}>From</Text></View>
                <View style={[styles.th, { flex: COL_FLEX.to }]}><Text style={styles.thText} numberOfLines={2}>To</Text></View>
                <View style={[styles.th, { flex: COL_FLEX.status }]}><Text style={styles.thText} numberOfLines={2}>Status</Text></View>
                <View style={[styles.th, styles.tdActions, { flex: COL_FLEX.action }]}><Text style={styles.thText} numberOfLines={2}>Actions</Text></View>
              </View>
              <ScrollView
                showsVerticalScrollIndicator
                style={styles.tableBody}
                refreshControl={
                  <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.primary]} />
                }
              >
              {paginatedHires.map((h, idx) => {
                const isHighlighted = activeHighlightId === h.id;
                const rowBg = isHighlighted
                  ? flashAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [Platform.OS === 'web' ? Colors.card : '#ffffff', '#DCFCE7'],
                    })
                  : undefined;
                return (
                  <View key={h.id} ref={isHighlighted ? highlightedRowRef : null}>
                    <Animated.View
                      style={[
                        styles.tr,
                        idx % 2 === 1 && styles.rowAlt,
                        hoverRowId === h.id && styles.rowHover,
                        rowBg ? { backgroundColor: rowBg } : null,
                      ]}
                      onMouseEnter={() => setHoverRowId(h.id)}
                      onMouseLeave={() => setHoverRowId(null)}
                    >
                      <View style={[styles.td, { flex: COL_FLEX.assetId }]}><Text style={styles.tdText} numberOfLines={2}>{h.assetId || '—'}</Text></View>
                      <View style={[styles.td, { flex: COL_FLEX.serial }]}><Text style={styles.tdText} numberOfLines={2}>{h.serial || '—'}</Text></View>
                      <View style={[styles.td, { flex: COL_FLEX.type }]}><Text style={styles.tdText} numberOfLines={2}>{h.assetType || '—'}</Text></View>
                      <View style={[styles.td, { flex: COL_FLEX.contact }]}><Text style={styles.tdText} numberOfLines={2}>{h.contactName || '—'}</Text></View>
                      <View style={[styles.td, { flex: COL_FLEX.phone }]}><Text style={styles.tdText} numberOfLines={2}>{h.phone || '—'}</Text></View>
                      <View style={[styles.td, { flex: COL_FLEX.email }]}><Text style={styles.tdText} numberOfLines={2}>{h.email || '—'}</Text></View>
                      <View style={[styles.td, { flex: COL_FLEX.from }]}><Text style={styles.tdText}>{formatDate(h.fromDate) || '—'}</Text></View>
                      <View style={[styles.td, { flex: COL_FLEX.to }]}><Text style={styles.tdText}>{formatDate(h.toDate) || '—'}</Text></View>
                      <View style={[styles.td, { flex: COL_FLEX.status, justifyContent: 'center' }]}>
                        <StatusBadge hire={h} />
                      </View>
                      <View style={[styles.td, styles.tdActions, { flex: COL_FLEX.action }]}>
                        <View style={styles.actionRow}>
                          <TableIconButton
                            icon="visibility"
                            tone="view"
                            onPress={() => handleViewDocument(h)}
                            accessibilityLabel="View document"
                            tooltip="View document"
                          />
                          <TableIconButton
                            icon="download"
                            tone="download"
                            onPress={() => handleDownload(h)}
                            accessibilityLabel="Download document"
                            tooltip="Download document"
                          />
                          <TableIconButton
                            icon="edit"
                            tone="edit"
                            onPress={() => handleEdit(h)}
                            accessibilityLabel="Edit hire"
                            tooltip="Edit hire"
                          />
                          <TableIconButton
                            icon="delete"
                            tone="delete"
                            onPress={() => handleDelete(h)}
                            accessibilityLabel="Delete hire"
                            tooltip="Delete hire"
                          />
                          <TableIconButton
                            icon="content-copy"
                            tone="copy"
                            onPress={() => handleCopy(h)}
                            accessibilityLabel="Copy to new form"
                            tooltip="Copy to new form"
                          />
                          {docusignEnabled &&
                          h.signatureStatus !== 'signed' &&
                          lesseeEmailOk(h) ? (
                            <TableIconButton
                              icon="mail-outline"
                              tone="send"
                              onPress={() => handleDocusignEmail(h)}
                              disabled={docusignSendingId === h.id}
                              loading={docusignSendingId === h.id}
                              accessibilityLabel="Send via DocuSign email"
                              tooltip="Send via DocuSign email"
                            />
                          ) : null}
                        </View>
                      </View>
                    </Animated.View>
                  </View>
                );
              })}
              </ScrollView>
            </View>
            </ScrollView>
            </View>
          </View>
          {/* Pagination */}
          <TablePagination
            page={page}
            pageSize={pageSize}
            total={filteredHires.length}
            onPageChange={setPage}
            onPageSizeChange={(sz) => { setPageSize(sz); setPage(1); }}
          />
        </View>
      )}
      <ConfirmModal
        visible={!!deleteUi}
        phase={deleteUi?.phase || 'confirm'}
        title={deleteUi?.phase === 'result' ? deleteUi.title : 'Delete hire?'}
        message={
          deleteUi?.phase === 'result'
            ? deleteUi.message
            : 'This removes the hire record from the system. The document file is not stored separately.'
        }
        loadingMessage="Deleting…"
        confirmLabel="Delete"
        confirmTone="danger"
        resultError={deleteUi?.error}
        onConfirm={() => runDeleteConfirmed(deleteUi?.hire)}
        onCancel={closeDeleteModal}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: { marginTop: 12, fontSize: sf(14), color: Colors.sub },
  emptyScroll: { flexGrow: 1 },
  empty: {
    padding: 32,
    alignItems: 'center',
  },
  emptyTitle: { fontSize: sf(18), fontWeight: '700', color: Colors.text, marginBottom: 8 },
  emptySub: { fontSize: sf(14), color: Colors.sub, textAlign: 'center', maxWidth: 400, marginBottom: 16 },
  toolbarSurface: { marginBottom: 8 },
  toolbarRow: { gap: 8, marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  quickRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: Radius.md,
    backgroundColor: Colors.accentMuted,
  },
  btnPrimary: { backgroundColor: Colors.accent },
  tableOuter: {
    flex: 1,
    width: '100%',
  },
  tableWrap: {
    flex: 1,
    width: '100%',
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.line,
    overflow: 'hidden',
    ...Shadows.card,
  },
  tableScrollWrapper: { flex: 1 },
  tableScrollContent: { flexGrow: 1 },
  tableInnerWide: {
    minWidth: HIRE_TABLE_MIN_INNER_WIDTH,
    flex: 1,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: Colors.primary,
    borderBottomWidth: 0,
  },
  th: {
    paddingVertical: 13,
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 0,
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.1)',
  },
  thText: {
    fontSize: sf(12),
    fontWeight: '800',
    color: '#FFFFFF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flexShrink: 1,
    minWidth: 0,
    textAlign: 'center',
  },
  tableBody: { flex: 1 },
  tableBodyWeb: { backgroundColor: Colors.bg },
  tr: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
    backgroundColor: Platform.OS === 'web' ? Colors.card : '#FFFFFF',
    alignItems: 'center',
  },
  rowAlt: {
    backgroundColor: Platform.OS === 'web' ? Colors.bg : '#F8FAFC',
  },
  rowHover: { backgroundColor: Colors.accentLight },
  td: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 0,
  },
  tdActions: {
    alignItems: 'center',
    flexShrink: 0,
    minWidth: 200,
    paddingHorizontal: 4,
  },
  tdText: {
    fontSize: sf(13),
    color: Colors.text,
    fontWeight: '500',
    textAlign: 'center',
  },
  statusPill: {
    alignSelf: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    maxWidth: '100%',
  },
  statusPillSigned: {
    backgroundColor: Colors.successBg,
  },
  statusPillPending: {
    backgroundColor: Colors.warningBg,
  },
  statusPillText: {
    fontSize: sf(12),
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  statusPillTextSigned: { color: Colors.successFg },
  statusPillTextPending: { color: Colors.warningFg },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  details: {
    padding: 12,
    paddingLeft: 24,
    backgroundColor: Colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  detailsTitle: { fontSize: sf(13), fontWeight: '700', color: Colors.text, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  detailsLabel: { fontSize: sf(13), color: Colors.sub, width: '30%', minWidth: 100 },
  detailsValue: { fontSize: sf(13), color: Colors.text, width: '65%', flex: 1 },
});
