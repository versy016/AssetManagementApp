// inventory-api/apiBase.js
import { API_URL } from './config';

// Prefer Expo public env override when running on device.
// Expo inlines EXPO_PUBLIC_* at build time for the client bundle.
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL?.trim() || API_URL;
