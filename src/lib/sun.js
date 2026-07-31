// Sunrise/sunset math for the Auto theme — pure, no React and no expo, so it
// runs under Jest like the rest of src/lib.
//
// Why this exists: "Auto" sits next to buttons labelled Day and Night, so it has
// to mean the sun, not the phone's light/dark switch. The rule it replaces was a
// fixed clock (day between 06:00 and 19:00), which is hours wrong across the
// country and the year — December sunset in Michigan is ~17:10, June sunset in
// Seattle is ~21:10 — and both errors land exactly when a dark cab or a bright
// windshield is the reason the theme exists at all.
//
// The algorithm is the standard low-precision NOAA/Meeus sunrise equation (the
// one SunCalc implements), accurate to about a minute. Nothing here needs
// better than that, and it costs no dependency.

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;

const OBLIQUITY = 23.4397 * RAD;   // tilt of Earth's axis
const PERIHELION = 102.9372 * RAD; // argument of perihelion
const J0 = 0.0009;                 // leap-second-ish fudge from the Meeus form

// Sunrise/sunset is defined as the sun's upper limb touching the horizon, which
// with atmospheric refraction puts its centre slightly below it.
const HORIZON = -0.833 * RAD;

// The clock rule, kept only as the last rung of the fallback ladder (web, or a
// driver who never granted location).
export const DAY_START_HOUR = 6;
export const NIGHT_START_HOUR = 19;

const toDays = (date) => date.getTime() / DAY_MS - 0.5 + J1970 - J2000;
const fromJulian = (j) => new Date((j + 0.5 - J1970) * DAY_MS);

const solarMeanAnomaly = (d) => RAD * (357.5291 + 0.98560028 * d);

function eclipticLongitude(M) {
  // Equation of the centre — the correction for Earth's elliptical orbit.
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + PERIHELION + Math.PI;
}

const declination = (L) => Math.asin(Math.sin(OBLIQUITY) * Math.sin(L));
const approxTransit = (Ht, lw, n) => J0 + (Ht + lw) / (2 * Math.PI) + n;
const solarTransitJ = (ds, M, L) => J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);

export function validCoords(c) {
  return !!c
    && Number.isFinite(c.lat) && Number.isFinite(c.lon)
    && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180;
}

/**
 * Sunrise/sunset for the solar day containing `date` at the given position.
 *
 * Above the Arctic / below the Antarctic circle there may be no sunrise at all,
 * which is a real state and not an error — Alaska runs freight all winter. Those
 * days come back with null times and `polar` set to 'day' (midnight sun) or
 * 'night' (the sun never clears the horizon).
 */
export function sunTimes(date, lat, lon) {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);
  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = approxTransit(0, lw, n);
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L);
  const jNoon = solarTransitJ(ds, M, L);
  const solarNoon = fromJulian(jNoon);

  const cosW = (Math.sin(HORIZON) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  // Exactly at a pole cos(phi) is 0 and this degenerates; report "can't tell"
  // rather than guessing a polar state.
  if (Number.isNaN(cosW)) return { sunrise: null, sunset: null, solarNoon, polar: null };
  if (cosW > 1) return { sunrise: null, sunset: null, solarNoon, polar: 'night' };
  if (cosW < -1) return { sunrise: null, sunset: null, solarNoon, polar: 'day' };

  const w = Math.acos(cosW);
  const jSet = solarTransitJ(approxTransit(w, lw, n), M, L);
  // Sunrise is the mirror of sunset about solar noon.
  const jRise = jNoon - (jSet - jNoon);
  return { sunrise: fromJulian(jRise), sunset: fromJulian(jSet), solarNoon, polar: null };
}

/**
 * Is the sun up at `date`? Returns null — not false — when the position is
 * unusable, so callers can fall through to the next rung instead of reading
 * "no answer" as "night".
 */
export function isDaylight(date, lat, lon) {
  if (!validCoords({ lat, lon })) return null;
  const { sunrise, sunset, polar } = sunTimes(date, lat, lon);
  if (polar === 'day') return true;
  if (polar === 'night') return false;
  if (!sunrise || !sunset) return null;
  const t = date.getTime();
  return t >= sunrise.getTime() && t < sunset.getTime();
}

/**
 * The next sunrise or sunset strictly after `date` — what the theme timer is
 * armed against. Looks two days ahead so a position just inside the polar
 * circles, where a day can legitimately have neither, still resolves.
 */
export function nextSolarTransition(date, lat, lon) {
  if (!validCoords({ lat, lon })) return null;
  const t = date.getTime();
  for (let i = 0; i <= 2; i++) {
    const { sunrise, sunset } = sunTimes(new Date(t + i * DAY_MS), lat, lon);
    const upcoming = [sunrise, sunset]
      .filter((d) => d && d.getTime() > t)
      .map((d) => d.getTime());
    if (upcoming.length) return new Date(Math.min(...upcoming));
  }
  return null;
}

/** Clock-rule daylight, the fallback when there is no position to work from. */
export function isDaylightByClock(date) {
  const h = date.getHours();
  return h >= DAY_START_HOUR && h < NIGHT_START_HOUR;
}

/** Next 06:00/19:00 boundary after `date` — the fallback's version of a transition. */
export function nextClockBoundary(date) {
  const next = new Date(date.getTime());
  next.setMinutes(0, 0, 0);
  const h = date.getHours();
  if (h < DAY_START_HOUR) {
    next.setHours(DAY_START_HOUR);
  } else if (h < NIGHT_START_HOUR) {
    next.setHours(NIGHT_START_HOUR);
  } else {
    next.setDate(next.getDate() + 1);
    next.setHours(DAY_START_HOUR);
  }
  return next;
}
