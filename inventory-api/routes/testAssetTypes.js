const axios = require('axios');

axios.get('http://ec2-3-25-81-127.ap-southeast-2.compute.amazonaws.com:3000/assets/asset_types')
  .then(res => {
    console.log('✅ Asset Types:\n', res.data);
  })
  .catch(err => {
    console.error('❌ Failed to fetch asset types:', err.response?.data || err.message);
  });
