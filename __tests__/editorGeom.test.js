import {
  fitRect, screenToBase, baseToScreen, clampCropRect, cropRectToPixels, clampPan,
} from '../src/lib/editorGeom';

describe('fitRect', () => {
  test('a wide photo letterboxes top and bottom', () => {
    // 2:1 into a square box → full width, half height, centred vertically.
    expect(fitRect(2000, 1000, 400, 400)).toEqual({ x: 0, y: 100, width: 400, height: 200 });
  });
  test('a tall photo letterboxes left and right', () => {
    expect(fitRect(1000, 2000, 400, 400)).toEqual({ x: 100, y: 0, width: 200, height: 400 });
  });
  test('a matching aspect fills the box exactly', () => {
    expect(fitRect(800, 800, 400, 400)).toEqual({ x: 0, y: 0, width: 400, height: 400 });
  });
  test('degenerate input returns the box rather than NaN', () => {
    expect(fitRect(0, 0, 300, 200)).toEqual({ x: 0, y: 0, width: 300, height: 200 });
  });
});

describe('screenToBase / baseToScreen', () => {
  const view = { width: 400, height: 800 };

  test('identity when unzoomed and unpanned', () => {
    const p = { x: 120, y: 260 };
    expect(screenToBase(p, { ...view, scale: 1, translateX: 0, translateY: 0 })).toEqual(p);
  });

  test('the centre is the fixed point of a pure zoom', () => {
    const centre = { x: 200, y: 400 };
    expect(screenToBase(centre, { ...view, scale: 3 })).toEqual(centre);
  });

  // The property that matters: a stroke drawn while zoomed must map to the same
  // base point at every zoom level, or it moves when the driver zooms out.
  test.each([
    [1, 0, 0],
    [2, 0, 0],
    [2.5, -40, 90],
    [4, 130, -75],
  ])('round-trips at scale %p, offset (%p, %p)', (scale, translateX, translateY) => {
    const v = { ...view, scale, translateX, translateY };
    const base = { x: 137, y: 512 };
    const screen = baseToScreen(base, v);
    const back = screenToBase(screen, v);
    expect(back.x).toBeCloseTo(base.x, 6);
    expect(back.y).toBeCloseTo(base.y, 6);
  });

  test('a missing scale is treated as 1 rather than dividing by zero', () => {
    expect(screenToBase({ x: 10, y: 20 }, { ...view, scale: 0 })).toEqual({ x: 10, y: 20 });
  });
});

describe('clampCropRect', () => {
  const bounds = { x: 20, y: 50, width: 300, height: 400 };

  test('leaves a rect that is already inside alone', () => {
    const r = { x: 40, y: 80, width: 100, height: 120 };
    expect(clampCropRect(r, bounds)).toEqual(r);
  });
  test('pulls a rect back inside the image', () => {
    expect(clampCropRect({ x: -100, y: -100, width: 100, height: 100 }, bounds))
      .toEqual({ x: 20, y: 50, width: 100, height: 100 });
  });
  test('stops a rect running off the far edge', () => {
    const out = clampCropRect({ x: 900, y: 900, width: 100, height: 100 }, bounds);
    expect(out.x + out.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    expect(out.y + out.height).toBeLessThanOrEqual(bounds.y + bounds.height);
  });
  // Dragging a handle past the opposite edge is the case that reaches the native
  // cropper as a negative width and fails with an unhelpful error.
  test('never returns a collapsed or inverted rect', () => {
    const out = clampCropRect({ x: 100, y: 100, width: -80, height: -50 }, bounds, 48);
    expect(out.width).toBe(48);
    expect(out.height).toBe(48);
  });
  test('a rect larger than the image is capped to it', () => {
    expect(clampCropRect({ x: 0, y: 0, width: 9999, height: 9999 }, bounds)).toEqual(bounds);
  });
});

describe('cropRectToPixels', () => {
  test('scales canvas units up to export pixels', () => {
    // Canvas 400 wide rasterized at 1600 → 4x.
    expect(cropRectToPixels({ x: 10, y: 20, width: 100, height: 50 }, 400, 1600, 1200))
      .toEqual({ originX: 40, originY: 80, width: 400, height: 200 });
  });
  test('is identity at 1:1', () => {
    expect(cropRectToPixels({ x: 5, y: 5, width: 50, height: 60 }, 400, 400, 800))
      .toEqual({ originX: 5, originY: 5, width: 50, height: 60 });
  });
  test('clamps to the exported bounds', () => {
    const out = cropRectToPixels({ x: 380, y: 780, width: 100, height: 100 }, 400, 400, 800);
    expect(out.originX + out.width).toBeLessThanOrEqual(400);
    expect(out.originY + out.height).toBeLessThanOrEqual(800);
  });
  test('never produces a zero-size crop', () => {
    const out = cropRectToPixels({ x: 0, y: 0, width: 0, height: 0 }, 400, 400, 800);
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
  });
});

describe('clampPan', () => {
  test('an unzoomed image cannot be panned at all', () => {
    expect(clampPan({ translateX: 200, translateY: 200 }, 1, 400, 800))
      .toEqual({ translateX: 0, translateY: 0 });
  });
  test('pan is capped at how far the zoomed image overflows, in both directions', () => {
    // scale 2 doubles a 400x800 view, so it overflows by 400x800 — 200 and 400
    // available in each direction. A negative drag clamps to the negative bound.
    expect(clampPan({ translateX: 999, translateY: -999 }, 2, 400, 800))
      .toEqual({ translateX: 200, translateY: -400 });
    expect(clampPan({ translateX: -999, translateY: 999 }, 2, 400, 800))
      .toEqual({ translateX: -200, translateY: 400 });
  });
  test('an offset within range is untouched', () => {
    expect(clampPan({ translateX: 30, translateY: -40 }, 2, 400, 800))
      .toEqual({ translateX: 30, translateY: -40 });
  });
});
