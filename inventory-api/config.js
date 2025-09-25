// inventory-api/config.js  ← BROWSER-SAFE, NO Node APIs
const ENV = process.env.NODE_ENV || 'development';

const config = {
  development: {
    API_URL: 'http://localhost:3000',
    STATIC_MOUNT: '/qrcodes' // only used as a string if you really need it on client
  },
  production: {
    API_URL: 'http://ec2-3-25-81-127.ap-southeast-2.compute.amazonaws.com:3000',
    STATIC_MOUNT: '/qrcodes'
  }
};

module.exports = config[ENV];
