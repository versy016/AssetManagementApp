// utils/s3Uploader.js - Utility for uploading files to Amazon S3 using multer and multer-s3

// Import AWS SDK for S3 operations
const AWS = require('aws-sdk');
// Import multer for handling multipart/form-data (file uploads)
const multer = require('multer');
// Import multer-s3 for S3 integration with multer
const multerS3 = require('multer-s3');

// Create an S3 client instance with credentials and region from environment variables
const s3 = new AWS.S3({
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID, // AWS access key
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, // AWS secret key
  },
  region: process.env.AWS_REGION, // AWS region
});

// Configure multer to use S3 as storage
const upload = multer({
  storage: multerS3({
    s3, // S3 client instance
    bucket: process.env.S3_BUCKET, // Target S3 bucket
    acl: 'public-read', // Optional: make uploaded files publicly readable
    metadata: (req, file, cb) => cb(null, { fieldName: file.fieldname }), // Add file field metadata
    key: (req, file, cb) =>
      // Generate a unique key for each file using timestamp and original filename
      cb(null, `assets/${Date.now().toString()}-${file.originalname}`),
  }),
});

// Export the configured multer uploader for use in routes/controllers
module.exports = upload;
