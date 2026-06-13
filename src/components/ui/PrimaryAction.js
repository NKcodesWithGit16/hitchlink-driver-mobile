import { Pressable, Text, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import haptics from '../../lib/haptics';
import Icon from './Icon';
import { useTheme } from '../../theme/ThemeContext';
import { radius, type, tap, shadow, toneOf, FONT, motion } from '../../theme/tokens';

/* The most important component in the app: one big, glove-friendly,
   contextual action. Full-width, 64px tall, color carries meaning. */
export default function PrimaryAction({ label, icon, tone = 'teal', onPress, disabled, loading }) {
  const { colors } = useTheme();
  const t = toneOf(colors, tone);

  const handle = () => {
    if (disabled || loading) return;
    haptics.press();
    onPress?.();
  };

  return (
    <Pressable
      onPress={handle}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.wrap,
        shadow.glow(t.solid),
        { opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? motion.press : 1 }] },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <LinearGradient colors={t.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.grad}>
        {icon ? (
          <View style={styles.iconWrap}>
            <Icon name={loading ? 'loader' : icon} size={22} color={t.ink} />
          </View>
        ) : null}
        <Text style={[styles.label, { color: t.ink }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{loading ? 'One sec…' : label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.lg },
  grad: {
    minHeight: tap.primary, borderRadius: radius.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingHorizontal: 20,
  },
  iconWrap: { width: 26, alignItems: 'center' },
  label: { fontSize: 16, fontFamily: FONT.bold, letterSpacing: 0, flex: 1 },
});
