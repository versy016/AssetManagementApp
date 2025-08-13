// Deep linking configuration for the app
import * as Linking from 'expo-linking';

// Define the URL scheme for your app
const prefix = Linking.createURL('/');

// Configuration for deep linking
export const linking = {
  // Prefixes for deep linking
  prefixes: [
    prefix,
    'assetmanager://', // Custom URL scheme
    'https://ec2-3-25-81-127.ap-southeast-2.compute.amazonaws.com', // Your domain
  ],
  
  // Map URL paths to app screens
  config: {
    screens: {
      // Handle check-in deep links
      'check-in': {
        path: 'check-in/:id',
        parse: {
          id: (id) => `${id}`,
        },
      },
      // Add other screens as needed
    },
  },
};

// Function to generate a deep link URL
export function generateDeepLink(path, params = {}) {
  // If it's a web URL, use the full domain
  if (path.startsWith('http')) {
    return path;
  }
  
  // For app deep links
  const baseUrl = `assetmanager://app${path.startsWith('/') ? '' : '/'}${path}`;
  const queryParams = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
    
  return queryParams ? `${baseUrl}?${queryParams}` : baseUrl;
}

// Function to handle incoming links
export async function handleIncomingLink(url) {
  if (!url) return null;
  
  // Parse the URL
  const parsed = Linking.parse(url);
  
  // Handle different types of links
  if (parsed.path?.startsWith('/check-in/')) {
    const assetId = parsed.path.split('/').pop();
    return {
      route: 'check-in',
      params: { id: assetId },
    };
  }
  
  return null;
}
