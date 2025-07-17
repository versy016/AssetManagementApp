// import React, { useRef } from 'react';
// import { TouchableOpacity, Text, Alert } from 'react-native';
// import { useRouter } from 'expo-router';
// import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
// import { auth } from '../firebaseConfig';
// import * as WebBrowser from 'expo-web-browser';
// import * as Google from 'expo-auth-session/providers/google';
// import { collection, getDocs, getFirestore } from 'firebase/firestore';

// WebBrowser.maybeCompleteAuthSession();

// const db = getFirestore();

// export default function GoogleSignInButton() {
//   const router = useRouter();
//   const isMountedRef = useRef(true);

//   const [request, response, promptAsync] = Google.useAuthRequest({
//     expoClientId: 'YOUR_EXPO_CLIENT_ID.apps.googleusercontent.com',
//     iosClientId: 'YOUR_IOS_CLIENT_ID.apps.googleusercontent.com',
//     androidClientId: 'YOUR_ANDROID_CLIENT_ID.apps.googleusercontent.com',
//     webClientId: 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com',
//   });

//   React.useEffect(() => {
//     isMountedRef.current = true;
//     return () => { isMountedRef.current = false; };
//   }, []);

//   React.useEffect(() => {
//     const signIn = async () => {
//       if (response?.type === 'success') {
//         const { id_token } = response.authentication;
//         const credential = GoogleAuthProvider.credential(id_token);

//         try {
//           const result = await signInWithCredential(auth, credential);
//           const email = result.user.email;
//           const domain = email.split('@')[1]?.toLowerCase();

//           const snapshot = await getDocs(collection(db, 'allowedDomains'));
//           const allowedDomains = snapshot.docs.map((doc) => doc.id);

//           if (!allowedDomains.includes(domain)) {
//             Alert.alert('Unauthorized', `Domain ${domain} is not allowed.`);
//             await auth.signOut();
//             return;
//           }

//           if (isMountedRef.current) {
//             router.replace('/'); // or dashboard
//           }

//         } catch (error) {
//           Alert.alert('Error', error.message);
//         }
//       }
//     };

//     signIn();
//   }, [response]);

//   return (
//     <TouchableOpacity onPress={() => promptAsync()} disabled={!request}>
//       <Text style={{ color: '#1E90FF' }}>Sign in with Google</Text>
//     </TouchableOpacity>
//   );
// }
