import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { radius as R } from '../../theme/tokens';
import { useReduceMotion } from '../../lib/useReduceMotion';

/* A softly pulsing placeholder block. Compose several to mirror a screen's
   real layout while data loads — it feels faster than a spinner and previews
   what's coming. Opacity-only pulse (useNativeDriver) so it's cheap, and it
   freezes to a static tint when the OS "reduce motion" setting is on. */
export default function Skeleton({ width = '100%', height = 16, radius = R.sm, style }) {
  const { colors } = useTheme();
  const reduce = useReduceMotion();
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 850, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 850, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce]);

  const opacity = reduce ? 0.5 : shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] });
  return (
    <Animated.View
      style={[{ width, height, borderRadius: radius, backgroundColor: colors.surfaceHi, opacity }, style]}
    />
  );
}
