// The accept/decline step for a freshly-assigned load.
//
// The backend has supported this since day one (POST /loads/{id}/accept and
// /decline, and LoadDto.AcceptedAt), and src/api/main.js has always wrapped
// both — but nothing ever called them. A driver went straight from "Assigned"
// to "Arrived at pickup", so dispatch had no signal the driver had even seen
// the assignment, let alone agreed to run it.
//
// Shown in place of the usual single contextual action while the load is
// Assigned and AcceptedAt is still null; once accepted, the normal status
// machine takes over unchanged.

import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import Icon from '../ui/Icon';
import PrimaryAction from '../ui/PrimaryAction';
import haptics from '../../lib/haptics';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n/LanguageContext';
import { space, type, radius, FONT } from '../../theme/tokens';

export default function LoadOfferCard({ load, busy, onAccept, onDecline }) {
  const { colors } = useTheme();
  const t = useT();

  // Reasons go back to dispatch verbatim, so they're a short fixed set rather
  // than free text — a driver pulling over to type is exactly what this screen
  // exists to avoid.
  const confirmDecline = () => {
    haptics.press();
    Alert.alert(
      t('load.declineTitle'),
      t('load.declineBody'),
      [
        { text: t('load.declineReasonHos'), style: 'destructive', onPress: () => onDecline(t('load.declineReasonHos')) },
        { text: t('load.declineReasonDistance'), style: 'destructive', onPress: () => onDecline(t('load.declineReasonDistance')) },
        { text: t('load.declineReasonTruck'), style: 'destructive', onPress: () => onDecline(t('load.declineReasonTruck')) },
        { text: t('common.cancel'), style: 'cancel' },
      ],
      { cancelable: true },
    );
  };

  return (
    <View style={[styles.wrap, { borderColor: colors.caution + '55', backgroundColor: colors.cautionFill }]}>
      <View style={styles.head}>
        <View style={[styles.badge, { backgroundColor: colors.caution }]}>
          <Icon name="inbox" size={15} color={colors.onAccent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t('load.offerTitle')}</Text>
          <Text style={[styles.sub, { color: colors.textSecondary }]}>{t('load.offerSub')}</Text>
        </View>
      </View>

      <PrimaryAction
        label={t('load.accept')}
        icon="check-circle"
        tone="go"
        loading={busy}
        onPress={onAccept}
      />

      <Pressable
        onPress={confirmDecline}
        disabled={busy}
        style={({ pressed }) => [
          styles.decline,
          { borderColor: colors.danger + '66', opacity: pressed || busy ? 0.7 : 1 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={t('load.declineA11y', { origin: load?.origin ?? '', destination: load?.destination ?? '' })}
      >
        <Icon name="x-circle" size={17} color={colors.danger} />
        <Text style={[styles.declineText, { color: colors.danger }]}>{t('load.decline')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.xl, borderWidth: 1.5, padding: space[4], gap: space[3] },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  badge: { width: 32, height: 32, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  title: { fontSize: 16, fontFamily: FONT.black, letterSpacing: -0.2 },
  sub: { ...type.caption, marginTop: 1 },
  decline: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 52, borderRadius: radius.lg, borderWidth: 1.5,
  },
  declineText: { fontSize: 15, fontFamily: FONT.bold },
});
