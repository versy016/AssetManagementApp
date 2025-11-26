import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialIcons } from '@expo/vector-icons';

export default function ErrorMessage({ error, visible }) {
    const theme = useTheme();

    if (!visible || !error) return null;

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.errorContainer }]}>
            <MaterialIcons name="error-outline" size={24} color={theme.colors.error} />
            <Text style={[styles.text, { color: theme.colors.error }]}>{error}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderRadius: 8,
        marginBottom: 16,
    },
    text: {
        marginLeft: 8,
        flex: 1,
        fontSize: 14,
    },
});
