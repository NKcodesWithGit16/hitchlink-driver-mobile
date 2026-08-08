import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, Animated, Easing } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from '../src/components/ui/Icon';
import FadeInView from '../src/components/ui/FadeInView';
import haptics from '../src/lib/haptics';
import { useTheme } from '../src/theme/ThemeContext';
import { useT } from '../src/i18n/LanguageContext';
import { useAuth } from '../src/context/AuthContext';
import { deleteOwnAccount, fetchActiveLoad } from '../src/api/main';
import { unregisterPushNotifications } from '../src/hooks/usePushNotifications';
import { reportError } from '../src/lib/observability';
import { space, type, radius, FONT } from '../src/theme/tokens';

/* Account deletion.
 *
 * Apple requires this of any app that lets people create an account in-app,
 * and it has to be completable here — it cannot be gated behind the
 * dispatcher's approval or a phone call to support.
 *
 * That requirement pulls against the other one: a driver must never end their
 * own career by mis-tapping a phone in a moving truck. So the deletion is easy
 * to REACH and deliberately slow to COMPLETE. Four gates, none of which can
 * fire by accident:
 *
 *   1. a quiet text link at the bottom of More, not a button
 *   2. this screen, which you have to navigate to on purpose
 *   3. a checkbox, so the consequences have been looked at
 *   4. a three-second press-and-hold, then the OS's own confirm
 *
 * The hold is deliberately not a "type DELETE to confirm" box: that word is
 * English, and a driver whose phone is in Georgian would be typing a foreign
 * string to close their own account. A long press means the same thing in
 * every language.
 */

const HOLD_MS = 3000;

export default function DeleteAccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const t = useT();
  const { userId, signOut } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [understood, setUnderstood] = useState(false);
  const [activeLoad, setActiveLoad] = useState(null);
  const [holding, setHolding] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const progress = useRef(new Animated.Value(0)).current;
  const holdAnim = useRef(null);

  // Warn if a delivery is in flight. Advisory only — the server does not refuse
  // on this, because refusing is exactly the obstacle Apple does not allow.
  useEffect(() => {
    let alive = true;
    fetchActiveLoad(userId)
      .then((load) => { if (alive) setActiveLoad(load); })
      .catch(() => {});
    return () => { alive = false; };
  }, [userId]);

  const cancelHold = useCallback(() => {
    holdAnim.current?.stop();
    holdAnim.current = null;
    setHolding(false);
    Animated.timing(progress, {
      toValue: 0, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: false,
    }).start();
  }, [progress]);

  const runDeletion = useCallback(async () => {
    setDeleting(true);

    // Push first, while the token is still good. Afterwards this call would
    // 401 against an account that no longer exists, and a failed refresh would
    // send the driver to sign-in under "your dispatcher removed your access" —
    // an accusation, aimed at someone who just closed their own account. It
    // also has to happen at all: a token left registered would keep delivering
    // this fleet's alerts to a phone that is no longer theirs.
    try { await unregisterPushNotifications(userId); } catch {}

    try {
      await deleteOwnAccount();
    } catch (err) {
      reportError(err, { where: 'deleteOwnAccount' });
      haptics.error();
      setDeleting(false);
      Alert.alert(t('deleteAccount.failedTitle'), t('deleteAccount.failedBody'));
      return;
    }

    haptics.success();

    // The account is gone; from here nothing may report failure. signOut still
    // has local work to do — stopping the background GPS task, cancelling the
    // on-device reminders, wiping the cached copies of their CDL and medical
    // card — none of which deleting a server row can reach. If any of it
    // throws we still leave, because the alternative is telling someone their
    // deletion failed after it succeeded.
    try {
      await signOut({ skipRemote: true });
    } catch (err) {
      reportError(err, { where: 'deleteOwnAccount:signOut' });
    }
    router.replace('/welcome');
  }, [signOut, router, t, userId]);

  // Gate 4: the OS's own dialog. Cancel is the default and destructive styling
  // marks the other one, so the last thing standing between a driver and a
  // closed account is a system control they already know how to read.
  const confirmAndDelete = useCallback(() => {
    haptics.warning();
    Alert.alert(
      t('deleteAccount.confirmTitle'),
      t('deleteAccount.confirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel', onPress: cancelHold },
        { text: t('deleteAccount.confirmCta'), style: 'destructive', onPress: runDeletion },
      ],
      { cancelable: true, onDismiss: cancelHold },
    );
  }, [t, cancelHold, runDeletion]);

  const startHold = useCallback(() => {
    if (!understood || deleting) return;
    haptics.press();
    setHolding(true);
    progress.setValue(0);
    holdAnim.current = Animated.timing(progress, {
      toValue: 1,
      duration: HOLD_MS,
      easing: Easing.linear,
      // Animating a width, which the native driver cannot do.
      useNativeDriver: false,
    });
    holdAnim.current.start(({ finished }) => {
      // Only a hold that ran the full three seconds counts. A finger lifted
      // early stops the animation, which arrives here as finished: false.
      if (finished) confirmAndDelete();
    });
  }, [understood, deleting, progress, confirmAndDelete]);

  const fillWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const canDelete = understood && !deleting;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => { haptics.tap(); router.back(); }}
          hitSlop={8}
          style={styles.headerBack}
          accessibilityRole="button"
        >
          <Icon name="chevron-left" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>
          {t('deleteAccount.title')}
        </Text>
        <View style={styles.headerBack} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space[6] }]}
        showsVerticalScrollIndicator={false}
      >
        <FadeInView delay={0}>
          <Text style={[styles.heading, { color: colors.textPrimary }]}>
            {t('deleteAccount.heading')}
          </Text>
          <Text style={[styles.intro, { color: colors.textSecondary }]}>
            {t('deleteAccount.intro')}
          </Text>
        </FadeInView>

        {activeLoad ? (
          <FadeInView delay={60}>
            <View style={[styles.warn, { backgroundColor: colors.cautionFill, borderColor: colors.caution + '55' }]}>
              <Icon name="alert-triangle" size={18} color={colors.caution} />
              <View style={styles.warnText}>
                <Text style={[styles.warnTitle, { color: colors.caution }]}>
                  {t('deleteAccount.activeLoadTitle')}
                </Text>
                <Text style={[styles.warnBody, { color: colors.textSecondary }]}>
                  {t('deleteAccount.activeLoadBody')}
                </Text>
              </View>
            </View>
          </FadeInView>
        ) : null}

        <FadeInView delay={120}>
          <Section
            title={t('deleteAccount.erasedTitle')}
            tone={colors.danger}
            icon="trash-2"
            styles={styles}
            colors={colors}
            items={[
              t('deleteAccount.erasedName'),
              t('deleteAccount.erasedPhoto'),
              t('deleteAccount.erasedDocs'),
              t('deleteAccount.erasedLocation'),
            ]}
          />
        </FadeInView>

        <FadeInView delay={180}>
          <Section
            title={t('deleteAccount.keptTitle')}
            tone={colors.textSecondary}
            icon="archive"
            styles={styles}
            colors={colors}
            items={[t('deleteAccount.keptLoads')]}
          />
        </FadeInView>

        {/* Gate 3 */}
        <FadeInView delay={240}>
          <Pressable
            onPress={() => { haptics.tap(); setUnderstood((v) => !v); cancelHold(); }}
            style={[styles.check, { borderColor: understood ? colors.danger : colors.border }]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: understood }}
            disabled={deleting}
          >
            <View style={[
              styles.checkBox,
              { borderColor: understood ? colors.danger : colors.borderStrong,
                backgroundColor: understood ? colors.danger : 'transparent' },
            ]}>
              {understood ? <Icon name="check" size={14} color={colors.textInverse} /> : null}
            </View>
            <Text style={[styles.checkLabel, { color: colors.textPrimary }]}>
              {t('deleteAccount.understand')}
            </Text>
          </Pressable>
        </FadeInView>

        {/* Gate 4a — the hold */}
        <FadeInView delay={300}>
          <Pressable
            onPressIn={startHold}
            onPressOut={cancelHold}
            disabled={!canDelete}
            style={[
              styles.holdBtn,
              { borderColor: canDelete ? colors.danger : colors.border,
                opacity: canDelete ? 1 : 0.45 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('deleteAccount.holdToDelete')}
            accessibilityState={{ disabled: !canDelete }}
          >
            <Animated.View
              pointerEvents="none"
              style={[styles.holdFill, { width: fillWidth, backgroundColor: colors.dangerFill }]}
            />
            <Icon name="trash-2" size={18} color={colors.danger} />
            <Text style={[styles.holdText, { color: colors.danger }]}>
              {deleting
                ? t('deleteAccount.deleting')
                : holding ? t('deleteAccount.holdingCancelled') : t('deleteAccount.holdToDelete')}
            </Text>
          </Pressable>
        </FadeInView>
      </ScrollView>
    </View>
  );
}

