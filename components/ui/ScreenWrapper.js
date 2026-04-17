import React from 'react';
import { View, StyleSheet, StatusBar, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../../constants/uiTheme';

const DEFAULT_EDGES = ['top', 'left', 'right', 'bottom'];

export default function ScreenWrapper({ children, style, withScrollView = false, edges = DEFAULT_EDGES, ...props }) {
    const Wrapper = withScrollView ? View : View; // Placeholder if we want to add ScrollView support later easily

    return (
        <SafeAreaView
            edges={edges}
            style={[
                styles.container,
                { backgroundColor: Colors.bg },
                style
            ]}
            {...props}
        >
            <StatusBar
                barStyle="dark-content"
                backgroundColor={Colors.bg}
            />
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
