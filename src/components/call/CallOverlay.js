// The two faces of a live call, both driven by CallContext's `status`:
//
//   • CallScreen — the full-bleed takeover (a Modal, so it covers the tabs).
//     Every state except a minimized active call renders this.
//   • CallBanner — a thin green bar pinned under the status bar, shown when an
//     active call is minimized. Deliberately NOT a Modal: an iOS Modal
//     swallows every touch beneath it, which is what made the app unusable
//     mid-call. It's an absolutely-positioned view, so the tabs, chat and
//     documents stay usable while the call runs.
//
// Neither one owns the call. Daily's call object and the CallKit session live
// in CallContext, so swapping between these two is purely a change of what's
// on screen — audio never drops, and hanging up from the reopened screen goes
// through the same hangUp() that retires CallKit's native session.
//
// Mounted once at the root layout (app/_layout.js) so a call rings and stays
// reachable no matter which tab is open.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, Image, Animated, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../ui/Icon';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n/LanguageContext';
import { useCall } from '../../context/CallContext';
import { useReduceMotion } from '../../lib/useReduceMotion';
import haptics from '../../lib/haptics';
import { space, type, shadow, elevation, motion, FONT } from '../../theme/tokens';

// The takeover is dark in both themes (a blurred photo or the navy call
// gradient, never a light surface), so its ink is fixed rather than themed —
// the same reasoning the tab bar uses for the white glyph on its brand
// gradient. The banner sits among app content and is themed normally.
const INK = '#FFFFFF';
const INK_DIM = 'rgba(255,255,255,0.68)';
const CONTROL_BG = 'rgba(255,255,255,0.16)';
const CONTROL_BG_ON = 'rgba(255,255,255,0.94)';
const CONTROL_EDGE = 'rgba(255,255,255,0.20)';
// Scrim over the blurred photo. Blur alone doesn't guarantee contrast — a
// bright or busy portrait still washes out white text — so the backdrop is
// always darkened, heavier at the bottom where the controls sit.
const PHOTO_SCRIM = ['rgba(4,10,20,0.42)', 'rgba(4,10,20,0.72)', 'rgba(4,10,20,0.94)'];
// Brand-teal bloom behind the avatar on the no-photo fallback.
const BLOOM_OUTER = 'rgba(31,182,206,0.16)';
const BLOOM_INNER = 'rgba(31,182,206,0.12)';

// Height of the banner's content strip, below the status-bar inset. Screens
// add this to their own top padding while a call is minimized — see
// useCallBannerInset.
const BANNER_H = 30;

/**
 * Extra top padding a screen needs while a call is minimized, so its header
 * isn't hidden behind the banner. 0 the rest of the time.
 */
export function useCallBannerInset() {
  const { status, minimized } = useCall();
  return status === 'active' && minimized ? BANNER_H : 0;
}

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
  const h = Math.floor(elapsed / 3600);
  const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

// ── Full-screen takeover ───────────────────────────────────────────────

// One expanding ring of the "this phone is ringing" pulse. Two of these run
// with staggered delays so the ripple reads as continuous rather than as a
// single circle popping in and out.
function PulseRing({ delay, color, reduceMotion }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: 1, duration: 2000, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [delay, reduceMotion]);
  if (reduceMotion) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute', width: 148, height: 148, borderRadius: 999,
        borderWidth: 2, borderColor: color,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }],
      }}
    />
  );
}

