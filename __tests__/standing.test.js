import { computeStanding } from '../src/lib/standing';

// Newest-first, matching GET /loads/driver/{id}/history's ordering.
const load = (status, miles = 100, rate = 250) => ({ status, miles, rate });

describe('computeStanding', () => {
  test('empty history reads as a new driver, not as zeros to brag about', () => {
    expect(computeStanding([])).toMatchObject({ delivered: 0, streak: 0, hasData: false });
  });

  test('non-array input degrades instead of throwing', () => {
    expect(computeStanding(null).hasData).toBe(false);
    expect(computeStanding(undefined).hasData).toBe(false);
  });

  test('counts Delivered and Closed as delivered, Cancelled separately', () => {
    const s = computeStanding([load('Delivered'), load('Closed'), load('Cancelled')]);
    expect(s.delivered).toBe(2);
    expect(s.cancelled).toBe(1);
    expect(s.hasData).toBe(true);
  });

  test('sums miles and rate over delivered loads only', () => {
    const s = computeStanding([
      load('Delivered', 720, 1820),
      load('Closed', 300, 900),
      load('Cancelled', 500, 1200), // must not count toward either total
    ]);
    expect(s.miles).toBe(1020);
    expect(s.earned).toBe(2720);
  });

  test('streak counts back from newest and stops at the first cancellation', () => {
    expect(computeStanding([
      load('Delivered'), load('Delivered'), load('Cancelled'), load('Delivered'),
    ]).streak).toBe(2);
  });

  test('a cancellation as the newest load zeroes the streak', () => {
    expect(computeStanding([load('Cancelled'), load('Delivered')]).streak).toBe(0);
  });

  test('streak spans the whole history when nothing was cancelled', () => {
    expect(computeStanding([load('Delivered'), load('Closed'), load('Delivered')]).streak).toBe(3);
  });

  test('missing/garbage miles and rate do not poison the totals with NaN', () => {
    const s = computeStanding([
      { status: 'Delivered' },
      { status: 'Delivered', miles: null, rate: undefined },
      { status: 'Delivered', miles: 'abc', rate: -5 },
      load('Delivered', 100, 200),
    ]);
    expect(s.miles).toBe(100);
    expect(s.earned).toBe(200);
    expect(s.delivered).toBe(4);
  });
});
