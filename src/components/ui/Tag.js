import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { radius, type, toneOf } from '../../theme/tokens';

/* Small status chip. `dot` adds a leading indicator dot. */
export default function Tag({ label, tone = 'teal', dot = false, style }) {
  const { colors } = useTheme();
  const t = toneOf(colors, tone);
  return (
    <View style={[styles.wrap, { backgroundColor: t.fill, borderColor: t.solid + '40' }, style]}>
      {dot ? <View style={[styles.dot, { backgroundColor: t.solid }]} /> : null}
      <Text style={[styles.label, { color: t.solid }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill,
    borderWidth: 1, alignSelf: 'flex-start',
  },
  dot: { width: 7, height: 7, borderRadius: 999 },
  label: { ...type.label, fontSize: 11 },
});
