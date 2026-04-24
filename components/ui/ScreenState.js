// components/ui/ScreenState.js
// Unified loading / error / empty state display.
//
// Usage:
//   // As a conditional wrapper (renders children when none of the states are active)
//   <ScreenState loading={loading} error={error} onRetry={load}>
//     <YourContent />
//   </ScreenState>
//
//   // Empty state only (no children needed)
//   <ScreenState empty title="No assets" subtitle="Tap + to add your first asset" icon="inventory" />
//
//   // Loading spinner only
//   <ScreenState loading label="Loading assets…" />
//
//   // Error state
//   <ScreenState error="Failed to load. Check your connection." onRetry={load} />

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, FontWeights, sf } from '../../constants/uiTheme';
import LoadingSpinner from './LoadingSpinner';
import EmptyState from './EmptyState';

/**
 * ScreenState — renders one of three states, or children.
 *
 * Props (all optional):
 *  loading    – bool   — show spinner
 *  label      – string — label shown beneath loading spinner
 *  error      – string | Error — show error banner with optional retry
 *  onRetry    – fn    — if provided, "Retry" button appears with error
 *  empty      – bool  — show empty state (ignored when loading=true)
 *  icon       – MaterialIcons name for empty state (default 'folder-open')
 *  title      – string — empty state title
 *  subtitle   – string — empty state subtitle
 *  hint       – string — empty state hint line
 *  style      – additional container style
 *  flex       – bool  — container fills available space (default true)
 *  children   – rendered when none of the states match
 */
export default function ScreenState({
  loading = false,
  label,
  error,
  onRetry,
  empty = false,
  icon = 'folder-open',
  title,
  subtitle,
  hint,
  style,
  flex = true,
  children,
}) {
  if (loading) {
    return (
      <LoadingSpinner
        label={label}
        flex={flex}
        style={style}
      />
    );
  }

  if (error) {
    const message = typeof error === 'string' ? error : (error?.message || 'An unexpected error occurred.');
    return (
      <View style={[styles.errorContainer, flex && styles.flex, style]}>
        <View style={styles.errorIconWrap}>
          <MaterialIcons name="error-outline" size={28} color={Colors.dangerFg} />
        </View>
        <Text style={styles.errorTitle}>Something went wrong</Text>
        <Text style={styles.errorMessage}>{message}</Text>
        {!!onRetry && (
          <TouchableOpacity style={styles.retryBtn} onPress={onRetry} activeOpacity={0.75}>
            <MaterialIcons name="refresh" size={15} color="#fff" />
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  if (empty) {
    return (
      <View style={[flex && styles.flex, style]}>
        <EmptyState
          icon={icon}
          title={title}
          subtitle={subtitle}
          hint={hint}
        />
      </View>
    );
  }

  // All states clear — render children
  return children ?? null;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  errorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
    gap: 10,
  },
  errorIconWrap: {
    width: 56,
    height: 56,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.line,
    backgroundColor: Colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  errorTitle: {
    fontSize: sf(16),
    fontWeight: FontWeights.bold,
    color: Colors.text,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  errorMessage: {
    fontSize: sf(13),
    color: Colors.sub,
    textAlign: 'center',
    lineHeight: 19,
    marginHorizontal: 8,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: Radius.md,
    backgroundColor: Colors.accent,
  },
  retryText: {
    color: '#fff',
    fontWeight: FontWeights.bold,
    fontSize: sf(14),
  },
});
