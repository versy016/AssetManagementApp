// testCreateAsset.js
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const form = new FormData();

form.append('type_id', 'e4572645-3b92-41aa-bacc-19a663acc05c'); // From asset_types.csv
form.append('serial_number', 'SN-TEST1235');
form.append('model', 'Model Y Test');
form.append('description', 'This is a test asset from script');
form.append('location', 'Test Location');
form.append('assigned_to_id', '0deef46c-abef-4d90-9f11-8dc6550a67e8'); // From users.csv
form.append('status', 'Available');
form.append('checked_out', 'true');
form.append('return_date', '2025-07-01');
form.append('next_service_date', '2025-08-01');

form.append('image', fs.createReadStream(path.join(__dirname, 'test-image.jpg')));
form.append('document', fs.createReadStream(path.join(__dirname, 'test-doc.pdf')));

axios.post('http://ec2-3-25-81-127.ap-southeast-2.compute.amazonaws.com:3000/assets', form, {
  headers: form.getHeaders()
})
.then(res => {
  console.log('✅ Asset created:', res.data);
})
.catch(err => {
  console.error('❌ Error:', err.response?.data || err.message);
});
