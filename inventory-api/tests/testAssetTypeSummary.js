const axios = require('axios');
import { API_BASE_URL } from '../../inventory-api/apiBase';

axios.get(`${API_BASE_URL}/asset-types-summary`)
  .then(res => {
    console.log('✅ Asset Type Summary:\n', res.data);
  })
  .catch(err => {
    console.error('❌ Failed to fetch asset type summary:', err.response?.data || err.message);
  });
