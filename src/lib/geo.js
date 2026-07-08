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

/**
 * Whether to accept a fix as the driver's live position. Rejects coarse/cached
 * fixes (poor reported accuracy) and short-window teleports (implausible implied
 * speed). Always accepts the first fix so the loop can cold-start, and never
 * rejects on the teleport rule once the time gap is large.
 */
export function isAcceptableFix(prevFix, curFix, opts = {}) {
  const maxAccuracy = opts.maxAccuracyM ?? MAX_ACCURACY_M;
  const maxKph = opts.maxPlausibleKph ?? MAX_PLAUSIBLE_KPH;
  const windowSec = opts.teleportWindowSec ?? TELEPORT_WINDOW_SEC;

  const coords = curFix?.coords;
  if (!coords || !isFinite(coords.latitude) || !isFinite(coords.longitude)) return false;

  // No prior good fix yet — take whatever we can so sharing can start.
  if (!prevFix) return true;

  const acc = coords.accuracy;
  if (typeof acc === 'number' && isFinite(acc) && acc > maxAccuracy) return false;

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
