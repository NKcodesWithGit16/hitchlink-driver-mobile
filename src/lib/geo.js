// Pure GPS helpers for the heartbeat pipeline — no React, no expo, so they run
// under Jest and are the thing we validate on the bench instead of on the road.
//
// Two problems these solve, both seen on a live Android drive:
//   1. Android's fused provider frequently reports coords.speed as null/-1, so
//      the server (which keys the heartbeat cadence off speed) mislabels a
//      moving truck as Idle and slows updates to a crawl. deriveSpeedKph falls
//      back to distance/time between fixes so real motion always drives cadence.
//   2. In weak signal the provider hands back a cached last-known location —
//      often from earlier in the trip — which, sent as "here now", snaps the
//      dispatcher marker backward. isAcceptableFix rejects those.

const EARTH_RADIUS_METERS = 6_371_000;

// A fix reported with worse horizontal accuracy than this is treated as a
// coarse/network/cached fix and dropped (real GPS fixes are typically < 30m).
export const MAX_ACCURACY_M = 100;

// Above this implied speed over a short window we assume a bad/cached fix rather
// than a real move — no truck does 200 km/h.
export const MAX_PLAUSIBLE_KPH = 200;

// Only apply the teleport check when consecutive fixes are close in time; after
// a long gap a large jump can be legitimate (the driver really did travel far).
export const TELEPORT_WINDOW_SEC = 120;

const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in meters. Mirrors backend GeoMath.HaversineMeters. */
export function haversineMeters(aLat, aLng, bLat, bLng) {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

// Seconds between two expo-location fixes (their `timestamp` is epoch ms).
function dtSeconds(prevFix, curFix) {
  if (!prevFix || !curFix) return 0;
  return (curFix.timestamp - prevFix.timestamp) / 1000;
}

/**
 * Speed in km/h for a fix. Trusts the provider's own reading when it's a real
 * value; otherwise derives it from the distance/time to the previous fix.
 * Returns 0 when there's nothing usable (first fix, non-advancing clock).
 */
export function deriveSpeedKph(prevFix, curFix) {
  const raw = curFix?.coords?.speed;
  if (typeof raw === 'number' && isFinite(raw) && raw >= 0) return raw * 3.6;

  const dt = dtSeconds(prevFix, curFix);
  if (dt <= 0) return 0;
  const meters = haversineMeters(
    prevFix.coords.latitude, prevFix.coords.longitude,
    curFix.coords.latitude, curFix.coords.longitude,
  );
  return (meters / dt) * 3.6;
}

// ── Odometer segment gating ────────────────────────────────────────────────
// These mirror HeartbeatCommandHandler's MinOdometerSegmentMeters /
// MaxOdometerGapSeconds so the phone's own actual-miles record follows exactly
// the same rules as the server's. They deliberately differ from isAcceptableFix
// below: a fix can be perfectly good to REPORT as the live position and still
// be wrong to fold into a distance total.
//
// GPS wander while parked is real: a rig sitting at a truck stop for a 10-hour
// break would otherwise accumulate phantom miles a few metres at a time.
export const MIN_ODOMETER_SEGMENT_METERS = 25;

// Past this gap the road actually driven is unknown — the app was killed, or
// there was no signal for an hour — and a straight chord across it would be a
// guess. Skipping undercounts through outages, which is the honest failure
// direction for a number a driver may one day be paid on.
export const MAX_ODOMETER_GAP_SEC = 1800; // 30 minutes

/**
 * Metres to fold into a load's odometer for the move between two accepted
 * fixes, or 0 when the segment must not count: no pair to measure, a missing
 * or non-advancing clock, too long a gap, or a move small enough to be the
 * receiver drifting rather than the truck moving.
 */
export function odometerSegmentMeters(prevFix, curFix, opts = {}) {
  const minMeters = opts.minSegmentMeters ?? MIN_ODOMETER_SEGMENT_METERS;
  const maxGapSec = opts.maxGapSec ?? MAX_ODOMETER_GAP_SEC;

  const a = prevFix?.coords;
  const b = curFix?.coords;
  if (!a || !b) return 0;
  if (!isFinite(a.latitude) || !isFinite(a.longitude)) return 0;
  if (!isFinite(b.latitude) || !isFinite(b.longitude)) return 0;

  // Without a usable clock we can't tell a 30-second hop from a 3-hour one, so
  // the gap rule can't be applied at all — don't guess, don't count.
  const dt = dtSeconds(prevFix, curFix);
  if (!isFinite(dt) || dt <= 0 || dt > maxGapSec) return 0;

  const meters = haversineMeters(a.latitude, a.longitude, b.latitude, b.longitude);
  if (!isFinite(meters) || meters < minMeters) return 0;
  return meters;
}

/**
 * Whether to accept a fix as the driver's live position. Rejects coarse/cached
 * fixes (poor reported accuracy) and short-window teleports (implausible implied
 * speed), and never rejects on the teleport rule once the time gap is large.
 *
 * The FIRST fix of a session is checked for accuracy like any other, and that
 * matters more than it sounds. This used to accept it unconditionally so
 * sharing could cold-start, which meant the one fix exempt from every check was
 * the one most likely to be wrong: at cold start the phone has no GPS lock yet
 * and the OS answers from wifi, cell towers or the IP address instead.
 *
 * A driver running Montana to Washington was shown parked at Beijing Capital
 * Airport because of exactly that — a network-derived first fix, accepted
 * unchecked, and then held because the server's own teleport guard only looks
 * at jumps inside a 2-minute window and this one arrived after a long gap.
 * Every guard in the chain was bypassed by the same cold start.
 *
 * The trade is real but one-sided: sharing may begin a few seconds later while
 * the receiver gets a proper lock. A late position corrects itself; a confident
 * wrong one does not, and a dispatcher has no way to tell it from the truth.
 * Coarse fixes are worth roughly 1 km at best (cell) and a whole country at
 * worst (IP), so nothing of value is being given up.
 */
export function isAcceptableFix(prevFix, curFix, opts = {}) {
  const maxAccuracy = opts.maxAccuracyM ?? MAX_ACCURACY_M;
  const maxKph = opts.maxPlausibleKph ?? MAX_PLAUSIBLE_KPH;
  const windowSec = opts.teleportWindowSec ?? TELEPORT_WINDOW_SEC;

  const coords = curFix?.coords;
  if (!coords || !isFinite(coords.latitude) || !isFinite(coords.longitude)) return false;

  // Accuracy first, and above the first-fix shortcut on purpose — see the note
  // on this function. A fix with no accuracy reported at all still passes:
  // there is nothing to judge it by, and refusing every such fix would strand
  // devices that simply do not populate the field.
  const acc = coords.accuracy;
  if (typeof acc === 'number' && isFinite(acc) && acc > maxAccuracy) return false;

  // No prior fix, so no elapsed time and no implied speed to test. Accept —
  // the accuracy check above has already established this is a real GPS fix
  // rather than a network guess.
  if (!prevFix) return true;

  const dt = dtSeconds(prevFix, curFix);
  if (dt > 0 && dt < windowSec) {
    const meters = haversineMeters(
      prevFix.coords.latitude, prevFix.coords.longitude,
      coords.latitude, coords.longitude,
    );
    const impliedKph = (meters / dt) * 3.6;
    if (impliedKph > maxKph) return false;
  }
  return true;
}
