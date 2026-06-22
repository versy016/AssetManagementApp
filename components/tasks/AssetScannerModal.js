// components/tasks/AssetScannerModal.js
// A self-contained full-screen QR scanner shown inside other modals (e.g. the
// Create Task modal on iOS/Android). It parses the asset ID from a scanned QR
// and hands it back via onScanned — the caller resolves/validates the asset.

import React, { useCallback, useRef, useState } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, sf } from '../../constants/uiTheme';

// Pull a clean asset ID out of either a raw ID or a check-in URL QR.
function parseAssetId(data) {
  const raw = String(data || '');
  if (raw.startsWith('http')) {
    const m = raw.match(/\/check-in\/([A-Z0-9]+)/i);
    if (m && m[1]) return m[1].toUpperCase();
    return null;
  }
  if (/^[A-Z0-9]{6,10}$/i.test(raw)) return raw.toUpperCase();
  return null;
}

export default function AssetScannerModal({ visible, onClose, onScanned, busy }) {
  const [permission, requestPermission] = useCameraPermissions();
  const insets = useSafeAreaInsets();
  const lastRef = useRef({ code: '', ts: 0 });
  const [error, setError] = useState('');

  const handleScan = useCallback(({ data }) => {
    if (busy) return;
    const now = Date.now();
    if (data === lastRef.current.code && now - lastRef.current.ts < 2000) return;
    lastRef.current = { code: data, ts: now };
    const assetId = parseAssetId(data);
    if (!assetId) {
      setError('Invalid QR / asset code. Try again.');
      return;
    }
    setError('');
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); } catch { /* ignore */ }
    onScanned(assetId);
  }, [busy, onScanned]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={st.container}>
        {!permission ? (
          <View style={st.center}><ActivityIndicator color="#fff" /></View>
        ) : !permission.granted ? (
          <View style={st.center}>
            <MaterialIcons name="photo-camera" size={40} color="#fff" />
            <Text style={st.permText}>Camera access is required to scan an asset.</Text>
            <TouchableOpacity style={st.permBtn} onPress={requestPermission}>
              <Text style={st.permBtnText}>Grant Permission</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr', 'ean13', 'code128'] }}
              onBarcodeScanned={busy ? undefined : handleScan}
            />
            <View style={[st.topBar, { top: Math.max(8, (insets?.top || 0) + 6) }]}>
              <TouchableOpacity onPress={onClose} style={st.closeBtn} disabled={busy}>
                <MaterialIcons name="close" size={22} color="#fff" />
              </TouchableOpacity>
              <View style={st.banner}>
                <MaterialIcons name="qr-code-2" size={18} color={Colors.primary} />
                <Text style={st.bannerText}>Scan the asset's QR</Text>
              </View>
            </View>

            {/* Aiming frame */}
            <View style={st.frameWrap} pointerEvents="none">
              <View style={st.frame} />
            </View>

            {(busy || error) && (
              <View style={st.statusWrap} pointerEvents="none">
                {busy ? (
                  <View style={st.statusPill}>
                    <ActivityIndicator color="#fff" />
                    <Text style={st.statusText}>Looking up asset…</Text>
                  </View>
                ) : error ? (
                  <View style={[st.statusPill, st.statusError]}>
                    <MaterialIcons name="error-outline" size={18} color="#fff" />
                    <Text style={st.statusText}>{error}</Text>
                  </View>
                ) : null}
              </View>
            )}
          </>
        )}
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  permText: { color: '#fff', fontSize: sf(15), fontWeight: '700', textAlign: 'center' },
  permBtn: { backgroundColor: Colors.primary, paddingHorizontal: 18, paddingVertical: 12, borderRadius: Radius.md },
  permBtnText: { color: '#fff', fontWeight: '900', fontSize: sf(15) },
  topBar: {
    position: 'absolute', left: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  closeBtn: {
    backgroundColor: 'rgba(0,0,0,0.5)', width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
  },
  banner: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: Radius.md,
    paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  bannerText: { color: '#fff', fontSize: sf(14), fontWeight: '800' },
  frameWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  frame: {
    width: 230, height: 230, borderRadius: 24,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)',
  },
  statusWrap: { position: 'absolute', left: 0, right: 0, bottom: 60, alignItems: 'center' },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 999,
    paddingHorizontal: 18, paddingVertical: 12,
  },
  statusError: { backgroundColor: Colors.dangerFg },
  statusText: { color: '#fff', fontSize: sf(14), fontWeight: '800' },
});
