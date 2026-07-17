import { useEffect, useRef } from 'react';
import { Text, Pressable, StyleSheet, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from './Icon';
import GlassView from './GlassView';
import haptics from '../../lib/haptics';
import { useTheme } from '../../theme/ThemeContext';
import { space, type, radius, FONT } from '../../theme/tokens';

/* A safety net after an irreversible-feeling action: confirm the change AND
   give a few seconds to take it back. Slides up above the tab bar, auto-hides
   after `duration`. Frosted glass so it reads as a transient overlay, not a
   working surface. */
export default function UndoToast({ visible, message, onUndo, onHide, duration = 5000 }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // Hidden offset must clear the toast fully past the screen edge even on
  // devices with a large safe-area bottom inset (home-indicator phones) —
  // the toast's resting "bottom" already includes insets.bottom, so a small
  // fixed offset here isn't enough and the toast peeks up when "hidden".
  const HIDDEN_OFFSET = 400;
  const ty = useRef(new Animated.Value(HIDDEN_OFFSET)).current;
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    if (visible) {
      Animated.spring(ty, { toValue: 0, damping: 18, stiffness: 200, useNativeDriver: true }).start();
      timer.current = setTimeout(() => onHide?.(), duration);
    } else {
      Animated.timing(ty, { toValue: HIDDEN_OFFSET, duration: 220, useNativeDriver: true }).start();
    }
    return () => clearTimeout(timer.current);
  }, [visible]);

  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[styles.wrap, { bottom: insets.bottom + 88, transform: [{ translateY: ty }] }]}
    >
      <GlassView radius={radius.xl} style={styles.toast}>
        <Icon name="check-circle" size={18} color={colors.go} />
        <Text style={[styles.msg, { color: colors.textPrimary }]} numberOfLines={1}>{message}</Text>
        <Pressable
          onPress={() => { haptics.tap(); onUndo?.(); }}
          hitSlop={12}
          style={styles.undoBtn}
          accessibilityRole="button"
          accessibilityLabel="Undo that update"
        >
          <Icon name="rotate-ccw" size={15} color={colors.teal} />
          <Text style={[styles.undoText, { color: colors.teal }]}>Undo</Text>
        </Pressable>
      </GlassView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space[4], right: space[4], zIndex: 998 },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: space[3],
    paddingHorizontal: space[4], paddingVertical: space[3],
  },
  msg: { ...type.caption, fontFamily: FONT.bold, flex: 1 },
  undoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0,
    paddingHorizontal: space[3], paddingVertical: space[2], minHeight: 40,
  },
  undoText: { ...type.bodyStrong, fontSize: 15 },
});
