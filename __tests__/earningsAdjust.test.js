import { adjustEarnings, periodWindow, barIndexFor, toLocalDate } from '../src/lib/earningsAdjust';
import { partitionHidden } from '../src/lib/hiddenLoads';

// Wednesday 2026-07-15, 10:00 local — a fixed "now" so week/month windows and
// bar indexes are deterministic. That week runs Mon Jul 13 → Sun Jul 19.
const NOW = new Date(2026, 6, 15, 10, 0, 0);

const period = (over = {}) => ({
  net: 3000, gross: 4000, miles: 2000, loads: 4, rpm: 2,
  fuelGal: 300, fuelCost: 800, deductions: 200, prevNet: 2000, goal: 5000,
  bars: [
    { d: 'Mon', v: 500 }, { d: 'Tue', v: 400 }, { d: 'Wed', v: 900 },
    { d: 'Thu', v: 600 }, { d: 'Fri', v: 600 }, { d: 'Sat', v: 0 }, { d: 'Sun', v: 0 },
  ],
  ...over,
});

// A load delivered on `day` of July 2026.
const hidden = (day, over = {}) => ({
  id: `L${day}`, rate: 1000, miles: 500, status: 'Delivered',
  completedAt: `2026-07-${String(day).padStart(2, '0')}`, ...over,
});

const opts = { range: 'week', now: NOW };

describe('adjustEarnings', () => {
  test('returns the very same object when nothing is hidden', () => {
    const p = period();
    expect(adjustEarnings(p, [], opts)).toBe(p);
    expect(adjustEarnings(p, null, opts)).toBe(p);
  });

  test('returns the same object when the hidden load is outside the window', () => {
    const p = period();
    expect(adjustEarnings(p, [hidden(1)], opts)).toBe(p);  // Jul 1 — last month
  });

  test('takes the load out of gross exactly and the rest proportionally', () => {
    const out = adjustEarnings(period(), [hidden(15)], opts); // 1000 of 4000 = 25%
    expect(out.gross).toBe(3000);
    expect(out.net).toBe(2250);
    expect(out.fuelCost).toBe(600);
    expect(out.deductions).toBe(150);
    expect(out.fuelGal).toBe(225);
  });

  test('miles and the load count come off exactly, not proportionally', () => {
    const out = adjustEarnings(period(), [hidden(15)], opts);
    expect(out.miles).toBe(1500);
    expect(out.loads).toBe(3);
    expect(out.rpm).toBe(2);          // 3000 gross / 1500 mi
    expect(out.excluded).toBe(1);
  });

  // Two mileage figures travel together now: the dispatcher's quote and the
  // GPS-measured distance. Hiding a load has to remove it from both.
  test('actual miles come off alongside planned miles', () => {
    const p = period({ actualMiles: 2200 });
    const out = adjustEarnings(p, [hidden(15, { actualMiles: 530 })], opts);
    expect(out.miles).toBe(1500);
    expect(out.actualMiles).toBe(1670);
  });

  test('a load with no GPS trail leaves the actual total alone', () => {
    const p = period({ actualMiles: 2200 });
    const out = adjustEarnings(p, [hidden(15)], opts);   // no actualMiles on the load
    expect(out.actualMiles).toBe(2200);
    expect(out.miles).toBe(1500);
  });

  test('the day bar loses the load net, and only that day', () => {
    const out = adjustEarnings(period(), [hidden(15)], opts); // Wed, net/gross = 0.75
    expect(out.bars[2]).toEqual({ d: 'Wed', v: 150 });        // 900 − 1000 × 0.75
    expect(out.bars[0]).toEqual({ d: 'Mon', v: 500 });
  });

  test('a bar never goes negative', () => {
    const out = adjustEarnings(period(), [hidden(13, { rate: 4000 })], opts); // Mon
    expect(out.bars[0].v).toBe(0);
  });

  test('several hidden loads accumulate', () => {
    const out = adjustEarnings(period(), [hidden(15), hidden(16)], opts);
    expect(out.gross).toBe(2000);
    expect(out.net).toBe(1500);
    expect(out.loads).toBe(2);
    expect(out.excluded).toBe(2);
  });

  // A load can out-value its own period: the backend buckets a settlement by
  // when it was PAID, so a big load delivered this week may have been settled
  // in a week the period never counted.
  test('a removal larger than the period clamps at zero instead of going negative', () => {
    const out = adjustEarnings(period(), [hidden(15, { rate: 9999, miles: 9999 })], opts);
    expect(out.net).toBe(0);
    expect(out.gross).toBe(0);
    expect(out.miles).toBe(0);
    expect(out.rpm).toBe(0);
    expect(out.loads).toBe(3);   // still only ONE load was removed
  });

  test('hiding every load in the period empties it', () => {
    const all = [hidden(13), hidden(15), hidden(16), hidden(17)];
    const out = adjustEarnings(period(), all, opts);
    expect(out.net).toBe(0);
    expect(out.gross).toBe(0);
    expect(out.loads).toBe(0);
    expect(out.bars.every((b) => b.v === 0)).toBe(true);
  });

  // A day can only give back what it holds. Without reconciling, the columns
  // would still add up to more than the figure printed above them.
  test('the chart never totals more than the adjusted take-home', () => {
    const out = adjustEarnings(period(), [hidden(13, { rate: 2000 })], opts); // Mon holds 500
    const barTotal = out.bars.reduce((a, b) => a + b.v, 0);
    expect(barTotal).toBeCloseTo(out.net, 2);
  });

  test('a cancelled load moves no money — it never earned any', () => {
    const p = period();
    expect(adjustEarnings(p, [hidden(15, { status: 'Cancelled' })], opts)).toBe(p);
  });

  test('a load hidden from the previous week only moves the comparison figure', () => {
    const out = adjustEarnings(period(), [hidden(8)], opts); // Wed of the prior week
    expect(out.net).toBe(3000);                              // this week untouched
    expect(out.prevNet).toBe(1250);                          // 2000 − 1000 × 0.75
    expect(out.excluded).toBe(0);
  });

  test('month range buckets by 7-day block and uses the calendar month', () => {
    // Bars sum to net, the way both the backend's aggregation and the mock
    // fixtures do — the reconciliation below depends on that holding.
    const monthly = period({
      bars: [{ d: 'W1', v: 1000 }, { d: 'W2', v: 1000 }, { d: 'W3', v: 700 }, { d: 'W4', v: 300 }, { d: 'W5', v: 0 }],
    });
    const out = adjustEarnings(monthly, [hidden(9)], { range: 'month', now: NOW }); // Jul 9 → W2
    expect(out.bars[1].v).toBe(250);   // 1000 − 1000 × 0.75
    expect(out.bars[0].v).toBe(1000);
    expect(out.excluded).toBe(1);
  });

  test('survives a period with no earnings without dividing by zero', () => {
    const empty = period({ net: 0, gross: 0, miles: 0, loads: 0, prevNet: 0, bars: [{ d: 'Mon', v: 0 }] });
    const out = adjustEarnings(empty, [hidden(15)], opts);
    expect(Number.isFinite(out.net)).toBe(true);
    expect(out.net).toBe(0);
    expect(out.rpm).toBe(0);
  });

  test('a full ISO timestamp buckets the same as a plain date', () => {
    const iso = adjustEarnings(period(), [hidden(15, { completedAt: '2026-07-15T14:30:00' })], opts);
    expect(iso.bars[2].v).toBe(150);
  });
});

