import { useMemo, useRef } from 'react';
import { View, PanResponder, StyleSheet } from 'react-native';
import { clampCropRect, applyAspect } from '../../../lib/editorGeom';

// Which corner must stay put while a given handle is dragged.
const ANCHOR = {
  tl: 'br', tr: 'bl', bl: 'tr', br: 'tl',
  top: 'br', bottom: 'tr', left: 'br', right: 'bl',
};

// The crop rectangle: dimmed exterior, rule-of-thirds grid, eight drag targets
// (four corners, four edges) plus a draggable interior.
//
// Handles are rendered as corner brackets rather than dots — a dot on a busy
// photo is easy to lose, and brackets read as "this corner moves" without
// covering the thing being cropped.
//
// Every drag runs through clampCropRect, so a handle dragged past its opposite
// edge stops at the minimum size instead of inverting the rect. An inverted rect
// reaches the native cropper as a negative width and fails with an error that
// says nothing useful.

const HANDLE_HIT = 36;      // touch target
const BRACKET = 26;         // drawn corner length
const BRACKET_W = 4;

export default function CropOverlay({ rect, bounds, ratio, onChange }) {
  // The PanResponder is built once; these mirror the props it needs so it never
  // reads a stale rect from its first render.
  const live = useRef({ rect, bounds, ratio });
  live.current = { rect, bounds, ratio };
  const start = useRef(null);

  const makeResponder = (corner) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { start.current = { ...live.current.rect }; },
    onPanResponderMove: (_e, g) => {
      const s = start.current;
      if (!s) return;
      const { dx, dy } = g;
      let next;

      switch (corner) {
        case 'tl': next = { x: s.x + dx, y: s.y + dy, width: s.width - dx, height: s.height - dy }; break;
        case 'tr': next = { x: s.x, y: s.y + dy, width: s.width + dx, height: s.height - dy }; break;
        case 'bl': next = { x: s.x + dx, y: s.y, width: s.width - dx, height: s.height + dy }; break;
        case 'br': next = { x: s.x, y: s.y, width: s.width + dx, height: s.height + dy }; break;
        case 'top': next = { x: s.x, y: s.y + dy, width: s.width, height: s.height - dy }; break;
        case 'bottom': next = { x: s.x, y: s.y, width: s.width, height: s.height + dy }; break;
        case 'left': next = { x: s.x + dx, y: s.y, width: s.width - dx, height: s.height }; break;
        case 'right': next = { x: s.x, y: s.y, width: s.width + dx, height: s.height }; break;
        default: next = { x: s.x + dx, y: s.y + dy, width: s.width, height: s.height }; break;
      }

      // Dragging a top/left edge shrinks by moving the origin, so a past-the-end
      // drag has to pin the origin too — otherwise the rect walks away as it
      // clamps.
      if (next.width < 0) { next.x += next.width; next.width = Math.abs(next.width); }
      if (next.height < 0) { next.y += next.height; next.height = Math.abs(next.height); }

      // Moving the whole rect never reshapes it, so it skips the aspect lock.
      const { bounds: b, ratio: r } = live.current;
      onChange(corner === 'move' || !r
        ? clampCropRect(next, b)
        : applyAspect(next, r, b, ANCHOR[corner] || 'br'));
    },
    onPanResponderRelease: () => { start.current = null; },
    onPanResponderTerminationRequest: () => false,
  });

  // One responder per target, created once.
  const responders = useMemo(() => ({
    tl: makeResponder('tl'), tr: makeResponder('tr'),
    bl: makeResponder('bl'), br: makeResponder('br'),
    top: makeResponder('top'), bottom: makeResponder('bottom'),
    left: makeResponder('left'), right: makeResponder('right'),
    move: makeResponder('move'),
  }), []);   // eslint-disable-line react-hooks/exhaustive-deps

  const { x, y, width, height } = rect;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Four dimming panels around the rect rather than one with a hole —
          RN has no cut-out, and four plain Views are cheaper than a mask.
          Each is anchored to container edges so none needs its own width math. */}
      <View style={[styles.dim, { left: 0, right: 0, top: 0, height: Math.max(0, y) }]} pointerEvents="none" />
      <View style={[styles.dim, { left: 0, right: 0, top: y + height, bottom: 0 }]} pointerEvents="none" />
      <View style={[styles.dim, { left: 0, width: Math.max(0, x), top: y, height }]} pointerEvents="none" />
      <View style={[styles.dim, { left: x + width, right: 0, top: y, height }]} pointerEvents="none" />

      {/* Interior: drags the whole rect. */}
      <View style={{ position: 'absolute', left: x, top: y, width, height }} {...responders.move.panHandlers}>
        <View style={styles.grid} pointerEvents="none">
          <View style={[styles.gridLineV, { left: '33.333%' }]} />
          <View style={[styles.gridLineV, { left: '66.666%' }]} />
          <View style={[styles.gridLineH, { top: '33.333%' }]} />
          <View style={[styles.gridLineH, { top: '66.666%' }]} />
        </View>
      </View>

      {/* Edges */}
      <View style={{ position: 'absolute', left: x + HANDLE_HIT, top: y - HANDLE_HIT / 2, width: Math.max(0, width - HANDLE_HIT * 2), height: HANDLE_HIT }} {...responders.top.panHandlers} />
      <View style={{ position: 'absolute', left: x + HANDLE_HIT, top: y + height - HANDLE_HIT / 2, width: Math.max(0, width - HANDLE_HIT * 2), height: HANDLE_HIT }} {...responders.bottom.panHandlers} />
      <View style={{ position: 'absolute', left: x - HANDLE_HIT / 2, top: y + HANDLE_HIT, width: HANDLE_HIT, height: Math.max(0, height - HANDLE_HIT * 2) }} {...responders.left.panHandlers} />
      <View style={{ position: 'absolute', left: x + width - HANDLE_HIT / 2, top: y + HANDLE_HIT, width: HANDLE_HIT, height: Math.max(0, height - HANDLE_HIT * 2) }} {...responders.right.panHandlers} />

      {/* Corners — the touch target is larger than the drawn bracket. */}
      <Corner style={{ left: x - HANDLE_HIT / 2, top: y - HANDLE_HIT / 2 }} responder={responders.tl} bracket={styles.bracketTL} />
      <Corner style={{ left: x + width - HANDLE_HIT / 2, top: y - HANDLE_HIT / 2 }} responder={responders.tr} bracket={styles.bracketTR} />
      <Corner style={{ left: x - HANDLE_HIT / 2, top: y + height - HANDLE_HIT / 2 }} responder={responders.bl} bracket={styles.bracketBL} />
      <Corner style={{ left: x + width - HANDLE_HIT / 2, top: y + height - HANDLE_HIT / 2 }} responder={responders.br} bracket={styles.bracketBR} />

      {/* Thin frame, drawn last so it sits over the dimming. */}
      <View style={[styles.frame, { left: x, top: y, width, height }]} pointerEvents="none" />
    </View>
  );
}

