import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, Platform, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { themes, ACCENT_PRESETS, BG_PRESETS_NIGHT } from './tokens';
import {
  isDaylight,
  isDaylightByClock,
  nextClockBoundary,
  nextSolarTransition,
  validCoords,
} from '../lib/sun';

const KEY_THEME  = 'hl_theme_mode';
const KEY_ACCENT = 'hl_accent';
const KEY_BG     = 'hl_bg_night';
const KEY_COORDS = 'hl_sun_coords';

// Never let the auto timer sleep longer than this. The truck moves: 600 miles
// east, or a time-zone crossing, changes when the sun sets over it, and a timer
// armed last night in Denver is wrong by the time it fires in Chicago.
const MAX_TIMER_MS = 6 * 60 * 60 * 1000;
const MIN_TIMER_MS = 30 * 1000;

// Below this a new fix isn't worth re-arming the timer for — a tenth of a degree
// is about seven miles, which moves sunset by well under a minute.
const COORD_EPSILON = 0.1;

const ThemeContext = createContext(null);

/**
 * What "Auto" resolves to, and which rung of the ladder answered.
 *
 * Auto means the sun, because it sits next to buttons labelled Day and Night and
 * because the thing it is actually fighting — glare in the cab at 2am, a dark
 * screen against a bright windshield at noon — tracks the sun and not a settings
 * toggle the driver flipped once a year ago. The phone's own scheme is only the
 * fallback for when we have no position to work from, and the fixed clock is the
 * fallback for that (web, mainly, where there is no last-known fix at all).
 */
function resolveAuto(system, coords, now) {
  if (coords) {
    const lit = isDaylight(now, coords.lat, coords.lon);
    if (lit !== null) return { scheme: lit ? 'day' : 'night', source: 'sun' };
  }
  if (system === 'light') return { scheme: 'day', source: 'system' };
  if (system === 'dark') return { scheme: 'night', source: 'system' };
  return { scheme: isDaylightByClock(now) ? 'day' : 'night', source: 'clock' };
}

/**
 * The device's last known position, or null.
 *
 * Deliberately never *requests* permission — a location prompt at app boot,
 * before the driver has even seen the sign-in screen, to decide a colour scheme
 * would be indefensible. getForegroundPermissionsAsync doesn't prompt, and the
 * app already holds this permission while signed in for the heartbeat pipeline,
 * so in practice the theme gets a real position for free. getLastKnownPosition
 * reads the OS cache and returns immediately without powering up the GPS.
 */
async function readCoords() {
  if (Platform.OS === 'web') return null;
  try {
    const Location = require('expo-location');
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm?.granted) return null;
    const pos = await Location.getLastKnownPositionAsync();
    const c = { lat: pos?.coords?.latitude, lon: pos?.coords?.longitude };
    return validCoords(c) ? c : null;
  } catch {
    return null;
  }
}

function urlMode() {
  try {
    if (typeof window !== 'undefined' && window.location?.search) {
      const m = new URLSearchParams(window.location.search).get('theme');
      if (m === 'day' || m === 'night' || m === 'auto') return m;
    }
  } catch {}
  return null;
}

