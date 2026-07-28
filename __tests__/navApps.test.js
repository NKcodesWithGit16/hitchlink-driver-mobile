import {
  navUrlCandidates,
  availableNavApps,
  resolveNavApp,
  normalizeNavApp,
  NAV_APP_LABELS,
  NAV_APPS,
  DEFAULT_NAV_APP,
} from '../src/lib/navApps';

const DEST = '41.8781,-87.6298';
const ORIG = '40.7128,-74.0060';

// The candidate list is walked in order by ActionGrid until one URL opens, so
// what matters in these tests is (a) the native scheme comes first and (b) a
// reachable web/store entry always comes last.
const first = (opts) => navUrlCandidates(opts)[0];
const last = (opts) => navUrlCandidates(opts).slice(-1)[0];

describe('normalizeNavApp', () => {
  test('passes through every supported app', () => {
    NAV_APPS.forEach((app) => expect(normalizeNavApp(app)).toBe(app));
  });
  test('falls back to the default for anything unknown', () => {
    expect(normalizeNavApp('waze')).toBe(DEFAULT_NAV_APP);
    expect(normalizeNavApp(undefined)).toBe(DEFAULT_NAV_APP);
    expect(normalizeNavApp('')).toBe(DEFAULT_NAV_APP);
  });
});

describe('availableNavApps', () => {
  test('drops Apple Maps on Android — it does not exist there', () => {
    expect(availableNavApps('android')).not.toContain('apple');
    expect(availableNavApps('android')).toContain('truckerpath');
  });
  // No geo: on iOS and no published truckerpath:// scheme, so the hand-off
  // would open the app without the stop — the driver finds out mid-route.
  test('drops Trucker Path on iOS and web — the destination cannot be carried', () => {
    expect(availableNavApps('ios')).not.toContain('truckerpath');
    expect(availableNavApps('web')).not.toContain('truckerpath');
    expect(availableNavApps('ios')).toEqual(['google', 'apple']);
  });
  test('every platform still offers the default', () => {
    ['ios', 'android', 'web'].forEach((p) =>
      expect(availableNavApps(p)).toContain(DEFAULT_NAV_APP));
  });
  test('stays within the three buttons an Android Alert can render', () => {
    // +1 for the Cancel button the picker appends.
    expect(availableNavApps('android').length + 1).toBeLessThanOrEqual(3);
  });
  test('every offered app has a label', () => {
    ['ios', 'android', 'web'].forEach((p) =>
      availableNavApps(p).forEach((app) => expect(NAV_APP_LABELS[app]).toBeTruthy()));
  });
});

describe('resolveNavApp', () => {
  test('keeps a preference the platform offers', () => {
    expect(resolveNavApp('apple', 'ios')).toBe('apple');
    expect(resolveNavApp('truckerpath', 'android')).toBe('truckerpath');
  });
  test('degrades a preference the platform no longer offers to the default', () => {
    // Set on an Android phone, or before Trucker Path was pulled from the iOS
    // picker — must not build a hand-off that drops the stop.
    expect(resolveNavApp('truckerpath', 'ios')).toBe(DEFAULT_NAV_APP);
    expect(resolveNavApp('apple', 'android')).toBe(DEFAULT_NAV_APP);
  });
  test('always returns something the platform actually offers', () => {
    ['ios', 'android', 'web'].forEach((platform) =>
      [...NAV_APPS, 'waze', undefined].forEach((app) =>
        expect(availableNavApps(platform)).toContain(resolveNavApp(app, platform))));
  });
});

// navUrlCandidates is deliberately NOT gated by availableNavApps — it answers
// "what URLs would open app X on platform Y", and callers resolve first. That
// keeps the iOS Trucker Path form built and covered, ready for the day Trucker
// Path publishes a scheme and it goes back in the picker.
describe('Google Maps', () => {
  test('iOS uses the Google Maps app scheme, then falls back to the web', () => {
    const urls = navUrlCandidates({ app: 'google', platform: 'ios', destination: DEST, origin: ORIG });
    expect(urls[0]).toContain('comgooglemaps://');
    expect(urls[0]).toContain(`saddr=${encodeURIComponent(ORIG)}`);
    expect(urls[urls.length - 1]).toContain('https://www.google.com/maps/dir/');
  });
  test('Android uses the turn-by-turn navigation intent', () => {
    expect(first({ app: 'google', platform: 'android', destination: DEST }))
      .toBe(`google.navigation:q=${encodeURIComponent(DEST)}`);
  });
  test('web has only the browser URL', () => {
    const urls = navUrlCandidates({ app: 'google', platform: 'web', destination: DEST });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('https://www.google.com/maps/dir/');
  });
  test('omits the origin entirely when we could not get a fix', () => {
    const url = first({ app: 'google', platform: 'ios', destination: DEST, origin: null });
    expect(url).not.toContain('saddr');
    expect(url).toContain('daddr=');
  });
});

