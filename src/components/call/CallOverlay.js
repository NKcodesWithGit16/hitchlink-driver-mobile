// The faces of a live call, all driven by CallContext's `status`:
//
//   • CallScreen — the full-bleed takeover (a Modal, so it covers the tabs).
//     Every state except a minimized active call renders this. With a camera
//     live it becomes a video stage; with none it is the audio call screen
//     that has always been here, unchanged.
//   • CallBanner — a thin green bar pinned under the status bar, shown when a
//     minimized call has no video to show.
//   • FloatingCallWindow — a small draggable video window, shown instead of
//     the banner when a minimized call DOES have video. Corner-snapping, and
//     tapping it reopens the takeover.
//
// ⚠️ Neither minimized form is a Modal, and that is not a style choice: an iOS
// Modal swallows every touch beneath it, which is what once made the whole app
// unusable mid-call. Both are absolutely-positioned views so the tabs, chat and
// documents stay usable while the call runs. Anything added here inherits that
// constraint.
//
// Which minimized form appears follows what there is to SEE (`isVideoLive` —
// is either camera actually on), not how the call was placed. A video call
// where both cameras are off has nothing to put in a window, so it collapses
// to the banner like any other; turning a camera on mid-call swaps it to the
// window. useCallBannerInset and the renderer below share that one predicate,
// so they cannot disagree about which is on screen.
//
// None of them owns the call. Daily's call object and the CallKit session live
// in CallContext, so swapping between these is purely a change of what's on
// screen — audio never drops, and hanging up from the reopened screen goes
// through the same hangUp() that retires CallKit's native session.
//
// Mounted once at the root layout (app/_layout.js) so a call rings and stays
// reachable no matter which tab is open.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, Image, Animated, Easing, PanResponder, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../ui/Icon';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n/LanguageContext';
import { useCall } from '../../context/CallContext';
import { useReduceMotion } from '../../lib/useReduceMotion';
import haptics from '../../lib/haptics';
import VideoTile from './VideoTile';
import { clampToBounds, nearestCorner } from '../../lib/pipGeom';
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
// Video stage scrims. Top and bottom only, and they fade out with the chrome —
// the middle of the frame is the other person's face and is never darkened.
const STAGE_SCRIM_TOP = ['rgba(4,10,20,0.78)', 'rgba(4,10,20,0)'];
const STAGE_SCRIM_BOTTOM = ['rgba(4,10,20,0)', 'rgba(4,10,20,0.86)'];

// Height of the banner's content strip, below the status-bar inset. Screens
// add this to their own top padding while a call is minimized — see
// useCallBannerInset.
const BANNER_H = 30;

// The local camera's picture-in-picture inside the takeover, and the floating
// window a minimized video call collapses to. Both portrait — a phone camera's
// natural shape, and a landscape box would waste most of its area on bars.
const PIP_W = 104;
const PIP_H = 148;
const WINDOW_W = 132;
const WINDOW_H = 186;
const PIP_MARGIN = space[4];
// Reserved strips the PiP is kept out of: the header it would cover, and the
// control row it must never come to rest on top of. Approximate on purpose —
// they only bound a draggable tile, and measuring them would mean an onLayout
// pass that leaves the tile unplaced for a frame.
const TOPBAR_H = 44;
const CONTROLS_H = 150;

// How long the video stage's chrome stays up after the last touch. Long enough
// to find a button without hunting, short enough that the call is mostly the
// other person's face rather than a row of controls over it.
const CHROME_HIDE_MS = 4000;

// Movement past this reads as a drag rather than a tap, so a floating window
// can be both draggable and tappable without one stealing from the other.
const DRAG_SLOP = 6;

/**
 * Is there actually video on screen right now? Not "was this placed as a video
 * call" — a video call with both cameras off has nothing to show and should
 * behave exactly like an audio one.
 */
