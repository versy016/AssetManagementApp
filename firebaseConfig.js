import { initializeApp } from "firebase/app";
import { initializeAuth, getReactNativePersistence, getAuth } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const firebaseConfig = {
  apiKey: "AIzaSyAQxMG5LCi-WmT2tiwUFd1s6LWjkhHVHzs",
  authDomain: "assetmanager-dev-3a7cf.firebaseapp.com",
  projectId: "assetmanager-dev-3a7cf",
  storageBucket: "assetmanager-dev-3a7cf.appspot.com", // fixed .app typo
  messagingSenderId: "139545484846",
  appId: "1:139545484846:web:07701aa0f70b21cc7389bf",
  measurementId: "G-ZEEHL8Q0NP"
};

const app = initializeApp(firebaseConfig);

let auth;
if (Platform.OS === 'web') {
  auth = getAuth(app);
} else {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
}

export { auth };
export default app;