export function ThemeProvider({ children }) {
  const system = useColorScheme();
  const forced = urlMode();
  const [mode, setModeState] = useState(forced || 'auto');
  const [accentKey, setAccentKeyState] = useState('teal');
  const [bgKey, setBgKeyState] = useState('slate');
  const [coords, setCoords] = useState(null);
  // Bumped by the transition timer; this is what re-renders the tree at sunset.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (forced) return;
    Promise.all([
      AsyncStorage.getItem(KEY_THEME),
      AsyncStorage.getItem(KEY_ACCENT),
      AsyncStorage.getItem(KEY_BG),
      AsyncStorage.getItem(KEY_COORDS),
    ]).then(([t, a, b, c]) => {
      if (t) setModeState(t);
      if (a && ACCENT_PRESETS[a]) setAccentKeyState(a);
      if (b && BG_PRESETS_NIGHT[b]) setBgKeyState(b);
      // The stored position makes the very first frame after a cold start
      // sun-correct, before expo-location has been asked anything.
      if (c) {
        try {
          const p = JSON.parse(c);
          if (validCoords(p)) setCoords(p);
        } catch {}
      }
    }).catch(() => {});
  }, [forced]);

  const refreshCoords = useCallback(async () => {
    const c = await readCoords();
    if (!c) return;
    setCoords((prev) => (
      prev && Math.abs(prev.lat - c.lat) < COORD_EPSILON && Math.abs(prev.lon - c.lon) < COORD_EPSILON
        ? prev
        : c
    ));
    AsyncStorage.setItem(KEY_COORDS, JSON.stringify(c)).catch(() => {});
  }, []);

  useEffect(() => { refreshCoords(); }, [refreshCoords]);

  // Arm a timer for the next sunrise/sunset. Without this nothing re-renders at
  // the boundary and the scheme only ever changes when some other state does.
  useEffect(() => {
    if (mode !== 'auto') return undefined;
    let timer = null;
    const arm = (touch) => {
      if (timer) clearTimeout(timer);
      const at = new Date();
      if (touch) setNow(at);
      const next = (coords && nextSolarTransition(at, coords.lat, coords.lon)) || nextClockBoundary(at);
      const ms = Math.min(MAX_TIMER_MS, Math.max(MIN_TIMER_MS, next.getTime() - at.getTime()));
      timer = setTimeout(() => arm(true), ms);
    };
    arm(false);

    // Timers don't fire while the phone is asleep, so a truck parked overnight
    // wakes to a stale scheme unless the boundary is re-checked on foreground.
    // That's also the natural moment to pick up a position from a day's driving.
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      refreshCoords();
      arm(true);
    });
    return () => {
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [mode, coords, refreshCoords]);

  const setMode = (m) => {
    setModeState(m);
    setNow(new Date());
    AsyncStorage.setItem(KEY_THEME, m).catch(() => {});
  };

  const setAccent = (k) => {
    setAccentKeyState(k);
    AsyncStorage.setItem(KEY_ACCENT, k).catch(() => {});
  };

  const setBg = (k) => {
    setBgKeyState(k);
    AsyncStorage.setItem(KEY_BG, k).catch(() => {});
  };

  // nextChangeAt is exposed as epoch ms rather than a Date so it stays a stable
  // primitive in the context value between transitions.
  const auto = useMemo(() => {
    if (mode !== 'auto') return { scheme: mode, source: null, nextChangeAt: null };
    const r = resolveAuto(system, coords, now);
    let nextChangeAt = null;
    if (r.source === 'sun') {
      nextChangeAt = nextSolarTransition(now, coords.lat, coords.lon)?.getTime() ?? null;
    } else if (r.source === 'clock') {
      nextChangeAt = nextClockBoundary(now).getTime();
    }
    return { ...r, nextChangeAt };
  }, [mode, system, coords, now]);

  const scheme = auto.scheme;
  const base = themes[scheme];
  const accent = ACCENT_PRESETS[accentKey] || ACCENT_PRESETS.teal;
  const bgOverride = scheme === 'night' ? (BG_PRESETS_NIGHT[bgKey] || {}) : {};

  const colors = useMemo(() => ({
    ...base,
    ...bgOverride,
    teal: accent.color,
    tealBright: accent.grad[0],
    tealFill: accent.fill,
    info: accent.color,
    gradients: {
      ...base.gradients,
      teal: accent.grad,
      brand: accent.brand,
    },
  }), [scheme, accentKey, bgKey]);

  const value = useMemo(
    () => ({
      colors, scheme, mode, setMode, isDay: scheme === 'day',
      accentKey, setAccent, bgKey, setBg,
      autoSource: auto.source, autoNextChangeAt: auto.nextChangeAt,
    }),
    [colors, scheme, mode, accentKey, bgKey, auto.source, auto.nextChangeAt],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
