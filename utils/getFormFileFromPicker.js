// utils/getFormFileFromPicker.js
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

// Map common extensions to mime
const EXT_TO_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

// Extract extension from filename or path
function extOf(nameOrPath = '') {
  const m = String(nameOrPath).match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : '';
}

// Best-effort MIME derivation
function deriveImageMime({ uri, base64, mimeType, fileName }) {
  // 1) data URI (web)
  if (typeof uri === 'string' && uri.startsWith('data:image/')) {
    // e.g. data:image/png;base64,....
    const m = uri.match(/^data:(image\/[a-z0-9+.-]+);base64,/i);
    if (m) return m[1].replace('jpg', 'jpeg');
  }
  // 2) reported mimeType (some platforms)
  if (mimeType && /^image\//i.test(mimeType)) return mimeType.replace('jpg', 'jpeg');

  // 3) filename or uri extension
  const ext = extOf(fileName || uri);
  if (ext && EXT_TO_MIME[ext]) return EXT_TO_MIME[ext];

  // 4) fallback
  return 'image/jpeg';
}

/**
 * Convert a data URI to Blob (web)
 */
function base64ToBlob(dataURI, contentType = 'image/jpeg') {
  const base64 = dataURI.split(',')[1];
  const byteChars = atob(base64);
  const byteArrays = [];
  for (let offset = 0; offset < byteChars.length; offset += 512) {
    const slice = byteChars.slice(offset, offset + 512);
    const byteNums = Array.from(slice, ch => ch.charCodeAt(0));
    byteArrays.push(new Uint8Array(byteNums));
  }
  return new Blob(byteArrays, { type: contentType });
}

/**
 * Launch picker and return an object ready for FormData.append('image', ...)
 * Returns { uri, file, name, type } or null if cancelled
 */
export async function getImageFileFromPicker() {
  const { assets, canceled } = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    quality: 0.7,
    base64: Platform.OS === 'web', // web only
  });

  if (canceled || !assets?.length) return null;
  const asset = assets[0];

  // Derive a reliable MIME
  const contentType = deriveImageMime({
    uri: asset.uri,
    base64: asset.base64,
    mimeType: asset.mimeType,   // may be undefined
    fileName: asset.fileName,   // may be undefined
  });

  // Validate allowed mimes
  const allowed = new Set(['image/png', 'image/jpeg', 'image/webp']);
  if (!allowed.has(contentType)) {
    throw new Error('Please choose a PNG, JPG/JPEG, or WEBP image.');
  }

  // Choose a friendly filename
  const fallbackName = (() => {
    const ext = contentType.split('/')[1] || 'jpg';
    return `upload.${ext === 'jpeg' ? 'jpg' : ext}`;
  })();
  const name = asset.fileName || fallbackName;

  if (Platform.OS === 'web') {
    // Web provides a data URI; build a File so multer sees proper mimetype + filename
    const blob =
      typeof asset.uri === 'string' && asset.uri.startsWith('data:')
        ? base64ToBlob(asset.uri, contentType)
        : // (rare) if uri is blob:http, rebuild from base64 if present
          (asset.base64 ? base64ToBlob(`data:${contentType};base64,${asset.base64}`, contentType)
                        : new Blob([], { type: contentType }));

    const file = new File([blob], name, { type: contentType });
    return { uri: asset.uri, file, name: file.name, type: file.type };
  }

  // Native: send the {uri,name,type} shape
  return {
    uri: asset.uri,
    file: { uri: asset.uri, name, type: contentType },
    name,
    type: contentType,
  };
}
