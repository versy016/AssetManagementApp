import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput as RNTextInput } from 'react-native';
import { Colors, Radius, FontWeights } from '../../constants/uiTheme';

export default function AppTextInput({
    label,
    value,
    onChangeText,
    error,
    placeholder,
    secureTextEntry,
    style,
    multiline,
    ...props
}) {
    const [focused, setFocused] = useState(false);

    const borderColor = error
        ? Colors.dangerFg
        : focused
        ? Colors.accent
        : Colors.line;

    return (
        <View style={[styles.container, style]}>
            {label && (
                <Text style={styles.label}>{label}</Text>
            )}
            <RNTextInput
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder}
                placeholderTextColor={Colors.sub2}
                secureTextEntry={secureTextEntry}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                style={[
                    styles.input,
                    {
                        borderColor,
                        minHeight: multiline ? 100 : 44,
                    },
                ]}
                multiline={multiline}
                editable={!props.disabled}
                {...props}
            />
            {error && (
                <Text style={styles.errorText}>{error}</Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginBottom: 12,
    },
    label: {
        fontSize: 13,
        fontWeight: FontWeights.bold,
        color: Colors.text,
        marginBottom: 6,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    input: {
        backgroundColor: Colors.card,
        borderWidth: 2,
        borderRadius: Radius.sm,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 14,
        fontFamily: 'Inter',
        color: Colors.text,
        fontWeight: FontWeights.regular,
    },
    errorText: {
        fontSize: 11,
        fontWeight: FontWeights.medium,
        color: Colors.dangerFg,
        marginTop: 4,
    },
});