function isVideoLive(call) {
  return !!(call.remoteCameraOn || call.cameraOn);
}

/**
 * Extra top padding a screen needs while a call is minimized, so its header
 * isn't hidden behind the banner. 0 the rest of the time.
 *
 * The floating video window deliberately returns 0 as well: it floats over the
 * content and snaps to a corner, so unlike the full-width banner it never
 * needs the app to move out of its way.
 */
export function useCallBannerInset() {
  const call = useCall();
  if (call.status !== 'active' || !call.minimized) return 0;
  return isVideoLive(call) ? 0 : BANNER_H;
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

/**
 * A tile the driver can drag around and let go of, which then flies to the
 * nearest corner.
 *
 * Built on Animated + PanResponder deliberately — neither
 * react-native-gesture-handler nor react-native-reanimated is a dependency of
 * this project, and pulling one in for this would force an extra EAS build
 * (see PhotoViewer.js, which makes the same call for the same reason).
 *
 * Position lives in an Animated.ValueXY driven by transform, never in state
 * and never as top/left: a per-frame setState makes dragging feel heavy, and
 * layout props can't run on the native driver at all. `posRef` mirrors it in
 * plain JS because the responder has to know where the tile currently is at
 * the moment a gesture starts, which it cannot read back off the animated
 * value.
 *
 * `onTap` fires only when the finger travelled less than DRAG_SLOP, so the
 * floating window can be dragged AND tapped to reopen the call.
 */
function useDraggableTile({ bounds, size, margin = PIP_MARGIN, onTap, reduceMotion }) {
  const pos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const posRef = useRef({ x: 0, y: 0 });
  const originRef = useRef({ x: 0, y: 0 });
  // Refs, not the values themselves: the PanResponder is built once, so a
  // gesture that starts after a rotation or a safe-area change has to read the
  // current bounds rather than the ones captured on first render.
  const boundsRef = useRef(bounds);
  const sizeRef = useRef(size);
  const onTapRef = useRef(onTap);
  boundsRef.current = bounds;
  sizeRef.current = size;
  onTapRef.current = onTap;

  const settle = useCallback((next, animated = true) => {
    posRef.current = next;
    if (!animated || reduceMotion) { pos.setValue(next); return; }
    Animated.spring(pos, { toValue: next, useNativeDriver: true, ...motion.spring.snappy }).start();
  }, [pos, reduceMotion]);

  // Park it in a corner as soon as the container has been measured, and keep
  // it inside if the container later changes (rotation, the keyboard, a
  // safe-area shift) rather than leaving it stranded off-screen.
  useEffect(() => {
    if (!bounds.width || !bounds.height) return;
    const corner = nearestCorner(posRef.current, bounds, size, margin);
    settle(corner, false);
  }, [bounds.x, bounds.y, bounds.width, bounds.height, size.width, size.height, margin, settle]);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) => Math.hypot(g.dx, g.dy) > 2,
    onPanResponderGrant: () => { originRef.current = { ...posRef.current }; },
    onPanResponderMove: (_e, g) => {
      const next = clampToBounds(
        { x: originRef.current.x + g.dx, y: originRef.current.y + g.dy },
        boundsRef.current, sizeRef.current, margin,
      );
      posRef.current = next;
      pos.setValue(next);
    },
    // Terminate is handled the same as release: a gesture cancelled by the OS
    // (a call banner, a system sheet) must still leave the tile in a corner
    // rather than wherever the finger happened to be.
    onPanResponderRelease: (_e, g) => {
      if (Math.hypot(g.dx, g.dy) < DRAG_SLOP) { onTapRef.current?.(); return; }
      settle(nearestCorner(posRef.current, boundsRef.current, sizeRef.current, margin));
    },
    onPanResponderTerminate: () => {
      settle(nearestCorner(posRef.current, boundsRef.current, sizeRef.current, margin));
    },
  }), [pos, margin, settle]);

  return { pos, panHandlers: responder.panHandlers };
}

