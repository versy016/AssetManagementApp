// AssetsMasterDetail.js
// Shared master-detail view used by Inventory → All Assets and the Asset Type
// detail page. Renders a status/sort chip bar, a scrollable master list, and a
// persistent detail panel on the right. QR modal opens in-place.

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { API_BASE_URL, CHECKIN_WEB_BASE_URL } from '../inventory-api/apiBase';
import StatusBadge, {
  STATUS_CONFIG,
  normalizeStatus,
} from '../components/ui/StatusBadge';
import { Colors, Radius, sf } from '../constants/uiTheme';
import AssetQRModal from '../components/asset/AssetQRModal';

/** ------- helpers -------- */

/** A "real" asset id is the 8-character QR code (e.g. 4STXN64Y).  Until the
 *  user assigns a printed QR sheet to an imported asset, the id is a raw
 *  UUID which we should NOT surface in the UI — it's noise to the operator. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isAwaitingQr = (id) => typeof id === 'string' && UUID_RE.test(id);

const prettyDate = (d) => {
  try {
    if (!d) return '—';
    let dt = null;
    if (typeof d === 'string') {
      const s = d.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const [y, m, day] = s.split('-').map(Number);
        dt = new Date(y, m - 1, day); // local date to avoid TZ shift
      } else {
        const t = new Date(s);
        dt = Number.isNaN(+t) ? null : t;
      }
    } else if (d instanceof Date) {
      dt = d;
    } else {
      const t = new Date(d);
      dt = Number.isNaN(+t) ? null : t;
    }
    if (!dt) return '—';
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    }).format(dt).replace(/ /g, ' ');
  } catch { return '—'; }
};

/* ─── Web-only: master-detail building blocks (design 1a) ─────────────────── */

