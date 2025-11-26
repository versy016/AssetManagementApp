import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, FlatList } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import { getAuth } from 'firebase/auth';
import { getShortcutType, SHORTCUT_TYPES } from '../../constants/ShortcutTypes';
import { processScannedAsset } from '../../utils/ShortcutExecutor';

export default function QRScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState('back');
  const [scanMode, setScanMode] = useState('single');
  const [scannedItems, setScannedItems] = useState([]);
  const [isScanning, setIsScanning] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastScanned, setLastScanned] = useState('');
  const [toast, setToast] = useState({ visible: false, text: '', kind: 'error' });
  const lastScannedRef = useRef({ code: '', timestamp: 0 });
  const router = useRouter();
  const params = useLocalSearchParams();
  const intent = params?.intent ? String(params.intent) : null;
  const returnTo = params?.returnTo ? String(params.returnTo) : null;
  const placeholderId = params?.placeholderId ? String(params.placeholderId) : null;
  const shortcutType = params?.shortcutType ? String(params.shortcutType) : null;
  const isQuickViewShortcut = shortcutType === SHORTCUT_TYPES.QUICK_VIEW.id;
  const isQuickTransferShortcut = shortcutType === SHORTCUT_TYPES.QUICK_TRANSFER.id;
  const isQuickServiceShortcut = shortcutType === SHORTCUT_TYPES.QUICK_SERVICE.id;
  const isQuickRepairShortcut = shortcutType === SHORTCUT_TYPES.QUICK_REPAIR.id;
  const shouldHoldOnShortcut = isQuickViewShortcut || isQuickTransferShortcut || isQuickServiceShortcut || isQuickRepairShortcut;
  // Extra params to round-trip back to caller (e.g., fromAssetId, nested returnTo)
  const rawReturnParams = params?.returnParams ? String(params.returnParams) : null;
  let extraParams = {};
  try {
    if (rawReturnParams) {
      const decoded = decodeURIComponent(rawReturnParams);
      const parsed = JSON.parse(decoded);
      if (parsed && typeof parsed === 'object') extraParams = parsed;
    }
  } catch { }
  const insets = useSafeAreaInsets();

  // Get shortcut metadata if scanning for a shortcut
  const shortcutMeta = shortcutType ? getShortcutType(shortcutType) : null;

  const handleClose = useCallback(() => {
    try {
      // Stop scanning immediately to release the camera quickly
      setIsScanning(false);
      setIsProcessing(false);
      if (returnTo) {
        router.replace({ pathname: returnTo, params: { ...extraParams } });
      } else {
        // Prefer going back; if not possible, go to dashboard
        try { router.back(); }
        catch { router.replace('/(tabs)/dashboard'); }
      }
    } catch {
      // As a last resort
      router.replace('/(tabs)/dashboard');
    }
  }, [returnTo, JSON.stringify(extraParams)]);

  // Check if we're in multi-scan mode based on the URL
  useEffect(() => {
    if (params.mode === 'multi') {
      setScanMode('multi');
    }
  }, [params]);

  const processScannedItem = useCallback((data) => {
    const now = Date.now();

    // Skip if we've seen this code very recently (within 2 seconds)
    if (data === lastScannedRef.current.code &&
      (now - lastScannedRef.current.timestamp < 2000)) {
      return null;
    }

    try {
      let assetId;

      if (data.startsWith('http')) {
        const match = data.match(/\/check-in\/([A-Z0-9]+)/i);
        if (!match || !match[1]) throw new Error('Invalid QR format');
        assetId = match[1].toUpperCase();
      } else {
        if (!/^[A-Z0-9]{6,10}$/i.test(data)) throw new Error('Invalid asset ID format');
        assetId = data.toUpperCase();
      }

      // Update the last scanned reference
      lastScannedRef.current = {
        code: data,
        timestamp: now
      };

      return assetId;
    } catch (e) {
      console.error('❌ Invalid QR:', e);
      throw e;
    }
  }, []);

  const handleBarCodeScanned = useCallback(async ({ data }) => {
    if (!isScanning || isProcessing) return;

    try {
      const assetId = processScannedItem(data);
      if (!assetId) return;

      // Check for duplicates in multi-scan mode (case-insensitive check)
      if (scanMode === 'multi' && scannedItems.some(id => id.toUpperCase() === assetId.toUpperCase())) {
        // Soft-handle duplicate in multi-scan: show toast, no native alert
        setToast({ visible: true, text: 'This asset has already been scanned', kind: 'warn' });
        setTimeout(() => setToast({ visible: false, text: '', kind: 'warn' }), 1800);
        return;
      }

      setIsProcessing(true);

      if (scanMode === 'multi') {
        // Use functional update to ensure we have the latest state
        setScannedItems(prev => {
          // Double-check for duplicates to be extra safe
          if (prev.some(id => id.toUpperCase() === assetId.toUpperCase())) {
            return prev;
          }
          return [...prev, assetId];
        });

        setLastScanned(assetId);

        // Auto-reset after 1 second
        const timer = setTimeout(() => {
          setLastScanned('');
          setIsProcessing(false);
        }, 1000);

        return () => clearTimeout(timer);
      } else {
        if (intent === 'pick-id' && returnTo) {
          // Verify the scanned QR is an unassigned placeholder before returning
          try {
            const res = await fetch(`${API_BASE_URL}/assets/${assetId}`);
            if (!res.ok) {
              if (res.status === 404) {
                Alert.alert('QR Not Found', 'This QR/ID does not exist.');
              } else {
                Alert.alert('Error', 'Unable to verify QR. Try again.');
              }
              setIsProcessing(false);
              return;
            }
            const asset = await res.json();
            const hasDyn = asset && asset.fields && Object.keys(asset.fields || {}).length > 0;
            const isFree = !asset?.serial_number && !asset?.model && !asset?.assigned_to_id && !asset?.type_id && !asset?.documentation_url && !asset?.image_url && !hasDyn;
            if (!isFree) {
              Alert.alert('QR Already Assigned', 'This QR is already assigned. Please scan an unused QR.');
              setIsProcessing(false);
              return;
            }
          } catch (e) {
            Alert.alert('Network Error', 'Failed to validate QR. Please try again.');
            setIsProcessing(false);
            return;
          }
          // Return the scanned ID to the origin route (e.g., /asset/new)
          router.replace({ pathname: returnTo, params: { preselectId: assetId, ...extraParams } });
        } else if (intent === 'swap-target' && placeholderId) {
          // Confirm and perform swap: move scanned asset onto placeholderId's QR
          try {
            // Build auth headers
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

            // Check target QR state (block End of Life; require 'Available' for simple assign)
            let toIsEmpty = false;
            try {
              const chk = await fetch(`${API_BASE_URL}/assets/${placeholderId}`);
              if (!chk.ok) throw new Error('Target QR not found');
              const tgt = await chk.json();
              const hasDyn = tgt && tgt.fields && Object.keys(tgt.fields || {}).length > 0;
              const status = String(tgt?.status || '').toLowerCase();
              if (status === 'end of life') {
                Alert.alert('Decommissioned QR', 'This QR is End of Life and cannot receive assets. Please use a fresh placeholder.');
                setIsProcessing(false);
                return;
              }
              toIsEmpty = !tgt?.serial_number && !tgt?.model && !tgt?.assigned_to_id && !tgt?.type_id && !tgt?.documentation_url && !tgt?.image_url && !tgt?.other_id && !hasDyn && (status === 'available');
            } catch (e) {
              Alert.alert('Error', e?.message || 'Failed to verify target QR');
              setIsProcessing(false);
              return;
            }

            if (toIsEmpty) {
              // Simple case: target is placeholder — move scanned asset onto it
              const confirmed = await new Promise((resolve) => {
                Alert.alert(
                  'Confirm Swap',
                  `Move asset ${assetId} onto QR ${placeholderId}?`,
                  [
                    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                    { text: 'Confirm', style: 'destructive', onPress: () => resolve(true) },
                  ]
                );
              });
              if (!confirmed) { setIsProcessing(false); return; }
              const resp = await fetch(`${API_BASE_URL}/assets/swap-qr`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ from_id: assetId, to_id: placeholderId }),
              });
              const body = await resp.json().catch(() => ({}));
              if (!resp.ok) throw new Error(body?.error || 'Swap failed');
              if (returnTo) { try { router.replace(String(returnTo)); } catch { router.back(); } }
              else { router.replace(`/check-in/${placeholderId}`); }
            } else {
              // Advanced: both sides in-use — perform 3-step swap via an available placeholder
              const optsRes = await fetch(`${API_BASE_URL}/assets/asset-options`);
              const opts = optsRes.ok ? await optsRes.json() : null;
              const placeholders = Array.isArray(opts?.assetIds) ? opts.assetIds : [];
              const tempId = placeholders.find((pid) => typeof pid === 'string');
              if (!tempId) {
                Alert.alert('No Blank QR Available', 'Generate a new blank QR ID and try again.');
                setIsProcessing(false);
                return;
              }

              const confirm2 = await new Promise((resolve) => {
                Alert.alert(
                  'Confirm Swap',
                  `Swap assets between ${assetId} and ${placeholderId}?`,
                  [
                    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                    { text: 'Confirm', style: 'destructive', onPress: () => resolve(true) },
                  ]
                );
              });
              if (!confirm2) { setIsProcessing(false); return; }

              // A=placeholderId asset, B=scanned assetId, P=tempId
              // 1) A -> P
              let r1 = await fetch(`${API_BASE_URL}/assets/swap-qr`, { method: 'POST', headers, body: JSON.stringify({ from_id: placeholderId, to_id: tempId }) });
              let b1 = await r1.json().catch(() => ({}));
              if (!r1.ok) throw new Error(b1?.error || 'Step 1 failed');
              // 2) B -> A
              let r2 = await fetch(`${API_BASE_URL}/assets/swap-qr`, { method: 'POST', headers, body: JSON.stringify({ from_id: assetId, to_id: placeholderId }) });
              let b2 = await r2.json().catch(() => ({}));
              if (!r2.ok) throw new Error(b2?.error || 'Step 2 failed');
              // 3) P -> B
              let r3 = await fetch(`${API_BASE_URL}/assets/swap-qr`, { method: 'POST', headers, body: JSON.stringify({ from_id: tempId, to_id: assetId }) });
              let b3 = await r3.json().catch(() => ({}));
              if (!r3.ok) throw new Error(b3?.error || 'Step 3 failed');

              if (returnTo) { try { router.replace(String(returnTo)); } catch { router.back(); } }
              else { router.replace(`/check-in/${placeholderId}`); }
            }
          } catch (e) {
            Alert.alert('Error', e?.message || 'Failed to swap');
          } finally {
            setIsProcessing(false);
          }
        } else if (shortcutType) {
          // Handle shortcut execution
          try {
            // Fetch asset data
            const res = await fetch(`${API_BASE_URL}/assets/${assetId}`);
            if (!res.ok) {
              throw new Error('Asset not found');
            }
            const assetData = await res.json();

            // Get current user
            const auth = getAuth();
            const user = auth?.currentUser;
            if (!user) {
              throw new Error('You must be logged in');
            }

            if (shortcutType === SHORTCUT_TYPES.QUICK_TRANSFER.id) {
              const transferReturnTarget = returnTo ? String(returnTo) : '/(tabs)/dashboard';
              router.push({ pathname: '/transfer/[assetId]', params: { assetId, returnTo: transferReturnTarget } });
              setToast({ visible: true, text: 'Select a user to transfer this asset', kind: 'success' });
              setIsProcessing(false);
              setIsScanning(false);
              setTimeout(() => setToast({ visible: false, text: '', kind: 'success' }), 1500);
            } else {
              // Process via ShortcutExecutor
              await processScannedAsset(
                shortcutType,
                assetId,
                assetData,
                router,
                user,
                (message) => {
                  // Success callback
                  setToast({ visible: true, text: message, kind: 'success' });
                  if (shouldHoldOnShortcut) {
                    setIsProcessing(false);
                    setIsScanning(false);
                    setTimeout(() => setToast({ visible: false, text: '', kind: 'success' }), 1500);
                    return;
                  }
                  setTimeout(() => {
                    setToast({ visible: false, text: '', kind: 'success' });
                    // Return to dashboard after success
                    if (returnTo) {
                      router.replace(returnTo);
                    } else {
                      router.replace('/(tabs)/dashboard');
                    }
                  }, 1500);
                },
                (error) => {
                  // Error callback
                  setToast({ visible: true, text: error, kind: 'error' });
                  setTimeout(() => setToast({ visible: false, text: '', kind: 'error' }), 2000);
                  setIsProcessing(false);
                },
                returnTo || '/(tabs)/dashboard'
              );
            }
          } catch (e) {
            Alert.alert('Error', e.message || 'Failed to process shortcut');
            setIsProcessing(false);
          }
        } else {
          router.push(`/check-in/${assetId}`);
        }
      }
    } catch (e) {
      console.error('❌ Scan error:', e);
      const msg = (e && e.message) ? String(e.message) : 'Scan failed';
      // Prefer non-blocking toast for expected errors
      if (/already been scanned/i.test(msg)) {
        setToast({ visible: true, text: 'This asset has already been scanned', kind: 'warn' });
        setTimeout(() => setToast({ visible: false, text: '', kind: 'warn' }), 1800);
        setIsProcessing(false);
        return;
      }
      if (/invalid/i.test(msg)) {
        setToast({ visible: true, text: 'Invalid QR/ID. Try again.', kind: 'error' });
        setTimeout(() => setToast({ visible: false, text: '', kind: 'error' }), 1800);
        setIsProcessing(false);
        return;
      }
      // Fallback to native alert for unexpected errors
      Alert.alert('Error', msg, [{ text: 'OK', onPress: () => setIsProcessing(false) }]);
    }
  }, [isScanning, isProcessing, scanMode, scannedItems, processScannedItem, returnTo, JSON.stringify(extraParams)]);

  const removeItem = (itemToRemove) => {
    setScannedItems(prev => prev.filter(item => item !== itemToRemove));
  };

  const handleSubmit = () => {
    if (scannedItems.length === 0) {
      Alert.alert('No Items', 'Please scan at least one asset before submitting.');
      return;
    }

    // Navigate to the scanned assets list with the scanned items
    router.push({
      pathname: '/multi-scan/list',
      params: {
        items: encodeURIComponent(JSON.stringify(scannedItems))
      }
    });
  };

  if (!permission) {
    return <View style={styles.center}><Text>Loading permissions...</Text></View>;
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text>Camera access is required</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.cameraContainer}>
        <CameraView
          style={styles.camera}
          facing={facing}
          barcodeScannerSettings={{ barcodeTypes: ['qr', 'ean13', 'code128'] }}
          onBarcodeScanned={isScanning ? handleBarCodeScanned : undefined}
        />
        {/* Top overlay bar */}
        <View style={[styles.topBar, { top: Math.max(8, (insets?.top || 0) + 6) }]} pointerEvents="box-none">
          <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
            <MaterialIcons name="close" size={22} color="#fff" />
          </TouchableOpacity>
          {/* In single-scan mode, allow quick pause */}
          {scanMode !== 'multi' && !shortcutType && (
            <TouchableOpacity
              onPress={() => setIsScanning((v) => !v)}
              style={[styles.pauseBtn, !isScanning && { backgroundColor: 'rgba(0,0,0,0.65)' }]}
            >
              <MaterialIcons name={isScanning ? 'pause' : 'play-arrow'} size={20} color="#fff" />
            </TouchableOpacity>
          )}
        </View>

        {/* Shortcut indicator banner */}
        {shortcutMeta && (
          <View style={[styles.shortcutBanner, { top: Math.max(54, (insets?.top || 0) + 52) }]}>
            <MaterialIcons name={shortcutMeta.icon} size={18} color={shortcutMeta.color} />
            <Text style={styles.shortcutBannerText}>{shortcutMeta.label}</Text>
            <Text style={styles.shortcutBannerSubtext}>Scan asset to continue</Text>
          </View>
        )}

        {!isScanning && (
          <View style={styles.overlay} pointerEvents="none">
            <Text style={styles.overlayText}>Scanning Paused</Text>
          </View>
        )}
      </View>

      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.controlButton, styles.flipButton]}
          onPress={() => setFacing(prev => (prev === 'back' ? 'front' : 'back'))}
        >
          <MaterialIcons name="flip-camera-android" size={24} color="white" />
        </TouchableOpacity>

        {scanMode === 'multi' && (
          <>
            <TouchableOpacity
              style={[
                styles.controlButton,
                isScanning ? styles.stopButton : styles.startButton,
                isProcessing && styles.disabledButton
              ]}
              onPress={() => !isProcessing && setIsScanning(!isScanning)}
              disabled={isProcessing}
            >
              <MaterialIcons
                name={isScanning ? 'stop' : 'play-arrow'}
                size={24}
                color="white"
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.controlButton,
                styles.submitButton,
                (scannedItems.length === 0 || isProcessing) && styles.disabledButton
              ]}
              onPress={handleSubmit}
              disabled={scannedItems.length === 0 || isProcessing}
            >
              <Text style={styles.buttonText}>
                Submit ({scannedItems.length})
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {scanMode === 'multi' && (
        <View style={styles.scannedItems}>
          <Text style={styles.sectionTitle}>
            Scanned Items ({scannedItems.length})
            {isProcessing && lastScanned && (
              <Text style={styles.processingText}> Processing {lastScanned}...</Text>
            )}
          </Text>
          {scannedItems.length > 0 ? (
            <FlatList
              data={scannedItems}
              keyExtractor={(item, index) => `${item}-${index}`}
              renderItem={({ item }) => (
                <View style={styles.item}>
                  <Text style={styles.itemText}>{item}</Text>
                  <TouchableOpacity
                    onPress={() => !isProcessing && removeItem(item)}
                    disabled={isProcessing}
                  >
                    <MaterialIcons
                      name="close"
                      size={24}
                      color={isProcessing ? "#ccc" : "#ff4444"}
                    />
                  </TouchableOpacity>
                </View>
              )}
            />
          ) : (
            <Text style={styles.emptyText}>
              {isProcessing ? 'Processing...' : 'No items scanned yet'}
            </Text>
          )}
        </View>
      )}

      {/* Inline toast (non-blocking) */}
      {toast.visible && (
        <View style={[
          styles.toast,
          toast.kind === 'warn' ? styles.toastWarn : toast.kind === 'success' ? styles.toastSuccess : styles.toastError,
          { bottom: Math.max(12, (insets?.bottom || 0) + 12) }
        ]}>
          <MaterialIcons
            name={toast.kind === 'warn' ? 'warning-amber' : toast.kind === 'success' ? 'check-circle' : 'error-outline'}
            size={18}
            color={toast.kind === 'warn' ? '#92400E' : toast.kind === 'success' ? '#047857' : '#B91C1C'}
          />
          <Text style={[styles.toastText, { color: toast.kind === 'warn' ? '#92400E' : toast.kind === 'success' ? '#047857' : '#B91C1C' }]}>
            {toast.text}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  cameraContainer: {
    flex: 1,
    position: 'relative',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  topBar: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  closeBtn: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)'
  },
  pauseBtn: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)'
  },
  shortcutBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  shortcutBannerText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  shortcutBannerSubtext: {
    fontSize: 12,
    color: '#64748B',
    marginLeft: 'auto',
  },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 18,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
  },
  toastWarn: { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' },
  toastError: { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' },
  toastSuccess: { backgroundColor: '#D1FAE5', borderColor: '#A7F3D0' },
  toastText: { fontWeight: '800' },
  overlayText: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  controlButton: {
    marginHorizontal: 10,
    padding: 12,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipButton: {
    backgroundColor: '#1E90FF',
  },
  startButton: {
    backgroundColor: '#4CAF50',
  },
  stopButton: {
    backgroundColor: '#f44336',
  },
  submitButton: {
    backgroundColor: '#1E90FF',
    paddingHorizontal: 20,
  },
  button: {
    backgroundColor: '#1E90FF',
    padding: 15,
    borderRadius: 5,
    alignItems: 'center',
    marginTop: 20,
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  scannedItems: {
    flex: 1,
    padding: 15,
    backgroundColor: '#fff',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  itemText: {
    fontSize: 16,
  },
  emptyText: {
    textAlign: 'center',
    color: '#888',
    marginTop: 20,
  },
  disabledButton: {
    opacity: 0.5,
  },
  processingText: {
    color: '#1E90FF',
    fontWeight: 'normal',
    fontSize: 14,
  },
});
