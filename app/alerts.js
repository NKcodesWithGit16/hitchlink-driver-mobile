import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import Icon from '../src/components/ui/Icon';
import FadeInView from '../src/components/ui/FadeInView';
import UndoToast from '../src/components/ui/UndoToast';
import NotificationCard from '../src/components/driver/NotificationCard';
import haptics from '../src/lib/haptics';
import { useTheme } from '../src/theme/ThemeContext';
import { useNotifications } from '../src/context/AlertContext';
import { space, type, radius, FONT, motion, shadow } from '../src/theme/tokens';

// Chip → which categories it shows (+ an icon so it reads at a glance).
// 'all' is a passthrough.
const FILTERS = [
  { key: 'all', label: 'All', icon: 'inbox', cats: null },
  { key: 'load', label: 'Loads', icon: 'truck', cats: ['load'] },
  { key: 'hos', label: 'Safety', icon: 'shield', cats: ['hos'] },
  { key: 'document', label: 'Docs', icon: 'file-text', cats: ['document'] },
  { key: 'earnings', label: 'Pay', icon: 'dollar-sign', cats: ['earnings'] },
  { key: 'weather', label: 'Weather', icon: 'cloud', cats: ['weather'] },
];

export default function AlertsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const {
    notifications, unreadCount, markRead, markAllRead, dismiss, clearAll, restoreAll,
    commitPending, refresh, openModal,
  } = useNotifications();
  const [filter, setFilter] = useState('all');
  const [undo, setUndo] = useState(null); // { message, snapshot }

  // Pull the freshest inbox when the screen opens.
  useEffect(() => { refresh(); }, [refresh]);

  // If the driver leaves while an Undo is still pending, commit the deferred
  // deletes so the removed rows don't resurrect on the next refetch.
  const commitRef = useRef(commitPending);
  commitRef.current = commitPending;
  useEffect(() => () => commitRef.current(), []);

  // Both removal paths snapshot the full list first, so a single Undo restores
  // whatever was there — whether the driver removed one card or all of them.
  const removeOne = useCallback((item) => {
    haptics.press();
    setUndo({ message: 'Notification removed', snapshot: notifications });
    dismiss(item.id);
  }, [notifications, dismiss]);

  const handleRemoveAll = useCallback(() => {
    haptics.press();
    setUndo({ message: 'All notifications removed', snapshot: notifications });
    clearAll();
  }, [notifications, clearAll]);

  const active = FILTERS.find((f) => f.key === filter) || FILTERS[0];
  const list = useMemo(
    () => (active.cats ? notifications.filter((n) => active.cats.includes(n.category)) : notifications),
    [notifications, active],
  );

  // Live counts per filter — the badges are what make the chips feel like a
  // real, populated control instead of static labels.
  const counts = useMemo(() => {
    const c = { all: notifications.length };
    for (const f of FILTERS) {
      if (f.cats) c[f.key] = notifications.filter((n) => f.cats.includes(n.category)).length;
    }
    return c;
  }, [notifications]);

  const critical = list.filter((n) => n.critical && !n.read);
  const news = list.filter((n) => !n.read && !n.critical);
  const earlier = list.filter((n) => n.read);
  const empty = list.length === 0;
  const total = notifications.length;

  const summary = unreadCount > 0
    ? `${unreadCount} unread · ${total} total`
    : total > 0 ? `All read · ${total} total` : "You're all clear";

  const handle = useCallback((item) => {
    haptics.tap();
    markRead(item.id);
    const a = item.action;
    if (!a) return;
    if (a.kind === 'weatherTakeover') { openModal(); return; }
    if (a.kind === 'findStop') {
      Linking.openURL('https://www.google.com/maps/search/truck+stop+near+me').catch(() => {});
      return;
    }
    if (a.route) router.push(a.route);
  }, [markRead, openModal, router]);

  const renderCard = (item, i) => (
    <FadeInView key={item.id} delay={Math.min(i, 6) * motion.stagger}>
      <NotificationCard
        item={item}
        onPress={() => handle(item)}
        onDismiss={() => removeOne(item)}
      />
    </FadeInView>
  );

  const SectionHead = ({ label, count, accent, live }) => (
    <View style={styles.sectionHead}>
      {live ? <View style={[styles.liveDot, { backgroundColor: accent }]} /> : null}
      <Text style={[styles.sectionLabel, accent && { color: accent }]}>{label}</Text>
      <View style={styles.sectionRule} />
      <Text style={[styles.sectionCount, { color: accent || colors.textMuted }]}>{count}</Text>
    </View>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Subtle brand wash gives the top of the screen depth instead of a flat slab. */}
      <LinearGradient
        pointerEvents="none"
        colors={[colors.teal + '1F', colors.teal + '00']}
        style={styles.wash}
      />

      {/* Header — editorial */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Pressable
            onPress={() => { haptics.tap(); router.back(); }}
            style={[styles.backBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Icon name="chevron-left" size={22} color={colors.textPrimary} />
          </Pressable>
          {unreadCount > 0 ? (
            <Pressable
              onPress={() => { haptics.tap(); markAllRead(); }}
              style={[styles.markAll, { backgroundColor: colors.tealFill, borderColor: colors.teal + '40' }]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Mark all as read"
            >
              <Icon name="check" size={14} color={colors.teal} />
              <Text style={styles.markAllText}>Mark all read</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.bigTitle}>Alerts</Text>
        <Text style={styles.bigSub}>{summary}</Text>
      </View>

      {/* Filter chips with live counts. Wrapper View keeps the horizontal
          ScrollView from stretching to fill vertical space (which would make
          the pills grow tall on web). */}
      <View style={styles.chipsBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsScroll}
          contentContainerStyle={styles.chips}
        >
        {FILTERS.map((f) => {
          const on = f.key === filter;
          const count = counts[f.key] || 0;
          const ink = on ? colors.onAccent : colors.textSecondary;
          const inner = (
            <>
              <Icon name={f.icon} size={15} color={ink} />
              <Text style={[styles.chipText, { color: ink }]}>{f.label}</Text>
              {count > 0 ? (
                <View style={[styles.chipCount, { backgroundColor: on ? colors.onAccent + '2E' : colors.surfaceHi }]}>
                  <Text style={[styles.chipCountText, { color: on ? colors.onAccent : colors.textMuted }]}>
                    {count}
                  </Text>
                </View>
              ) : null}
            </>
          );
          return (
            <Pressable
              key={f.key}
              onPress={() => { haptics.tap(); setFilter(f.key); }}
              style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.96 : 1 }] }, on && shadow.glow(colors.teal)]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              {on ? (
                <LinearGradient
                  colors={colors.gradients.teal}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.chip}
                >
                  {inner}
                </LinearGradient>
              ) : (
                <View style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  {inner}
                </View>
              )}
            </Pressable>
          );
        })}
        </ScrollView>
      </View>

      {/* Feed */}
      {empty ? (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIcon}>
            <Icon name="check-circle" size={34} color={colors.go} />
          </View>
          <Text style={styles.emptyTitle}>You're all caught up</Text>
          <Text style={styles.emptyText}>
            No {active.key === 'all' ? '' : active.label.toLowerCase() + ' '}alerts right now. We'll
            let you know the moment something needs you.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.feed, { paddingBottom: insets.bottom + 104 }]}
          showsVerticalScrollIndicator={false}
        >
          {critical.length > 0 && (
            <View style={styles.section}>
              <SectionHead label="Needs attention" count={critical.length} accent={colors.caution} />
              <View style={styles.stack}>{critical.map(renderCard)}</View>
            </View>
          )}
          {news.length > 0 && (
            <View style={styles.section}>
              <SectionHead label="New" count={news.length} accent={colors.teal} live />
              <View style={styles.stack}>{news.map(renderCard)}</View>
            </View>
          )}
          {earlier.length > 0 && (
            <View style={styles.section}>
              <SectionHead label="Earlier" count={earlier.length} />
              <View style={styles.stack}>{earlier.map(renderCard)}</View>
            </View>
          )}
        </ScrollView>
      )}

      {/* Floating action — Remove all hovers over the feed, always reachable */}
      {!empty ? (
        <View style={[styles.floatWrap, { bottom: insets.bottom + space[4] }]} pointerEvents="box-none">
          <Pressable
            onPress={handleRemoveAll}
            style={({ pressed }) => [styles.removeAll, shadow.glow(colors.danger), { transform: [{ scale: pressed ? 0.96 : 1 }] }]}
            accessibilityRole="button"
            accessibilityLabel="Remove all notifications"
          >
            <LinearGradient
              colors={['#A81719', '#7E1012']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.removeAllInner}
            >
              <Icon name="trash-2" size={17} color="#FFFFFF" />
              <Text style={styles.removeAllText}>Remove all</Text>
            </LinearGradient>
          </Pressable>
        </View>
      ) : null}

      <UndoToast
        visible={!!undo}
        message={undo?.message}
        onUndo={() => { if (undo) restoreAll(undo.snapshot); setUndo(null); }}
        onHide={() => { commitPending(); setUndo(null); }}
      />
    </View>
  );
}

