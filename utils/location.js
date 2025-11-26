import { API_BASE_URL } from '../inventory-api/apiBase';

/**
 * Request foreground location permission (if needed) and return a human-readable location.
 * Falls back to coordinates when reverse geocoding fails or APIs are unavailable.
 */
export const captureLastScannedLocation = async () => {
  try {
    let ExpoLocation;
    try {
      ExpoLocation = require('expo-location');
    } catch (err) {
      console.warn('[location] expo-location module unavailable', err);
      return null;
    }

    const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      console.warn('[location] permission not granted');
      return null;
    }

    const position = await ExpoLocation.getCurrentPositionAsync({
      accuracy: ExpoLocation.Accuracy?.Balanced || ExpoLocation.Accuracy?.Low,
    });
    if (!position?.coords) return null;

    const { latitude, longitude } = position.coords;
    let friendlyAddress = null;

    try {
      const resp = await fetch(
        `${API_BASE_URL}/places/reverse-geocode?lat=${latitude}&lng=${longitude}`
      );
      if (resp.ok) {
        const json = await resp.json();
        friendlyAddress = json?.formatted_address || null;
      }
    } catch (apiErr) {
      console.warn('[location] server reverse geocode failed', apiErr);
    }

    if (!friendlyAddress) {
      try {
        const geos = await ExpoLocation.reverseGeocodeAsync({ latitude, longitude });
        const first = Array.isArray(geos) ? geos[0] : null;
        if (first) {
          const parts = [first.name, first.street, first.city, first.region, first.country].filter(
            Boolean
          );
          friendlyAddress = parts.join(', ') || null;
        }
      } catch (nativeErr) {
        console.warn('[location] native reverse geocode failed', nativeErr);
      }
    }

    return friendlyAddress || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  } catch (error) {
    console.warn('[location] capture failed', error);
    return null;
  }
};

export default {
  captureLastScannedLocation,
};

