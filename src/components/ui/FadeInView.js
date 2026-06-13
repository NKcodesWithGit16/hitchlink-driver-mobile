import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { useReduceMotion } from '../../lib/useReduceMotion';

/* Gentle entrance — fade + small rise. Stagger siblings with `delay`. */
export default function FadeInView({ children, delay = 0, distance = 12, style }) {
  const reduce = useReduceMotion();
  const op = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  const ty = useRef(new Animated.Value(reduce ? 0 : distance)).current;

  useEffect(() => {
    if (reduce) return;
    Animated.parallel([
      Animated.timing(op, { toValue: 1, duration: 420, delay, useNativeDriver: true }),
      Animated.spring(ty, { toValue: 0, delay, damping: 16, stiffness: 170, mass: 0.7, useNativeDriver: true }),
    ]).start();
  }, []);

  return <Animated.View style={[style, { opacity: op, transform: [{ translateY: ty }] }]}>{children}</Animated.View>;
}