const makeStyles = (c) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  wash: { position: 'absolute', top: 0, left: 0, right: 0, height: 260 },

  header: { paddingHorizontal: space[4], paddingTop: space[1], paddingBottom: space[3] },
  headerTop: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 44, marginBottom: space[3],
  },
  backBtn: {
    width: 44, height: 44, borderRadius: 999, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  markAll: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: space[3] + 2, paddingVertical: space[2] + 1,
    borderRadius: radius.pill, borderWidth: 1,
  },
  markAllText: { ...type.caption, fontSize: 13, fontFamily: FONT.bold, color: c.teal },
  bigTitle: { fontSize: 34, fontFamily: FONT.black, letterSpacing: -1, color: c.textPrimary, lineHeight: 38 },
  bigSub: { ...type.caption, fontSize: 13.5, color: c.textSecondary, marginTop: 3, ...type.num },

  chipsBar: { flexGrow: 0, flexShrink: 0 },
  chipsScroll: { flexGrow: 0 },
  chips: { alignItems: 'center', paddingHorizontal: space[4], paddingBottom: space[4], paddingTop: space[1], gap: space[2] },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: space[4], paddingVertical: space[2] + 3,
    borderRadius: radius.pill, borderWidth: 1, borderColor: 'transparent',
  },
  chipText: { ...type.caption, fontSize: 13, fontFamily: FONT.bold, letterSpacing: 0.2 },
  chipCount: { minWidth: 18, height: 18, borderRadius: 999, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  chipCountText: { fontSize: 11, fontFamily: FONT.extrabold, ...type.num },

  feed: { paddingHorizontal: space[4], paddingTop: space[1] },
  section: { marginBottom: space[5] },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginBottom: space[3], paddingHorizontal: space[1] },
  liveDot: { width: 8, height: 8, borderRadius: 999 },
  sectionLabel: { ...type.label, fontSize: 12, color: c.textMuted },
  sectionRule: { flex: 1, height: 1, backgroundColor: c.border },
  sectionCount: { ...type.label, fontSize: 12, ...type.num },
  stack: { gap: space[3] },

  floatWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  removeAll: { borderRadius: radius.pill },
  removeAllInner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2],
    minWidth: 220,
    paddingHorizontal: space[7], paddingVertical: space[3] + 2,
    borderRadius: radius.pill, overflow: 'hidden',
  },
  removeAllText: { ...type.caption, fontSize: 14.5, fontFamily: FONT.extrabold, color: '#FFFFFF', letterSpacing: 0.2 },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space[8], gap: space[3] },
  emptyIcon: {
    width: 76, height: 76, borderRadius: 999, backgroundColor: c.goFill,
    alignItems: 'center', justifyContent: 'center', marginBottom: space[1],
  },
  emptyTitle: { ...type.title, color: c.textPrimary },
  emptyText: { ...type.body, fontSize: 15, color: c.textSecondary, textAlign: 'center', lineHeight: 22 },
});
