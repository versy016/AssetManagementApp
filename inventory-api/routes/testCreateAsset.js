// testCreateAsset.js
const axios = require('axios');

const assetData = {
  id: 'CNP3AFJG',
  type_id: '9c442d04-faf7-48cd-b54c-a970b34a1d36',
  serial_number: 'SN-TEST1235',
  model: 'Model Y Test',
  description: 'This is a test asset from script',
  location: 'Test Location',
  assigned_to_id: 'SenCHBrcN0aTswEBbsqo0o7obD73',
  status: 'Available',
  next_service_date: '2025-08-01'
};

console.log('Sending request with data:', JSON.stringify(assetData, null, 2));

axios.post('http://ec2-3-25-81-127.ap-southeast-2.compute.amazonaws.com:3000/assets', assetData, {
  headers: {
    'Content-Type': 'application/json'
  }
})
.then(res => {
  console.log('✅ Asset created:', res.data);
})
.catch(err => {
  console.error('❌ Error:', {
    message: err.message,
    response: {
      status: err.response?.status,
      statusText: err.response?.statusText,
      data: err.response?.data,
      headers: err.response?.headers
    },
    stack: err.stack
  });
});
