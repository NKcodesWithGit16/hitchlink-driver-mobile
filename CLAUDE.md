# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A driver-only rebuild of the HitchLink mobile app (Expo + expo-router / React Native), separate from the
older multi-role `hitchlink_mobileApp` sibling repo. Dark-first, "Bold Utilitarian" design language. It is
its own git repo — not part of a shared monorepo build — and talks to the same backend
(`HitchLink.Main` + `HitchLink.Identity`, both deployed on Railway) that the dispatcher web app and the
older mobile app use.

## Commands

```bash
npm install
npm start            # expo dev server; then i / a / w for iOS / Android / web
npm run web           # web WITH the CORS proxy — use this, NOT `expo start --web`
npm run web:direct     # plain `expo start --web`, no proxy — API calls will fail (CORS)
npm test              # jest-expo, all tests
npm test -- __tests__/loadStats.test.js   # single test file
npm run test:watch
npm run test:ci        # --ci --reporters=default --maxWorkers=2
npx expo install --fix # align native package versions after touching package.json
```

No eslint/prettier configured in this repo (unlike `hitchlink_mobileApp`). Tests live in `__tests__/` and
only cover pure `src/lib` logic (`geo`, `loadStats`, `load`, `format`, `session`, `offlineQueue`,
`jwtUtils`) — there is no UI/component test coverage, so verify screen changes by running the app.

## Mock vs. live backend — one env var, and it does NOT gate auth

`USE_MOCK` (`src/api/config.js`) is simply `!EXPO_PUBLIC_API_MAIN_URL`. When mock, `src/api/main.js` returns
`src/data/mock.js` fixtures; when a URL is set it calls the live API using the same endpoint paths as
`hitchlink_mobileApp` (`/loads/driver/:id`, `/loads/:id/status`, `/chat/:id`, …).

**`src/api/auth.js` has no mock branch — it always calls `HitchLink.Identity` for real.** There is no
demo/guest bypass: even in mock mode you cannot get past `app/(auth)/sign-in.js` without a reachable
Identity service. The committed `.env` points at the **staging** Railway backends for both services, so
`USE_MOCK` is off by default in a normal checkout.

**Web requires the CORS proxy.** The Railway backends never send `Access-Control-Allow-Origin`, so browser
calls from `localhost` are blocked. `npm run web` runs `scripts/web-dev.js`, which starts two pass-through
proxies (`:8788` → Identity, `:8789` → Main, reading targets from `.env`) and then `expo start --web`;
`src/api/config.js` routes web traffic through them (`IDENTITY_BASE`/`MAIN_BASE`). Native builds (APK/iOS)
skip the proxy and hit Railway directly — CORS doesn't apply there.

`eas.json`'s `development`, `preview`, **and `production`** build profiles all currently point at the
staging Railway hosts — there is no separate prod-backend profile yet.

## Real-time layer: SignalR hubs + REST fallback

Three independent hooks each join a hub on `MAIN_BASE`, all defensively `require`d (no-op in mock mode, on
builds without `@microsoft/signalr`, or with no API URL configured — screens then fall back to polling):

- `src/hooks/useChatSocket.js` — `/hubs/chat`, `ReceiveMessage` / `TypingChanged`, joins `driver_{id}` room
- `src/hooks/useLoadStatusSocket.js` — load status push (`LoadStatusChanged`)
- `src/hooks/useCallSocket.js` — `IncomingCall` / `CallAccepted` / `CallDeclined` / `CallEnded` /
  `CallCancelled` / `CallHandledElsewhere`

All three resolve the hub's JWT via `accessTokenFactory: () => getValidToken()` (`src/lib/session.js`), so
a reconnect after token expiry re-authenticates automatically rather than failing. On `onreconnected`, the
chat/load hooks re-join their room and force a re-fetch to catch anything missed while the socket was down
— screens should treat the hook's `connected` flag as "can relax polling," never as the sole data source.

## In-app calling (Daily.co WebRTC + iOS CallKit)

This is a fully-built feature, not a stub — `src/context/CallContext.js` is the state machine for it, mounted
once at `app/_layout.js` so a call rings regardless of which tab is open. Audio-only (never requests camera).

- **Media**: `@daily-co/react-native-daily-js`. `CallContext` creates/joins a Daily "call object" per call;
  `roomUrl`/`token` come from the backend's `/calls/*` endpoints (`src/api/calls.js`).
