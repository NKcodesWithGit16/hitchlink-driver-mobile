import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, Pressable, Animated, Image, Platform, useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import Icon from '../ui/Icon';
import haptics from '../../lib/haptics';
import { useReduceMotion } from '../../lib/useReduceMotion';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n/LanguageContext';
import { money, distNum } from '../../lib/format';
import { space, type, radius, FONT, shadow, tap, toneOf, glassFor, motion } from '../../theme/tokens';

/* Long-press focus mode for one history card.
 *
 * Everything behind is blurred and dimmed; the pressed load lifts out of the
 * list — bigger type, its own shadow — so there is no doubt about WHICH load
 * is about to be removed. Delete is a two-step: the button arms a confirm
 * block in place, which is why this isn't Alert.alert (an Alert can't render
 * the card it's talking about, and RN-web has no Alert at all).
 *
 * Tapping the backdrop dismisses — except while the confirm is armed, where
 * an accidental outside tap should not be the thing that resolves it.
 */
export default function HistoryFocusOverlay({ load, when, miles, unit, onClose, onDelete }) {
  const { colors } = useTheme();
  const t = useT();
  const reduce = useReduceMotion();
  const { height } = useWindowDimensions();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const fade  = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  const scale = useRef(new Animated.Value(reduce ? 1 : 0.88)).current;

  useEffect(() => {
    if (reduce) return;
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: motion.duration.base, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, ...motion.spring.snappy, useNativeDriver: true }),
    ]).start();
  }, [reduce]);

  const g = glassFor(colors);
  const cancelled = load.status === 'Cancelled';
  const tone = toneOf(colors, cancelled ? 'danger' : 'go');
  const danger = toneOf(colors, 'danger');
  const photos = (load.photos || []).slice(0, 4);
  const extra  = (load.photos || []).length - photos.length;

  const arm = () => { haptics.warning(); setConfirming(true); };

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    haptics.success();
    await onDelete?.();
  };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      {/* Backdrop: blur + the theme's overlay dim so text stays legible even
          where the blur is weak (some Android devices). */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]} pointerEvents="none">
        <BlurView
          intensity={g.intensity + 30}
          tint={g.tint}
          experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
          style={StyleSheet.absoluteFill}
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} />
      </Animated.View>

      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={confirming ? () => setConfirming(false) : onClose}
        accessibilityRole="button"
        accessibilityLabel={t('earnings.closeFocusA11y')}
      />

      <View style={styles.center} pointerEvents="box-none">
        <Animated.View
          style={[styles.stack, { maxHeight: height - 120, opacity: fade, transform: [{ scale }] }]}
          pointerEvents="box-none"
        >
          {/* ── The focused load ── */}
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderStrong }, shadow.float]}>
            <View style={[styles.stripe, { backgroundColor: tone.solid }]} />
            <View style={styles.cardBody}>
              <View style={styles.topRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.route, { color: colors.textPrimary }]} numberOfLines={2}>
                    {load.origin} → {load.destination}
                  </Text>
                  <Text style={[styles.meta, { color: colors.textMuted }]} numberOfLines={1}>
                    {[when, miles, load.broker].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Text style={[styles.rate, { color: colors.textPrimary }]}>{money(load.rate)}</Text>
                  <View style={[styles.badge, { backgroundColor: tone.fill, borderColor: tone.solid + '55' }]}>
                    <Text style={[styles.badgeText, { color: tone.solid }]}>
                      {cancelled ? t('common.cancelled') : t('earnings.delivered')}
                    </Text>
                  </View>
                </View>
              </View>

              {photos.length > 0 ? (
                <View style={styles.photoRow}>
                  {photos.map((p, i) => (
                    <View key={p.id ?? i} style={styles.thumb}>
                      <Image source={{ uri: p.thumbnailUrl || p.url }} style={styles.thumbImg} />
                      {i === photos.length - 1 && extra > 0 ? (
                        <View style={styles.thumbMore}>
                          <Text style={styles.thumbMoreText}>+{extra}</Text>
                        </View>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          </View>

          {/* ── Action / confirm ── */}
          {confirming ? (
            <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.borderStrong }, shadow.float]}>
              <View style={[styles.panelIcon, { backgroundColor: danger.fill }]}>
                <Icon name="alert-triangle" size={20} color={danger.solid} />
              </View>
              <Text style={[styles.panelTitle, { color: colors.textPrimary }]}>{t('earnings.deleteConfirmTitle')}</Text>
              <Text style={[styles.panelBody, { color: colors.textSecondary }]}>{t('earnings.deleteConfirmBody')}</Text>
              <View style={styles.confirmRow}>
                <Pressable
                  onPress={() => { haptics.tap(); setConfirming(false); }}
                  disabled={busy}
                  style={({ pressed }) => [styles.ghostBtn, { borderColor: colors.borderStrong, opacity: pressed ? 0.7 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel={t('earnings.keepLoad')}
                >
                  <Text style={[styles.ghostText, { color: colors.textPrimary }]}>{t('earnings.keepLoad')}</Text>
                </Pressable>
                <Pressable
                  onPress={confirm}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.solidBtn,
                    { backgroundColor: danger.solid, opacity: busy ? 0.6 : pressed ? 0.85 : 1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.delete')}
                >
                  <Icon name="trash-2" size={17} color={danger.ink} />
                  <Text style={[styles.solidText, { color: danger.ink }]}>{t('common.delete')}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.actions}>
              <Pressable
                onPress={arm}
                style={({ pressed }) => [
                  styles.deleteBtn,
                  { backgroundColor: danger.solid, transform: [{ scale: pressed ? motion.press : 1 }] },
                  shadow.glow(danger.solid),
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('earnings.deleteFromHistory')}
              >
                <Icon name="trash-2" size={20} color={danger.ink} />
                <Text style={[styles.deleteText, { color: danger.ink }]}>{t('earnings.deleteFromHistory')}</Text>
              </Pressable>
              <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('earnings.deleteHint')}</Text>
              <Pressable
                onPress={onClose}
                hitSlop={8}
                style={styles.cancelBtn}
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
              >
                <Text style={[styles.cancelText, { color: colors.textPrimary }]}>{t('common.cancel')}</Text>
              </Pressable>
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space[5] },
  stack: { width: '100%', maxWidth: 460, gap: space[4] },

  card: { flexDirection: 'row', borderRadius: radius.xl, borderWidth: 1, overflow: 'hidden' },
  stripe: { width: 5, flexShrink: 0 },
  cardBody: { flex: 1, padding: space[5], gap: space[4] },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[3] },
  route: { fontSize: 20, fontFamily: FONT.black, letterSpacing: -0.4, lineHeight: 26 },
  meta: { ...type.caption, marginTop: 5 },
  rate: { fontSize: 24, fontFamily: FONT.black, letterSpacing: -0.6 },
  badge: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontFamily: FONT.black, letterSpacing: 0.2 },
  photoRow: { flexDirection: 'row', gap: space[2] },
  thumb: { width: 62, height: 62, borderRadius: radius.md, overflow: 'hidden', backgroundColor: 'rgba(127,127,127,0.15)' },
  thumbImg: { width: '100%', height: '100%' },
  thumbMore: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  thumbMoreText: { color: '#FFFFFF', fontSize: 15, fontFamily: FONT.black },

  actions: { gap: space[3] },
  deleteBtn: {
    minHeight: tap.primary, borderRadius: radius.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: space[5],
  },
  deleteText: { fontSize: 16, fontFamily: FONT.bold },
  hint: { ...type.caption, textAlign: 'center', lineHeight: 19, paddingHorizontal: space[3] },
  cancelBtn: { minHeight: tap.icon, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 15, fontFamily: FONT.bold },

  panel: { borderRadius: radius.xl, borderWidth: 1, padding: space[5], gap: space[2], alignItems: 'center' },
  panelIcon: { width: 44, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center', marginBottom: space[1] },
  panelTitle: { fontSize: 18, fontFamily: FONT.black, textAlign: 'center' },
  panelBody: { ...type.caption, textAlign: 'center', lineHeight: 20 },
  confirmRow: { flexDirection: 'row', gap: space[3], marginTop: space[3], alignSelf: 'stretch' },
  ghostBtn: {
    flex: 1, minHeight: tap.secondary, borderRadius: radius.lg, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  ghostText: { fontSize: 15, fontFamily: FONT.bold },
  solidBtn: {
    flex: 1, minHeight: tap.secondary, borderRadius: radius.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  solidText: { fontSize: 15, fontFamily: FONT.black },
});
