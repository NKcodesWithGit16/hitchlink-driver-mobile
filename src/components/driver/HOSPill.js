import { Text, StyleSheet, Pressable } from 'react-native';
import Icon from '../ui/Icon';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n/LanguageContext';
import { radius, type, toneOf, FONT } from '../../theme/tokens';
import { hm } from '../../lib/format';

// Color state from drive-time remaining (mirrors the report's 🟢🟡🔴🚨).
export function hosState(driveMinutesLeft) {
  if (driveMinutesLeft == null) return 'teal';
  if (driveMinutesLeft <= 15) return 'danger';
  if (driveMinutesLeft <= 120) return 'caution';
  return 'go';
}

export default function HOSPill({ driveMinutesLeft, onPress }) {
  const { colors } = useTheme();
  const t = useT();
  const tone = toneOf(colors, hosState(driveMinutesLeft));
  return (
    <Pressable
      onPress={onPress}
      style={[styles.wrap, { backgroundColor: tone.fill, borderColor: tone.solid + '40' }]}
      accessibilityRole="button"
      accessibilityLabel={t('load.hosA11y', { time: hm(driveMinutesLeft) })}
    >
      <Icon name="clock" size={13} color={tone.solid} />
      <Text style={[styles.label, { color: tone.solid }]}>{t('load.driveLabel')}</Text>
      <Text style={[styles.value, { color: colors.textPrimary }, type.num]}>{hm(driveMinutesLeft)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1,
  },
  label: { ...type.label, fontSize: 10.5 },
  value: { ...type.caption, fontFamily: FONT.bold },
});
