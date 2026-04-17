import React, { useRef, useEffect, useState } from 'react';
import { TouchableOpacity, View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius } from '../../constants/uiTheme';

/**
 * Small colored icon button for table/list row actions.
 *
 * Built-in tones: edit, delete, view, download, copy, send, open, primary
 *
 * Props:
 *   icon               – MaterialIcons icon name (required)
 *   tone               – colour preset key (default 'primary')
 *   onPress            – press handler
 *   disabled           – disables press + dims button
 *   loading            – shows spinner instead of icon
 *   size               – icon size (default 18)
 *   buttonSize         – outer square size (default 32)
 *   borderRadius       – border radius (default 6)
 *   accessibilityLabel – screen-reader label
 *   tooltip            – hover tooltip label (web only)
 *   style              – extra style on wrapper
 */

const TONES = {
  edit:     Colors.accent,
  delete:   Colors.dangerFg,
  view:     '#8B5CF6',
  download: '#3B82F6',
  copy:     '#10B981',
  send:     '#0EA5E9',
  open:     '#0369A1',
  primary:  Colors.primary,
};

/**
 * Web-only tooltip.
 *
 * The tooltip <div> is appended directly to document.body so it lives
 * completely outside the table's DOM tree. This means no parent stacking
 * context (table header, scroll container, etc.) can ever hide it.
 * position:fixed + z-index 999999 guarantees it floats above everything.
 */
function WebTooltip({ label, children }) {
  const wrapRef = useRef(null);
  const tipRef  = useRef(null);

  // Create the tooltip element once and mount it on document.body.
  useEffect(() => {
    const el = document.createElement('div');
    el.textContent = label;
    el.style.cssText = [
      'position:fixed',
      'display:none',
      `background:${Colors.primary}`,
      'color:#fff',
      'padding:4px 10px',
      `border-radius:${Radius.sm}px`,
      'font-size:11px',
      'font-weight:800',
      'line-height:1.5',
      'white-space:nowrap',
      'pointer-events:none',
      'z-index:999999',
      'box-shadow:0 2px 8px rgba(0,0,0,0.25)',
      'transform:translateX(-50%)',
    ].join(';');
    document.body.appendChild(el);
    tipRef.current = el;
    return () => { if (el.parentNode) el.parentNode.removeChild(el); };
  }, []);

  // Keep label in sync if it changes.
  useEffect(() => {
    if (tipRef.current) tipRef.current.textContent = label;
  }, [label]);

  function show() {
    if (!wrapRef.current || !tipRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    const tip = tipRef.current;
    tip.style.left    = `${Math.round(r.left + r.width / 2)}px`;
    tip.style.top     = `${Math.round(r.top - 38)}px`;
    tip.style.display = 'block';
  }

  function hide() {
    if (tipRef.current) tipRef.current.style.display = 'none';
  }

  return React.createElement('div', {
    ref:          wrapRef,
    onMouseEnter: show,
    onMouseLeave: hide,
    style:        { display: 'inline-flex' },
  }, children);
}

export default function TableIconButton({
  icon,
  tone = 'primary',
  onPress,
  disabled = false,
  loading = false,
  size = 18,
  buttonSize = 32,
  borderRadius = 6,
  accessibilityLabel,
  tooltip,
  style,
}) {
  const bg       = TONES[tone] || tone;
  const tipLabel = tooltip || accessibilityLabel;

  const button = (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[{ opacity: disabled || loading ? 0.5 : 1 }, style]}
      activeOpacity={0.75}
    >
      <View
        style={[
          styles.box,
          { width: buttonSize, height: buttonSize, borderRadius, backgroundColor: bg },
        ]}
      >
        {loading
          ? <ActivityIndicator size="small" color="#fff" />
          : <MaterialIcons name={icon} size={size} color="#fff" />}
      </View>
    </TouchableOpacity>
  );

  if (Platform.OS === 'web' && tipLabel) {
    return <WebTooltip label={tipLabel}>{button}</WebTooltip>;
  }
  return button;
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
});
