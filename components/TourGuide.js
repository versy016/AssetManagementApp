import React, { useState, useEffect, useRef, useContext, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  useWindowDimensions,
  ScrollView,
  Dimensions,
  Alert,
  Animated,
  Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth } from '../firebaseConfig';
import { onAuthStateChanged } from 'firebase/auth';
import { API_BASE_URL } from '../inventory-api/apiBase';

const TOUR_STORAGE_KEY = '@app_tour_completed_v2';

export const TourContext = React.createContext({
  startTour: () => { },
  stopTour: () => { },
  nextStep: () => { },
  goToStep: () => { },
  registerTarget: () => { },
  unregisterTarget: () => { },
  ensureVisible: () => { },
  currentStep: null,
  currentStepIndex: 0,
});

export function TourProvider({ children }) {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targets, setTargets] = useState({});
  const [stepStartTime, setStepStartTime] = useState(Date.now());
  const [scrollViewRef, setScrollViewRef] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  // Check admin status
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        if (!user) {
          setIsAdmin(false);
          return;
        }
        const res = await fetch(`${API_BASE_URL}/users/${user.uid}`);
        if (res.ok) {
          const dbUser = await res.json();
          setIsAdmin(dbUser?.role === 'ADMIN');
        } else {
          setIsAdmin(false);
        }
      } catch {
        setIsAdmin(false);
      }
    });
    return unsubscribe;
  }, []);

  // Common steps (same for all users)
  const commonSteps = [
    {
      id: 'qa-scan',
      route: '/(tabs)/dashboard',
      title: 'Scan Asset',
      description: 'Tap here to open the camera and scan an asset QR code for quick details or actions.',
      targetId: 'qa-scan',
      interaction: false,
    },
    {
      id: 'qa-multi',
      route: '/(tabs)/dashboard',
      title: 'Multi-Scan',
      description: 'Scan multiple assets in a row for batch check-in or check-out.',
      targetId: 'qa-multi',
      interaction: false,
    },
    {
      id: 'qa-search',
      route: '/(tabs)/dashboard',
      title: 'Search',
      description: 'Search for assets by name, ID, or serial number.',
      targetId: 'qa-search',
      interaction: false,
    },
    {
      id: 'qa-assets',
      route: '/(tabs)/dashboard',
      title: 'My Assets',
      description: 'View a list of all assets currently assigned to you.',
      targetId: 'qa-assets',
      interaction: false,
    },
    {
      id: 'qa-activity',
      route: '/(tabs)/dashboard',
      title: 'Activity',
      description: 'See recent activity logs and history for your assets.',
      targetId: 'qa-activity',
      interaction: false,
    },
    {
      id: 'qa-certs',
      route: '/(tabs)/dashboard',
      title: 'Certifications',
      description: 'View compliance and certification status for your equipment.',
      targetId: 'qa-certs',
      interaction: false,
    },
    {
      id: 'profile-btn',
      route: '/(tabs)/dashboard',
      title: 'Profile & Admin',
      description: 'Access your profile settings, Admin Console (if authorized), or logout here.',
      targetId: 'profile-btn',
      interaction: false,
    },
    {
      id: 'section-tasks',
      route: '/(tabs)/dashboard',
      title: 'Tasks',
      description: 'View upcoming maintenance, overdue items, and reminders requiring your attention.',
      targetId: 'section-tasks',
      interaction: false,
    },
    {
      id: 'section-shortcuts',
      route: '/(tabs)/dashboard',
      title: 'Shortcuts',
      description: 'Create custom shortcuts for frequent actions or asset lists.',
      targetId: 'section-shortcuts',
      interaction: true,
    },
  ];

  // Admin-specific steps (create type and create asset)
  const adminSteps = [
    {
      id: 'dashboard-nav-inventory',
      route: '/(tabs)/dashboard',
      title: 'Go to Inventory',
      description: Platform.OS === 'web'
        ? 'Now, let\'s manage your inventory. Click the "Inventory" link in the navigation bar.'
        : 'Now, let\'s manage your inventory. Tap the "Inventory" tab at the bottom right.',
      targetId: 'nav-inventory-tab',
      interaction: true,
      action: () => router.push('/Inventory?tab=types'),
    },
    {
      id: 'inventory-create-type',
      route: '/(tabs)/Inventory',
      title: 'Asset Types',
      description: 'This is the Asset Types tab. Tap the + button to create a new Asset Type category.',
      targetId: 'btn-manage-types',
      interaction: false,
      action: () => router.push('/type/new'),
    },
    {
      id: 'type-name-image',
      route: '/type/new',
      title: 'Name & Image',
      description: 'Enter a name for your asset type (e.g. "Laptop", "Vehicle") and optionally pick an image to represent this category.',
      targetId: 'type-name-image',
      interaction: true,
    },
    {
      id: 'type-defaults',
      route: '/type/new',
      title: 'Default Fields',
      description: 'Review the default fields that are included with every asset.',
      targetId: 'type-defaults',
      interaction: false,
    },
    {
      id: 'type-library',
      route: '/type/new',
      title: 'Field Library',
      description: 'Select common fields from the library or add your own custom fields below.',
      targetId: 'type-library',
      interaction: true,
    },
    {
      id: 'type-custom-fields',
      route: '/type/new',
      title: 'Custom Fields',
      description: 'You can also create your own custom fields. Tap "+ Add Field" to add a field with a custom name and type.',
      targetId: 'type-custom-fields',
      interaction: true,
    },
    {
      id: 'type-save',
      route: '/type/new',
      title: 'Save Asset Type',
      description: 'Tap "Create Asset Type" to save. We\'ll simulate this for the tour.',
      targetId: 'type-save',
      interaction: true,
      action: () => {
        // Navigate to Inventory (All Assets tab) for the next step
        router.replace({ pathname: '/Inventory', params: { tab: 'all' } });
      },
    },
    {
      id: 'inventory-create-asset',
      route: '/(tabs)/Inventory',
      title: 'Add New Asset',
      description: 'You are now in the "All Assets" tab. Tap the + button to add a new asset.',
      targetId: 'btn-add-asset',
      interaction: false,
      action: () => router.push('/asset/new'),
    },
    {
      id: 'asset-id',
      route: '/asset/new',
      title: 'Asset ID',
      description: 'Scan a QR code or manually enter an Asset ID.',
      targetId: 'asset-id',
      interaction: false,
    },
    {
      id: 'asset-type',
      route: '/asset/new',
      title: 'Select Type',
      description: 'Choose the Asset Type you created (or any other type).',
      targetId: 'asset-type',
      interaction: true,
    },
    {
      id: 'asset-details',
      route: '/asset/new',
      title: 'Enter Details',
      description: 'Fill in all the asset details: Serial Number, Model, Description, Status, Assign User, and add a photo if needed.',
      targetId: 'asset-details',
      interaction: true,
    },
    {
      id: 'asset-save',
      route: '/asset/new',
      title: 'Create Asset',
      description: 'Once you\'ve filled in all the details, tap "Create Asset" to finish.',
      targetId: 'asset-save',
      interaction: true,
      action: () => {
        // Mark tour as done first so it doesn't pop up again
        AsyncStorage.setItem(TOUR_STORAGE_KEY, 'true');
        // Show completion message then navigate
        Alert.alert('Tour Finished', 'You are all set! Explore the app to learn more.', [
          {
            text: 'OK', onPress: () => {
              router.replace('/(tabs)/dashboard');
            }
          }
        ]);
      },
    },
  ];

  // Basic user-specific steps (view types and view assets)
  const basicUserSteps = [
    {
      id: 'dashboard-nav-inventory',
      route: '/(tabs)/dashboard',
      title: 'Go to Inventory',
      description: Platform.OS === 'web'
        ? 'Now, let\'s explore your inventory. Click the "Inventory" link in the navigation bar.'
        : 'Now, let\'s explore your inventory. Tap the "Inventory" tab at the bottom right.',
      targetId: 'nav-inventory-tab',
      interaction: true,
      action: () => router.push('/Inventory?tab=types'),
    },
    {
      id: 'inventory-types-tab',
      route: '/(tabs)/Inventory',
      title: 'Asset Types Tab',
      description: 'This is the "Asset Types" tab. Here you can see all asset types in your inventory. Each type shows how many assets are in service, end of life, and more.',
      targetId: 'tab-asset-types',
      interaction: false,
    },
    {
      id: 'inventory-first-type',
      route: '/(tabs)/Inventory',
      title: 'Asset Type Example',
      description: 'This is an example asset type. Tap on any type card to view its details and see all assets of that type.',
      targetId: 'first-asset-type',
      interaction: false,
    },
    {
      id: 'inventory-view-assets-tab',
      route: '/(tabs)/Inventory',
      title: 'All Assets Tab',
      description: 'Switch to the "All Assets" tab to browse all assets. Tap on any asset to view its full details.',
      targetId: 'tab-all-assets',
      interaction: true,
      action: () => router.push('/Inventory?tab=all'),
    },
    {
      id: 'inventory-first-asset',
      route: '/(tabs)/Inventory',
      title: 'Asset Example',
      description: 'This is an example asset. Tap on any asset card to view its complete details, status, assigned user, and more information.',
      targetId: 'first-asset',
      interaction: false,
    },
    {
      id: 'basic-user-complete',
      route: '/(tabs)/Inventory',
      title: 'Tour Complete',
      description: 'You\'re all set! You can now explore asset types and assets.',
      targetId: 'btn-add-asset',
      interaction: false,
      action: () => {
        // Mark tour as done first so it doesn't pop up again
        AsyncStorage.setItem(TOUR_STORAGE_KEY, 'true');
        // Show completion message then navigate
        Alert.alert('Tour Finished', 'You are all set! Explore the app to learn more.', [
          {
            text: 'OK', onPress: () => {
              router.replace('/(tabs)/dashboard');
            }
          }
        ]);
      },
    },
  ];

  const TOUR_STEPS = useMemo(() => {
    // Web-specific tour steps (completely different from mobile)
    if (Platform.OS === 'web') {
      // Web tour starts with Dashboard (Search) showing all features
      const webSearchSteps = [
        {
          id: 'web-search-intro',
          route: '/(tabs)/dashboard',
          title: 'Dashboard - Search',
          description: 'Welcome! This is the Dashboard where you can search for assets. The search bar allows you to find assets by name, ID, or serial number.',
          targetId: 'web-search-input',
          interaction: false,
        },
        {
          id: 'web-search-filters',
          route: '/(tabs)/dashboard',
          title: 'Filters',
          description: 'Click the filter button to filter assets by type, status, location, assigned user, and more. You can also filter by "Only Mine", "Due Soon", and other options.',
          targetId: 'web-search-filter-btn',
          interaction: true,
        },
        {
          id: 'web-search-sort',
          route: '/(tabs)/dashboard',
          title: 'Sorting',
          description: 'Click the sort button to sort results by relevance, last updated, name, service due date, status, asset type, location, assigned user, or asset ID.',
          targetId: 'web-search-sort-btn',
          interaction: true,
        },
        {
          id: 'web-search-view-mode',
          route: '/(tabs)/dashboard',
          title: 'View Mode',
          description: 'Switch between list view (table) and grid view (cards) to see your assets in different formats.',
          targetId: 'web-search-view-mode',
          interaction: true,
        },
        {
          id: 'web-search-pagination',
          route: '/(tabs)/dashboard',
          title: 'Pagination',
          description: 'Use pagination controls to navigate through multiple pages of results. You can adjust the page size (25, 50, 100, or all).',
          targetId: 'web-search-pagination',
          interaction: false,
        },
      ];

      const webCommonSteps = [
        ...webSearchSteps,
        {
          id: 'web-tasks-nav',
          route: '/(tabs)/dashboard',
          title: 'My Tasks',
          description: 'Click "My Tasks" in the navigation bar to see all your pending tasks and reminders.',
          targetId: 'web-nav-tasks',
          interaction: true,
          action: () => router.push('/(tabs)/dashboard?view=tasks'),
        },
        {
          id: 'web-tasks-overview',
          route: '/(tabs)/dashboard?view=tasks',
          title: 'Tasks Overview',
          description: 'Here you can see all your tasks: maintenance reminders, overdue items, and items requiring your attention. Swipe or use arrows to navigate between tasks, and tap "Action Task" to complete them.',
          targetId: 'section-tasks',
          interaction: false,
        },
        {
          id: 'web-activity-nav',
          route: '/(tabs)/dashboard',
          title: 'Activity',
          description: 'Click "Activity" in the navigation bar to see recent activity logs and history for your assets.',
          targetId: 'web-nav-activity',
          interaction: true,
          action: () => router.push('/activity'),
        },
        {
          id: 'web-activity-overview',
          route: '/activity',
          title: 'Activity Feed',
          description: 'This is the Activity feed showing all asset actions, notes, and changes in chronological order. You can see transfers, check-ins, status changes, and more.',
          targetId: 'web-activity-feed',
          interaction: false,
        },
        {
          id: 'web-activity-filters',
          route: '/activity',
          title: 'Filters & Sort',
          description: 'Use the Filters button to filter activities by type (Transfer, Check-in, etc.), asset type, status, or date range. Use Sort to change the order of activities.',
          targetId: 'web-activity-filters',
          interaction: true,
          action: () => router.push('/certs'),
        },
        {
          id: 'web-certs-nav',
          route: '/certs',
          title: 'Certifications',
          description: "You're now on the Certifications page. Use the Certs link in the navigation bar anytime to view compliance and certification status for your equipment.",
          targetId: 'web-nav-certs',
          interaction: false,
        },
        {
          id: 'web-certs-overview',
          route: '/certs',
          title: 'Certificates Overview',
          description: 'Here you can view all certificates and documents for your assets. Each certificate shows the document type, related date, assigned user, and expiration status. Certificates are typically created when you upload documents to assets.',
          targetId: 'web-certs-list',
          interaction: false,
        },
        {
          id: 'web-certs-search',
          route: '/certs',
          title: 'Search & Quick Filters',
          description: 'Use the search bar to find certificates by asset name, type, or model. Use quick filter chips like "My documents", "Expiring soon", or "Expired" to quickly filter certificates.',
          targetId: 'web-certs-search',
          interaction: false,
        },
        {
          id: 'web-certs-filters',
          route: '/certs',
          title: 'Advanced Filters',
          description: 'Click the Filters button to access advanced filtering options. You can filter by document type, assigned user, expiration status, and date range. This helps you find specific certificates quickly.',
          targetId: 'web-certs-filters',
          interaction: true,
          action: () => router.push('/Inventory?tab=types'),
        },
      ];

      // Web admin steps
      const webAdminSteps = [
        ...webCommonSteps,
        {
          id: 'web-nav-inventory',
          route: '/(tabs)/dashboard',
          title: 'Inventory',
          description: 'Click "Inventory" in the navigation bar to manage your asset types and assets. As an admin, you can create new types and assets.',
          targetId: 'nav-inventory-tab',
          interaction: true,
          action: () => router.push('/Inventory?tab=types'),
        },
        {
          id: 'web-inventory-overview',
          route: '/Inventory',
          title: 'Inventory Overview',
          description: 'This is the Inventory section. You can see two tabs: "Asset Types" and "All Assets". Asset Types are categories like "Laptop" or "Vehicle". Each type shows how many assets are in service, end of life, and more. Click the + button to create a new Asset Type.',
          targetId: 'tab-asset-types',
          interaction: false,
        },
        {
          id: 'inventory-create-type',
          route: '/Inventory',
          title: 'Create Asset Type',
          description: 'Click the + button to create a new Asset Type category.',
          targetId: 'btn-manage-types',
          interaction: false,
          action: () => router.push('/type/new'),
        },
        {
          id: 'type-name-image',
          route: '/type/new',
          title: 'Name & Image',
          description: 'Enter a name for your asset type and optionally pick an image to represent this category.',
          targetId: 'type-name-image',
          interaction: true,
        },
        {
          id: 'type-defaults',
          route: '/type/new',
          title: 'Default Fields',
          description: 'Review the default fields that are included with every asset.',
          targetId: 'type-defaults',
          interaction: false,
        },
        {
          id: 'type-library',
          route: '/type/new',
          title: 'Field Library',
          description: 'Select common fields from the library or add your own custom fields below.',
          targetId: 'type-library',
          interaction: true,
        },
        {
          id: 'type-custom-fields',
          route: '/type/new',
          title: 'Custom Fields',
          description: 'You can also create your own custom fields. Click "+ Add Field" to add a field with a custom name and type.',
          targetId: 'type-custom-fields',
          interaction: true,
        },
        {
          id: 'type-save',
          route: '/type/new',
          title: 'Save Asset Type',
          description: 'Click "Create Asset Type" to save.',
          targetId: 'type-save',
          interaction: true,
          action: () => {
            router.replace({ pathname: '/Inventory', params: { tab: 'all' } });
          },
        },
        {
          id: 'inventory-view-all-assets',
          route: '/Inventory',
          title: 'All Assets Tab',
          description: 'Switch to the "All Assets" tab to see all assets in your inventory. You can search, filter, and view details for each asset.',
          targetId: 'tab-all-assets',
          interaction: true,
          action: () => router.push('/Inventory?tab=all'),
        },
        {
          id: 'inventory-create-asset',
          route: '/Inventory',
          title: 'Add New Asset',
          description: 'You are now in the "All Assets" tab. Click the + button to add a new asset.',
          targetId: 'btn-add-asset',
          interaction: false,
          action: () => router.push('/asset/new'),
        },
        {
          id: 'asset-id',
          route: '/asset/new',
          title: 'Asset ID',
          description: 'Scan a QR code or manually enter an Asset ID.',
          targetId: 'asset-id',
          interaction: false,
        },
        {
          id: 'asset-type',
          route: '/asset/new',
          title: 'Select Type',
          description: 'Choose the Asset Type you created (or any other type).',
          targetId: 'asset-type',
          interaction: true,
        },
        {
          id: 'asset-details',
          route: '/asset/new',
          title: 'Enter Details',
          description: 'Fill in all the asset details: Serial Number, Model, Description, Status, Assign User, and add a photo if needed.',
          targetId: 'asset-details',
          interaction: true,
        },
        {
          id: 'asset-save',
          route: '/asset/new',
          title: 'Create Asset',
          description: 'Once you\'ve filled in all the details, click "Create Asset" to finish.',
          targetId: 'asset-save',
          interaction: true,
          action: () => router.push('/(tabs)/dashboard'),
        },
        {
          id: 'web-admin-controls-nav',
          route: '/(tabs)/dashboard',
          title: 'Admin Controls',
          description: 'Click "Admin Controls" in the navigation bar to access administrative features like managing user roles and generating QR codes.',
          targetId: 'web-nav-admin',
          interaction: true,
          action: () => router.push('/admin'),
        },
        {
          id: 'web-admin-roles-tab',
          route: '/admin',
          title: 'Manage User Roles',
          description: 'This is the "Manage Roles" tab. Here you can promote users to Admin or demote them to regular users by entering their email address.',
          targetId: 'web-admin-roles-tab',
          interaction: false,
        },
        {
          id: 'web-admin-promote',
          route: '/admin',
          title: 'Promote User',
          description: 'Enter a user\'s email address and click "Promote to Admin" to grant them administrative privileges. You can also demote admins back to regular users.',
          targetId: 'web-admin-promote-btn',
          interaction: true,
        },
        {
          id: 'web-admin-qr-tab',
          route: '/admin',
          title: 'Generate QR Codes',
          description: 'Switch to the "Generate QR" tab to create an Excel sheet with unique Asset IDs and QR codes for new assets.',
          targetId: 'web-admin-qr-tab',
          interaction: true,
        },
        {
          id: 'web-admin-qr-generate',
          route: '/admin',
          title: 'Generate QR Codes Excel',
          description: 'Enter the number of QR codes you want to generate (up to 2000) and click "Generate Excel" to create a spreadsheet with Asset IDs and QR code images.',
          targetId: 'web-admin-qr-generate-btn',
          interaction: true,
        },
        {
          id: 'web-admin-qr-download',
          route: '/admin',
          title: 'Download QR Codes',
          description: 'After generating, click "Download Excel" to get your sheet of Asset IDs and QR codes. You can use these QR codes to label physical assets.',
          targetId: 'web-admin-qr-download-btn',
          interaction: false,
        },
        {
          id: 'web-profile',
          route: '/(tabs)/dashboard',
          title: 'Profile',
          description: 'Click "Profile" in the navigation bar to access your account settings and preferences, or to restart the tour.',
          targetId: 'web-nav-profile',
          interaction: false,
        },
        {
          id: 'admin-tour-complete',
          route: '/(tabs)/dashboard',
          title: 'Tour Complete',
          description: 'You\'re all set! You\'ve learned how to search assets, manage inventory, create asset types and assets, and use admin controls. Explore the app to discover more features!',
          targetId: 'web-nav-profile',
          interaction: false,
          action: () => {
            AsyncStorage.setItem(TOUR_STORAGE_KEY, 'true');
            Alert.alert('Tour Finished', 'You are all set! Explore the app to learn more.', [
              {
                text: 'OK', onPress: () => {
                  router.replace('/(tabs)/dashboard');
                }
              }
            ]);
          },
        },
      ];

      // Web basic user steps
      const webBasicUserSteps = [
        ...webCommonSteps,
        {
          id: 'web-nav-inventory',
          route: '/(tabs)/dashboard',
          title: 'Inventory',
          description: 'Click "Inventory" to view your asset types and assets.',
          targetId: 'nav-inventory-tab',
          interaction: true,
          action: () => router.push('/Inventory?tab=types'),
        },
        {
          id: 'inventory-types-tab',
          route: '/Inventory',
          title: 'Asset Types Tab',
          description: 'This is the "Asset Types" tab. Here you can see all asset types in your inventory.',
          targetId: 'tab-asset-types',
          interaction: false,
        },
        {
          id: 'inventory-first-type',
          route: '/Inventory',
          title: 'Asset Type Example',
          description: 'This is an example asset type. Click on any type card to view its details and see all assets of that type.',
          targetId: 'first-asset-type',
          interaction: false,
        },
        {
          id: 'inventory-view-assets-tab',
          route: '/Inventory',
          title: 'All Assets Tab',
          description: 'Switch to the "All Assets" tab to browse all assets. Click on any asset to view its full details.',
          targetId: 'tab-all-assets',
          interaction: true,
          action: () => router.push('/Inventory?tab=all'),
        },
        {
          id: 'inventory-first-asset',
          route: '/Inventory',
          title: 'Asset Example',
          description: 'This is an example asset. Click on any asset card to view its complete details, status, assigned user, and more information.',
          targetId: 'first-asset',
          interaction: false,
        },
        {
          id: 'web-profile',
          route: '/(tabs)/dashboard',
          title: 'Profile',
          description: 'Click "Profile" to access your account settings and preferences.',
          targetId: 'web-nav-profile',
          interaction: false,
        },
        {
          id: 'basic-user-complete',
          route: '/(tabs)/Inventory',
          title: 'Tour Complete',
          description: 'You\'re all set! You can now explore asset types and assets.',
          targetId: 'first-asset',
          interaction: false,
          action: () => {
            AsyncStorage.setItem(TOUR_STORAGE_KEY, 'true');
            Alert.alert('Tour Finished', 'You are all set! Explore the app to learn more.', [
              {
                text: 'OK', onPress: () => {
                  router.replace('/(tabs)/dashboard');
                }
              }
            ]);
          },
        },
      ];

      return isAdmin ? webAdminSteps : webBasicUserSteps;
    }

    // Mobile tour steps (existing)
    return isAdmin
      ? [...commonSteps, ...adminSteps]
      : [...commonSteps, ...basicUserSteps];
  }, [isAdmin, router]);

  useEffect(() => {
    if (active && currentStep) {
      setStepStartTime(Date.now());
    }
  }, [stepIndex, active]);

  useEffect(() => {
    if (!active) return;
    const currentStep = TOUR_STEPS[stepIndex];
    if (!currentStep) return;
    const normalize = (p) => (p || '').replace(/\/$/, '').replace(/\(tabs\)\/?/, '').toLowerCase();
    const normPath = normalize(pathname);
    const normStepRoute = normalize(currentStep.route);

    if (!normPath.includes(normStepRoute) && !normStepRoute.includes(normPath)) {
      const nextStepIndex = stepIndex + 1;
      if (nextStepIndex < TOUR_STEPS.length) {
        const nextStep = TOUR_STEPS[nextStepIndex];
        const normNextRoute = normalize(nextStep.route);
        if (normPath.includes(normNextRoute) || normNextRoute.includes(normPath)) {
          setStepIndex(nextStepIndex);
        }
      }
    }
  }, [pathname, active, stepIndex, TOUR_STEPS]);

  const startTour = useCallback(() => {
    setStepIndex(0);
    setActive(true);
  }, []);

  const stopTour = useCallback(async () => {
    setActive(false);
    await AsyncStorage.setItem(TOUR_STORAGE_KEY, 'true');
  }, []);

  const nextStep = useCallback(() => {
    const step = TOUR_STEPS[stepIndex];
    // Execute action if present (navigation, etc.)
    if (step && step.action) {
      step.action();
    }
    // Advance to next step
    if (stepIndex < TOUR_STEPS.length - 1) {
      setStepIndex(prev => prev + 1);
      setStepStartTime(Date.now()); // Reset step timer for new step
    } else {
      stopTour();
    }
  }, [stepIndex, TOUR_STEPS, stopTour]);

  const goToStep = useCallback((index) => {
    setStepIndex(index);
  }, []);

  const registerTarget = useCallback((id, ref) => {
    if (!ref) return;
    const measure = () => {
      try {
        if (Platform.OS === 'web') {
          // On web, React Native Web refs point to the DOM element
          const element = ref;
          // Try multiple ways to get the DOM node for React Native Web
          let domNode = element;
          if (element && typeof element === 'object') {
            // React Native Web stores the DOM node in _nativeNode or directly
            domNode = element._nativeNode || element.current?._nativeNode || element;
          }

          // If it's already a DOM element, use it directly
          if (domNode && typeof domNode.getBoundingClientRect === 'function') {
            try {
              const rect = domNode.getBoundingClientRect();
              if (rect && rect.width > 0 && rect.height > 0) {
                // On web, use viewport coordinates (getBoundingClientRect returns viewport-relative)
                // The overlay uses position: fixed, so it's also viewport-relative
                setTargets(prev => ({
                  ...prev,
                  [id]: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
                }));
              }
            } catch (e) {
              console.warn('TourGuide: Error getting bounding rect on web', id, e);
            }
          } else if (typeof window !== 'undefined' && domNode && domNode.nodeType === 1) {
            // Fallback: if it's a DOM node, try to access getBoundingClientRect
            try {
              const rect = domNode.getBoundingClientRect();
              if (rect && rect.width > 0 && rect.height > 0) {
                setTargets(prev => ({
                  ...prev,
                  [id]: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
                }));
              }
            } catch (e) {
              console.warn('TourGuide: Could not measure target on web', id, e);
            }
          }
        } else {
          ref.measure((x, y, width, height, pageX, pageY) => {
            if (width > 0 && height > 0 && pageX >= 0 && pageY >= 0) {
              setTargets(prev => ({
                ...prev,
                [id]: { x: pageX, y: pageY, width, height }
              }));
            }
          });
        }
      } catch (e) {
        console.warn('TourGuide: Failed to measure target', id, e);
      }
    };
    setTimeout(measure, 50);
    const interval = setInterval(measure, active ? 100 : 500);
    return () => clearInterval(interval);
  }, [active]);

  const unregisterTarget = useCallback((id) => {
    setTargets(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const currentStep = active ? TOUR_STEPS[stepIndex] : null;

  // Reset stepStartTime when stepIndex changes
  useEffect(() => {
    if (active && currentStep) {
      setStepStartTime(Date.now());
    }
  }, [stepIndex, active, currentStep?.id]);

  const normalizeRoute = (route) => {
    if (!route) return '';
    // Remove query parameters and hash
    const withoutQuery = route.split('?')[0].split('#')[0];
    return withoutQuery.replace(/\(tabs\)\/?/g, '').replace(/\/$/, '').toLowerCase().trim();
  };

  const isRouteMatch = currentStep && (() => {
    if (!pathname || !currentStep.route) return false;
    const normPath = normalizeRoute(pathname);
    const normStepRoute = normalizeRoute(currentStep.route);
    // Also check if the route matches with query params
    const pathWithoutQuery = pathname.split('?')[0].split('#')[0];
    const stepRouteWithoutQuery = currentStep.route.split('?')[0].split('#')[0];
    const normPathNoQuery = normalizeRoute(pathWithoutQuery);
    const normStepNoQuery = normalizeRoute(stepRouteWithoutQuery);

    // Match exact routes, or if one contains the other
    const matches = normPath === normStepRoute ||
      normPath.includes(normStepRoute) ||
      normStepRoute.includes(normPath) ||
      normPathNoQuery === normStepNoQuery ||
      normPathNoQuery.includes(normStepNoQuery) ||
      normStepNoQuery.includes(normPathNoQuery) ||
      // Handle /activity and /certs routes
      (pathname === '/activity' && currentStep.route === '/activity') ||
      (pathname === '/certs' && currentStep.route === '/certs') ||
      (pathname.includes('/activity') && currentStep.route.includes('/activity')) ||
      (pathname.includes('/certs') && currentStep.route.includes('/certs')) ||
      // Handle /Inventory routes (case-insensitive)
      (pathname.toLowerCase().includes('/inventory') && currentStep.route.toLowerCase().includes('/inventory')) ||
      (pathname.toLowerCase() === '/inventory' && currentStep.route.toLowerCase().includes('inventory')) ||
      // Handle /admin routes
      (pathname === '/admin' && currentStep.route === '/admin') ||
      (pathname.includes('/admin') && currentStep.route.includes('/admin')) ||
      // Handle dashboard routes more leniently - match if step route is dashboard and current path is dashboard, root, or search
      (currentStep.route === '/(tabs)/dashboard' && (pathname === '/' || pathname === '/dashboard' || pathname.includes('/dashboard') || pathname === '/search'));

    return matches;
  })();

  const currentTarget = (isRouteMatch && currentStep) ? targets[currentStep.targetId] : null;
  const hasValidTarget = currentTarget &&
    currentTarget.width > 0 &&
    currentTarget.height > 0 &&
    currentTarget.x >= 0 &&
    currentTarget.y >= 0;

  const stepAge = Date.now() - stepStartTime;
  // Give more time for targets to be measured, especially for off-screen elements that need scrolling
  // Increase threshold for Activity, Certs, Inventory, and Admin to allow navigation to complete
  const needsNavigation = currentStep && (currentStep.route === '/activity' || currentStep.route === '/certs' || currentStep.route === '/admin' ||
    currentStep.route.includes('/activity') || currentStep.route.includes('/certs') || currentStep.route.includes('/admin') ||
    currentStep.route.toLowerCase().includes('/inventory') || currentStep.route.toLowerCase().includes('inventory'));
  const ageThreshold = needsNavigation ? 2500 : 1500;
  // For dashboard routes, be more lenient with route matching to prevent tour from disappearing
  const isDashboardRoute = currentStep && (currentStep.route === '/(tabs)/dashboard' || currentStep.route.includes('dashboard'));
  // Show overlay if route matches and we have a valid target or enough time has passed
  // OR if it's a dashboard route and enough time has passed (to handle route matching edge cases)
  const shouldShowOverlay = active && currentStep && (
    (isRouteMatch && (hasValidTarget || stepAge > ageThreshold)) ||
    (isDashboardRoute && stepAge > 300) // Show overlay on dashboard routes even if route doesn't match exactly, after 300ms
  );

  const ensureVisible = useCallback((ref) => {
    setScrollViewRef(ref);
  }, []);

  const scrollToTarget = useCallback((target) => {
    if (!scrollViewRef || !target) return;
    try {
      if (Platform.OS === 'web') {
        // Web: Scroll the window to bring target into view
        // target.y is viewport-relative (from getBoundingClientRect)
        // We need to scroll the window so the target is visible
        if (typeof window !== 'undefined') {
          const windowHeight = Dimensions.get('window').height;
          const currentScrollY = window.scrollY;
          const targetAbsoluteY = target.y + currentScrollY;

          // Calculate desired scroll position (target should be 150px from top)
          const desiredScrollY = targetAbsoluteY - 150;

          if (target.y < 0 || target.y > windowHeight - 200) {
            // Target is off-screen, scroll to it
            window.scrollTo({ top: Math.max(0, desiredScrollY), behavior: 'smooth' });
          }
        }

        // Also try ScrollView if available (for nested scroll containers)
        if (scrollViewRef && typeof scrollViewRef.scrollTo === 'function') {
          try {
            const windowHeight = Dimensions.get('window').height;
            if (target.y > windowHeight - 200) {
              scrollViewRef.scrollToEnd({ animated: true });
            } else {
              scrollViewRef.scrollTo({ y: Math.max(0, target.y - 150), animated: true });
            }
          } catch (e) {
            // Ignore if ScrollView scroll fails
          }
        }
      } else {
        // Native: Measure the scroll view to get its height
        scrollViewRef.measure((x, y, width, height, pageX, pageY) => {
          // target.y is absolute page coordinate.
          // We need to convert it to relative scroll position.
          // But simplistic approach: check if target.y is "far down".

          // A better heuristic might be:
          // If target is below visible window, scroll to end.
          const windowHeight = Dimensions.get('window').height;
          if (target.y > windowHeight - 200) {
            scrollViewRef.scrollToEnd({ animated: true });
          } else {
            // Scroll to element, with some padding
            // Note: This assumes target.y is roughly correlated to scroll Y for simple layouts
            scrollViewRef.scrollTo({ y: Math.max(0, target.y - 150), animated: true });
          }
        });
      }
    } catch (e) {
      // Fallback if measure fails or not available
      if (target.y > 500) {
        if (scrollViewRef && typeof scrollViewRef.scrollToEnd === 'function') {
          scrollViewRef.scrollToEnd({ animated: true });
        }
      } else {
        if (scrollViewRef && typeof scrollViewRef.scrollTo === 'function') {
          scrollViewRef.scrollTo({ y: Math.max(0, target.y - 100), animated: true });
        }
      }
    }
  }, [scrollViewRef]);

  useEffect(() => {
    if (active && currentStep) {
      // If we have a target, scroll to it
      if (targets[currentStep.targetId]) {
        scrollToTarget(targets[currentStep.targetId]);
      } else {
        // Fallback: If no target found yet, and it's a "bottom" element like save, force scroll down
        // This is a bit hacky but helps when target isn't measured yet because it's off screen
        if (currentStep.targetId === 'type-save' || currentStep.targetId === 'asset-save' || currentStep.targetId === 'type-library' || currentStep.targetId === 'type-custom-fields' || currentStep.targetId === 'asset-details' || currentStep.targetId === 'section-shortcuts') {
          try {
            if (scrollViewRef) scrollViewRef.scrollToEnd({ animated: true });
          } catch (e) { }
        }
      }
    }
  }, [active, currentStep, targets, scrollToTarget, scrollViewRef]);

  const contextValue = useMemo(() => ({
    startTour,
    stopTour,
    nextStep,
    goToStep,
    registerTarget,
    unregisterTarget,
    ensureVisible,
    currentStep,
    currentStepIndex: stepIndex
  }), [startTour, stopTour, nextStep, goToStep, registerTarget, unregisterTarget, ensureVisible, currentStep, stepIndex]);

  return (
    <TourContext.Provider value={contextValue}>
      {children}
      {shouldShowOverlay && (
        <TourOverlay
          target={hasValidTarget ? currentTarget : null}
          step={currentStep}
          onNext={nextStep}
          onStop={stopTour}
          totalSteps={TOUR_STEPS.length}
          currentStepIndex={stepIndex}
          targetNotFound={!hasValidTarget}
          stepAge={stepAge}
        />
      )}
    </TourContext.Provider>
  );
}

export function TourTarget({ id, children, style }) {
  const { registerTarget, unregisterTarget } = useContext(TourContext);
  const viewRef = useRef(null);

  useEffect(() => {
    if (viewRef.current) {
      // On web, ensure we can access the DOM node
      let targetRef = viewRef.current;
      if (Platform.OS === 'web') {
        // Try to get the underlying DOM node for React Native Web
        targetRef = viewRef.current?._nativeNode || viewRef.current?.current?._nativeNode || viewRef.current;
      }
      const cleanup = registerTarget(id, targetRef);
      return () => {
        if (cleanup) cleanup();
        unregisterTarget(id);
      };
    }
  }, [id, registerTarget, unregisterTarget]);

  return (
    <View
      ref={viewRef}
      style={style}
      collapsable={false}
    >
      {children}
    </View>
  );
}

function TourOverlay({ target, step, onNext, onStop, totalSteps, currentStepIndex, targetNotFound, stepAge }) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // Animated values for the hole
  const anim = useRef(new Animated.Value(0)).current; // 0 -> 1 for entry
  const animX = useRef(new Animated.Value(0)).current;
  const animY = useRef(new Animated.Value(0)).current;
  const animW = useRef(new Animated.Value(0)).current;
  const animH = useRef(new Animated.Value(0)).current;

  // Initialize on first render if target exists
  const firstRender = useRef(true);

  useEffect(() => {
    if (targetNotFound || !target) return;

    let effectiveTarget = { ...target };
    if (step.targetId === 'nav-inventory-tab') {
      const HIT_SLOP = 20;
      effectiveTarget.height = (windowHeight - effectiveTarget.y) + HIT_SLOP;
      effectiveTarget.y -= HIT_SLOP;
      effectiveTarget.height += HIT_SLOP;
      effectiveTarget.x -= HIT_SLOP;
      effectiveTarget.width += HIT_SLOP * 2;
    }

    // Add gentle padding to the highlight box for all targets
    // This helps "breathe" around buttons and inputs
    const PADDING = 4;
    effectiveTarget.x -= PADDING;
    effectiveTarget.y -= PADDING;
    effectiveTarget.width += (PADDING * 2);
    effectiveTarget.height += (PADDING * 2);

    // Optimize animations for web - use shorter duration and simpler easing
    const animationDuration = Platform.OS === 'web' ? 150 : 300;
    const animationEasing = Platform.OS === 'web' ? Easing.out(Easing.quad) : Easing.out(Easing.ease);

    if (firstRender.current) {
      animX.setValue(effectiveTarget.x);
      animY.setValue(effectiveTarget.y);
      animW.setValue(effectiveTarget.width);
      animH.setValue(effectiveTarget.height);
      firstRender.current = false;
      Animated.timing(anim, { toValue: 1, duration: animationDuration, useNativeDriver: false }).start();
    } else {
      Animated.parallel([
        Animated.timing(animX, { toValue: effectiveTarget.x, duration: animationDuration, useNativeDriver: false, easing: animationEasing }),
        Animated.timing(animY, { toValue: effectiveTarget.y, duration: animationDuration, useNativeDriver: false, easing: animationEasing }),
        Animated.timing(animW, { toValue: effectiveTarget.width, duration: animationDuration, useNativeDriver: false, easing: animationEasing }),
        Animated.timing(animH, { toValue: effectiveTarget.height, duration: animationDuration, useNativeDriver: false, easing: animationEasing }),
      ]).start();
    }
  }, [target, step, windowHeight]);

  if (targetNotFound || !target) {
    return (
      <View style={styles.overlayContainer} pointerEvents="box-none">
        <View style={[styles.dim, StyleSheet.absoluteFill]} />
        <View style={[styles.tooltip, { position: 'absolute', top: '50%', left: 20, right: 20, transform: [{ translateY: -100 }] }]}>
          <View style={styles.header}>
            <Text style={styles.title}>{step.title}</Text>
            <TouchableOpacity onPress={onStop}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.desc}>{step.description}</Text>
          {targetNotFound && stepAge > 2000 && currentStepIndex < totalSteps - 1 && (
            <Text style={[styles.desc, { color: '#FFA500', fontStyle: 'italic', marginTop: 8 }]}>
              Looking for target element...
            </Text>
          )}
          <View style={styles.footer}>
            <Text style={styles.pager}>{currentStepIndex + 1} / {totalSteps}</Text>
            <TouchableOpacity style={styles.nextBtn} onPress={onNext}>
              <Text style={styles.nextText}>
                {currentStepIndex === totalSteps - 1 ? 'Finish' : 'Next'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // Calculate effectiveTarget first (needed for both rectangles and tooltip)
  // Use const instead of let to avoid temporal dead zone issues
  const effectiveTarget = (() => {
    const et = { ...target };
    if (step.targetId === 'nav-inventory-tab') {
      const HIT_SLOP = 20;
      et.height = (windowHeight - et.y) + HIT_SLOP;
      et.y -= HIT_SLOP;
      et.height += HIT_SLOP;
      et.x -= HIT_SLOP;
      et.width += HIT_SLOP * 2;
    }
    // Add gentle padding to the highlight box for all targets
    const PADDING = 4;
    et.x -= PADDING;
    et.y -= PADDING;
    et.width += (PADDING * 2);
    et.height += (PADDING * 2);
    return et;
  })();

  // Calculate the 4 surrounding rectangles based on animated values
  const overlayColor = 'rgba(0, 0, 0, 0.3)'; // Light grey overlay

  // On web, use static values with CSS transitions for better performance
  // On native, use animated values
  const topRectStyle = Platform.OS === 'web'
    ? {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: effectiveTarget.y,
      backgroundColor: overlayColor,
      transition: 'height 0.15s ease-out',
    }
    : {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: animY,
      backgroundColor: overlayColor,
    };

  const bottomRectStyle = Platform.OS === 'web'
    ? {
      position: 'absolute',
      top: effectiveTarget.y + effectiveTarget.height,
      left: 0,
      right: 0,
      height: windowHeight * 2,
      backgroundColor: overlayColor,
      transition: 'top 0.15s ease-out',
    }
    : {
      position: 'absolute',
      top: Animated.add(animY, animH),
      left: 0,
      right: 0,
      height: windowHeight * 2,
      backgroundColor: overlayColor,
    };

  const leftRectStyle = Platform.OS === 'web'
    ? {
      position: 'absolute',
      top: effectiveTarget.y,
      left: 0,
      width: effectiveTarget.x,
      height: effectiveTarget.height,
      backgroundColor: overlayColor,
      transition: 'width 0.15s ease-out, top 0.15s ease-out, height 0.15s ease-out',
    }
    : {
      position: 'absolute',
      top: animY,
      left: 0,
      width: animX,
      height: animH,
      backgroundColor: overlayColor,
    };

  const rightRectStyle = Platform.OS === 'web'
    ? {
      position: 'absolute',
      top: effectiveTarget.y,
      left: effectiveTarget.x + effectiveTarget.width,
      right: 0,
      height: effectiveTarget.height,
      backgroundColor: overlayColor,
      transition: 'left 0.15s ease-out, top 0.15s ease-out, height 0.15s ease-out',
    }
    : {
      position: 'absolute',
      top: animY,
      left: Animated.add(animX, animW),
      right: 0,
      height: animH,
      backgroundColor: overlayColor,
    };

  // Position tooltip below the target with padding
  // Increase padding for pagination and other bottom elements to prevent overlap
  const isPaginationTarget = step.targetId === 'web-search-pagination';
  const isCustomFieldsStep = step.targetId === 'type-custom-fields';
  const isSaveAssetTypeStep = step.targetId === 'type-save';
  const isCreateAssetTypeStep = step.targetId === 'inventory-create-type' || step.targetId === 'btn-manage-types';
  const isSaveAssetStep = step.targetId === 'asset-save';
  const isCreateAssetStep = step.targetId === 'inventory-create-asset' || step.targetId === 'btn-add-asset';
  const isTypeLibraryStep = step.targetId === 'type-library';
  const isAssetTypeStep = step.targetId === 'type-name-image' || step.targetId === 'type-defaults';
  const padding = isPaginationTarget ? 60 : (isSaveAssetTypeStep ? 80 : 16); // More space for pagination and save button to prevent overlap
  // Calculate if tooltip would go off screen (using current target position)
  const tooltipHeight = 200; // Approximate tooltip height
  const currentTooltipTop = effectiveTarget.y + effectiveTarget.height + padding;
  const wouldGoOffScreen = currentTooltipTop + tooltipHeight > windowHeight - 40;

  // On web, use static positioning with CSS transitions for better performance
  // On native, use animated values
  const tooltipTopAnimated = Animated.add(Animated.add(animY, animH), padding);

  // Always position below the target, but use bottom positioning if it would go off screen
  // Add 2rem margin bottom for pagination to prevent overlap
  // Add 5rem margin bottom for asset type creation steps
  // Add 8rem margin bottom for custom fields to prevent overlap with the "+ Add Field" button
  // Add 10rem margin bottom for save asset type to prevent overlap with the "Create Asset Type" button
  // Add 10rem margin bottom for create asset to prevent overlap with the "+" button
  // Add 10rem margin bottom for save asset to prevent overlap with the "Create Asset" button
  const marginBottom = isPaginationTarget
    ? (Platform.OS === 'web' ? '2rem' : 32)
    : isSaveAssetTypeStep
      ? (Platform.OS === 'web' ? '10rem' : 80)
      : isCreateAssetTypeStep
        ? (Platform.OS === 'web' ? '5rem' : 80)
        : isSaveAssetStep
          ? (Platform.OS === 'web' ? '15rem' : 80)
          : isCreateAssetStep
            ? (Platform.OS === 'web' ? '10rem' : 160)
            : isCustomFieldsStep
              ? (Platform.OS === 'web' ? '20rem' : 80)
              : isTypeLibraryStep
                ? (Platform.OS === 'web' ? '5rem' : 80)
                : isAssetTypeStep
                  ? (Platform.OS === 'web' ? '5rem' : 80)
                  : 0;

  // Force bottom positioning for save asset type step, create asset type step, custom fields step, and save asset step to prevent overlap
  const forceBottomPosition = isSaveAssetTypeStep || isCreateAssetTypeStep || isCustomFieldsStep || isSaveAssetStep;

  const tooltipStyle = (wouldGoOffScreen || forceBottomPosition)
    ? {
      position: 'absolute',
      bottom: Math.max(40, insets.bottom + 20),
      left: 20,
      right: 20,
      ...(marginBottom && { marginBottom }),
      ...(Platform.OS === 'web' && { transition: 'top 0.15s ease-out' }),
    }
    : Platform.OS === 'web'
      ? {
        position: 'absolute',
        top: currentTooltipTop,
        left: 20,
        right: 20,
        ...(marginBottom && { marginBottom }),
        transition: 'top 0.15s ease-out',
      }
      : {
        position: 'absolute',
        top: tooltipTopAnimated,
        left: 20,
        right: 20,
        ...(marginBottom && { marginBottom }),
      };

  // On web, use regular Views with CSS transitions for better performance
  // On native, use Animated.Views
  const RectComponent = Platform.OS === 'web' ? View : Animated.View;

  return (
    <View style={styles.overlayContainer} pointerEvents="box-none">
      <RectComponent style={topRectStyle} />
      <RectComponent style={bottomRectStyle} />
      <RectComponent style={leftRectStyle} />
      <RectComponent style={rightRectStyle} />

      {Platform.OS === 'web' ? (
        <View
          style={{
            position: 'absolute',
            top: effectiveTarget.y - 4,
            left: effectiveTarget.x - 4,
            width: effectiveTarget.width + 8,
            height: effectiveTarget.height + 8,
            borderWidth: 2,
            borderColor: '#FFA500',
            borderRadius: 8,
            transition: 'top 0.15s ease-out, left 0.15s ease-out, width 0.15s ease-out, height 0.15s ease-out',
          }}
          pointerEvents="none"
        />
      ) : (
        <Animated.View
          style={{
            position: 'absolute',
            top: Animated.subtract(animY, 4),
            left: Animated.subtract(animX, 4),
            width: Animated.add(animW, 8),
            height: Animated.add(animH, 8),
            borderWidth: 2,
            borderColor: '#FFA500',
            borderRadius: 8,
          }}
          pointerEvents="none"
        />
      )}

      {Platform.OS === 'web' ? (
        <View style={[styles.tooltip, tooltipStyle]}>
          <View style={styles.header}>
            <Text style={styles.title}>{step.title}</Text>
            <TouchableOpacity onPress={onStop}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.desc}>{step.description}</Text>
          <View style={styles.footer}>
            <Text style={styles.pager}>{currentStepIndex + 1} / {totalSteps}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {step.interaction && (
                <Text style={styles.interactionText}>Tap highlighted area</Text>
              )}
              <TouchableOpacity style={styles.nextBtn} onPress={onNext}>
                <Text style={styles.nextText}>
                  {currentStepIndex === totalSteps - 1 ? 'Finish' : 'Next'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : (
        <Animated.View style={[styles.tooltip, tooltipStyle]}>
          <View style={styles.header}>
            <Text style={styles.title}>{step.title}</Text>
            <TouchableOpacity onPress={onStop}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.desc}>{step.description}</Text>
          <View style={styles.footer}>
            <Text style={styles.pager}>{currentStepIndex + 1} / {totalSteps}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {step.interaction && (
                <Text style={styles.interactionText}>Tap highlighted area</Text>
              )}
              <TouchableOpacity style={styles.nextBtn} onPress={onNext}>
                <Text style={styles.nextText}>
                  {currentStepIndex === totalSteps - 1 ? 'Finish' : 'Next'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

export async function resetTour() {
  await AsyncStorage.removeItem(TOUR_STORAGE_KEY);
}

export async function shouldShowTour() {
  const done = await AsyncStorage.getItem(TOUR_STORAGE_KEY);
  return done !== 'true';
}

const styles = StyleSheet.create({
  overlayContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99999,
    elevation: 99999,
    ...(Platform.OS === 'web' ? {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    } : {}),
  },
  dim: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  tooltip: {
    position: 'absolute',
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: {
    fontWeight: 'bold',
    fontSize: 18,
    color: '#333',
  },
  close: {
    fontSize: 18,
    color: '#999',
    padding: 4,
  },
  desc: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
    lineHeight: 20,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pager: {
    color: '#999',
    fontSize: 12,
  },
  nextBtn: {
    backgroundColor: '#007AFF',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  nextText: {
    color: 'white',
    fontWeight: '600',
  },
  interactionText: {
    color: '#FFA500',
    fontWeight: '600',
    fontSize: 12,
    fontStyle: 'italic',
  }
});
