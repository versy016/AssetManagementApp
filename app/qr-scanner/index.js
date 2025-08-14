import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, FlatList } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

export default function QRScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState('back');
  const [scanMode, setScanMode] = useState('single');
  const [scannedItems, setScannedItems] = useState([]);
  const [isScanning, setIsScanning] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastScanned, setLastScanned] = useState('');
  const lastScannedRef = useRef({ code: '', timestamp: 0 });
  const router = useRouter();
  const params = useLocalSearchParams();

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

  const handleBarCodeScanned = useCallback(({ data }) => {
    if (!isScanning || isProcessing) return;
    
    try {
      const assetId = processScannedItem(data);
      if (!assetId) return;

      // Check for duplicates in multi-scan mode (case-insensitive check)
      if (scanMode === 'multi' && scannedItems.some(id => id.toUpperCase() === assetId.toUpperCase())) {
        throw new Error('This asset has already been scanned.');
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
        router.push(`/check-in/${assetId}`);
      }
    } catch (e) {
      console.error('❌ Scan error:', e);
      Alert.alert('Error', e.message, [
        { 
          text: 'OK',
          onPress: () => {
            setIsProcessing(false);
          }
        }
      ]);
    }
  }, [isScanning, isProcessing, scanMode, scannedItems, processScannedItem]);

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
        {!isScanning && (
          <View style={styles.overlay}>
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