// Round control in the bottom row. `on` inverts it (light fill, dark glyph) so
// mute/speaker state reads at a glance from the driver's seat rather than
// needing a colour comparison. `danger` is the end-call button, which sits in
// the same row rather than on its own bar.
function ControlButton({ icon, family = 'ionicons', label, on, danger, onPress, a11y, color }) {
  const bg = danger ? color : on ? CONTROL_BG_ON : CONTROL_BG;
  return (
    <View style={styles.controlCol}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.controlBtn,
          { backgroundColor: bg, borderWidth: on || danger ? 0 : 1, transform: [{ scale: pressed ? motion.press : 1 }] },
          danger && shadow.glow(color),
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected: !!on }}
        accessibilityLabel={a11y}
      >
        <Icon family={family} name={icon} size={24} color={on ? '#0A1420' : INK} />
      </Pressable>
      <Text style={styles.controlLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function CallScreen({ call }) {
  const { colors } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const {
    status, peerName, peerPhotoUrl, error, muted, speakerOn, startedAt,
    acceptCall, declineCall, hangUp, toggleMute, toggleSpeaker, minimize,
  } = call;
  const duration = useElapsed(status === 'active' ? startedAt : null);

  const ringingIn = status === 'ringing-in';
  const ringingOut = status === 'ringing-out';
  // Answered, media not up yet. Shows the peer and "Connecting…" with only a
  // hang-up — never Accept/Decline, which is what briefly appeared over a
  // CallKit-answered call before this state existed.
  const connecting = status === 'connecting';
  const active = status === 'active';
  // 'ended' briefly shows why the call didn't connect (CallContext auto-reverts
  // to idle a couple seconds later) — without this it silently vanished, which
  // is why a failed accept used to look like nothing happened at all.
  const ended = status === 'ended';
  const ringing = ringingIn || ringingOut;

  // Presigned URLs expire; a failed load falls back to initials and the
  // gradient backdrop rather than an empty circle and a black screen. Reset per
  // URL so the next call re-tries a freshly signed one.
  const [photoFailed, setPhotoFailed] = useState(false);
  useEffect(() => { setPhotoFailed(false); }, [peerPhotoUrl]);
  const hasPhoto = !!peerPhotoUrl && !photoFailed;

  // Content settles in from slightly below on open, so the takeover arrives as
  // a deliberate screen rather than a hard cut.
  const enter = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) { enter.setValue(1); return; }
    Animated.timing(enter, { toValue: 1, duration: motion.duration.base, easing: motion.easing.decelerate, useNativeDriver: true }).start();
  }, [reduceMotion]);
  const enterStyle = {
    opacity: enter,
    transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
  };

  const statusDot = ended ? colors.danger : active ? colors.go : colors.caution;
  const statusText = ringingIn ? t('call.incomingCall')
    : ringingOut ? t('call.calling')
    : connecting ? t('call.connecting')
    : active ? t('call.connected')
    : (error || t('call.callEnded'));

  // Android back leaves an active call running, exactly like the ‹ button; in
  // any other state it's swallowed, so back can never silently decline a
  // ringing call.
  return (
    <Modal visible transparent={false} animationType="slide" statusBarTranslucent onRequestClose={active ? minimize : () => {}}>
      <View style={styles.root}>
        <StatusBar style="light" />

        {/* Backdrop: the dispatcher's own photo, blown up and blurred behind a
            scrim. Falls back to the brand gradient when there's no usable
            photo, which is also what mock/dev accounts hit. */}
        {hasPhoto ? (
          <>
            <Image
              source={{ uri: peerPhotoUrl }}
              style={StyleSheet.absoluteFill}
              blurRadius={38}
              resizeMode="cover"
              onError={() => setPhotoFailed(true)}
              accessibilityIgnoresInvertColors
            />
            <LinearGradient colors={PHOTO_SCRIM} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
          </>
        ) : (
          <>
            <LinearGradient colors={colors.gradients.call} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
            <View pointerEvents="none" style={styles.bloomWrap}>
              <View style={styles.bloom} />
              <View style={styles.bloomInner} />
            </View>
          </>
        )}

        <View style={[styles.screen, { paddingTop: insets.top + space[2], paddingBottom: insets.bottom + space[8] }]}>
          {/* ‹ — leaves the call running and hands the app back. Only on an
              active call: a ringing one must not be dismissable to a banner
              the driver might never notice. */}
          <View style={styles.topBar}>
            {active ? (
              <Pressable
                onPress={() => { haptics.press(); minimize(); }}
                hitSlop={14}
                style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.55 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel={t('call.minimizeA11y')}
              >
                <Icon name="chevron-left" size={30} color={INK} />
              </Pressable>
            ) : null}
          </View>

          <Animated.View style={[styles.body, enterStyle]}>
            <View style={styles.avatarWrap}>
              {ringing && <PulseRing delay={0} color={ringingIn ? colors.go : colors.tealBright} reduceMotion={reduceMotion} />}
              {ringing && <PulseRing delay={1000} color={ringingIn ? colors.go : colors.tealBright} reduceMotion={reduceMotion} />}
              <View style={[
                styles.avatar,
                ringingIn && { borderColor: colors.go },
                ended && { borderColor: colors.danger },
              ]}>
                {ended
                  ? <Icon family="material-community" name="phone-hangup" size={40} color={colors.danger} />
                  : hasPhoto
                    ? <Image
                        source={{ uri: peerPhotoUrl }}
                        style={styles.avatarPhoto}
                        onError={() => setPhotoFailed(true)}
                        accessibilityIgnoresInvertColors
                      />
                    : <Text style={styles.avatarText}>{initials(peerName)}</Text>}
              </View>
            </View>

            <Text style={styles.peerName} numberOfLines={2}>{peerName || t('messages.dispatcherFallback')}</Text>

            {/* The timer is the one number the driver actually reads mid-call,
                so once connected it replaces the status line entirely, at
                display weight with tabular figures — otherwise every tick
                nudges the text sideways. */}
            {active ? (
              <Text style={styles.timer}>{duration}</Text>
            ) : (
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, { backgroundColor: statusDot }]} />
                <Text style={[styles.statusText, ended && { color: colors.danger }]} numberOfLines={2}>{statusText}</Text>
              </View>
            )}
          </Animated.View>

          {ended ? <View style={styles.footerSpacer} /> : ringingIn ? (
            <View style={styles.incomingActions}>
              <View style={styles.controlCol}>
                <Pressable
                  onPress={() => { haptics.press(); declineCall(); }}
                  style={({ pressed }) => [styles.bigBtn, { backgroundColor: colors.danger, transform: [{ scale: pressed ? motion.press : 1 }] }, shadow.glow(colors.danger)]}
                  accessibilityRole="button"
                  accessibilityLabel={t('call.declineCallA11y')}
                >
                  <Icon family="material-community" name="phone-hangup" size={32} color="#FFFFFF" />
                </Pressable>
                <Text style={styles.controlLabel}>{t('call.decline')}</Text>
              </View>
              <View style={styles.controlCol}>
                <Pressable
                  onPress={() => { haptics.success(); acceptCall(); }}
                  style={({ pressed }) => [styles.bigBtn, { backgroundColor: colors.go, transform: [{ scale: pressed ? motion.press : 1 }] }, shadow.glow(colors.go)]}
                  accessibilityRole="button"
                  accessibilityLabel={t('call.acceptCallA11y')}
                >
                  <Icon family="ionicons" name="call" size={28} color="#FFFFFF" />
                </Pressable>
                <Text style={styles.controlLabel}>{t('call.accept')}</Text>
              </View>
            </View>
          ) : (
            // One row, end-call inside it. Speaker/mute only exist once media
            // is up — before that there's no Daily call object to route, so
            // the buttons would silently no-op.
            <View style={styles.controlRow}>
              {active && (
                <ControlButton
                  icon={speakerOn ? 'volume-high' : 'volume-low'}
                  label={t('call.speaker')}
                  a11y={speakerOn ? t('call.speakerOffA11y') : t('call.speakerOnA11y')}
                  on={speakerOn}
                  onPress={() => { haptics.press(); toggleSpeaker(); }}
                />
              )}
              {active && (
                <ControlButton
                  icon={muted ? 'mic-off' : 'mic'}
                  label={muted ? t('call.unmute') : t('call.mute')}
                  a11y={muted ? t('call.unmuteA11y') : t('call.muteA11y')}
                  on={muted}
                  onPress={() => { haptics.press(); toggleMute(); }}
                />
              )}
              <ControlButton
                icon="phone-hangup"
                family="material-community"
                label={ringingOut ? t('common.cancel') : t('call.end')}
                a11y={t('call.hangUpA11y')}
                danger
                color={colors.danger}
                onPress={() => { haptics.impact(); hangUp(); }}
              />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Minimized banner ───────────────────────────────────────────────────

// Pinned under the status bar, full width, the whole strip tappable — iOS's
// "tap to return to call" bar. Screens shift down by BANNER_H (see
// useCallBannerInset) so it never covers a header.
function CallBanner({ call }) {
  const { colors } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const { startedAt, expand } = call;
  const duration = useElapsed(startedAt);
  const styles2 = useMemo(() => makeBannerStyles(colors), [colors]);

  const enter = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) { enter.setValue(1); return; }
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, ...motion.spring.snappy }).start();
  }, [reduceMotion]);

  return (
    <Animated.View
      style={[
        styles2.wrap,
        {
          paddingTop: insets.top,
          opacity: enter,
          transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-BANNER_H, 0] }) }],
        },
      ]}
    >
      {/* Green bar means light ink regardless of the app's own theme, so the
          status-bar glyphs are forced light for as long as it's up. */}
      <StatusBar style="light" />
      <Pressable
        onPress={() => { haptics.press(); expand(); }}
        style={({ pressed }) => [styles2.strip, pressed && { opacity: 0.75 }]}
        accessibilityRole="button"
        accessibilityLabel={t('call.expandA11y')}
      >
        <Icon family="material-community" name="phone-in-talk" size={14} color="#FFFFFF" />
        <Text style={styles2.text} numberOfLines={1}>
          {t('call.tapToReturn')} · {duration}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export default function CallOverlay() {
  const call = useCall();
  if (call.status === 'idle') return null;
  if (call.status === 'active' && call.minimized) return <CallBanner call={call} />;
  return <CallScreen call={call} />;
}

