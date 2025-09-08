const axios = require('axios');
import { API_BASE_URL } from '../../inventory-api/apiBase';

axios.get(`${API_BASE_URL}/assets/asset_types`)
  .then(res => {
    console.log('✅ Asset Types:\n', res.data);
  })
  .catch(err => {
    console.error('❌ Failed to fetch asset types:', err.response?.data || err.message);
  });
