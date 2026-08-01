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
`jwtUtils`, `sun`) — there is no UI/component test coverage, so verify screen changes by running the app.

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

Two details make that hold on a **cold start**, where the symptom was "chat opens part-way up the thread,
but switching tabs and back fixes it":

- **The `SETTLE_MS` window is armed when content arrives, not when the tab gains focus.** During it, every
  content-size change pins unconditionally and un-animated. Focus-first means the window is spent on an
  empty list — history is still in flight behind auth, the socket and the active-load fetch — so the thread
  is already "settled" by the time it has rows, and only gets the conditional, animated pin. A second visit
  worked only because the rows were measured by then.
- **Every programmatic scroll goes through `scrollToEnd()`, which flags itself for `AUTO_SCROLL_GRACE_MS`.**
  RN gives an animated `scrollToEnd` the same `onScroll` events as a finger drag, and its intermediate frames
  all read as "not at the bottom" — so the scroll *unpinned the very thing it was called to pin*, and no
  later content-size change would follow. `onScroll` therefore ignores scrolls inside that window;
  `onScrollBeginDrag` clears the flag, because a real finger outranks an in-flight auto-scroll. Photo bubbles
  resolve their height from a network `Image.getSize`, well after settling, so this is what lets a thread
  ending in photos still finish at the bottom.

All three resolve the hub's JWT via `accessTokenFactory: () => getValidToken()` (`src/lib/session.js`), so
a reconnect after token expiry re-authenticates automatically rather than failing. On `onreconnected`, the
chat/load hooks re-join their room and force a re-fetch to catch anything missed while the socket was down
— screens should treat the hook's `connected` flag as "can relax polling," never as the sole data source.

## In-app calling (Daily.co WebRTC + iOS CallKit)

This is a fully-built feature, not a stub — `src/context/CallContext.js` is the state machine for it, mounted
once at `app/_layout.js` so a call rings regardless of which tab is open. Audio **or video**.

**A call is placed as one or the other; cameras move freely afterwards.** `Call.IsVideo` on the backend (and
`video` in state) records only how the call was *placed* — it drives what the ring screen says and whether
CallKit rings as a video call on a locked iPhone, both of which must be decided before any media exists.
Turning a camera on or off during a call, **including upgrading an audio call to video**, travels over
Daily's own signalling between the two clients: `setLocalVideo(true)` on one end surfaces as
`participant-updated` on the other. There is deliberately **no backend endpoint for it**, and adding one
would be duplicating what Daily already does. Read `cameraOn` / `remoteCameraOn` for what's actually on
screen; `video` is not a live view of that.

⚠️ **Every `VideoTile` must gate its `track` on the matching camera flag**, never on the track merely being
non-null. `CallContext` hands out Daily's `persistentTrack`, which deliberately *survives* being muted — so a
camera turned off leaves a valid track object that has stopped producing frames, and `DailyMediaView` goes on
showing the last one it decoded. Ungated, the far end appears to **freeze mid-call** instead of falling back
to the camera-off placeholder. `VideoTile` cannot detect this itself: a live track and a muted one are the
same object.

