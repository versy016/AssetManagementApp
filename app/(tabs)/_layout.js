// _layout.js - Tab navigation layout for the app's main sections

// Import the Tabs component from Expo Router for tab navigation
import { Tabs } from 'expo-router';

// Optional settings for the router (unstable, may change in future Expo versions)
export const unstable_settings = {
  initialRouteName: 'dashboard',
  showDebugTools: false,
};

// TabsLayout defines the bottom tab navigation for the app
export default function TabsLayout() {
  return (
    // The Tabs component sets up the tab bar UI and navigation
    <Tabs screenOptions={{ tabBarActiveTintColor: '#1E90FF' }}>
      {/* Dashboard tab */}
      <Tabs.Screen
        name="dashboard"
        options={{ title: 'Dashboard' }}
      />
      {/* Inventory tab */}
      <Tabs.Screen
        name="Inventory"
        options={{ title: 'Inventory' }}
      />
    </Tabs>
  );
}
