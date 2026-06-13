import { useRef, useCallback } from 'react';
import { Animated } from 'react-native';
import { useFocusEffect } from 'expo-router';

// Fades in when the tab is focused. No reset on blur — the sceneContainerStyle
// in the tab layout gives every screen the correct bg, so there's no white flash.
export default function ScreenFade({ children, style }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const didMount = useRef(false);

  useFocusEffect(useCallback(() => {
    if (!didMount.current) {
      didMount.current = true;
      opacity.setValue(0);
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    } else {
      opacity.setValue(1);
    }
  }, []));

  return (
    <Animated.View style={[{ flex: 1, opacity }, style]}>
      {children}
    </Animated.View>
  );
}
