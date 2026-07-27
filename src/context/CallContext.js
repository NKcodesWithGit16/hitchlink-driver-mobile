// Global in-app calling state — mounted once at the root layout so a
// dispatcher-initiated call rings no matter which tab is open. Mirrors the
// dispatcher web app's CallContext.js; the only real difference is this side
// also has a `tel:` fallback (see Messages screen) for cellular dead zones.
//
// Audio-only MVP: never requests the camera.
//
// iOS lock-screen ringing: a dispatcher-initiated call also triggers an APNs
// VoIP push (see backend DriverCallPushService), which the local
// `hitchlink-voip` native module (PKPushRegistry) reports straight to
// CallKit via react-native-callkeep — before this JS is necessarily running —
// so the phone genuinely rings even locked/backgrounded. On iOS, CallKit's
// native screen is the ONE incoming-call experience we want (product
// decision — more "professional" than our own in-app modal, and CallKit is
// the only path that rings from the lock screen at all). But its VoIP push
// is a separate delivery path from the live SignalR "IncomingCall" below and
// can arrive later — so on iOS, onIncomingCall holds off showing our own
// overlay for a short grace window (pendingSignalRIncomingRef) to let CallKit
// claim the call first (callKitCallIdsRef), and only falls back to the in-app
// overlay if CallKit never shows up in that window (a failed/unregistered
// push). On Android, which has no CallKit, the SignalR path is the only path
// and shows immediately, same as always.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useAuth } from './AuthContext';
import { useCallSocket } from '../hooks/useCallSocket';
import { startCall as apiStartCall, getCall, acceptCall as apiAcceptCall, declineCall as apiDeclineCall, endCall as apiEndCall } from '../api/calls';
import { startRinging, stopRinging } from '../lib/sound';
import { useT } from '../i18n/LanguageContext';

let Daily = null;
try {
  Daily = require('@daily-co/react-native-daily-js').default;
} catch {
  Daily = null;
}

let RNCallKeep = null;
let Voip = null;
// CallKit owns the audio session for the calls it presents: iOS activates the
// session itself and notifies the app, and WebRTC has to be told at that exact
// moment. That is what RTCAudioSession exists for. Without this bridge a
// CallKit-answered call joins Daily against a session it never learned about —
// no microphone, no speaker, a call that connects and is silent. The in-app
// overlay path was unaffected because it brings the session up itself, which is
// why answering in-app worked while answering on the iPhone's own screen did not.
let RTCAudioSession = null;
try {
  if (Platform.OS === 'ios') {
    RNCallKeep = require('react-native-callkeep').default;
    Voip = require('hitchlink-voip');
    RTCAudioSession = require('@daily-co/react-native-webrtc').RTCAudioSession ?? null;
  }
} catch {
  RNCallKeep = null;
  Voip = null;
  RTCAudioSession = null;
}

// Raw native event-name constants react-native-callkeep replays through
// `didLoadWithEvents` for anything that fired before JS attached its
// listeners (e.g. the call was answered from the lock screen while the app
// was killed) — see the cold-start replay in the effect below.
const RAW_EVENT = {
  didDisplayIncomingCall: 'RNCallKeepDidDisplayIncomingCall',
  answerCall: 'RNCallKeepPerformAnswerCallAction',
  endCall: 'RNCallKeepPerformEndCallAction',
  // Buffered like the rest: answering from the lock screen with the app killed
  // activates the session before any of this JS is running, and missing the
  // replay would leave exactly that call — the most important one — silent.
  didActivateAudioSession: 'RNCallKeepDidActivateAudioSession',
};

const CallContext = createContext(null);

// Audio-route ids as @daily-co/react-native-webrtc actually defines them —
// WebRTCModule+DailyDevicesManager.h on iOS, DailyWebRTCDevicesManager's
// AudioDeviceType enum on Android. Both are UPPERCASE; setAudioDevice() takes a
// bare string and silently does nothing for an unrecognised one, so these are
// not values to guess at.
const AUDIO_SPEAKER = 'SPEAKERPHONE';
const AUDIO_EARPIECE = 'WIRED_OR_EARPIECE';

