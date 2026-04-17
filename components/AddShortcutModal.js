// components/AddShortcutModal.js
// Modal for selecting and adding shortcuts

import React, { useMemo, useState } from 'react';
import {
    Modal,
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, Shadows } from '../constants/uiTheme';
import { getAvailableShortcutTypes, getShortcutType } from '../constants/ShortcutTypes';

const AddShortcutModal = ({
    visible,
    onClose,
    onAddShortcut,
    onRemoveShortcut,
    existingShortcuts = [],
    isAdmin = false,
}) => {
    const [showList, setShowList] = useState(false);
    const scrollRef = React.useRef(null);
    const availableTypes = useMemo(() => {
        return getAvailableShortcutTypes(isAdmin, Platform.OS === 'web');
    }, [isAdmin]);
    const regularTypes = useMemo(
        () => availableTypes.filter((t) => !t.requiresAdmin),
        [availableTypes]
    );
    const adminTypes = useMemo(
        () => availableTypes.filter((t) => t.requiresAdmin),
        [availableTypes]
    );

    const isShortcutAdded = (typeId) => {
        return existingShortcuts.some((s) => s.type === typeId);
    };

    const addedShortcutMeta = useMemo(() => {
        return existingShortcuts
            .map((shortcut) => {
                const meta = getShortcutType(shortcut.type);
                if (!meta) return null;
                return {
                    ...shortcut,
                    meta,
                };
            })
            .filter(Boolean);
    }, [existingShortcuts]);

    const handleSelectShortcut = (shortcutType) => {
        if (isShortcutAdded(shortcutType.id)) return;
        onAddShortcut(shortcutType.id);
        onClose();
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <View style={styles.container}>
                    {/* Header */}
                    <View style={styles.header}>
                        <Text style={styles.title}>Add Shortcut</Text>
                        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                            <MaterialIcons name="close" size={24} color={Colors.sub} />
                        </TouchableOpacity>
                    </View>

                    {/* Subtitle */}
                    <Text style={styles.subtitle}>
                        Select a quick action to add to your dashboard
                    </Text>

                    {/* Shortcut Grid */}
                    <ScrollView
                        ref={scrollRef}
                        style={styles.scrollView}
                        contentContainerStyle={styles.scrollContent}
                        showsVerticalScrollIndicator={false}
                    >
                        <View style={styles.grid}>
                            {regularTypes.map((shortcutType) => {
                                const added = isShortcutAdded(shortcutType.id);
                                return (
                                    <TouchableOpacity
                                        key={shortcutType.id}
                                        style={[
                                            styles.shortcutCard,
                                            styles.shortcutCardScanStyle,
                                            added && styles.shortcutCardAdded,
                                        ]}
                                        onPress={() => handleSelectShortcut(shortcutType)}
                                        disabled={added}
                                    >
                                        {/* Admin Badge */}
                                        {shortcutType.requiresAdmin && (
                                            <View style={styles.adminBadge}>
                                                <MaterialIcons name="shield" size={12} color={Colors.dangerFg} />
                                                <Text style={styles.adminBadgeText}>Admin</Text>
                                            </View>
                                        )}

                                        {/* Icon */}
                                        <View style={styles.iconContainerScan}>
                                            <MaterialIcons
                                                name={shortcutType.icon}
                                                size={28}
                                                color={Colors.accent}
                                            />
                                        </View>

                                        {/* Label */}
                                        <Text style={styles.shortcutLabelScan} numberOfLines={2}>
                                            {shortcutType.label}
                                        </Text>

                                        {/* Description */}
                                        <Text style={styles.shortcutDescription} numberOfLines={2}>
                                            {shortcutType.description}
                                        </Text>

                                        {/* Added Indicator */}
                                        {added && (
                                            <View style={styles.addedIndicator}>
                                                <MaterialIcons name="check-circle" size={20} color="#16A34A" />
                                                <Text style={styles.addedText}>Added</Text>
                                            </View>
                                        )}
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                        {adminTypes.length > 0 && (
                            <View style={styles.adminSection}>
                                <Text style={styles.sectionLabel}>Admin tools</Text>
                                <View style={styles.grid}>
                                    {adminTypes.map((shortcutType) => {
                                        const added = isShortcutAdded(shortcutType.id);
                                        return (
                                            <TouchableOpacity
                                                key={shortcutType.id}
                                                style={[
                                                    styles.shortcutCard,
                                                    styles.shortcutCardScanStyle,
                                                    added && styles.shortcutCardAdded,
                                                ]}
                                                onPress={() => handleSelectShortcut(shortcutType)}
                                                disabled={added}
                                            >
                                                <View style={styles.iconContainerScan}>
                                                    <MaterialIcons
                                                        name={shortcutType.icon}
                                                        size={28}
                                                        color="#2563EB"
                                                    />
                                                </View>
                                                <Text style={styles.shortcutLabelScan} numberOfLines={2}>
                                                    {shortcutType.label}
                                                </Text>
                                                <Text style={styles.shortcutDescription} numberOfLines={2}>
                                                    {shortcutType.description}
                                                </Text>
                                                <View style={styles.adminPill}>
                                                    <MaterialIcons name="shield" size={12} color="#B91C1C" />
                                                    <Text style={styles.adminPillText}>Admin only</Text>
                                                </View>
                                                {added && (
                                                    <View style={styles.addedIndicator}>
                                                        <MaterialIcons name="check-circle" size={20} color={Colors.successFg} />
                                                        <Text style={styles.addedText}>Added</Text>
                                                    </View>
                                                )}
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                            </View>
                        )}

                    {showList && addedShortcutMeta.length > 0 && (
                            <View style={styles.addedListSection}>
                                <Text style={styles.sectionLabel}>Your shortcuts</Text>
                                {addedShortcutMeta.map((shortcut) => (
                                    <View key={shortcut.id} style={styles.addedRow}>
                                        <View style={styles.iconSmallScan}>
                                            <MaterialIcons name={shortcut.meta.icon} size={18} color="#2563EB" />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.addedRowLabel}>{shortcut.meta.label}</Text>
                                            <Text style={styles.addedRowSub}>{shortcut.meta.description}</Text>
                                        </View>
                                        <TouchableOpacity
                                            style={styles.removeBtn}
                                            onPress={() => onRemoveShortcut(shortcut.id)}
                                        >
                                            <MaterialIcons name="delete-outline" size={18} color={Colors.dangerFg} />
                                            <Text style={styles.removeBtnText}>Remove</Text>
                                        </TouchableOpacity>
                                    </View>
                                ))}
                            </View>
                        )}
                    </ScrollView>

                    {/* Footer */}
                    <View style={styles.footer}>
                        <View style={styles.footerRow}>

                            {onRemoveShortcut && addedShortcutMeta.length > 0 && (
                            <View style={styles.manageRow}>
                                {addedShortcutMeta.length > 0 && (
                                    <TouchableOpacity
                                        style={[styles.manageListBtn, showList && styles.manageListBtnActive]}
                                        onPress={() => {
                                            setShowList((prev) => {
                                                const next = !prev;
                                                if (!prev && scrollRef.current) {
                                                    setTimeout(() => {
                                                        scrollRef.current?.scrollToEnd?.({ animated: true });
                                                    }, 50);
                                                }
                                                return next;
                                            });
                                        }}
                                    >
                                        <MaterialIcons
                                            name={showList ? 'visibility-off' : 'visibility'}
                                            size={16}
                                            color={showList ? '#fff' : Colors.accent}
                                        />
                                        <Text
                                            style={[
                                                styles.manageListBtnText,
                                                showList && { color: '#fff' },
                                            ]}
                                        >
                                            {showList ? 'Hide added shortcuts' : 'Manage added shortcuts'}
                                        </Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                            )}
                        </View>
                    </View>
                </View>
            </View>

        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    container: {
        backgroundColor: Colors.card,
        borderTopLeftRadius: Radius.lg,
        borderTopRightRadius: Radius.lg,
        maxHeight: '85%',
        ...Platform.select({
            web: {
                maxWidth: 600,
                alignSelf: 'center',
                width: '100%',
                borderRadius: Radius.lg,
                marginBottom: 20,
            },
        }),
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 12,
        borderBottomWidth: 2,
        borderBottomColor: Colors.line,
    },
    title: {
        fontSize: 20,
        fontWeight: '800',
        color: Colors.text,
    },
    closeButton: {
        padding: 4,
    },
    subtitle: {
        fontSize: 14,
        color: Colors.sub,
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 16,
    },
    scrollView: {
        flexGrow: 1,
    },
    scrollContent: {
        paddingBottom: 24,
    },
    addedListSection: {
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 16,
    },
    addedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: Colors.line,
        gap: 12,
    },
    iconSmall: {
        width: 36,
        height: 36,
        borderRadius: Radius.md,
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconSmallScan: {
        width: 36,
        height: 36,
        borderRadius: Radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: Colors.accentMuted,
    },
    addedRowLabel: {
        fontSize: 14,
        fontWeight: '700',
        color: Colors.text,
    },
    addedRowSub: {
        fontSize: 12,
        color: Colors.sub,
    },
    removeBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: Radius.sm,
        borderWidth: 2,
        borderColor: Colors.dangerFg,
        backgroundColor: Colors.dangerBg,
    },
    removeBtnText: {
        fontSize: 12,
        fontWeight: '700',
        color: Colors.dangerFg,
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        padding: 12,
    },
    shortcutCard: {
        width: '48%',
        margin: '1%',
        borderRadius: Radius.lg,
        padding: 16,
        borderWidth: 2,
        borderColor: 'transparent',
        position: 'relative',
    },
    shortcutCardScanStyle: {
        backgroundColor: Colors.card,
        borderWidth: 2,
        borderColor: Colors.line,
        ...Shadows.card,
    },
    shortcutCardAdded: {
        opacity: 0.6,
        borderColor: Colors.successFg,
    },
    adminBadge: {
        position: 'absolute',
        top: 8,
        right: 8,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Colors.dangerBg,
        borderRadius: Radius.sm,
        paddingHorizontal: 6,
        paddingVertical: 2,
        gap: 2,
    },
    adminBadgeText: {
        fontSize: 10,
        fontWeight: '700',
        color: Colors.dangerFg,
    },
    adminSection: {
        paddingHorizontal: 12,
        paddingTop: 8,
    },
    sectionLabel: {
        fontSize: 13,
        fontWeight: '700',
        color: Colors.text,
        marginBottom: 8,
        textTransform: 'uppercase',
    },
    adminPill: {
        position: 'absolute',
        top: 12,
        right: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: Radius.sm,
        backgroundColor: Colors.dangerBg,
    },
    adminPillText: {
        fontSize: 10,
        fontWeight: '700',
        color: Colors.dangerFg,
    },
    iconContainer: {
        width: 56,
        height: 56,
        borderRadius: Radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 12,
    },
    iconContainerScan: {
        width: 56,
        height: 56,
        borderRadius: Radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 12,
        backgroundColor: Colors.accentMuted,
    },
    shortcutLabel: {
        fontSize: 15,
        fontWeight: '700',
        color: Colors.text,
        marginBottom: 4,
    },
    shortcutLabelScan: {
        fontSize: 15,
        fontWeight: '700',
        color: Colors.accent,
        marginBottom: 4,
    },
    shortcutDescription: {
        fontSize: 12,
        color: Colors.sub,
        lineHeight: 16,
    },
    addedIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 8,
        gap: 4,
    },
    addedText: {
        fontSize: 12,
        fontWeight: '700',
        color: Colors.successFg,
    },
    footer: {
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderTopWidth: 2,
        borderTopColor: Colors.line,
        alignItems: 'center',
    },
    footerText: {
        fontSize: 13,
        color: Colors.sub,
        fontWeight: '700',
    },
    manageRow: { marginTop: 8 },
    manageListBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: Radius.sm,
        borderWidth: 2,
        borderColor: Colors.accent,
        backgroundColor: Colors.accentMuted,
    },
    manageListBtnActive: {
        backgroundColor: Colors.accent,
        borderColor: Colors.accent,
    },
    manageListBtnText: {
        fontSize: 13,
        fontWeight: '700',
        color: Colors.accent,
    },
});

export default AddShortcutModal;
