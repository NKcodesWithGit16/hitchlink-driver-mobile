import { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../theme/ThemeContext';
import { useReduceMotion } from '../../lib/useReduceMotion';

/* Full-bleed cinematic photo backdrop with a slow Ken Burns drift and layered
   gradient scrims that fade into the app background so overlaid or adjacent
   text stays legible. The emotional-anchor treatment for welcome + first-run —
   never used on working screens. Photos are the only place we let the app
   breathe; everything else is utilitarian.

   strength: 'bottom' — hero sits above page content on colors.bg (onboarding)
             'full'   — white text sits directly ON the photo (welcome)
   active:   only drift the visible page (pager can pass k === current). */
export default function CinematicHero({ photo, children, style, active = true, strength = 'bottom' }) {
  const { colors } = useTheme();
  const reduce = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduce || !active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.12, duration: 14000, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1.0,  duration: 14000, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, reduce]);

  const full = strength === 'full';
  const scrim = full
    ? ['transparent', 'rgba(3,8,16,0.35)', 'rgba(3,8,16,0.82)', colors.bg]
    : ['transparent', 'rgba(3,8,16,0.10)', colors.bg];
  const locations = full ? [0, 0.4, 0.74, 1] : [0, 0.55, 1];

  return (
    <View style={[styles.wrap, style]}>
      <Animated.Image
        source={photo}
        resizeMode="cover"
        style={[StyleSheet.absoluteFill, { transform: [{ scale }] }]}
        accessibilityIgnoresInvertColors
      />
      {/* Brand navy wash up top — cohesion + status-bar legibility. */}
      <LinearGradient
        colors={['rgba(4,40,90,0.30)', 'transparent']}
        start={{ x: 0, y: 0 }} end={{ x: 0, y: 0.55 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* Fade the lower portion into the page background. */}
      <LinearGradient
        colors={scrim} locations={locations}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', backgroundColor: '#04101F' },
});
