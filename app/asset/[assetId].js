// app/asset/[assetId].js
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useWindowDimensions } from 'react-native';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Linking,
  Alert,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../components/ui/ScreenHeader';
import StatusBadge from '../../components/ui/StatusBadge';
import ScreenState from '../../components/ui/ScreenState';
import { Row, DetailsGrid } from '../../components/asset/AssetRows';
import AssetQRModal from '../../components/asset/AssetQRModal';
import AssetActionBar from '../../components/asset/AssetActionBar';
import { Colors, Radius, Shadows, sf } from '../../constants/uiTheme';
import { useAssetDetail } from '../../hooks/useAssetDetail';

const DEFAULT_ADDRESS = '4/11 Ridley Street, Hindmarsh, South Australia';

function MapPreview({ location }) {
  const url = `https://www.google.com/maps?q=${encodeURIComponent(location)}&z=16&output=embed`;

  if (Platform.OS === 'web') {
    return (
      <View style={styles.mapCard}>
        <div style={{ width: '100%', height: '100%' }}>
          <iframe
            title="map"
            src={url}
            style={{ border: 0, width: '100%', height: '100%', borderRadius: 10 }}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </View>
    );
  }

  const { WebView } = require('react-native-webview');
  const html = `<!doctype html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <style>html, body, .wrap { height: 100%; margin: 0; padding: 0; }</style>
      </head>
      <body>
        <div class="wrap">
          <iframe
            src="${url}"
            width="100%"
            height="100%"
            style="border:0;"
            allowfullscreen
            loading="lazy"
            referrerpolicy="no-referrer-when-downgrade"
          ></iframe>
        </div>
      </body>
    </html>`;
  return (
    <View style={styles.mapCard}>
      <WebView
        originWhitelist={["*"]}
        source={{ html, baseUrl: 'https://www.google.com' }}
        style={styles.map}
        automaticallyAdjustContentInsets={false}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
      />
    </View>
  );
}

