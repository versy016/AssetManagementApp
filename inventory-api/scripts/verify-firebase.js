/**
 * Quick smoke-test for Firebase Admin SDK initialisation.
 * Run on the EC2 server BEFORE restarting PM2:
 *
 *   cd /home/ubuntu/AssetManagementApp/inventory-api
 *   NODE_ENV=production node scripts/verify-firebase.js
 *
 * Exit 0 = working. Exit 1 = something is wrong (error printed).
 */
'use strict';

const path = require('path');

// Load production .env so GOOGLE_APPLICATION_CREDENTIALS is available
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

console.log('NODE_ENV                      :', process.env.NODE_ENV);
console.log('GOOGLE_APPLICATION_CREDENTIALS:', credPath || '(not set)');

if (!credPath) {
  console.error('\nERROR: GOOGLE_APPLICATION_CREDENTIALS is not set in .env');
  process.exit(1);
}

// Check the file exists and is readable
const fs = require('fs');
if (!fs.existsSync(credPath)) {
  console.error(`\nERROR: File not found at: ${credPath}`);
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(fs.readFileSync(credPath, 'utf8'));
} catch (e) {
  console.error('\nERROR: Could not parse JSON:', e.message);
  process.exit(1);
}

const requiredFields = ['type', 'project_id', 'private_key', 'client_email'];
const missing = requiredFields.filter(f => !serviceAccount[f]);
if (missing.length) {
  console.error('\nERROR: Service account JSON is missing fields:', missing.join(', '));
  process.exit(1);
}

console.log('\nService account JSON looks valid:');
console.log('  type        :', serviceAccount.type);
console.log('  project_id  :', serviceAccount.project_id);
console.log('  client_email:', serviceAccount.client_email);

// Try initialising firebase-admin
let admin;
try {
  admin = require('firebase-admin');
} catch (e) {
  console.error('\nERROR: firebase-admin is not installed:', e.message);
  process.exit(1);
}

try {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  console.log('\nFirebase Admin SDK initialised successfully.');
  console.log('  App name:', admin.app().name);
  console.log('\nAll checks passed. Safe to restart PM2.');
  process.exit(0);
} catch (e) {
  console.error('\nERROR: firebase-admin failed to initialise:', e.message);
  process.exit(1);
}
