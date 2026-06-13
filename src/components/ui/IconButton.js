import { Pressable, Text, StyleSheet } from 'react-native';
import haptics from '../../lib/haptics';
import Icon from './Icon';
import { useTheme } from '../../theme/ThemeContext';
import { radius, tap, type, toneOf, FONT } from '../../theme/tokens';

/* Big square secondary action (Call / Chat / Navigate). Tinted, glove-sized. */
export default function IconButton({ icon, label, tone = 'teal', onPress, flex = 1 }) {
  const { colors } = useTheme();
  const t = toneOf(colors, tone);
  return (
    <Pressable
      onPress={() => { haptics.press(); onPress?.(); }}
      style={({ pressed }) => [
        styles.wrap,
        { flex, backgroundColor: t.fill, borderColor: t.solid + '40', opacity: pressed ? 0.7 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} size={24} color={t.solid} />
      <Text style={[styles.label, { color: colors.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minHeight: tap.secondary + 14, borderRadius: radius.md, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12,
  },
  label: { ...type.caption, fontFamily: FONT.bold, letterSpacing: 0.2 },
});
