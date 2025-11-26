// app/theme-preview.js - Theme Preview and Switcher
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

const THEME_OPTIONS = [
    {
        id: 'golden',
        name: 'Golden Amber',
        description: 'Warm golden tones with amber accents',
        colors: {
            primary: '#F59E0B',
            primaryDark: '#D97706',
            primaryLight: '#FEF3C7',
            border: '#FBBF24',
            text: '#D97706',
            brandColor: '#0B63CE',
        }
    },
    {
        id: 'ocean',
        name: 'Ocean Blue',
        description: 'Professional blue with ocean vibes',
        colors: {
            primary: '#0EA5E9',
            primaryDark: '#0284C7',
            primaryLight: '#E0F2FE',
            border: '#38BDF8',
            text: '#0369A1',
            brandColor: '#1E40AF',
        }
    },
    {
        id: 'forest',
        name: 'Forest Green',
        description: 'Natural green with earthy tones',
        colors: {
            primary: '#10B981',
            primaryDark: '#059669',
            primaryLight: '#D1FAE5',
            border: '#34D399',
            text: '#047857',
            brandColor: '#065F46',
        }
    },
    {
        id: 'royal',
        name: 'Royal Purple',
        description: 'Elegant purple with luxury feel',
        colors: {
            primary: '#A855F7',
            primaryDark: '#9333EA',
            primaryLight: '#F3E8FF',
            border: '#C084FC',
            text: '#7C3AED',
            brandColor: '#6B21A8',
        }
    },
    {
        id: 'sunset',
        name: 'Sunset Orange',
        description: 'Vibrant orange with sunset warmth',
        colors: {
            primary: '#F97316',
            primaryDark: '#EA580C',
            primaryLight: '#FFEDD5',
            border: '#FB923C',
            text: '#C2410C',
            brandColor: '#9A3412',
        }
    }
];