function Corner({ style, responder, bracket }) {
  return (
    <View style={[styles.corner, style]} {...responder.panHandlers}>
      <View style={[styles.bracket, bracket]} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.55)' },
  frame: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)' },

  grid: { ...StyleSheet.absoluteFillObject },
  gridLineV: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.35)' },
  gridLineH: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.35)' },

  corner: { position: 'absolute', width: HANDLE_HIT, height: HANDLE_HIT, alignItems: 'center', justifyContent: 'center' },
  bracket: { position: 'absolute', width: BRACKET, height: BRACKET, borderColor: '#FFFFFF' },
  bracketTL: { left: HANDLE_HIT / 2 - BRACKET_W, top: HANDLE_HIT / 2 - BRACKET_W, borderLeftWidth: BRACKET_W, borderTopWidth: BRACKET_W },
  bracketTR: { right: HANDLE_HIT / 2 - BRACKET_W, top: HANDLE_HIT / 2 - BRACKET_W, borderRightWidth: BRACKET_W, borderTopWidth: BRACKET_W },
  bracketBL: { left: HANDLE_HIT / 2 - BRACKET_W, bottom: HANDLE_HIT / 2 - BRACKET_W, borderLeftWidth: BRACKET_W, borderBottomWidth: BRACKET_W },
  bracketBR: { right: HANDLE_HIT / 2 - BRACKET_W, bottom: HANDLE_HIT / 2 - BRACKET_W, borderRightWidth: BRACKET_W, borderBottomWidth: BRACKET_W },
});
