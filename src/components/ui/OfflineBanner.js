import { View, Text, StyleSheet } from 'react-native';
import Icon from './Icon';
import { useTheme } from '../../theme/ThemeContext';
import { space, type, radius, FONT } from '../../theme/tokens';

/* Calm, reassuring offline notice — tells the driver their taps are safe. */
export default function OfflineBanner({ pending = 0 }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.wrap, { backgroundColor: colors.cautionFill, borderColor: colors.caution + '55' }]}>
      <Icon name="wifi-off" size={15} color={colors.caution} />
      <Text style={[styles.text, { color: colors.textPrimary }]} numberOfLines={2}>
        {pending > 0
          ? `You're offline — ${pending} update${pending > 1 ? 's' : ''} saved. We'll send ${pending > 1 ? 'them' : 'it'} the moment signal returns.`
          : "You're offline. Everything still works — we'll sync when signal returns."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: space[4], paddingVertical: space[2],
    borderRadius: radius.md, borderWidth: 1,
    marginHorizontal: space[5], marginBottom: space[2],
  },
  text: { ...type.caption, fontFamily: FONT.semibold, flex: 1, lineHeight: 18 },
});
