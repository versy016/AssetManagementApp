import React from 'react';
import { StyleSheet } from 'react-native';
import { Button, useTheme } from 'react-native-paper';

export default function AppButton({
    mode = 'contained',
    style,
    labelStyle,
    children,
    loading,
    disabled,
    onPress,
    ...props
}) {
    const theme = useTheme();

    return (
        <Button
            mode={mode}
            style={[styles.button, style]}
            labelStyle={[styles.label, labelStyle]}
            loading={loading}
            disabled={disabled || loading}
            onPress={onPress}
            theme={theme}
            {...props}
        >
            {children}
        </Button>
    );
}

const styles = StyleSheet.create({
    button: {
        marginVertical: 8,
        borderRadius: 8,
    },
    label: {
        fontSize: 16,
        fontWeight: '600',
        paddingVertical: 2,
    },
});
