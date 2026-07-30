import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from '../src/components/ui/Icon';
import FadeInView from '../src/components/ui/FadeInView';
import Skeleton from '../src/components/ui/Skeleton';
import haptics from '../src/lib/haptics';
import { useTheme } from '../src/theme/ThemeContext';
import { useT } from '../src/i18n/LanguageContext';
import { useAuth } from '../src/context/AuthContext';
import { fetchLoadHistory } from '../src/api/main';
import { getHidden, unhideLoad, deleteLoad, clearHidden, deleteAllHidden, hydrateHidden, daysLeft } from '../src/lib/hiddenLoads';
import { money, distNum } from '../src/lib/format';
import { useDistanceUnit } from '../src/lib/prefs';
import { space, type, radius, FONT, shadow, toneOf } from '../src/theme/tokens';
import { useCallBannerInset } from '../src/components/call/CallOverlay';

/* Everything the driver removed from their Pay-tab history that can still be
   brought back. The hidden list is device-local (src/lib/hiddenLoads.js) and
   each entry keeps a snapshot of its load, so this screen still renders with no
   signal — live history is merged over the top whenever the fetch succeeds.

   Only entries inside the 3-week restore window appear: `getHidden` already
   filters out removals that have gone permanent, and each row counts down the
   days it has left so the deadline is never a surprise. */
