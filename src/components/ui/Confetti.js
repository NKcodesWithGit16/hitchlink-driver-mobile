import { useRef, useEffect } from 'react';
import { Animated, View, StyleSheet, Easing } from 'react-native';
import { useReduceMotion } from '../../lib/useReduceMotion';

const COLORS = ['#16C784', '#1FB6CE', '#FFB020', '#2DD4E8', '#FFFFFF'];

/* A short, tasteful confetti burst for the "Delivered!" moment. */
export default function Confetti({ count = 16 }) {
  const reduce = useReduceMotion();
  const pieces = useRef(
    Array.from({ length: count }, (_, i) => ({
      x: Math.random(),
      color: COLORS[i % COLORS.length],
      delay: Math.random() * 260,
      rot: Math.random() * 360,
      drift: (Math.random() - 0.5) * 60,
      anim: new Animated.Value(0),
    })),
  ).current;

  useEffect(() => {
    if (reduce) return;
    Animated.stagger(35, pieces.map((p) =>
      Animated.timing(p.anim, { toValue: 1, duration: 1500, delay: p.delay, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    )).start();
  }, []);

  if (reduce) return null;

  return (
    <View pointerEvents="none" style={styles.wrap}>
      {pieces.map((p, i) => {
        const translateY = p.anim.interpolate({ inputRange: [0, 1], outputRange: [-24, 260] });
        const translateX = p.anim.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] });
        const opacity = p.anim.interpolate({ inputRange: [0, 0.1, 0.85, 1], outputRange: [0, 1, 1, 0] });
        return (
          <Animated.View
            key={i}
            style={[styles.piece, {
              left: `${p.x * 100}%`,
              backgroundColor: p.color,
              opacity,
              transform: [{ translateY }, { translateX }, { rotate: `${p.rot}deg` }],
            }]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  piece: { position: 'absolute', top: 0, width: 8, height: 13, borderRadius: 2 },
});
