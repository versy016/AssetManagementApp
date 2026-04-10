import React from 'react';
import { View, StyleSheet } from 'react-native';
import FormButton from './FormButton';

/**
 * Pre-wired Cancel + Confirm button row for forms.
 * Renders two `FormButton`s side by side with consistent spacing.
 *
 * Props:
 *   onConfirm      – confirm/submit press handler (required)
 *   onCancel       – cancel press handler (optional; omit to hide cancel button)
 *   confirmLabel   – label for the confirm button (default 'Save')
 *   cancelLabel    – label for the cancel button (default 'Cancel')
 *   confirmVariant – FormButton variant for confirm (default 'primary')
 *   loading        – shows spinner on confirm button and disables both
 *   disabled       – disables both buttons without showing spinner
 *   style          – additional View style for the row container
 *
 * Usage:
 *   <FormActions
 *     onConfirm={handleSubmit}
 *     onCancel={() => router.back()}
 *     confirmLabel="Create Asset Type"
 *     loading={submitting}
 *   />
 */
export default function FormActions({
  onConfirm,
  onCancel,
  confirmLabel = 'Save',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  loading = false,
  disabled = false,
  style,
}) {
  return (
    <View style={[styles.row, style]}>
      {onCancel && (
        <FormButton
          label={cancelLabel}
          onPress={onCancel}
          variant="ghost"
          disabled={loading || disabled}
          style={styles.flex}
        />
      )}
      <FormButton
        label={confirmLabel}
        onPress={onConfirm}
        variant={confirmVariant}
        loading={loading}
        disabled={disabled}
        style={styles.flex}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  flex: { flex: 1, marginVertical: 0 },
});
