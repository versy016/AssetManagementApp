// _layout.js - Tab navigation layout for the app's main sections
import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Optional settings for the router
export const unstable_settings = {
  initialRouteName: 'dashboard',
  showDebugTools: false,
};


// TabsLayout defines the bottom tab navigation for the app
export default function TabsLayout() {
  const isWeb = Platform.OS === 'web';
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#1E90FF',
        tabBarStyle: isWeb ? { display: 'none' } : { position: 'relative' },
        headerShown: false,
      }}
    >
      {/* Dashboard tab */}
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />      
      {/* Inventory tab */}
      <Tabs.Screen
        name="Inventory"
        options={{
          title: 'Inventory',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
