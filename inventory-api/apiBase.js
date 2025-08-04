import { Platform } from 'react-native';
const { PROD_API_URL } = require('./config.js'); // Use require for Node.js compatibility

export const API_BASE_URL =
  Platform.OS === 'web'
    ? '/api'
    : PROD_API_URL;

export { PROD_API_URL }; // Re-export for other frontend parts if needed
