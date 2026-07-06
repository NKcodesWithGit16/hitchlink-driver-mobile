import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { themes, ACCENT_PRESETS, BG_PRESETS_NIGHT } from './tokens';

const KEY_THEME  = 'hl_theme_mode';
const KEY_ACCENT = 'hl_accent';
const KEY_BG     = 'hl_bg_night';

const ThemeContext = createContext(null);

function resolveScheme(mode, system) {
  if (mode === 'day' || mode === 'night') return mode;
  if (system === 'light') return 'day';
  if (system === 'dark') return 'night';
  const h = new Date().getHours();
  return h >= 6 && h < 19 ? 'day' : 'night';
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

  useEffect(() => {
    if (forced) return;
    Promise.all([
      AsyncStorage.getItem(KEY_THEME),
      AsyncStorage.getItem(KEY_ACCENT),
      AsyncStorage.getItem(KEY_BG),
    ]).then(([t, a, b]) => {
      if (t) setModeState(t);
      if (a && ACCENT_PRESETS[a]) setAccentKeyState(a);
      if (b && BG_PRESETS_NIGHT[b]) setBgKeyState(b);
    }).catch(() => {});
  }, [forced]);

  const setMode = (m) => {
    setModeState(m);
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

  const scheme = resolveScheme(mode, system);
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
    () => ({ colors, scheme, mode, setMode, isDay: scheme === 'day', accentKey, setAccent, bgKey, setBg }),
    [colors, scheme, mode, accentKey, bgKey],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
