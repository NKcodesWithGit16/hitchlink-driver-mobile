import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from '../ui/Icon';
import { useReduceMotion } from '../../lib/useReduceMotion';
import { useTheme } from '../../theme/ThemeContext';
import { space, radius, type, FONT, shadow, motion } from '../../theme/tokens';

const BARS = 20;
// A gentle, organic target height per bar so the resting wave isn't a flat line
// and each bar peaks at a slightly different amplitude.
const PEAKS = [0.5, 0.9, 0.65, 1, 0.55, 0.8, 0.45, 0.95, 0.6, 0.85, 0.5, 1, 0.7, 0.55, 0.9, 0.6, 0.8, 0.45, 0.75, 0.55];
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/* Full-width recording bar that replaces the composer input while capturing a
   voice message. Left = exit (discard & back out), right = send. */
export default function RecordingBar({ elapsed = 0, onCancel, onSend }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const reduce = useReduceMotion();

  // Entrance: fade + rise, driven on the native thread so it never stutters.
  const enter = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  // Pulsing "live" dot.
  const pulse = useRef(new Animated.Value(1)).current;
  // Animated pseudo-waveform — each bar breathes on its own stagger so the row
  // reads as a live equalizer (not real mic metering; cheap and web-safe).
  const bars = useRef(PEAKS.map(() => new Animated.Value(0.28))).current;

  useEffect(() => {
    if (reduce) return;
    const loops = [];

    // Spring the bar in — snappy but soft, all on the native driver.
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, ...motion.spring.snappy }).start();

    const dot = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.3, duration: 640, easing: motion.easing.standard, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1,   duration: 640, easing: motion.easing.standard, useNativeDriver: true }),
    ]));
    dot.start();
    loops.push(dot);

    bars.forEach((b, i) => {
      const up   = 300 + (i % 5) * 26;   // slightly varied tempo per bar
      const down = 300 + (i % 3) * 34;
      const loop = Animated.loop(Animated.sequence([
        Animated.delay((i % 7) * 70),
        Animated.timing(b, { toValue: PEAKS[i], duration: up,   easing: motion.easing.standard, useNativeDriver: true }),
        Animated.timing(b, { toValue: 0.28,     duration: down, easing: motion.easing.standard, useNativeDriver: true }),
      ]));
      loop.start();
      loops.push(loop);
    });
    return () => loops.forEach((l) => l.stop());
  }, [reduce]);

  return (
    <Animated.View style={[
      styles.bar,
      { backgroundColor: colors.surface2, borderColor: colors.border,
        opacity: enter,
        transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] },
    ]}>
      {/* Exit — discard the clip and return to the normal composer */}
      <Pressable
        onPress={onCancel}
        style={[styles.exitBtn, { backgroundColor: colors.dangerFill }]}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Cancel voice message"
      >
        <Icon name="x" size={19} color={colors.danger} />
      </Pressable>

      {/* Live indicator + waveform + timer */}
      <View style={styles.live}>
        <Animated.View style={[styles.recDot, { backgroundColor: colors.danger, opacity: pulse }]} />
        <View style={styles.wave}>
          {bars.map((b, i) => (
            <Animated.View
              key={i}
              style={[styles.waveBar, { backgroundColor: colors.teal, transform: [{ scaleY: b }] }]}
            />
          ))}
        </View>
        <Text style={[styles.timer, { color: colors.textPrimary }]}>{mmss(elapsed)}</Text>
      </View>

      {/* Send */}
      <Pressable
        onPress={onSend}
        style={[styles.sendBtn, { backgroundColor: colors.teal }, shadow.glow(colors.teal)]}
        accessibilityRole="button"
        accessibilityLabel="Send voice message"
      >
        <Icon name="arrow-up" size={19} color={colors.onAccent} />
      </Pressable>
    </Animated.View>
  );
}

const makeStyles = (c) => StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: space[2],
    borderRadius: radius.xl, borderWidth: 1,
    paddingLeft: 5, paddingRight: 5, paddingVertical: 5,
  },
  exitBtn: { width: 38, height: 38, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  live: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[1] },
  recDot: { width: 9, height: 9, borderRadius: 999, flexShrink: 0 },
  wave: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 24 },
  waveBar: { width: 3, height: 24, borderRadius: 2 },
  timer: { fontSize: 14, fontFamily: FONT.bold, minWidth: 40, textAlign: 'right', ...type.num },
  sendBtn: { width: 38, height: 38, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
});
