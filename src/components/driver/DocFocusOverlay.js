import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, Pressable, Animated, Platform, useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from '../ui/Icon';
import GlassView from '../ui/GlassView';
import DocThumb from './DocThumb';
import haptics from '../../lib/haptics';
import { useReduceMotion } from '../../lib/useReduceMotion';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n/LanguageContext';
import { expiryStatus, fmtDate } from '../../lib/format';
import {
  space, type, radius, FONT, tap, elevation, toneOf, glassFor, motion,
} from '../../theme/tokens';

/* Long-press focus mode for one document.
 *
 * A tap on a card opens the document itself, which is what a driver wants 95%
 * of the time and what the card promises. That left Renew and Delete without a
 * home, so they live here — the same gesture, the same blurred lift-out-of-the-
 * list treatment, as the Pay tab's load history.
 *
 * Renew is deliberately ALSO on the card for anything expired or expiring. A
 * long press advertises nothing, and burying the fix for a lapsed CDL behind an
 * invisible gesture would recreate the dead end this screen just stopped having.
 * What the overlay adds is renewing a document that is still valid — a new
 * insurance card that arrived early — plus delete, which is secondary and
 * destructive and belongs somewhere you have to mean it.
 *
 * Neither action carries a caption: "Upload renewal" and "Delete document" are
 * self-evident. (The Pay tab keeps its captions because hide and delete SOUND
 * alike there and the difference is what the captions carry.)
 *
 * Delete arms a confirm in place rather than calling Alert.alert, for the same
 * reasons as HistoryFocusOverlay: an Alert can't render the document it is
 * talking about, and RN-web has no Alert at all. Tapping the backdrop dismisses,
 * except while that confirm is armed.
 *
 * MATERIALS, and the split is deliberate. The document is SOLID — it is the
 * card lifted out of the list, and it has to keep reading as that object, with
 * its own thumbnail and status stripe. The action menu is GLASS, the material
 * tokens.js reserves for overlay chrome. Solid subject, frosted chrome: the
 * hierarchy is legible before a single word is read.
 *
 * Exactly ONE glass layer, though, and that is a budget rather than a taste.
 * Every GlassView is a live BlurView on top of the backdrop's, and plenty of
 * drivers are on cheap Android handsets where `dimezisBlurView` is expensive.
 * Cancel and the delete confirm stay opaque — which is also the iOS convention
 * for both, so nothing is given up for the frame budget.
 *
 * The three layers rise on a `motion.stagger` so the document lands first and
 * the actions follow it, which is what makes the sheet feel like it came out of
 * the card rather than on top of it. All of it collapses to instant under
 * useReduceMotion.
 */

const ROW_ICON = 36;
// Hairlines start after the icon column, the way native lists inset theirs.
const DIVIDER_INSET = space[5] + ROW_ICON + space[3];