- **iOS lock-screen ringing**: a dispatcher-initiated call triggers an APNs VoIP push, handled natively by
  the local Expo module `modules/hitchlink-voip/` (`PKPushRegistry`) and reported to CallKit via
  `react-native-callkeep`, so the phone can ring even fully locked/backgrounded — before any JS is
  necessarily running. `src/hooks/useVoipPushToken.js` registers/syncs this device's VoIP token; both this
  and `RNCallKeep`/`Voip` are `require`d only on iOS and no-op elsewhere.
- **Two independent delivery paths for one call**: CallKit's native screen (from the VoIP push) and the
  live SignalR `IncomingCall` event can both fire for the same call, arriving in either order. `CallContext`
  gives CallKit a short grace window (`CALLKIT_GRACE_MS`) to claim an incoming call before falling back to
  its own in-app overlay, and tracks `callKitCallIdsRef` / `callKitUuidBySrvIdRef` so whichever path ends
  the call also retires the *other* path's session — read the large comment block at the top of
  `CallContext.js` before touching any of this; the ordering/race handling is the entire point of the file.
- **Android has no CallKit equivalent.** An incoming call when the app is backgrounded/killed on Android
  arrives only as a regular Expo push notification (`type: "call"`, routed by
  `src/hooks/usePushNotifications.js` to `app/call/[callId].js`) — not a native full-screen ring.
