import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Colors } from '../../constants/uiTheme';

/**
 * Three-phase confirm/loading/result modal.
 *
 * Usage:
 *   const [ui, setUi] = useState(null);
 *
 *   // Open confirm phase:
 *   setUi({ phase: 'confirm' });
 *
 *   // In confirm handler run async op:
 *   setUi({ phase: 'loading' });
 *   try {
 *     await doWork();
 *     setUi({ phase: 'result', title: 'Done', message: 'Success.' });
 *   } catch (e) {
 *     setUi({ phase: 'result', title: 'Error', message: e.message, error: true });
 *   }
 *
 * Props:
 *  visible        – boolean (show the modal)
 *  phase          – 'confirm' | 'loading' | 'result'
 *  title          – heading for confirm and result phases
 *  message        – body text for all phases
 *  loadingMessage – text shown during loading (default 'Please wait…')
 *  confirmLabel   – primary confirm button label (default 'Confirm')
 *  confirmTone    – 'danger' | 'primary' (default 'primary')
 *  cancelLabel    – cancel button label (default 'Cancel')
 *  resultError    – if true, title is rendered in danger colour on result phase
 *  onConfirm      – called when user confirms
 *  onCancel       – called when user cancels (confirm phase) or dismisses backdrop
 *  onDismiss      – called when user taps OK on result phase (defaults to onCancel)
 */
export default function ConfirmModal({
  visible,
  phase = 'confirm',
  title,
  message,
  loadingMessage = 'Please wait…',
  confirmLabel = 'Confirm',
  confirmTone = 'primary',
  cancelLabel = 'Cancel',
  resultError = false,
  onConfirm,
  onCancel,
  onDismiss,
}) {
  const dismissable = phase !== 'loading';
  const handleBackdrop = () => { if (dismissable && onCancel) onCancel(); };
  const handleDismissResult = () => (onDismiss || onCancel)?.();

  const confirmBtnStyle =
    confirmTone === 'danger' ? styles.btnDanger : styles.btnPrimary;
  const confirmTextStyle =
    confirmTone === 'danger' ? styles.btnDangerText : styles.btnPrimaryText;

  return (
    <Modal
      visible={!!visible}
      transparent
      animationType="fade"
      onRequestClose={handleBackdrop}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={handleBackdrop}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <View style={styles.card}>
          {phase === 'confirm' && (
            <>
              {!!title && <Text style={styles.title}>{title}</Text>}
              {!!message && <Text style={styles.body}>{message}</Text>}
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnGhost]}
                  onPress={onCancel}
                  accessibilityRole="button"
                >
                  <Text style={styles.btnGhostText}>{cancelLabel}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, confirmBtnStyle]}
                  onPress={onConfirm}
                  accessibilityRole="button"
                >
                  <Text style={confirmTextStyle}>{confirmLabel}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {phase === 'loading' && (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={styles.body}>{loadingMessage}</Text>
            </View>
          )}

          {phase === 'result' && (
            <>
              {!!title && (
                <Text style={[styles.title, resultError && styles.titleError]}>
                  {title}
                </Text>
              )}
              {!!message && <Text style={styles.body}>{message}</Text>}
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, { alignSelf: 'stretch' }]}
                onPress={handleDismissResult}
                accessibilityRole="button"
              >
                <Text style={styles.btnPrimaryText}>OK</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    position: 'relative',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 420,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
    zIndex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1E293B',
    marginBottom: 12,
  },
  titleError: { color: '#B91C1C' },
  body: {
    fontSize: 15,
    color: '#475569',
    lineHeight: 22,
    marginBottom: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
  },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    minWidth: 100,
    alignItems: 'center',
  },
  btnGhost: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  btnGhostText: { fontSize: 15, fontWeight: '700', color: '#475569' },
  btnPrimary: { backgroundColor: Colors.primary },
  btnPrimaryText: { fontSize: 15, fontWeight: '700', color: '#FFF' },
  btnDanger: { backgroundColor: '#EF4444' },
  btnDangerText: { fontSize: 15, fontWeight: '700', color: '#FFF' },
  loadingWrap: {
    alignItems: 'center',
    paddingVertical: 16,
    gap: 16,
  },
});
