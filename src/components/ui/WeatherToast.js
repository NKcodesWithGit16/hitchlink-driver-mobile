import { useEffect, useRef, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, Modal, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from './Icon';
import PrimaryAction from './PrimaryAction';
import GlassView from './GlassView';
import { useTheme } from '../../theme/ThemeContext';
import { useAlert } from '../../context/AlertContext';
import { useReduceMotion } from '../../lib/useReduceMotion';
import { space, type, radius, FONT, shadow, toneOf } from '../../theme/tokens';

const TOAST_DURATION = 7000;

/* ── Top notification banner ──
   A calm, glassy heads-up that settles in from the top rather than snapping.
   Gradient icon tile + clear hierarchy (what · when/where · how to act) and a
   thin countdown line so its exit never feels abrupt. Tap = open the full
   takeover; the × just dismisses. */
export function WeatherToast() {
  const { colors } = useTheme();
  const { activeAlert, toastVisible, dismissToast, openModal } = useAlert();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();

  const anim = useRef(new Animated.Value(0)).current;      // 0 hidden → 1 shown
  const progress = useRef(new Animated.Value(1)).current;  // 1 → 0 countdown
  const autoTimer = useRef(null);

  useEffect(() => {
    clearTimeout(autoTimer.current);
    if (toastVisible) {
      progress.setValue(1);
      if (reduce) {
        anim.setValue(1);
      } else {
        Animated.spring(anim, {
          toValue: 1, damping: 17, stiffness: 170, mass: 0.85, useNativeDriver: true,
        }).start();
        Animated.timing(progress, {
          toValue: 0, duration: TOAST_DURATION, useNativeDriver: false,
        }).start();
      }
      autoTimer.current = setTimeout(dismissToast, TOAST_DURATION);
    } else {
      Animated.timing(anim, {
        toValue: 0, duration: 240, useNativeDriver: true,
      }).start();
    }
    return () => clearTimeout(autoTimer.current);
  }, [toastVisible, reduce]);

  if (!activeAlert) return null;

  const severe = activeAlert.severity === 'severe';
  const tone = toneOf(colors, severe ? 'danger' : 'caution');
  const eyebrow = severe ? 'Severe weather ahead' : 'Weather ahead';

  const translateY = anim.interpolate({
    inputRange: [0, 1], outputRange: [-(160 + insets.top), 0],
  });
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] });
  const barWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <Animated.View
      style={[
        styles.wrap,
        { top: insets.top + space[2], opacity: anim, transform: [{ translateY }, { scale }] },
        shadow.float,
      ]}
      pointerEvents={toastVisible ? 'box-none' : 'none'}
    >
      <Pressable
        onPress={openModal}
        accessibilityRole="button"
        accessibilityLabel={`${eyebrow}. ${activeAlert.title}. About ${activeAlert.etaMinutes} minutes ahead near ${activeAlert.near}. Tap to see safe stops.`}
      >
        <GlassView radius={radius['2xl']} style={styles.toast}>
          <View style={styles.row}>
            <LinearGradient
              colors={tone.grad}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.iconTile, shadow.glow(tone.solid)]}
            >
              <Icon name="cloud-snow" size={22} color="#FFFFFF" />
            </LinearGradient>

            <View style={styles.textCol}>
              <Text style={[styles.eyebrow, { color: tone.solid }]} numberOfLines={1}>
                {eyebrow}
              </Text>
              <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
                {activeAlert.title}
              </Text>
              <View style={styles.metaRow}>
                <Text style={[styles.sub, { color: colors.textSecondary }]} numberOfLines={1}>
                  ~{activeAlert.etaMinutes} min ahead · Near {activeAlert.near}
                </Text>
              </View>
              <View style={styles.hintRow}>
                <Text style={[styles.hint, { color: tone.solid }]}>Tap for safe truck stops</Text>
                <Icon name="chevron-right" size={13} color={tone.solid} />
              </View>
            </View>

            <Pressable
              onPress={dismissToast}
              hitSlop={12}
              style={[styles.close, { backgroundColor: colors.surface2, borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel="Dismiss alert"
            >
              <Icon name="x" size={15} color={colors.textSecondary} />
            </Pressable>
          </View>

          {/* Auto-dismiss countdown — hugs the bottom edge of the glass. */}
          <View style={[styles.track, { backgroundColor: tone.solid + '22' }]}>
            <Animated.View style={[styles.trackFill, { width: barWidth, backgroundColor: tone.solid }]} />
          </View>
        </GlassView>
      </Pressable>
    </Animated.View>
  );
}

/* ── Full-screen alert modal (rendered globally) ── */
export function WeatherAlertModalGlobal() {
  const { colors } = useTheme();
  const { activeAlert, modalVisible, closeModal } = useAlert();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (!activeAlert) return null;

  const severe = activeAlert.severity === 'severe';
  const grad   = severe ? colors.gradients.weatherSevere : colors.gradients.weatherWarn;
  const accent = severe ? colors.danger : colors.caution;

  return (
    <Modal visible={modalVisible} animationType="slide" onRequestClose={closeModal}>
      <LinearGradient colors={grad} style={styles.alertScreen}>
        <View style={styles.alertInner}>
          <View style={[styles.alertBadge, { borderColor: accent }]}>
            <Icon name="alert-triangle" size={40} color={accent} />
          </View>
          <Text style={[styles.alertEta, { color: accent }]}>~{activeAlert.etaMinutes} MIN AHEAD</Text>
          <Text style={[styles.alertHeadline, { color: colors.textPrimary }]}>{activeAlert.title}</Text>
          <Text style={[styles.alertWhere, { color: colors.textSecondary }]}>Near {activeAlert.near}</Text>
          <Text style={[styles.alertAdvice, { color: colors.textSecondary }]}>{activeAlert.advice}</Text>
          <View style={{ height: space[6] }} />
          <PrimaryAction
            label="Find a safe truck stop"
            icon="map-pin"
            tone={severe ? 'danger' : 'caution'}
            onPress={() => Linking.openURL('https://www.google.com/maps/search/truck+stop+near+me').catch(() => {})}
          />
          <Pressable onPress={closeModal} style={styles.alertDismiss}>
            <Text style={[styles.alertDismissText, { color: colors.textMuted }]}>Got it — keep driving safe</Text>
          </Pressable>
        </View>
      </LinearGradient>
    </Modal>
  );
}

const makeStyles = (c) => StyleSheet.create({
  wrap: { position: 'absolute', left: space[4], right: space[4], zIndex: 999 },
  toast: { paddingTop: space[4], paddingBottom: space[4] + 3, paddingHorizontal: space[4] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  iconTile: {
    width: 46, height: 46, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  textCol: { flex: 1, minWidth: 0, gap: 1 },
  eyebrow: { ...type.label, fontSize: 10.5 },
  title: { fontSize: 16, fontFamily: FONT.extrabold, letterSpacing: -0.3, marginTop: 1 },
  metaRow: { marginTop: 1 },
  sub: { ...type.caption, fontSize: 12.5 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 4 },
  hint: { ...type.caption, fontSize: 12, fontFamily: FONT.bold },
  close: {
    width: 30, height: 30, borderRadius: 999, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  track: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: 3,
  },
  trackFill: { height: 3 },

  alertScreen: { flex: 1 },
  alertInner: { flex: 1, padding: space[6], justifyContent: 'center', gap: space[2] },
  alertBadge: { width: 88, height: 88, borderRadius: 999, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: space[4] },
  alertEta: { ...type.label, fontSize: 13 },
  alertHeadline: { fontSize: 34, fontFamily: FONT.extrabold, letterSpacing: -0.8 },
  alertWhere: { ...type.title },
  alertAdvice: { ...type.body, lineHeight: 24, marginTop: space[3] },
  alertDismiss: { alignItems: 'center', paddingVertical: space[4], marginTop: space[2] },
  alertDismissText: { ...type.bodyStrong },
});
