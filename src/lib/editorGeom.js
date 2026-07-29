// Coordinate math for the photo editor (src/components/driver/PhotoEditor.js).
//
// Kept here, pure and tested, because every one of these is the kind of thing
// that looks right in review and is obviously wrong on a device: a stroke that
// lands an inch from the finger, a crop handle that turns the rect inside out,
// an export that comes back offset. Nothing in this file touches React.

/**
 * Where a `preserveAspectRatio="xMidYMid meet"` image actually sits inside its
 * container — the letterboxed rect. The editor needs it to keep crop handles on
 * the photo rather than on the black bars beside it.
 */
export function fitRect(imageW, imageH, boxW, boxH) {
  if (!(imageW > 0 && imageH > 0 && boxW > 0 && boxH > 0)) {
    return { x: 0, y: 0, width: boxW || 0, height: boxH || 0 };
  }
  const scale = Math.min(boxW / imageW, boxH / imageH);
  const width = imageW * scale;
  const height = imageH * scale;
  return { x: (boxW - width) / 2, y: (boxH - height) / 2, width, height };
}

/**
 * Screen point → base (viewBox) point, undoing a centre-origin zoom.
 *
 * RN applies `transform` about the view's centre, so this is the inverse of
 * `screen = centre + (base − centre) · scale + translate`. Shapes are stored in
 * base coordinates so they stay put when the zoom changes.
 */
export function screenToBase(point, view) {
  const { scale = 1, translateX = 0, translateY = 0, width, height } = view;
  const cx = width / 2;
  const cy = height / 2;
  const s = scale || 1;
  return {
    x: cx + (point.x - cx - translateX) / s,
    y: cy + (point.y - cy - translateY) / s,
  };
}

/** Inverse of screenToBase; kept alongside it so the pair can be round-tripped. */
export function baseToScreen(point, view) {
  const { scale = 1, translateX = 0, translateY = 0, width, height } = view;
  const cx = width / 2;
  const cy = height / 2;
  return {
    x: cx + (point.x - cx) * scale + translateX,
    y: cy + (point.y - cy) * scale + translateY,
  };
}

/**
 * Keeps a crop rect the right way up, at least `minSize` on each edge, and
 * inside `bounds`. Dragging a handle past the opposite edge would otherwise
 * produce a negative width, which the native cropper rejects with an opaque
 * error rather than a useful one.
 */
export function clampCropRect(rect, bounds, minSize = 48) {
  const maxW = Math.max(minSize, bounds.width);
  const maxH = Math.max(minSize, bounds.height);

  let width = Math.min(Math.max(rect.width, minSize), maxW);
  let height = Math.min(Math.max(rect.height, minSize), maxH);
  let x = Math.min(Math.max(rect.x, bounds.x), bounds.x + bounds.width - width);
  let y = Math.min(Math.max(rect.y, bounds.y), bounds.y + bounds.height - height);

  // A bounds box smaller than minSize can't satisfy both; prefer staying inside.
  if (width > bounds.width) { width = bounds.width; x = bounds.x; }
  if (height > bounds.height) { height = bounds.height; y = bounds.y; }

  return { x, y, width, height };
}

/**
 * Crop rect in canvas units → the pixel rect for ImageManipulator, given the
 * size the canvas is actually rasterized at. Canvas and export share an aspect
 * ratio, so one scale factor covers both axes.
 *
 * Rounded and clamped to the exported bounds: a rect even a pixel outside makes
 * the native crop fail.
 */
export function cropRectToPixels(rect, canvasWidth, exportWidth, exportHeight) {
  const scale = canvasWidth > 0 ? exportWidth / canvasWidth : 1;
  const originX = Math.max(0, Math.round(rect.x * scale));
  const originY = Math.max(0, Math.round(rect.y * scale));
  return {
    originX,
    originY,
    width: Math.max(1, Math.min(Math.round(rect.width * scale), exportWidth - originX)),
    height: Math.max(1, Math.min(Math.round(rect.height * scale), exportHeight - originY)),
  };
}

/**
 * Locks a crop rect to an aspect ratio (width / height), growing from the
 * corner opposite the one being dragged so that corner stays put — resizing
 * from the top-left shouldn't slide the bottom-right around.
 *
 * `ratio` of 0 or null means free, and the rect passes through untouched.
 */
export function applyAspect(rect, ratio, bounds, anchor = 'br') {
  if (!ratio) return clampCropRect(rect, bounds);

  // Take whichever edge the drag made larger as the lead, so the rect follows
  // the finger instead of fighting it.
  let width = rect.width;
  let height = width / ratio;
  if (height > rect.height * 1.0001 && rect.height > 0) {
    height = rect.height;
    width = height * ratio;
  }

  // Never exceed the image, keeping the ratio while shrinking to fit.
  if (width > bounds.width) { width = bounds.width; height = width / ratio; }
  if (height > bounds.height) { height = bounds.height; width = height * ratio; }

  // Anchor names the corner that must not move.
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  let x = rect.x;
  let y = rect.y;
  if (anchor === 'tl' || anchor === 'tr') y = bottom - height;
  if (anchor === 'tl' || anchor === 'bl') x = right - width;

  return clampCropRect({ x, y, width, height }, bounds);
}

/** Shortest distance from point `p` to the segment `a`→`b`. */
export function pointToSegmentDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  // Degenerate segment (a tap-length stroke) is just a point.
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let tt = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  tt = Math.max(0, Math.min(1, tt));
  return Math.hypot(p.x - (a.x + tt * dx), p.y - (a.y + tt * dy));
}

/** Points out of an SVG path built as "Mx,y Lx,y Lx,y …" (all this app emits). */
export function parsePathPoints(d) {
  if (!d) return [];
  const out = [];
  const re = /[ML]\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/g;
  let m = re.exec(d);
  while (m) {
    out.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
    m = re.exec(d);
  }
  return out;
}

/**
 * Is `point` close enough to `shape` to count as touching it? Used by the
 * eraser, where the tolerance is what makes it usable — a driver taps at a
 * stroke, not exactly on its centre line.
 */
export function hitTestShape(shape, point, tolerance = 18) {
  if (!shape) return false;

  if (shape.kind === 'text') {
    const size = shape.size || 20;
    // (x, y) is the text's centre, so the box is centred on it too.
    const halfW = Math.max(size, (shape.value?.length || 1) * size * 0.6) / 2;
    const halfH = size * 0.6;
    return Math.abs(point.x - shape.x) <= halfW + tolerance
      && Math.abs(point.y - shape.y) <= halfH + tolerance;
  }

  const pts = parsePathPoints(shape.d);
  if (pts.length === 0) return false;
  const reach = tolerance + (shape.width || 0) / 2;
  if (pts.length === 1) return Math.hypot(point.x - pts[0].x, point.y - pts[0].y) <= reach;
  for (let i = 1; i < pts.length; i += 1) {
    if (pointToSegmentDistance(point, pts[i - 1], pts[i]) <= reach) return true;
  }
  return false;
}

/** Clamps a pan offset so a zoomed image can't be dragged off screen. */
export function clampPan(translate, scale, width, height) {
  const maxX = Math.max(0, (width * scale - width) / 2);
  const maxY = Math.max(0, (height * scale - height) / 2);
  return {
    translateX: Math.min(maxX, Math.max(-maxX, translate.translateX)),
    translateY: Math.min(maxY, Math.max(-maxY, translate.translateY)),
  };
}