// Horizontal filter-chip bar above the list (Status + count).
// `color` = status foreground (used for text + active fill)
// `bg`    = tinted background for the inactive state
// `bd`    = matching border for the inactive state
function WebStatusChip({ label, count, active, color, bg, bd, onPress }) {
  return (
    <TouchableOpacity
      style={[
        wS.statusChip,
        // Inactive but coloured — keep the status palette as a soft tint
        !active && color && { backgroundColor: bg || Colors.card, borderColor: bd || color },
        // Active — full status fill
        active && wS.statusChipActive,
        active && color && { backgroundColor: color, borderColor: color },
      ]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Text style={[
        wS.statusChipText,
        !active && color && { color },
        active && wS.statusChipTextActive,
      ]}>{label}</Text>
      {count !== undefined && (
        <View style={[
          wS.statusChipCount,
          !active && color && { backgroundColor: 'rgba(0,0,0,0.06)' },
          active && wS.statusChipCountActive,
        ]}>
          <Text style={[
            wS.statusChipCountText,
            !active && color && { color },
            active && wS.statusChipCountTextActive,
          ]}>{count}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// One row in the master list (thumb · name · status badge · ID pill).
function WebAssetListRow({ asset, selected, onPress }) {
  const awaitingQr = isAwaitingQr(asset?.id);
  // For awaiting-QR rows we never show the UUID anywhere — fall back to the
  // model / serial / type name instead, so the row is still identifiable.
  const fallback = asset?.name || asset?.asset_name || asset?.model
    || asset?.asset_type || asset?.type || asset?.asset_types?.name
    || 'Asset awaiting QR';
  const name = awaitingQr ? fallback : (asset?.name || asset?.asset_name || asset?.model || asset?.id);
  const serial = asset?.serial_number ?? asset?.fields?.serial_number;
  const type = asset?.asset_type ?? asset?.type ?? asset?.asset_types?.name;
  const datePurchased = asset?.date_purchased ?? asset?.fields?.date_purchased;
  const loc = asset?.location ?? asset?.fields?.location;
  const subParts = [];
  if (serial) subParts.push(`SN: ${serial}`);
  if (datePurchased) subParts.push(prettyDate(datePurchased));
  else if (loc) subParts.push(loc);
  const sub = subParts.join(' · ');

  return (
    <TouchableOpacity
      style={[wS.listRow, selected && wS.listRowSelected]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={wS.listRowThumb}>
        {asset?.image_url ? (
          <Image source={{ uri: asset.image_url }} style={wS.listRowImg} resizeMode="cover" />
        ) : (
          <Feather name="package" size={20} color={Colors.sub2} />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={wS.listRowName} numberOfLines={1}>{name}</Text>
        {!!sub && <Text style={wS.listRowSub} numberOfLines={1}>{sub}</Text>}
        {!!type && <Text style={wS.listRowType} numberOfLines={1}>{type}</Text>}
      </View>
      <View style={wS.listRowMeta}>
        <StatusBadge status={asset?.status} size="sm" style={{ alignSelf: 'flex-end' }} />
        {awaitingQr ? (
          <View style={[wS.listRowIdPill, wS.listRowIdPillAwaiting]}>
            <Text style={[wS.listRowIdPillText, wS.listRowIdPillTextAwaiting]}>AWAITING QR</Text>
          </View>
        ) : (
          <View style={wS.listRowIdPill}>
            <Text style={wS.listRowIdPillText}>{asset?.id}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// Single key–value row inside the detail panel.
function DetailKV({ k, v }) {
  return (
    <View style={wS.kvRow}>
      <Text style={wS.kvKey}>{k}</Text>
      <Text style={wS.kvValue} numberOfLines={2}>{v}</Text>
    </View>
  );
}

// The right-side detail panel. Renders an empty state when nothing is selected.
function WebAssetDetailPanel({ asset, onOpenFull, onShowQR, onTransfer }) {
  if (!asset) {
    return (
      <View style={wS.detailEmpty}>
        <MaterialIcons name="inventory-2" size={56} color={Colors.line} />
        <Text style={wS.detailEmptyTitle}>Select an asset</Text>
        <Text style={wS.detailEmptySub}>
          Click any row on the left to see its full details, status, and quick actions here.
        </Text>
      </View>
    );
  }

  const awaitingQr = isAwaitingQr(asset?.id);
  const type = asset?.asset_type ?? asset?.type ?? asset?.asset_types?.name;
  // For awaiting-QR rows, never surface the raw UUID — fall back to a
  // human-meaningful identifier (model / type / serial).
  const fallback = asset?.name || asset?.asset_name || asset?.model
    || type || asset?.serial_number || 'Asset awaiting QR';
  const name = awaitingQr ? fallback : (asset?.name || asset?.asset_name || asset?.model || asset?.id);
  const serial = asset?.serial_number ?? asset?.fields?.serial_number;
  const model = asset?.model ?? asset?.fields?.model;
  const loc = asset?.location ?? asset?.fields?.location;
  const assignedTo = asset?.assigned_to ?? asset?.users?.name ?? asset?.users?.email;
  const datePurchased = asset?.date_purchased ?? asset?.fields?.date_purchased;
  const updatedAt = asset?.updated_at;
  const description = asset?.description ?? asset?.notes ?? asset?.fields?.notes;

  const statusKey = normalizeStatus(asset?.status);
  const cfg = STATUS_CONFIG[statusKey] || STATUS_CONFIG.in_service;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
      {/* Hero */}
      <View style={[wS.detailHero, { backgroundColor: cfg.bg }]}>
        {asset?.image_url ? (
          <Image source={{ uri: asset.image_url }} style={wS.detailHeroImg} resizeMode="contain" />
        ) : (
          <MaterialIcons name={cfg.icon || 'inventory-2'} size={72} color={cfg.fg} />
        )}
      </View>

      <View style={wS.detailBody}>
        {awaitingQr ? (
          <Text style={[wS.detailIdLine, { color: Colors.warningFg || '#92400E' }]}>AWAITING QR</Text>
        ) : (
          <Text style={wS.detailIdLine}>ID · {asset?.id}</Text>
        )}
        <Text style={wS.detailTitle} numberOfLines={3}>{name}</Text>
        <Text style={wS.detailTypeLine}>
          {type ? `${type} · ` : ''}
          <Text style={{ color: cfg.fg }}>{cfg.label}</Text>
        </Text>

        {/* Quick actions — primary action only; everything else lives on the full page.
           "View QR" is hidden for awaiting-QR rows since there's no code to show yet. */}
        {!awaitingQr ? (
          <View style={wS.quickActionsRow}>
            <TouchableOpacity style={wS.quickAction} onPress={onShowQR}>
              <MaterialIcons name="qr-code-2" size={14} color={Colors.sub} />
              <Text style={wS.quickActionText}>View QR</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* KV details */}
        <View style={wS.kvList}>
          <DetailKV k="Serial" v={serial || '—'} />
          <DetailKV k="Model" v={model || '—'} />
          <DetailKV k="Purchased" v={datePurchased ? prettyDate(datePurchased) : '—'} />
          <DetailKV k="Location" v={loc || '—'} />
          <DetailKV k="Assigned to" v={assignedTo || '—'} />
          <DetailKV k="Updated" v={updatedAt ? prettyDate(updatedAt) : '—'} />
        </View>

        {!!description && (
          <View style={wS.descBox}>
            <Text style={wS.descLabel}>Description</Text>
            <Text style={wS.descText}>{description}</Text>
          </View>
        )}

        {/* Footer actions */}
        <View style={wS.detailFooter}>
          <TouchableOpacity style={[wS.detailFooterBtn, wS.detailFooterBtnPrimary]} onPress={onOpenFull}>
            <Text style={wS.detailFooterBtnPrimaryText}>Open full ↗</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

// Container that wires together the chip bar, master list, and detail panel.
function AssetsMasterDetail({
  assets,
  sortedAssets,
  loaded,
  assetSort,
  setAssetSort,
  filters,
  setFilters,
  router,
  returnTo = '/Inventory?tab=all',
}) {
  const [selectedId, setSelectedId] = useState(null);
  const selectedAsset = useMemo(
    () => sortedAssets.find((a) => String(a?.id) === String(selectedId)) || null,
    [sortedAssets, selectedId]
  );

  // Auto-select the first row whenever the filtered set changes and the
  // current selection is no longer in view.
  useEffect(() => {
    if (sortedAssets.length === 0) {
      if (selectedId) setSelectedId(null);
      return;
    }
    const stillThere = sortedAssets.some((a) => String(a?.id) === String(selectedId));
    if (!stillThere) setSelectedId(String(sortedAssets[0]?.id));
  }, [sortedAssets, selectedId]);

  // Status chip counts — computed from the FULL raw asset pool so each chip
  // always shows the maximum reachable count.
  const statusCounts = useMemo(() => {
    const out = { in_service: 0, on_hire: 0, repair: 0, maintenance: 0, end_of_life: 0 };
    for (const a of assets) {
      const k = normalizeStatus(a?.status);
      if (k in out) out[k] += 1;
    }
    return out;
  }, [assets]);

  const handlePickStatus = (label) => {
    if (!setFilters) return;
    setFilters((f) => ({ ...f, status: f?.status === label ? null : label }));
  };

  // QR modal — same as the asset detail page uses
  const [qrOpen, setQrOpen] = useState(false);
  const qrPayload = useMemo(() => {
    if (!selectedAsset) return '';
    const base = String(CHECKIN_WEB_BASE_URL || API_BASE_URL || '').replace(/\/+$/, '');
    return `${base}/check-in/${selectedAsset.id}`;
  }, [selectedAsset]);

  const onOpenFull = () => {
    if (!selectedAsset) return;
    router.push({
      pathname: '/asset/[assetId]',
      params: { assetId: String(selectedAsset.id), returnTo },
    });
  };
  const onShowQR = () => {
    if (!selectedAsset) return;
    setQrOpen(true);
  };
  const onTransfer = () => {
    if (!selectedAsset) return;
    router.push({ pathname: '/transfer/[assetId]', params: { assetId: String(selectedAsset.id) } });
  };

  return (
    <View style={{ flex: 1, flexDirection: 'column' }}>
      {/* ── Chip bar (status filter + sort) ── */}
      <View style={wS.chipsBar}>
        <Text style={wS.chipBarLabel}>Status</Text>
        <WebStatusChip
          label="Any"
          count={assets.length}
          active={!filters?.status}
          onPress={() => setFilters && setFilters((f) => ({ ...f, status: null }))}
        />
        <WebStatusChip
          label="In Service"
          count={statusCounts.in_service}
          color={STATUS_CONFIG.in_service.fg}
          bg={STATUS_CONFIG.in_service.bg}
          bd={STATUS_CONFIG.in_service.bd}
          active={filters?.status === 'In Service'}
          onPress={() => handlePickStatus('In Service')}
        />
        <WebStatusChip
          label="On Hire"
          count={statusCounts.on_hire}
          color={STATUS_CONFIG.on_hire.fg}
          bg={STATUS_CONFIG.on_hire.bg}
          bd={STATUS_CONFIG.on_hire.bd}
          active={filters?.status === 'On Hire'}
          onPress={() => handlePickStatus('On Hire')}
        />
        <WebStatusChip
          label="Repair"
          count={statusCounts.repair}
          color={STATUS_CONFIG.repair.fg}
          bg={STATUS_CONFIG.repair.bg}
          bd={STATUS_CONFIG.repair.bd}
          active={filters?.status === 'Repair'}
          onPress={() => handlePickStatus('Repair')}
        />
        <WebStatusChip
          label="Maintenance"
          count={statusCounts.maintenance}
          color={STATUS_CONFIG.maintenance.fg}
          bg={STATUS_CONFIG.maintenance.bg}
          bd={STATUS_CONFIG.maintenance.bd}
          active={filters?.status === 'Maintenance'}
          onPress={() => handlePickStatus('Maintenance')}
        />
        <WebStatusChip
          label="End of Life"
          count={statusCounts.end_of_life}
          color={STATUS_CONFIG.end_of_life.fg}
          bg={STATUS_CONFIG.end_of_life.bg}
          bd={STATUS_CONFIG.end_of_life.bd}
          active={filters?.status === 'End of Life'}
          onPress={() => handlePickStatus('End of Life')}
        />

        <View style={wS.chipBarSpacer} />

        <Text style={wS.chipBarLabel}>Sort</Text>
        <TouchableOpacity
          style={[wS.sortMiniChip, assetSort.field === 'name' && wS.sortMiniChipActive]}
          onPress={() => setAssetSort((s) => ({ field: 'name', dir: s.field === 'name' && s.dir === 'asc' ? 'desc' : 'asc' }))}
        >
          <Feather
            name={assetSort.field === 'name' && assetSort.dir === 'desc' ? 'arrow-down' : 'arrow-up'}
            size={11}
            color={assetSort.field === 'name' ? Colors.accent : Colors.sub}
          />
          <Text style={[wS.sortMiniChipText, assetSort.field === 'name' && wS.sortMiniChipTextActive]}>Name</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[wS.sortMiniChip, assetSort.field === 'updated' && wS.sortMiniChipActive]}
          onPress={() => setAssetSort((s) => ({ field: 'updated', dir: s.field === 'updated' && s.dir === 'asc' ? 'desc' : 'asc' }))}
        >
          <Feather
            name={assetSort.field === 'updated' && assetSort.dir === 'desc' ? 'arrow-down' : 'arrow-up'}
            size={11}
            color={assetSort.field === 'updated' ? Colors.accent : Colors.sub}
          />
          <Text style={[wS.sortMiniChipText, assetSort.field === 'updated' && wS.sortMiniChipTextActive]}>Updated</Text>
        </TouchableOpacity>
      </View>

      {/* ── Master-detail split ── */}
      <View style={wS.masterDetail}>
        <View style={wS.masterList}>
          <View style={wS.masterListHeader}>
            <Text style={wS.masterListCount}>
              {sortedAssets.length} asset{sortedAssets.length !== 1 ? 's' : ''}
            </Text>
          </View>
          {!loaded ? (
            <View style={wS.centred}>
              <ActivityIndicator size="large" color={Colors.accent} />
            </View>
          ) : sortedAssets.length === 0 ? (
            <View style={wS.centred}>
              <MaterialIcons name="search-off" size={40} color={Colors.sub2} />
              <Text style={wS.emptyText}>No assets match your filters</Text>
              <Text style={wS.emptySub}>Try removing a chip or clearing the search.</Text>
            </View>
          ) : (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24 }}>
              {sortedAssets.map((asset) => (
                <WebAssetListRow
                  key={String(asset.id)}
                  asset={asset}
                  selected={String(asset.id) === String(selectedId)}
                  onPress={() => setSelectedId(String(asset.id))}
                />
              ))}
            </ScrollView>
          )}
        </View>

        <View style={wS.detailPane}>
          <WebAssetDetailPanel
            asset={selectedAsset}
            onOpenFull={onOpenFull}
            onShowQR={onShowQR}
            onTransfer={onTransfer}
          />
        </View>
      </View>

      {/* QR code modal — shown in place, no navigation */}
      <AssetQRModal
        visible={qrOpen && !!selectedAsset}
        onClose={() => setQrOpen(false)}
        qrValue={qrPayload}
        assetId={selectedAsset?.id || ''}
      />
    </View>
  );
}

export default AssetsMasterDetail;

/* ----------------- styles ----------------- */
const wS = StyleSheet.create({
  // Empty / loading
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 48 },
  emptyText: { fontSize: sf(16), fontWeight: '700', color: Colors.sub },
  emptySub: { fontSize: sf(13), color: Colors.sub2 },

  // ── Master-detail (design 1a) ────────────────────────────────────────
  chipsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  chipBarLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.sub2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginRight: 2,
  },
  chipBarSpacer: { flex: 1, minWidth: 16 },

  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.card,
  },
  statusChipActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  statusChipText: { fontSize: 12, fontWeight: '700', color: Colors.sub },
  statusChipTextActive: { color: '#fff' },
  statusChipCount: {
    minWidth: 18,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.06)',
    alignItems: 'center',
  },
  statusChipCountActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  statusChipCountText: { fontSize: 10, fontWeight: '800', color: Colors.sub, fontVariant: ['tabular-nums'] },
  statusChipCountTextActive: { color: '#fff' },

  sortMiniChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.chip,
  },
  sortMiniChipActive: { backgroundColor: Colors.accentLight, borderColor: Colors.accent },
  sortMiniChipText: { fontSize: 12, fontWeight: '700', color: Colors.sub },
  sortMiniChipTextActive: { color: Colors.accent },

  masterDetail: { flex: 1, flexDirection: 'row', minHeight: 0 },
  masterList: { flex: 1, minHeight: 0, backgroundColor: Colors.bg },
  masterListHeader: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
    backgroundColor: Colors.bg,
  },
  masterListCount: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.sub2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 12,
    marginTop: 8,
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  listRowSelected: {
    borderColor: Colors.accent,
    backgroundColor: '#FFF7ED',
    borderLeftWidth: 4,
  },
  listRowThumb: {
    width: 48,
    height: 48,
    borderRadius: Radius.sm,
    backgroundColor: Colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  listRowImg: { width: 48, height: 48 },
  listRowName: { fontSize: 14, fontWeight: '800', color: Colors.text },
  listRowSub: { fontSize: 12, color: Colors.sub, marginTop: 2 },
  listRowType: {
    fontSize: 10,
    color: Colors.sub2,
    textTransform: 'uppercase',
    fontWeight: '800',
    letterSpacing: 0.3,
    marginTop: 3,
  },
  listRowMeta: { alignItems: 'flex-end', gap: 6 },
  listRowIdPill: { backgroundColor: Colors.primary, paddingHorizontal: 7, paddingVertical: 2, borderRadius: Radius.sm },
  listRowIdPillText: { fontSize: 10, color: '#fff', fontWeight: '800', fontVariant: ['tabular-nums'] },
  // "Awaiting QR" pill — amber tone so it reads as a status hint instead of an ID.
  listRowIdPillAwaiting: { backgroundColor: Colors.warningBg || '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A' },
  listRowIdPillTextAwaiting: { color: Colors.warningFg || '#92400E', letterSpacing: 0.5 },

  detailPane: {
    width: 380,
    minWidth: 320,
    backgroundColor: Colors.card,
    borderLeftWidth: 1,
    borderLeftColor: Colors.line,
  },
  detailEmpty: {
    flex: 1,
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  detailEmptyTitle: { fontSize: 16, fontWeight: '800', color: Colors.sub },
  detailEmptySub: { fontSize: 13, color: Colors.sub2, textAlign: 'center', lineHeight: 18 },

  detailHero: { height: 200, alignItems: 'center', justifyContent: 'center', padding: 16 },
  detailHeroImg: { width: '100%', height: '100%' },
  detailBody: { padding: 18 },
  detailIdLine: { fontFamily: 'monospace', fontSize: 11, color: Colors.sub, marginBottom: 4 },
  detailTitle: { fontSize: 20, fontWeight: '900', color: Colors.text, marginBottom: 4 },
  detailTypeLine: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, color: Colors.sub2 },

  quickActionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 },
  quickAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    backgroundColor: Colors.chip,
    borderRadius: Radius.sm,
  },
  quickActionText: { fontSize: 12, fontWeight: '700', color: Colors.sub },

  kvList: { marginTop: 18 },
  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
    borderStyle: 'dashed',
    gap: 12,
  },
  kvKey: { fontSize: 13, color: Colors.sub, flexShrink: 0 },
  kvValue: { fontSize: 13, fontWeight: '700', color: Colors.text, textAlign: 'right', flex: 1 },

  descBox: { marginTop: 14, padding: 12, backgroundColor: Colors.bg, borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.line },
  descLabel: { fontSize: 11, fontWeight: '800', color: Colors.sub2, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  descText: { fontSize: 13, color: Colors.text, lineHeight: 18 },

  detailFooter: { flexDirection: 'row', gap: 8, marginTop: 18 },
  detailFooterBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailFooterBtnPrimary: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  detailFooterBtnPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
