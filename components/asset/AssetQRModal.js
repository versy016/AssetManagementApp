// components/asset/AssetQRModal.js
import { Modal, Pressable, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Colors, Radius } from '../../constants/uiTheme';

export default function AssetQRModal({ visible, onClose, qrValue, assetId }) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
      />
      <View style={styles.container}>
        <View style={styles.card}>
          <QRCode value={qrValue} size={260} ecl="M" />
          <Text style={styles.assetId}>{assetId}</Text>
          <Text style={styles.instruction}>
            Scan this QR to open the asset and transfer to office, transfer out of office, or other actions.
          </Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.closeButton}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: Colors.card,
    padding: 18,
    borderRadius: Radius.lg,
    alignItems: 'center',
    width: 340,
    maxWidth: '90%',
  },
  assetId: {
    marginTop: 12,
    fontWeight: '700',
    color: Colors.text,
  },
  instruction: {
    marginTop: 8,
    color: Colors.sub,
    textAlign: 'center',
  },
  closeButton: {
    marginTop: 12,
    color: Colors.accent,
    fontWeight: '800',
  },
});
