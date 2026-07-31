import { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Modal, Pressable, Animated, Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../ui/Icon';
import GlassView from '../ui/GlassView';
import haptics from '../../lib/haptics';
import { useReduceMotion } from '../../lib/useReduceMotion';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n/LanguageContext';
import {
  space, type, radius, FONT, tap, elevation, toneOf, glassFor, motion,
} from '../../theme/tokens';

/* A bottom sheet of choices.
 *
 * Alert.alert is the obvious thing to reach for and it does NOT work here:
 * Android's dialog renders at most three buttons, so a Cancel plus three real
 * options silently loses one — the same limit that keeps the navigation-app
 * picker down to three. It also doesn't exist at all on RN-web.
 *
 * Visually this is DocFocusOverlay's menu: glass rows over a blurred backdrop,
 * one live blur layer, tinted icon tiles. Rows carry a `tone` when they mean
 * something (danger for destructive), and default to the accent otherwise.
 */
export default function ActionSheet({ title, subtitle, actions, onSelect, onClose }) {
  const { colors } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();

  const anim = useRef(new Animated.Value(reduce ? 1 : 0)).current;

  useEffect(() => {
    if (reduce) return;
    Animated.spring(anim, { toValue: 1, ...motion.spring.snappy, useNativeDriver: true }).start();
  }, [reduce]);

  const g = glassFor(colors);
  const rows = (actions || []).filter(Boolean);

  const pick = (key) => {
    haptics.tap();
    onSelect?.(key);
  };

  const rise = {
    opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }],
  };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: anim }]}
        pointerEvents="none"
      >
        <BlurView
          intensity={g.intensity + 20}
          tint={g.tint}
          experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
          style={StyleSheet.absoluteFill}
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} />
      </Animated.View>

      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('common.cancel')}
      />

      <View style={styles.bottom} pointerEvents="box-none">
        <Animated.View style={[styles.stack, { paddingBottom: insets.bottom + space[4] }, rise]} pointerEvents="box-none">

          <Animated.View style={elevation[3]}>
            <GlassView radius={radius.xl}>
              <View style={styles.head}>
                <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
                {subtitle ? (
                  <Text style={[styles.subtitle, { color: colors.textMuted }]}>{subtitle}</Text>
                ) : null}
              </View>

              {rows.map((a, i) => {
                const tone = toneOf(colors, a.tone || 'teal');
                return (
                  <View key={a.key}>
                    <View style={[styles.divider, { backgroundColor: colors.border }]} />
                    <Pressable
                      onPress={() => pick(a.key)}
                      style={({ pressed }) => [
                        styles.row,
                        { backgroundColor: pressed ? tone.fill : 'transparent' },
                        i === rows.length - 1 && styles.lastRow,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={a.label}
                    >
                      <View style={[styles.rowIcon, { backgroundColor: tone.fill }]}>
                        <Icon name={a.icon} size={18} color={tone.solid} />
                      </View>
                      <Text
                        style={[
                          styles.rowText,
                          { color: a.tone === 'danger' ? tone.solid : colors.textPrimary },
                        ]}
                      >
                        {a.label}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </GlassView>
          </Animated.View>

          {/* Opaque, like DocFocusOverlay's — one live blur is the budget. */}
          <Animated.View
            style={[styles.cancelLift, { backgroundColor: colors.surface }, elevation[3]]}
          >
            <View style={[styles.cancelWrap, { borderColor: colors.borderStrong }]}>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [
                  styles.cancelBtn,
                  { backgroundColor: pressed ? colors.surfaceHi : 'transparent' },
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
              >
                <Text style={[styles.cancelText, { color: colors.textPrimary }]}>
                  {t('common.cancel')}
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const ROW_ICON = 36;

const styles = StyleSheet.create({
  bottom: { flex: 1, justifyContent: 'flex-end' },
  stack: { width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: space[4], gap: space[3] },

  head: { paddingHorizontal: space[5], paddingTop: space[5], paddingBottom: space[4], gap: 3 },
  title: { ...type.title },
  subtitle: { ...type.caption },

  divider: { height: StyleSheet.hairlineWidth },
  row: {
    minHeight: tap.secondary, flexDirection: 'row', alignItems: 'center',
    gap: space[3], paddingHorizontal: space[5], paddingVertical: space[2],
  },
  lastRow: { paddingBottom: space[3] },
  rowIcon: {
    width: ROW_ICON, height: ROW_ICON, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  rowText: { fontSize: 16, fontFamily: FONT.bold, letterSpacing: -0.2 },

  cancelLift: { borderRadius: radius.xl },
  cancelWrap: { borderRadius: radius.xl, borderWidth: 1, overflow: 'hidden' },
  cancelBtn: { minHeight: tap.secondary, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 16, fontFamily: FONT.bold, letterSpacing: -0.2 },
});