function Section({ title, items, tone, icon, styles, colors }) {
  return (
    <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <View style={styles.sectionHead}>
        <Icon name={icon} size={16} color={tone} />
        <Text style={[styles.sectionTitle, { color: tone }]}>{title}</Text>
      </View>
      {items.map((line) => (
        <View key={line} style={styles.row}>
          <View style={[styles.dot, { backgroundColor: tone }]} />
          <Text style={[styles.rowText, { color: colors.textSecondary }]}>{line}</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space[4], paddingBottom: space[3],
  },
  headerBack: { minWidth: 44, minHeight: 44, alignItems: 'flex-start', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontFamily: FONT.bold },

  body: { paddingHorizontal: space[4], gap: space[4] },
  heading: { ...type.h2, marginBottom: space[2] },
  intro: { fontSize: 15, lineHeight: 22, fontFamily: FONT.regular },

  warn: {
    flexDirection: 'row', gap: space[3], padding: space[3],
    borderRadius: radius.lg, borderWidth: 1,
  },
  warnText: { flex: 1, gap: 2 },
  warnTitle: { fontSize: 14, fontFamily: FONT.bold },
  warnBody: { fontSize: 13, lineHeight: 19, fontFamily: FONT.regular },

  section: { borderRadius: radius.lg, borderWidth: 1, padding: space[3], gap: space[2] },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginBottom: space[1] },
  sectionTitle: { fontSize: 13, fontFamily: FONT.bold, letterSpacing: 0.4, textTransform: 'uppercase' },
  row: { flexDirection: 'row', gap: space[2], alignItems: 'flex-start' },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 8 },
  rowText: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: FONT.regular },

  check: {
    flexDirection: 'row', alignItems: 'center', gap: space[3],
    padding: space[3], borderRadius: radius.lg, borderWidth: 1,
  },
  checkBox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  checkLabel: { flex: 1, fontSize: 14, fontFamily: FONT.medium },

  holdBtn: {
    height: 64, borderRadius: radius.lg, borderWidth: 2,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2],
    overflow: 'hidden',
  },
  holdFill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  holdText: { fontSize: 16, fontFamily: FONT.bold },
});