/**
 * Chrome that fades out on its own and comes back on a touch — the video
 * stage's controls. Returns an opacity to animate with, whether the chrome is
 * currently interactive, and a `poke` to call on any interaction.
 *
 * `active` gates the whole thing: chrome must never auto-hide while a call is
 * ringing or connecting, or on the audio screen, where the buttons are the only
 * thing on screen that matters.
 *
 * ⚠️ `active` is answered HERE, and the returned opacity must be bound to its
 * view unconditionally — never `active && { opacity }` at the call site. It was
 * written that way and it lost the driver their buttons: with the dispatcher's
 * camera the only one on, the chrome would auto-hide to opacity 0, and the
 * moment the dispatcher turned that camera off `isVideoLive` flipped false and
 * the animated value was pulled out of the style array while still sitting at
 * 0. The value is native-driven (useNativeDriver below), so detaching it left
 * the native view at 0 with nothing able to put it back — animating it to 1
 * afterwards did nothing, because it was no longer attached to anything. The
 * controls were still there and still tappable, just invisible.
 *
 * Hence `hidden` (the timer's opinion) and `visible` (what actually renders)
 * being separate: only the stage may hide chrome, so anywhere else `visible` is
 * true regardless of what the timer last did, and the value animates back to 1
 * through a node that is still connected.
 */
