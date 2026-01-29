# Enable Email Authentication in Firebase

## Steps to Enable Email/Password Authentication

1. **Go to Firebase Console**
   - Visit: https://console.firebase.google.com/
   - Select your project: `assetmanager-dev-3a7cf`

2. **Navigate to Authentication**
   - Click on "Authentication" in the left sidebar
   - Click on the "Sign-in method" tab

3. **Enable Email/Password Provider**
   - Find "Email/Password" in the list of sign-in providers
   - Click on it to open settings
   - Toggle "Enable" to ON
   - Optionally enable "Email link (passwordless sign-in)" if needed
   - Click "Save"

4. **Verify Configuration**
   - The Email/Password provider should now show as "Enabled"
   - You should see a green checkmark or "Enabled" status

## Common Issues

### Error: "auth/operation-not-allowed"
This error occurs when Email/Password authentication is not enabled in Firebase Console. Follow the steps above to enable it.

### Error: "auth/email-already-in-use"
This is normal - it means the email is already registered. The app now shows a user-friendly message for this.

### Testing
After enabling, test registration and login:
- Try registering a new user with email/password
- Try logging in with existing credentials
- Check Firebase Console > Authentication > Users to see registered users

## Additional Notes

- The app code already supports email/password authentication
- Registration uses `createUserWithEmailAndPassword`
- Login uses `signInWithEmailAndPassword`
- Password reset functionality is available via the Forgot Password screen

