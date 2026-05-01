// components/asset/AssetActionBar.js
import { View, TouchableOpacity, Text, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, sf } from '../../constants/uiTheme';
import { normalizeStatus } from '../ui/StatusBadge';
import { isAssetIdAwaitingQr } from '../../utils/assetId';

export default function AssetActionBar({ asset, isAdmin, normalizedReturnTo, onDelete }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWebWide = Platform.OS === 'web' && (width || 0) >= 960;

  if (!asset) return null;

  const awaitingPhysicalQr = isAssetIdAwaitingQr(asset?.id);
  const isQRReserved = String(asset?.description || '').trim().toLowerCase() === 'qr reserved asset';
  const status = normalizeStatus(asset?.status);

  // On web-wide screens, buttons are constrained to match the page content width.
  // The outer bar still spans edge-to-edge for the border/background fill.
  const innerStyle = isWebWide ? styles.btnInnerWeb : styles.btnInner;

  if (awaitingPhysicalQr) {
    return (
      <View style={[styles.actionsRow, Platform.OS === 'web' && styles.actionsRowSticky]}>
        <View style={innerStyle}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnPrimary]}
            onPress={() =>
              router.push({
                pathname: '/check-in/[id]',
                params: {
                  id: String(asset.id),
                  ...(normalizedReturnTo ? { returnTo: normalizedReturnTo } : {}),
                },
              })
            }
          >
            <MaterialIcons name="qr-code-2" size={18} color="#fff" />
            <Text style={styles.actionText}>Assign QR</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnSecondary]}
            onPress={() => router.replace('/(tabs)/dashboard')}
          >
            <MaterialIcons name="home" size={18} color="#fff" />
            <Text style={styles.actionText}>Dashboard</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnSecondary]}
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
        </View>
      </View>
    );
  }

  if (isQRReserved) {
    return (
      <View style={[styles.actionsRow, Platform.OS === 'web' && styles.actionsRowSticky]}>
        <View style={innerStyle}>
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
      </View>
    );
  }

  return (
    <View style={[styles.actionsRow, Platform.OS === 'web' && styles.actionsRowSticky]}>
      <View style={innerStyle}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  actionsRow: {
    padding: 16,
    borderTopColor: Colors.line,
    borderTopWidth: 2,
    backgroundColor: Colors.bg,
  },
  // Mobile: buttons fill the row
  btnInner: {
    flexDirection: 'row',
    gap: 8,
  },
  // Web: constrain to content max-width, centered
  btnInnerWeb: {
    flexDirection: 'row',
    gap: 8,
    maxWidth: 1280,
    width: '100%',
    alignSelf: 'center',
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
