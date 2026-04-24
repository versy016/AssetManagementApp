// Loads task count in the background so the Tasks tab badge shows without opening the tab.
import React, { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { auth } from '../firebaseConfig';
import { onAuthStateChanged } from 'firebase/auth';
import { useTasksCount } from '../contexts/TasksCountContext';
import { fetchTaskCount } from '../utils/fetchTaskCount';
import { API_BASE_URL } from '../inventory-api/apiBase';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import logger from '../utils/logger';

async function registerPushTokenAndSendToApi(uid) {
  if (Platform.OS === 'web' || !Device.isDevice) return;
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : {}
    );
    const token = tokenData?.data;
    if (!token || !uid) return;
    await fetch(`${API_BASE_URL}/users/push-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': String(uid),
      },
      body: JSON.stringify({ expo_push_token: token }),
    });
  } catch (e) {
    logger.warn('Push registration failed', e?.message);
  }
}

async function loadCount(setTaskCount, mounted) {
  const user = auth?.currentUser;
  if (!user?.uid || !mounted.current) return;
  try {
    const res = await fetch(`${API_BASE_URL}/users/${user.uid}`);
    const data = res.ok ? await res.json() : null;
    const canAdmin = String(data?.role || '').toUpperCase() === 'ADMIN';
    const count = await fetchTaskCount(user.uid, canAdmin);
    if (mounted.current) setTaskCount(count);
  } catch (e) {
    logger.error('TaskCountLoader: task count fetch failed', e?.message || e);
    if (mounted.current) setTaskCount(0);
  }
}

export default function TaskCountLoader() {
  const { setTaskCount } = useTasksCount();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const runLoad = () => loadCount(setTaskCount, mounted);

    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user?.uid) {
        setTaskCount(0);
        return;
      }
      runLoad();
      registerPushTokenAndSendToApi(user.uid);
    });

    // Run immediately if user is already signed in (e.g. app just opened; auth may have fired before we mounted)
    if (auth?.currentUser?.uid) {
      runLoad();
      registerPushTokenAndSendToApi(auth.currentUser.uid);
    }

    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') runLoad();
    });

    return () => {
      mounted.current = false;
      unsub();
      sub?.remove?.();
    };
  }, [setTaskCount]);

  return null;
}
