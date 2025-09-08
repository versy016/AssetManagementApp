const fs = require('fs');
const path = require('path');
const AWS = require('aws-sdk');
require('dotenv').config({ path: '../.env' }); // Adjust path if .env is outside routes/

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const s3 = new AWS.S3();

const testFilePath = path.join(__dirname, 'test-upload.txt');
const bucketName = process.env.S3_BUCKET;
const folder = 'test';

// Write a small test file
fs.writeFileSync(testFilePath, 'S3 upload test from Node.js');

const uploadParams = {
  Bucket: bucketName,
  Key: `${folder}/test-upload-${Date.now()}.txt`,
  Body: fs.readFileSync(testFilePath),
  ContentType: 'text/plain',
};

s3.upload(uploadParams, (err, data) => {
  if (err) {
    console.error('❌ Upload failed:', err.message);
  } else {
    console.log('✅ Upload successful:', data.Location);
  }
});
