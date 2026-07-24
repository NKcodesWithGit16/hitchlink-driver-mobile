// Driver record, derived from the real completed-load history.
//
// This replaces a block of invented constants (a 96/100 "score", an "Elite"
// tier, a top-5% percentile, a 4.9 rating, 98% on-time and 94% acceptance)
// that were rendered with animated counters as though they were real.
//
// What GET /loads/driver/{id}/history actually returns per load is:
//   id, origin, destination, originState, destState, miles, rate, rpm,
//   equipment, commodity, weight, brokerName, status,
//   deliveredAt, closedAt, cancelledAt, cancellationReason, photos[]
//
// So on-time percentage is NOT derivable here: the payload carries when a load
// was delivered but never the window it was DUE by. Same for a star rating and
// an acceptance rate — no rating rows, and declines aren't returned. Rather
// than approximate those, this computes only the four figures the data
// genuinely supports. Adding on-time would need the backend to include the
// delivery deadline in the history projection.
//
// Pure — no React, no storage, no expo — so it runs under Jest like lib/geo
// and lib/loadStats.

const TERMINAL_DELIVERED = ['Delivered', 'Closed'];

const isDelivered = (l) => TERMINAL_DELIVERED.includes(l?.status);
const isCancelled = (l) => l?.status === 'Cancelled';

/**
 * Roll a driver's completed-load history into their standing figures.
 *
 * @param {Array} history newest-first, as returned by fetchLoadHistory()
 * @returns {{
 *   delivered: number,   loads reaching Delivered/Closed
 *   cancelled: number,   loads that ended Cancelled
 *   miles: number,       total miles across delivered loads
 *   earned: number,      total rate across delivered loads
 *   streak: number,      consecutive delivered loads, counting back from newest
 *   hasData: boolean     false for a brand-new driver — show an empty state
 * }}
 */
export function computeStanding(history) {
  const rows = Array.isArray(history) ? history : [];

  let delivered = 0;
  let cancelled = 0;
  let miles = 0;
  let earned = 0;

  for (const l of rows) {
    if (isCancelled(l)) { cancelled += 1; continue; }
    if (!isDelivered(l)) continue;
    delivered += 1;
    const m = Number(l.miles);
    if (isFinite(m) && m > 0) miles += m;
    const r = Number(l.rate);
    if (isFinite(r) && r > 0) earned += r;
  }

  // History arrives newest-first, so the current streak is the run of
  // successful deliveries before the most recent cancellation. Loads in a
  // non-terminal state can't appear here (the endpoint filters to terminal
  // states only), so anything that isn't a cancellation continues the run.
  let streak = 0;
  for (const l of rows) {
    if (isCancelled(l)) break;
    if (isDelivered(l)) streak += 1;
  }

  return {
    delivered,
    cancelled,
    miles: Math.round(miles),
    earned: Math.round(earned),
    streak,
    hasData: rows.length > 0,
  };
}
