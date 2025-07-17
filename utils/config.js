// Centralized configuration for utilities and scripts
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

module.exports = {
  HOST: process.env.HOST || 'ec2-13-238-161-9.ap-southeast-2.compute.amazonaws.com',
  PORT: 3000,
  QR_ASSET_COUNT: parseInt(process.env.QR_ASSET_COUNT, 10) || 50,
  QR_FOLDER: process.env.QR_FOLDER || 'qr',
};