describe('Apple Maps', () => {
  test('iOS uses the maps:// scheme in driving mode', () => {
    const url = first({ app: 'apple', platform: 'ios', destination: DEST, origin: ORIG });
    expect(url).toContain('maps://');
    expect(url).toContain('dirflg=d');
  });
  test('falls back to Google Maps on Android, where Apple Maps cannot exist', () => {
    const url = first({ app: 'apple', platform: 'android', destination: DEST });
    expect(url).toContain('google.navigation:');
  });
  test('keeps the maps.apple.com form on web', () => {
    expect(first({ app: 'apple', platform: 'web', destination: DEST })).toContain('https://maps.apple.com/');
  });
});

describe('Trucker Path', () => {
  test('tries a parameterised deep link, then a bare launch, then the store', () => {
    const urls = navUrlCandidates({ app: 'truckerpath', platform: 'ios', destination: DEST });
    expect(urls[0]).toContain('truckerpath://');
    expect(urls[0]).toContain(encodeURIComponent(DEST));
    // The bare scheme matters: any path under a registered scheme opens the
    // app, so this is what keeps an installed-but-unparameterised Trucker Path
    // from falling through to the store.
    expect(urls).toContain('truckerpath://');
    expect(urls.indexOf('truckerpath://')).toBeLessThan(urls.length - 1);
  });
  test('offers a lat/lng-pair form only when the destination really is coordinates', () => {
    const coords = navUrlCandidates({ app: 'truckerpath', platform: 'android', destination: DEST });
    expect(coords.some((u) => u.includes('lat=41.8781') && u.includes('lng=-87.6298'))).toBe(true);
    // A free-text address can't be split, so that form must not be invented.
    const address = navUrlCandidates({ app: 'truckerpath', platform: 'android', destination: 'Chicago, IL' });
    expect(address.some((u) => u.includes('lat='))).toBe(false);
  });

  test('the destination-carrying attempts all precede the bare scheme', () => {
    ['ios', 'android'].forEach((platform) => {
      const urls = navUrlCandidates({ app: 'truckerpath', platform, destination: DEST });
      const bare = urls.indexOf('truckerpath://');
      expect(bare).toBeGreaterThan(0);
      // Everything before the bare launch carries the stop...
      urls.slice(0, bare).forEach((u) => expect(u).toContain('41.8781'));
      // ...and nothing after it can open the app, so an installed Trucker Path
      // never falls through to the store.
      urls.slice(bare + 1).forEach((u) => expect(u.startsWith('truckerpath://')).toBe(false));
    });
  });

  // Android's documented route: geo: goes to whichever app holds the default
  // navigation role, which Trucker Path publishes instructions for claiming.
  test('Android includes a geo: hand-off carrying the destination', () => {
    const urls = navUrlCandidates({ app: 'truckerpath', platform: 'android', destination: DEST });
    const geo = urls.find((u) => u.startsWith('geo:'));
    expect(geo).toBe('geo:41.8781,-87.6298?q=41.8781,-87.6298');
    // It must sit after the app-specific guesses (which target Trucker Path
    // exactly) but before the bare launch (which carries no destination).
    expect(urls.indexOf(geo)).toBeLessThan(urls.indexOf('truckerpath://'));
  });

  test('the geo: form falls back to a query for a free-text address', () => {
    const urls = navUrlCandidates({ app: 'truckerpath', platform: 'android', destination: 'Chicago, IL' });
    expect(urls.find((u) => u.startsWith('geo:'))).toBe('geo:0,0?q=Chicago%2C%20IL');
  });

  test('iOS gets no geo: entry — the scheme does not exist there', () => {
    const urls = navUrlCandidates({ app: 'truckerpath', platform: 'ios', destination: DEST });
    expect(urls.some((u) => u.startsWith('geo:'))).toBe(false);
  });

  test('ends at a store entry on each mobile platform', () => {
    expect(last({ app: 'truckerpath', platform: 'ios', destination: DEST })).toContain('apps.apple.com');
    expect(last({ app: 'truckerpath', platform: 'android', destination: DEST })).toContain('play.google.com');
  });
  test('the store fallback is reachable in a browser, not only via a store scheme', () => {
    // A market:// or itms-apps:// URL is useless if the store app is absent,
    // so the LAST entry must always be an https one.
    ['ios', 'android', 'web'].forEach((platform) => {
      expect(last({ app: 'truckerpath', platform, destination: DEST })).toMatch(/^https:/);
    });
  });
});

describe('destination handling', () => {
  test('no destination yields no candidates rather than a bad URL', () => {
    expect(navUrlCandidates({ app: 'google', platform: 'ios', destination: '' })).toEqual([]);
    expect(navUrlCandidates({ app: 'google', platform: 'ios', destination: null })).toEqual([]);
    expect(navUrlCandidates({ app: 'google', platform: 'ios', destination: '   ' })).toEqual([]);
  });
  test('encodes a free-text address so spaces and commas survive', () => {
    const url = first({ app: 'google', platform: 'android', destination: '1600 Amphitheatre Pkwy, CA' });
    expect(url).not.toMatch(/ /);
    expect(url).toContain('1600%20Amphitheatre%20Pkwy%2C%20CA');
  });
  test('an unknown app still produces a usable Google Maps hand-off', () => {
    expect(first({ app: 'waze', platform: 'android', destination: DEST })).toContain('google.navigation:');
  });
});
