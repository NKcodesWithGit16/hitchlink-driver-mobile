/* ============================================================
   HitchLink Driver — design tokens
   "Modern Depth, dual-theme": Night (dark, OLED, glare-free) +
   Day (high-contrast light, engineered for direct sunlight).
   Layered surfaces · soft directional shadows · glass overlays.
   Brand: navy #04285A + teal #0193AB.
   ============================================================ */
import { Easing } from 'react-native';

// ── Theme-independent scales ─────────────────────────────────────────
export const space = {
  0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 28,
  8: 32, 10: 40, 12: 48, 14: 56, 16: 64, 20: 80,
};

export const radius = { sm: 10, md: 16, lg: 20, xl: 24, '2xl': 28, pill: 999 };

// Warm humanist font (Lexend) once loaded; system fallback until then.
export const FONT = {
  regular: 'Lexend_400Regular',
  medium: 'Lexend_500Medium',
  semibold: 'Lexend_600SemiBold',
  bold: 'Lexend_700Bold',
  extrabold: 'Lexend_800ExtraBold',
  black: 'Lexend_900Black',
};

// Type carries size/weight only — never color.
export const type = {
  display: { fontSize: 44, fontFamily: FONT.black, letterSpacing: -1 },
  h1: { fontSize: 29, fontFamily: FONT.extrabold, letterSpacing: -0.5 },
  h2: { fontSize: 23, fontFamily: FONT.extrabold, letterSpacing: -0.3 },
  title: { fontSize: 19, fontFamily: FONT.bold, letterSpacing: -0.2 },
  body: { fontSize: 17, fontFamily: FONT.medium },
  bodyStrong: { fontSize: 17, fontFamily: FONT.bold },
  label: { fontSize: 13, fontFamily: FONT.bold, letterSpacing: 0.6, textTransform: 'uppercase' },
  caption: { fontSize: 13, fontFamily: FONT.medium },
  num: { fontVariant: ['tabular-nums'] },
};

export const tap = { primary: 64, secondary: 56, icon: 48 };

export const shadow = {
  card: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.16, shadowRadius: 18, elevation: 6 },
  float: { shadowColor: '#000', shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.28, shadowRadius: 28, elevation: 14 },
  glow: (c) => ({ shadowColor: c, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 10 }),
};

// ── Elevation scale ──────────────────────────────────────────────────
// Layered depth is the signature of "Modern Depth". Pick by hierarchy:
// 1 = resting list item · 2 = card · 3 = raised/active · 4 = floating/overlay.
export const elevation = {
  0: {},
  1: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 },  shadowOpacity: 0.10, shadowRadius: 6,  elevation: 2 },
  2: { shadowColor: '#000', shadowOffset: { width: 0, height: 6 },  shadowOpacity: 0.14, shadowRadius: 14, elevation: 5 },
  3: { shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.20, shadowRadius: 24, elevation: 10 },
  4: { shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.28, shadowRadius: 36, elevation: 18 },
};

// ── Motion ───────────────────────────────────────────────────────────
// "Balanced": lively but never in the way. Durations in ms; spring configs
// feed Animated.spring; easings feed Animated.timing. Always pair with
// useReduceMotion() so the OS setting can flatten everything to instant.
export const motion = {
  duration: { fast: 180, base: 260, slow: 420, hero: 900 },
  spring: {
    soft:   { damping: 18, stiffness: 180, mass: 0.8 },
    snappy: { damping: 22, stiffness: 260, mass: 0.7 },
    bouncy: { damping: 12, stiffness: 150, mass: 0.9 },
  },
  easing: {
    standard:   Easing.bezier(0.2, 0, 0, 1),
    decelerate: Easing.out(Easing.cubic),
    accelerate: Easing.in(Easing.cubic),
  },
  press: 0.97,   // scale on press for tappables
  stagger: 60,   // delay between staggered list children
};

// ── Materials / glass ────────────────────────────────────────────────
// expo-blur config + a translucent overlay tint layered behind content so
// text stays legible over busy backgrounds. Resolve from the active theme.
export function glassFor(colors) {
  return colors.isDay
    ? { tint: 'light', intensity: 36, overlay: 'rgba(255,255,255,0.55)' }
    : { tint: 'dark',  intensity: 40, overlay: 'rgba(18,24,32,0.52)' };
}

// ── NIGHT (dark) ─────────────────────────────────────────────────────
const night = {
  scheme: 'night',
  isDay: false,
  statusBarStyle: 'light',

  bg: '#0A0E14', surface: '#141A22', surface2: '#1C2530', surfaceHi: '#243040',
  border: 'rgba(255,255,255,0.08)', borderStrong: 'rgba(255,255,255,0.16)',
  textPrimary: '#F2F6FB', textSecondary: '#A7B4C8', textMuted: '#6B7890', textInverse: '#0A0E14',

  teal: '#1FB6CE', tealBright: '#2DD4E8', navy: '#04285A',
  go: '#16C784', caution: '#FFB020', danger: '#FF4D4F', info: '#2DD4E8',
  tealFill: 'rgba(31,182,206,0.14)', goFill: 'rgba(22,199,132,0.14)',
  cautionFill: 'rgba(255,176,32,0.15)', dangerFill: 'rgba(255,77,79,0.14)',

  onAccent: '#06121A',          // ink that sits on a bright accent button
  overlay: 'rgba(3,6,11,0.72)',

  gradients: {
    teal: ['#22C9E0', '#0E7C90'], go: ['#1BD68C', '#0E9E68'],
    caution: ['#FFC24D', '#D98A00'], danger: ['#FF6062', '#C81E1E'],
    brand: ['#0193AB', '#04285A'], card: ['#1A2230', '#11161F'],
    splash: ['#0A3A78', '#04285A', '#0E7C90'],
    weatherWarn: ['#3A2E12', '#241B0A'], weatherSevere: ['#3A1416', '#240A0B'],
  },
};