- A synchronous ref (`acceptInFlightRef`), not React state, guards every accept path against double-fire
  (double tap, or CallKit's `onAnswered` racing the SignalR path) — a re-entrant `/accept` 409s and its
  catch block would otherwise tear down the call the first invocation just connected.

## GPS / location pipeline (spans several files)

While signed in, `src/hooks/useLocationSharing.js` (foreground watch) and `src/lib/backgroundLocation.js`
(a headless `expo-task-manager` task, imported once at the top of `app/_layout.js`) stream fixes to
`POST /drivers/:id/heartbeat`; the server replies with `nextHeartbeatSeconds` to pace the cadence.
`src/lib/geo.js` is the pure fix math — Haversine (mirrors the backend's `GeoMath`), speed derivation
(Android often reports `coords.speed` as null), and `isAcceptableFix` (drops cached/teleport fixes). Off
that same accepted-fix stream, `src/lib/odometer.js` accumulates per-load **actual miles** into deadhead vs.
loaded buckets (phase from `loadPhase` in `src/lib/load.js`), persists them in AsyncStorage keyed by load,
and freezes a record on delivery; `src/lib/loadStats.js` merges planned + actual into the numbers shown on
the delivery card and the Pay-history detail sheet.

## Session, tokens, and offline queue

`src/lib/session.js` does single-flight token refresh (proactive before expiry, reactive on a 401 via
`src/api/client.js`) — only a rejected *refresh* token actually ends the session. `src/utils/tokenStorage.js`
stores tokens in SecureStore on native, AsyncStorage on web (SecureStore throws in the browser).

Load status updates apply optimistically and queue to an AsyncStorage replay queue
(`src/lib/offlineQueue.js`, `enqueue`/`flush`/`queueCount`, wired into `app/(tabs)/index.js`) that flushes on
reconnect (`src/hooks/useNetworkStatus.js`).

## Structure

```
app/                       expo-router — file = route
  welcome.js → onboarding.js → (auth)/sign-in.js   gate the 5-tab (tabs)/
  (tabs)/index.js           Load home — status state machine drives the single contextual action.
                            An Assigned load with acceptedAt == null shows LoadOfferCard (accept/decline)
                            INSTEAD of that action — a driver can't mark "arrived" on a load they never took.
  (tabs)/messages.js        Chat + voice messages + call
  (tabs)/earnings.js        Pay history, stats, fuel estimate
  (tabs)/documents.js       CDL/Medical/Registration/Insurance, expiry alerts, offline viewer
  (tabs)/more.js            HOS detail, truck info, theme, notifications, sign out
  call/[callId].js          Deep-link target for a tapped call push notification
  alerts.js                 Notification inbox (AlertContext)
src/
  api/{client,config,main,auth,calls}.js   HTTP layer; config.js resolves mock/live/proxy base URLs
  context/{AuthContext,ThemeContext isn't here (see theme/),CallContext,AlertContext}.js
  hooks/                    one hook per real-time concern (chat/call/load-status sockets, push, GPS, VoIP)
  lib/                      pure logic: geo, load, loadStats, odometer, offlineQueue, session, format, sound,
                            standing (driver record from history), chatRows (day separators + grouping),
                            localNotifications (on-device reminders), observability (opt-in Sentry)
  theme/tokens.js           dark + day theme tables, resolved through theme/ThemeContext — never hardcode hexes
  i18n/{en,ka}.js + LanguageContext.js   full English + Georgian coverage; new UI strings need both
  components/ui/            generic primitives (PrimaryAction, Card, IconButton, Skeleton, GlassView, …)
  components/driver/        domain components (StatusBar, NextStopCard, DocCard, HOSPill, StageStepper, …)
modules/hitchlink-voip/     local Expo native module: PKPushRegistry → CallKit bridge (iOS only)
```

Design tokens (`src/theme/tokens.js`): near-black `#0A0E14` surfaces, near-white (never pure white) text,
brand teal `#1FB6CE` / navy `#04285A`. Action colors are meaningful — teal = progress, green = completion,
red = call/severe weather, amber = plan a stop. Primary actions are 64px tall with tabular-number stats.

Navigation deliberately hands off to the phone's native Maps app rather than rendering in-app turn-by-turn
— a product decision, not a gap.

## Releases, crash reporting and on-device reminders

**OTA updates are wired up.** `expo-updates` points at EAS Update
(`updates.url` in `app.json`) with `runtimeVersion.policy: "fingerprint"` — deliberately fingerprint and not
`appVersion`, because this repo ships custom native code (`modules/hitchlink-voip`), and a fingerprint policy
refuses to hand a JS-only update to a binary whose native side doesn't match. Each `eas.json` profile declares
its own `channel` (development / preview / production). `fallbackToCacheTimeout: 0` means launch never blocks
on a network fetch — a truck in a dead zone still opens the app instantly.

**Crash reporting is opt-in via `src/lib/observability.js`.** It only activates when `EXPO_PUBLIC_SENTRY_DSN`
is set, so a checkout without a Sentry project behaves exactly as before. The root `ErrorBoundary`
(`app/_layout.js`) reports through it *and* offers a retry rather than dead-ending; `AuthContext` tags reports
with the driver id only (never name/phone/email), and clears it on sign-out.

**A build-time guard blocks shipping production against staging.** `scripts/check-prod-backend.js` runs via the
`eas-build-pre-install` npm script and fails the build *only* when `EAS_BUILD_PROFILE=production` and the API
URLs still contain `staging`. Development and preview builds, and plain local `npm install`, are unaffected.
There is still no dedicated production backend — the guard exists so nobody forgets that.

**Local reminders** (`src/lib/localNotifications.js`) schedule on-device notifications for the HOS 30-minute
break (20 min ahead, from `hos.breakInMinutes`) and credential expiry (30/7/1 days out, from `expiryStatus`).
These need no backend and fire with no signal. Identifiers are stable so re-scheduling replaces rather than
stacks; `cancelAllLocalReminders()` runs on sign-out so a shared cab phone doesn't announce the previous
driver's CDL expiry.

## Known limitations (not bugs to "fix" reflexively)

- HOS is a best-effort estimate; certified logs would require a real ELD integration.
- **Chat history has no cursor.** `GET /chat/{driverId}` takes the newest `limit` rows (default 100) and
  accepts no `before`/cursor parameter, so there is no way to scroll back past the newest 100 messages.
  Fixing that is a `ChatController.GetHistory` change, not a client one.
- **The driver record card shows no on-time %, rating or acceptance rate**, because
  `GET /loads/driver/{id}/history` returns `DeliveredAt` but never the delivery *deadline*, and carries no
  ratings or declines. `src/lib/standing.js` deliberately computes only what that payload supports
  (delivered / miles / earned / streak). Adding on-time needs the deadline in the history projection.
- **New Architecture is off (`newArchEnabled: false`) on purpose — do not flip it casually.** The calling
  stack is the blocker: `react-native-callkeep@4.3.16` is a plain legacy ObjC module with no `codegenConfig`,
  and `@daily-co/react-native-daily-js` peer-depends on `react-native-background-timer@2.4.1` (unmaintained,
  legacy bridge) and imports it at runtime — so it is NOT removable despite appearing unused in our own
  source. Both would run only through the bridgeless interop layer. The local `hitchlink-voip` module is fine
  (Expo Modules API supports both architectures). Migrating means verifying a real CallKit call on a physical
  iOS device, so treat it as a scheduled piece of work with device testing, not a config flip.
- `README.md` in this repo is stale (still describes auth/voice/offline-queue as unimplemented placeholders)
  — trust this file and the code over it.
