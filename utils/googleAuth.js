// // utils/googleAuth.js
// import * as Google from 'expo-auth-session/providers/google';
// import { signInWithCredential, GoogleAuthProvider } from 'firebase/auth';
// import { collection, getDocs, getFirestore } from 'firebase/firestore';
// import { auth } from '../../firebaseConfig';

// const db = getFirestore();

// export async function signInWithGoogleAsync() {
//   try {
//     const [request, response, promptAsync] = Google.useAuthRequest({
//       expoClientId: 'YOUR_EXPO_CLIENT_ID',
//       iosClientId: 'YOUR_IOS_CLIENT_ID',
//       androidClientId: 'YOUR_ANDROID_CLIENT_ID',
//       webClientId: 'YOUR_WEB_CLIENT_ID',
//     });

//     const result = await promptAsync();
//     if (result?.type !== 'success') return { error: 'Google sign-in cancelled' };

//     const { id_token, email } = result.authentication;
//     const domain = email.split('@')[1]?.toLowerCase();

//     // Fetch allowed domains from Firestore
//     const snapshot = await getDocs(collection(db, 'allowedDomains'));
//     const allowedDomains = snapshot.docs.map((doc) => doc.id);

//     if (!allowedDomains.includes(domain)) {
//       return { error: `The domain ${domain} is not allowed.` };
//     }

//     const credential = GoogleAuthProvider.credential(id_token);
//     const userCred = await signInWithCredential(auth, credential);

//     return { user: userCred.user };

//   } catch (err) {
//     console.error('Google Sign-In Error:', err);
//     return { error: err.message };
//   }
// }
