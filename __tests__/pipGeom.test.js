import { pipCorners, clampToBounds, nearestCorner } from '../src/lib/pipGeom';

// A phone-ish container with the safe areas already removed by the caller.
const BOUNDS = { x: 0, y: 60, width: 390, height: 700 };
const SIZE = { width: 100, height: 140 };
const M = 12;

describe('pipCorners', () => {
  it('insets every corner by the margin', () => {
    const c = pipCorners(BOUNDS, SIZE, M);
    expect(c.find((x) => x.name === 'topLeft')).toMatchObject({ x: 12, y: 72 });
    expect(c.find((x) => x.name === 'topRight')).toMatchObject({ x: 390 - 100 - 12, y: 72 });
    expect(c.find((x) => x.name === 'bottomLeft')).toMatchObject({ x: 12, y: 60 + 700 - 140 - 12 });
    expect(c.find((x) => x.name === 'bottomRight')).toMatchObject({ x: 278, y: 608 });
  });

  it('respects a non-zero bounds origin', () => {
    const c = pipCorners({ x: 20, y: 0, width: 200, height: 200 }, { width: 50, height: 50 }, 0);
    expect(c.find((x) => x.name === 'topLeft')).toMatchObject({ x: 20, y: 0 });
    expect(c.find((x) => x.name === 'bottomRight')).toMatchObject({ x: 170, y: 150 });
  });
});

describe('clampToBounds', () => {
  it('leaves a position that is already inside alone', () => {
    expect(clampToBounds({ x: 100, y: 300 }, BOUNDS, SIZE, M)).toEqual({ x: 100, y: 300 });
  });

  it('pulls a tile back from past the right and bottom edges', () => {
    expect(clampToBounds({ x: 9999, y: 9999 }, BOUNDS, SIZE, M)).toEqual({ x: 278, y: 608 });
  });

  it('pulls a tile back from past the left and top edges', () => {
    expect(clampToBounds({ x: -500, y: -500 }, BOUNDS, SIZE, M)).toEqual({ x: 12, y: 72 });
  });

  // A tile wider than its container makes the min and max limits cross over.
  // Pinning to the leading edge keeps it on screen; a naive clamp would return
  // a negative position outside both limits.
  it('pins to the leading edge when the tile is larger than the container', () => {
    const tiny = { x: 0, y: 0, width: 60, height: 60 };
    expect(clampToBounds({ x: 40, y: 40 }, tiny, SIZE, M)).toEqual({ x: 12, y: 12 });
  });
});

describe('nearestCorner', () => {
  it('snaps to the corner the tile visually sits nearest', () => {
    expect(nearestCorner({ x: 5, y: 70 }, BOUNDS, SIZE, M).name).toBe('topLeft');
    expect(nearestCorner({ x: 280, y: 70 }, BOUNDS, SIZE, M).name).toBe('topRight');
    expect(nearestCorner({ x: 5, y: 600 }, BOUNDS, SIZE, M).name).toBe('bottomLeft');
    expect(nearestCorner({ x: 280, y: 600 }, BOUNDS, SIZE, M).name).toBe('bottomRight');
  });

  // Measuring from the centre is the whole point — a tile just past the
  // horizontal midpoint belongs to the right-hand corners even though its
  // top-left origin is still left of centre.
  it('measures from the tile centre, not its origin', () => {
    const midX = BOUNDS.x + BOUNDS.width / 2;
    const justPastCentre = { x: midX - SIZE.width / 2 + 4, y: 100 };
    expect(nearestCorner(justPastCentre, BOUNDS, SIZE, M).name).toBe('topRight');
    const justBeforeCentre = { x: midX - SIZE.width / 2 - 4, y: 100 };
    expect(nearestCorner(justBeforeCentre, BOUNDS, SIZE, M).name).toBe('topLeft');
  });

  it('returns a position already clamped inside the bounds', () => {
    const c = nearestCorner({ x: 9999, y: 9999 }, BOUNDS, SIZE, M);
    expect(c).toMatchObject({ x: 278, y: 608 });
  });
});
