// components/TourGuide.js
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Dimensions,
  Animated,
  Platform,
  ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TOUR_STORAGE_KEY = '@app_tour_completed';
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export const TourContext = React.createContext({
  startTour: () => {},
  registerStep: () => {},
  unregisterStep: () => {},
});

export function TourProvider({ children }) {
  const [currentStep, setCurrentStep] = useState(null);
  const [steps, setSteps] = useState([]);
  const [isActive, setIsActive] = useState(false);
  const stepRefs = useRef({});
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  const registerStep = (stepId, ref, data) => {
    stepRefs.current[stepId] = { ref, data };
    setSteps((prev) => {
      const exists = prev.find((s) => s.id === stepId);
      if (exists) return prev;
      return [...prev, { id: stepId, ...data }].sort((a, b) => a.order - b.order);
    });
  };

  const unregisterStep = (stepId) => {
    delete stepRefs.current[stepId];
    setSteps((prev) => prev.filter((s) => s.id !== stepId));
  };

  const startTour = (stepIds = null) => {
    const tourSteps = stepIds
      ? steps.filter((s) => stepIds.includes(s.id))
      : steps;
    if (tourSteps.length === 0) return;
    setIsActive(true);
    setCurrentStep(tourSteps[0]);
    Animated.timing(overlayOpacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  const nextStep = () => {
    const currentIndex = steps.findIndex((s) => s.id === currentStep?.id);
    if (currentIndex < steps.length - 1) {
      setCurrentStep(steps[currentIndex + 1]);
    } else {
      finishTour();
    }
  };

  const previousStep = () => {
    const currentIndex = steps.findIndex((s) => s.id === currentStep?.id);
    if (currentIndex > 0) {
      setCurrentStep(steps[currentIndex - 1]);
    }
  };

  const skipTour = async () => {
    await AsyncStorage.setItem(TOUR_STORAGE_KEY, 'true');
    finishTour();
  };

  const finishTour = async () => {
    await AsyncStorage.setItem(TOUR_STORAGE_KEY, 'true');
    Animated.timing(overlayOpacity, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setIsActive(false);
      setCurrentStep(null);
    });
  };

  const contextValue = {
    startTour,
    registerStep,
    unregisterStep,
    currentStep,
    isActive,
  };

  const stepData = stepRefs.current[currentStep?.id];
  const stepRef = stepData?.ref;

  return (
    <TourContext.Provider value={contextValue}>
      {children}
      {isActive && currentStep && (
        <TourOverlay
          step={currentStep}
          stepRef={stepRef}
          overlayOpacity={overlayOpacity}
          onNext={nextStep}
          onPrevious={previousStep}
          onSkip={skipTour}
          onFinish={finishTour}
          currentIndex={steps.findIndex((s) => s.id === currentStep.id)}
          totalSteps={steps.length}
        />
      )}
    </TourContext.Provider>
  );
}

function TourOverlay({
  step,
  stepRef,
  overlayOpacity,
  onNext,
  onPrevious,
  onSkip,
  onFinish,
  currentIndex,
  totalSteps,
}) {
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [tooltipSide, setTooltipSide] = useState('bottom');

  useEffect(() => {
    if (stepRef?.current) {
      const measure = () => {
        if (Platform.OS === 'web') {
          // Web: use getBoundingClientRect from the underlying DOM element
          try {
            const element = stepRef.current;
            // On web, React Native View refs expose the underlying DOM node
            const domNode = element?._nativeNode || element;
            if (domNode && typeof domNode.getBoundingClientRect === 'function') {
              const rect = domNode.getBoundingClientRect();
              const scrollX = window.scrollX || window.pageXOffset || 0;
              const scrollY = window.scrollY || window.pageYOffset || 0;
              
              const centerX = rect.left + rect.width / 2;
              const centerY = rect.top + rect.height / 2;
              
              let side = 'bottom';
              if (rect.top > SCREEN_HEIGHT / 2) side = 'top';
              else if (rect.left > SCREEN_WIDTH / 2) side = 'left';
              else if (rect.left < SCREEN_WIDTH / 4) side = 'right';

              setTooltipPosition({ 
                x: rect.left + scrollX, 
                y: rect.top + scrollY, 
                width: rect.width, 
                height: rect.height, 
                centerX: rect.left + scrollX + rect.width / 2, 
                centerY: rect.top + scrollY + rect.height / 2
              });
              setTooltipSide(side);
            } else if (element && typeof element.measure === 'function') {
              // Fallback: try React Native measure if available
              element.measure((x, y, width, height, pageX, pageY) => {
                const centerX = pageX + width / 2;
                const centerY = pageY + height / 2;
                
                let side = 'bottom';
                if (pageY > SCREEN_HEIGHT / 2) side = 'top';
                else if (pageX > SCREEN_WIDTH / 2) side = 'left';
                else if (pageX < SCREEN_WIDTH / 4) side = 'right';

                setTooltipPosition({ x: pageX, y: pageY, width, height, centerX, centerY });
                setTooltipSide(side);
              });
            }
          } catch (e) {
            console.warn('Tour: Failed to measure element on web', e);
          }
        } else {
          // Native: use measure
          if (stepRef.current.measure) {
            stepRef.current.measure((x, y, width, height, pageX, pageY) => {
              const centerX = pageX + width / 2;
              const centerY = pageY + height / 2;
              
              let side = 'bottom';
              if (pageY > SCREEN_HEIGHT / 2) side = 'top';
              else if (pageX > SCREEN_WIDTH / 2) side = 'left';
              else if (pageX < SCREEN_WIDTH / 4) side = 'right';

              setTooltipPosition({ x: pageX, y: pageY, width, height, centerX, centerY });
              setTooltipSide(side);
            });
          }
        }
      };

      // Delay to ensure element is rendered, and retry if needed
      let timeout = setTimeout(measure, 100);
      // Also try again after a longer delay in case of slow rendering
      let retryTimeout = setTimeout(measure, 500);
      return () => {
        clearTimeout(timeout);
        clearTimeout(retryTimeout);
      };
    }
  }, [step, stepRef]);

  const isLast = currentIndex === totalSteps - 1;
  const isFirst = currentIndex === 0;

  return (
    <Modal transparent visible animationType="none">
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        {/* Dark overlay with hole */}
        <View style={styles.overlayContainer}>
          {stepRef?.current && (
            <View
              style={[
                styles.hole,
                {
                  left: tooltipPosition.x - 10,
                  top: tooltipPosition.y - 10,
                  width: tooltipPosition.width + 20,
                  height: tooltipPosition.height + 20,
                },
              ]}
            />
          )}
        </View>

        {/* Tooltip */}
        <View
          style={[
            styles.tooltip,
            tooltipSide === 'bottom' && { top: tooltipPosition.y + tooltipPosition.height + 20 },
            tooltipSide === 'top' && { bottom: SCREEN_HEIGHT - tooltipPosition.y + 20 },
            tooltipSide === 'left' && { right: SCREEN_WIDTH - tooltipPosition.x + 20, top: tooltipPosition.centerY - 100 },
            tooltipSide === 'right' && { left: tooltipPosition.x + tooltipPosition.width + 20, top: tooltipPosition.centerY - 100 },
          ]}
        >
          <View style={styles.tooltipHeader}>
            <Text style={styles.tooltipTitle}>{step.title}</Text>
            <TouchableOpacity onPress={onSkip} style={styles.skipButton}>
              <MaterialIcons name="close" size={20} color="#666" />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.tooltipContent}>
            <Text style={styles.tooltipText}>{step.description}</Text>
          </ScrollView>
          <View style={styles.tooltipFooter}>
            <Text style={styles.stepIndicator}>
              {currentIndex + 1} of {totalSteps}
            </Text>
            <View style={styles.tooltipActions}>
              {!isFirst && (
                <TouchableOpacity onPress={onPrevious} style={styles.actionButton}>
                  <Text style={styles.actionButtonText}>Previous</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={isLast ? onFinish : onNext}
                style={[styles.actionButton, styles.actionButtonPrimary]}
              >
                <Text style={[styles.actionButtonText, styles.actionButtonTextPrimary]}>
                  {isLast ? 'Finish' : 'Next'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

export function TourStep({ stepId, order, title, description, children }) {
  const { registerStep, unregisterStep, currentStep } = React.useContext(TourContext);
  const ref = useRef(null);

  useEffect(() => {
    registerStep(stepId, ref, { order, title, description });
    return () => unregisterStep(stepId);
  }, [stepId, order, title, description]);

  const isHighlighted = currentStep?.id === stepId;

  return (
    <View
      ref={ref}
      collapsable={false}
      style={isHighlighted ? styles.highlighted : null}
    >
      {children}
    </View>
  );
}

export async function shouldShowTour() {
  try {
    const completed = await AsyncStorage.getItem(TOUR_STORAGE_KEY);
    return completed !== 'true';
  } catch {
    return true;
  }
}

export async function resetTour() {
  try {
    await AsyncStorage.removeItem(TOUR_STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to reset tour:', e);
  }
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
  },
  overlayContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  hole: {
    position: 'absolute',
    backgroundColor: 'transparent',
    borderRadius: 8,
    borderWidth: 3,
    borderColor: '#1E90FF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 10,
  },
  highlighted: {
    zIndex: 10000,
    elevation: 10,
  },
  tooltip: {
    position: 'absolute',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    maxWidth: SCREEN_WIDTH - 40,
    minWidth: 280,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  tooltipHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  tooltipTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E90FF',
    flex: 1,
  },
  skipButton: {
    padding: 4,
  },
  tooltipContent: {
    maxHeight: 150,
    marginBottom: 16,
  },
  tooltipText: {
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },
  tooltipFooter: {
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 12,
  },
  stepIndicator: {
    fontSize: 12,
    color: '#666',
    marginBottom: 12,
    textAlign: 'center',
  },
  tooltipActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  actionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  actionButtonPrimary: {
    backgroundColor: '#1E90FF',
    borderColor: '#1E90FF',
  },
  actionButtonText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '600',
  },
  actionButtonTextPrimary: {
    color: '#fff',
  },
});