export default function DocFocusOverlay({ doc, offline, onClose, onRenew, onDelete }) {
  const { colors } = useTheme();
  const t = useT();
  const reduce = useReduceMotion();
  const { height } = useWindowDimensions();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const fade = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  // One per layer: the document, the menu, Cancel.
  const layers = useRef([0, 1, 2].map(() => new Animated.Value(reduce ? 1 : 0))).current;

  useEffect(() => {
    if (reduce) return;
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: motion.duration.base, useNativeDriver: true }),
      Animated.stagger(
        motion.stagger,
        layers.map((v) => Animated.spring(v, { toValue: 1, ...motion.spring.snappy, useNativeDriver: true })),
      ),
    ]).start();
  }, [reduce]);

  if (!doc) return null;

  const g      = glassFor(colors);
  const status = expiryStatus(doc.expires);
  const tone   = toneOf(colors, status.tone);
  const danger = toneOf(colors, 'danger');
  const meta   = [
    doc.number,
    doc.expires ? t('documents.expiresOn', { date: fmtDate(doc.expires, t('common.monthsShort')) }) : null,
  ].filter(Boolean).join(' · ');

  // A spring settles past 1, so opacity is clamped rather than driven raw.
  const rise = (v) => ({
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [
      { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) },
      { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
    ],
  });

  const arm = () => { haptics.warning(); setConfirming(true); };

  const renew = async () => {
    if (busy) return;
    setBusy(true);
    haptics.tap();
    await onRenew?.();
  };

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    // Not haptics.success — nothing good happened, something irreversible did.
    haptics.warning();
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
        accessibilityLabel={t('documents.closeFocusA11y')}
      />

      <View style={styles.center} pointerEvents="box-none">
        <View style={[styles.stack, { maxHeight: height - 120 }]} pointerEvents="box-none">

          {/* ── The focused document ──
              Two views, and it has to stay that way: iOS clips a shadow to the
              layer bounds the moment `overflow: hidden` is set, and the stripe
              needs that clip to follow the rounded corner. So the outer view
              owns the fill and the shadow, the inner one owns the clipping. */}
          <Animated.View
            style={[styles.cardLift, { backgroundColor: colors.surface }, elevation[4], rise(layers[0])]}
          >
            <View style={[styles.card, { borderColor: colors.borderStrong }]}>
              <LinearGradient
                colors={tone.grad}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={styles.stripe}
              />
              <View style={styles.cardBody}>
                <DocThumb
                  doc={doc}
                  tone={tone}
                  size={56}
                  style={[styles.thumb, { borderColor: tone.solid + '40' }]}
                />
                <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
                  <Text style={[styles.label, { color: colors.textPrimary }]} numberOfLines={2}>
                    {doc.label}
                  </Text>
                  <View style={styles.metaRow}>
                    <Text style={[styles.meta, { color: colors.textMuted }]} numberOfLines={1}>
                      {meta || doc.sub}
                    </Text>
                    {offline ? (
                      <View
                        style={[styles.savedDot, { backgroundColor: colors.goFill }]}
                        accessibilityLabel={t('documents.offlineReady')}
                      >
                        <Icon name="check" size={11} color={colors.go} />
                      </View>
                    ) : null}
                  </View>
                  <View style={[styles.badge, { backgroundColor: tone.fill, borderColor: tone.solid + '55' }]}>
                    <View style={[styles.dot, { backgroundColor: tone.solid }]} />
                    <Text style={[styles.badgeText, { color: tone.solid }]}>
                      {t(status.labelKey, status.labelParams)}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </Animated.View>

          {/* ── Action / confirm ── */}
          {confirming ? (
            <Animated.View
              style={[
                styles.panel,
                { backgroundColor: colors.surface, borderColor: colors.borderStrong },
                elevation[4],
                rise(layers[1]),
              ]}
            >
              <View style={[styles.panelIcon, { backgroundColor: danger.fill }]}>
                <Icon name="alert-triangle" size={20} color={danger.solid} />
              </View>
              <Text style={[styles.panelTitle, { color: colors.textPrimary }]}>
                {t('documents.deleteConfirmTitle')}
              </Text>
              <Text style={[styles.panelBody, { color: colors.textSecondary }]}>
                {t('documents.deleteConfirmBody')}
              </Text>
              <View style={styles.confirmRow}>
                <Pressable
                  onPress={() => { haptics.tap(); setConfirming(false); }}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.ghostBtn,
                    { borderColor: colors.borderStrong, opacity: pressed ? 0.7 : 1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={t('documents.keepDocument')}
                >
                  <Text style={[styles.ghostText, { color: colors.textPrimary }]}>
                    {t('documents.keepDocument')}
                  </Text>
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
                  <Icon name={busy ? 'loader' : 'trash-2'} size={17} color={danger.ink} />
                  <Text style={[styles.solidText, { color: danger.ink }]}>
                    {busy ? t('documents.deleting') : t('common.delete')}
                  </Text>
                </Pressable>
              </View>
            </Animated.View>
          ) : (
            <>
              {/* Renew leads: it is the constructive one, and for a document
                  that hasn't lapsed yet this sheet is the only route to it. */}
              <Animated.View style={[elevation[3], rise(layers[1])]}>
                <GlassView radius={radius.xl}>
                  <Pressable
                    onPress={renew}
                    disabled={busy}
                    style={({ pressed }) => [
                      styles.row,
                      { backgroundColor: pressed ? colors.borderStrong : 'transparent', opacity: busy ? 0.6 : 1 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={t('documents.renewA11y', { label: doc.label })}
                  >
                    <View style={[styles.rowIcon, { backgroundColor: colors.tealFill }]}>
                      <Icon name="upload" size={18} color={colors.teal} />
                    </View>
                    <Text style={[styles.rowText, { color: colors.textPrimary }]}>
                      {t('documents.uploadRenewal')}
                    </Text>
                  </Pressable>

                  <View style={[styles.rowDivider, { backgroundColor: colors.border }]} />

                  <Pressable
                    onPress={arm}
                    disabled={busy}
                    style={({ pressed }) => [
                      styles.row,
                      { backgroundColor: pressed ? danger.fill : 'transparent' },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={t('documents.deleteDocument')}
                  >
                    <View style={[styles.rowIcon, { backgroundColor: danger.fill }]}>
                      <Icon name="trash-2" size={18} color={danger.solid} />
                    </View>
                    <Text style={[styles.rowText, { color: danger.solid }]}>
                      {t('documents.deleteDocument')}
                    </Text>
                  </Pressable>
                </GlassView>
              </Animated.View>

              {/* Opaque, not glass — one live blur over the backdrop is the
                  budget, and iOS sheets make their Cancel the solid one too. */}
              <Animated.View
                style={[styles.cancelLift, { backgroundColor: colors.surface }, elevation[3], rise(layers[2])]}
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
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space[5] },
  stack: { width: '100%', maxWidth: 440, gap: space[3] },

  /* The document, lifted out of the list */
  cardLift: { borderRadius: radius.xl },
  card: { flexDirection: 'row', borderRadius: radius.xl, borderWidth: 1, overflow: 'hidden' },
  stripe: { width: 5, flexShrink: 0 },
  cardBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[4], padding: space[5] },
  thumb: { borderWidth: 1 },
  label: { ...type.title, lineHeight: 25 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  meta: { ...type.caption, ...type.num, flexShrink: 1 },
  savedDot: { width: 20, height: 20, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  badge: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4, marginTop: 2,
  },
  dot: { width: 6, height: 6, borderRadius: 999 },
  badgeText: { fontSize: 10, fontFamily: FONT.black, letterSpacing: 0.2 },

  /* Action menu */
  row: {
    minHeight: tap.secondary, flexDirection: 'row', alignItems: 'center',
    gap: space[3], paddingHorizontal: space[5], paddingVertical: space[2],
  },
  rowIcon: {
    width: ROW_ICON, height: ROW_ICON, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  rowText: { fontSize: 16, fontFamily: FONT.bold, letterSpacing: -0.2 },
  rowDivider: { height: StyleSheet.hairlineWidth, marginLeft: DIVIDER_INSET },
  cancelLift: { borderRadius: radius.xl },
  cancelWrap: { borderRadius: radius.xl, borderWidth: 1, overflow: 'hidden' },
  cancelBtn: { minHeight: tap.secondary, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 16, fontFamily: FONT.bold, letterSpacing: -0.2 },

  /* Delete confirm */
  panel: {
    borderRadius: radius.xl, borderWidth: 1,
    padding: space[5], gap: space[2], alignItems: 'center',
  },
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
