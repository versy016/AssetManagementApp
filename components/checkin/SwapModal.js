// components/checkin/SwapModal.js
// Bottom-sheet modal for swapping a QR code to an existing asset.
// Supports three methods: Asset ID, QR scanner, and lookup by details.

import React from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Modal,
  Platform, ScrollView, KeyboardAvoidingView, StyleSheet,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, sf } from '../../constants/uiTheme';
import { sharedStyles } from './shared';
import { useRouter } from 'expo-router';
import { showError, showSuccess, confirm } from '../../utils/showError';

export default function SwapModal({
  visible,
  onClose,
  asset,
  returnTo,
  loading,
  setLoading,
  performSwap,

  // ID input
  swapIdInput,
  setSwapIdInput,

  // Lookup
  lookup,
  setLookup,
  lookupResults,
  lookupSelected,
  setLookupSelected,
  lookupFocus,
  setLookupFocus,
  scrollToLookupField,

  // Refs
  swapScrollRef,
  lookupSectionYRef,
  modelYRef,
  typeYRef,
  assignedYRef,
}) {
  const router = useRouter();

  const navigateAfterSwap = () => {
    if (returnTo) { try { router.replace(String(returnTo)); } catch { router.back(); } }
    else { router.replace(`/check-in/${asset?.id}`); }
  };

  const handleSwapById = async () => {
    try {
      const idTrim = swapIdInput.trim();
      if (!/^[A-Z0-9]{8}$/.test(idTrim)) throw new Error('Asset ID must be 8 characters (A–Z, 0–9).');
      const ok = await confirm('Confirm Swap', `Swap assets between ${idTrim} and ${asset?.id}?`, 'Confirm', 'Cancel', true);
      if (!ok) return;
      setLoading(true);
      await performSwap(idTrim, asset?.id);
      onClose();
      navigateAfterSwap();
      showSuccess('QR swapped successfully.');
    } catch (e) {
      showError(e, 'Failed to swap');
    } finally {
      setLoading(false);
    }
  };

  const handleSwapSelected = async () => {
    try {
      const ok = await confirm('Confirm Swap', `Swap QR from ${lookupSelected.id} to ${asset?.id}?`, 'Confirm', 'Cancel', true);
      if (!ok) return;
      setLoading(true);
      await performSwap(lookupSelected.id, asset?.id);
      onClose();
      navigateAfterSwap();
      showSuccess('QR swapped successfully.');
    } catch (e) {
      showError(e, 'Swap failed');
    } finally {
      setLoading(false);
    }
  };

  const renderLookupSuggestions = () => (
    <View style={{ marginTop: 12 }}>
      <Text style={sharedStyles.fieldLabel}>Select a match to swap</Text>
      <ScrollView style={{ maxHeight: 260 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
        {lookupResults.map((it) => (
          <TouchableOpacity
            key={it.id}
            style={{
              paddingVertical: 10,
              borderBottomWidth: 1,
              borderBottomColor: Colors.line,
              backgroundColor: lookupSelected?.id === it.id ? Colors.accentLight : 'transparent',
            }}
            onPress={() => setLookupSelected(it)}
          >
            <Text style={{ fontWeight: '700', color: Colors.text }}>{it.id}</Text>
            <Text style={{ color: Colors.sub }}>
              {(it.asset_types?.name || 'Type?')} · {(it.model || 'Model?')} · {(it.users?.name || it.users?.useremail || 'Unassigned')}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {lookupSelected && (
        <View style={[sharedStyles.btnRow, { marginTop: 12 }]}>
          <TouchableOpacity style={sharedStyles.btnPrimary} onPress={handleSwapSelected}>
            <MaterialIcons name="swap-horiz" size={18} color="#fff" />
            <Text style={sharedStyles.btnPrimaryText}>Swap Selected</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={sharedStyles.sheetBackdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}
          style={{ width: '100%' }}
        >
          <View style={[sharedStyles.sheet, { maxHeight: '85%' }]}>
            <View style={sharedStyles.modalHeader}>
              <Text style={sharedStyles.modalTitle}>Swap QR to Existing Asset</Text>
              <TouchableOpacity onPress={onClose}>
                <MaterialIcons name="close" size={20} color={Colors.subtle} />
              </TouchableOpacity>
            </View>

            <ScrollView
              ref={swapScrollRef}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 240, gap: 14 }}
            >
              {/* ── Option 1: Asset ID ── */}
              <View style={sharedStyles.optionCard}>
                <View style={sharedStyles.optionHeaderRow}>
                  <MaterialIcons name="tag" size={18} color={Colors.blue} />
                  <Text style={sharedStyles.optionTitle}>Find by Asset ID</Text>
                </View>
                <Text style={sharedStyles.optionDesc}>
                  Enter the existing Asset ID (QR code or UUID) and we will move that asset onto this QR.
                </Text>
                <Text style={sharedStyles.fieldLabel}>Asset ID</Text>
                <TextInput
                  placeholder="e.g. ABCD1234"
                  value={swapIdInput}
                  onChangeText={(t) => setSwapIdInput((t || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
                  style={sharedStyles.input}
                  placeholderTextColor={Colors.subtle}
                  autoCapitalize="characters"
                  maxLength={8}
                />
                <Text style={sharedStyles.fieldHint}>
                  Tip: You can paste the ID from the asset page or scan its QR and copy.
                </Text>
                <View style={sharedStyles.btnRow}>
                  <TouchableOpacity
                    style={[sharedStyles.btnPrimary, { opacity: swapIdInput.trim() ? 1 : 0.6 }]}
                    disabled={!swapIdInput.trim() || loading}
                    onPress={handleSwapById}
                  >
                    <MaterialIcons name="swap-horiz" size={18} color="#fff" />
                    <Text style={sharedStyles.btnPrimaryText}>Swap Now</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* ── Option 2: Scan QR ── */}
              <View style={sharedStyles.optionCard}>
                <View style={sharedStyles.optionHeaderRow}>
                  <MaterialIcons name="qr-code-scanner" size={18} color={Colors.blue} />
                  <Text style={sharedStyles.optionTitle}>Scan QR</Text>
                </View>
                <Text style={sharedStyles.optionDesc}>
                  Scan the QR of an existing asset and we will move it onto this QR.
                </Text>
                <View style={sharedStyles.btnRow}>
                  <TouchableOpacity
                    style={sharedStyles.btnGhost}
                    onPress={() => router.push({
                      pathname: '/qr-scanner',
                      params: { intent: 'swap-target', placeholderId: asset?.id, returnTo: returnTo || '' },
                    })}
                  >
                    <MaterialIcons name="qr-code" size={18} color={Colors.blue} />
                    <Text style={sharedStyles.btnGhostText}>Open Scanner</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* ── Option 3: Lookup by details ── */}
              <View
                style={sharedStyles.optionCard}
                onLayout={(e) => { lookupSectionYRef.current = e.nativeEvent.layout.y; }}
              >
                <View style={sharedStyles.optionHeaderRow}>
                  <MaterialIcons name="search" size={18} color={Colors.blue} />
                  <Text style={sharedStyles.optionTitle}>Lookup by Details</Text>
                </View>
                <Text style={sharedStyles.optionDesc}>
                  Use any combination. We'll use the first close match (top 10).
                </Text>

                {[
                  { key: 'model',    label: 'Model',                placeholder: 'e.g. DJI Mavic 3',           ref: modelYRef    },
                  { key: 'type',     label: 'Type',                 placeholder: 'e.g. Drone',                  ref: typeYRef     },
                  { key: 'assigned', label: 'Assigned (email or name)', placeholder: 'e.g. alex@company.com', ref: assignedYRef },
                ].map(({ key, label, placeholder, ref }) => (
                  <View key={key}>
                    <Text style={sharedStyles.fieldLabel}>{label}</Text>
                    <View onLayout={(e) => { ref.current = e.nativeEvent.layout.y; }}>
                      <TextInput
                        placeholder={placeholder}
                        value={lookup[key]}
                        onFocus={() => { setLookupFocus(key); scrollToLookupField(key); }}
                        onChangeText={(t) => setLookup((prev) => ({ ...prev, [key]: t }))}
                        style={sharedStyles.input}
                        placeholderTextColor={Colors.subtle}
                      />
                    </View>
                    {lookupResults.length > 0 && lookupFocus === key && renderLookupSuggestions()}
                  </View>
                ))}

                <Text style={sharedStyles.fieldHint}>
                  Example: Model "ThinkPad", Type "Laptop", Assigned "sam@company.com".
                </Text>
              </View>

              <View style={{ height: 8 }} />
              <TouchableOpacity style={[sharedStyles.btnGhost, { alignSelf: 'center' }]} onPress={onClose}>
                <MaterialIcons name="close" size={18} color={Colors.slate} />
                <Text style={sharedStyles.btnGhostText}>Close</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
