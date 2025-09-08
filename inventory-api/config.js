// inventory-api/config.js
const ENV = process.env.NODE_ENV || 'development';

const config = {
  development: {
    API_URL: 'http://localhost:3000'
  },
  production: {
    API_URL: 'http://ec2-3-25-81-127.ap-southeast-2.compute.amazonaws.com:3000'
  }
};

module.exports = config[ENV];