// app/index.js
import { auth } from '../firebaseConfig'; // Adjust the path if needed
import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';

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

  // You can render a splash or null while authentication is in process
  return null;
}