const styles = StyleSheet.create({
  // Base colour under the backdrop, so a slow-loading photo never flashes
  // white behind the blur.
  root: { flex: 1, backgroundColor: '#070C14' },
  screen: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[6] },

  bloomWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  bloom: { position: 'absolute', width: 420, height: 420, borderRadius: 999, top: '14%', backgroundColor: BLOOM_OUTER },
  bloomInner: { position: 'absolute', width: 240, height: 240, borderRadius: 999, top: '22%', backgroundColor: BLOOM_INNER },

  topBar: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', height: 44 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -space[3] },

  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[2] },
  avatarWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: space[5] },
  avatar: {
    width: 132, height: 132, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 2, borderColor: CONTROL_EDGE,
    // Clips the photo to the circle while the border and the pulse rings stay
    // on the wrapper around it.
    overflow: 'hidden',
    ...elevation[3],
  },
  avatarPhoto: { width: '100%', height: '100%' },
  avatarText: { fontSize: 44, fontFamily: FONT.black, color: INK },

  peerName: { ...type.h1, color: INK, textAlign: 'center' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], maxWidth: '90%' },
  statusDot: { width: 8, height: 8, borderRadius: 999 },
  statusText: { ...type.body, color: INK_DIM, textAlign: 'center' },
  timer: { fontSize: 34, fontFamily: FONT.bold, color: INK, ...type.num, letterSpacing: -0.5 },

  footerSpacer: { height: 96 },
  controlRow: { flexDirection: 'row', justifyContent: 'center', gap: space[5] },
  controlCol: { alignItems: 'center', gap: space[2], width: 84 },
  controlBtn: {
    width: 64, height: 64, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
    borderColor: CONTROL_EDGE,
  },
  controlLabel: { ...type.caption, fontSize: 12, color: INK_DIM },

  incomingActions: { flexDirection: 'row', justifyContent: 'center', gap: space[12] },
  bigBtn: { width: 76, height: 76, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
});

const makeBannerStyles = (c) => StyleSheet.create({
  wrap: {
    position: 'absolute', top: 0, left: 0, right: 0,
    backgroundColor: c.go,
    ...elevation[2],
  },
  strip: {
    height: BANNER_H,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2],
    paddingHorizontal: space[4],
  },
  text: { fontSize: 13, fontFamily: FONT.bold, color: '#FFFFFF', ...type.num },
});
