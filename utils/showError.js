/**
 * utils/showError.js
 * Centralised error-alert helper.
 *
 * Usage:
 *   import { showError, showSuccess } from '../utils/showError';
 *
 *   // In a catch block — pass the raw error + an optional fallback message:
 *   catch (e) { showError(e, 'Failed to save asset'); }
 *
 *   // With a plain string (no error object):
 *   showError('You must be logged in.');
 *
 *   // Success feedback:
 *   showSuccess('Asset transferred successfully.');
 *
 *   // Confirmation dialog (returns Promise<boolean>):
 *   const ok = await confirm('Delete asset?', 'This cannot be undone.');
 */

import { Alert } from 'react-native';
import logger from './logger';

/**
 * Extract a human-readable message from any thrown value.
 * Handles: Error instances, API response objects, plain strings.
 */
function extractMessage(err, fallback = 'An unexpected error occurred.') {
  if (!err) return fallback;
  if (typeof err === 'string') return err || fallback;
  // Error instance or object with .message
  if (err.message && typeof err.message === 'string') return err.message;
  // API response body: { error: '...' } or { message: '...' }
  if (err.error  && typeof err.error  === 'string') return err.error;
  return fallback;
}

/**
 * Show a dismissible error alert and log the error.
 *
 * @param {unknown}  err       - The caught error (or a plain string).
 * @param {string}  [fallback] - Message to display when err has no .message.
 * @param {string}  [title]    - Alert title (default: 'Error').
 * @param {Array}   [buttons]  - Custom Alert button array.
 */
export function showError(err, fallback = 'An unexpected error occurred.', title = 'Error', buttons) {
  const message = extractMessage(err, fallback);
  logger.error(title, message, err);
  Alert.alert(title, message, buttons ?? [{ text: 'OK' }]);
}

/**
 * Show a success alert.
 *
 * @param {string}  message
 * @param {string}  [title]   - Alert title (default: 'Success').
 * @param {Array}   [buttons]
 */
export function showSuccess(message, title = 'Success', buttons) {
  Alert.alert(title, message, buttons ?? [{ text: 'OK' }]);
}

/**
 * Show a confirmation dialog.  Returns a Promise that resolves to `true`
 * when the user presses Confirm, or `false` on Cancel.
 *
 * @param {string}  title
 * @param {string}  [message]
 * @param {string}  [confirmLabel]  - Label for the confirm button (default: 'Confirm').
 * @param {string}  [cancelLabel]   - Label for the cancel button (default: 'Cancel').
 * @param {boolean} [destructive]   - Style the confirm button as destructive.
 */
export function confirm(title, message = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive = false) {
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: cancelLabel,  style: 'cancel',                           onPress: () => resolve(false) },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true)  },
    ])
  );
}

export default { showError, showSuccess, confirm };
