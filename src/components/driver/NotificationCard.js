import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from '../ui/Icon';
import { useTheme } from '../../theme/ThemeContext';
import { radius, space, type, toneOf, FONT, elevation, shadow } from '../../theme/tokens';
import { relativeMinutes } from '../../lib/format';

// Human category label for the card eyebrow — reads as a designed system, and
// lets a driver scan by *kind* even before reading the headline.
const CATEGORY_LABEL = {
  load: 'Load',
  hos: 'Safety',
  document: 'Document',
  weather: 'Weather',
  earnings: 'Payment',
};

/* One row in the Alerts feed.
   Hierarchy is the whole game here:
   - UNREAD items "light up" — a gradient icon tile with a soft tone glow, a
     left accent rail, and the raised surface. They pull the eye first.
   - CRITICAL unread items go further: a full tone-tinted fill + border, lifted.
   - READ items go quiet — flat tile, sunken surface, muted eyebrow.
   The gradient tile deliberately mirrors the weather toast, so the alert
   language feels like one system across the app. */
export default function NotificationCard({ item, onPress, onDismiss }) {
  const { colors } = useTheme();
  const t = toneOf(colors, item.tone);
  const unread = !item.read;
  const critical = item.critical && unread;
  const cat = (CATEGORY_LABEL[item.category] || 'Alert').toUpperCase();

  const surface = critical ? t.fill : unread ? colors.surface : colors.surface2;
  const borderColor = critical ? t.solid + '55' : unread ? colors.border : 'transparent';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.wrap,
        {
          backgroundColor: surface,
          borderColor,
          borderLeftColor: unread ? t.solid : borderColor,
          borderLeftWidth: unread ? 3 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
        unread && elevation[1],
        critical && elevation[2],
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${cat}. ${item.title}. ${item.body}`}
    >
      {unread ? (
        <LinearGradient
          colors={t.grad}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.tile, shadow.glow(t.solid)]}
        >
          <Icon name={item.icon} size={20} color="#FFFFFF" />
        </LinearGradient>
      ) : (
        <View style={[styles.tile, { backgroundColor: t.fill }]}>
          <Icon name={item.icon} size={20} color={t.solid} />
        </View>
      )}

      <View style={styles.body}>
        <View style={styles.metaRow}>
          <Text style={[styles.cat, { color: unread ? t.solid : colors.textMuted }]}>{cat}</Text>
          <View style={[styles.midDot, { backgroundColor: colors.textMuted }]} />
          <Text style={[styles.time, { color: colors.textMuted }]}>
            {relativeMinutes(item.minutesAgo)}
          </Text>
        </View>

        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={[styles.text, { color: colors.textSecondary }]} numberOfLines={2}>
          {item.body}
        </Text>

        {item.action ? (
          <View style={styles.actions}>
            <View style={[styles.actionPill, { backgroundColor: unread ? t.solid : t.fill, borderColor: t.solid + (unread ? '00' : '40') }]}>
              <Text style={[styles.actionLabel, { color: unread ? colors.onAccent : t.solid }]}>
                {item.action.label}
              </Text>
              <Icon name="chevron-right" size={14} color={unread ? colors.onAccent : t.solid} />
            </View>
          </View>
        ) : null}
      </View>

      {onDismiss ? (
        <Pressable
          onPress={onDismiss}
          hitSlop={12}
          style={[styles.close, { backgroundColor: colors.surface2, borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel="Remove this notification"
        >
          <Icon name="x" size={15} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  tile: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  body: { flex: 1, minWidth: 0 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  cat: { ...type.label, fontSize: 10, letterSpacing: 0.8 },
  midDot: { width: 3, height: 3, borderRadius: 999, opacity: 0.7 },
  time: { ...type.caption, fontSize: 11.5, fontFamily: FONT.semibold, ...type.num },
  title: { fontSize: 15.5, fontFamily: FONT.bold, lineHeight: 20, letterSpacing: -0.2 },
  text: { ...type.caption, fontSize: 13, lineHeight: 18, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: space[3] },
  actionPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingLeft: 13, paddingRight: 9, paddingVertical: 8,
    borderRadius: radius.pill, borderWidth: 1,
  },
  actionLabel: { ...type.label, fontSize: 11 },
  close: {
    width: 30, height: 30, borderRadius: 999, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    marginTop: -2, marginRight: -2,
  },
});
