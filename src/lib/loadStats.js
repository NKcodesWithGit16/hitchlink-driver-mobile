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

const n = (x) => (x == null ? 0 : Number(x) || 0);

/**
 * Merge a load with any stored actuals into one stats object the UI reads.
 *
 * The actuals come from one of two places and the choice is deliberate:
 *
 *   SERVER  — `deadheadMiles`/`loadedMiles`/`actualMiles` on the load, summed
 *             by the backend from this same GPS stream (HeartbeatCommandHandler).
 *             Authoritative: it survives a reinstall or a new phone, can't be
 *             edited on the device, and the dispatcher sees the same number.
 *   DEVICE  — the frozen record from lib/odometer.js, in AsyncStorage.
 *
 * The server wins whenever it reports any distance at all. A server total of 0
 * means "nothing tracked" — a load delivered before the odometer existed, or a
 * trip that never reported — and there the device record is all anyone has, so
 * it stands. The two are taken as a SET rather than field-by-field: mixing a
 * server `loaded` with a device `deadhead` would produce a total that matches
 * neither source. Mock mode has no server figures, so it uses the record.
 *
 * `planned` may legitimately be null now — a dispatcher can book a load without
 * quoting mileage — which is why every downstream figure guards it.
 * `hasActual` tells the UI whether to show the driven/deadhead breakdown or
 * just the booked numbers, so a live load with no GPS yet degrades to planned
 * instead of printing zeros.
 */
export function computeLoadStats(load, record) {
  const planned = record?.plannedMiles ?? load?.miles ?? null;
  const rate = record?.rate ?? load?.rate ?? null;

  // `actualMiles` is the API's name for it; `drivenMiles` is the mock's and the
  // frozen record's. Same quantity.
  const serverDriven = n(load?.actualMiles ?? load?.drivenMiles);
  const useServer = serverDriven > 0 || n(load?.loadedMiles) + n(load?.deadheadMiles) > 0;

  const loaded = useServer
    ? n(load?.loadedMiles)
    : (record?.loadedMiles ?? null);
  const deadhead = useServer
    ? n(load?.deadheadMiles)
    : (record?.deadheadMiles ?? null);

  let driven = useServer
    ? (serverDriven || n(load?.loadedMiles) + n(load?.deadheadMiles))
    : (record?.drivenMiles ?? null);
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
