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

**All four** `eas.json` build profiles point at the staging Railway hosts — there is no production backend
yet. What distinguishes them is how the build is signed and distributed:

| Profile | Distribution | Use |
|---|---|---|
| `development` | internal (ad-hoc) | dev client, loads JS from Metro |
| `preview` | internal (ad-hoc) | release build for a registered device, installed from a link |
| `testflight` | store | **TestFlight** — the only ad-hoc profile can't upload to App Store Connect |
| `production` | store | a real public release; blocked by the guard below until a prod backend exists |

`testflight` exists because TestFlight requires a store-signed build, which `preview` is not, and
`production` is (correctly) refused while it points at staging. **A `testflight` build must never be
promoted to a public App Store release from App Store Connect** — it runs against the staging database.

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
- **CallKit owns the audio session**, and WebRTC has to be told the moment iOS activates it. `CallContext`
  bridges `RNCallKeep`'s `didActivateAudioSession` / `didDeactivateAudioSession` to
  `RTCAudioSession.audioSessionDidActivate()` from `@daily-co/react-native-webrtc`. **Without that bridge a
  CallKit-answered call connects completely silently** while the in-app path works fine — which is exactly
  how it presented in the field. The speaker route is re-applied on activation too, because RNCallKeep runs
  its own `configureAudioSession` there and can move it back to the earpiece.
- **One incoming-call UI, chosen by the backend.** CallKit's native screen (from the VoIP push) and the live
  SignalR `IncomingCall` event are separate delivery paths for the same call and arrive in either order, so
  the driver used to see both. `CallsController.StartCall` now emits a second SignalR event,
  `CallRingPath { callId, native }`, right after `IncomingCall`: `native` is true when APNs *accepted* the
  VoIP push. The app shows nothing when native (CallKit is coming), rings in-app immediately when not, and
  falls back to `CALLKIT_GRACE_MS` only if the signal never arrives. `CALLKIT_BACKSTOP_MS` covers "Apple
  accepted it but the handset never rang". `onDisplayed` also stands a late in-app screen down, so the two
  can never be on screen together. `callKitCallIdsRef` / `callKitUuidBySrvIdRef` still ensure whichever path
  ends the call retires the other's session — read the large comment block at the top of `CallContext.js`
  before touching any of this; the ordering/race handling is the entire point of the file.
- ⚠️ **`Apns:Production` must be true for any TestFlight/App Store build.** `ApnsVoipPushService` talks to
  `api.sandbox.push.apple.com` unless that config says otherwise. A production-signed build against the
  sandbox host has every push rejected with `BadDeviceToken`, so CallKit never rings — the app would then
  ring in-app for every call (correctly, via `CallRingPath`), but the lock-screen ring would be silently
  gone. It is a Railway env var, not something the code can infer.
- **Android has no CallKit equivalent.** An incoming call when the app is backgrounded/killed on Android
  arrives only as a regular Expo push notification (`type: "call"`, routed by
  `src/hooks/usePushNotifications.js` to `app/call/[callId].js`) — not a native full-screen ring.
- **An active call can be minimized, and that is why the call UI is two components.**
  `src/components/call/CallOverlay.js` renders either the full-screen takeover (a `Modal`, so it covers
  the tabs) or — when `status === 'active' && minimized` — a thin green banner pinned under the status
  bar ("Tap to return · 02:14"). The banner is deliberately **not** a `Modal`: an iOS `Modal` swallows
  every touch beneath it, which is what made the whole app unusable during a call. `minimized` is
  presentational only — the Daily call object and CallKit session are untouched — and is guarded to
  `active`, so a *ringing* call can never be hidden behind a banner nobody notices. The takeover's `‹`
  (top-left) and Android back both minimize; back is swallowed in every other state so it can't silently
  decline a ringing call. **Screens must add `useCallBannerInset()` to their own top padding** — it
  returns the banner's height while minimized and 0 otherwise. Every screen with a header already does
  (the five tabs + `alerts.js`); a new one that skips it will have its header hidden mid-call. Full-screen
  modals *inside* a screen (image/document viewers) deliberately don't, since a `Modal` renders above the
  banner anyway.
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
modules/hitchlink-quicklook/ local Expo native module: QLPreviewController (iOS only) — renders a
                            downloaded PDF/scan/Office doc in place. Both viewers (Documents tab and
                            chat attachments) try it first and fall back to Sharing.shareAsync.
```

Design tokens (`src/theme/tokens.js`): near-black `#0A0E14` surfaces, near-white (never pure white) text,
brand teal `#1FB6CE` / navy `#04285A`. Action colors are meaningful — teal = progress, green = completion,
red = call/severe weather, amber = plan a stop. Primary actions are 64px tall with tabular-number stats.

