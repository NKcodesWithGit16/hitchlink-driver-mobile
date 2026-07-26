import { View, Text, StyleSheet, Pressable } from 'react-native';
import Tag from '../ui/Tag';
import Icon from '../ui/Icon';
import HOSPill from './HOSPill';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n/LanguageContext';
import { space, type, radius, toneOf } from '../../theme/tokens';

/* Persistent context strip at the top of the Load screen:
   load-status chip · connectivity · HOS pill. Always glanceable.

   `weatherAlert` (same shape WeatherStrip takes) renders a small tappable
   badge here too — this row never scrolls out of view, unlike WeatherStrip
   further down the screen, so it's what still reminds the driver a warning
   is active after they've dismissed the toast. Renders nothing when there's
   no active alert — purely additive, no layout change either way. */
export default function StatusBar({ chip, driveMinutesLeft, online = true, onHosPress, weatherAlert, onWeatherAlertPress }) {
  const { colors } = useTheme();
  const t = useT();
  const tone = weatherAlert ? toneOf(colors, weatherAlert.severity === 'severe' ? 'danger' : 'caution') : null;
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
        {weatherAlert ? (
          <Pressable
            onPress={onWeatherAlertPress}
            style={[styles.weatherBadge, { backgroundColor: tone.fill, borderColor: tone.solid + '55' }]}
            accessibilityRole="button"
            accessibilityLabel={t('load.weatherAlertA11y')}
          >
            <Icon name="alert-triangle" size={14} color={tone.solid} />
          </Pressable>
        ) : null}
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
  weatherBadge: {
    width: 26, height: 26, borderRadius: radius.md, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
});
