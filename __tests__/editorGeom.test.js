import {
  fitRect, screenToBase, baseToScreen, clampCropRect, cropRectToPixels, clampPan,
  applyAspect, pointToSegmentDistance, parsePathPoints, hitTestShape,
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

describe('applyAspect', () => {
  const bounds = { x: 0, y: 0, width: 400, height: 400 };

  test('a null ratio leaves the rect free', () => {
    const r = { x: 10, y: 10, width: 123, height: 145 };
    expect(applyAspect(r, null, bounds)).toEqual(r);
  });
  test('free still enforces the minimum size', () => {
    // Free means "any shape", not "any size" — clampCropRect's floor applies.
    expect(applyAspect({ x: 10, y: 10, width: 123, height: 20 }, null, bounds).height).toBe(48);
  });

  test('square locks height to width', () => {
    const out = applyAspect({ x: 0, y: 0, width: 200, height: 120 }, 1, bounds);
    expect(out.width).toBeCloseTo(out.height, 6);
  });

  test('16:9 holds its ratio', () => {
    const out = applyAspect({ x: 0, y: 0, width: 320, height: 300 }, 16 / 9, bounds);
    expect(out.width / out.height).toBeCloseTo(16 / 9, 4);
  });

  // Resizing from the top-left must not slide the bottom-right around.
  test('the anchored corner stays put', () => {
    const r = { x: 100, y: 100, width: 200, height: 200 };
    const out = applyAspect(r, 1, bounds, 'tl');
    expect(out.x + out.width).toBeCloseTo(r.x + r.width, 6);
    expect(out.y + out.height).toBeCloseTo(r.y + r.height, 6);
  });

  test('shrinks to fit rather than overflowing the image', () => {
    const out = applyAspect({ x: 0, y: 0, width: 800, height: 100 }, 16 / 9, bounds);
    expect(out.width).toBeLessThanOrEqual(bounds.width);
    expect(out.height).toBeLessThanOrEqual(bounds.height);
    expect(out.width / out.height).toBeCloseTo(16 / 9, 4);
  });
});

describe('pointToSegmentDistance', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };

  test('perpendicular distance mid-segment', () => {
    expect(pointToSegmentDistance({ x: 50, y: 12 }, a, b)).toBeCloseTo(12, 6);
  });
  // Past the end it must measure to the endpoint, not to the infinite line —
  // otherwise the eraser fires far off the end of a stroke.
  test('clamps to the endpoints', () => {
    expect(pointToSegmentDistance({ x: 150, y: 0 }, a, b)).toBeCloseTo(50, 6);
    expect(pointToSegmentDistance({ x: -30, y: 40 }, a, b)).toBeCloseTo(50, 6);
  });
  test('a zero-length segment behaves as a point', () => {
    expect(pointToSegmentDistance({ x: 3, y: 4 }, a, a)).toBeCloseTo(5, 6);
  });
});

describe('parsePathPoints', () => {
  test('reads the M/L form the editor emits', () => {
    expect(parsePathPoints('M10.0,20.0 L30.0,40.0 L50.5,60.5')).toEqual([
      { x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50.5, y: 60.5 },
    ]);
  });
  test('handles negatives and empty input', () => {
    expect(parsePathPoints('M-5,-6')).toEqual([{ x: -5, y: -6 }]);
    expect(parsePathPoints('')).toEqual([]);
    expect(parsePathPoints(undefined)).toEqual([]);
  });
});

describe('hitTestShape', () => {
  const stroke = { kind: 'draw', width: 6, d: 'M0,0 L100,0 L100,100' };

  test('hits near the line, misses far from it', () => {
    expect(hitTestShape(stroke, { x: 50, y: 5 })).toBe(true);
    expect(hitTestShape(stroke, { x: 50, y: 200 })).toBe(false);
  });
  test('hits the second segment too, not just the first', () => {
    expect(hitTestShape(stroke, { x: 98, y: 60 })).toBe(true);
  });
  test('a thicker stroke is easier to hit', () => {
    const thin = { kind: 'draw', width: 1, d: 'M0,0 L100,0' };
    const thick = { kind: 'draw', width: 40, d: 'M0,0 L100,0' };
    const p = { x: 50, y: 36 };
    expect(hitTestShape(thin, p)).toBe(false);
    expect(hitTestShape(thick, p)).toBe(true);
  });

  // Text sits on its baseline, so its box runs upward from the origin.
  test('text hits the box above its baseline', () => {
    const text = { kind: 'text', x: 100, y: 100, size: 24, value: 'DENT' };
    expect(hitTestShape(text, { x: 110, y: 90 })).toBe(true);
    expect(hitTestShape(text, { x: 110, y: 300 })).toBe(false);
  });

  test('a missing shape is not a hit', () => {
    expect(hitTestShape(null, { x: 0, y: 0 })).toBe(false);
    expect(hitTestShape({ kind: 'draw' }, { x: 0, y: 0 })).toBe(false);
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
