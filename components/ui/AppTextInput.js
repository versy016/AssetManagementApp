import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput as RNTextInput, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, FontWeights, sf } from '../../constants/uiTheme';

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
    // Local toggle — only relevant when secureTextEntry is true.
    const [passwordVisible, setPasswordVisible] = useState(false);

    const borderColor = error
        ? Colors.dangerFg
        : focused
        ? Colors.accent
        : Colors.line;

    // When the field is a password, expose a show/hide icon.
    // The effective `secureTextEntry` flag is gated by the user's toggle.
    const isPassword = !!secureTextEntry;
    const effectiveSecure = isPassword && !passwordVisible;

    return (
        <View style={[styles.container, style]}>
            {label && (
                <Text style={styles.label}>{label}</Text>
            )}
            <View style={styles.inputWrap}>
                <RNTextInput
                    value={value}
                    onChangeText={onChangeText}
                    placeholder={placeholder}
                    placeholderTextColor={Colors.sub2}
                    secureTextEntry={effectiveSecure}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    style={[
                        styles.input,
                        {
                            borderColor,
                            minHeight: multiline ? 100 : 44,
                            // Make room for the eye icon when present
                            paddingRight: isPassword ? 44 : 12,
                        },
                    ]}
                    multiline={multiline}
                    editable={!props.disabled}
                    {...props}
                />
                {isPassword && (
                    <TouchableOpacity
                        style={styles.toggleBtn}
                        onPress={() => setPasswordVisible(v => !v)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityRole="button"
                        accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
                        // Important: don't steal focus from the input on press
                        // (Web only — onMouseDown preventDefault).
                        onPressIn={(e) => e?.preventDefault?.()}
                    >
                        <MaterialIcons
                            name={passwordVisible ? 'visibility-off' : 'visibility'}
                            size={20}
                            color={Colors.sub}
                        />
                    </TouchableOpacity>
                )}
            </View>
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
        fontSize: sf(13),
        fontWeight: FontWeights.bold,
        color: Colors.text,
        marginBottom: 6,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    inputWrap: {
        position: 'relative',
    },
    input: {
        backgroundColor: Colors.card,
        borderWidth: 2,
        borderRadius: Radius.sm,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: sf(14),
        // Inherit the system font stack used by labels / headings.
        // (Previously forced `fontFamily: 'Inter'`, which clashed with the rest.)
        color: Colors.text,
        fontWeight: FontWeights.regular,
    },
    toggleBtn: {
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: 0,
        width: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    errorText: {
        fontSize: sf(11),
        fontWeight: FontWeights.medium,
        color: Colors.dangerFg,
        marginTop: 4,
    },
});
