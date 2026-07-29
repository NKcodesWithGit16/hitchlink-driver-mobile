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

/** Clamps a pan offset so a zoomed image can't be dragged off screen. */
export function clampPan(translate, scale, width, height) {
  const maxX = Math.max(0, (width * scale - width) / 2);
  const maxY = Math.max(0, (height * scale - height) / 2);
  return {
    translateX: Math.min(maxX, Math.max(-maxX, translate.translateX)),
    translateY: Math.min(maxY, Math.max(-maxY, translate.translateY)),
  };
}