export default function AssetDetailPage() {
  const { assetId, returnTo } = useLocalSearchParams();
  const { width } = useWindowDimensions();
  const isWebWide = Platform.OS === 'web' && (width || 0) >= 960;
  const router = useRouter();

  const detail = useAssetDetail({ assetId, returnTo });
  const {
    asset,
    loading,
    err,
    isImportedId,
    isAdmin,
    normalizedReturnTo,
    customFieldEntries,
    linkedAssetIds,
    hasDocUrlInFields,
    currentDetails,
    currentActionImages,
    noteItems,
    workDetailHistory,
    typedNotes,
    assetNote,
    nextService,
    isOverdue,
    notesExpanded,
    setNotesExpanded,
    notesSectionExpanded,
    setNotesSectionExpanded,
    qrOpen,
    setQrOpen,
    docHistoryOpen,
    setDocHistoryOpen,
    maintenanceExpanded,
    setMaintenanceExpanded,
    activeTab,
    setActiveTab,
    docDeletingId,
    handleBack,
    handleDelete,
    handleDeleteDocument,
    buildDynamicData,
    copyId,
    copyDeepLink,
    qrPayload,
    displayLocation,
    openMaps,
    prettyDate,
    prettyDateTime,
    typeMeta,
    initials,
    load,
    renderFieldValue,
    formatFieldLabel,
  } = detail;

  // Loading / error / empty guard
  if (loading) {
    return <SafeAreaView style={styles.centerWrap}><ScreenState loading label="Loading asset…" /></SafeAreaView>;
  }
  if (err && isImportedId) {
    return (
      <SafeAreaView style={styles.centerWrap}>
        <Ionicons name="qr-code-outline" size={36} color={Colors.accent} />
        <Text style={{ marginTop: 12, color: Colors.text, fontWeight: '700' }}>Awaiting QR Assignment</Text>
        <Text style={{ marginTop: 8, color: Colors.sub, paddingHorizontal: 24, textAlign: 'center' }}>{err}</Text>
        <TouchableOpacity style={{ marginTop: 18 }} onPress={handleBack}>
          <Text style={{ color: Colors.accent, fontWeight: '700' }}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }
  if (err) {
    return (
      <SafeAreaView style={styles.centerWrap}>
        <ScreenState error={err} onRetry={load} />
      </SafeAreaView>
    );
  }
  if (!asset) {
    return (
      <SafeAreaView style={styles.centerWrap}>
        <ScreenState empty icon="inventory" title="Asset not found" subtitle="This asset may have been deleted." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg, ...(Platform.OS === 'web' ? { minHeight: '100vh' } : {}) }}>
      <ScreenHeader
        title="Asset Details"
        backLabel="Back"
        onBack={handleBack}
      />

      <View style={styles.mainContentWrap}>
        <ScrollView
          style={styles.detailScrollView}
          contentContainerStyle={{ paddingHorizontal: 0, paddingBottom: Platform.OS === 'web' ? 88 : 24, flexGrow: 1 }}
        >
          {/* Hero image */}
          <Image
            source={{ uri: asset.image_url || 'https://via.placeholder.com/150' }}
            style={styles.heroImage}
          />

          <View style={styles.detailCard}>
            {/* Title Row */}
            <View style={styles.titleRow}>
              <Text style={styles.assetName}>
                {asset.asset_types?.name || 'Asset'} · SN: {asset.serial_number || 'N/A'}
              </Text>
            </View>

            {/* Meta chips */}
            <View style={styles.metaRow}>
              <TouchableOpacity onPress={copyId} style={styles.metaChip}>
                <MaterialIcons name="fingerprint" size={16} color={Colors.accent} />
                <Text style={styles.metaChipText}>ID: {asset.id}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={copyDeepLink} style={styles.metaChip}>
                <MaterialIcons name="link" size={16} color={Colors.accent} />
                <Text style={styles.metaChipText}>Copy Link</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={openMaps} style={styles.metaChip}>
                <MaterialIcons name="place" size={16} color={Colors.accent} />
                <Text style={styles.metaChipText}>Maps</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setQrOpen(true)} style={styles.metaChip}>
                <Ionicons name="qr-code-outline" size={18} color={Colors.accent} />
              </TouchableOpacity>
            </View>

            {/* Core fields */}
            {(() => {
              const coreRows = [
                { label: 'Status', value: <StatusBadge status={asset.status} /> },
                { label: 'Assigned To', value: asset.users?.name || 'N/A' },
                { label: 'Last Scanned Location', value: displayLocation },
                { label: 'Model', value: asset.model || 'N/A' },
                { label: 'Other ID', value: asset.other_id || 'N/A' },
                { label: 'Date Purchased', value: asset.date_purchased ? prettyDate(asset.date_purchased) : 'N/A' },
                { label: 'Last Updated', value: asset.last_updated ? prettyDate(asset.last_updated) : 'N/A' },
                { label: 'Last Updated By', value: (asset.last_changed_by_name || asset.users?.name || asset.last_changed_by || 'N/A') },
                { label: 'Description', value: asset.description || 'No description' },
              ];
              if (isWebWide) {
                return (
                  <>
                    <Text style={styles.sectionH}>Overview</Text>
                    <DetailsGrid rows={coreRows} />
                  </>
                );
              }
              return (
                <>
                  <Text style={styles.sectionH}>Overview</Text>
                  {coreRows.map((r, i) => (
                    <Row
                      key={`core-${i}`}
                      label={r.label}
                      value={r.value}
                      rightAlign={r.right !== false}
                    />
                  ))}
                </>
              );
            })()}

            {/* Current work details */}
            {currentDetails && (
              <>
                <Text style={[styles.sectionH, { marginTop: 16 }]}>Current Work Details</Text>
                {isWebWide ? (
                  (() => {
                    const rows = [];
                    if (currentDetails.date) rows.push({ label: 'Date', value: prettyDate(currentDetails.date) });
                    if (currentDetails.summary) rows.push({ label: 'Summary', value: currentDetails.summary });
                    if (currentDetails.priority) rows.push({ label: 'Priority', value: String(currentDetails.priority) });
                    if (typeof currentDetails.estimated_cost !== 'undefined' && currentDetails.estimated_cost !== null) {
                      rows.push({ label: 'Estimated Cost', value: `$${Number(currentDetails.estimated_cost).toFixed(2)}` });
                    }
                    if (currentDetails.eol_reason) rows.push({ label: 'Reason', value: currentDetails.eol_reason });
                    if (currentDetails.notes) rows.push({ label: 'Notes', value: currentDetails.notes });
                    if (currentActionImages.length > 0) {
                      rows.push({
                        label: 'Work photo',
                        value: (
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row', flexWrap: 'nowrap' }}>
                            {currentActionImages.map((url, idx) => (
                              <Image key={`curr-wp-${idx}`} source={{ uri: url }} style={{ width: 80, height: 80, borderRadius: 8, marginRight: 8, borderWidth: 1, borderColor: '#eee' }} />
                            ))}
                          </ScrollView>
                        ),
                      });
                    }
                    return <DetailsGrid rows={rows} />;
                  })()
                ) : (
                  <View style={styles.currentWorkCard}>
                    {currentDetails.summary && (
                      <Text style={styles.currentWorkSummary}>{currentDetails.summary}</Text>
                    )}
                    <View style={styles.currentWorkMetaRow}>
                      {currentDetails.date && (
                        <View style={styles.currentWorkMetaItem}>
                          <MaterialIcons name="event" size={14} color="#4B5563" />
                          <Text style={styles.currentWorkMetaLabel}>Date</Text>
                          <Text style={styles.currentWorkMetaValue}>{prettyDate(currentDetails.date)}</Text>
                        </View>
                      )}
                      {currentDetails.priority && (
                        <View style={styles.currentWorkMetaItem}>
                          <MaterialIcons name="flag" size={14} color="#4B5563" />
                          <Text style={styles.currentWorkMetaLabel}>Priority</Text>
                          <Text style={styles.currentWorkMetaValue}>{String(currentDetails.priority)}</Text>
                        </View>
                      )}
                      {typeof currentDetails.estimated_cost !== 'undefined' && currentDetails.estimated_cost !== null && (
                        <View style={styles.currentWorkMetaItem}>
                          <MaterialIcons name="attach-money" size={14} color="#4B5563" />
                          <Text style={styles.currentWorkMetaLabel}>Est. Cost</Text>
                          <Text style={styles.currentWorkMetaValue}>{`$${Number(currentDetails.estimated_cost).toFixed(2)}`}</Text>
                        </View>
                      )}
                    </View>
                    {currentDetails.eol_reason && (
                      <Text style={styles.currentWorkNote}>
                        {currentDetails.eol_reason}
                      </Text>
                    )}
                    {currentDetails.notes && (
                      <Text style={styles.currentWorkNote}>
                        {currentDetails.notes}
                      </Text>
                    )}
                    {currentActionImages.length > 0 && (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={{ marginTop: 8 }}
                      >
                        {currentActionImages.map((url, idx) => (
                          <Image
                            key={`curr-wp-${idx}`}
                            source={{ uri: url }}
                            style={{ width: 80, height: 80, borderRadius: 8, marginRight: 8, borderWidth: 1, borderColor: '#eee' }}
                          />
                        ))}
                      </ScrollView>
                    )}
                  </View>
                )}
              </>
            )}

            {/* Additional/Custom fields */}
            {customFieldEntries.length > 0 && (
              <>
                <Text style={[styles.sectionH, { marginTop: 16 }]}>Additional Fields</Text>
                {(() => {
                  const { rows: dynRows } = buildDynamicData();
                  if (isWebWide) return <DetailsGrid rows={dynRows} />;
                  return dynRows.map((r, idx) => (
                    <Row key={`dyn-${idx}`} label={r.label} value={r.value} />
                  ));
                })()}
              </>
            )}

            {/* Tab bar */}
            <View style={styles.tabBar}>
              {[
                { key: 'notes',       label: 'Notes',        count: (assetNote ? 1 : 0) + typedNotes.length },
                { key: 'documents',   label: 'Documents',   count: (() => { try { return buildDynamicData().history.length; } catch { return 0; } })() },
                { key: 'maintenance', label: 'Maintenance',  count: workDetailHistory.length },
                { key: 'history',     label: 'History',     count: noteItems.length },
              ].map((tab) => {
                const isActive = activeTab === tab.key;
                return (
                  <TouchableOpacity
                    key={tab.key}
                    style={[styles.tabItem, isActive && styles.tabItemActive]}
                    onPress={() => setActiveTab(tab.key)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                      {tab.label}
                    </Text>
                    {tab.count > 0 && (
                      <View style={[styles.tabBadge, isActive && styles.tabBadgeActive]}>
                        <Text style={[styles.tabBadgeText, isActive && styles.tabBadgeTextActive]}>
                          {tab.count}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Tab: History */}
            {activeTab === 'history' && (
              <View style={styles.tabPanel}>
                {noteItems.length === 0 ? (
                  <View style={styles.tabEmpty}>
                    <MaterialIcons name="history" size={32} color={Colors.line} />
                    <Text style={styles.tabEmptyText}>No history yet.</Text>
                  </View>
                ) : (
                  <View style={{ gap: 10 }}>
                    {(notesExpanded ? noteItems : noteItems.slice(0, 5)).map((n) => {
                      const meta = typeMeta(n.type, { transferToMe: n.transferToMe });
                      const activityDescription = meta.description || (n.type ? String(n.type).replace(/_/g, ' ') : 'Note');
                      return (
                        <View key={n.id} style={styles.noteCard}>
                          <View style={styles.noteHead}>
                            <View style={styles.noteAvatar}><Text style={styles.noteAvatarText}>{initials(n.who)}</Text></View>
                            <View style={{ flex: 1, paddingRight: 8 }}>
                              <Text style={[styles.noteWho, { textTransform: 'capitalize' }]} numberOfLines={1}>
                                {activityDescription}
                              </Text>
                              <Text style={styles.noteWhen}>{prettyDateTime(n.when)}</Text>
                              <Text style={[styles.noteWhen, { fontSize: sf(12), color: '#6B7280', marginTop: 2 }]} numberOfLines={1}>
                                {n.who || 'System'}
                              </Text>
                            </View>
                            {!!n.type && (
                              <View style={[styles.noteBadge, { backgroundColor: meta.bg, borderColor: meta.bd }]}>
                                <Text style={[styles.noteBadgeText, { color: meta.fg }]}>{meta.label}</Text>
                              </View>
                            )}
                          </View>
                          <Text style={styles.noteText}>{n.note}</Text>
                          {!!(n.images && n.images.length) && (
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                              {n.images.map((url, idx) => (
                                <Image key={`${n.id}-img-${idx}`} source={{ uri: url }} style={{ width: 80, height: 80, borderRadius: 8, marginRight: 8, borderWidth: 1, borderColor: '#eee' }} />
                              ))}
                            </ScrollView>
                          )}
                        </View>
                      );
                    })}
                    {noteItems.length > 5 && (
                      <TouchableOpacity onPress={() => setNotesExpanded((v) => !v)} style={styles.noteToggle}>
                        <Text style={styles.noteToggleText}>{notesExpanded ? 'Show less' : `Show all ${noteItems.length}`}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            )}

            {/* Tab: Documents */}
            {activeTab === 'documents' && (
              <View style={styles.tabPanel}>
                {(() => {
                  try {
                    const { history } = buildDynamicData();
                    if (!history || !history.length) {
                      return (
                        <View style={styles.tabEmpty}>
                          <MaterialIcons name="insert-drive-file" size={32} color={Colors.line} />
                          <Text style={styles.tabEmptyText}>No documents attached.</Text>
                        </View>
                      );
                    }
                    const rows = history.map((h) => ({
                      label: `${h.label}${h.date ? ' (' + prettyDate(h.date) + ')' : ''}`,
                      value: (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          {renderFieldValue('documentation_url', h.url)}
                          <TouchableOpacity
                            onPress={() => handleDeleteDocument(h.id)}
                            disabled={docDeletingId === h.id}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            style={{ padding: 4 }}
                          >
                            <MaterialIcons name="delete" size={20} color={docDeletingId === h.id ? '#999' : '#c00'} />
                          </TouchableOpacity>
                        </View>
                      ),
                      right: false,
                    }));
                    const visible = docHistoryOpen ? rows : rows.slice(0, 3);
                    return (
                      <>
                        {isWebWide
                          ? <DetailsGrid rows={visible} />
                          : visible.map((r, i) => <Row key={`hist-${i}`} label={r.label} value={r.value} />)
                        }
                        {rows.length > 3 && (
                          <TouchableOpacity onPress={() => setDocHistoryOpen((v) => !v)} style={[styles.noteToggle, { marginTop: 8 }]}>
                            <Text style={styles.noteToggleText}>{docHistoryOpen ? 'Show less' : `Show all ${rows.length}`}</Text>
                          </TouchableOpacity>
                        )}
                      </>
                    );
                  } catch { return null; }
                })()}
              </View>
            )}

            {/* Tab: Maintenance */}
            {activeTab === 'maintenance' && (
              <View style={styles.tabPanel}>
                {workDetailHistory.length === 0 ? (
                  <View style={styles.tabEmpty}>
                    <MaterialIcons name="build" size={32} color={Colors.line} />
                    <Text style={styles.tabEmptyText}>No maintenance record yet.</Text>
                  </View>
                ) : (
                  <View style={{ gap: 12 }}>
                    {(maintenanceExpanded ? workDetailHistory : workDetailHistory.slice(0, 3)).map((w) => {
                      const meta = typeMeta(w.type === 'REPAIR' ? 'REPAIR' : 'MAINTENANCE');
                      const typeHeading = w.type === 'REPAIR' ? 'Repair' : 'Service';
                      const isService = w.type === 'MAINTENANCE';
                      const summaryWithNext = [
                        (w.summary || '').trim(),
                        isService && asset?.next_service_date ? `Next service: ${prettyDate(asset.next_service_date)}` : '',
                      ].filter(Boolean).join('. ');
                      return (
                        <View key={w.id} style={styles.noteCard}>
                          <View style={styles.noteHead}>
                            <View style={styles.noteAvatar}><Text style={styles.noteAvatarText}>{meta.label?.charAt(0) || '?'}</Text></View>
                            <View style={{ flex: 1, paddingRight: 8 }}>
                              <Text style={[styles.noteWho, { marginBottom: 2 }]}>{typeHeading}</Text>
                              <Text style={styles.noteWhen}>{prettyDateTime(w.signed_off_at || w.occurred_at || w.date)}</Text>
                            </View>
                            <View style={[styles.noteBadge, { backgroundColor: meta.bg, borderColor: meta.bd }]}>
                              <Text style={[styles.noteBadgeText, { color: meta.fg }]}>{meta.label}</Text>
                            </View>
                          </View>
                          <View style={{ marginTop: 8, gap: 4 }}>
                            {summaryWithNext ? <Row label="Summary" value={summaryWithNext} rightAlign={false} /> : null}
                            {w.priority ? <Row label="Priority" value={String(w.priority)} rightAlign={false} /> : null}
                            {typeof w.estimated_cost !== 'undefined' && w.estimated_cost !== null && (
                              <Row label="Estimated cost" value={`$${Number(w.estimated_cost).toFixed(2)}`} rightAlign={false} />
                            )}
                            {w.notes ? <Row label="Notes" value={w.notes} rightAlign={false} /> : null}
                          </View>
                          {!!(w.images && w.images.length) && (
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                              {w.images.map((url, idx) => (
                                <Image key={`${w.id}-wd-img-${idx}`} source={{ uri: url }} style={{ width: 80, height: 80, borderRadius: 8, marginRight: 8, borderWidth: 1, borderColor: '#eee' }} />
                              ))}
                            </ScrollView>
                          )}
                        </View>
                      );
                    })}
                    {workDetailHistory.length > 3 && (
                      <TouchableOpacity onPress={() => setMaintenanceExpanded((v) => !v)} style={[styles.noteToggle, { marginTop: 4 }]}>
                        <Text style={styles.noteToggleText}>{maintenanceExpanded ? 'Show less' : `Show all ${workDetailHistory.length}`}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            )}

            {/* Tab: Notes */}
            {activeTab === 'notes' && (
              <View style={styles.tabPanel}>
                {!assetNote && typedNotes.length === 0 ? (
                  <View style={styles.tabEmpty}>
                    <MaterialIcons name="notes" size={32} color={Colors.line} />
                    <Text style={styles.tabEmptyText}>No notes yet.</Text>
                  </View>
                ) : (
                  <View style={{ gap: 10 }}>
                    {!!assetNote && (
                      <View key="asset-note" style={styles.noteCard}>
                        <Text style={styles.noteText}>{assetNote}</Text>
                      </View>
                    )}
                    {(notesSectionExpanded ? typedNotes : typedNotes.slice(0, 4)).map((n) => (
                      <View key={n.id} style={styles.noteCard}>
                        <View style={styles.noteHead}>
                          <View style={styles.noteAvatar}><Text style={styles.noteAvatarText}>{initials(n.who)}</Text></View>
                          <View style={{ flex: 1, paddingRight: 8 }}>
                            <Text style={styles.noteWho} numberOfLines={1}>{n.who || 'System'}</Text>
                            <Text style={styles.noteWhen}>{prettyDateTime(n.when)}</Text>
                          </View>
                        </View>
                        <Text style={styles.noteText}>{n.note}</Text>
                      </View>
                    ))}
                    {(assetNote ? 1 : 0) + typedNotes.length > 4 && (
                      <TouchableOpacity onPress={() => setNotesSectionExpanded((v) => !v)} style={styles.noteToggle}>
                        <Text style={styles.noteToggleText}>{notesSectionExpanded ? 'Show less' : 'Show more'}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            )}

            {/* Linked assets */}
            {linkedAssetIds.length > 0 && (
              <>
                <Text style={[styles.sectionH, { marginTop: 18 }]}>Linked Assets</Text>
                <View style={styles.linkedWrap}>
                  {linkedAssetIds.map((id) => (
                    <TouchableOpacity
                      key={id}
                      style={styles.linkedChip}
                      onPress={() => router.push({ pathname: '/asset/[assetId]', params: { assetId: id } })}
                    >
                      <MaterialIcons name="link" size={16} color={Colors.accent} />
                      <Text style={styles.linkedChipText}>{id}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* Map */}
            <MapPreview location={displayLocation} />
          </View>
        </ScrollView>

        {/* Action bar */}
        <AssetActionBar
          asset={asset}
          isAdmin={isAdmin}
          normalizedReturnTo={normalizedReturnTo}
          onDelete={handleDelete}
        />
      </View>

      {/* QR modal */}
      <AssetQRModal
        visible={qrOpen}
        onClose={() => setQrOpen(false)}
        qrValue={qrPayload()}
        assetId={asset?.id || assetId}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  centerWrap: {
    flex: 1,
    backgroundColor: Colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroImage: {
    width: '100%',
    height: 220,
    resizeMode: 'cover',
    backgroundColor: Colors.chip,
  },
  detailCard: {
    backgroundColor: Colors.card,
    padding: 14,
    marginHorizontal: 0,
    marginTop: 12,
    marginBottom: 20,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.line,
    ...Shadows.card,
  },
  mapCard: {
    height: 220,
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: Colors.chip,
    marginTop: 16,
    marginBottom: 16,
  },
  map: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 8,
  },
  assetName: {
    flex: 1,
    fontSize: sf(18),
    fontWeight: 'bold',
    color: Colors.text,
    marginRight: 8,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: Colors.chip,
    borderRadius: Radius.lg,
  },
  metaChipText: { color: Colors.accent, fontWeight: '600', fontSize: sf(12) },
  sectionH: {
    fontSize: sf(16),
    fontWeight: '800',
    color: Colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 24,
    marginBottom: 10,
    textAlign: 'left',
    alignSelf: 'flex-start',
  },
  linkedWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  linkedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: Colors.chip,
    borderRadius: Radius.lg,
  },
  linkedChipText: { color: Colors.accent, fontWeight: '600', fontSize: sf(12) },
  mainContentWrap: { flex: 1, minHeight: 0 },
  detailScrollView: {
    flex: 1,
    ...(Platform.OS === 'web' ? { overflow: 'auto' } : {}),
  },
  actionBtn: {
    flex: 1,
    minHeight: 50,
    minWidth: 100,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  actionBtnPrimary: { backgroundColor: Colors.accent },
  actionText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: sf(15),
  },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 2,
    borderTopColor: Colors.line,
    marginTop: 20,
    marginHorizontal: -14,
    paddingHorizontal: 4,
    backgroundColor: Colors.bg,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    gap: 5,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: Colors.accent,
  },
  tabLabel: {
    fontSize: sf(11),
    fontWeight: '700',
    color: Colors.sub2,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  tabLabelActive: {
    color: Colors.accent,
  },
  tabBadge: {
    backgroundColor: Colors.chip,
    borderRadius: 999,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 18,
    alignItems: 'center',
  },
  tabBadgeActive: {
    backgroundColor: Colors.accentLight,
  },
  tabBadgeText: {
    fontSize: sf(10),
    fontWeight: '800',
    color: Colors.sub2,
  },
  tabBadgeTextActive: {
    color: Colors.accentDark,
  },
  tabPanel: {
    paddingTop: 14,
    minHeight: 80,
  },
  tabEmpty: {
    alignItems: 'center',
    paddingVertical: 28,
    gap: 8,
  },
  tabEmptyText: {
    color: Colors.sub2,
    fontSize: sf(14),
    fontWeight: '600',
  },

  // Notes styles
  noteCard: {
    borderWidth: 2,
    borderColor: Colors.line,
    borderRadius: Radius.md,
    padding: 10,
    backgroundColor: Colors.bg,
  },
  noteHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  noteAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.line,
    marginRight: 10,
  },
  noteAvatarText: { fontWeight: '800', color: Colors.accent, fontSize: sf(12) },
  noteWho: { color: Colors.text, fontWeight: '700' },
  noteWhen: { color: Colors.sub2, fontSize: sf(12), marginTop: 2 },
  noteBadge: {
    borderWidth: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  noteBadgeText: { fontWeight: '800', fontSize: sf(10) },
  noteText: { color: Colors.text },
  noteToggle: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: Radius.sm,
    borderWidth: 2,
    borderColor: Colors.line,
    backgroundColor: Colors.chip,
  },
  noteToggleText: { color: Colors.accent, fontWeight: '800' },

  // Current work (mobile card)
  currentWorkCard: {
    marginTop: 8,
    padding: 10,
    borderRadius: Radius.md,
    borderWidth: 2,
    borderColor: Colors.line,
    backgroundColor: Colors.bg,
  },
  currentWorkSummary: {
    fontSize: sf(14),
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 6,
  },
  currentWorkMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  currentWorkMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: Colors.chip,
    borderWidth: 2,
    borderColor: Colors.line,
  },
  currentWorkMetaLabel: {
    marginLeft: 4,
    fontSize: sf(11),
    fontWeight: '700',
    color: Colors.accent,
    textTransform: 'uppercase',
  },
  currentWorkMetaValue: {
    marginLeft: 4,
    fontSize: sf(12),
    fontWeight: '600',
    color: Colors.text,
  },
  currentWorkNote: {
    marginTop: 4,
    fontSize: sf(13),
    color: Colors.sub,
  },
});
