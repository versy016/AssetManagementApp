import React from 'react';
import { StyleSheet, TouchableOpacity, Text, View, ActivityIndicator } from 'react-native';
import { Colors, Radius, FontWeights, Shadows } from '../../constants/uiTheme';

export default function AppButton({
    variant = 'primary',
    size = 'md',
    style,
    labelStyle,
    children,
    loading,
    disabled,
    onPress,
    icon,
    ...props
}) {
    const variantStyles = getVariantStyles(variant);
    const sizeStyles = getSizeStyles(size);

    return (
        <TouchableOpacity
            style={[
                styles.button,
                sizeStyles.container,
                variantStyles.container,
                disabled && styles.disabled,
                style
            ]}
            onPress={onPress}
            disabled={disabled || loading}
            activeOpacity={0.85}
            {...props}
        >
            {loading ? (
                <ActivityIndicator color={variantStyles.textColor} size="small" />
            ) : (
                <View style={styles.content}>
                    {icon && (
                        <View style={styles.iconContainer}>
                            {icon}
                        </View>
                    )}
                    <Text
                        style={[
                            styles.label,
                            sizeStyles.label,
                            { color: variantStyles.textColor },
                            labelStyle
                        ]}
                    >
                        {children?.toUpperCase?.() || children}
                    </Text>
                </View>
            )}
        </TouchableOpacity>
    );
}

function getVariantStyles(variant) {
    switch (variant) {
        case 'accent':
            return {
                container: {
                    backgroundColor: Colors.accent,
                    borderWidth: 0,
                },
                textColor: '#FFFFFF',
                shadow: Shadows.md,
            };
        case 'secondary':
            return {
                container: {
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    borderColor: Colors.line,
                },
                textColor: Colors.text,
            };
        case 'danger':
            return {
                container: {
                    backgroundColor: Colors.dangerFg,
                    borderWidth: 0,
                },
                textColor: '#FFFFFF',
                shadow: Shadows.md,
            };
        case 'primary':
        default:
            return {
                container: {
                    backgroundColor: Colors.primary,
                    borderWidth: 0,
                },
                textColor: '#FFFFFF',
                shadow: Shadows.md,
            };
    }
}

function getSizeStyles(size) {
    switch (size) {
        case 'sm':
            return {
                container: {
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: Radius.sm,
                    minHeight: 32,
                },
                label: {
                    fontSize: 12,
                    fontWeight: FontWeights.bold,
                    lineHeight: 14,
                },
            };
        case 'lg':
            return {
                container: {
                    paddingHorizontal: 20,
                    paddingVertical: 14,
                    borderRadius: Radius.md,
                    minHeight: 52,
                },
                label: {
                    fontSize: 18,
                    fontWeight: FontWeights.extrabold,
                    lineHeight: 20,
                },
            };
        case 'md':
        default:
            return {
                container: {
                    paddingHorizontal: 16,
                    paddingVertical: 11,
                    borderRadius: Radius.sm,
                    minHeight: 44,
                },
                label: {
                    fontSize: 14,
                    fontWeight: FontWeights.bold,
                    lineHeight: 16,
                },
            };
    }
}

const styles = StyleSheet.create({
    button: {
        justifyContent: 'center',
        alignItems: 'center',
        marginVertical: 8,
    },
    disabled: {
        opacity: 0.5,
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconContainer: {
        marginRight: 8,
    },
    label: {
        fontFamily: 'Inter',
        letterSpacing: 0.5,
    },
});