export default function HiddenLoadsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const callInset = useCallBannerInset();
  const { colors } = useTheme();
  const t = useT();
  const { userId } = useAuth();
  const unit = useDistanceUnit();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [entries, setEntries] = useState(null); // null = still loading

  useEffect(() => {
    let alive = true;
    (async () => {
      const stored = await getHidden(userId);
      // A history failure is not fatal here — the snapshots carry the list.
      let history = [];
      try { history = await fetchLoadHistory(userId); } catch {}
      if (alive) setEntries(hydrateHidden(stored, history));
    })();
    return () => { alive = false; };
  }, [userId]);

  const restore = useCallback(async (id) => {
    haptics.success();
    await unhideLoad(userId, id);
    setEntries((prev) => (prev || []).filter((e) => e.id !== id));
  }, [userId]);

  const restoreAll = useCallback(async () => {
    haptics.success();
    await clearHidden(userId);
    setEntries([]);
  }, [userId]);

  // Deliberately no confirm step here, unlike the long-press in the Pay tab.
  // The driver came to a screen that exists only for removed loads and picked
  // one out of it — the intent is already unambiguous, and a load that is
  // already out of their history has nothing left to protect.
  const deleteEntry = useCallback(async (e) => {
    haptics.warning();
    await deleteLoad(userId, e);
    setEntries((prev) => (prev || []).filter((x) => x.id !== e.id));
  }, [userId]);

  const deleteAll = useCallback(async () => {
    haptics.warning();
    await deleteAllHidden(userId);
    setEntries([]);
  }, [userId]);

  const danger = toneOf(colors, 'danger');
  const months = t('common.monthsShort');
  const fmtWhen = (x) => {
    if (!x) return '';
    const d = new Date(x);
    return isNaN(d.getTime()) ? String(x) : `${months[d.getMonth()]} ${d.getDate()}`;
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + callInset }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => { haptics.tap(); router.back(); }}
          style={[styles.backBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <Icon name="chevron-left" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>{t('hiddenLoads.title')}</Text>
        <Pressable
          onPress={restoreAll}
          disabled={!entries?.length}
          hitSlop={8}
          style={styles.headerAction}
          accessibilityRole="button"
          accessibilityLabel={t('hiddenLoads.restoreAll')}
          accessibilityState={{ disabled: !entries?.length }}
        >
          <Text style={[styles.headerActionText, { color: entries?.length ? colors.teal : colors.textMuted }]}>
            {t('hiddenLoads.restoreAll')}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + (entries?.length ? 104 : space[8]) }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.blurb, { color: colors.textSecondary }]}>{t('hiddenLoads.blurb')}</Text>

        {entries === null ? (
          [0, 1, 2].map((i) => (
            <View key={i} style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ flex: 1, gap: 8 }}>
                <Skeleton width="70%" height={15} />
                <Skeleton width="45%" height={11} />
              </View>
              <Skeleton width={72} height={36} radius={radius.pill} />
            </View>
          ))
        ) : entries.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Icon name="eye" size={22} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{t('hiddenLoads.empty')}</Text>
          </View>
        ) : (
          entries.map((e, i) => {
            const tone = toneOf(colors, e.status === 'Cancelled' ? 'danger' : 'go');
            // Days left before this removal becomes permanent. The last day
            // reads as urgent (amber) — after it, the row is simply gone.
            const left = daysLeft(e);
            const urgent = left <= 3;
            return (
              <FadeInView key={e.id} delay={Math.min(i, 6) * 50}>
                <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={[styles.dot, { backgroundColor: tone.solid }]} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.route, { color: colors.textPrimary }]} numberOfLines={1}>
                      {e.origin} → {e.destination}
                    </Text>
                    <Text style={[styles.meta, { color: colors.textMuted }]} numberOfLines={1}>
                      {fmtWhen(e.completedAt)} · {distNum(e.miles, unit)} {unit} · {money(e.rate)}
                    </Text>
                    <Text style={[styles.countdown, { color: urgent ? colors.caution : colors.textMuted }]} numberOfLines={1}>
                      {left <= 1 ? t('hiddenLoads.lastDay') : t('hiddenLoads.daysLeft', { days: left })}
                    </Text>
                  </View>
                  <View style={styles.rowActions}>
                    <Pressable
                      onPress={() => restore(e.id)}
                      style={({ pressed }) => [styles.restoreBtn, { borderColor: colors.teal, opacity: pressed ? 0.7 : 1 }]}
                      accessibilityRole="button"
                      accessibilityLabel={t('hiddenLoads.restoreA11y', { origin: e.origin, destination: e.destination })}
                    >
                      <Icon name="rotate-ccw" size={14} color={colors.teal} />
                      <Text style={[styles.restoreText, { color: colors.teal }]}>{t('hiddenLoads.restore')}</Text>
                    </Pressable>
                    {/* Icon-only, and quieter than Restore: this row exists to
                        bring the load back, so the destructive option shouldn't
                        compete with that for the thumb. */}
                    <Pressable
                      onPress={() => deleteEntry(e)}
                      style={({ pressed }) => [styles.deleteBtn, { borderColor: danger.solid + '55', backgroundColor: pressed ? danger.fill : 'transparent' }]}
                      accessibilityRole="button"
                      accessibilityLabel={t('hiddenLoads.deleteA11y', { origin: e.origin, destination: e.destination })}
                    >
                      <Icon name="trash-2" size={16} color={danger.solid} />
                    </Pressable>
                  </View>
                </View>
              </FadeInView>
            );
          })
        )}

      </ScrollView>

      {/* Same floating action as the notifications feed: hovers over the list
          so it stays reachable however far down the driver has scrolled.
          No undo behind it, unlike Alerts — these deletes are permanent, and
          the list padding above leaves room so it never covers the last row. */}
      {entries?.length ? (
        <View style={[styles.floatWrap, { bottom: insets.bottom + space[4] }]} pointerEvents="box-none">
          <Pressable
            onPress={deleteAll}
            style={({ pressed }) => [styles.deleteAll, shadow.glow(colors.danger), { transform: [{ scale: pressed ? 0.96 : 1 }] }]}
            accessibilityRole="button"
            accessibilityLabel={t('hiddenLoads.deleteAllA11y', { count: entries.length })}
          >
            <LinearGradient
              colors={['#A81719', '#7E1012']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.deleteAllInner}
            >
              <Icon name="trash-2" size={17} color="#FFFFFF" />
              <Text style={styles.deleteAllText}>{t('hiddenLoads.deleteAll')}</Text>
            </LinearGradient>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space[4], paddingVertical: space[3],
  },
  backBtn: {
    width: 44, height: 44, borderRadius: 999, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontFamily: FONT.bold },
  headerAction: { minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  headerActionText: { fontSize: 14, fontFamily: FONT.bold },

  scroll: { paddingHorizontal: space[4], gap: space[3] },
  blurb: { ...type.caption, lineHeight: 19, paddingHorizontal: space[1], marginBottom: space[1] },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: space[3],
    borderRadius: radius.lg, borderWidth: 1, padding: space[4],
  },
  dot: { width: 8, height: 8, borderRadius: 999, flexShrink: 0 },
  route: { ...type.bodyStrong },
  meta: { ...type.caption, marginTop: 2 },
  countdown: { fontSize: 11, fontFamily: FONT.bold, marginTop: 4 },
  // Restore and delete are one action group, tighter than the row's own gap.
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexShrink: 0 },
  restoreBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0,
    borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space[3], minHeight: 40,
  },
  restoreText: { fontSize: 13, fontFamily: FONT.black },
  deleteBtn: {
    width: 40, height: 40, borderRadius: 999, borderWidth: 1, flexShrink: 0,
    alignItems: 'center', justifyContent: 'center',
  },

  floatWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  deleteAll: { borderRadius: radius.pill },
  deleteAllInner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2],
    minWidth: 220,
    paddingHorizontal: space[7], paddingVertical: space[3] + 2,
    borderRadius: radius.pill, overflow: 'hidden',
  },
  deleteAllText: { ...type.caption, fontSize: 14.5, fontFamily: FONT.extrabold, color: '#FFFFFF', letterSpacing: 0.2 },

  empty: { borderRadius: radius.lg, borderWidth: 1, padding: space[5], alignItems: 'center', gap: space[2] },
  emptyText: { ...type.caption, textAlign: 'center', lineHeight: 19, maxWidth: 280 },
});