describe('window and bucketing helpers', () => {
  test('the week is Monday-anchored, matching the backend', () => {
    const { start, end, prevStart } = periodWindow('week', NOW);
    expect(start.getDate()).toBe(13);      // Mon Jul 13
    expect(end.getDate()).toBe(20);        // Mon Jul 20, exclusive
    expect(prevStart.getDate()).toBe(6);
  });

  test('a Sunday belongs to the week that started six days earlier', () => {
    const { start } = periodWindow('week', new Date(2026, 6, 19)); // Sun Jul 19
    expect(start.getDate()).toBe(13);
  });

  test('the month window is the calendar month', () => {
    const { start, end, prevStart } = periodWindow('month', NOW);
    expect([start.getMonth(), start.getDate()]).toEqual([6, 1]);
    expect([end.getMonth(), end.getDate()]).toEqual([7, 1]);
    expect([prevStart.getMonth(), prevStart.getDate()]).toEqual([5, 1]);
  });

  test('a date outside the bar range reports no bucket', () => {
    const { start } = periodWindow('week', NOW);
    expect(barIndexFor('week', new Date(2026, 6, 25), start, 7)).toBe(-1);
  });

  test('a plain YYYY-MM-DD parses as a local date, not UTC midnight', () => {
    const d = toLocalDate('2026-07-15');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 6, 15]);
  });

  test('an unparseable date is null rather than an Invalid Date', () => {
    expect(toLocalDate('not a date')).toBeNull();
    expect(toLocalDate(null)).toBeNull();
  });
});

describe('partitionHidden feeds the adjustment', () => {
  const history = [hidden(15), hidden(16), hidden(17)];

  test('splits history into what is shown and what was removed', () => {
    const { visible, hidden: gone } = partitionHidden(history, new Set(['L16']));
    expect(visible.map((l) => l.id)).toEqual(['L15', 'L17']);
    expect(gone.map((l) => l.id)).toEqual(['L16']);
  });

  test('the hidden side carries live rows, so the stats use real numbers', () => {
    const { hidden: gone } = partitionHidden(history, new Set(['L15']));
    const out = adjustEarnings(period(), gone, opts);
    expect(out.gross).toBe(3000);
  });

  test('nothing hidden means the visible list is the original reference', () => {
    expect(partitionHidden(history, new Set()).visible).toBe(history);
  });
});
