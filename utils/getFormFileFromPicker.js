// utils/getFormFileFromPicker.js
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

/** MIME types accepted by API for image fields (keep in sync with inventory-api/routes/assets.js). */
export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/tiff',
  'image/heic',
  'image/heif',
  'image/avif',
];

const EXT_TO_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
};

export const WEB_IMAGE_FILE_ACCEPT = [
  'image/*',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.tif',
  '.tiff',
  '.heic',
  '.heif',
  '.avif',
].join(',');

function extOf(nameOrPath = '') {
  const m = String(nameOrPath).match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : '';
}

/**
 * Infer image MIME from File/Blob or filename (fixes empty `file.type` on some browsers / HEIC).
 */
export function inferImageMimeFromFile(file) {
  const raw = (file && file.type) || '';
  if (raw && /^image\//i.test(raw)) return raw.replace(/jpeg/i, 'jpeg').replace(/^image\/jpg$/i, 'image/jpeg');
  const name = (file && file.name) || '';
  const ext = extOf(name);
  if (ext && EXT_TO_MIME[ext]) return EXT_TO_MIME[ext];
  return 'image/jpeg';
}

function deriveImageMime({ uri, mimeType, fileName }) {
  if (typeof uri === 'string' && uri.startsWith('data:image/')) {
    const m = uri.match(/^data:(image\/[a-z0-9+.-]+);base64,/i);
    if (m) return m[1].replace(/jpg/i, 'jpeg');
  }
  if (mimeType && /^image\//i.test(mimeType)) return String(mimeType).replace(/jpg/i, 'jpeg');
  const ext = extOf(fileName || uri);
  if (ext && EXT_TO_MIME[ext]) return EXT_TO_MIME[ext];
  return 'image/jpeg';
}

/**
 * Web: avoid expo-image-picker for library (it throws when `file.type` is empty — common for HEIC / some JPEGs).
 */
function pickImageFileWeb() {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = WEB_IMAGE_FILE_ACCEPT;
    input.style.display = 'none';
    const cleanup = () => {
      try {
        if (input.parentNode) input.parentNode.removeChild(input);
      } catch {
        /* ignore */
      }
    };
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      cleanup();
      if (!f) {
        resolve(null);
        return;
      }
      const contentType = inferImageMimeFromFile(f);
      const allowed = new Set(ALLOWED_IMAGE_MIME_TYPES);
      if (!allowed.has(contentType)) {
        reject(new Error(`Unsupported file type. Please use: ${Object.keys(EXT_TO_MIME).join(', ')}`));
        return;
      }
      const file = f.type === contentType ? f : new File([f], f.name || 'upload.jpg', { type: contentType });
      const uri = URL.createObjectURL(file);
      const name = file.name || `upload.${contentType.split('/')[1] === 'jpeg' ? 'jpg' : (contentType.split('/')[1] || 'jpg')}`;
      resolve({ uri, file, name, type: contentType, size: file.size ?? null });
    });
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Launch picker and return an object ready for FormData.append('image', ...)
 * Returns { uri, file, name, type } or null if cancelled
 */
export async function getImageFileFromPicker() {
  if (Platform.OS === 'web') {
    return pickImageFileWeb();
  }

  const { assets, canceled } = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    quality: 0.7,
    base64: false,
  });

  if (canceled || !assets?.length) return null;
  const asset = assets[0];

  const contentType = deriveImageMime({
    uri: asset.uri,
    mimeType: asset.mimeType,
    fileName: asset.fileName,
  });

  const allowed = new Set(ALLOWED_IMAGE_MIME_TYPES);
  if (!allowed.has(contentType)) {
    throw new Error(`Unsupported file type. Please choose: ${Object.keys(EXT_TO_MIME).join(', ')}`);
  }

  const fallbackName = (() => {
    const ext = contentType.split('/')[1] || 'jpg';
    return `upload.${ext === 'jpeg' ? 'jpg' : ext}`;
  })();
  const name = asset.fileName || fallbackName;

  return {
    uri: asset.uri,
    file: { uri: asset.uri, name, type: contentType },
    name,
    type: contentType,
    size: typeof asset.fileSize === 'number' ? asset.fileSize : null,
  };
}

/**
 * Normalize browser File objects so FormData gets a correct Content-Type when `type` was empty.
 */
export function normalizeWebImageFile(file) {
  if (!file || typeof File === 'undefined' || !(file instanceof File)) return file;
  const t = inferImageMimeFromFile(file);
  if (!file.type && t) return new File([file], file.name || 'image.jpg', { type: t });
  return file;
}

/**
 * Revoke a blob:URL produced by `getImageFileFromPicker` so the underlying
 * File can be garbage-collected. No-op for any other URI shape (http(s)://,
 * data:, file:// from native, undefined).
 *
 * IMPORTANT: every consumer that replaces an image state must call this on
 * the *previous* uri before discarding it. Without this, repeatedly choosing
 * Replace → Replace keeps every prior file alive in memory, eventually
 * starving the browser (Chrome shows STATUS_ILLEGAL_INSTRUCTION).
 */
export function revokeImageUri(uri) {
  if (typeof uri !== 'string') return;
  if (!uri.startsWith('blob:')) return;
  try { URL.revokeObjectURL(uri); } catch { /* ignore */ }
}
