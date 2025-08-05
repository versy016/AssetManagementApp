// Centralized configuration for utilities and scripts
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

// Import the production API URL from the main config
const { PROD_API_URL } = require('../inventory-api/config');

module.exports = {
  HOST: process.env.HOST || 'localhost',
  PORT: process.env.PORT || '3000',
  QR_ASSET_COUNT: parseInt(process.env.QR_ASSET_COUNT, 10) || 50,
  QR_FOLDER: process.env.QR_FOLDER || 'qr',
  PROD_API_URL: PROD_API_URL || `http://${process.env.HOST || 'localhost'}:${process.env.PORT || '3000'}`
};
