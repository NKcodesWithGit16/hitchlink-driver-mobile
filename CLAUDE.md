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

**The chat thread pins itself to the newest message**, and the rules are deliberate. `messages.js` re-pins
on every `onContentSizeChange` — not on message-count change, which missed both the first paint (FlatList
measures rows in batches, so the "bottom" moves several times) and the send/echo swap (same count, taller
bubble). The pin is conditional on the driver already being within `BOTTOM_PIN_SLOP` of the bottom, which
is what keeps it from re-introducing the bug that got `onContentSizeChange` removed originally: a bubble
growing 22px for its reveal-on-tap timestamp must not yank someone reading history down to the end.
Sending force-pins regardless. Entering the tab **always** drops to the newest message — that's a
`useFocusEffect`, not a mount effect, because the tab stays mounted and restoring the old scroll offset
after a tab switch was reported as a bug: opening a chat means "show me the latest".

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

## Photos are normalized before they leave the device

Every photo this app uploads is eventually rendered **in a browser** — the dispatcher's web chat sidebar,
the Drivers-list avatar, the Completed Loads paperwork gallery. The format the OS picker hands back is not
good enough for that: on iOS a camera-shot photo picked out of the library comes back as **HEIC**, which
Chrome, Edge and Firefox cannot decode. Uploading it verbatim produced a permanently broken `<img>` in the
dispatcher's chat that they couldn't even rescue by downloading it, because the filename was hardcoded to
`photo.jpg` while the bytes were HEIC. Screenshots (PNG) worked fine, which is what made it look
intermittent rather than systematic.

Two layers, and both matter:

