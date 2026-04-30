import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import { Colors, Radius, sf } from '../../constants/uiTheme';

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
      presentationStyle="overFullScreen"
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable
          style={styles.backdropPressable}
          onPress={handleBackdrop}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <View style={styles.card} accessibilityViewIsModal>
          {phase === 'confirm' && (
            <>
              {!!title && <Text style={styles.title}>{title}</Text>}
              {!!message && <Text style={styles.body}>{message}</Text>}
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnGhost, styles.btnGhostSpaced]}
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
                style={[styles.btn, styles.btnResultDismiss, styles.btnResultOk]}
                onPress={handleDismissResult}
                accessibilityRole="button"
              >
                <Text style={styles.btnResultDismissText}>OK</Text>
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
  /** Sit behind the card so taps hit dialog actions on web (stacking order). */
  backdropPressable: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  card: {
    position: 'relative',
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: 24,
    width: '100%',
    maxWidth: 420,
    borderWidth: Platform.OS === 'web' ? 2 : 0,
    borderColor: Colors.line,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 24,
    zIndex: 10,
  },
  title: {
    fontSize: sf(20),
    fontWeight: '900',
    color: Colors.primary,
    marginBottom: 12,
  },
  titleError: { color: Colors.dangerFg },
  body: {
    fontSize: sf(15),
    color: Colors.sub,
    lineHeight: 22,
    marginBottom: 20,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  btnGhostSpaced: {
    marginRight: 12,
  },
  btnResultOk: {
    alignSelf: 'stretch',
    marginTop: 4,
  },
  /** Result "OK" — outlined + dark text so label stays visible when web omits TouchableOpacity fill. */
  btnResultDismiss: {
    backgroundColor: Colors.chip,
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  btnResultDismissText: {
    fontSize: sf(15),
    fontWeight: '800',
    color: Colors.text,
  },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: Radius.md,
    minWidth: 100,
    alignItems: 'center',
  },
  btnGhost: {
    backgroundColor: Colors.chip,
    borderWidth: 2,
    borderColor: Colors.line,
  },
  btnGhostText: { fontSize: sf(15), fontWeight: '800', color: Colors.text },
  /** Outlined primary — on web, filled TouchableOpacity can render without fill so white label was invisible. */
  btnPrimary: {
    backgroundColor: Colors.chip,
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  btnPrimaryText: { fontSize: sf(15), fontWeight: '800', color: Colors.primary },
  /** Outlined danger so label stays readable on web (solid red + white text was rendering as white-on-white for some users). */
  btnDanger: {
    backgroundColor: Colors.card,
    borderWidth: 2,
    borderColor: Colors.dangerFg,
  },
  btnDangerText: { fontSize: sf(15), fontWeight: '800', color: Colors.text },
  loadingWrap: {
    alignItems: 'center',
    paddingVertical: 16,
    gap: 16,
  },
});
