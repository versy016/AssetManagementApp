import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  Alert,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getAuth } from 'firebase/auth';

import ScreenHeader from '../../components/ui/ScreenHeader';
import { API_BASE_URL } from '../../inventory-api/apiBase';

const Colors = {
  bg: '#FFFFFF',
  border: '#E2E8F0',
  text: '#0F172A',
  subtle: '#64748B',
  primary: '#0D9488',
};

export default function QuickNoteScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();

  const assetId = params?.assetId ? String(params.assetId) : null;
  const returnTo = params?.returnTo ? String(params.returnTo) : null;

  const [asset, setAsset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const backToTarget = useCallback(() => {
    if (returnTo) {
      router.replace(returnTo);
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/dashboard');
    }
  }, [returnTo, router]);

  useEffect(() => {
    let ignore = false;
    if (!assetId) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE_URL}/assets/${assetId}`);
        if (!res.ok) throw new Error('Unable to load asset');
        const data = await res.json();
        if (!ignore) setAsset(data);
      } catch (error) {
        if (!ignore) {
          Alert.alert('Error', error?.message || 'Failed to load asset', [
            { text: 'OK', onPress: () => backToTarget() },
          ]);
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [assetId, backToTarget]);

  const handleSubmit = async () => {
    const trimmed = (note || '').trim();
    if (!trimmed) {
      Alert.alert('Note required', 'Please enter a note.');
      return;
    }
    if (!asset?.id) return;

    setSubmitting(true);
    try {
      const auth = getAuth();
      const currentUser = auth?.currentUser;
      const headers = { 'Content-Type': 'application/json' };
      if (currentUser?.uid) headers['X-User-Id'] = currentUser.uid;
      if (currentUser?.displayName) headers['X-User-Name'] = currentUser.displayName;
      if (currentUser?.email) headers['X-User-Email'] = currentUser.email;
      try {
        if (currentUser && typeof currentUser.getIdToken === 'function') {
          const token = await currentUser.getIdToken();
          if (token) headers.Authorization = `Bearer ${token}`;
        }
      } catch (e) {
        console.warn('Token error:', e);
      }

      const res = await fetch(`${API_BASE_URL}/assets/${encodeURIComponent(asset.id)}/actions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'STATUS_CHANGE',
          note: trimmed,
          data: { user_note_text: trimmed },
        }),
      });

      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || 'Failed to save note');
      }

      setNote('');
      Alert.alert('Note saved', 'Your note has been added to this asset.', [
        { text: 'Done', onPress: () => backToTarget() },
        {
          text: 'View asset',
          onPress: () =>
            router.replace({ pathname: '/asset/[assetId]', params: { assetId } }),
        },
      ]);
    } catch (e) {
      console.error('QuickNote submit error', e);
      Alert.alert('Error', e.message || 'Failed to save note');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Quick Note" backLabel="Back" onBack={backToTarget} />
      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>Loading asset…</Text>
          </View>
        ) : !asset ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>Asset not found.</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.assetCard}>
              <Text style={styles.assetTitle}>
                {asset?.asset_types?.name || asset?.name || 'Asset'}
              </Text>
              <Text style={styles.assetMeta}>Asset ID: {asset?.id}</Text>
              <Text style={styles.assetMeta}>
                {asset?.model || asset?.description || 'No description'}
              </Text>
            </View>
            <Text style={styles.label}>Add a note</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your note…"
              placeholderTextColor={Colors.subtle}
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={4}
            />
            <TouchableOpacity
              style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={submitting || !note.trim()}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.submitBtnText}>Save note</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: Colors.subtle,
  },
  errorText: {
    color: Colors.subtle,
  },
  assetCard: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 16,
    backgroundColor: '#F0FDFA',
    gap: 4,
    marginBottom: 20,
  },
  assetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.text,
  },
  assetMeta: {
    fontSize: 14,
    color: Colors.subtle,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: Colors.text,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  submitBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
