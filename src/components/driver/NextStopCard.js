import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from '../ui/Icon';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n/LanguageContext';
import { radius, space, type, shadow, FONT } from '../../theme/tokens';

/* The hero glance card: one giant destination, deadline, distance, ETA.
   Readable in under a second from the wheel. */
export default function NextStopCard({ stop }) {
  const { colors } = useTheme();
  const t = useT();
  const isPickup = stop.kind === 'PICKUP';
  return (
    <LinearGradient
      colors={colors.gradients.card}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[styles.card, { borderColor: colors.borderStrong }, shadow.card]}
    >
      <View style={styles.head}>
        <Icon name={isPickup ? 'package' : 'flag'} size={15} color={colors.teal} />
        <Text style={[styles.kicker, { color: colors.teal }]}>
          {t('load.nextKicker', { kind: isPickup ? t('load.pickupCaps') : t('load.deliveryCaps') })}
        </Text>
        <View style={{ flex: 1, minWidth: space[3] }} />
        <Text style={[styles.by, { color: colors.textSecondary }]} numberOfLines={1}>{stop.date} · {t('load.byTime', { time: stop.by })}</Text>
      </View>

      <Text style={[styles.city, { color: colors.textPrimary }]} numberOfLines={1} adjustsFontSizeToFit>{stop.city}</Text>
      {stop.address ? <Text style={[styles.address, { color: colors.textMuted }]} numberOfLines={1}>{stop.address}</Text> : null}

      <View style={[styles.metrics, { backgroundColor: colors.isDay ? 'rgba(8,15,30,0.05)' : 'rgba(0,0,0,0.22)' }]}>
        <View style={styles.metric}>
          <Text style={[styles.metricVal, { color: colors.textPrimary }, type.num]}>{stop.remainingMiles ?? '—'}</Text>
          <Text style={[styles.metricUnit, { color: colors.textMuted }]}>{t('load.miAway')}</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <View style={styles.metric}>
          <Text style={[styles.metricVal, { color: colors.textPrimary }, type.num]}>{stop.eta ?? '—'}</Text>
          <Text style={[styles.metricUnit, { color: colors.textMuted }]}>{t('load.driveTimeLabel')}</Text>
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius['2xl'], borderWidth: 1, padding: space[5], gap: space[1] },
  head: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  kicker: { ...type.label },
  by: { ...type.caption, fontFamily: FONT.bold, flexShrink: 1, textAlign: 'right' },
  city: { ...type.display, marginTop: space[2] },
  address: { ...type.caption, marginTop: 2 },
  metrics: { flexDirection: 'row', alignItems: 'center', marginTop: space[4], borderRadius: radius.md, paddingVertical: space[3] },
  metric: { flex: 1, alignItems: 'center', gap: 2 },
  metricVal: { fontSize: 30, fontFamily: FONT.black, letterSpacing: -0.8 },
  metricUnit: { ...type.label, fontSize: 10.5 },
  divider: { width: 1, alignSelf: 'stretch', marginVertical: 4 },
});
