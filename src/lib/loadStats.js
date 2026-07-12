// Pure load-stats math — no React, no storage, no expo — so it runs under Jest
// and is the thing we validate on the bench (like lib/geo). Turns a load plus
// its measured actuals into the display-ready numbers both the completion card
// and the history detail sheet render.
//
// Three mileage figures matter, and they mean different things:
//   planned  — the broker's booked miles (what the load pays on)
//   loaded   — miles actually driven under freight  (pickup → delivery)
//   deadhead — empty miles driven to reach the pickup
// driven = loaded + deadhead, and the "effective" rate is rate ÷ driven — the
// real revenue per mile the driver turned, deadhead included.

export const METERS_PER_MILE = 1609.344;

/**
 * Deterministic stand-in actuals derived from planned miles, for mock mode and
 * for loads delivered without any GPS trail — so the screen is never blank.
 * Tuned to read realistically: ~8.6% deadhead to the pickup, ~1.5% over the
 * quote once loaded (720 planned → 62 deadhead + 731 loaded = 793 driven).
 */
export function synthActuals(plannedMiles) {
  const p = Number(plannedMiles) || 0;
  return { deadheadMiles: Math.round(p * 0.086), loadedMiles: Math.round(p * 1.015) };
}

/**
 * Freeze raw bucket miles into the stored, display-ready record for a load.
 * Rounds miles to whole numbers and precomputes both rpm figures so nothing
 * downstream has to guard a zero denominator.
 */
export function freezeRecord({ loadId, plannedMiles, rate, deadheadMiles, loadedMiles }) {
  const deadhead = Math.max(0, Math.round(deadheadMiles || 0));
  const loaded = Math.max(0, Math.round(loadedMiles || 0));
  const driven = deadhead + loaded;
  const planned = plannedMiles ?? null;
  const r = rate ?? null;
  return {
    loadId: String(loadId),
    plannedMiles: planned,
    rate: r,
    deadheadMiles: deadhead,
    loadedMiles: loaded,
    drivenMiles: driven,
    bookedRpm: r != null && planned ? r / planned : null,
    effectiveRpm: r != null && driven ? r / driven : null,
    completedAt: new Date().toISOString(),
  };
}

/**
 * Merge a load with any stored actuals into one stats object the UI reads.
 * Precedence for each figure: a frozen record → inline fields on the load
 * (mock history today, backend tomorrow) → planned-only. `hasActual` tells the
 * UI whether to show the driven/deadhead breakdown or just the booked numbers,
 * so a live load with no GPS yet degrades to planned instead of printing zeros.
 */
export function computeLoadStats(load, record) {
  const planned = record?.plannedMiles ?? load?.miles ?? null;
  const rate = record?.rate ?? load?.rate ?? null;
  const loaded = record?.loadedMiles ?? load?.loadedMiles ?? null;
  const deadhead = record?.deadheadMiles ?? load?.deadheadMiles ?? null;

  let driven = record?.drivenMiles ?? load?.drivenMiles ?? null;
  if (driven == null && (loaded != null || deadhead != null)) {
    driven = (loaded || 0) + (deadhead || 0);
  }

  const bookedRpm = rate != null && planned ? rate / planned : (load?.rpm ?? null);
  const effectiveRpm = rate != null && driven ? rate / driven : null;

  return {
    planned,
    rate,
    loaded,
    deadhead,
    driven,
    bookedRpm,
    effectiveRpm,
    // Signed gaps the sheet surfaces as chips; null when we can't compute them.
    loadedDelta: loaded != null && planned != null ? loaded - planned : null,
    rpmDelta: effectiveRpm != null && bookedRpm != null ? effectiveRpm - bookedRpm : null,
    hasActual: driven != null,
  };
}
