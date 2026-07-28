/* Keeps the Pay tab's figures honest with the history the driver can see.
 *
 * When a driver removes a load from their history (src/lib/hiddenLoads.js), the
 * stats above the list have to move with it — otherwise the screen shows four
 * loads' worth of pay over three visible loads.
 *
 * WHY THIS IS AN ADJUSTMENT AND NOT A RECOMPUTE. `GET /drivers/{id}/earnings`
 * aggregates SETTLEMENTS, not loads: net/gross/fuel/deductions come from
 * settlement rows, bucketed by when they were *paid* (`PaidAt ?? PeriodEnd ??
 * CreatedAt`). The driver app never sees settlement rows — history gives it a
 * load's `rate`, `miles` and `completedAt` and nothing else. So there is no way
 * to rebuild the period from scratch on the client; instead we take the load's
 * share of the period's gross out of every figure proportionally, which is
 * exact for `gross` (the share IS its rate) and a good estimate for the rest.
 *
 * The known approximations, all deliberate:
 *   · A load is bucketed by delivery date; the backend buckets its settlement
 *     by payment date. A load delivered Sunday and paid Monday lands in a
 *     different week for us than for the server.
 *   · Net/fuel/deductions shrink by the load's gross share rather than by its
 *     own settlement lines, so a load with unusual deductions is approximated.
 *   · Windows are computed in device-local time; the backend uses UTC.
 *   · Cancelled loads are skipped entirely — they never produced a settlement,
 *     so hiding one must not move any money.
 *
 * That is why the screen labels an adjusted period ("Excludes N removed load"):
 * the driver should never mistake this for their settlement statement.
 */

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (list, pick) => list.reduce((a, x) => a + (Number(pick(x)) || 0), 0);

/* 'YYYY-MM-DD' must parse as a LOCAL date — `new Date('2026-06-03')` is UTC
   midnight, which is the previous day west of Greenwich and would drop the
   load into the wrong bar (or the wrong week entirely). */
export function toLocalDate(x) {
  if (!x) return null;
  if (typeof x === 'string') {
    const m = x.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  const d = new Date(x);
  return isNaN(d.getTime()) ? null : d;
}

/* The period the Pay tab is showing, mirroring the backend's bucketing:
   Monday-anchored weeks, calendar months. `prev` is the comparison window
   behind the delta badge. */
export function periodWindow(range, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === 'month') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return {
      start,
      end: new Date(today.getFullYear(), today.getMonth() + 1, 1),
      prevStart: new Date(today.getFullYear(), today.getMonth() - 1, 1),
      prevEnd: start,
    };
  }
  const sinceMonday = (today.getDay() + 6) % 7;   // JS weeks start Sunday
  const start = new Date(today); start.setDate(today.getDate() - sinceMonday);
  const end = new Date(start);   end.setDate(start.getDate() + 7);
  const prevStart = new Date(start); prevStart.setDate(start.getDate() - 7);
  return { start, end, prevStart, prevEnd: start };
}

/* Which bar a date belongs to: one per weekday (Mon..Sun), or one per 7-day
   block of the month (W1..Wn) — the same split the backend builds. */
export function barIndexFor(range, date, start, barCount) {
  if (!date) return -1;
  const i = range === 'month'
    ? Math.floor((date.getDate() - 1) / 7)
    : Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()) - start) / 86400000);
  return i >= 0 && i < barCount ? i : -1;
}

const within = (d, a, b) => !!d && d >= a && d < b;

/* Take the hidden loads' share out of one period's figures.
 *
 * Returns the SAME object when nothing applies, so the caller's useMemo and
 * every child below it can skip re-rendering on an untouched period. An
 * adjusted period carries `excluded` — how many loads were taken out — which
 * the screen uses to caption the numbers.
 */
export function adjustEarnings(period, hidden, { range = 'week', now = new Date() } = {}) {
  if (!period || !hidden || hidden.length === 0) return period;

  const { start, end, prevStart, prevEnd } = periodWindow(range, now);
  // A cancelled load never earned anything, so hiding one moves no money.
  const earning = hidden
    .filter((l) => l && l.status !== 'Cancelled')
    .map((l) => ({ ...l, at: toLocalDate(l.completedAt) }));

  const out     = earning.filter((l) => within(l.at, start, end));
  const outPrev = earning.filter((l) => within(l.at, prevStart, prevEnd));
  if (out.length === 0 && outPrev.length === 0) return period;

  const gross = Number(period.gross) || 0;
  const net   = Number(period.net) || 0;
  const outGross = sum(out, (l) => l.rate);
  // `keep` is what survives. Applying it to gross is exact — keep = 1 - rate/gross
  // — and the same factor carries the rest of the figures with it.
  const share = gross > 0 ? Math.min(1, outGross / gross) : (out.length ? 1 : 0);
  const keep  = 1 - share;
  // Take-home per dollar billed, used to express a removed load's rate as the
  // net it contributed (for the bars and the previous-period comparison).
  const netPerGross = gross > 0 ? net / gross : 0;

  const adjNet   = round2(net * keep);
  const adjGross = round2(gross * keep);

  // Bars come off the day the load was delivered, so the chart keeps its
  // attribution instead of shrinking every column uniformly.
  const barList = period.bars || [];
  let bars = barList.map((b, i) => {
    const cut = sum(
      out.filter((l) => barIndexFor(range, l.at, start, barList.length) === i),
      (l) => (Number(l.rate) || 0) * netPerGross,
    );
    return cut > 0 ? { ...b, v: Math.max(0, round2((Number(b.v) || 0) - cut)) } : b;
  });
  // A day can't give back more than it holds, so a cut bigger than its bar
  // leaves a remainder — and the chart would then total more than the hero
  // figure above it. Reconcile by scaling what's left down to the adjusted
  // net. In the ordinary case the two already agree and this is a no-op.
  const barTotal = sum(bars, (b) => b.v);
  if (barTotal > adjNet + 0.01) {
    const f = barTotal > 0 ? adjNet / barTotal : 0;
    bars = bars.map((b) => (b.v > 0 ? { ...b, v: round2(b.v * f) } : b));
  }

  // Both mileage figures come off exactly: planned (what the loads were quoted
  // at) and actual (what the GPS measured). A hidden load has to leave both.
  const miles = Math.max(0, round2((Number(period.miles) || 0) - sum(out, (l) => l.miles)));
  const actualMiles = Math.max(0, round2(
    (Number(period.actualMiles) || 0) - sum(out, (l) => l.actualMiles ?? l.drivenMiles),
  ));

  return {
    ...period,
    net:        adjNet,
    gross:      adjGross,
    fuelCost:   round2((Number(period.fuelCost) || 0) * keep),
    deductions: round2((Number(period.deductions) || 0) * keep),
    fuelGal:    round2((Number(period.fuelGal) || 0) * keep),
    miles,
    actualMiles,
    loads:      Math.max(0, (Number(period.loads) || 0) - out.length),
    rpm:        miles > 0 ? round2(adjGross / miles) : 0,
    // A load removed from the PREVIOUS window only moves the comparison figure.
    prevNet:    Math.max(0, round2((Number(period.prevNet) || 0) - sum(outPrev, (l) => l.rate) * netPerGross)),
    bars,
    excluded:   out.length,
  };
}
