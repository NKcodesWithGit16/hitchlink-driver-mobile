import { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../ui/Icon';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n/LanguageContext';
import { useCall } from '../../context/CallContext';
import { space, type, radius, FONT } from '../../theme/tokens';

function initials(name) {
  return (name || '?').split(' ').map((w) => w[0]).filter(Boolean).join('').toUpperCase().slice(0, 2);
}

function useElapsed(startedAt) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) return undefined;
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// Global overlay — mounted once at the root layout (see app/_layout.js),
// visible whenever CallContext's status isn't idle. Ringing-in/out and
// active all share this one full-screen surface so there's no separate
// "screen" to navigate to or lose track of.
export default function CallOverlay() {
  const { colors } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { status, peerName, error, muted, startedAt, acceptCall, declineCall, hangUp, toggleMute } = useCall();
  const duration = useElapsed(status === 'active' ? startedAt : null);

  // 'ended' briefly shows why the call didn't connect (CallContext auto-reverts
  // to idle a couple seconds later) — without this it silently vanished, which
  // is why a failed accept used to look like nothing happened at all.
  const visible = status !== 'idle';
  if (!visible) return null;

  const ringingIn = status === 'ringing-in';
  const ringingOut = status === 'ringing-out';
  const active = status === 'active';
  const ended = status === 'ended';

  return (
    <Modal visible transparent={false} animationType="fade" statusBarTranslucent>
      <LinearGradient colors={colors.gradients.brand ? [colors.navy, colors.bg] : [colors.bg, colors.bg]} style={[styles.screen, { paddingTop: insets.top + space[8], paddingBottom: insets.bottom + space[8] }]}>
        <View style={styles.body}>
          <View style={[styles.avatar, ringingIn && styles.avatarPulse, ended && { borderColor: colors.danger }]}>
            {ended
              ? <Icon family="material-community" name="phone-hangup" size={34} color={colors.danger} />
              : <Text style={styles.avatarText}>{initials(peerName)}</Text>}
          </View>
          <Text style={styles.peerName}>{peerName || t('messages.dispatcherFallback')}</Text>
          <Text style={[styles.statusLine, ended && { color: colors.danger }]}>
            {ringingIn && t('call.incomingCall')}
            {ringingOut && t('call.calling')}
            {active && duration}
            {ended && (error || t('call.callEnded'))}
          </Text>
        </View>

        {ended ? null : ringingIn ? (
          <View style={styles.incomingActions}>
            <View style={styles.actionCol}>
              <Pressable onPress={declineCall} style={[styles.bigBtn, { backgroundColor: colors.danger }]} accessibilityRole="button" accessibilityLabel={t('call.declineCallA11y')}>
                <Icon family="material-community" name="phone-hangup" size={30} color="#FFFFFF" />
              </Pressable>
              <Text style={styles.actionLabel}>{t('call.decline')}</Text>
            </View>
            <View style={styles.actionCol}>
              <Pressable onPress={acceptCall} style={[styles.bigBtn, { backgroundColor: colors.go }, styles.bigBtnGlow]} accessibilityRole="button" accessibilityLabel={t('call.acceptCallA11y')}>
                <Icon family="ionicons" name="call" size={26} color={colors.onAccent} />
              </Pressable>
              <Text style={styles.actionLabel}>{t('call.accept')}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.activeActions}>
            {active && (
              <View style={styles.actionCol}>
                <Pressable
                  onPress={toggleMute}
                  style={[styles.midBtn, { backgroundColor: muted ? colors.danger : colors.surface2, borderColor: colors.border }]}
                  accessibilityRole="button"
                  accessibilityLabel={muted ? t('call.unmuteA11y') : t('call.muteA11y')}
                >
                  <Icon family="ionicons" name={muted ? 'mic-off' : 'mic'} size={20} color={muted ? '#FFFFFF' : colors.textPrimary} />
                </Pressable>
                <Text style={styles.actionLabel}>{muted ? t('call.unmute') : t('call.mute')}</Text>
              </View>
            )}
            <View style={styles.actionCol}>
              <Pressable onPress={hangUp} style={[styles.bigBtn, { backgroundColor: colors.danger }]} accessibilityRole="button" accessibilityLabel={t('call.hangUpA11y')}>
                <Icon family="material-community" name="phone-hangup" size={30} color="#FFFFFF" />
              </Pressable>
              <Text style={styles.actionLabel}>{ringingOut ? t('common.cancel') : t('call.hangUp')}</Text>
            </View>
          </View>
        )}
      </LinearGradient>
    </Modal>
  );
}

const makeStyles = (c) => StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[6] },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[3] },
  avatar: {
    width: 112, height: 112, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.surface2, borderWidth: 1.5, borderColor: c.border,
    marginBottom: space[4],
  },
  avatarPulse: { borderColor: c.go, borderWidth: 2 },
  avatarText: { fontSize: 36, fontFamily: FONT.black, color: c.textPrimary },
  peerName: { ...type.h2, color: c.textPrimary, textAlign: 'center' },
  statusLine: { ...type.body, color: c.textMuted },

  incomingActions: { flexDirection: 'row', justifyContent: 'center', gap: space[10], paddingBottom: space[4] },
  activeActions: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', gap: space[10], paddingBottom: space[4] },
  actionCol: { alignItems: 'center', gap: space[2] },
  actionLabel: { ...type.caption, color: c.textMuted },

  bigBtn: { width: 64, height: 64, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  bigBtnGlow: { shadowColor: c.go, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 14, elevation: 6 },
  midBtn: { width: 52, height: 52, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
