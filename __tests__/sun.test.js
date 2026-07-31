import {
  sunTimes,
  isDaylight,
  isDaylightByClock,
  nextSolarTransition,
  nextClockBoundary,
  validCoords,
} from '../src/lib/sun';

// Positions used across the suite.
const SEATTLE = { lat: 47.6062, lon: -122.3321 };
const NEW_YORK = { lat: 40.7128, lon: -74.0060 };
const LONDON = { lat: 51.5074, lon: -0.1278 };
const QUITO = { lat: -0.1807, lon: -78.4678 };
const UTQIAGVIK = { lat: 71.2906, lon: -156.7886 }; // above the Arctic circle

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Minutes between two Dates, absolute. */
const minutesApart = (a, b) => Math.abs(a.getTime() - b.getTime()) / MIN;

describe('sunTimes', () => {
  // Published almanac values, which vary by under a minute year to year. A 15
  // minute tolerance is loose enough to be stable and tight enough that a wrong
  // algorithm — the actual risk here — still fails.
  it('matches known sunrise/sunset within 15 minutes (London, summer solstice)', () => {
    const { sunrise, sunset } = sunTimes(new Date('2026-06-21T12:00:00Z'), LONDON.lat, LONDON.lon);
    expect(minutesApart(sunrise, new Date('2026-06-21T03:43:00Z'))).toBeLessThan(15);
    expect(minutesApart(sunset, new Date('2026-06-21T20:21:00Z'))).toBeLessThan(15);
  });

  it('matches known sunrise/sunset within 15 minutes (New York, winter solstice)', () => {
    const { sunrise, sunset } = sunTimes(new Date('2026-12-21T17:00:00Z'), NEW_YORK.lat, NEW_YORK.lon);
    expect(minutesApart(sunrise, new Date('2026-12-21T12:17:00Z'))).toBeLessThan(15);
    expect(minutesApart(sunset, new Date('2026-12-21T21:32:00Z'))).toBeLessThan(15);
  });

  it('orders sunrise before solar noon before sunset', () => {
    const { sunrise, solarNoon, sunset } = sunTimes(new Date('2026-04-10T18:00:00Z'), SEATTLE.lat, SEATTLE.lon);
    expect(sunrise.getTime()).toBeLessThan(solarNoon.getTime());
    expect(solarNoon.getTime()).toBeLessThan(sunset.getTime());
  });

  // This is the whole reason the fixed 06:00–19:00 rule had to go: the same
  // city's day length swings by more than seven hours over the year.
  it('gives a much longer day in June than December at high latitude', () => {
    const len = (iso) => {
      const { sunrise, sunset } = sunTimes(new Date(iso), SEATTLE.lat, SEATTLE.lon);
      return sunset.getTime() - sunrise.getTime();
    };
    const june = len('2026-06-21T20:00:00Z');
    const december = len('2026-12-21T20:00:00Z');
    expect(june / HOUR).toBeGreaterThan(15);
    expect(december / HOUR).toBeLessThan(9);
  });

  it('keeps the equator near twelve hours of daylight year-round', () => {
    for (const iso of ['2026-03-21T15:00:00Z', '2026-06-21T15:00:00Z', '2026-12-21T15:00:00Z']) {
      const { sunrise, sunset } = sunTimes(new Date(iso), QUITO.lat, QUITO.lon);
      const hours = (sunset.getTime() - sunrise.getTime()) / HOUR;
      expect(hours).toBeGreaterThan(11.5);
      expect(hours).toBeLessThan(12.5);
    }
  });

  it('reports polar night and midnight sun instead of inventing times', () => {
    const winter = sunTimes(new Date('2026-12-21T20:00:00Z'), UTQIAGVIK.lat, UTQIAGVIK.lon);
    expect(winter.polar).toBe('night');
    expect(winter.sunrise).toBeNull();
    expect(winter.sunset).toBeNull();

    const summer = sunTimes(new Date('2026-06-21T20:00:00Z'), UTQIAGVIK.lat, UTQIAGVIK.lon);
    expect(summer.polar).toBe('day');
    expect(summer.sunrise).toBeNull();
  });
});

