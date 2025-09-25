// inventory-api/serverConfig.js  ← SERVER-ONLY
const path = require('path');

const ENV = process.env.NODE_ENV || 'development';

const common = {
  STATIC_MOUNT: process.env.STATIC_MOUNT || '/static',
  QR_FOLDER: process.env.QR_FOLDER || path.join(__dirname, 'utils', 'qrcodes'),
  QR_SHEETS_FOLDER:
    process.env.QR_SHEETS_FOLDER || path.join(__dirname, 'utils', 'qrcodes', 'sheets'),
};

const env = {
  development: {
    API_URL: 'http://localhost:3000',
  },
  production: {
    API_URL: 'http://ec2-3-25-81-127.ap-southeast-2.compute.amazonaws.com:3000',
  },
}[ENV];

module.exports = { ...common, ...env };
