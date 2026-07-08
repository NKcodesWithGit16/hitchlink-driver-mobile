import {
  haversineMeters,
  deriveSpeedKph,
  isAcceptableFix,
  MAX_ACCURACY_M,
  MAX_PLAUSIBLE_KPH,
} from '../src/lib/geo';

// Helper to build an expo-location-shaped fix.
const fix = (lat, lng, { t = 0, speed = null, accuracy = 10 } = {}) => ({
  timestamp: t,
  coords: { latitude: lat, longitude: lng, speed, accuracy },
});

describe('haversineMeters', () => {
  test('~111.2 km per degree of latitude', () => {
    const d = haversineMeters(0, 0, 1, 0);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
  test('zero distance for identical points', () => {
    expect(haversineMeters(40.7, -74, 40.7, -74)).toBeCloseTo(0, 5);
  });
});

describe('deriveSpeedKph', () => {
  test('uses the provider speed when it is a real value (m/s → km/h)', () => {
    expect(deriveSpeedKph(null, fix(40, -74, { speed: 20 }))).toBeCloseTo(72, 5);
  });
  test('falls back to distance/time when provider speed is null', () => {
    // ~111.2 m north in 10 s ≈ 40 km/h.
    const prev = fix(40.0, -74, { t: 0 });
    const cur = fix(40.001, -74, { t: 10_000, speed: null });
    const kph = deriveSpeedKph(prev, cur);
    expect(kph).toBeGreaterThan(38);
    expect(kph).toBeLessThan(42);
  });
  test('falls back when provider reports the -1 "unknown" sentinel', () => {
    const prev = fix(40.0, -74, { t: 0 });
    const cur = fix(40.001, -74, { t: 10_000, speed: -1 });
    expect(deriveSpeedKph(prev, cur)).toBeGreaterThan(0);
  });
  test('0 when there is no prior fix and no provider speed', () => {
    expect(deriveSpeedKph(null, fix(40, -74, { speed: null }))).toBe(0);
  });
  test('0 when the clock did not advance', () => {
    const prev = fix(40.0, -74, { t: 5_000 });
    const cur = fix(40.001, -74, { t: 5_000, speed: null });
    expect(deriveSpeedKph(prev, cur)).toBe(0);
  });
});

describe('isAcceptableFix', () => {
  test('accepts the first fix so sharing can cold-start (even if coarse)', () => {
    expect(isAcceptableFix(null, fix(40, -74, { accuracy: 500 }))).toBe(true);
  });
  test('rejects a coarse/cached fix once we have a prior good one', () => {
    const prev = fix(40, -74, { t: 0, accuracy: 8 });
    const coarse = fix(40.0001, -74, { t: 5_000, accuracy: MAX_ACCURACY_M + 50 });
    expect(isAcceptableFix(prev, coarse)).toBe(false);
  });
  test('rejects a short-window teleport (implausible implied speed)', () => {
    // ~1.1 km jump in 5 s ≈ 800 km/h → cached last-known "snap back" fix.
    const prev = fix(40, -74, { t: 0 });
    const jump = fix(40.01, -74, { t: 5_000, accuracy: 10 });
    expect(isAcceptableFix(prev, jump)).toBe(false);
  });
  test('accepts a normal highway fix (~100 km/h)', () => {
    // ~278 m in 10 s ≈ 100 km/h.
    const prev = fix(40, -74, { t: 0 });
    const cur = fix(40.0025, -74, { t: 10_000, accuracy: 12 });
    expect(isAcceptableFix(prev, cur)).toBe(true);
  });
  test('allows a large jump after a long gap (elapsed beyond the teleport window)', () => {
    // Same 1.1 km jump but 5 min apart — legitimately traveled.
    const prev = fix(40, -74, { t: 0 });
    const later = fix(40.01, -74, { t: 300_000, accuracy: 12 });
    expect(isAcceptableFix(prev, later)).toBe(true);
  });
  test('rejects a fix with no usable coordinates', () => {
    expect(isAcceptableFix(fix(40, -74), { timestamp: 1, coords: { latitude: NaN, longitude: NaN } })).toBe(false);
  });
});

// Guard against accidental drift of the tuned constants.
test('tunable defaults stay conservative', () => {
  expect(MAX_ACCURACY_M).toBe(100);
  expect(MAX_PLAUSIBLE_KPH).toBe(200);
});
