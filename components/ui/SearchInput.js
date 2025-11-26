import React from 'react';
import { View, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from 'react-native-paper';
import { MaterialIcons } from '@expo/vector-icons';

export default function SearchInput({
    value,
    onChangeText,
    placeholder = 'Search...',
    style,
    inputStyle,
    onClear,
    right,
    ...inputProps
}) {
    const theme = useTheme();

    return (
        <View
            style={[
                styles.container,
                {
                    backgroundColor: theme.colors.surface,
                    borderColor: theme.colors.outline,
                },
                style,
            ]}
        >
            <MaterialIcons
                name="search"
                size={20}
                color={theme.colors.onSurfaceVariant}
                style={styles.icon}
            />
            <TextInput
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder}
                placeholderTextColor={theme.colors.onSurfaceVariant}
                style={[
                    styles.input,
                    { color: theme.colors.onSurface },
                    inputStyle,
                ]}
                {...inputProps}
            />
            {value ? (
                <TouchableOpacity
                    testID="clear-button"
                    onPress={() => {
                        onChangeText('');
                        if (onClear) onClear();
                    }}
                >
                    <MaterialIcons
                        name="close"
                        size={18}
                        color={theme.colors.onSurfaceVariant}
                        style={styles.clearIcon}
                    />
                </TouchableOpacity>
            ) : null}
            {right}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 40,
        borderRadius: 10,
        borderWidth: 1,
        paddingHorizontal: 12,
    },
    icon: {
        marginRight: 8,
    },
    input: {
        flex: 1,
        fontSize: 14,
        height: '100%',
        padding: 0, // Remove default padding
    },
    clearIcon: {
        marginLeft: 8,
    },
});
