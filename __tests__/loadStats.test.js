import { computeLoadStats, synthActuals, freezeRecord, METERS_PER_MILE } from '../src/lib/loadStats';

describe('synthActuals', () => {
  test('matches the reference load (720 planned → 62 deadhead + 731 loaded)', () => {
    expect(synthActuals(720)).toEqual({ deadheadMiles: 62, loadedMiles: 731 });
  });
  test('zero / missing planned yields zero buckets', () => {
    expect(synthActuals(0)).toEqual({ deadheadMiles: 0, loadedMiles: 0 });
    expect(synthActuals(undefined)).toEqual({ deadheadMiles: 0, loadedMiles: 0 });
  });
});

describe('freezeRecord', () => {
  test('sums driven, rounds miles, and precomputes both rpm figures', () => {
    const r = freezeRecord({ loadId: 42, plannedMiles: 720, rate: 1820, deadheadMiles: 62, loadedMiles: 731 });
    expect(r.loadId).toBe('42');
    expect(r.deadheadMiles).toBe(62);
    expect(r.loadedMiles).toBe(731);
    expect(r.drivenMiles).toBe(793);
    expect(r.bookedRpm).toBeCloseTo(2.528, 3);   // 1820 / 720
    expect(r.effectiveRpm).toBeCloseTo(2.295, 3); // 1820 / 793
  });
  test('never emits a negative mile or a divide-by-zero rpm', () => {
    const r = freezeRecord({ loadId: 'x', plannedMiles: 0, rate: null, deadheadMiles: -5, loadedMiles: 0 });
    expect(r.deadheadMiles).toBe(0);
    expect(r.drivenMiles).toBe(0);
    expect(r.bookedRpm).toBeNull();
    expect(r.effectiveRpm).toBeNull();
  });
});

describe('computeLoadStats', () => {
  test('prefers a frozen record over the load', () => {
    const load = { miles: 720, rate: 1820, rpm: 2.53 };
    const record = { plannedMiles: 720, rate: 1820, deadheadMiles: 62, loadedMiles: 731, drivenMiles: 793 };
    const s = computeLoadStats(load, record);
    expect(s.hasActual).toBe(true);
    expect(s.driven).toBe(793);
    expect(s.loadedDelta).toBe(11);        // 731 − 720
    expect(s.effectiveRpm).toBeCloseTo(2.295, 3);
    expect(s.rpmDelta).toBeLessThan(0);    // effective below booked (deadhead)
  });

  test('falls back to inline actual fields on the load (mock history / backend)', () => {
    const load = { miles: 925, rate: 2080, rpm: 2.25, deadheadMiles: 74, loadedMiles: 938, drivenMiles: 1012 };
    const s = computeLoadStats(load, null);
    expect(s.hasActual).toBe(true);
    expect(s.driven).toBe(1012);
    expect(s.deadhead).toBe(74);
  });

  test('derives driven when only loaded + deadhead are present', () => {
    const s = computeLoadStats({ miles: 600, rate: 1500, loadedMiles: 611, deadheadMiles: 88 }, null);
    expect(s.driven).toBe(699);
  });

  test('degrades to planned-only (no zeros) for a live load with no trail', () => {
    const s = computeLoadStats({ miles: 720, rate: 1820, rpm: 2.53 }, null);
    expect(s.hasActual).toBe(false);
    expect(s.planned).toBe(720);
    expect(s.driven).toBeNull();
    expect(s.effectiveRpm).toBeNull();
    expect(s.bookedRpm).toBeCloseTo(2.528, 3); // computed from rate ÷ planned
  });

  test('uses the load rpm when rate/planned are missing', () => {
    const s = computeLoadStats({ rpm: 3.1 }, null);
    expect(s.bookedRpm).toBe(3.1);
    expect(s.planned).toBeNull();
  });
});

test('METERS_PER_MILE is the standard conversion', () => {
  expect(METERS_PER_MILE).toBeCloseTo(1609.344, 3);
});
