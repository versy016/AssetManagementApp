import React from 'react';
import { StyleSheet, View } from 'react-native';
import { TextInput, HelperText, useTheme } from 'react-native-paper';

export default function AppTextInput({
    label,
    value,
    onChangeText,
    error,
    secureTextEntry,
    style,
    ...props
}) {
    const theme = useTheme();

    return (
        <View style={styles.container}>
            <TextInput
                label={label}
                value={value}
                onChangeText={onChangeText}
                mode="outlined"
                error={!!error}
                secureTextEntry={secureTextEntry}
                style={[styles.input, { backgroundColor: theme.colors.surface }, style]}
                theme={theme}
                {...props}
            />
            {error ? (
                <HelperText type="error" visible={!!error}>
                    {error}
                </HelperText>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginBottom: 12,
    },
    input: {
        fontSize: 16,
    },
});
