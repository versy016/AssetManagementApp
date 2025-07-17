// setAdmin.js
const admin = require('firebase-admin');
const serviceAccount = require('../config/assetmanager-dev-3a7cf-firebase-adminsdk-fbsvc-221bff9e42.json'); // adjust the path as needed
// Initialize the Admin SDK – ensure your service account key is set up
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const uid = 'JbULykmflZgAVw0KnlKvx1j6VOe2'; // Replace with your Firebase user's UID

admin.auth().setCustomUserClaims(uid, { admin: true })
  .then(() => {
    console.log(`Custom claims set for user ${uid}: { admin: true }`);
  })
  .catch((error) => {
    console.error('Error setting custom claims:', error);
  });
