import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Alert, Dimensions, Platform } from 'react-native';
import { Camera, CameraType } from 'expo-camera';

// A pure QRScanner component that accepts a callback
export default function QRScanner({ onScanned }) {
  const [hasPermission, setHasPermission] = useState(null);
  const [scanned, setScanned] = useState(false);
  const cameraRef = useRef(null);

  // Calculate dimension inside component
  const { width } = Dimensions.get('window');
  const qrSize = width * 0.7;

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const handleBarCodeScanned = ({ data }) => {
    setScanned(true);
    let assetId = data;
    try {
      if (data.startsWith('http')) {
        const url = new URL(data);
        assetId = url.pathname.split('/').pop();
      }
      if (!assetId) throw new Error();
      onScanned(assetId);
    } catch {
      Alert.alert(
        'Invalid QR Code',
        'This QR code format is not recognized.',
        [{ text: 'OK', onPress: () => setScanned(false) }]
      );
    }
  };

  // Permission states
  if (hasPermission === null) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>Requesting camera permission...</Text>
      </View>
    );
  }
  if (hasPermission === false) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>No camera access granted.</Text>
      </View>
    );
  }
  // Web fallback
  if (Platform.OS === 'web') {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>QR scanning is not supported on web.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        ref={cameraRef}
        style={styles.camera}
        type={CameraType.back}
        onBarCodeScanned={scanned ? undefined : handleBarCodeScanned}
        barCodeScannerSettings={{ barCodeTypes: ['qr'] }}
      >
        {/* Overlay with dynamic size and centering */}
        <View
          style={[
            styles.overlay,
            {
              width: qrSize,
              height: qrSize,
              marginLeft: (width - qrSize) / -2,
              marginTop: (Dimensions.get('window').height - qrSize) / -2,
            },
          ]}
        >
          <View style={styles.border} />
        </View>

        {scanned && (
          <TouchableOpacity style={styles.button} onPress={() => setScanned(false)}>
            <Text style={styles.buttonText}>Scan Again</Text>
          </TouchableOpacity>
        )}
      </Camera>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  message: {
    color: '#fff',
    fontSize: 16,
  },
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  border: {
    flex: 1,
    borderColor: '#1E90FF',
    borderWidth: 2,
    borderRadius: 10,
  },
  button: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    backgroundColor: '#1E90FF',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
  },
});