function useAutoHideChrome(active, reduceMotion) {
  const [hidden, setHidden] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;
  const timer = useRef(null);

  // A stale `hidden` from a previous video stage can never leak into the audio
  // screen: off the stage, chrome is always shown.
  const visible = !active || !hidden;

  const poke = useCallback(() => {
    setHidden(false);
    if (timer.current) clearTimeout(timer.current);
    if (!active) return;
    timer.current = setTimeout(() => setHidden(true), CHROME_HIDE_MS);
  }, [active]);

  const toggle = useCallback(() => {
    // Only meaningful on the stage — `visible` ignores `hidden` elsewhere, so
    // this can't hide the audio screen's controls.
    if (visible) {
      if (timer.current) clearTimeout(timer.current);
      setHidden(true);
    } else {
      poke();
    }
  }, [visible, poke]);

  useEffect(() => { poke(); return () => { if (timer.current) clearTimeout(timer.current); }; }, [poke]);

  useEffect(() => {
    if (reduceMotion) { opacity.setValue(visible ? 1 : 0); return; }
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: motion.duration.fast,
      easing: motion.easing.standard,
      useNativeDriver: true,
    }).start();
  }, [visible, reduceMotion, opacity]);

  return { opacity, visible, poke, toggle };
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
// `dense` shrinks the button for a row that has to hold more of them. An
// active video call carries five (speaker, mute, camera, flip, end) and at the
// full 64px they overflow the width of an ordinary phone — the columns flex,
// so without this the buttons would simply be clipped by their own column.
function ControlButton({ icon, family = 'ionicons', label, on, danger, onPress, a11y, color, dense }) {
  const bg = danger ? color : on ? CONTROL_BG_ON : CONTROL_BG;
  const size = dense ? 56 : 64;
  return (
    <View style={styles.controlCol}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.controlBtn,
          { width: size, height: size },
          { backgroundColor: bg, borderWidth: on || danger ? 0 : 1, transform: [{ scale: pressed ? motion.press : 1 }] },
          danger && shadow.glow(color),
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected: !!on }}
        accessibilityLabel={a11y}
      >
        <Icon family={family} name={icon} size={dense ? 22 : 24} color={on ? '#0A1420' : INK} />
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
    video, cameraOn, remoteCameraOn, localVideoTrack, remoteVideoTrack,
    acceptCall, declineCall, hangUp, toggleMute, toggleSpeaker, toggleCamera, switchCamera, minimize,
  } = call;
  const duration = useElapsed(status === 'active' ? startedAt : null);
  const { width: winW, height: winH } = useWindowDimensions();

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

  // The stage is on only when there is something to show. A video call whose
  // cameras are both off renders exactly the audio screen below — no empty
  // black rectangle where a face should be.
  const videoStage = active && isVideoLive(call);
  const chrome = useAutoHideChrome(videoStage, reduceMotion);

  // Where the PiP is allowed to roam. Derived rather than measured with
  // onLayout because the stage is the full window by definition, and a
  // measurement pass would leave the tile unplaced for a frame on open.
  //
  // Two things are carved out. The top bar, so it can't sit over the name and
  // timer; and the control strip, so it can never come to rest on top of Hang
  // up. The control carve-out is NOT conditional on the chrome being visible —
  // the bounds have to stay still, or the tile would drift every time the
  // controls faded.
  const pipBounds = useMemo(() => {
    const top = insets.top + TOPBAR_H;
    const bottom = insets.bottom + CONTROLS_H;
    return {
      x: 0,
      y: top,
      width: winW,
      height: Math.max(PIP_H + PIP_MARGIN * 2, winH - top - bottom),
    };
  }, [winW, winH, insets.top, insets.bottom]);
  const pipSize = useMemo(() => ({ width: PIP_W, height: PIP_H }), []);
  const pip = useDraggableTile({ bounds: pipBounds, size: pipSize, onTap: chrome.poke, reduceMotion });

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
  // A video call says so while it's ringing — that's the one moment the
  // distinction changes what the driver is agreeing to, and CallKit's own
  // screen labels it the same way.
  const statusText = ringingIn ? (video ? t('call.incomingVideoCall') : t('call.incomingCall'))
    : ringingOut ? (video ? t('call.callingVideo') : t('call.calling'))
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

        {/* Backdrop. With a camera live it's the remote feed, full-bleed —
            video is the surface and every piece of chrome floats over it.
            Otherwise it stays what it has always been: the dispatcher's own
            photo, blown up and blurred behind a scrim, falling back to the
            brand gradient when there's no usable photo (which is also what
            mock/dev accounts hit). */}
        {videoStage ? (
          <>
            {/* ⚠️ Gated on remoteCameraOn, not just on the track existing. The
                track is Daily's `persistentTrack`, which deliberately SURVIVES
                being muted — so when they turn their camera off it is still a
                perfectly valid track object that has simply stopped producing
                frames, and DailyMediaView goes on showing the last one it
                decoded. That looked exactly like the call had frozen. Passing
                null is what gets the camera-off placeholder instead. */}
            <VideoTile
              track={remoteCameraOn ? remoteVideoTrack : null}
              name={peerName}
              photoUrl={hasPhoto ? peerPhotoUrl : null}
              objectFit="cover"
              style={StyleSheet.absoluteFillObject}
            />
            {/* Only the top and bottom are darkened, and only while the chrome
                is up — a scrim over the middle of someone's face is exactly
                what a video call shouldn't have. */}
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { opacity: chrome.opacity }]}>
              <LinearGradient colors={STAGE_SCRIM_TOP} style={styles.scrimTop} />
              <LinearGradient colors={STAGE_SCRIM_BOTTOM} style={styles.scrimBottom} />
            </Animated.View>
          </>
        ) : hasPhoto ? (
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

        {/* Tap anywhere on the video to bring the chrome back (or send it
            away). Sits above the feed and below everything else, so a tap that
            lands on an actual button is that button's, not this. */}
        {videoStage ? (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={chrome.toggle}
            accessibilityRole="button"
            accessibilityLabel={t('call.toggleControlsA11y')}
          />
        ) : null}

        {/* Our own camera, draggable, snapping to whichever corner it's let go
            nearest. Mirrored, because people expect their own image to behave
            like a mirror.
            ⚠️ A sibling of the safe-area container, not a child of it. An
            absolutely-positioned child is laid out from its parent's CONTENT
            box, so inside that padded container `top: 0` would mean "below the
            status bar and in from the side" — every position off by the
            padding, and the right-hand corners pushed off-screen. Here `top: 0`
            is the window origin, which is the space pipBounds is expressed in.
            Rendered BEFORE the container so the controls stay above it. */}
        {videoStage && cameraOn ? (
          <Animated.View
            {...pip.panHandlers}
            style={[styles.pip, { transform: pip.pos.getTranslateTransform() }]}
          >
            <View style={styles.pipClip}>
              {/* Gated for the same reason as the stage above, even though the
                  enclosing `cameraOn` check already covers it today — a muted
                  persistentTrack must never reach a media view. */}
              <VideoTile
                track={cameraOn ? localVideoTrack : null}
                mirror
                zOrder={1}
                compact
                objectFit="cover"
                style={styles.pipInner}
              />
            </View>
          </Animated.View>
        ) : null}

        <View
          pointerEvents="box-none"
          style={[styles.screen, { paddingTop: insets.top + space[2], paddingBottom: insets.bottom + space[8] }]}
        >
          {/* ‹ — leaves the call running and hands the app back. Only on an
              active call: a ringing one must not be dismissable to a banner
              the driver might never notice. */}
          {/* opacity is bound unconditionally — see the ⚠️ on useAutoHideChrome.
              The hook already holds it at 1 off the video stage. */}
          <Animated.View
            style={[styles.topBar, { opacity: chrome.opacity }]}
            pointerEvents={chrome.visible ? 'box-none' : 'none'}
          >
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
            {/* On the video stage the name and timer move up here — the middle
                of the screen belongs to the other person's face. */}
            {videoStage ? (
              <View style={styles.stageHeading}>
                <Text style={styles.stageName} numberOfLines={1}>{peerName || t('messages.dispatcherFallback')}</Text>
                <Text style={styles.stageTimer}>{duration}</Text>
              </View>
            ) : null}
          </Animated.View>

          {/* The identity block — big avatar, name, status. It IS the audio
              call screen, and it's what a camera-off video call falls back to.
              On the stage it gives way to the feed. */}
          <Animated.View
            style={[styles.body, enterStyle, videoStage && styles.bodyHidden]}
            pointerEvents={videoStage ? 'none' : 'auto'}
          >
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
                  accessibilityLabel={video ? t('call.acceptVideoCallA11y') : t('call.acceptCallA11y')}
                >
                  <Icon
                    family={video ? 'material-community' : 'ionicons'}
                    name={video ? 'video' : 'call'}
                    size={28}
                    color="#FFFFFF"
                  />
                </Pressable>
                <Text style={styles.controlLabel}>{t('call.accept')}</Text>
              </View>
            </View>
          ) : (
            // One row, end-call inside it. Everything but hang-up only exists
            // once media is up — before that there's no Daily call object to
            // route, so the buttons would silently no-op.
            //
            // The row fades with the rest of the chrome on the video stage, and
            // stops taking touches while faded so a tap there falls through to
            // the "bring the controls back" catcher rather than hitting an
            // invisible Mute.
            <Animated.View
              style={[styles.controlRow, { opacity: chrome.opacity }]}
              pointerEvents={chrome.visible ? 'auto' : 'none'}
            >
              {active && (
                <ControlButton
                  icon={speakerOn ? 'volume-high' : 'volume-low'}
                  label={t('call.speaker')}
                  a11y={speakerOn ? t('call.speakerOffA11y') : t('call.speakerOnA11y')}
                  on={speakerOn}
                  dense={active}
                  onPress={() => { haptics.press(); chrome.poke(); toggleSpeaker(); }}
                />
              )}
              {active && (
                <ControlButton
                  icon={muted ? 'mic-off' : 'mic'}
                  label={muted ? t('call.unmute') : t('call.mute')}
                  a11y={muted ? t('call.unmuteA11y') : t('call.muteA11y')}
                  on={muted}
                  dense={active}
                  onPress={() => { haptics.press(); chrome.poke(); toggleMute(); }}
                />
              )}
              {/* Camera. On an audio call this is the upgrade — one tap and it
                  becomes a video call for both ends. It's offered on every
                  active call for exactly that reason, not only on ones placed
                  as video. */}
              {active && (
                <ControlButton
                  icon={cameraOn ? 'video' : 'video-off'}
                  family="material-community"
                  label={t('call.camera')}
                  a11y={cameraOn ? t('call.cameraOffA11y') : t('call.cameraOnA11y')}
                  on={cameraOn}
                  dense={active}
                  onPress={() => { haptics.press(); chrome.poke(); toggleCamera(); }}
                />
              )}
              {/* Flip is meaningless with the camera off, and a driver showing
                  the dispatcher a load wants the back one. */}
              {active && cameraOn && (
                <ControlButton
                  icon="camera-flip"
                  family="material-community"
                  label={t('call.flip')}
                  a11y={t('call.flipCameraA11y')}
                  dense={active}
                  onPress={() => { haptics.press(); chrome.poke(); switchCamera(); }}
                />
              )}
              <ControlButton
                icon="phone-hangup"
                family="material-community"
                label={ringingOut ? t('common.cancel') : t('call.end')}
                a11y={t('call.hangUpA11y')}
                danger
                color={colors.danger}
                dense={active}
                onPress={() => { haptics.impact(); hangUp(); }}
              />
            </Animated.View>
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

// ── Minimized video window ─────────────────────────────────────────────

// What a minimized call collapses to when there IS something to see. Shows the
// remote feed (their camera off but ours on falls back to our own, so the
// window is never a black box), snaps to a corner, and reopens the takeover on
// a tap.
//
// ⚠️ Like CallBanner, deliberately not a Modal — see the file header. It also
// does NOT push the app's content down the way the banner does
// (useCallBannerInset returns 0 for it): it floats in a corner, so displacing
// every screen's header for it would be a much bigger intrusion than the thing
// itself.
function FloatingCallWindow({ call }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const { width: winW, height: winH } = useWindowDimensions();
  const { expand, remoteCameraOn, remoteVideoTrack, cameraOn, localVideoTrack, peerName, peerPhotoUrl, startedAt } = call;
  const duration = useElapsed(startedAt);

  const bounds = useMemo(() => ({
    x: 0,
    y: insets.top,
    width: winW,
    height: Math.max(0, winH - insets.top - insets.bottom),
  }), [winW, winH, insets.top, insets.bottom]);
  const size = useMemo(() => ({ width: WINDOW_W, height: WINDOW_H }), []);
  const onTap = useCallback(() => { haptics.press(); expand(); }, [expand]);
  const tile = useDraggableTile({ bounds, size, onTap, reduceMotion });

  // Prefer their camera; fall back to ours so a driver who turned their own on
  // while the dispatcher's is off still sees video rather than a placeholder.
  const showRemote = remoteCameraOn && !!remoteVideoTrack;
  // Both halves gated on their camera flag: a persistentTrack outlives being
  // muted, so an ungated fallback would freeze on its last frame rather than
  // showing the placeholder. See the ⚠️ on the stage's VideoTile.
  const track = showRemote ? remoteVideoTrack : (cameraOn ? localVideoTrack : null);

  return (
    <Animated.View
      {...tile.panHandlers}
      style={[styles2Window.wrap, { transform: tile.pos.getTranslateTransform() }]}
      accessibilityRole="button"
      accessibilityLabel={t('call.expandA11y')}
    >
      <View style={styles2Window.clip}>
        <VideoTile
          track={track}
          mirror={!showRemote}
          compact
          name={peerName}
          photoUrl={peerPhotoUrl}
          objectFit="cover"
          style={styles2Window.video}
        />
        <View pointerEvents="none" style={styles2Window.footer}>
          <Text style={styles2Window.timer} numberOfLines={1}>{duration}</Text>
        </View>
      </View>
    </Animated.View>
  );
}

export default function CallOverlay() {
  const call = useCall();
  if (call.status === 'idle') return null;
  if (call.status === 'active' && call.minimized) {
    // Same predicate the inset hook uses, so the two can never disagree about
    // which minimized form is on screen.
    return isVideoLive(call) ? <FloatingCallWindow call={call} /> : <CallBanner call={call} />;
  }
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

  scrimTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 200 },
  scrimBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 260 },

  // Name + timer beside the ‹ on the video stage. `flex: 1` with the back
  // button's fixed 44 keeps it centred-ish without a second absolute layer.
  stageHeading: { flex: 1, alignItems: 'flex-start', justifyContent: 'center', paddingLeft: space[1] },
  stageName: { ...type.bodyStrong, fontSize: 16, color: INK },
  stageTimer: { ...type.caption, ...type.num, color: INK_DIM, marginTop: 1 },

  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[2] },
  // Collapsed rather than unmounted: the identity block holds the photo and
  // the enter animation, and tearing it down every time a camera comes on
  // would re-run both on each toggle.
  bodyHidden: { opacity: 0, height: 0, flex: 0, overflow: 'hidden' },

  // Positioned absolutely inside the safe-area container, then moved by
  // transform — see useDraggableTile for why it is never top/left.
  //
  // Two nested views on purpose: iOS clips a shadow the moment `overflow:
  // hidden` is set, and the video needs clipping to the rounded corners. So
  // the outer one owns the fill and the elevation, the inner one owns the clip.
  pip: {
    position: 'absolute', top: 0, left: 0,
    width: PIP_W, height: PIP_H, borderRadius: 16,
    backgroundColor: '#0B111C',
    ...elevation[3],
  },
  pipClip: {
    width: '100%', height: '100%',
    borderRadius: 16, overflow: 'hidden',
    borderWidth: 1, borderColor: CONTROL_EDGE,
  },
  pipInner: { width: '100%', height: '100%' },
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
  // The row spreads across the full width and the columns flex, because the
  // button count is not fixed: two while ringing out, up to five on an active
  // video call. A fixed column width overflowed the screen at five (see the
  // `dense` note on ControlButton).
  controlRow: {
    flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'flex-start',
    alignSelf: 'stretch',
  },
  controlCol: { alignItems: 'center', gap: space[2], flex: 1, maxWidth: 88 },
  controlBtn: {
    borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
    borderColor: CONTROL_EDGE,
  },
  controlLabel: { ...type.caption, fontSize: 12, color: INK_DIM },

  incomingActions: { flexDirection: 'row', justifyContent: 'center', gap: space[12] },
  bigBtn: { width: 76, height: 76, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
});

// Fixed rather than themed, like the takeover: it's a video surface, so its
// chrome is dark ink over the feed regardless of the app's day/night setting.
const styles2Window = StyleSheet.create({
  // Same outer-fill / inner-clip split as the PiP — iOS drops a shadow the
  // moment `overflow: hidden` lands on the same view.
  wrap: {
    position: 'absolute', top: 0, left: 0,
    width: WINDOW_W, height: WINDOW_H,
    borderRadius: 18,
    backgroundColor: '#0B111C',
    ...elevation[4],
  },
  clip: {
    width: '100%', height: '100%',
    borderRadius: 18, overflow: 'hidden',
    borderWidth: 1, borderColor: CONTROL_EDGE,
  },
  video: { width: '100%', height: '100%' },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingVertical: 4, alignItems: 'center',
    backgroundColor: 'rgba(4,10,20,0.55)',
  },
  timer: { fontSize: 12, fontFamily: FONT.bold, color: '#FFFFFF', ...type.num },
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