describe('isDaylight', () => {
  it('is true at solar noon and false twelve hours later', () => {
    const { solarNoon } = sunTimes(new Date('2026-09-15T18:00:00Z'), NEW_YORK.lat, NEW_YORK.lon);
    expect(isDaylight(solarNoon, NEW_YORK.lat, NEW_YORK.lon)).toBe(true);
    const midnight = new Date(solarNoon.getTime() + 12 * HOUR);
    expect(isDaylight(midnight, NEW_YORK.lat, NEW_YORK.lon)).toBe(false);
  });

  it('flips across sunset', () => {
    const { sunset } = sunTimes(new Date('2026-09-15T18:00:00Z'), NEW_YORK.lat, NEW_YORK.lon);
    expect(isDaylight(new Date(sunset.getTime() - MIN), NEW_YORK.lat, NEW_YORK.lon)).toBe(true);
    expect(isDaylight(new Date(sunset.getTime() + MIN), NEW_YORK.lat, NEW_YORK.lon)).toBe(false);
  });

  it('follows the polar state where there is no sunrise', () => {
    expect(isDaylight(new Date('2026-12-21T20:00:00Z'), UTQIAGVIK.lat, UTQIAGVIK.lon)).toBe(false);
    expect(isDaylight(new Date('2026-06-21T08:00:00Z'), UTQIAGVIK.lat, UTQIAGVIK.lon)).toBe(true);
  });

  // Null, not false — the caller has to be able to tell "no answer" from
  // "night", or a missing position would force the dark theme at noon.
  it('returns null for an unusable position', () => {
    expect(isDaylight(new Date(), undefined, undefined)).toBeNull();
    expect(isDaylight(new Date(), NaN, 0)).toBeNull();
    expect(isDaylight(new Date(), 120, 0)).toBeNull();
  });
});

describe('nextSolarTransition', () => {
  it('returns the upcoming sunset while the sun is up', () => {
    const { solarNoon, sunset } = sunTimes(new Date('2026-05-05T18:00:00Z'), SEATTLE.lat, SEATTLE.lon);
    const next = nextSolarTransition(solarNoon, SEATTLE.lat, SEATTLE.lon);
    expect(minutesApart(next, sunset)).toBeLessThan(1);
  });

  it('returns tomorrow morning when both of today\'s transitions have passed', () => {
    const { sunset } = sunTimes(new Date('2026-05-05T18:00:00Z'), SEATTLE.lat, SEATTLE.lon);
    const afterDark = new Date(sunset.getTime() + HOUR);
    const next = nextSolarTransition(afterDark, SEATTLE.lat, SEATTLE.lon);
    expect(next.getTime()).toBeGreaterThan(afterDark.getTime());
    expect(next.getTime() - afterDark.getTime()).toBeLessThan(24 * HOUR);
  });

  it('is always in the future', () => {
    for (const iso of ['2026-01-01T00:30:00Z', '2026-01-01T12:00:00Z', '2026-07-04T23:45:00Z']) {
      const at = new Date(iso);
      const next = nextSolarTransition(at, NEW_YORK.lat, NEW_YORK.lon);
      expect(next.getTime()).toBeGreaterThan(at.getTime());
    }
  });

  it('still resolves under the midnight sun', () => {
    const at = new Date('2026-06-21T12:00:00Z');
    const next = nextSolarTransition(at, UTQIAGVIK.lat, UTQIAGVIK.lon);
    // Either a real transition within the look-ahead window, or null — never a
    // date in the past.
    if (next) expect(next.getTime()).toBeGreaterThan(at.getTime());
  });

  it('returns null for an unusable position', () => {
    expect(nextSolarTransition(new Date(), null, null)).toBeNull();
  });
});

describe('clock fallback', () => {
  const at = (h, m = 0) => {
    const d = new Date(2026, 6, 15, h, m, 30, 250);
    return d;
  };

  it('calls 06:00 to 19:00 day', () => {
    expect(isDaylightByClock(at(5, 59))).toBe(false);
    expect(isDaylightByClock(at(6, 0))).toBe(true);
    expect(isDaylightByClock(at(18, 59))).toBe(true);
    expect(isDaylightByClock(at(19, 0))).toBe(false);
  });

  it('advances to the next boundary, rolling over midnight', () => {
    expect(nextClockBoundary(at(3)).getHours()).toBe(6);
    expect(nextClockBoundary(at(12)).getHours()).toBe(19);

    const late = nextClockBoundary(at(22));
    expect(late.getHours()).toBe(6);
    expect(late.getDate()).toBe(16);
  });

  it('lands on a whole hour', () => {
    const b = nextClockBoundary(at(12, 34));
    expect(b.getMinutes()).toBe(0);
    expect(b.getSeconds()).toBe(0);
    expect(b.getMilliseconds()).toBe(0);
  });
});

describe('validCoords', () => {
  it('accepts a real fix and rejects junk', () => {
    expect(validCoords({ lat: 47.6, lon: -122.3 })).toBe(true);
    expect(validCoords({ lat: 0, lon: 0 })).toBe(true);
    expect(validCoords(null)).toBe(false);
    expect(validCoords({ lat: '47', lon: -122 })).toBe(false);
    expect(validCoords({ lat: 91, lon: 0 })).toBe(false);
    expect(validCoords({ lat: 0, lon: 181 })).toBe(false);
  });
});
