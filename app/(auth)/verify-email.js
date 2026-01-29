// verify-email.js - Email verification screen

import { auth } from '../../firebaseConfig';
import { sendEmailVerification, signOut } from 'firebase/auth';
import React, { useState, useEffect } from 'react';
import { View, Text, Alert, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from 'react-native-paper';

import ScreenWrapper from '../../components/ui/ScreenWrapper';
import AppButton from '../../components/ui/AppButton';
import ErrorMessage from '../../components/ui/ErrorMessage';

export default function VerifyEmail() {
    const router = useRouter();
    const theme = useTheme();
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(false);
    const [resending, setResending] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [checking, setChecking] = useState(true);

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(async (firebaseUser) => {
            if (!firebaseUser) {
                router.replace('/(auth)/login');
                return;
            }

            // Reload to get latest emailVerified status
            try {
                await firebaseUser.reload();
                setUser(firebaseUser);

                // If email is verified, redirect to dashboard
                if (firebaseUser.emailVerified) {
                    router.replace('/(tabs)/dashboard');
                }
            } catch (error) {
                console.error('Error reloading user:', error);
                setErrorMessage('Failed to check verification status.');
            } finally {
                setChecking(false);
            }
        });

        return unsubscribe;
    }, [router]);

    const handleResendVerification = async () => {
        if (!user) return;

        setResending(true);
        setErrorMessage('');

        try {
            await sendEmailVerification(user);
            Alert.alert(
                'Verification Email Sent',
                'Please check your email and click the verification link. The link will expire in 1 hour.',
                [{ text: 'OK' }]
            );
        } catch (error) {
            let errorMsg = 'Failed to send verification email.';
            if (error.code === 'auth/too-many-requests') {
                errorMsg = 'Too many requests. Please wait a few minutes before requesting another verification email.';
            }
            setErrorMessage(errorMsg);
        } finally {
            setResending(false);
        }
    };

    const handleCheckVerification = async () => {
        if (!user) return;

        setLoading(true);
        setErrorMessage('');

        try {
            await user.reload();
            if (user.emailVerified) {
                Alert.alert('Email Verified', 'Your email has been verified successfully!', [
                    {
                        text: 'OK',
                        onPress: () => router.replace('/(tabs)/dashboard'),
                    },
                ]);
            } else {
                Alert.alert('Not Verified', 'Your email has not been verified yet. Please check your inbox and click the verification link.');
            }
        } catch (error) {
            setErrorMessage('Failed to check verification status.');
        } finally {
            setLoading(false);
        }
    };

    const handleSignOut = async () => {
        try {
            await signOut(auth);
            router.replace('/(auth)/login');
        } catch (error) {
            setErrorMessage('Failed to sign out.');
        }
    };

    if (checking) {
        return (
            <ScreenWrapper style={styles.container} withScrollView>
                <View style={styles.content}>
                    <ActivityIndicator size="large" color={theme.colors.primary} />
                    <Text style={[styles.checkingText, { color: theme.colors.text }]}>Checking verification status...</Text>
                </View>
            </ScreenWrapper>
        );
    }

    return (
        <ScreenWrapper style={styles.container} withScrollView>
            <View style={styles.content}>
                <Text style={[styles.title, { color: theme.colors.primary }]}>Verify Your Email</Text>

                <View style={styles.messageContainer}>
                    <Text style={[styles.message, { color: theme.colors.text }]}>
                        We've sent a verification email to:
                    </Text>
                    <Text style={[styles.email, { color: theme.colors.primary }]}>
                        {user?.email}
                    </Text>
                    <Text style={[styles.instructions, { color: theme.colors.text }]}>
                        Please check your inbox and click the verification link to activate your account. The link will expire in 1 hour.
                    </Text>
                </View>

                <ErrorMessage error={errorMessage} visible={!!errorMessage} />

                <AppButton
                    mode="contained"
                    onPress={handleCheckVerification}
                    loading={loading}
                    style={styles.button}
                >
                    I've Verified My Email
                </AppButton>

                <AppButton
                    mode="outlined"
                    onPress={handleResendVerification}
                    loading={resending}
                    style={styles.button}
                >
                    Resend Verification Email
                </AppButton>

                <TouchableOpacity onPress={handleSignOut} style={styles.signOutLink}>
                    <Text style={{ color: theme.colors.error || '#b00020', fontWeight: '500' }}>
                        Sign Out
                    </Text>
                </TouchableOpacity>
            </View>
        </ScreenWrapper>
    );
}

const styles = StyleSheet.create({
    container: {
        justifyContent: 'center',
    },
    content: {
        padding: 20,
        justifyContent: 'center',
        flex: 1,
        minHeight: 500,
    },
    title: {
        fontSize: 32,
        marginBottom: 24,
        fontWeight: 'bold',
        textAlign: 'center',
    },
    messageContainer: {
        marginBottom: 32,
        alignItems: 'center',
    },
    message: {
        fontSize: 16,
        textAlign: 'center',
        marginBottom: 8,
    },
    email: {
        fontSize: 18,
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: 16,
    },
    instructions: {
        fontSize: 14,
        textAlign: 'center',
        lineHeight: 20,
    },
    button: {
        marginBottom: 12,
    },
    signOutLink: {
        marginTop: 24,
        alignItems: 'center',
    },
    checkingText: {
        marginTop: 16,
        fontSize: 16,
    },
});

