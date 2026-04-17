import React, { useState } from 'react';
import { View, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, FontWeights } from '../../constants/uiTheme';

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
    const [focused, setFocused] = useState(false);

    return (
        <View
            style={[
                styles.container,
                focused && styles.containerFocused,
                style,
            ]}
        >
            <MaterialIcons
                name="search"
                size={20}
                color={focused ? Colors.primary : Colors.sub}
                style={styles.icon}
            />
            <TextInput
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder}
                placeholderTextColor={Colors.sub2}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                style={[
                    styles.input,
                    { color: Colors.text },
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
                    hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                >
                    <MaterialIcons
                        name="close"
                        size={18}
                        color={Colors.sub2}
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
        height: 46,
        borderRadius: Radius.pill,
        paddingHorizontal: 14,
        backgroundColor: Colors.chip,
        borderWidth: 1.5,
        borderColor: 'transparent',
    },
    containerFocused: {
        borderColor: Colors.primary,
        backgroundColor: Colors.card,
    },
    icon: {
        marginRight: 8,
    },
    input: {
        flex: 1,
        fontSize: 15,
        fontWeight: FontWeights.regular,
        height: '100%',
        padding: 0,
    },
    clearIcon: {
        marginLeft: 8,
    },
});
