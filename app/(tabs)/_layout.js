// _layout.js - Tab navigation layout — Bold Industrial design
import { Tabs } from 'expo-router';
import { Platform, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TourTarget } from '../../components/TourGuide';
import { useTasksCount } from '../../contexts/TasksCountContext';

export const unstable_settings = {
  initialRouteName: 'dashboard',
  showDebugTools: false,
};

export default function TabsLayout() {
  const isWeb = Platform.OS === 'web';
  const { taskCount } = useTasksCount();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#EA580C',       // Orange accent active
        tabBarInactiveTintColor: '#A8A29E',      // Muted stone inactive
        tabBarStyle: isWeb
          ? { display: 'none' }
          : {
              position: 'relative',
              backgroundColor: '#1E293B',        // Navy background
              borderTopWidth: 0,
              height: 60,
              paddingBottom: 6,
              paddingTop: 6,
            },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '700',
          letterSpacing: 0.3,
          textTransform: 'uppercase',
        },
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="Inventory"
        options={{
          title: 'Inventory',
          tabBarIcon: ({ color, size }) => (
            <TourTarget id="nav-inventory-tab">
              <Ionicons name="cube" size={size} color={color} />
            </TourTarget>
          ),
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'Work',
          tabBarBadge: taskCount > 0 ? (taskCount > 99 ? '99+' : taskCount) : undefined,
          tabBarBadgeStyle: {
            backgroundColor: '#EA580C',
            color: '#FFFFFF',
            fontSize: 10,
            fontWeight: '800',
            minWidth: 18,
            height: 18,
            borderRadius: 9,
          },
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="construct" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
