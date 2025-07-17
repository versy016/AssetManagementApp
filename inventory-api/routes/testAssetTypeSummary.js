const axios = require('axios');

axios.get('http://ec2-13-238-161-9.ap-southeast-2.compute.amazonaws.com:3000/asset-types-summary')
  .then(res => {
    console.log('✅ Asset Type Summary:\n', res.data);
  })
  .catch(err => {
    console.error('❌ Failed to fetch asset type summary:', err.response?.data || err.message);
  });
