# HitchLink Driver — Mobile App

A focused, **driver-only** rebuild of the HitchLink mobile app in a **Bold Utilitarian,
dark-first** design language: glanceable from the wheel, glove-friendly tap targets, one
clear action per screen. Built on Expo + expo-router (React Native).

> Runs out of the box on **mock data** — no backend needed. Point it at the real
> `HitchLink.Main` API by setting `EXPO_PUBLIC_API_MAIN_URL`.

## Run it

```bash
cd hitchlink_driverMobile
npm install
npm start            # then press i (iOS), a (Android), or w (web)
```

If icons don't resolve, run `npx expo install @expo/vector-icons` (it ships with Expo,
so this is rarely needed). To align all native package versions: `npx expo install --fix`.

### Point at the live backend

```bash
# .env  (or shell env)
EXPO_PUBLIC_API_MAIN_URL=https://your-hitchlink-main-host
```

With that set, `src/api/main.js` swaps mock data for live calls. The endpoint paths
mirror the existing app, so it drops onto the same backend (`/loads/driver/:id`,
`/loads/:id/status`, `/chat/:id`, …).

## What's here (the 8 features → 5 tabs)

| Tab | Feature |
|-----|---------|
| **Load** (home) | Current load, one contextual status action (Arrived → Loaded → Delivered), Navigate hand-off, POD camera, live weather strip + severe-weather takeover, HOS pill |
| **Messages** | SMS-simple dispatcher thread, push-to-talk voice, one-tap call, quick replies |
| **Earnings** | Weekly/monthly net, miles, loads, avg $/mi, estimated fuel, mini chart, per-load history |
| **Docs** | CDL / Medical / Registration / Insurance with live expiry status + 30-day alerts, full-screen offline viewer |
| **More** | HOS detail gauge, truck info, theme, notifications, sign out |

Navigation **hands off** to the phone's own maps app (Apple/Google) — this is deliberately
**not** an in-app GPS, per the product spec.

## Structure

```
app/
  _layout.js            Root: Theme + Auth providers, dark Stack
  (tabs)/
    _layout.js          Dark 5-tab bottom bar
    index.js            Load (hero screen, state-machine driven)
    messages.js         Chat + voice + call
    earnings.js         Stats + fuel + history
    documents.js        Doc grid + expiry + viewer
    more.js             HOS detail + settings
src/
  theme/tokens.js       Bold dark-first design tokens (color/space/type/tone)
  theme/ThemeContext.js
  context/AuthContext.js
  api/{client,main}.js  Mock-first API layer (live when env URL is set)
  lib/{load,format}.js  Lifecycle + formatting helpers
  data/mock.js          Demo fixtures
  components/ui/         PrimaryAction, IconButton, Card, Tag, StatTile, Icon, SectionLabel
  components/driver/     StatusBar, NextStopCard, ActionGrid, WeatherStrip,
                         StageStepper, HOSPill, DocCard, VoiceButton
```

## Design tokens

Dark-first. Near-black `#0A0E14` surfaces, near-white text (never pure white — cuts night
glare), brand teal `#1FB6CE` / navy `#04285A`. Action colors carry meaning: **teal** =
progress, **green** = completion, **red** = call / severe weather, **amber** = plan a stop.
Primary actions are 64px tall with tabular-number stats for instant reading.

## Notes / next steps

- **Auth**: boots into a demo driver. Wire `AuthContext` to HitchLink.Identity + add a
  sign-in screen to gate `(tabs)`.
- **Voice**: the push-to-talk UI is wired; capture is simulated — drop in `expo-audio`
  at send time in `VoiceButton`/`src/api`.
- **HOS**: best-effort estimate; certified logs require an ELD integration.
- **Offline**: status updates apply optimistically; a real replay queue (AsyncStorage +
  NetInfo) is the Phase-2 follow-up.
