import React from 'react';
import { View, StyleSheet, StatusBar, Platform, KeyboardAvoidingView } from 'react-native';
import { useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ScreenWrapper({ children, style, withScrollView = false, ...props }) {
    const theme = useTheme();

    const Wrapper = withScrollView ? View : View; // Placeholder if we want to add ScrollView support later easily

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }, style]} {...props}>
            <StatusBar barStyle="dark-content" backgroundColor={theme.colors.background} />
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={{ flex: 1 }}
            >
                {children}
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
});
