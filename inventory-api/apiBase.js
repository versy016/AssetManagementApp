// inventory-api/apiBase.js
import cfg from './config';
import { NativeModules, Platform } from 'react-native';
import Constants from 'expo-constants';

// Prefer Expo public env override when running on device.
// Expo inlines EXPO_PUBLIC_* at build time for the client bundle.

function guessDevApiBase() {
  try {
    // In Expo dev, Metro exposes the JS bundle URL. Extract host and point to API port.
    const scriptURL = NativeModules?.SourceCode?.scriptURL || '';
    // e.g. http://192.168.1.50:19000/index.bundle?platform=ios&dev=true
    const m = String(scriptURL).match(/^https?:\/\/([^:]+):\d+/i);
    const host = m && m[1];
    if (host) {
      // Default API port from server/.env (3000). Adjust here if you change the API port.
      return `http://${host}:3000`;
    }
  } catch {}
  return null;
}

function guessFromExpoConstants() {
  try {
    // Try multiple places where Expo exposes dev host info
    const c = Constants || {};
    const hostLike =
      c.expoConfig?.hostUri ||
      c?.manifest?.hostUri ||
      c?.manifest?.debuggerHost ||
      c?.manifest2?.extra?.expoClient?.hostUri ||
      c?.manifest2?.extra?.expoGo?.hostUri || '';
    // Examples: "192.168.1.50:19000", "localhost:19000"
    const m = String(hostLike).match(/([^:]+):\d+/);
    const host = m && m[1];
    if (host) return `http://${host}:3000`;
  } catch {}
  return null;
}

export const API_BASE_URL =
  (process.env.EXPO_PUBLIC_API_URL && String(process.env.EXPO_PUBLIC_API_URL).trim()) ||
  (Platform.OS !== 'web' && guessDevApiBase()) ||
  (Platform.OS !== 'web' && guessFromExpoConstants()) ||
  cfg.API_URL;