⚠️ **The call object is created with `videoSource: true` even for an audio call**, with the camera held off
by `startVideoOff: !video` at join instead. These are not interchangeable, and the difference is not
cosmetic: `videoSource: false` sets Daily's internal `allowLocalVideo: false`, a hard gate that
`setLocalVideo(true)` **cannot lift** — only the private `_setAllowLocalVideo` can — so an audio call
configured that way could never be upgraded. `startVideoOff` governs *acquisition*, so the camera (and its
permission prompt) is still never touched until someone turns it on. Both clients do this the same way.

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
- **An active call can be minimized, and that is why the call UI is several components.**
  `src/components/call/CallOverlay.js` renders the full-screen takeover (a `Modal`, so it covers the tabs)
  or — when `status === 'active' && minimized` — one of two smaller forms. The takeover becomes a **video
  stage** when a camera is live: remote feed full-bleed, a draggable corner-snapping local PiP, and chrome
  that auto-hides after `CHROME_HIDE_MS` and returns on a tap. With no camera on it is exactly the audio
  screen it has always been.
  ⚠️ **The auto-hiding chrome's opacity must be bound to its views unconditionally** — never
  `videoStage && { opacity: chrome.opacity }`. `useAutoHideChrome` answers "may this hide?" itself. Written
  the other way it lost the driver their buttons: with the dispatcher's camera the only one on, the chrome
  would fade to opacity 0, and the moment they turned it off `isVideoLive` flipped false and the animated
  value was pulled out of the style array *while still at 0*. It is native-driven, so detaching it left the
  view at 0 with nothing able to restore it — animating it back to 1 did nothing, since it was no longer
  attached to anything. The controls stayed tappable, just invisible. Hence `hidden` (the timer's opinion)
  and `visible` (what renders) being separate values in that hook.
  **Which minimized form appears follows `isVideoLive` — is either camera actually on — not how the call
  was placed.** No video ⇒ the thin green banner ("Tap to return · 02:14"); video ⇒ `FloatingCallWindow`, a
  small draggable window showing the feed. `useCallBannerInset()` and the renderer share that one
  predicate, so they can't disagree about what's on screen.
  Neither minimized form is a `Modal`: an iOS `Modal` swallows every touch beneath it, which is what made
  the whole app unusable during a call. `minimized` is presentational only — the Daily call object and
  CallKit session are untouched — and is guarded to `active`, so a *ringing* call can never be hidden
  behind something nobody notices. The takeover's `‹` (top-left) and Android back both minimize; back is
  swallowed in every other state so it can't silently decline a ringing call.
  **Screens must add `useCallBannerInset()` to their own top padding** — it returns the banner's height for
  the banner, and **0 for the floating window**, which overlays a corner rather than displacing anything.
  Every screen with a header already calls it (the five tabs + `alerts.js`); a new one that skips it will
  have its header hidden mid-call. Full-screen modals *inside* a screen (image/document viewers)
  deliberately don't, since a `Modal` renders above it anyway.
- **The local PiP is a sibling of the safe-area container, not a child of it.** An absolutely-positioned
  child is laid out from its parent's *content* box, so inside that padded container `top: 0` would mean
  "below the status bar and in from the side" — every position off by the padding and the right-hand
  corners pushed off-screen. `src/lib/pipGeom.js` holds the pure corner-snap/clamp math (tested in
  `__tests__/pipGeom.test.js`); the bounds it's given deliberately carve out the top bar and the control
  strip so the tile can never come to rest on top of Hang up, and those carve-outs are **not** conditional
  on the chrome being visible or the tile would drift every time the controls faded.
- **Ring delivery does not trust the socket.** `useCallSocket` uses a retry policy that never gives up (the
  bare `withAutomaticReconnect()` default stops after 4 tries over ~30s and never reconnects — on a phone,
  which drops its socket every time it's pocketed, that means a driver silently unreachable until they
  restart the app), an `onclose` restart loop, and an `AppState` foreground kick. On every (re)connection
  and every return to the foreground it also sweeps `GET /calls/pending` for a call that started ringing
  while the socket was down, and feeds it through the ordinary `onIncomingCall` with `recovered: true` —
  which skips the `CALLKIT_GRACE_MS` wait, since a `CallRingPath` only ever follows a *live* event and will
  never arrive for a recovered one. `handledCallIdsRef` stops a sweep re-ringing a call this session just
  declined (still `Ringing` server-side until that POST lands).
- **`connecting` is entered by both ends at the same moment** — the callee on Accept, the caller on
  `CallAccepted` — so the ringback stops the instant someone picks up rather than playing on over them, and
  both timers start from the server's `AnsweredAt`. It has its own `CONNECT_TIMEOUT_MS` (20s), separate from
  the 45s ring timeout, or a join that never completes would sit on "Connecting…" forever.
- **Video quality is set explicitly** (`applyVideoQuality`: `updateSendSettings`/`updateReceiveSettings` at
  `high`, plus 720p `userMediaVideoConstraints`). Daily's defaults pick a simulcast layer from the rendered
  size, which is why an unpinned browser feed arrived here looking much worse than this app's own.
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

## Documents are cached offline for real (`src/lib/docCache.js`)

The Documents tab used to end with the line *"Documents are cached offline — accessible at weigh stations
with no signal."* Nothing was cached: the list was refetched on every visit and kept only in component
state, and opening a document downloaded it on the spot into `Paths.cache`, deleting any previous copy
first. At a weigh station with no signal the driver got an error box — the one moment the tab exists for.

`docCache.js` makes that true, and its shape mirrors `hiddenLoads.js`: a **pure policy half** that is unit
tested (`__tests__/docCache.test.js`) and a storage half that isn't.

- **Files live under `Paths.document`, never `Paths.cache`.** The cache directory is documented as
  "files that can be deleted by the system when the device runs low on storage" — a phone that drops a CDL
  to free space the night before an inspection is worse than no caching, because the driver believes it
  works by then.
- **One directory per document** (`documents/<docId>/<human name>`). Lookup goes through the manifest by
  id, so it never depends on a display filename the dispatcher can change, but the file keeps its human
  name because that is what the share sheet and QuickLook show. A flat directory forces one or the other —
  two documents both called `license.jpg` collide.
- **Keyed by driver**, and `clearAll()` runs on sign-out next to `cancelAllLocalReminders()`. Same
  shared-cab-phone reason as `hiddenLoads`, with more at stake: these are someone's actual credentials.
- **What gets cached**: the five DOT credential types whatever their size, plus anything under
  `AUTO_CACHE_SIZE_CAP`. Deliberately **not** gated on Wi-Fi — drivers are rarely on it, so gating would
  mean the feature never runs; the size cap is what protects the data plan. Staleness is `lastModifiedAt`
  off the DTO. `evictionPlan` drops orphans first, then least-recently-opened, and **never a credential**.
- `loadDocuments()` is network-first with the stored list as fallback, returning `{ docs, fromCache,
  savedAt }`. `fromCache` shows a quiet banner; the old full-screen error box is now only for
  "unreachable **and** nothing stored". Opening a document prefers the offline copy, and falls back to an
  older cached copy if refreshing it fails — a slightly stale CDL beats an error at a scale.
- On **web** the filesystem half no-ops (`fsReady()`), so the tab behaves exactly as it did before.

**Thumbnails: the phone makes them, the server only stores them.** `makeDocThumbnail` (`src/api/main.js`,
lazy `require` of `expo-image-manipulator` — see the boot-crash note above) sends a 320px JPEG with the
upload; `HitchLink.Main` stores it in a nullable `Document.ThumbnailContent` bytea and serves
`GET /documents/{id}/thumbnail`, with `hasThumbnail` on the list DTO. **No image library was added to the
API** and none should be. PDFs get no thumbnail by design and fall back to the file-type icon from
`fileKind()`.

**Older documents backfill themselves, from the copy already on the phone.** Anything uploaded before
thumbnails existed, and everything the dispatcher adds from the web portal, arrives with none — and the
server can't render one without the image library that isn't there. So `backfillThumbnails` in
`docCache.js` renders it on the device off the **offline copy that was downloaded anyway** and PUTs the
bytes to `PUT /documents/{id}/thumbnail` (`SetDocumentThumbnailCommand`). Three things about it:

- **It never downloads anything to do this.** `shouldBackfillThumb` requires a manifest entry with a real
  file, so a document the caching policy declined to keep is simply not a candidate. The data-plan
  reasoning that governs `shouldAutoCache` governs this for free.
- **`SetDocumentThumbnailCommand` must not bump `LastModifiedAt`** — that field is what `isStale` compares
  to decide whether the cached *file* is out of date, so bumping it would make every backfilled document
  re-download its full bytes over cellular to deliver a 40 KB picture.
- `thumbBackfill` on the manifest entry (`'done'` / `'unsupported'`) stops it repeating, and is what makes
  the one refetch `syncOfflineCopies` triggers via its `{ backfilled }` return value terminate rather than
  loop. `useDocThumb` checks the local file regardless of `hasThumbnail`, because the preview lands on disk
  before the list has been refetched to report it.

**Add and Renew ask where the document comes from: camera, photos, or files.** They used to go straight to
`DocumentPicker.getDocumentAsync` with a wildcard type, which reads as "anything" and on iOS is not —
`UIDocumentPickerViewController` browses Files and cannot see the photo library at all, so a driver who
photographed their CDL (the ordinary way a credential arrives) could not add it without exporting the photo
to Files by hand. `pickAsset` in `app/(tabs)/documents.js` now normalizes both pickers to the one shape
`DocumentReviewModal` consumes; note `mimeType` is not cosmetic there, since both the AI read and the
thumbnail are gated on it. The chooser is `src/components/driver/ActionSheet.js` and **not `Alert.alert`**:
Android renders at most three buttons, so Cancel plus these three would silently lose one — the same limit
that keeps the navigation-app picker to three — and RN-web has no `Alert` at all. Opening it from inside
another Modal (the detail sheet, the focus overlay) goes through `openSourceAfterModal`, which waits for
that Modal to actually go.

Image documents run through `normalizeDocumentImage` (`src/api/main.js`) before anything reads them, so
the same web-safe-JPEG guarantee the chat/POD/avatar paths have applies here — the dispatcher reads these
in a browser too. It closes two holes the pickers' own `Compatible` flag can't: a HEIC picked out of
**Files** (that flag is the photo library's, and iOS-only), and a 12 MP camera photo going into a Postgres
bytea column at full size, where every later download pays for it.

**Renewal replaces, and goes through the review modal.** `UpdateDocumentCommand` deliberately refuses to
swap a document's file bytes ("that would be a delete-and-re-upload"), so renewing uploads a new document
and then soft-deletes the old one (`DELETE /documents/{id}` → `IsActive = false`; the row survives for the
dispatcher, and it is *not* the global load delete `hiddenLoads.js` warns about). Both steps matter: the
old code uploaded straight off the picker carrying `expiresAt: doc.expires` forward, so a "renewed" CDL
saved **still expired** — a renewal exists to change exactly that field, so it now runs through
`DocumentReviewModal` like any other add, seeded by a `defaults` prop for type/label/number but never for
the expiry date. Retiring the old document is best-effort: the replacement has already saved by then.

**Inspection mode** reuses `PhotoViewer` rather than shipping a second viewer — passing no callbacks
already strips the chat chrome. `allowDownload={false}` is the one thing that can't be inferred that way:
Save and Share both route through `downloadChatAttachment`, which fetches a *remote* url, and inspection
mode passes local `file://` uris. Only image credentials can go in the viewer, so readiness ("3 of 4 ready
to show") is reported on the entry bar rather than as a placeholder slide — a driver needs to learn their
registration isn't on the phone while still parked.

**A tap opens the document, a long press opens the actions.** `DocViewer` used to be what a tap opened,
and it repeated the card almost field for field — number, expiry, status, a countdown of the same days the
card counts — so the tap cost a driver a screen and bought them nothing. `openDocument` now goes straight
to the bytes: image → `PhotoViewer` (it pinches, which is what reading a number off a scan needs), other →
QuickLook on iOS and the share sheet everywhere else, exactly what the old View button did. **`DocViewer`
survives for one case only: a document with no file attached**, which is the one thing that has nothing to
render and needs somewhere to say so. Its View button routes back through the screen's `openDocument`
rather than keeping a second copy of that logic, and stands its own Modal down first.

Renew and Delete moved to `DocFocusOverlay` (long press), modelled on `HistoryFocusOverlay` down to the
armed-in-place delete confirm — an `Alert` can't render the document it's talking about, and RN-web has no
`Alert` at all. **Neither overlay captions its actions**: "Upload renewal" / "Delete document" and
"Hide from history" / "Delete permanently" are self-evident, and the Pay tab's captions were removed on
2026-08-01 as restatements of their buttons. The reversible-vs-permanent difference is still spelled out
where it decides something — the delete confirm names Hide as the alternative, and the Hidden loads screen
counts down each entry's remaining days.

Two things about how it's built. **The document is solid, the menu is glass** — `GlassView` is the material
`tokens.js` reserves for overlay chrome, and the split makes the hierarchy readable before a word is: the
subject is the card lifted out of the list, the actions are chrome over it. **Exactly one `GlassView`,
though, and that's a budget.** Each one is a live `BlurView` stacked on the backdrop's, and `dimezisBlurView`
is expensive on the cheap Android handsets plenty of drivers carry — so Cancel and the delete confirm stay
opaque (which is the iOS convention for both anyway). The three layers rise on `motion.stagger`, so the
document lands before its actions and the sheet reads as coming *out* of the card. And the lifted card is
two nested views on purpose: iOS clips a shadow the moment `overflow: hidden` is set, which the status
stripe needs, so the outer view owns the fill and elevation and the inner one owns the clip. **Renew stays on the card as well for anything expired or expiring, and must not be moved
into the sheet alone**: a long press advertises nothing, and burying the fix for a lapsed CDL behind an
invisible gesture recreates the dead end this screen just stopped having. What the sheet adds is renewing a
document that is still *valid*. `accessibilityActions` carries the long press to VoiceOver/TalkBack, and
nested pressables (the card's own Renew button) forward `onLongPress` or they'd be dead zones.

The 44pt identity tile — the document's thumbnail, or a glyph for its file type — is `DocThumb`
(`src/components/driver/DocThumb.js`) rather than inline in the tab, because the overlay has to show the
*same* tile as the card it lifted out of the list; two independent resolvers would flash a generic icon
while re-fetching a preview the card already had. **The card has no trailing chevron**: that glyph promises
"pushes a screen", which the tap stopped doing. The busy state lives on the tile instead (`busy` scrims it
and spins), because the tile *is* the document — a spinner there reads as "fetching this one", where one at
the row's edge reads as "this row is doing something". It covers `renewing` as well as `opening`, since a
renewal started from the sheet on a still-valid document has no Renew button to spin.

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

## Editing a profile, and what a form owes the keyboard (`app/edit-profile.js`)

The only real form in the app, and the reason it is worth a section is that almost none of it is about
profiles. **A field is one 68px block that focuses from anywhere inside it** — icon, label, padding, all of
it. The original was a label-left / value-right row about 43px tall, so the one thing that opened the
keyboard was the width of the text itself: a target that moved as the value changed, under the 56px this
app uses everywhere else, and hopeless with gloves on. Values are left-aligned, the label doubles as the
focus indicator (it turns teal, so nothing resizes when the keyboard opens), and each block owns its own
error line. Save is the standard 64px `PrimaryAction` pinned above the keyboard, not a link in the header.

Four things about the keyboard, in the order they bit:

- ⚠️ **`KeyboardAvoidingView` in `padding` mode works the overlap out from its own `onLayout` frame, and
  that frame's `y` is relative to its PARENT's content box.** So it must be the full-height child with the
  safe-area inset applied *inside* it (here, on the header) — the arrangement `(auth)/sign-in.js` also uses.
  Nested under a container padded by `insets.top`, or placed as a sibling below the header, it under-shifts
  by exactly what it can't see and the keyboard sits on the bottom fields. A `keyboardVerticalOffset` fixes
  it too, and is worse: it's a second copy of the header's height, wrong the moment the header changes.
- **Not being covered is not the same as being visible.** Shrinking the scroll view only stops the overlap;
  the field just tapped can still be below the fold. So the focused **block** (not its input — the input
  sits ~12px above the block's bottom and an error line grows it further) is measured with
  `measureInWindow` against the keyboard's own reported top edge minus the save bar's measured height, and
  scrolled by the **minimum** that clears it. Minimum because yanking the form to the top on every focus is
  its own annoyance. Window coordinates, so it assumes nothing about insets or how tall any given keyboard
  (or its autofill/emoji bar) happens to be.
- **Everything it measures against is still moving when the keyboard event lands**, so a single pass lands
  short: the keyboard is animating, the save bar is re-laying out as it drops its home-indicator inset, and
  a scroll from the previously-focused field may still be running. Hence `ensureVisibleSettled` — one pass
  now, one after `SETTLE_MS`. The second re-measures, so a pass that already landed computes ~0 and moves
  nothing. The save bar's `onLayout` re-checks too, because a failed save grows it by the error banner.
- **The last field needs slack beneath it or it cannot be helped at all.** A scroll view clamps at
  `contentHeight - viewportHeight`, so the bottom-most field can be asked to rise clear of the save bar and
  have nowhere left to scroll to — the scroll succeeds and moves nothing. Every field above it has the rest
  of the form behind it and never hits that wall, which is why this presented as "only Email".

Two smaller ones, both already settled — don't reopen them:

- **iOS floats its own "Done" pill above a phone pad**, labelled from `returnKeyType`. It looks like a
  stray button between the save bar and the keys and it is not ours. It is also the *only* way to dismiss
  that keyboard, which has no return key; losing it means giving up `phone-pad` and its big digits. Leave it.
- **Return-key chaining (`next` → `next` → `done`) was built and removed.** Four fields is not a form worth
  stepping through, and Save is above the keyboard the whole time.

The photo source is an `ActionSheet`, not `Alert.alert`, for the reason the Documents tab already
documents: with a photo set it is three options plus Cancel, and Android renders at most three buttons —
"Remove photo" silently vanished — while RN-web has no `Alert` at all. It stands down before the picker
launches (`MODAL_HANDOFF_MS`). Leaving with unsaved edits asks first, Android hardware back included, and
the form seeds itself if the driver record lands after mount — guarded, since that fetch can return
mid-keystroke.

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
  edit-profile.js           Name/phone/email + avatar (from More › Profile and the home header).
                            The app's only real form — see the keyboard section above before touching it.
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
                            imageMime (web-safe image allowlist + MIME/extension table + file-kind icons),
                            editorGeom (photo-editor coordinate + crop math),
                            sun (sunrise/sunset — what the Auto theme resolves against),
                            docCache (offline copies of the driver's documents — see below)
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

**"Auto" means the sun, not the phone's light/dark switch.** More › Appearance offers Auto / Day / Night,
and Auto used to be a straight mirror of `useColorScheme()`. Its clock branch was dead code — `app.json`
sets `userInterfaceStyle: "automatic"`, so on native that hook never returns null — which made Auto a third
copy of Night for the many drivers who pinned their phone to dark years ago. It now resolves down a ladder
in `src/theme/ThemeContext.js`:

1. **The sun**, from `src/lib/sun.js` — the standard NOAA/Meeus sunrise equation (no dependency, ~1 min
   accuracy), given the device's position. It compares `now` against the sunrise/sunset **instants** in
   epoch ms, so time zones and DST never enter into it and a truck crossing into Central is right
   immediately. Polar day/night are a reported state, not an error — Alaska runs freight all winter.
2. The phone's scheme, when there is no position.
3. The old fixed 06:00–19:00 *local hour* rule. Web, mainly; the only rung that reads a clock.

Two things not to undo. **Position comes from `getLastKnownPositionAsync` behind a
`getForegroundPermissionsAsync` check that never prompts** — a location dialog at boot, before the driver
has seen the sign-in screen, to pick a colour scheme would be indefensible; the app already holds the
permission while signed in for the heartbeat, so this is free in practice, and the last fix is mirrored into
AsyncStorage so the first frame of a cold start is already sun-correct. And **a timer has to re-render at
the boundary** — the scheme is derived during render, so without one it only ever changed when some other
state did. It is capped at 6h (the truck moves; a timer armed in Denver is wrong by Chicago) and re-armed on
`AppState` `active`, because timers don't fire while the phone sleeps and a rig parked overnight would
otherwise wake to yesterday's scheme. Why the sun and not the OS setting: the buttons say Day and Night, the
convention drivers know is the nav app's, and the thing being fought — glare at 2am, a dark screen against a
bright windshield at noon — tracks the sun, not a toggle flipped once a year ago. Fixed 06:00–19:00 was
never good enough for that: Seattle's day length swings past 15h in June and under 9h in December.

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
release; **JS-only** — bumped to cut a fresh build, not because anything native changed) → `1.1.0` (video
calling: `NSCameraUsageDescription`, the Android `CAMERA` permission, the `expo-media-library` plugin, and
`hasVideo` in `HitchlinkVoipPushDelegate.m` — plus it clears three native packages added after 1.0.3 was
submitted).

**Minor vs. patch is a labelling decision and nothing else.** Because the policy is `appVersion`, this
string's real job is to key OTA compatibility — `1.0.5` and `1.1.0` behave identically, strand exactly the
same installs, and cost exactly the same. So pick by what the number *says*: a release that adds a feature
a driver would notice takes the minor, a fix-only rebuild takes the patch. That release was `1.0.4` for a
day and became `1.1.0` on 2026-08-01, on the grounds that it adds video calling. **Renaming was only free
because no shipped build carried `1.0.4`** — it existed as one iOS *development* build, with TestFlight
still on `1.0.3`. Once a version reaches a tester, its number is frozen: changing it costs a fresh build
and leaves everyone on the old one unreachable by OTA until they install the new one.

⚠️ **Nothing between `1.0.3` and `1.1.0` may ship as an OTA.** `expo-image-manipulator`,
`expo-media-library` and `react-native-svg` all landed after the 1.0.3 build was submitted, and
`src/components/driver/PhotoEditor.js` imports `react-native-svg` at module scope while
`app/(tabs)/messages.js` imports `PhotoEditor` at module scope — so an update carrying that JS to a 1.0.3
binary **crashes the Messages tab**. `runtimeVersion.policy: appVersion` does hold the line here (an update
published from this checkout is stamped `1.1.0` and a 1.0.3 binary asks for `1.0.3`), but do not defeat it
by hand-setting a runtime version. 1.1.0 must be a new build.

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