// ── DAY (sunlight-grade light) ───────────────────────────────────────
const day = {
  scheme: 'day',
  isDay: true,
  statusBarStyle: 'dark',

  bg: '#EAEEF5', surface: '#FFFFFF', surface2: '#F2F5FA', surfaceHi: '#E5EAF2',
  border: 'rgba(8,15,30,0.12)', borderStrong: 'rgba(8,15,30,0.22)',
  textPrimary: '#0B1220', textSecondary: '#36425C', textMuted: '#5A6680', textInverse: '#FFFFFF',

  // Brand colors darkened so they stay AAA-legible on white in glare.
  teal: '#0B6F82', tealBright: '#0193AB', navy: '#04285A',
  go: '#0E9E68', caution: '#A86400', danger: '#C81E1E', info: '#0E7490',
  tealFill: 'rgba(1,147,171,0.12)', goFill: 'rgba(16,158,104,0.12)',
  cautionFill: 'rgba(168,100,0,0.12)', dangerFill: 'rgba(200,30,30,0.10)',

  onAccent: '#FFFFFF',          // darker day accents take white ink
  overlay: 'rgba(8,15,30,0.40)',

  gradients: {
    teal: ['#0EA0B8', '#0B6F82'], go: ['#16B279', '#0E9E68'],
    caution: ['#C98400', '#A86400'], danger: ['#E0413F', '#C81E1E'],
    brand: ['#0193AB', '#04285A'], card: ['#FFFFFF', '#EFF3F9'],
    splash: ['#0A3A78', '#04285A', '#0E7C90'],
    weatherWarn: ['#FFF2D6', '#FCE3A6'], weatherSevere: ['#FBE0E0', '#F6C6C6'],
  },
};

export const themes = { day, night };

// ── Accent color presets ─────────────────────────────────────────────
export const ACCENT_PRESETS = {
  teal:   { label: 'Teal',   color: '#1FB6CE', fill: 'rgba(31,182,206,0.14)',  grad: ['#22C9E0','#0E7C90'], brand: ['#0193AB','#04285A'] },
  blue:   { label: 'Blue',   color: '#3B82F6', fill: 'rgba(59,130,246,0.14)',  grad: ['#60A5FA','#2563EB'], brand: ['#3B82F6','#1D4ED8'] },
  purple: { label: 'Purple', color: '#A855F7', fill: 'rgba(168,85,247,0.14)', grad: ['#C084FC','#9333EA'], brand: ['#A855F7','#7C3AED'] },
  green:  { label: 'Green',  color: '#22C55E', fill: 'rgba(34,197,94,0.14)',   grad: ['#4ADE80','#16A34A'], brand: ['#22C55E','#166534'] },
  orange: { label: 'Orange', color: '#F97316', fill: 'rgba(249,115,22,0.14)',  grad: ['#FB923C','#EA580C'], brand: ['#F97316','#9A3412'] },
  rose:   { label: 'Rose',   color: '#F43F5E', fill: 'rgba(244,63,94,0.14)',   grad: ['#FB7185','#E11D48'], brand: ['#F43F5E','#9F1239'] },
};

// ── Night background presets ─────────────────────────────────────────
export const BG_PRESETS_NIGHT = {
  navy:    { label: 'Navy',    bg: '#0A0E14', surface: '#141A22', surface2: '#1C2530', surfaceHi: '#243040' },
  black:   { label: 'OLED',    bg: '#000000', surface: '#101010', surface2: '#181818', surfaceHi: '#222222' },
  charcoal:{ label: 'Charcoal',bg: '#111827', surface: '#1F2937', surface2: '#243040', surfaceHi: '#2D3748' },
  slate:   { label: 'Slate',   bg: '#0F172A', surface: '#1E293B', surface2: '#263042', surfaceHi: '#334155' },
};

// Map an action "tone" to colors from the ACTIVE theme.
export function toneOf(colors, name) {
  switch (name) {
    case 'go': return { solid: colors.go, grad: colors.gradients.go, fill: colors.goFill, ink: colors.onAccent };
    case 'caution': return { solid: colors.caution, grad: colors.gradients.caution, fill: colors.cautionFill, ink: colors.onAccent };
    case 'danger': return { solid: colors.danger, grad: colors.gradients.danger, fill: colors.dangerFill, ink: colors.onAccent };
    case 'teal':
    default: return { solid: colors.teal, grad: colors.gradients.teal, fill: colors.tealFill, ink: colors.onAccent };
  }
}
