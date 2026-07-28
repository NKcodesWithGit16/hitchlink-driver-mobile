// Which app the Navigate button hands off to, and the URLs that get it there.
//
// The hand-off itself is a product decision, not a gap: HitchLink never renders
// turn-by-turn in-app, it opens the driver's own navigation app. This module is
// the pure URL half of that — no React, no Linking — so the scheme building is
// unit-testable and the component just walks the list it returns.
//
// Each app resolves to an ORDERED candidate list. The caller opens the first
// one the OS accepts (Linking.openURL rejects an unhandled scheme), so a
// missing app falls through to a web or store entry instead of a dead tap.
// Nothing here calls canOpenURL, deliberately: on iOS that needs every scheme
// declared in LSApplicationQueriesSchemes, which is a native change, and a
// native change means an OTA can no longer be shipped without bumping
// expo.version (see CLAUDE.md). openURL + catch needs no Info.plist entry.
//
// ⚠️ Google and Apple publish their URL formats. Trucker Path does NOT — its
// scheme below is a best guess. Any path under a registered scheme opens the
// app, so an installed Trucker Path WILL launch, but it may ignore the
// destination and land on its own home screen; the bare-scheme entry is there
// so that still counts as "opened" rather than falling through to the store.
// Confirm the parameterised form on a device with the app installed.

export const NAV_APP_GOOGLE = 'google';
export const NAV_APP_APPLE = 'apple';
export const NAV_APP_TRUCKER_PATH = 'truckerpath';

export const NAV_APPS = [NAV_APP_GOOGLE, NAV_APP_APPLE, NAV_APP_TRUCKER_PATH];

export const DEFAULT_NAV_APP = NAV_APP_GOOGLE;

// Brand names, not UI copy — deliberately not run through i18n. They read the
// same in every locale (the Georgian bundle already spelled "Apple Maps" in
// Latin script for exactly this reason).
export const NAV_APP_LABELS = {
  [NAV_APP_GOOGLE]: 'Google Maps',
  [NAV_APP_APPLE]: 'Apple Maps',
  [NAV_APP_TRUCKER_PATH]: 'Trucker Path',
};

// Store fallbacks are SEARCHES rather than direct product links. A wrong app id
// or Android package name 404s the driver, and neither is published anywhere we
// can verify from here; a search for the exact name always resolves. Swap in
// the real ids once confirmed — these four constants are the only thing that
// would change.
const TRUCKER_PATH_STORE = {
  ios: [
    'itms-apps://itunes.apple.com/search?term=Trucker%20Path&entity=software',
    'https://apps.apple.com/search?term=Trucker+Path',
  ],
  android: [
    'market://search?q=Trucker%20Path&c=apps',
    'https://play.google.com/store/search?q=Trucker%20Path&c=apps',
  ],
};

// Split a "lat,lng" destination back into its two numbers, or null when the
// destination is a free-text address. Only used to build the schemes that want
// the pair as separate parameters.
function latLng(raw) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(raw);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Normalise anything stored/passed in to a supported app id. */
export function normalizeNavApp(app) {
  return NAV_APPS.includes(app) ? app : DEFAULT_NAV_APP;
}

/**
 * The apps worth offering on a given platform — product policy, deliberately
 * kept apart from navUrlCandidates below, which only answers "what URLs would
 * open app X". Both exclusions matter:
 *
 *   Apple Maps on Android — it cannot exist there, so the setting would
 *   silently do nothing.
 *
 *   Trucker Path on iOS — no `geo:` equivalent and no published scheme, so the
 *   hand-off opens the app WITHOUT the stop. The driver only discovers that
 *   mid-route, which is worse than not offering it at all. Re-enable by adding
 *   it back to this list the moment Trucker Path sends a real scheme (asked
 *   2026-07-28): navUrlCandidates already builds the iOS form and is still
 *   tested for it, so this is the only line that has to change.
 *
 * Dropping one app per platform also keeps every picker at three buttons, which
 * is all a React Native Alert can render on Android.
 */
export function availableNavApps(platform) {
  return platform === 'android'
    ? [NAV_APP_GOOGLE, NAV_APP_TRUCKER_PATH]
    : [NAV_APP_GOOGLE, NAV_APP_APPLE];
}

/**
 * The app that will actually be used on this platform. A stored preference the
 * platform no longer offers — chosen before an app was withdrawn from the
 * picker — degrades to the default rather than to a dead hand-off. Screens must
 * label the setting row with THIS, not the raw stored value, or the row names
 * an app that Navigate isn't using.
 */
