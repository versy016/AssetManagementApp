// _layout.js - Tab navigation layout for the app's main sections
import { Tabs } from 'expo-router';
import { Platform, View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TourTarget } from '../../components/TourGuide';
import { useTasksCount } from '../../contexts/TasksCountContext';

// Optional settings for the router
export const unstable_settings = {
  initialRouteName: 'dashboard',
  showDebugTools: false,
};


// TabsLayout defines the bottom tab navigation for the app
export default function TabsLayout() {
  const isWeb = Platform.OS === 'web';
  const { taskCount } = useTasksCount();
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
            <TourTarget id="nav-inventory-tab">
              <Ionicons name="list-outline" size={size} color={color} />
            </TourTarget>
          ),
        }}
      />
      {/* Tasks tab (iOS & Android) */}
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'Tasks',
          tabBarIcon: ({ color, size }) => (
            <View style={{ position: 'relative' }}>
              <Ionicons name="checkbox-outline" size={size} color={color} />
              {taskCount > 0 && (
                <View
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -8,
                    minWidth: 16,
                    height: 16,
                    borderRadius: 8,
                    backgroundColor: '#E53935',
                    justifyContent: 'center',
                    alignItems: 'center',
                    paddingHorizontal: 4,
                  }}
                >
                  <Text
                    style={{
                      color: '#fff',
                      fontSize: 10,
                      fontWeight: '700',
                    }}
                    numberOfLines={1}
                  >
                    {taskCount > 99 ? '99+' : taskCount}
                  </Text>
                </View>
              )}
            </View>
          ),
        }}
      />
    </Tabs>
  );
}
