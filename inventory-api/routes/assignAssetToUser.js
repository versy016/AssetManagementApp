const axios = require('axios');
const API_BASE = 'http://localhost:3000';

const userId = process.argv[2];
const assetId = process.argv[3];

if (!userId || !assetId) {
  console.error('❌ Please provide both user ID and asset ID as arguments.');
  console.error('Usage: node assignAssetToUser.js <userId> <assetId>');
  process.exit(1);
}

axios.post(`${API_BASE}/users/${userId}/assign-asset`, { assetId })
  .then(res => {
    console.log('✅ Asset assigned successfully:');
    console.log(JSON.stringify(res.data, null, 2));
  })
  .catch(err => {
    console.error('❌ Error assigning asset:');
    if (err.response) {
      console.error('Status:', err.response.status);
      console.error('Data:', JSON.stringify(err.response.data, null, 2));
    } else {
      console.error('Message:', err.message);
    }
  });