export function resolveNavApp(app, platform) {
  const wanted = normalizeNavApp(app);
  return availableNavApps(platform).includes(wanted) ? wanted : DEFAULT_NAV_APP;
}

/**
 * Ordered URLs to try for a driving hand-off.
 *
 * @param app          one of NAV_APPS (anything else falls back to Google Maps)
 * @param platform     Platform.OS — 'ios' | 'android' | 'web'
 * @param destination  "lat,lng" preferred; a free-text address also works
 * @param origin       "lat,lng" of the driver, or null to let the app decide
 */
export function navUrlCandidates({ app, platform, destination, origin = null }) {
  const raw = destination == null ? '' : String(destination).trim();
  if (!raw) return [];
  const q = encodeURIComponent(raw);
  const o = origin ? encodeURIComponent(String(origin).trim()) : null;

  // Apple Maps off iOS would open nothing at all, so it resolves to the
  // platform's real default instead of failing silently. (Web keeps it: the
  // maps.apple.com fallback below renders fine in a browser.)
  const resolved = normalizeNavApp(app) === NAV_APP_APPLE && platform === 'android'
    ? NAV_APP_GOOGLE
    : normalizeNavApp(app);

  if (resolved === NAV_APP_APPLE) {
    const web = o
      ? `https://maps.apple.com/?saddr=${o}&daddr=${q}&dirflg=d`
      : `https://maps.apple.com/?daddr=${q}&dirflg=d`;
    if (platform !== 'ios') return [web];
    return [
      o ? `maps://?saddr=${o}&daddr=${q}&dirflg=d` : `maps://?daddr=${q}&dirflg=d`,
      web,
    ];
  }

  if (resolved === NAV_APP_TRUCKER_PATH) {
    const store = TRUCKER_PATH_STORE[platform] ?? TRUCKER_PATH_STORE.android.slice(1);
    const pair = latLng(raw);

    // Trucker Path publishes NO deep link today. Their help centre says they
    // *can* publish one on request — `truckerpath://route?...` is their own
    // example, which is why it leads here — but until they do, these three are
    // guesses. Asked for at integrations@truckerpath.com on 2026-07-28; pin
    // whatever they send back and delete the rest.
    //
    // The ladder only does real work on ANDROID, where an intent filter matches
    // host and path, so a form the app doesn't declare genuinely fails over.
    // On iOS any path under a registered scheme opens the app, so the first
    // entry wins whether or not Trucker Path understands it.
    const guesses = [
      `truckerpath://route?destination=${q}`,
      ...(pair ? [`truckerpath://navigate?lat=${pair.lat}&lng=${pair.lng}`] : []),
      `truckerpath://?daddr=${q}`,
    ];

    // Android's documented answer, and the reason this option works there at
    // all: `geo:` hands the destination to whichever app holds the system
    // default-navigation role, and Trucker Path publishes its own guide to
    // claiming that role. Two consequences worth knowing:
    //
    //   - A driver who picked Trucker Path here but never set it as their
    //     Android default gets their actual default (usually Google Maps), or a
    //     chooser. The destination still arrives, which is the thing that
    //     matters; the preference is a hint, not a guarantee.
    //   - Something always handles `geo:`, so on Android the bare scheme and
    //     store entries below are effectively unreachable. That's the right
    //     trade: we can't detect whether Trucker Path is installed without
    //     manifest `<queries>` (a native change), and arriving in the wrong app
    //     WITH the stop beats arriving in the right one without it.
    const geo = platform === 'android'
      ? [pair ? `geo:${pair.lat},${pair.lng}?q=${pair.lat},${pair.lng}` : `geo:0,0?q=${q}`]
      : [];

    return [
      ...guesses,
      ...geo,
      // Last resort before the store: at least open the app the driver asked
      // for, even with no destination attached.
      'truckerpath://',
      ...store,
    ];
  }

  // Google Maps — the default, and where anything unrecognised lands.
  const web = o
    ? `https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${q}&travelmode=driving`
    : `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving`;
  const native = platform === 'ios'
    ? (o
      ? `comgooglemaps://?saddr=${o}&daddr=${q}&directionsmode=driving`
      : `comgooglemaps://?daddr=${q}&directionsmode=driving`)
    : platform === 'android'
      ? `google.navigation:q=${q}`
      : null;
  return native ? [native, web] : [web];
}
