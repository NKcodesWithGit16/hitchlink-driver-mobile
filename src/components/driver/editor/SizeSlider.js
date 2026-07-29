import { useMemo, useRef } from 'react';
import { View, PanResponder, StyleSheet } from 'react-native';

// Vertical size control pinned to the left edge — stroke width when drawing,
// type size when adding text.
//
// Down is smaller, matching Messenger and every other editor: the handle's
// distance from the bottom reads as "how much".
//
// The handle is deliberately much larger than the track. The track is a hint;
// the handle is the thing a driver grabs, often through a glove, on a moving
// truck. Touch is taken over the whole strip rather than the handle alone, so
// tapping anywhere on the track jumps straight to that value.

const TRACK_W = 4;
const HANDLE = 30;
const STRIP_W = 44;

export default function SizeSlider({ value, min, max, height, onChange, style }) {
  const trackH = Math.max(HANDLE * 2, height);
  const usable = trackH - HANDLE;

  const live = useRef({ usable, min, max });
  live.current = { usable, min, max };

  const setFromY = (y) => {
    const { usable: u, min: lo, max: hi } = live.current;
    // y is measured within the strip; invert so the bottom is the minimum.
    const clamped = Math.max(0, Math.min(u, y - HANDLE / 2));
    const ratio = u > 0 ? 1 - clamped / u : 0;
    onChange(lo + ratio * (hi - lo));
  };

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => setFromY(e.nativeEvent.locationY),
    onPanResponderMove: (e) => setFromY(e.nativeEvent.locationY),
    // The photo underneath would otherwise steal the drag halfway through.
    onPanResponderTerminationRequest: () => false,
  }), []);   // eslint-disable-line react-hooks/exhaustive-deps

  const ratio = max > min ? (value - min) / (max - min) : 0;
  const handleTop = (1 - Math.max(0, Math.min(1, ratio))) * usable;

  // The handle grows with the value, so the control previews what it sets.
  const dot = Math.round(HANDLE * (0.45 + 0.55 * Math.max(0, Math.min(1, ratio))));

  return (
    <View style={[styles.strip, { height: trackH }, style]} {...responder.panHandlers}>
      <View style={[styles.track, { top: HANDLE / 2, bottom: HANDLE / 2 }]} pointerEvents="none" />
      <View
        style={[styles.handle, { top: handleTop, width: dot, height: dot, borderRadius: dot / 2, marginLeft: (HANDLE - dot) / 2 }]}
        pointerEvents="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { width: STRIP_W, alignItems: 'center', justifyContent: 'center' },
  track: {
    position: 'absolute',
    width: TRACK_W,
    borderRadius: TRACK_W / 2,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  handle: {
    position: 'absolute',
    left: (STRIP_W - HANDLE) / 2,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
});
