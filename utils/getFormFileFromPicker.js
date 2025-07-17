// getFormFileFromPicker.js - Utility for picking an image file and preparing it for form upload

import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

/**
 * Converts a base64 data URI to a Blob (for web use).
 * @param {string} dataURI - The base64 data URI string.
 * @param {string} contentType - The MIME type of the file.
 * @returns {Blob} - The resulting Blob object.
 */
function base64ToBlob(dataURI, contentType = 'image/jpeg') {
  const base64 = dataURI.split(',')[1];
  const byteCharacters = atob(base64);
  const byteArrays = [];

  // Convert base64 string to byte arrays in chunks
  for (let offset = 0; offset < byteCharacters.length; offset += 512) {
    const slice = byteCharacters.slice(offset, offset + 512);
    const byteNumbers = Array.from(slice).map(char => char.charCodeAt(0));
    byteArrays.push(new Uint8Array(byteNumbers));
  }

  // Create a Blob from the byte arrays
  return new Blob(byteArrays, { type: contentType });
}

/**
 * Launches the image picker and returns a file object ready for FormData upload.
 * Handles both web and native platforms.
 * @returns {Promise<{uri: string, file: Blob|File}|null>} File object or null if cancelled.
 */
export async function getImageFileFromPicker() {
  // Launch the image picker dialog
  const { assets, canceled } = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    quality: 0.7,
    base64: Platform.OS === 'web', // ✅ Only request base64 on web
  });

  // Return null if user cancels or no asset is selected
  if (canceled || !assets?.length) return null;

  const asset = assets[0];

  // Handle file preparation for web (convert base64 to Blob)
  if (Platform.OS === 'web') {
    const blob = base64ToBlob(asset.uri, asset.type || 'image/jpeg');
    return {
      uri: asset.uri, // still useful for preview
      file: blob,
      name: asset.fileName || 'upload.jpg',
      type: asset.type || 'image/jpeg',
    };
  } else {
    return {
      uri: asset.uri,
      file: {
        uri: asset.uri,
        name: asset.fileName || 'upload.jpg',
        type: asset.type || 'image/jpeg',
      },
    };
  }
}
