// Placement math for a draggable picture-in-picture tile — the local camera
// inside the call takeover, and the floating window a minimized video call
// collapses to.
//
// Pure on purpose, and separate from the component for the same reason
// editorGeom.js is: the snapping rule is the part that's easy to get subtly
// wrong (a tile that drifts under the notch, or off the bottom of a short
// screen), and it's far cheaper to pin down in a test than by dragging a box
// around a physical phone.
//
// Coordinates are the tile's TOP-LEFT, in the same space as the container's
// own layout — the caller applies them as a translate, never as top/left, so
// dragging stays on the native driver.

/**
 * The four resting positions, inset from the edges by `margin`. `bounds`
 * already has the safe-area insets taken out by the caller, so a tile can't
 * come to rest under the status bar or the home indicator.
 */
export function pipCorners(bounds, size, margin = 0) {
  const left = bounds.x + margin;
  const top = bounds.y + margin;
  const right = bounds.x + bounds.width - size.width - margin;
  const bottom = bounds.y + bounds.height - size.height - margin;
  return [
    { name: 'topLeft', x: left, y: top },
    { name: 'topRight', x: right, y: top },
    { name: 'bottomLeft', x: left, y: bottom },
    { name: 'bottomRight', x: right, y: bottom },
  ];
}

/** Keeps a tile fully inside `bounds`, honouring `margin`. */
export function clampToBounds(pos, bounds, size, margin = 0) {
  const minX = bounds.x + margin;
  const minY = bounds.y + margin;
  const maxX = bounds.x + bounds.width - size.width - margin;
  const maxY = bounds.y + bounds.height - size.height - margin;
  return {
    // max/min rather than a plain clamp: on a container narrower than the tile
    // the two limits cross over, and this pins to the leading edge instead of
    // producing a position outside both.
    x: Math.max(minX, Math.min(pos.x, Math.max(minX, maxX))),
    y: Math.max(minY, Math.min(pos.y, Math.max(minY, maxY))),
  };
}

/**
 * Which corner a released tile flies to. Measured from the tile's CENTRE, not
 * its top-left — dragging by a corner otherwise makes it snap to whichever
 * corner the finger happened to be nearest rather than where the tile visually
 * sits.
 */
export function nearestCorner(pos, bounds, size, margin = 0) {
  const cx = pos.x + size.width / 2;
  const cy = pos.y + size.height / 2;
  const corners = pipCorners(bounds, size, margin);
  let best = corners[0];
  let bestDist = Infinity;
  for (const c of corners) {
    const dx = c.x + size.width / 2 - cx;
    const dy = c.y + size.height / 2 - cy;
    const dist = dx * dx + dy * dy; // squared — we only ever compare these
    if (dist < bestDist) { bestDist = dist; best = c; }
  }
  return best;
}
