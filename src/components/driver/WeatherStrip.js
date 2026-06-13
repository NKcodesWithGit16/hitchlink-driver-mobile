import { View, Text, StyleSheet, Pressable } from 'react-native';
import Icon from '../ui/Icon';
import { useTheme } from '../../theme/ThemeContext';
import { radius, space, type, toneOf, FONT } from '../../theme/tokens';

/* Calm when clear, loud when dangerous. Tapping an alert opens the takeover. */
export default function WeatherStrip({ now, alert, onPress }) {
  const { colors } = useTheme();

  if (alert) {
    const t = toneOf(colors, alert.severity === 'severe' ? 'danger' : 'caution');
    return (
      <Pressable
        onPress={onPress}
        style={[styles.alert, { backgroundColor: t.fill, borderColor: t.solid + '55' }]}
        accessibilityRole="button"
      >
        <Icon name="alert-triangle" size={20} color={t.solid} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.alertTitle, { color: t.solid }]} numberOfLines={1}>{alert.title}</Text>
          <Text style={[styles.alertSub, { color: colors.textSecondary }]} numberOfLines={1}>
            Near {alert.near} · ~{alert.etaMinutes} min ahead
          </Text>
        </View>
        <Icon name="chevron-right" size={18} color={colors.textMuted} />
      </Pressable>
    );
  }

  return (
    <View style={[styles.calm, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Icon name={now?.icon || 'cloud'} size={16} color={colors.textSecondary} />
      <Text style={[styles.calmText, { color: colors.textSecondary }]}>
        {now ? `${now.condition} · ${now.tempF}°F ahead` : 'Weather looks clear ahead'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  calm: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: space[4], paddingVertical: space[3],
    borderRadius: radius.md, borderWidth: 1,
  },
  calmText: { ...type.caption, fontFamily: FONT.semibold },
  alert: {
    flexDirection: 'row', alignItems: 'center', gap: space[3],
    paddingHorizontal: space[4], paddingVertical: space[3], borderRadius: radius.md, borderWidth: 1.5,
  },
  alertTitle: { fontSize: 15, fontFamily: FONT.extrabold },
  alertSub: { ...type.caption, marginTop: 1 },
});
