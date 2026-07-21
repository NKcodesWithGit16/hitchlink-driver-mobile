import { View, Text, StyleSheet } from 'react-native';
import Tag from '../ui/Tag';
import Icon from '../ui/Icon';
import HOSPill from './HOSPill';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n/LanguageContext';
import { space, type } from '../../theme/tokens';

/* Persistent context strip at the top of the Load screen:
   load-status chip · connectivity · HOS pill. Always glanceable. */
export default function StatusBar({ chip, driveMinutesLeft, online = true, onHosPress }) {
  const { colors } = useTheme();
  const t = useT();
  return (
    <View style={styles.wrap}>
      {chip ? <Tag label={t(chip.labelKey)} tone={chip.tone} dot style={styles.chip} /> : <View />}
      <View style={styles.right}>
        <View style={styles.conn}>
          <Icon name={online ? 'wifi' : 'wifi-off'} size={13} color={online ? colors.go : colors.caution} />
          <Text style={[styles.connText, { color: online ? colors.go : colors.caution }]}>
            {online ? t('load.live') : t('load.offline')}
          </Text>
        </View>
        <HOSPill driveMinutesLeft={driveMinutesLeft} onPress={onHosPress} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space[5], paddingBottom: space[3], gap: space[2],
  },
  chip: { alignSelf: 'center' },
  right: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  conn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  connText: { ...type.label, fontSize: 10 },
});
