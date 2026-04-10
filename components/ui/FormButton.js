import React from 'react';
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  View,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors } from '../../constants/uiTheme';

/**
 * Unified form-level button — replaces the scattered `TouchableOpacity + s.btn/s.submit`
 * pattern used in asset/new.js, type/new.js, type/edit.js, and similar screens.
 *
 * Variants:
 *   primary   – filled brand blue  (default submit / confirm)
 *   ghost     – light gray fill    (cancel / neutral)
 *   danger    – filled red         (destructive actions)
 *   outline   – bordered, no fill  (secondary with visible border)
 *
 * Props:
 *   label        – button text (required)
 *   onPress      – press handler
 *   variant      – 'primary' | 'ghost' | 'danger' | 'outline' (default 'primary')
 *   loading      – shows spinner and disables press
 *   disabled     – dims and disables press
 *   icon         – optional MaterialIcons name shown before label
 *   iconRight    – show icon after label instead of before
 *   style        – outer TouchableOpacity style override
 *   textStyle    – label Text style override
 *   fullWidth    – stretch to full container width (default false)
 */
export default function FormButton({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon,
  iconRight = false,
  style,
  textStyle,
  fullWidth = false,
}) {
  const vs = VARIANT_STYLES[variant] || VARIANT_STYLES.primary;
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      activeOpacity={0.8}
      style={[
        styles.base,
        vs.btn,
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        Platform.OS === 'web' && isDisabled ? styles.disabledWeb : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={vs.spinnerColor} size="small" />
      ) : (
        <View style={styles.inner}>
          {icon && !iconRight && (
            <MaterialIcons name={icon} size={18} color={vs.textColor} style={styles.iconLeft} />
          )}
          <Text style={[styles.label, { color: vs.textColor }, textStyle]}>{label}</Text>
          {icon && iconRight && (
            <MaterialIcons name={icon} size={18} color={vs.textColor} style={styles.iconRight} />
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

const VARIANT_STYLES = {
  primary: {
    btn: { backgroundColor: Colors.primary },
    textColor: '#FFFFFF',
    spinnerColor: '#FFFFFF',
  },
  ghost: {
    btn: { backgroundColor: '#EEEEEE' },
    textColor: Colors.text,
    spinnerColor: Colors.primary,
  },
  danger: {
    btn: { backgroundColor: '#EF4444' },
    textColor: '#FFFFFF',
    spinnerColor: '#FFFFFF',
  },
  outline: {
    btn: {
      backgroundColor: '#FFFFFF',
      borderWidth: 2,
      borderColor: Colors.primary,
    },
    textColor: Colors.primary,
    spinnerColor: Colors.primary,
  },
};

const styles = StyleSheet.create({
  base: {
    padding: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    marginVertical: 8,
    minHeight: 50,
  },
  fullWidth: { alignSelf: 'stretch' },
  disabled: { opacity: 0.65 },
  disabledWeb: { cursor: 'not-allowed' },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 15,
    fontWeight: '700',
  },
  iconLeft: { marginRight: 8 },
  iconRight: { marginLeft: 8 },
});