- **Prevention (iOS):** every `launchImageLibraryAsync` call passes
  `preferredAssetRepresentationMode: Compatible`, which makes iOS transcode to JPEG on export. Ignored on
  Android and by the camera path. Three call sites: `app/(tabs)/messages.js` (chat attach),
  `app/(tabs)/index.js` (POD capture's library fallback), `app/edit-profile.js` (avatar).
- **Guarantee (all platforms):** `normalizePhoto()` in `src/api/main.js` re-encodes to JPEG via
  `expo-image-manipulator` whenever `isWebSafeImage()` (`src/lib/imageMime.js`) rejects the MIME, and
  downscales anything over 2560px on the long edge. Files under 1.5 MB that are already web-safe skip the
  manipulator entirely — measuring an image means decoding it, and that is slow on the cheap Android phones
  plenty of drivers carry. When a non-web-safe photo can't be transcoded it **throws** rather than
  uploading: a failed bubble the driver can retry beats a broken image the dispatcher finds hours later.

All three upload paths — `sendPhotoMessage`, `uploadLoadPhoto`, `uploadDriverPhoto` — go through it. Don't
add a fourth that calls `statLocalFile` directly for an image.

`src/lib/imageMime.js` also owns `MIME_EXT` / `baseMime`, shared with the *download* half of `main.js`
(`cacheFileName`, `utiForContentType`) — one table, so upload and download can't drift.

Note `expo-image-manipulator` is a **native module**: changes here ship as a new EAS build, not an EAS
Update. It is deliberately `require()`d lazily inside `normalizePhoto` rather than imported at the top of
`src/api/main.js` — that file is pulled in by `AuthContext` at the root of the tree, so a top-level import
throws at boot on any binary predating the dependency and takes the entire app down, sign-in screen
included. (That is not hypothetical; it happened on the first run against a stale dev client.) Keep it
lazy, and rebuild the dev client after `npx expo install` of anything native:
`eas build --profile development --platform ios`.

Photos uploaded before this landed are still HEIC bytes sitting in R2 under a `.jpg` key and stay broken in
chat history; only a server-side backfill would recover them.

## Chat photos: albums and the fullscreen viewer

A chat message carries a **list** of attachments, not one — the dispatcher portal always bundled a
multi-file pick into a single message, and the driver app now does too (attach button →
`allowsMultipleSelection`, capped at `MAX_PHOTOS_PER_MESSAGE`). Picking stages photos in a removable tray
above the composer rather than sending on pick, so a mis-tap is undoable and the text box becomes the
album's caption. `sendPhotosMessage` (`src/api/main.js`) uploads them concurrently and posts one message;
if any upload fails the whole send fails, because a silently-missing photo is worse than a bubble the
driver can retry.

`normalizeMessage` used to read `attachments[0]` and drop the rest, so a 4-photo message from dispatch
showed the driver one photo. It now also exposes `uris`; `uri` stays the first attachment so save-to-docs,
reply previews and the single-photo path are unchanged. **Don't reintroduce a `[0]` shortcut.**

`PhotoAlbum` (in `app/(tabs)/messages.js`) tiles 1 / 2 / 3 / 4+ photos, with `+N` over the fourth. It lays
out **explicit rows** rather than a wrapping grid on purpose: percentage widths plus a `gap` overflow the
container, and three photos in a 2×2 leave a hole.

A **single** photo sizes to its own aspect ratio via `usePhotoSize` (bounded by `PHOTO_MAX_W` /
`PHOTO_MAX_H`), not a fixed box — the old fixed `200×150` + `cover` cropped every portrait photo to a
landscape letterbox, which is most phone photos and exactly the shape a driver uses for a trailer door or a
page of paperwork. Dimensions come from the attachment's `width`/`height` when the sender recorded them
(the API has always returned these; the driver app now sends them too), otherwise from `Image.getSize`,
cached module-level because FlatList recycles chat rows. Multi-photo tiles stay **square** deliberately — a
grid of mixed aspect ratios reads as broken, and the viewer shows each photo whole.

In-flight sends show real byte progress: `putSignedFile` uses `LegacyFS.createUploadTask` when a progress
callback is passed (plain `uploadAsync` reports nothing), and `sendPhotosMessage` averages the batch so one
bar covers a whole album. A failed send keeps its uris on the bubble as `retry`, so `retrySend` re-runs it
without the driver re-picking every photo.
`HitchLink_frontend/src/components/Drivers/MessageAttachments.jsx` mirrors the same rules so both ends
agree.

`src/components/driver/PhotoViewer.js` is the fullscreen viewer: pinch-zoom, pan, double-tap zoom, swipe
between an album's photos, swipe-down to dismiss, an "n of m" counter, and a Messenger-style toolbar —
save to camera roll, share, a ⋯ sheet (mark up / save to Documents / delete), plus an inline reply box and
quick reaction that **do not close the viewer**, which is the entire point of that layout. It is built on
RN's own `Animated` + `PanResponder` + a paging `ScrollView` **deliberately** — neither
`react-native-gesture-handler` nor `react-native-reanimated` is in this project, and adding either would
force an extra EAS build for one self-contained screen. The gesture split is the part to understand before
editing: the pager owns horizontal swipes while a photo is un-zoomed, and `scrollEnabled` flips off the
moment a photo is zoomed so the `PanResponder` owns every drag. Without that switch the two fight over
each gesture. A single tap toggles the chrome but is deferred by `DOUBLE_TAP_MS`, otherwise every
double-tap zoom would also flash the toolbars.

`src/components/driver/PhotoEditor.js` is the editor, reached from the viewer's ⋯ sheet. It exists for
damage claims: cropping to the dented corner and circling it carries a claim in a way prose doesn't. **The
edited result is sent as a NEW message** — `ChatController` has no edit-attachment endpoint, and keeping
the original in the thread is the better record anyway.

Its chrome is modelled on Messenger's and **swaps entirely with the mode**, so each screen shows only what
that mode needs. Idle puts the tools top-right (draw / text / crop / undo) with an × to close and a Send
pill bottom-right, and the photo pinches and pans. Every other mode replaces that with plain Cancel/Done
text, a `SizeSlider` on the left edge of the photo, and either a `ColorRow` along the bottom (draw, text)
or the aspect/rotate pair (crop). There is **no arrow tool** — it was built and then removed as unused;
freehand covers it. `Done` commits the mode and returns to idle; `Cancel`
drops only that mode's *uncommitted* work — marks already committed by an earlier Done are undo's business,
since losing five good strokes to one stray tap would be worse.

**Text opens ready to type.** Picking it drops a caret in the middle of the photo and raises the keyboard
immediately — the driver already said "text", so a tap-to-place step buys nothing. The field renders with
no frame, styled to match the SVG output, and is `pointerEvents="none"` so every touch falls through to the
gesture layer: one finger drags the text, **two fingers pinch to resize it**. That pinch is the only size
control in text mode, which is why text has no `SizeSlider` where draw does. Tapping a label committed by
an earlier Done **picks it back up** for editing — without that, Done was one-way and a label could never
be moved again.

Two things about how the draft is positioned. Its `(x, y)` is the text's **centre**, not an SVG baseline
origin (`Mark` and `hitTestShape` both assume that). And it moves by **transform on an `Animated.ValueXY`,
never by `top`/`left` and never through state** — a per-frame `setState` made dragging feel heavy, and an
earlier version pinned `left`/`right` to 0 so only the vertical axis ever moved on screen while the stored
x drifted, making the text jump sideways on commit. `textPosRef` mirrors the animated value in plain JS
because commit has to know the final position even if a drag is terminated rather than released.

The eraser lives in the colour row rather than being its own mode: it answers the same question ("what does
my next touch do"), and undo only walks backwards, so fixing the first of five marks without it means
losing the other four. A tap runs `hitTestShape` over the shapes newest-first and drops the first hit.

Two things follow from the zoom and are the reason the code looks the way it does:

- **Shapes are stored in the SVG's `viewBox` coordinates, never screen coordinates**, because drawing is
  allowed while zoomed. The gesture layer sits *inside* the transformed container so RN reports touches
  already in that space. `src/lib/editorGeom.js` holds the explicit inversion (`screenToBase`) for if that
  ever stops holding, plus the crop/pan clamping — all pure and covered by `__tests__/editorGeom.test.js`.
- **The canvas height is a constant** (`TOPBAR_H` and `BOTTOM_H` are fixed, and the bottom bar's contents
  must fit inside `BOTTOM_H`). Letting it resize as modes change would change the viewBox, and every stored
  shape is in viewBox units — they would all shift the moment a tool was picked. Any new bottom-bar content
  has to respect that height rather than grow past it.

**Crop and rotate bake the current marks into the photo**: the canvas is flattened with `toDataURL`, the
result is cropped or rotated by `expo-image-manipulator`, and that becomes the new base image with the
shape list emptied. Remapping every stroke through a new letterbox is the alternative and it is all
downside. Undo still crosses those steps because editor state is a history stack of `{ baseUri, shapes }` —
so `undo` pops a stroke first, then a whole state.

The photo is rendered **inside** the `<Svg>` as an SVG `<Image>`, not behind it, so `svg.toDataURL()`
rasterizes the picture and the strokes in one pass; the base64 PNG is written to the cache and handed to
the normal upload path (which transcodes and downscales it).

**`toDataURL`'s `{width, height}` sets the output BOUNDS and renders the canvas at 1:1 into the corner of
them — it pads, it does not scale.** Passing a larger size to get a higher-resolution export produced a
photo in the top-left of a mostly blank image. Call it with no size, then measure the file that comes back
(the rasterizer may work at the device pixel scale) and map the crop rect in those units. Export
resolution is therefore the canvas's, not the photo's; raising it needs an off-screen canvas at the
photo's natural size with every coordinate scaled to match.

`react-native-view-shot` is the conventional tool for this and was used first, then removed — mainly
because `react-native-svg` is already a dependency and covers the whole job, so it's one native module
fewer. Note the resolution characteristics are the same either way: `captureRef` also snapshots the
rendered view. (It was originally dropped after an `RNViewShot could not be found` crash that looked like
a New Architecture incompatibility. That diagnosis was wrong — the device was running an older dev client
that predated the dependency. Nothing was ever shown to be wrong with view-shot itself.)

`saveToPhotoLibrary` (`src/api/main.js`) returns `'saved' | 'denied'` rather than throwing on a refused
permission — a denial is a normal outcome that deserves a route to Settings, not a generic error. Like
`expo-image-manipulator`, `expo-media-library` is **required lazily**; see the boot-crash note above.

## Session, tokens, and offline queue

`src/lib/session.js` does single-flight token refresh (proactive before expiry, reactive on a 401 via
`src/api/client.js`) — only a rejected *refresh* token actually ends the session. `src/utils/tokenStorage.js`
stores tokens in SecureStore on native, AsyncStorage on web (SecureStore throws in the browser).

Load status updates apply optimistically and queue to an AsyncStorage replay queue
(`src/lib/offlineQueue.js`, `enqueue`/`flush`/`queueCount`, wired into `app/(tabs)/index.js`) that flushes on
reconnect (`src/hooks/useNetworkStatus.js`).

## "Delete from history" is a device-local hide, deliberately

Long-pressing a card in the Pay tab's load history opens `HistoryFocusOverlay` and offers to delete it.
That writes the load id to `src/lib/hiddenLoads.js` (AsyncStorage, **keyed by driver** so a shared cab phone
never applies one driver's list to another) and filters it out of the list — nothing is sent to the server.
The earnings figures above the list are backend-computed and deliberately unchanged.

**Do not "fix" this by calling `DELETE /loads/{id}`.** That endpoint is a global soft-delete (`IsActive =
false`) that would pull the load out of the dispatcher's records, billing and settlements, and it has no
driver scoping. A delivered load is a financial record. If per-driver hiding ever needs to sync across
devices it wants a new driver-scoped flag on the backend — only the `read`/`write` pair in `hiddenLoads.js`
would change.

## Planned vs actual miles

Two different mileage figures travel together everywhere, and confusing them is the main hazard:

- **Planned** — `load.miles`, what the dispatcher quoted. **Nullable since 2026-07-28**: the booking form
  makes it optional, so `null` means "never quoted" and must render as `—`, never `0`. `rpm` is nullable for
  the same reason (it's `rate / miles`). Every reader has to guard it.
- **Actual** — `deadheadMiles` / `loadedMiles` / `actualMiles`, accumulated **server-side** in
  `HeartbeatCommandHandler` by summing the haversine segment between accepted GPS fixes into the active
  load, split at `LoadedAt` (before = deadhead, after = loaded). Always present; `0` means nothing tracked.
  It climbs live, so the dispatcher board shows it while the truck is still rolling.

`src/lib/loadStats.js` picks between the server figures and this device's own `lib/odometer.js` record: the
**server wins whenever it reports any distance**, because it survives a reinstall and can't be edited on the
phone. A server total of 0 falls back to the device record (older loads, mock mode). The two are taken as a
**set, never field-by-field** — mixing a server `loaded` with a device `deadhead` yields a total matching
neither source.

Accuracy caveats, deliberate: straight lines between samples **undercount** road distance; segments are
dropped when the gap exceeds `MaxOdometerGapSeconds` (30 min — the path is unknown, and inventing it is
worse than undercounting) or fall under `MinOdometerSegmentMeters` (25 m — GPS wander while parked would
otherwise add phantom miles across a 10-hour break). Good enough for a dispatcher metric; **not** a legal
odometer, and not something to base per-mile pay on without more work.

`geo.odometerSegmentMeters` is the phone-side mirror of those two rules and gates every `recordSegment`
call. Keep it in step with `HeartbeatCommandHandler` — the device record used to have no filter at all, so
it drifted upward against the server's for the same trip, which only stayed invisible because the server
wins whenever it reports anything. Note it is a *separate* question from `isAcceptableFix`: a fix can be
perfectly good to report as the live position and still be wrong to add to a distance total.

**The Pay tab's stats follow the visible history.** `src/lib/earningsAdjust.js` takes the hidden loads back
out of the period the screen is showing, so hero/chart/insights/grid/breakdown all move the instant a load is
removed or restored — no refetch, just a `useMemo` on `hiddenIds`. It is an *adjustment*, not a recompute,
and that distinction matters: `GET /drivers/{id}/earnings` aggregates **settlements** bucketed by payment
date, while history only carries a load's `rate`/`miles`/`completedAt`, so the client cannot rebuild the
period from scratch. A removed load's share of period gross comes out of every figure proportionally (exact
for `gross`, estimated for net/fuel/deductions); miles and the load count come off exactly; bars are cut on
the delivery day, then reconciled so the chart never totals more than the take-home above it; cancelled loads
move nothing (they never produced a settlement). Because the numbers then differ from the driver's settlement
statement, an adjusted period carries `excluded` and the hero captions itself "Excludes N loads you removed".
Don't delete that caption.

**A removal goes permanent after `RESTORE_WINDOW_MS` (3 weeks).** Until then it is recoverable — an
`UndoToast` fires immediately, and `app/hidden-loads.js` (More › Hidden loads, plus a link under the history
list) restores it, each row counting down its remaining days. Past the window `compact()` reduces the entry
to a bare `{id, hiddenAt}` tombstone: the snapshot is wiped off the device and `getHidden` stops offering it,
but **the id must stay** — `getHiddenIds` still feeds the history filter, and dropping the id would un-hide
the load on the next fetch, the opposite of a permanent delete. `unhideLoad` refuses an expired entry even
when called directly, and "Restore all" (`clearHidden`) leaves tombstones alone. Expiry is enforced lazily
on every read, since there is no background job and the app can sit closed for months.

## Structure

```
app/                       expo-router — file = route
  welcome.js → onboarding.js → (auth)/sign-in.js   gate the 5-tab (tabs)/
  (tabs)/index.js           Load home — status state machine drives the single contextual action.
                            An Assigned load with acceptedAt == null shows LoadOfferCard (accept/decline)
                            INSTEAD of that action — a driver can't mark "arrived" on a load they never took.
  (tabs)/messages.js        Chat + voice messages + call
  (tabs)/earnings.js        Pay history, stats, fuel estimate. Long-pressing a history card opens
                            HistoryFocusOverlay (blurred backdrop + confirm) to remove it — see below.
  hidden-loads.js           Restore anything removed from Pay history (also reachable from More)
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
                            localNotifications (on-device reminders), observability (opt-in Sentry),
                            hiddenLoads (device-local "removed from my history" list),
                            imageMime (web-safe image allowlist + MIME/extension table),
                            editorGeom (photo-editor coordinate + crop math)
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

Navigation deliberately hands off to the phone's own navigation app rather than rendering in-app
turn-by-turn — a product decision, not a gap. **Which** app is a driver preference (More › Navigation app,
persisted by `lib/prefs.js`): Google Maps (default), Apple Maps, or Trucker Path. `lib/navApps.js` is the
pure URL half — it returns an *ordered* candidate list and `ActionGrid` opens the first the OS accepts,
because `Linking.openURL` rejecting an unhandled scheme is the only "app not installed" signal available.
Nothing calls `canOpenURL`, deliberately: on iOS that needs every scheme in `LSApplicationQueriesSchemes`,
which is a native change, and a native change means bumping `expo.version` before any OTA (see below).
Apple Maps is dropped from the Android picker — it can't exist there, and dropping it also keeps that
Alert to the three buttons Android can render.

⚠️ **Trucker Path publishes no deep link.** Google and Apple document their URL formats; Trucker Path's
help centre only says it *can* publish a scheme on request (`truckerpath://route?...` is their own
example). Requested at integrations@truckerpath.com on 2026-07-28 — when they answer, pin their format and
delete the guesses. Until then the two platforms differ, and the difference is the whole design:

- **Android works properly today** via `geo:`, which hands the destination to whichever app holds the
  system default-navigation role — a role Trucker Path publishes its own guide to claiming. A driver who
  picked Trucker Path here but never set that default gets their real default (usually Google Maps) or a
  chooser; the *destination* still arrives, which is what matters. Because something always handles
  `geo:`, the bare-scheme and store entries after it are unreachable on Android. That's deliberate: we
  can't detect whether Trucker Path is installed without manifest `<queries>` (a native change), and
  arriving in the wrong app **with** the stop beats arriving in the right one without it.
- **iOS cannot be solved from here, so Trucker Path is hidden from the iOS/web picker.** There's no
  `geo:` equivalent, and since any path under a registered scheme opens an app on iOS, the first guess
  would launch Trucker Path whether or not it understands the destination — the driver only discovers the
  missing stop mid-route. Adding it back to `availableNavApps` is the ONLY change needed when a real
  scheme arrives: `navUrlCandidates` still builds the iOS form and is still tested for it.

`availableNavApps`/`resolveNavApp` (product policy — which apps we offer) are deliberately separate from
`navUrlCandidates` (physics — what URLs would open app X). Callers **must** `resolveNavApp` first: a
preference stored before an app was withdrawn otherwise builds a dead hand-off, and the More row must
render the *resolved* app or it names one Navigate isn't using.

Store fallbacks are searches rather than product links because neither the App Store id nor the Android
package name is verified — they were asked for in the same email.

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
→ `1.0.2` (added `modules/hitchlink-quicklook`, switched to the New Architecture) → `1.0.3` (TestFlight
release; **JS-only** — bumped to cut a fresh build, not because anything native changed).

The rule cuts both ways, and the second half is easy to forget: a bump is *mandatory* for a native change
but **not free otherwise**, because it strands every installed binary on the old runtime version. Every
commit from `1.0.2` to `1.0.3` is JS, so it could equally have shipped as an `eas update` to TestFlight
`1.0.2 (3)`. A new build was chosen because that build had a single install — nothing worth preserving —
and because a fresh binary has the code baked in, where `expo-updates` applies an OTA only on the launch
*after* it downloads, so a newly-onboarded driver would see stale code once. Neither reason generalises:
before bumping, run `git diff --name-only <last-bump>..HEAD` and look for `package.json`, `app.json`,
`modules/` or `ios/`. If none appear and testers are already on the build, an OTA is the better tool.

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
