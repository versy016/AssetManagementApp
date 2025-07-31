// Centralized configuration for utilities and scripts
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

module.exports = {
  HOST: process.env.HOST || 'localhost',
  PORT: process.env.PORT || '3000',
  QR_ASSET_COUNT: parseInt(process.env.QR_ASSET_COUNT, 10) || 50,
  QR_FOLDER: process.env.QR_FOLDER || 'qr',
};
