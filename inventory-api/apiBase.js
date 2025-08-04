import { Platform } from 'react-native';
const { PROD_API_URL } = require('./config.js'); // Use require for Node.js compatibility

// The PROD_API_URL is now sourced from config.js

export const API_BASE_URL =
  Platform.OS === 'web'
    ? '/api'
    : PROD_API_URL;

export { PROD_API_URL }; // Re-export for other frontend parts if needed
