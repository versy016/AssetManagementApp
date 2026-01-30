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
      description: 'Now, let\'s manage your inventory. Tap the "Inventory" tab at the bottom right.',
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
      description: 'Now, let\'s explore your inventory. Tap the "Inventory" tab at the bottom right.',
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
    if (step && step.action) {
      step.action();
    }
    if (stepIndex < TOUR_STEPS.length - 1) {
      setStepIndex(prev => prev + 1);
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
          const element = ref;
          if (element && typeof element.getBoundingClientRect === 'function') {
            const rect = element.getBoundingClientRect();
            if (rect && rect.width > 0 && rect.height > 0) {
              setTargets(prev => ({
                ...prev,
                [id]: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
              }));
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
  const normalizeRoute = (route) => {
    if (!route) return '';
    return route.replace(/\(tabs\)\/?/g, '').replace(/\/$/, '').toLowerCase().trim();
  };

  const isRouteMatch = currentStep && (() => {
    if (!pathname || !currentStep.route) return false;
    const normPath = normalizeRoute(pathname);
    const normStepRoute = normalizeRoute(currentStep.route);
    return normPath === normStepRoute ||
      normPath.includes(normStepRoute) ||
      normStepRoute.includes(normPath);
  })();

  const currentTarget = (isRouteMatch && currentStep) ? targets[currentStep.targetId] : null;
  const hasValidTarget = currentTarget &&
    currentTarget.width > 0 &&
    currentTarget.height > 0 &&
    currentTarget.x >= 0 &&
    currentTarget.y >= 0;

  const stepAge = Date.now() - stepStartTime;
  // Give more time for targets to be measured, especially for off-screen elements that need scrolling
  const shouldShowOverlay = active && isRouteMatch && currentStep && (hasValidTarget || stepAge > 1500);

  const ensureVisible = useCallback((ref) => {
    setScrollViewRef(ref);
  }, []);

  const scrollToTarget = useCallback((target) => {
    if (!scrollViewRef || !target) return;
    try {
      // Measure the scroll view to get its height
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
    } catch (e) {
      // Fallback if measure fails or not available
      if (target.y > 500) {
        scrollViewRef.scrollToEnd({ animated: true });
      } else {
        scrollViewRef.scrollTo({ y: Math.max(0, target.y - 100), animated: true });
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
      const cleanup = registerTarget(id, viewRef.current);
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

    if (firstRender.current) {
      animX.setValue(effectiveTarget.x);
      animY.setValue(effectiveTarget.y);
      animW.setValue(effectiveTarget.width);
      animH.setValue(effectiveTarget.height);
      firstRender.current = false;
      Animated.timing(anim, { toValue: 1, duration: 300, useNativeDriver: false }).start();
    } else {
      Animated.parallel([
        Animated.timing(animX, { toValue: effectiveTarget.x, duration: 300, useNativeDriver: false, easing: Easing.out(Easing.ease) }),
        Animated.timing(animY, { toValue: effectiveTarget.y, duration: 300, useNativeDriver: false, easing: Easing.out(Easing.ease) }),
        Animated.timing(animW, { toValue: effectiveTarget.width, duration: 300, useNativeDriver: false, easing: Easing.out(Easing.ease) }),
        Animated.timing(animH, { toValue: effectiveTarget.height, duration: 300, useNativeDriver: false, easing: Easing.out(Easing.ease) }),
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

  // Calculate the 4 surrounding rectangles based on animated values
  const topRectStyle = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: animY,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  };

  const bottomRectStyle = {
    position: 'absolute',
    top: Animated.add(animY, animH),
    left: 0,
    right: 0,
    height: windowHeight * 2, // Ensure it covers enough
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  };

  const leftRectStyle = {
    position: 'absolute',
    top: animY,
    left: 0,
    width: animX,
    height: animH,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  };

  const rightRectStyle = {
    position: 'absolute',
    top: animY,
    left: Animated.add(animX, animW),
    right: 0,
    height: animH,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  };

  // Tooltip positioning: Docked to Top or Bottom to prevent obstructing context
  let effectiveTarget = { ...target };
  if (step.targetId === 'nav-inventory-tab') {
    const HIT_SLOP = 20;
    effectiveTarget.height = (windowHeight - effectiveTarget.y) + HIT_SLOP;
    effectiveTarget.y -= HIT_SLOP;
  }
  const isTop = effectiveTarget.y > windowHeight / 2;

  // Use safe area insets for docking
  const tooltipStyle = isTop
    ? { top: Math.max(40, insets.top + 20), left: 20, right: 20 }
    : { bottom: Math.max(40, insets.bottom + 20), left: 20, right: 20 };

  return (
    <View style={styles.overlayContainer} pointerEvents="box-none">
      <Animated.View style={topRectStyle} />
      <Animated.View style={bottomRectStyle} />
      <Animated.View style={leftRectStyle} />
      <Animated.View style={rightRectStyle} />

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
  },
  dim: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
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
