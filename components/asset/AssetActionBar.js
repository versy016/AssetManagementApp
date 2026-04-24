// components/asset/AssetActionBar.js
import { View, TouchableOpacity, Text, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, sf } from '../../constants/uiTheme';
import { normalizeStatus } from '../ui/StatusBadge';

export default function AssetActionBar({ asset, isAdmin, normalizedReturnTo, onDelete }) {
  const router = useRouter();

  if (!asset) return null;

  const isQRReserved = String(asset?.description || '').trim().toLowerCase() === 'qr reserved asset';
  const status = normalizeStatus(asset?.status);

  if (isQRReserved) {
    return (
      <View style={[styles.actionsRow, Platform.OS === 'web' && styles.actionsRowSticky]}>
        {status === 'available' ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnSecondary]}
            onPress={() =>
              router.push({ pathname: '/qr-scanner', params: { intent: 'check-out', assetId: asset.id } })
            }
          >
            <MaterialIcons name="swap-horiz" size={18} color="#fff" />
            <Text style={styles.actionText}>Transfer to me</Text>
          </TouchableOpacity>
        ) : status === 'rented' ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnPrimary]}
            onPress={() => router.push(`/check-in/${asset.id}`)}
          >
            <MaterialIcons name="swap-horiz" size={18} color="#fff" />
            <Text style={styles.actionText}>Transfer to office</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.actionsRow, Platform.OS === 'web' && styles.actionsRowSticky]}>
      {status === 'available' ? (
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnSecondary]}
          onPress={() =>
            router.push({ pathname: '/qr-scanner', params: { intent: 'check-out', assetId: asset.id } })
          }
        >
          <MaterialIcons name="swap-horiz" size={18} color="#fff" />
          <Text style={styles.actionText}>Transfer to me</Text>
        </TouchableOpacity>
      ) : status === 'rented' ? (
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnPrimary]}
          onPress={() => router.push(`/check-in/${asset.id}`)}
        >
          <MaterialIcons name="swap-horiz" size={18} color="#fff" />
          <Text style={styles.actionText}>Transfer to office</Text>
        </TouchableOpacity>
      ) : isAdmin ? (
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnSecondary]}
          onPress={() => {
            router.push({
              pathname: '/asset/new',
              params: { fromAssetId: asset.id },
            });
          }}
        >
          <MaterialIcons name="content-copy" size={18} color="#fff" />
          <Text style={styles.actionText}>Copy</Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity
        style={[styles.actionBtn, styles.actionBtnPrimary]}
        onPress={() =>
          router.push({
            pathname: '/asset/edit',
            params: {
              assetId: asset.id,
              returnTo: `/asset/${asset.id}${normalizedReturnTo ? `?returnTo=${encodeURIComponent(normalizedReturnTo)}` : ''}`,
            },
          })
        }
      >
        <MaterialIcons name="edit" size={18} color="#fff" />
        <Text style={styles.actionText}>Edit</Text>
      </TouchableOpacity>

      {isAdmin && (
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnDanger]}
          onPress={onDelete}
        >
          <MaterialIcons name="delete-outline" size={18} color="#fff" />
          <Text style={styles.actionText}>Delete</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    borderTopColor: Colors.line,
    borderTopWidth: 2,
    backgroundColor: Colors.bg,
  },
  actionsRowSticky: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  actionBtn: {
    flex: 1,
    minHeight: 50,
    minWidth: 100,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    ...Platform.select({
      ios: { shadowColor: Colors.text, shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 3, height: 3 } },
      android: { elevation: 3 },
      default: {},
    }),
  },
  actionBtnPrimary: { backgroundColor: Colors.accent },
  actionBtnSecondary: { backgroundColor: Colors.primary },
  actionBtnDanger: { backgroundColor: Colors.dangerFg },
  actionText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: sf(15),
  },
});
