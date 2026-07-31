// One video surface, plus the thing to show when there isn't one.
//
// Every video in a call goes through here — the remote feed filling the
// takeover, the local camera in its picture-in-picture, and the floating
// window a minimized video call collapses to. Centralising it means the
// "camera is off" state is designed once rather than three times, and that a
// build whose native module predates video degrades to that same state instead
// of crashing.
//
// Audio is NOT routed through this view. On React Native the call object owns
// the audio session (see CallContext's setNativeInCallAudioMode /
// applyAudioRoute), so `audioTrack` is always null here — passing a track would
// be a second, competing output path. The prop is required by DailyMediaView's
// signature, which is why it's spelled out rather than omitted.
import { View, Text, Image, StyleSheet } from 'react-native';
import Icon from '../ui/Icon';
import { FONT, type } from '../../theme/tokens';

// Same lazy, defensive require as CallContext's — this component is reachable
// from the root layout, so a hard import would take the whole app down on a
// binary that predates the dependency rather than just losing video.
let DailyMediaView = null;
try {
  DailyMediaView = require('@daily-co/react-native-daily-js').DailyMediaView ?? null;
} catch {
  DailyMediaView = null;
}

export const videoAvailable = !!DailyMediaView;

function initials(name) {
  return (name || '?').split(' ').map((w) => w[0]).filter(Boolean).join('').toUpperCase().slice(0, 2);
}

/**
 * @param track     MediaStreamTrack | null — null renders the placeholder.
 * @param mirror    Front-facing local video is mirrored, remote video never is:
 *                  people expect their own image to behave like a mirror, and
 *                  expect everyone else's to read the right way round.
 * @param objectFit 'cover' for a full-bleed stage, 'contain' when the whole
 *                  frame matters more than filling the box.
 * @param name      Drives the placeholder's initials.
 * @param photoUrl  Placeholder photo; falls back to initials, then to a glyph.
 * @param compact   Smaller placeholder for a PiP-sized tile.
 * @param zOrder    Android renders video into native surfaces, which do NOT
 *                  respect normal view ordering — a picture-in-picture over a
 *                  full-bleed feed needs a higher zOrder or it is drawn behind
 *                  it however the JSX is nested. Ignored on iOS.
 */
export default function VideoTile({
  track,
  mirror = false,
  objectFit = 'cover',
  name,
  photoUrl,
  compact = false,
  zOrder = 0,
  style,
}) {
  if (track && DailyMediaView) {
    return (
      <DailyMediaView
        videoTrack={track}
        audioTrack={null}
        mirror={mirror}
        objectFit={objectFit}
        zOrder={zOrder}
        style={StyleSheet.flatten([styles.fill, style])}
      />
    );
  }

  // Camera off (or no video support in this build). Deliberately the same
  // treatment the audio call has always used, so an audio call and a
  // camera-off video call look intentional and identical rather than one of
  // them looking broken.
  const size = compact ? 34 : 96;
  return (
    <View style={[styles.fill, styles.placeholder, style]}>
      {photoUrl ? (
        <Image
          source={{ uri: photoUrl }}
          style={{ width: size, height: size, borderRadius: 999 }}
          accessibilityIgnoresInvertColors
        />
      ) : name ? (
        <View style={[styles.initialsWrap, { width: size, height: size }]}>
          <Text style={[styles.initials, { fontSize: compact ? 13 : 34 }]}>{initials(name)}</Text>
        </View>
      ) : (
        <Icon family="material-community" name="video-off" size={compact ? 16 : 32} color="rgba(255,255,255,0.55)" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { width: '100%', height: '100%' },
  placeholder: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#0B111C',
  },
  initialsWrap: {
    borderRadius: 999, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  initials: { fontFamily: FONT.black, color: '#FFFFFF' },
});