export default function ThemePreview() {
    const router = useRouter();
    const [selectedTheme, setSelectedTheme] = useState('golden');

    const renderNavbarPreview = (theme) => {
        const isSelected = selectedTheme === theme.id;

        return (
            <View key={theme.id} style={styles.themeCard}>
                <View style={styles.themeHeader}>
                    <View>
                        <Text style={styles.themeName}>{theme.name}</Text>
                        <Text style={styles.themeDescription}>{theme.description}</Text>
                    </View>
                    <TouchableOpacity
                        style={[
                            styles.selectButton,
                            isSelected && { backgroundColor: theme.colors.primary }
                        ]}
                        onPress={() => setSelectedTheme(theme.id)}
                    >
                        <Text style={[
                            styles.selectButtonText,
                            isSelected && { color: '#FFFFFF' }
                        ]}>
                            {isSelected ? 'Selected' : 'Select'}
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Navbar Preview */}
                <View style={[styles.navbarPreview, {
                    borderBottomColor: theme.colors.border,
                    shadowColor: theme.colors.primary,
                }]}>
                    <View style={styles.brandWrap}>
                        <Text style={[styles.brand, { color: theme.colors.brandColor }]}>Asset Manager</Text>
                    </View>

                    <View style={styles.navCenter}>
                        <View style={styles.navItem}>
                            <Text style={styles.navText}>Dashboard</Text>
                        </View>
                        <View style={[styles.navItem, styles.navItemActive, {
                            backgroundColor: theme.colors.primaryLight,
                            borderColor: theme.colors.border,
                        }]}>
                            <Text style={[styles.navTextActive, { color: theme.colors.text }]}>Shortcuts</Text>
                        </View>
                        <View style={styles.navItem}>
                            <Text style={styles.navText}>My Tasks</Text>
                        </View>
                        <View style={styles.navItem}>
                            <Text style={styles.navText}>Activity</Text>
                        </View>
                        <View style={styles.navItem}>
                            <Text style={styles.navText}>Inventory</Text>
                        </View>
                    </View>

                    <View style={styles.navRight}>
                        <View style={styles.navItem}>
                            <Text style={styles.navText}>Profile</Text>
                        </View>
                        <View style={[styles.logoutButton, {
                            backgroundColor: theme.colors.primaryLight,
                            borderColor: theme.colors.border,
                        }]}>
                            <Text style={[styles.logoutText, { color: theme.colors.text }]}>Logout</Text>
                        </View>
                    </View>
                </View>

                {/* Color Palette */}
                <View style={styles.colorPalette}>
                    <View style={styles.colorRow}>
                        <View style={[styles.colorSwatch, { backgroundColor: theme.colors.primary }]} />
                        <Text style={styles.colorLabel}>Primary</Text>
                    </View>
                    <View style={styles.colorRow}>
                        <View style={[styles.colorSwatch, { backgroundColor: theme.colors.primaryDark }]} />
                        <Text style={styles.colorLabel}>Dark</Text>
                    </View>
                    <View style={styles.colorRow}>
                        <View style={[styles.colorSwatch, { backgroundColor: theme.colors.primaryLight }]} />
                        <Text style={styles.colorLabel}>Light</Text>
                    </View>
                    <View style={styles.colorRow}>
                        <View style={[styles.colorSwatch, { backgroundColor: theme.colors.brandColor }]} />
                        <Text style={styles.colorLabel}>Brand</Text>
                    </View>
                </View>
            </View>
        );
    };

    if (Platform.OS !== 'web') {
        return (
            <View style={styles.container}>
                <Text style={styles.mobileMessage}>Theme preview is only available on web</Text>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Text style={styles.backButtonText}>Go Back</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backIconButton}>
                    <MaterialIcons name="arrow-back" size={24} color="#111827" />
                </TouchableOpacity>
                <View>
                    <Text style={styles.title}>Theme Preview</Text>
                    <Text style={styles.subtitle}>Choose your preferred color scheme for the navbar</Text>
                </View>
            </View>

            <View style={styles.themesContainer}>
                {THEME_OPTIONS.map(renderNavbarPreview)}
            </View>

            <View style={styles.footer}>
                <Text style={styles.footerText}>
                    Selected: <Text style={styles.footerBold}>{THEME_OPTIONS.find(t => t.id === selectedTheme)?.name}</Text>
                </Text>
                <Text style={styles.footerHint}>
                    Let me know which theme you'd like to apply, and I'll update the navbar!
                </Text>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F9FAFB',
    },
    scrollContent: {
        padding: 24,
        maxWidth: 1200,
        alignSelf: 'center',
        width: '100%',
    },
    header: {
        marginBottom: 32,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 16,
    },
    backIconButton: {
        padding: 8,
        borderRadius: 8,
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#E5E7EB',
    },
    title: {
        fontSize: 32,
        fontWeight: '800',
        color: '#111827',
        marginBottom: 4,
    },
    subtitle: {
        fontSize: 16,
        color: '#6B7280',
    },
    themesContainer: {
        gap: 24,
    },
    themeCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 24,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    themeHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    themeName: {
        fontSize: 20,
        fontWeight: '700',
        color: '#111827',
        marginBottom: 4,
    },
    themeDescription: {
        fontSize: 14,
        color: '#6B7280',
    },
    selectButton: {
        paddingVertical: 8,
        paddingHorizontal: 20,
        borderRadius: 999,
        backgroundColor: '#F3F4F6',
        borderWidth: 1,
        borderColor: '#E5E7EB',
    },
    selectButtonText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#374151',
    },
    navbarPreview: {
        width: '100%',
        backgroundColor: '#FFFFFF',
        borderBottomWidth: 3,
        paddingHorizontal: 16,
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        borderRadius: 8,
        marginBottom: 16,
        shadowOpacity: 0.1,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
    },
    brandWrap: {
        paddingRight: 8,
    },
    brand: {
        fontSize: 18,
        fontWeight: '800',
    },
    navCenter: {
        flex: 1,
        flexDirection: 'row',
        gap: 8,
        flexWrap: 'wrap',
        justifyContent: 'center',
    },
    navRight: {
        flexDirection: 'row',
        gap: 8,
        marginLeft: 'auto',
        alignItems: 'center',
    },
    navItem: {
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 999,
    },
    navItemActive: {
        borderWidth: 1,
    },
    navText: {
        fontWeight: '700',
        fontSize: 14,
        color: '#64748B',
    },
    navTextActive: {
        fontWeight: '700',
        fontSize: 14,
    },
    logoutButton: {
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 999,
        borderWidth: 1,
    },
    logoutText: {
        fontWeight: '700',
        fontSize: 14,
    },
    colorPalette: {
        flexDirection: 'row',
        gap: 16,
        flexWrap: 'wrap',
    },
    colorRow: {
        alignItems: 'center',
        gap: 6,
    },
    colorSwatch: {
        width: 48,
        height: 48,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#E5E7EB',
    },
    colorLabel: {
        fontSize: 12,
        color: '#6B7280',
        fontWeight: '600',
    },
    footer: {
        marginTop: 32,
        padding: 20,
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#E5E7EB',
    },
    footerText: {
        fontSize: 16,
        color: '#374151',
        marginBottom: 8,
    },
    footerBold: {
        fontWeight: '700',
        color: '#111827',
    },
    footerHint: {
        fontSize: 14,
        color: '#6B7280',
    },
    mobileMessage: {
        fontSize: 16,
        color: '#6B7280',
        textAlign: 'center',
        marginTop: 40,
    },
    backButton: {
        marginTop: 20,
        paddingVertical: 12,
        paddingHorizontal: 24,
        backgroundColor: '#2563EB',
        borderRadius: 8,
        alignSelf: 'center',
    },
    backButtonText: {
        color: '#FFFFFF',
        fontWeight: '700',
    },
});
