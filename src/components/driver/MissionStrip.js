import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from '../ui/Icon';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n/LanguageContext';
import { space, radius, FONT, shadow } from '../../theme/tokens';
import { money, num } from '../../lib/format';

export default function MissionStrip({ load }) {
  const { colors } = useTheme();
  const t = useT();
  return (
    <LinearGradient
      colors={colors.gradients.brand}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[styles.card, shadow.float]}
    >
      {/* Route: stacked so each city gets full width */}
      <View style={styles.route}>
        <View style={styles.cityRow}>
          <View style={[styles.dot, { backgroundColor: 'rgba(255,255,255,0.5)' }]} />
          <Text style={styles.city} numberOfLines={1}>{load.origin}</Text>
        </View>
        <View style={styles.connector}>
          <View style={styles.connLine} />
          <Icon name="arrow-down" size={13} color="rgba(255,255,255,0.45)" />
        </View>
        <View style={styles.cityRow}>
          <View style={[styles.dot, { backgroundColor: '#fff' }]} />
          <Text style={styles.city} numberOfLines={1}>{load.destination}</Text>
        </View>
      </View>

      {/* Stats row */}
      <View style={styles.pills}>
        <Pill icon="dollar-sign" label={money(load.rate)} />
        <View style={styles.pipDivider} />
        <Pill icon="map" label={`${num(load.miles)} mi`} />
        {load.deliverBy ? (
          <>
            <View style={styles.pipDivider} />
            <Pill icon="clock" label={t('load.byDeliverBy', { date: load.deliverBy })} />
          </>
        ) : null}
      </View>
    </LinearGradient>
  );
}

function Pill({ icon, label }) {
  return (
    <View style={styles.pill}>
      <Icon name={icon} size={12} color="rgba(255,255,255,0.75)" />
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius['2xl'], padding: space[5], gap: space[4] },

  route: { gap: 0 },
  cityRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 999, flexShrink: 0 },
  city: { fontSize: 20, fontFamily: FONT.black, color: '#fff', letterSpacing: -0.3, flex: 1 },
  connector: { flexDirection: 'row', alignItems: 'center', gap: 0, marginLeft: 4, paddingVertical: 2 },
  connLine: { width: 1.5, height: 12, backgroundColor: 'rgba(255,255,255,0.3)', marginLeft: 0 },

  pills: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 0 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 },
  pillText: { fontSize: 13, fontFamily: FONT.bold, color: 'rgba(255,255,255,0.9)' },
  pipDivider: { width: 1, height: 14, backgroundColor: 'rgba(255,255,255,0.25)', marginHorizontal: 12 },
});