Navigation deliberately hands off to the phone's native Maps app rather than rendering in-app turn-by-turn
— a product decision, not a gap.

## Releases, crash reporting and on-device reminders

**OTA updates are wired up.** `expo-updates` points at EAS Update (`updates.url` in `app.json`). Each
`eas.json` profile declares its own `channel` (development / preview / production).
`fallbackToCacheTimeout: 0` means launch never blocks on a network fetch — a truck in a dead zone still
opens the app instantly.

⚠️ **`runtimeVersion.policy` is `appVersion`, and that makes bumping `expo.version` a MANUAL, mandatory
step whenever native code changes.** It was `fingerprint` originally — the policy that refuses to hand a
JS-only update to a binary whose native side doesn't match, which is exactly what a repo shipping custom
native modules (`modules/hitchlink-voip`, `modules/hitchlink-quicklook`) wants. Commit `3b4a6a1` moved it
to `appVersion` deliberately, and **do not move it back without solving what broke**: `expo-updates` adds a
"Configure expo-updates" build phase that compares the fingerprint computed locally against the one
computed on the EAS worker; the worker runs prebuild first, so its fingerprint includes an `ios/` directory
as a `bareNativeDir` source, which a managed checkout structurally cannot produce. The two can never match.

The cost of `appVersion` is that native changes no longer bump the runtime version on their own. Any two
builds sharing `expo.version` are treated as interchangeable, so an OTA carrying JS that calls a
newly-added native module — or assumes a different RN architecture — **will** be served to an older binary
that lacks it and crash on launch. **So: bump `expo.version` in the same commit as any native change, and
never publish an OTA across one.** Version history so far: `1.0.0` → `1.0.1` (expo-updates + Sentry landed)
→ `1.0.2` (added `modules/hitchlink-quicklook`, switched to the New Architecture).

**Crash reporting is opt-in via `src/lib/observability.js`.** It only activates when `EXPO_PUBLIC_SENTRY_DSN`
is set, so a checkout without a Sentry project behaves exactly as before. The root `ErrorBoundary`
(`app/_layout.js`) reports through it *and* offers a retry rather than dead-ending; `AuthContext` tags reports
with the driver id only (never name/phone/email), and clears it on sign-out.

**A build-time guard blocks shipping production against staging.** `scripts/check-prod-backend.js` runs via the
`eas-build-pre-install` npm script and fails the build *only* when `EAS_BUILD_PROFILE=production` and the API
URLs still contain `staging`. Development, preview and testflight builds, and plain local `npm install`, are
unaffected — `testflight` is deliberately outside the guard because internal testing against staging is the
point of it. There is still no dedicated production backend; the guard exists so nobody forgets that.

⚠️ **`Apns:Production` on the Railway `Dsp.Main` service must match the build's APNs environment.** A
`development` build uses Apple's sandbox push servers (`false`); `testflight`/`production` builds use the
production ones (`true`). Mismatched, every VoIP push comes back `BadDeviceToken`, CallKit never rings, and
the app falls back to its own in-app ring screen for every call (correctly — see `CallRingPath`) with the
lock-screen ring silently gone. There is only one backend, so the two build types cannot both have working
CallKit at the same time.

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
- **New Architecture is ON (`newArchEnabled: true`), as of 2026-07-26.** It had in fact been running for a
  while before that: a dev client was building with Fabric while `app.json` still said `false`, and the
  mismatch only surfaced when a device log showed `Running "main" with {…"fabric":true}`. Rather than
  regress a binary that was demonstrably working, the config was corrected to match reality.
  What this means for the calling stack, which was the original reason to stay on legacy:
  `react-native-callkeep@4.3.16` is a plain legacy ObjC module with no `codegenConfig`, and
  `@daily-co/react-native-daily-js` peer-depends on `react-native-background-timer@2.4.1` (unmaintained,
  legacy bridge) and imports it at runtime — so it is NOT removable despite appearing unused in our own
  source. **Both run through the bridgeless interop layer, and do work there** — in-app calling and the
  speaker toggle were both verified on a physical iPhone under Fabric. The local `hitchlink-voip` and
  `hitchlink-quicklook` modules are fine either way (Expo Modules API supports both architectures).
  Still unverified under Fabric: a CallKit call answered from the **lock screen** (the VoIP-push path).
  Test that on a physical device before shipping a production build.
- `README.md` in this repo is stale (still describes auth/voice/offline-queue as unimplemented placeholders)
  — trust this file and the code over it.