const initialState = {
  status: 'idle', // idle | ringing-out | ringing-in | active | ended
  callId: null,
  peerName: null,
  // Presigned photo of whoever is on the other end. Incoming calls get it from
  // the server payload (`callerPhotoUrl`); outgoing ones fall back to the
  // dispatcher card on the driver profile, since that's always who we're
  // calling. Null just means the ring screen shows initials.
  peerPhotoUrl: null,
  roomUrl: null,
  token: null,
  muted: false,
  // Speaker starts ON for every call. A driver taking a dispatch call has both
  // hands on the wheel and the phone in a mount — holding it to their ear isn't
  // an option, and iOS otherwise routes a CallKit-answered call to the earpiece.
  speakerOn: true,
  error: null,
  startedAt: null,
};

export function CallProvider({ children }) {
  const t = useT();
  const { user, signedIn } = useAuth();
  const [state, setState] = useState(initialState);
  const callObjectRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  // The CallKit effect below registers its RNCallKeep listeners once (deps are
  // just [joinDailyRoom, reset]) so a re-render never churns them mid-call.
  // That means it closes over the first render's `user`, when driverProfile is
  // still loading — read the dispatcher through this mirror instead.
  const dispatcherRef = useRef(null);
  dispatcherRef.current = user?.dispatcher || null;
  const acceptInFlightRef = useRef(false);

  // The set of serverCallIds CallKit has already reported (via a VoIP push) —
  // lets the SignalR path below stand down for that call instead of
  // double-ringing. The actual call metadata (roomUrl/token/callerName) lives
  // natively, keyed by CallKit's call UUID — see Voip.getPendingCallMetadata.
  const callKitCallIdsRef = useRef(new Set());
  // serverCallId -> CallKit's own callUUID, for calls CallKit answered (see
  // onAnswered below). Lets any JS-driven end of the call (remote hangup,
  // local hangup/decline, ring timeout) also retire CallKit's native session
  // — without this, ending the call any way OTHER than tapping CallKit's own
  // end button leaves iOS showing a phantom "active call" (lock screen,
  // Dynamic Island, in-call UI) that never clears, and can block/confuse the
  // next call.
  const callKitUuidBySrvIdRef = useRef(new Map());
  // Product decision: on iOS the driver sees exactly ONE incoming-call screen,
  // and it is the iPhone's own CallKit one. It rings from the lock screen, from
  // a killed app, and looks like every other call the phone receives — none of
  // which a JS overlay can do.
  //
  // The difficulty is that CallKit is driven by a VoIP push, which is a
  // completely separate delivery path from the live SignalR "IncomingCall"
  // event, and it can arrive later — or not at all (rejected push, stale token,
  // Apns:* unset). Showing our overlay eagerly meant two ring screens at once;
  // never showing it would mean a dispatcher's call silently reaching nobody.
  //
  // So the backend now says which path is ringing: a "CallRingPath" event
  // follows IncomingCall by milliseconds carrying { callId, native }, where
  // native means APNs ACCEPTED the push (see CallsController.StartCall). The
  // rules that fall out of it:
  //
  //   native === true   -> show nothing, CallKit is coming.
  //   native === false  -> ring in-app IMMEDIATELY; nothing else will.
  //   no signal at all  -> older backend, or the event was lost: fall back to
  //                        the timer, which is what this used to do always.
  //
  // "Apple accepted it" still isn't "the phone rang", so CALLKIT_BACKSTOP_MS
  // covers the gap: if CallKit hasn't displayed by then, ring in-app anyway
  // rather than let the call die at the 45s timeout. On Android there is no
  // CallKit at all, so none of this applies and the overlay always shows.
  const pendingSignalRIncomingRef = useRef(null); // { callId, timer, payload } | null
  // How long to wait for CallKit when we DON'T know whether a push is coming.
  const CALLKIT_GRACE_MS = 3000;
  // How long to wait when we've been told one was accepted. Longer, because
  // here we have positive reason to expect a native ring and showing our own
  // screen early is the exact double-UI this is meant to remove.
  const CALLKIT_BACKSTOP_MS = 12000;
  // "CallAccepted"/"CallDeclined" for our own outgoing call can arrive over
  // SignalR before the /start POST that tells us our own callId even
  // resolves. Without this, that event is unmatchable (we don't know our
  // callId yet) and gets silently dropped: the dispatcher is already
  // connected/hung up, and we sit on "Calling…" until the 45s ring timeout
  // eventually cleans it up. Set by onCallAccepted/onCallDeclined when that
  // happens; consumed by startCall once its POST resolves. There's only ever
  // one outgoing call in flight per client, so an early resolution can only
  // be about it.
  const pendingResolutionRef = useRef(null);

  const endCallKitSession = useCallback((serverCallId) => {
    if (!RNCallKeep || !serverCallId) return;
    const uuid = callKitUuidBySrvIdRef.current.get(String(serverCallId));
    if (!uuid) return;
    callKitUuidBySrvIdRef.current.delete(String(serverCallId));
    console.info(`[Call] Retiring CallKit session ${uuid} for call ${serverCallId}.`);
    try { RNCallKeep.endCall(uuid); } catch (err) { console.warn(`[Call] RNCallKeep.endCall(${uuid}) failed:`, err); }
  }, []);

  const teardownCallObject = useCallback(async () => {
    const co = callObjectRef.current;
    callObjectRef.current = null;
    if (co) {
      try { await co.leave(); } catch (err) { console.warn('[Call] co.leave() failed during teardown (likely already left):', err); }
      try { co.destroy(); } catch (err) { console.warn('[Call] co.destroy() failed during teardown (likely already destroyed):', err); }
    }
  }, []);

  const reset = useCallback(() => {
    endCallKitSession(stateRef.current.callId);
    teardownCallObject();
    setState(initialState);
  }, [teardownCallObject, endCallKitSession]);

  // Best-effort route application. Used wherever the route needs (re-)asserting
  // but the caller can't act on failure: after joining, and again whenever
  // CallKit hands us an activated audio session — RNCallKeep runs its own
  // configureAudioSession at that point, which can move the route out from
  // under us, so speaker-by-default has to be re-applied rather than assumed.
  const applyAudioRoute = useCallback(async (speakerOn) => {
    const co = callObjectRef.current;
    if (!co) return;
    try { await co.setAudioDevice(speakerOn ? AUDIO_SPEAKER : AUDIO_EARPIECE); }
    catch (err) { console.warn('[Call] Could not apply the audio route; call continues on the default one:', err); }
  }, []);

  const joinDailyRoom = useCallback(async (roomUrl, token) => {
    if (!Daily) {
      console.error('[Call] Daily native module unavailable — is this build using a dev client with @daily-co/react-native-daily-js linked?');
      setState((s) => ({ ...initialState, status: 'ended', error: t('call.callingUnavailable') }));
      return;
    }
    const co = Daily.createCallObject({ audioSource: true, videoSource: false });
    callObjectRef.current = co;
    // Must be set BEFORE join — Daily reads the in-call audio mode as it brings
    // the native audio session up, and changing it afterwards doesn't re-route.
    // 'video' is the mode whose default route is the loudspeaker ('voice' means
    // earpiece-first, which is wrong for a driver); see DailyAudioManager's
    // defaultAudioDevice(). The runtime Speaker button below overrides it either
    // way via setAudioDevice.
    try { co.setNativeInCallAudioMode('video'); }
    catch (err) { console.warn('[Call] setNativeInCallAudioMode failed, using the platform default route:', err); }

    await co.join({ url: roomUrl, token, startVideoOff: true });
    setState((s) => ({ ...s, status: 'active', startedAt: Date.now() }));

    // Assert the route explicitly once media is up. setNativeInCallAudioMode
    // decides the *default*, but a CallKit-answered call arrives with iOS's own
    // session already configured for the earpiece, so the mode alone isn't
    // enough to guarantee the speaker on that path.
    applyAudioRoute(stateRef.current.speakerOn);
  }, [applyAudioRoute]);

  // ── Outgoing: driver taps Call on the Messages header ──────────────────
  const startCall = useCallback(async () => {
    if (!user?.id || stateRef.current.status !== 'idle') return;
    pendingResolutionRef.current = null;
    setState({
      ...initialState,
      status: 'ringing-out',
      peerName: user?.dispatcher?.name || 'Dispatcher',
      peerPhotoUrl: user?.dispatcher?.photoUrl || null,
    });
    try {
      const res = await apiStartCall(user.id);
      const pending = pendingResolutionRef.current;
      pendingResolutionRef.current = null;
      if (stateRef.current.status !== 'ringing-out') return; // cancelled locally while /start was in flight

      if (pending && pending.callId === res.callId && pending.type === 'accepted') {
        // The dispatcher already answered before we even learned our own
        // callId (see pendingResolutionRef above) — join right away instead
        // of sitting on "Calling…" for a resolution that already happened.
        console.info(`[Call] ${res.callId} was already accepted before we learned our own callId — joining now instead of waiting.`);
        setState((s) => ({ ...s, callId: res.callId, roomUrl: res.roomUrl, token: res.token }));
        joinDailyRoom(res.roomUrl, res.token).catch((err) => {
          console.error(`[Call] Join failed for ${res.callId} (early-accepted path):`, err);
          teardownCallObject();
          setState({ ...initialState, status: 'ended', error: t('call.couldNotConnect') });
          setTimeout(() => setState((cur) => (cur.status === 'ended' ? initialState : cur)), 2500);
          apiEndCall(res.callId).catch(() => {});
        });
        return;
      }
      if (pending && pending.callId === res.callId) {
        // Declined (or ended) before we learned our own callId.
        console.info(`[Call] ${res.callId} was already ${pending.type} before we learned our own callId.`);
        setState({ ...initialState, status: 'ended', error: pending.type === 'declined' ? t('call.callDeclined') : t('call.callEndedError') });
        setTimeout(() => setState((cur) => (cur.status === 'ended' ? initialState : cur)), 2500);
        return;
      }
      setState((s) => (s.status === 'ringing-out'
        ? { ...s, callId: res.callId, roomUrl: res.roomUrl, token: res.token }
        : s));
    } catch (err) {
      console.error('[Call] startCall failed:', err);
      setState({ ...initialState, status: 'ended', error: t('call.couldNotStart') });
      setTimeout(() => setState((s) => (s.status === 'ended' ? initialState : s)), 2500);
    }
  }, [user?.id, user?.dispatcher, joinDailyRoom, teardownCallObject]);

  const showIncomingOverlay = useCallback((p) => {
    setState({
      ...initialState,
      status: 'ringing-in',
      callId: p.callId,
      peerName: p.callerName || 'Dispatcher',
      peerPhotoUrl: p.callerPhotoUrl || null,
      roomUrl: p.roomUrl,
      token: p.token,
    });
  }, []);

  /** Arms (or re-arms) the in-app fallback for a call CallKit hasn't claimed. */
  const armInAppFallback = useCallback((p, waitMs, why) => {
    if (pendingSignalRIncomingRef.current) clearTimeout(pendingSignalRIncomingRef.current.timer);
    const callId = String(p.callId);
    const timer = setTimeout(() => {
      pendingSignalRIncomingRef.current = null;
      if (stateRef.current.status !== 'idle') return;              // resolved some other way meanwhile
      if (callKitCallIdsRef.current.has(callId)) return;           // CallKit claimed it just in time
      console.info(`[Call] CallKit never displayed ${callId} within ${waitMs}ms (${why}) — ringing in-app instead.`);
      showIncomingOverlay(p);
    }, waitMs);
    pendingSignalRIncomingRef.current = { callId, timer, payload: p };
  }, [showIncomingOverlay]);

  // ── Incoming: dispatcher called the driver (live SignalR event) ────────
  const onIncomingCall = useCallback((p) => {
    if (stateRef.current.status !== 'idle') return; // already on a call
    // CallKit already reported this exact call natively — let its own
    // screen/ringtone own it instead of also showing our JS overlay + ringtone
    // on top of it.
    if (callKitCallIdsRef.current.has(String(p.callId))) return;

    if (RNCallKeep && Voip) {
      // Hold off until CallRingPath tells us whether a native ring is coming.
      // This window only matters if that event never arrives.
      armInAppFallback(p, CALLKIT_GRACE_MS, 'no ring-path signal received');
      return;
    }

    showIncomingOverlay(p);
  }, [showIncomingOverlay, armInAppFallback]);

  // ── The backend's verdict on which UI should ring ──────────────────────
  const onCallRingPath = useCallback(({ callId, native }) => {
    const pending = pendingSignalRIncomingRef.current;
    if (!pending || pending.callId !== String(callId)) return;
    if (stateRef.current.status !== 'idle') return;

    if (native) {
      // A VoIP push is on its way, so CallKit owns this call. Stretch the wait
      // to the backstop instead of cancelling outright: Apple accepting a push
      // is not the same as the handset ringing, and a call nobody hears is a
      // worse failure than a briefly-late overlay.
      console.info(`[Call] ${callId} is ringing natively — holding the in-app screen back.`);
      armInAppFallback(pending.payload, CALLKIT_BACKSTOP_MS, 'native ring accepted but never displayed');
      return;
    }

    // No VoIP push went out at all, so nothing else is going to ring. Don't
    // make the driver wait out a grace window for a screen that isn't coming.
    console.info(`[Call] ${callId} has no native ring — showing the in-app screen now.`);
    clearTimeout(pending.timer);
    pendingSignalRIncomingRef.current = null;
    showIncomingOverlay(pending.payload);
  }, [showIncomingOverlay, armInAppFallback]);

  // ── Fallback: push-notification tap (app was backgrounded/killed, so the
  // live SignalR event above was never caught). Re-fetches the call if it's
  // still ringing; a no-op if it already timed out or was answered elsewhere.
  const loadCallFallback = useCallback(async (callId) => {
    if (stateRef.current.status !== 'idle') return;
    try {
      const res = await getCall(callId);
      if (!res || res.status !== 'Ringing') return;
      setState({
        ...initialState,
        status: 'ringing-in',
        callId: res.callId,
        peerName: user?.dispatcher?.name || 'Dispatcher',
        peerPhotoUrl: user?.dispatcher?.photoUrl || null,
        roomUrl: res.roomUrl,
        token: res.token,
      });
    } catch {
      // Already answered/declined/expired — nothing to show.
    }
  }, [user?.dispatcher]);

  const acceptCall = useCallback(async () => {
    // Synchronous re-entrancy guard — without it, a double-fire (double tap,
    // or CallKit's onAnswered firing while the SignalR path is also mid-way
    // through this) sends a second /accept that always 409s (the first
    // already flipped the call to Accepted), whose catch block then calls
    // /end and tears down the call the FIRST invocation just connected. A
    // React-state guard can't close this race; a ref can.
    if (acceptInFlightRef.current) return;
    const { callId, roomUrl, token } = stateRef.current;
    if (!callId || !roomUrl) return;
    acceptInFlightRef.current = true;
    try {
      await apiAcceptCall(callId);
      await joinDailyRoom(roomUrl, token);
    } catch (err) {
      console.error('[Call] acceptCall failed:', err);
      endCallKitSession(callId);
      teardownCallObject();
      setState({ ...initialState, status: 'ended', error: t('call.couldNotConnect') });
      setTimeout(() => setState((s) => (s.status === 'ended' ? initialState : s)), 2500);
      // apiAcceptCall above may already have flipped the call to Accepted
      // server-side before the join itself failed — /decline only works while
      // still Ringing and would silently 409 here, leaving the call stuck
      // "Accepted" and blocking every future call for this driver until the
      // backend's 20-minute self-heal catches it. /end is idempotent across
      // both Ringing and Accepted, so it always actually clears the call.
      if (callId) apiEndCall(callId).catch(() => {});
    } finally {
      acceptInFlightRef.current = false;
    }
  }, [joinDailyRoom, teardownCallObject, endCallKitSession]);

  const declineCall = useCallback(() => {
    const { callId } = stateRef.current;
    reset();
    if (callId) apiDeclineCall(callId).catch(() => {});
  }, [reset]);

  const hangUp = useCallback(() => {
    const { callId, status } = stateRef.current;
    const reason = status === 'ringing-out' ? 'cancelled' : undefined;
    reset();
    if (callId) apiEndCall(callId, reason).catch(() => {});
  }, [reset]);

  const toggleMute = useCallback(() => {
    const co = callObjectRef.current;
    if (!co) return;
    setState((s) => {
      const muted = !s.muted;
      co.setLocalAudio(!muted);
      return { ...s, muted };
    });
  }, []);

  // Speaker <-> earpiece. Unlike mute, the route change is async and can be
  // refused by the OS (another app holding the session, a headset taking
  // priority), so the flag is only flipped once the switch actually lands —
  // otherwise the button would lie about where the audio is going.
  const toggleSpeaker = useCallback(async () => {
    const co = callObjectRef.current;
    if (!co) return;
    const next = !stateRef.current.speakerOn;
    try {
      await co.setAudioDevice(next ? AUDIO_SPEAKER : AUDIO_EARPIECE);
      setState((s) => ({ ...s, speakerOn: next }));
    } catch (err) {
      console.warn('[Call] Audio route switch was refused, leaving it where it was:', err);
    }
  }, []);

  const onCallAccepted = useCallback(({ callId }) => {
    const s = stateRef.current;
    if (s.status !== 'ringing-out') return;
    if (s.callId === null) {
      // Our own /start hasn't resolved yet — remember it and let startCall's
      // continuation pick it up once it knows the callId (and has
      // roomUrl/token to actually join with). See pendingResolutionRef above.
      console.info(`[Call] CallAccepted for ${callId} arrived before our own callId was known — queuing it.`);
      pendingResolutionRef.current = { type: 'accepted', callId };
      return;
    }
    if (s.callId !== callId) return;
    // The dispatcher answered — join our own side. If *our* join fails, end the
    // call so they're not left alone in an already-connected room, and surface
    // why. Mirrors acceptCall()'s error handling, which was previously missing
    // on this caller-side path (an unhandled rejection that left the dispatcher
    // stranded until the ring timeout eventually fired).
    joinDailyRoom(s.roomUrl, s.token).catch((err) => {
      console.error(`[Call] Join failed for ${callId} after the dispatcher accepted:`, err);
      teardownCallObject();
      setState({ ...initialState, status: 'ended', error: t('call.couldNotConnect') });
      setTimeout(() => setState((cur) => (cur.status === 'ended' ? initialState : cur)), 2500);
      if (callId) apiEndCall(callId).catch(() => {});
    });
  }, [joinDailyRoom, teardownCallObject]);

  const onCallDeclined = useCallback(({ callId }) => {
    const s = stateRef.current;
    if (s.status === 'ringing-out' && s.callId === null) {
      console.info(`[Call] CallDeclined for ${callId} arrived before our own callId was known — queuing it.`);
      pendingResolutionRef.current = { type: 'declined', callId };
      return;
    }
    if (s.callId !== callId) return;
    reset();
  }, [reset]);

  const onCallEnded = useCallback(({ callId }) => {
    if (stateRef.current.callId !== callId) return;
    reset();
  }, [reset]);

  const onCallCancelled = useCallback(({ callId }) => {
    if (stateRef.current.callId !== callId) return;
    reset();
  }, [reset]);

  // A sibling session (e.g. this same driver signed in on a second device)
  // already answered/declined this call — stand down instead of being left
  // ringing here forever. Ignored while we ourselves are mid-accept
  // (acceptInFlightRef) so this can't race the call this device is in the
  // middle of connecting.
  const onCallHandledElsewhere = useCallback(({ callId }) => {
    if (acceptInFlightRef.current) return;
    const s = stateRef.current;
    if (s.callId !== callId || s.status !== 'ringing-in') return;
    console.info(`[Call] ${callId} was answered/declined on another session — dismissing here.`);
    reset();
  }, [reset]);

  useCallSocket(signedIn ? user?.id : null, { onIncomingCall, onCallRingPath, onCallAccepted, onCallDeclined, onCallEnded, onCallCancelled, onCallHandledElsewhere });

  // ── CallKit (iOS): reacts to the native call UI a VoIP push already put on
  // screen — see the module-level comment for how this and the SignalR path
  // above divide ownership of a given call.
  useEffect(() => {
    if (!RNCallKeep || !Voip) return undefined;

    // Fired once CallKit displays the native call screen (the completion of
    // hitchlink-voip's reportNewIncomingCall) — `handle` is the serverCallId
    // we passed natively, so this is enough to mark the call CallKit-owned.
    const onDisplayed = ({ handle }) => {
      console.info(`[Call] CallKit onDisplayed fired, handle=${handle}.`);
      if (!handle) return;
      callKitCallIdsRef.current.add(String(handle));
      // CallKit made it in time — cancel the in-app-overlay fallback so we
      // don't show a redundant second call UI a moment later.
      if (pendingSignalRIncomingRef.current?.callId === String(handle)) {
        clearTimeout(pendingSignalRIncomingRef.current.timer);
        pendingSignalRIncomingRef.current = null;
        console.info(`[Call] CallKit displayed ${handle} — in-app overlay fallback cancelled.`);
      }
      // CallKit turned up AFTER we'd already started ringing in-app. Previously
      // there was no path for this and both screens simply stayed up — the
      // double-ring the driver actually saw. Retire ours; CallKit owns the call
      // from here, and answering on it goes through onAnswered below.
      const s = stateRef.current;
      if (s.status === 'ringing-in' && String(s.callId) === String(handle)) {
        console.info(`[Call] CallKit displayed ${handle} late — standing the in-app screen down.`);
        stopRinging();
        setState(initialState);
      }
    };

    // Fired when the user taps Accept on CallKit's native screen — including
    // from the lock screen. hitchlink-voip cached the call's metadata
    // natively, keyed by this same callUUID, when the push first arrived.
    // Joins Daily the same way acceptCall() does, then marks the call active
    // for CallKit once Daily's media actually connects.
    const onAnswered = ({ callUUID }) => {
      console.info(`[Call] CallKit onAnswered fired, callUUID=${callUUID}.`);
      const meta = Voip.getPendingCallMetadata(callUUID);
      if (!meta?.serverCallId || !meta.roomUrl) {
        // getPendingCallMetadata is one-shot (native side removes the entry
        // on read — see HitchlinkVoipCoordinator.takeMetadata), so this is
        // either: called twice for the same callUUID (a re-fire we can't do
        // anything about, the data is genuinely gone), or the native push
        // handler never stored roomUrl/token for it in the first place
        // (HitchlinkVoipPushDelegate.m only sets those keys if
        // metadata.roomUrl/metadata.token are present in the APNs payload —
        // if ApnsVoipPushService.cs's shape ever drifts from what that file
        // parses, this is where it silently breaks). Logging the raw object
        // itself is what actually tells us which of those it is.
        console.error(`[Call] CallKit answered ${callUUID} but had no usable call metadata — cannot accept. meta=`, JSON.stringify(meta));
        return;
      }
      // Record the mapping up front (before the accept/join chain below even
      // starts) so that however this call ends — success, failure, or a
      // remote hangup arriving mid-join — reset()'s endCallKitSession can
      // find this UUID and retire CallKit's native session with it.
      callKitUuidBySrvIdRef.current.set(String(meta.serverCallId), callUUID);
      // Same synchronous re-entrancy guard as acceptCall(). If the JS overlay's
      // Accept and this CallKit answer both resolve for the same call (possible
      // when the SignalR IncomingCall raced ahead of CallKit's didDisplay, so
      // both surfaces showed), the second /accept 409s and its catch below would
      // /end the very call the first invocation just connected. A ref closes the
      // race a React-state guard can't.
      if (acceptInFlightRef.current) {
        console.warn(`[Call] onAnswered for ${callUUID} skipped — another accept is already in flight.`);
        return;
      }
      acceptInFlightRef.current = true;
      setState({
        ...initialState,
        status: 'ringing-in',
        callId: meta.serverCallId,
        peerName: meta.callerName,
        // The VoIP push payload is kept minimal and carries no photo, so fall
        // back to the dispatcher card — a CallKit incoming call is always from
        // them anyway. Via the ref, not `user`, to dodge this effect's stale
        // closure (see dispatcherRef).
        peerPhotoUrl: meta.callerPhotoUrl || dispatcherRef.current?.photoUrl || null,
        roomUrl: meta.roomUrl,
        token: meta.token,
      });
      console.info(`[Call] Accepting ${meta.serverCallId} via CallKit — calling /accept then joining Daily.`);
      apiAcceptCall(meta.serverCallId)
        .then(() => { console.info(`[Call] /accept succeeded for ${meta.serverCallId} — dispatcher should now see CallAccepted.`); return joinDailyRoom(meta.roomUrl, meta.token); })
        .then(() => RNCallKeep.setCurrentCallActive(callUUID))
        .catch((err) => {
          console.error('[Call] CallKit accept failed:', err);
          reset();
          // Same reasoning as acceptCall() above — accept may have already
          // landed server-side, so /end (not /decline) is what actually
          // clears it instead of leaving a stuck Accepted call.
          apiEndCall(meta.serverCallId).catch(() => {});
        })
        .finally(() => { acceptInFlightRef.current = false; });
    };

    // iOS has activated the audio session for a CallKit call. WebRTC is not
    // watching for that itself, so nothing can be heard in either direction
    // until it's told — this single line is the difference between a
    // CallKit-answered call working and connecting silently.
    const onAudioSessionActivated = () => {
      console.info('[Call] CallKit activated the audio session — handing it to WebRTC.');
      try { RTCAudioSession?.audioSessionDidActivate(); }
      catch (err) { console.error('[Call] RTCAudioSession.audioSessionDidActivate() failed:', err); }
      // RNCallKeep runs its own configureAudioSession as part of activating,
      // which can put the route back on the earpiece — so speaker-by-default
      // is re-applied here rather than trusted to survive.
      applyAudioRoute(stateRef.current.speakerOn);
    };

    const onAudioSessionDeactivated = () => {
      try { RTCAudioSession?.audioSessionDidDeactivate(); }
      catch (err) { console.warn('[Call] RTCAudioSession.audioSessionDidDeactivate() failed:', err); }
    };

    // Fired when the call ends for any reason — user hit CallKit's decline/
    // end button, or it timed out. If the call was never answered,
    // getPendingCallMetadata still has it (onAnswered never consumed it); if
    // it was answered, that already happened and stateRef carries the
    // serverCallId instead.
    const onEndedCall = ({ callUUID }) => {
      const meta = Voip.getPendingCallMetadata(callUUID);
      const serverCallId = meta?.serverCallId ?? stateRef.current.callId;
      if (serverCallId) {
        callKitCallIdsRef.current.delete(String(serverCallId));
        // CallKit is already tearing this session down natively (this event
        // IS that teardown) — drop the mapping without calling
        // RNCallKeep.endCall again via reset()'s endCallKitSession below.
        callKitUuidBySrvIdRef.current.delete(String(serverCallId));
      }
      const wasActive = stateRef.current.status === 'active' && String(stateRef.current.callId) === String(serverCallId);
      reset();
      if (!serverCallId) return;
      if (wasActive) apiEndCall(serverCallId).catch(() => {});
      else apiDeclineCall(serverCallId).catch(() => {});
    };

    // Cold-start reliability: react-native-callkeep buffers any of the above
    // events that fire before JS attaches listeners (e.g. the call was
    // answered from the lock screen while the app was fully killed) and
    // replays them once here via "didLoadWithEvents".
    const onLoadWithEvents = (events) => {
      (events || []).forEach(({ name, data }) => {
        if (name === RAW_EVENT.didDisplayIncomingCall) onDisplayed(data);
        else if (name === RAW_EVENT.answerCall) onAnswered(data);
        else if (name === RAW_EVENT.endCall) onEndedCall(data);
        else if (name === RAW_EVENT.didActivateAudioSession) onAudioSessionActivated();
      });
    };

    const subs = [
      RNCallKeep.addEventListener('didDisplayIncomingCall', onDisplayed),
      RNCallKeep.addEventListener('answerCall', onAnswered),
      RNCallKeep.addEventListener('endCall', onEndedCall),
      RNCallKeep.addEventListener('didActivateAudioSession', onAudioSessionActivated),
      RNCallKeep.addEventListener('didDeactivateAudioSession', onAudioSessionDeactivated),
      RNCallKeep.addEventListener('didLoadWithEvents', onLoadWithEvents),
    ];
    RNCallKeep.setup({
      ios: { appName: 'HitchLink', supportsVideo: false, includesCallsInRecents: true },
      android: {},
    }).catch((err) => console.error('[Call] RNCallKeep.setup failed:', err));

    return () => subs.forEach((s) => s.remove());
  }, [joinDailyRoom, reset, applyAudioRoute]);

  // Ring for as long as the call is waiting on either side — ringtone for an
  // incoming call, a quieter ringback tone while our own call rings out.
  useEffect(() => {
    if (state.status === 'ringing-in') startRinging('incoming');
    else if (state.status === 'ringing-out') startRinging('outgoing');
    else stopRinging();
  }, [state.status]);

  // Ring timeout — mirrors the dispatcher web app's RING_TIMEOUT_MS. Without
  // this, a ring nobody answers (app killed, notch of dead air, CallKit's own
  // timeout not firing because VoIP push isn't configured yet) leaves this
  // side stuck on the ringing overlay forever with no way back except a
  // reload, and never tells the backend to free up the call. Re-armed
  // whenever status/callId change, and torn down the moment either does
  // (accept, decline, hang up, or a remote CallAccepted/Declined/Ended event).
  const RING_TIMEOUT_MS = 45000;
  useEffect(() => {
    if (state.status !== 'ringing-in' && state.status !== 'ringing-out') return undefined;
    const { status, callId } = state;
    const timer = setTimeout(() => {
      const s = stateRef.current;
      if (s.status !== status || s.callId !== callId) return; // already resolved elsewhere
      endCallKitSession(callId);
      teardownCallObject();
      if (status === 'ringing-out') {
        setState({ ...initialState, status: 'ended', error: t('call.noAnswer') });
        setTimeout(() => setState((cur) => (cur.status === 'ended' ? initialState : cur)), 2500);
      } else {
        setState(initialState);
      }
      if (callId) apiEndCall(callId, 'timeout').catch(() => {});
    }, RING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [state.status, state.callId, teardownCallObject, endCallKitSession]);

  useEffect(() => () => {
    teardownCallObject();
    stopRinging();
    if (pendingSignalRIncomingRef.current) clearTimeout(pendingSignalRIncomingRef.current.timer);
  }, [teardownCallObject]);

  return (
    <CallContext.Provider value={{ ...state, startCall, acceptCall, declineCall, hangUp, toggleMute, toggleSpeaker, loadCallFallback }}>
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used within a CallProvider');
  return ctx;
}
