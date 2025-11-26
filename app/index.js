// app/index.js
import { auth } from '../firebaseConfig'; 

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

export default function Index() {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const router = useRouter();
  const isMountedRef = useRef(true);

  // Mark component as unmounted when cleanup happens
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // On web, default to Dashboard (which embeds Search)
    if (Platform.OS === 'web') {
      router.replace('/(tabs)/dashboard');
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return; // skip auth-driven redirect on web
    const unsubscribe = auth.onAuthStateChanged(async (firebaseUser) => {
      if (!isMountedRef.current) return; // Exit if unmounted

      if (firebaseUser) {
        try {
          // Refresh the token to get the latest custom claims
          await firebaseUser.getIdToken(true);
          const tokenResult = await firebaseUser.getIdTokenResult();
          const adminClaim = !!tokenResult.claims.admin;

          if (isMountedRef.current) {
            setUser(firebaseUser);
            setIsAdmin(adminClaim);
            // Navigate to the dashboard route
            router.replace('/(tabs)/dashboard');
          }
        } catch (error) {
          console.error('Error processing token:', error);
        }
      } else {
        if (isMountedRef.current) {
          setUser(null);
          setIsAdmin(false);
          // Navigate to the login route
          router.replace('/(auth)/login');
        }
      }
    });

    // Cleanup: unsubscribe from auth changes when effect unmounts
    return unsubscribe;
  }, [router]);

  // Handle incoming universal/app links for check-in
  useEffect(() => {
    const handleDeepLink = ({ url }) => {
      const { path } = Linking.parse(url);
      // path might be 'check-in/D8SLN5EZ'
      if (path && path.startsWith('check-in/')) {
        const assetId = path.split('/')[1];
        if (user) {
          router.replace(`/check-in/${assetId}`);
        } else {
          router.replace('/(auth)/login');
        }
      }
    };

    const subscription = Linking.addEventListener('url', handleDeepLink);
    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink({ url });
    });
    return () => {
      subscription.remove();
    };
  }, [user]);

  // You can render a splash or null while authentication is in process
  return null;
}
